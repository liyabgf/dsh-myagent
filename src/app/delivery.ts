/**
 * Delivery: where a Report goes when it is worth telling someone.
 *
 * A Ticket's ending is written into its own directory as `RESULT.md`, so the answer outlives the process that produced
 * it and a person who never opened the panel can still read it. The main Session hears about it as a notice, and is
 * woken only when the Ticket waits for a person — a finished Ticket should not cost the operator a model turn they did
 * not ask for. And a Ticket whose Trigger carries a reply address gets the Report sent back to the platform the request
 * came from, through the two-way Source that wrote that address. Every one of these is a durable effect, so a crash
 * while telling someone retries the telling instead of dropping it — and a reply that exhausts its retries is recorded
 * twice, as a `reply_lost` event in the Ticket's log and as `REPLY-UNDELIVERED.md` beside its `RESULT.md`, because
 * "the answer never arrived" must not be indistinguishable from "no answer was ever owed".
 */
import { accessSync, constants, mkdirSync, statSync, writeFileSync } from 'node:fs'
import { writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { GATE_REASONS, key, UserError, type Delivery, type PolicyEffect, type Report, type ReplyTo, type ReportState, type Ticket } from '../core/index.ts'
import type { Settings } from '../core/policy.ts'
import type { Source, TwoWaySource } from '../sources/kind.ts'
import type { Effects } from './effects.ts'
import type { HealthBoard, HealthEntry } from './health.ts'
import type { Sessions } from './sessions.ts'
import type { Store } from './store.ts'

/** The report states someone is told about; `progress` and `waiting` are for the panel alone. */
const TOLD: readonly ReportState[] = ['ready', 'blocked', 'failed', 'dropped']
/** The report states that end a Ticket, and so get a `RESULT.md`. */
const ENDING: readonly ReportState[] = ['ready', 'failed', 'dropped']

export interface DeliveryHost {
  readonly context: Context
  readonly store: Store
  readonly effects: Effects
  readonly sessions: Sessions
  readonly health: HealthBoard
  readonly lifetime: AbortSignal
  readonly subprocess: SubprocessRuntime
  settings(): Settings
  /**
   * The running Source of one kind, when there is one — where a reply is dispatched to (contract §3.3).
   *
   * Answered by the Runtime's registry rather than held here, because a Source instance is the registry's to create,
   * replace when its settings change and stop; a Delivery that kept its own reference would deliver to an instance
   * that was already replaced.
   */
  source(kind: ReplyTo['kind']): Source | undefined
  /**
   * Record in one Ticket's own log that a reply owed to whoever asked for the work was given up on.
   *
   * A narrow writer rather than the Engine itself: a Delivery holding the Engine could write any domain state it
   * liked, and this one fact is all it has to add. The same shape as the Watchdog's `escalate`.
   */
  replyLost(ticketId: string, detail: Record<string, unknown>): void
  /**
   * The panel's URL prefix, ending where a Ticket id can be appended: `http://127.0.0.1:3080/myagent/#ticket=`.
   * A notification that cannot be clicked is a banner that is gone before it is read, so it carries a way in.
   */
  panelPath(): string
}

/** A reply on its way back to wherever the Ticket's request came from, as the effects queue carries it. */
export interface SendPayload {
  /** The Ticket the reply belongs to, which is what makes a give-up traceable to a person's own work. */
  readonly ticketId: string
  readonly replyTo: ReplyTo
  readonly text: string
}

/** Where a reply that the queue gave up on is written, inside the Ticket's own directory. */
export const UNDELIVERED_FILE = 'REPLY-UNDELIVERED.md'

/**
 * How much of the owed text the log event carries. The file beside it carries all of it.
 *
 * An event detail is rendered in a Ticket's history among dozens of others; a log that stored whole reports would stop
 * being a log. This is enough to recognise the sentence and to know a person has to send it by hand.
 */
const EVENT_TEXT_CHARS = 400

/** Cut at a character, not through one: a lone surrogate half would end up in the stored JSON. */
function clipped(text: string, max: number): string {
  if (text.length <= max) return text
  let cut = text.slice(0, max - 1)
  const last = cut.charCodeAt(cut.length - 1)
  if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
  return `${cut}…`
}

/**
 * The identity of one reply: a pure function of what it carries, and of nothing else.
 *
 * No timestamp and no attempt counter, so a `send` that is asked twice for the same words to the same address
 * replaces the pending row instead of queueing a second delivery — deduplication by key is the whole reason the send
 * goes through the queue at all (contract §3.2). S31 is the precedent for the rule: an identity that carried the
 * instant made one fact into two records, and the counts lied about it.
 */
export function sendKey(ticketId: string, replyTo: ReplyTo, text: string): string {
  return key('send', ticketId, replyTo.kind, replyTo.channel, replyTo.thread ?? '', text)
}

/**
 * What goes back to the platform that asked.
 *
 * The worker's own words, and nothing about this machine: no Ticket directory and no `myagent_answer_ticket`, both of
 * which are instructions only myagent's own front desk can follow. A requester who cannot act on a line is better off
 * without it — the same reason `relayText` and `resultDocument` are separate texts rather than one.
 */
export function replyText(ticket: Ticket, report: Report): string {
  // A `ready` needs no heading: the summary IS the answer. Anything else has to say what became of the work first,
  // because "needs you" and "failed" are facts the requester is waiting on and cannot infer from a summary.
  const lines = report.state === 'ready' ? [report.summary] : [headline(ticket, report.state), '', report.summary]
  const question = report.question?.trim()
  if (question !== undefined && question !== '') lines.push('', `The worker asks: ${question}`)
  if (report.files !== undefined && report.files.length > 0) {
    lines.push('', 'Files:', ...report.files.slice(0, 20).map(file => `- ${file}`))
  }
  return lines.join('\n')
}

/** What one reply address reads as in a sentence a person can act on. */
function addressOf(replyTo: ReplyTo): string {
  return `${replyTo.kind}/${replyTo.channel}${replyTo.thread === undefined ? '' : ` (thread ${replyTo.thread})`}`
}

/** A notice on its way to the main Session, and to `RESULT.md` when the Ticket ended. */
export type NotifyPayload =
  | { readonly kind: 'report'; readonly ticketId: string; readonly state: ReportState; readonly summary: string
      readonly question?: string; readonly files?: readonly string[]; readonly at: string }
  | { readonly kind: 'policy'; readonly ticketId: string; readonly at: string; readonly detail: string }

const reason = (error: unknown): string => error instanceof Error ? `${error.name}: ${error.message}` : String(error)

/** The one line a person reads first: what happened to which Ticket. */
export function headline(ticket: Ticket, state: ReportState): string {
  const label = state === 'ready' ? 'done' : state === 'blocked' ? 'needs you' : state === 'failed' ? 'failed' : 'dropped'
  return `${ticket.title} — ${label}`
}

/** The text the main Session receives: enough to act, short enough to read. */
export function relayText(ticket: Ticket, payload: Extract<NotifyPayload, { kind: 'report' }>): string {
  const lines = [
    `Ticket ${ticket.id} (${headline(ticket, payload.state)})`,
    '',
    payload.summary,
  ]
  if (payload.state === 'blocked' && payload.question !== undefined) {
    lines.push('', `The worker asks: ${payload.question}`, '', 'Answer with `myagent_answer_ticket`.')
  }
  if (payload.files !== undefined && payload.files.length > 0) {
    lines.push('', 'Files:', ...payload.files.slice(0, 20).map(file => `- ${file}`))
  }
  if (ticket.execution !== undefined) lines.push('', `Directory: ${ticket.execution.directory}`)
  return lines.join('\n')
}

/** What `RESULT.md` says, which is the Ticket's ending in full. */
export function resultDocument(ticket: Ticket, payload: Extract<NotifyPayload, { kind: 'report' }>): string {
  const lines = [
    `# ${ticket.title}`,
    '',
    `- Ticket: ${ticket.id}`,
    `- State: ${payload.state}`,
    `- At: ${payload.at}`,
    `- Authorized by: ${ticket.mandate.sender.id} via ${ticket.mandate.via}`,
    `- Policy version: ${ticket.mandate.policyVersion}`,
    '',
    '## Scope',
    '',
    ticket.mandate.scope,
    '',
    '## Summary',
    '',
    payload.summary,
  ]
  if (payload.question !== undefined && payload.question !== '') {
    lines.push('', '## Question', '', payload.question)
  }
  if (payload.files !== undefined && payload.files.length > 0) {
    lines.push('', '## Files', '', ...payload.files.map(file => `- ${file}`))
  }
  lines.push('')
  return lines.join('\n')
}

/**
 * The notification program this machine has, looked up once.
 *
 * `terminal-notifier` is preferred because it can make the notification open the Ticket; AppleScript's
 * `display notification` cannot, and arrives attributed to Script Editor, which tells the operator nothing about where
 * it came from. Neither is required: without one, the notice in the main Session and `RESULT.md` are still the record.
 */
/** Whether a path is a file this process may execute, which is what a notifier has to be. */
function executable(path: string): boolean {
  try {
    return statSync(path).isFile() && (accessSync(path, constants.X_OK), true)
  } catch {
    return false
  }
}

export function findNotifier(): string | undefined {
  for (const candidate of ['/opt/homebrew/bin/terminal-notifier', '/usr/local/bin/terminal-notifier']) {
    if (executable(candidate)) return candidate
  }
  for (const directory of (process.env.PATH ?? '').split(':')) {
    if (directory === '') continue
    const candidate = join(directory, 'terminal-notifier')
    if (executable(candidate)) return candidate
  }
  return undefined
}

export class OutcomeDelivery implements Delivery {
  private healthEntry?: HealthEntry
  private get health(): HealthEntry { return this.healthEntry ??= this.host.health.entry('delivery') }

  /**
   * Set while one delivery is recording problems, so the delivery that found a problem cannot also be the one that
   * clears it. One flag is enough because a delivery is never concurrent with another: `Effects.runDue` awaits one
   * handler at a time and refuses to start a second pass while one is running.
   */
  private complained = false

  /** The notification program this machine has; `terminal-notifier` is the one that can open the Ticket on a click. */
  private readonly notifier: string | undefined

  /**
   * How many replies were queued, and how many had nowhere to go.
   *
   * The second number is the one that matters: a Ticket whose Trigger carries no `replyTo` gets nothing sent and no
   * error (contract §3.3), and an invisible nothing is indistinguishable from a send that silently failed. Counted
   * here rather than on the health board because "this cron Ticket has no way back" is the normal case, and writing
   * it as a problem would train the operator to ignore the board — while writing it with `record` would erase a real
   * problem in the same stroke (S19 / N5).
   */
  private queued = 0
  private nowhere = 0

  constructor(private readonly host: DeliveryHost, notifier?: string | null) {
    host.effects.handle('notify', payload => this.notify(payload as NotifyPayload))
    host.effects.handle('send', payload => this.sendReply(payload as SendPayload))
    this.notifier = notifier === undefined ? findNotifier() : notifier ?? undefined
  }

  /** The reply tally, for a panel or a test that has to tell "sent" from "had nowhere to send to". */
  sends(): { readonly queued: number; readonly nowhere: number } { return { queued: this.queued, nowhere: this.nowhere } }

  /** One problem on this part's health entry, and the reason the delivery that found it does not also clear it. */
  private complain(detail: string): void {
    this.complained = true
    this.health.problem(detail)
  }

  /**
   * Say that delivery works, in the only unit Delivery has evidence about: one delivery that went through.
   *
   * Delivery has no pass of its own. Both of its handlers run inside a pass of the effects queue, and `sendGaveUp`
   * runs inside that queue's give-up hook, so the nearest boundary is the queue's — and a quiet pass knows nothing
   * about delivery. Summarizing from one would erase a line like "RESULT.md could not be written" in a pass that
   * delivered nothing and so has nothing to offer as evidence (`tests/notify.spec.ts` pins that the line is still
   * there after the passes that follow it). One delivery that went through is the evidence, and it is what makes the
   * board's own contract — `record` clears what the part reported, so the next unrelated success overwrites the line
   * — literally true of this entry instead of aspirational. Until this method existed nothing called `record` here,
   * so a give-up stayed on the board for the life of the process.
   */
  private summarize(): void {
    if (this.complained) return
    this.health.record('the last delivery went through')
  }

  /** Queue the telling of one Report; the states nobody is told about are left to the panel. */
  report(ticket: Ticket, report: Report): void {
    if (!TOLD.includes(report.state)) return
    this.host.effects.enqueue('notify', key('notify', ticket.id, report.at, report.state), {
      kind: 'report', ticketId: ticket.id, state: report.state, summary: report.summary,
      question: report.question, files: report.files, at: report.at,
    })
    // And back to whoever asked, in the same place they asked from. This Delivery already decides where a Report goes
    // — its own file header is "where a Report goes when it is worth telling someone" — and the platform a request
    // came from is one of those places. For every one-way Source this is the counted no-op below, so a deployment
    // with no chat Source pays one map lookup per Report and sends nothing.
    this.send(ticket, replyText(ticket, report))
  }

  /**
   * Send a message back to wherever this Ticket's request came from (contract §3).
   *
   * Enqueued, never sent inline: the queue is what gives the words a record of their execution and their failure, what
   * makes one platform hiccup retryable instead of final, and what deduplicates a Report that is recorded twice. An
   * inline send loses the sentence the first time the network stumbles, and loses it silently.
   */
  send(ticket: Ticket, text: string): void {
    // Resolved from the Trigger, which is the only place an address was ever written down. Never inferred from the
    // actor: an id says who asked, not where to answer, and a guessed address posts a Report to a room that never
    // asked for one (contract §3.3).
    const replyTo = this.host.store.triggers.get(ticket.origin.triggerId)?.trigger.replyTo
    if (replyTo === undefined) {
      this.nowhere++
      this.host.context.logger.debug('myagent had nowhere to send Ticket %s: its Trigger carries no replyTo', ticket.id)
      return
    }
    this.queued++
    this.host.effects.enqueue('send', sendKey(ticket.id, replyTo, text), { ticketId: ticket.id, replyTo, text })
  }

  /**
   * One reply's delivery, run by the effects queue: find the Source that wrote the address and hand it over.
   *
   * A throw is left to ride — the queue counts it, backs off, and gives up with a trace. Catching it here would turn a
   * platform that is down into a reply that looks delivered, which is the one outcome worse than a retry.
   */
  private async sendReply(payload: SendPayload): Promise<void> {
    this.complained = false
    const source = this.host.source(payload.replyTo.kind)
    // Narrowed rather than assumed: `deliver` is what makes a Source two-way, and the registry hands back a plain
    // `Source`. Calling it unconditionally would turn a one-way kind into a TypeError four retries later.
    const deliver = source === undefined ? undefined : (source as Partial<TwoWaySource>).deliver
    // Its own code, and not the `reply_unroutable` that a two-way Source throws when the channel it would write to is
    // gone or switched off. Here the address is fine and nothing is running that could take it: a different cause with
    // a different remedy — put a Source of that kind back, versus put the channel back.
    if (typeof deliver !== 'function') throw new UserError('reply_unreceivable', { kind: payload.replyTo.kind })
    await deliver.call(source, payload.replyTo, payload.text)
    // Reached only when the reply really went out: a throw above leaves the line this part reported standing, which is
    // the difference between "delivery works again" and "delivery stopped complaining".
    this.summarize()
  }

  /**
   * A reply the queue gave up on, recorded twice: in the Ticket's own log, and in its own directory.
   *
   * The health line the queue already wrote is not enough, and this project has now learned that three times (N5's
   * `rule_stopped`, N8's `escalated`, and this one): the board answers "how are things now", so the next delivery that
   * goes through overwrites the line — that is what `summarize` below does, and until it existed the line was never
   * overwritten at all, which was worse but no more a record — and the board lives in this process, so a restart takes
   * the give-up with it and leaves an operator with a Ticket that looks finished and a requester who was never
   * answered. `trigger` still has exactly that hole; `notify` got its trace as `notice_lost`.
   *
   * The two records are not redundant. The log event is a fact about this Ticket's life, is what its history renders,
   * and outlives the board being cleared; the file carries the owed words VERBATIM so a person can send them by hand,
   * which a clipped event detail cannot. Both are written synchronously: this runs inside the effects pass that gave
   * up, and a trace still being written when the pass returns is a trace a test — or a crash — can miss.
   */
  sendGaveUp(payload: SendPayload, error: unknown): void {
    const detail = reason(error)
    const address = addressOf(payload.replyTo)
    this.complain(`The reply for Ticket ${payload.ticketId} to ${address} was given up on: ${detail}`)
    try {
      this.host.replyLost(payload.ticketId, { address, error: detail, text: clipped(payload.text, EVENT_TEXT_CHARS) })
    } catch (logError) {
      // A Ticket that is gone has no log left to write to, and the file below is then the only trace. Named rather
      // than dropped: that is the difference between "the record is over there" and "there is no record".
      this.complain(`The reply for Ticket ${payload.ticketId} was given up on, and its log entry could not be `
        + `written: ${reason(logError)}`)
    }
    const directory = this.host.store.tickets.get(payload.ticketId)?.execution?.directory
    const at = new Date().toISOString()
    if (directory === undefined) {
      // No directory means nothing was ever prepared for this Ticket, so there is nowhere durable to leave the words.
      // Said out loud instead of dropped: this is the one case where the give-up has no record but the log and board.
      this.host.context.logger.error('myagent gave up on the reply for Ticket %s (%s) and has no directory to record it in: %s',
        payload.ticketId, address, detail)
      return
    }
    const document = [
      '# A reply for this Ticket never reached its requester',
      '',
      `- Ticket: ${payload.ticketId}`,
      `- Address: ${address}`,
      `- Given up at: ${at}`,
      `- Error: ${detail}`,
      '',
      'The effects queue retried this reply and gave up. The health board line is overwritten by the next unrelated',
      'success, so this file is the record. Send the words below by hand: a Ticket that is still open tries again with',
      'its next Report, and one that has ended will not try again at all.',
      '',
      '## What was owed',
      '',
      payload.text,
      '',
    ].join('\n')
    try {
      // Created rather than assumed: a Ticket whose launch never ran has a directory in name only.
      mkdirSync(directory, { recursive: true })
      writeFileSync(join(directory, UNDELIVERED_FILE), document, 'utf8')
    } catch (writeError) {
      this.complain(`The reply for Ticket ${payload.ticketId} was given up on, and its record could not be `
        + `written to ${directory}/${UNDELIVERED_FILE}: ${reason(writeError)}`)
    }
  }

  /** Queue the telling of a settings change that bears on a live Ticket, in the gate's own words. */
  policyChanged(ticket: Ticket, effect: PolicyEffect): void {
    const detail = `${GATE_REASONS[effect.reason]}${effect.detail === undefined ? '' : ` (${effect.detail})`}`
    this.host.effects.enqueue('notify', key('notify', ticket.id, 'policy', effect.reason, detail), {
      kind: 'policy', ticketId: ticket.id, at: new Date().toISOString(), detail,
    })
  }

  /** Write the ending, tell the main Session, and notify the machine when that is wanted. */
  private async notify(payload: NotifyPayload): Promise<void> {
    const ticket = this.host.store.tickets.get(payload.ticketId)
    // Nothing was delivered, so nothing is claimed about delivery: an entry that said "the last delivery went
    // through" on the strength of a notice dropped for a Ticket that is gone would be the board lying about itself.
    if (ticket === undefined) return
    this.complained = false
    const settings = this.host.settings()
    if (payload.kind === 'policy') {
      await this.host.sessions.notify(`Settings changed for Ticket ${ticket.id} (${payload.detail}).`, key('policy-notice', payload.ticketId, payload.at))
      this.summarize()
      return
    }
    if (ENDING.includes(payload.state) && ticket.execution !== undefined) {
      try {
        await writeFile(`${ticket.execution.directory}/RESULT.md`, resultDocument(ticket, payload), 'utf8')
      } catch (error) { this.complain(`Could not write RESULT.md for ${ticket.id}: ${reason(error)}`) }
    }
    const text = relayText(ticket, payload)
    const requestId = key('relay', payload.ticketId, payload.at, payload.state)
    // A Ticket that waits for a person wakes the front desk; an ending only leaves a notice in its history.
    if (payload.state === 'blocked') await this.host.sessions.relay(requestId, text)
    else await this.host.sessions.notify(text, requestId)
    if (settings.notify.enabled) {
      await this.machineNotification({
        title: ticket.title,
        subtitle: headline(ticket, payload.state),
        body: payload.summary,
        // panelPath() ends where an id can be appended. It is empty on a profile with no web server, and then there
        // is nothing to open: a notification with a bogus `-open` is worse than one without.
        ...(this.host.panelPath() === '' ? {} : { url: `${this.host.panelPath()}${ticket.id}` }),
      })
    }
    // Only on the way out of a delivery that finished: a RESULT.md this notice could not write is reported above and
    // must survive this notice, and a throw from the Session call leaves the line standing for the queue to add to.
    this.summarize()
  }

  /**
   * A local desktop notification, when this machine has one and the operator wants it. It is a courtesy: the notice in
   * the main Session and `RESULT.md` are the record, so a failure here is logged and settled.
   *
   * `terminal-notifier` is used when it is installed, because it is the only one of the two that can make the
   * notification do something when it is clicked: it opens the Ticket in the panel. Plain `osascript` shows a banner
   * that is attributed to Script Editor and has no click action at all, so it carries as much of the account as fits
   * and leaves the rest to the panel.
   */
  private async machineNotification(notice: { title: string; subtitle: string; body: string; url?: string }): Promise<void> {
    if (process.platform !== 'darwin') return
    // A banner holds a sentence, not a report: the first lines are the part worth interrupting somebody for.
    const clip = (text: string, max: number): string => {
      const flat = text.replace(/\s+/g, ' ').trim()
      if (flat.length <= max) return flat
      let cut = flat.slice(0, max - 1)
      // Ending on the first half of a surrogate pair would put a lone half into argv, which renders as U+FFFD.
      const last = cut.charCodeAt(cut.length - 1)
      if (last >= 0xd800 && last <= 0xdbff) cut = cut.slice(0, -1)
      return `${cut}…`
    }
    const quote = (text: string): string => text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    const argv = this.notifier === undefined
      ? ['osascript', '-e', `display notification "${quote(clip(notice.body, 160))}" `
        + `with title "${quote(clip(notice.title, 60))}" subtitle "${quote(clip(notice.subtitle, 60))}"`]
      : [this.notifier, '-title', clip(notice.title, 60), '-subtitle', clip(notice.subtitle, 60),
        '-message', clip(notice.body, 200), ...(notice.url === undefined ? [] : ['-open', notice.url])]
    try {
      const handle = this.host.subprocess.spawn({
        argv,
        cwd: homedir(), graceMs: 1000, signal: AbortSignal.any([this.host.lifetime, AbortSignal.timeout(5_000)]),
        stdio: { stdin: 'ignore', stdout: { maxBytes: 1 << 12 }, stderr: { maxBytes: 1 << 12 } },
      })
      await handle.done
    } catch (error) { this.host.context.logger.debug('myagent could not notify this machine: %s', reason(error)) }
  }
}
