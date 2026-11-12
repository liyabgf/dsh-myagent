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
import { lstat, writeFile } from 'node:fs/promises'
import { resolveRealInside } from './files.ts'
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

/**
 * The report states someone is told about. `progress` is for the panel and the front desk alone.
 *
 * `waiting` used to sit next to `progress` here, on the reasoning that both are "for the panel alone". That premise
 * is false for `waiting` whenever the requester is reachable, and the cost was concrete: a worker whose turn ended
 * without a report leaves a Ticket that will not move until a person pushes it, the panel filed it under "needs you",
 * and the person who asked in a chat room heard NOTHING — because a chat requester has never seen the panel. Silence
 * there is not a missing courtesy; the work is stopped and only a person can restart it.
 *
 * The test for telling someone is two conditions at once: silence makes it worse, AND nobody else is going to look.
 * `waiting` meets both wherever there is an address to write to, and `send` below already answers the second half —
 * a Ticket whose Trigger carries no `replyTo` sends nothing and counts itself in `nowhere`. So adding the state here
 * reaches exactly the requesters who can be reached, and changes nothing for a panel-opened Ticket.
 *
 * `progress` stays out on the same test's first condition: a progress line is not a fact that gets worse unattended,
 * and sending every one of them to a chat room is how a bot gets muted.
 */
const TOLD: readonly ReportState[] = ['ready', 'blocked', 'failed', 'dropped', 'waiting']

/**
 * The states that reach the front desk and nobody else (S2).
 *
 * `progress` is injected into the front desk rather than queued as a question, because the difference between
 * `notify` and `relay` is exactly the difference between "here is a fact" and "answer this" — and a progress line is
 * the first. The front desk accumulates it, so when the operator asks "how is it going" the answer is already in the
 * room instead of having to be reconstructed.
 *
 * It is never sent to a requester. A progress line does not get worse if nobody reads it (the first of the two
 * conditions for telling someone), and one per turn in a chat room is how a bot gets muted.
 */
const DESK_ONLY: readonly ReportState[] = ['progress']
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
   * 【G-3 站点 2】Write the Ticket's ending document (`RESULT.md`) into its workspace. A narrow member rather than
   * the sandbox itself: Delivery gets exactly the one write it needs, and "what the document says" stays this
   * file's decision while "that it lands in the workspace" becomes the sandbox's promise.
   *
   * REPLY-UNDELIVERED.md deliberately does NOT go through this: `sendGaveUp` writes it SYNCHRONOUSLY, on the
   * documented reasoning that a trace still being written when the giving-up pass returns is a trace a crash can
   * miss — that guarantee outranks interface purity, and a VM sandbox would have to offer a synchronous write
   * through its boundary or this one record stays host-local.
   */
  writeResultFile(directory: string, name: string, text: string): Promise<void>
  /**
   * The panel's URL prefix, ending where a Ticket id can be appended: `http://127.0.0.1:3080/myagent/#ticket=`.
   * A notification that cannot be clicked is a banner that is gone before it is read, so it carries a way in.
   */
  panelPath(): string
}

/** A reply on its way back to wherever the Ticket's request came from, as the effects queue carries it. */
export const MAX_OUTBOUND_FILES = 5
export const MAX_OUTBOUND_FILE_BYTES = 20 * 1024 * 1024

export interface SendPayload {
  /** The Ticket the reply belongs to, which is what makes a give-up traceable to a person's own work. */
  readonly ticketId: string
  readonly replyTo: ReplyTo
  readonly text: string
  /** Relative paths of report artifacts on a `ready` report, resolved and verified inside `sendReply`. */
  readonly files?: readonly string[]
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
 * The hard ceiling on the borrowed-work line, in UTF-16 characters.
 *
 * A bridge already splits an outbound reply to fit a platform's own limit (Telegram's is 4096), so this is not about
 * fitting: it is about the line staying ONE glance on a phone. A courtesy that has to be scrolled past is a courtesy
 * nobody reads, and the moment it wraps to three lines it is competing with the answer it is meant to explain.
 */
export const CREDIT_LINE_MAX = 120
/**
 * How much of one source Ticket's title the line may carry.
 *
 * Titles are written by whoever asked, so they are as long as a sentence can be. Clipped rather than refused: a
 * truncated title still tells the operator WHICH earlier job this is, which is the whole content of the line.
 */
const CREDIT_TITLE_MAX = 20
/** How many source titles are named before the rest of them become a count. */
const CREDIT_NAMED_MAX = 2

/**
 * What this Ticket borrowed from other Tickets, as its own event log records it.
 *
 * The Engine writes an `artifact_read` into BOTH Tickets when one reads an artifact the other registered
 * (`recordArtifactRead`, on the success path of a read `authorizeArtifactRead` allowed), and a `skill_used` into both
 * when one uses a 手艺 another promoted (`skillUsed`). Until
 * now the only reader of those events was the panel's lineage view, so the operator on a phone got a summary that read
 * as self-produced even when it was mostly an earlier job's data — and "this one reused last week's crawl" is exactly
 * the fact that decides whether the answer can be trusted without opening a browser.
 *
 * Only the direction this Ticket borrowed in is read (`fromTicketId`). The mirror image (`byTicketId`: somebody else
 * reused YOUR output) is a fact about a different Ticket's report, and saying it here would be noise on this one.
 * `input` hand-offs are left out for the same reason `citationsOf` is not reused wholesale: a note handed over is not
 * work borrowed, and the line is only worth its characters if it means "this answer stands on that answer".
 */
export interface BorrowedWork {
  /** Titles of the sources that are alive and have one, in the order this Ticket borrowed from them, deduplicated. */
  readonly titles: readonly string[]
  /** Sources that cannot be named: the operator deleted the Ticket, or the store no longer resolves the id at all. */
  readonly gone: number
  /** Sources that are alive but carry no usable title. Counted and never printed — a bare id is not a name. */
  readonly nameless: number
  /** How many distinct 手艺 this Ticket used. Counted and never named, because the name is a `myagent-…` string. */
  readonly skills: number
}

/**
 * Read one Ticket's borrowings out of its own log.
 *
 * Deduplicated by source Ticket rather than by event: the Engine records one `artifact_read` per (source, path), so a
 * report built on four files of the same earlier job is one borrowing, not four, and naming that job four times would
 * read as a stutter. Order is the log's own, which is oldest first — the order the work was actually borrowed in.
 *
 * Throws are left to the caller: this reads a database, and the caller is the one that knows whether the line it was
 * building was worth a report.
 */
export function borrowedFrom(store: Store, ticketId: string): BorrowedWork {
  const titles: string[] = []
  const seen = new Set<string>()
  const skills = new Set<string>()
  let gone = 0
  let nameless = 0
  for (const event of store.events.list(ticketId)) {
    const detail = event.detail
    if (event.type === 'skill_used') {
      const from = detail?.fromTicketId
      if (typeof from !== 'string' || from === ticketId) continue
      // Counted by name so two events for the same 手艺 are one, but the name itself never leaves this function.
      // A missing one still means a 手艺 was used, so it gets a placeholder that cannot collide with a real name.
      skills.add(typeof detail?.skill === 'string' && detail.skill !== '' ? detail.skill : `\u0000${skills.size}`)
      continue
    }
    if (event.type !== 'artifact_read') continue
    const from = detail?.fromTicketId
    if (typeof from !== 'string' || from === ticketId || seen.has(from)) continue
    seen.add(from)
    // `get` rather than `list`: a tombstone is hidden from every list but still resolves here, which is what makes
    // "the job this borrowed from has been deleted" distinguishable from "this borrowed from nothing".
    const source = store.tickets.get(from)
    const title = source?.title.trim() ?? ''
    if (source === undefined || source.deleted !== undefined) gone++
    else if (title === '') nameless++
    else titles.push(clipped(title, CREDIT_TITLE_MAX))
  }
  return { titles, gone, nameless, skills: skills.size }
}

/**
 * The borrowed-work sentence, bare — what `RESULT.md` writes under its own heading.
 *
 * `undefined` and not an empty string when there is nothing to say, because the alternative is a line reading
 * "（未复用其它任务）" on every ordinary report: noise that trains a person to skip the parenthesis, which is how a
 * real borrowing stops being believed too.
 *
 * Rendered as a ladder from most to least specific, and the first rung that fits {@link CREDIT_LINE_MAX} is the one
 * used. Naming a job is what makes the line worth reading, so names are given up only to the ceiling and only one at
 * a time; the bottom rung is a bare count, which needs no title and so cannot fail the ceiling.
 */
export function creditText(borrowed: BorrowedWork): string | undefined {
  const total = borrowed.titles.length + borrowed.gone + borrowed.nameless
  if (total === 0 && borrowed.skills === 0) return undefined
  const quoted = (titles: readonly string[]): string => titles.map(title => `「${title}」`).join('')
  const sources: string[] = []
  if (total === 0) {
    sources.push(`这份用上了 ${borrowed.skills} 门已沉淀的手艺`)
  } else {
    if (borrowed.titles.length === 0) {
      // Deleted, or a row the store no longer resolves: both are "that job is not there to be named". Said as a count
      // of deleted work rather than dropped, because "built on something you deleted" is a fact worth a glance.
      sources.push(borrowed.nameless === 0
        ? `这份用上了 ${borrowed.gone} 项已删除任务的成果`
        : `这份用上了 ${total} 项前序成果`)
    } else if (total === borrowed.titles.length && total <= CREDIT_NAMED_MAX) {
      sources.push(`这份用上了${quoted(borrowed.titles)}的成果`)
    } else {
      sources.push(`这份用上了${quoted(borrowed.titles.slice(0, CREDIT_NAMED_MAX))}等 ${total} 项前序成果`)
      sources.push(`这份用上了${quoted(borrowed.titles.slice(0, 1))}等 ${total} 项前序成果`)
    }
    sources.push(`这份用上了 ${total} 项前序成果`)
  }
  const skill = total === 0 || borrowed.skills === 0 ? '' : `，以及 ${borrowed.skills} 门已沉淀的手艺`
  // +2 for the full-width parentheses `creditLine` adds, so the ceiling is on the line a person receives, not on the
  // sentence inside it.
  const bodies = sources.map(form => `${form}${skill}`)
  return bodies.find(body => body.length + 2 <= CREDIT_LINE_MAX) ?? clipped(bodies[bodies.length - 1]!, CREDIT_LINE_MAX - 2)
}

/**
 * The same sentence as the line a requester receives: wrapped, and bounded by {@link CREDIT_LINE_MAX}.
 *
 * Parenthesised because it is not the answer, it is a fact about the answer, and on a phone the two have to be
 * distinguishable at a glance. No Ticket id, no directory and no tool name — the same discipline `replyText` and
 * `escalationText` already keep, and for the same reason: none of the three is anything a person on a platform can
 * act on. A title is, because a title is how the operator remembers the job.
 *
 * WHICH OUTBOUND TEXTS CARRY IT. The test is the one this file already uses for every other line it writes: is this
 * text read by a person who has no other way to know?
 * - `replyText` — yes. The requester is on a phone and has never seen the panel; this is the entire point.
 * - `resultDocument` (`RESULT.md`) — yes, in the same words unwrapped. The file is the durable copy of the answer for
 *   somebody who was not in the room, and a copy that quietly dropped where the answer came from would contradict the
 *   message rather than outlive it.
 * - `REPLY-UNDELIVERED.md` — yes, and for free: `sendGaveUp` writes `payload.text` VERBATIM so a person can send it by
 *   hand, and that text is already the reply above. Anything else would make the hand-sent copy differ from the copy
 *   the system tried to send.
 * - `relayText` / `escalationRelayText` (the front desk) — no. This reader is myagent's own main Session at this
 *   machine: the text already carries the Ticket id and the directory because the front desk CAN act on both, and the
 *   lineage is one panel click away. Repeating it here would only lengthen a notice the operator is charged a model
 *   turn to read.
 * - `escalationText` — no. There is no report and no answer to qualify; the Watchdog has given up, and the sentence
 *   that follows has to be the only thing the requester reads.
 * - `machineNotification` — no. A banner is clipped to a sentence by design and belongs to the operator at this
 *   machine, who has the panel; spending its characters on provenance would push the summary out of view.
 */
export function creditLine(borrowed: BorrowedWork): string | undefined {
  const text = creditText(borrowed)
  return text === undefined ? undefined : `（${text}）`
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
 *
 * @param credit the borrowed-work line from {@link creditLine}, when this Ticket borrowed anything. Optional and
 *   appended last: a report with no lineage is byte-for-byte what it was before this parameter existed, so the
 *   ordinary case pays nothing and reads exactly as it always did.
 */
export function replyText(ticket: Ticket, report: Report, credit?: string): string {
  // A `ready` needs no heading: the summary IS the answer. Anything else has to say what became of the work first,
  // because "needs you" and "failed" are facts the requester is waiting on and cannot infer from a summary.
  const lines = report.state === 'ready' ? [report.summary] : [headline(ticket, report.state), '', report.summary]
  const question = report.question?.trim()
  if (question !== undefined && question !== '') lines.push('', `The worker asks: ${question}`)
  if (report.files !== undefined && report.files.length > 0) {
    lines.push('', 'Files:', ...report.files.slice(0, 20).map(file => `- ${file}`))
  }
  // Last, after the files: it qualifies the whole answer rather than any one line of it, and a person skimming on a
  // phone reads the answer first.
  if (credit !== undefined && credit !== '') lines.push('', credit)
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
  /** The Watchdog has given up on a Ticket: it needs a person, and nothing happens again without one. */
  | { readonly kind: 'escalation'; readonly ticketId: string; readonly at: string; readonly why: string }

const reason = (error: unknown): string => error instanceof Error ? `${error.name}: ${error.message}` : String(error)

/** The one line a person reads first: what happened to which Ticket. */
export function headline(ticket: Ticket, state: ReportState): string {
  // `waiting` needs its own label: without one it fell through to 'dropped', which is a lie — a dropped Ticket was
  // judged to need no work, while a waiting one has work that has stopped and is waiting for a person.
  const label = state === 'ready' ? 'done'
    : state === 'blocked' ? 'needs you'
      : state === 'failed' ? 'failed'
        : state === 'waiting' ? 'stopped, needs a push'
          : 'dropped'
  return `${ticket.title} — ${label}`
}

/** The text the main Session receives: enough to act, short enough to read. */
/** Max chars of a report summary the desk relay carries; beyond this the desk can ask `myagent_ticket_status`. */
const RELAY_SUMMARY_MAX = 2000
export function relayText(ticket: Ticket, payload: Extract<NotifyPayload, { kind: 'report' }>): string {
  const summary = payload.summary.length > RELAY_SUMMARY_MAX
    ? `${payload.summary.slice(0, RELAY_SUMMARY_MAX)}… (${payload.summary.length - RELAY_SUMMARY_MAX} chars omitted; use myagent_ticket_status to read the full report)`
    : payload.summary
  const lines = [
    `Ticket ${ticket.id} (${headline(ticket, payload.state)})`,
    '',
    summary,
  ]
  if (payload.state === 'blocked' && payload.question !== undefined) {
    lines.push('', `The worker asks: ${payload.question}`, '', 'Answer with `myagent_answer_ticket`.')
  }
  // A `waiting` Ticket has no question — its turn ended with nothing to show — so what the front desk needs is not
  // the worker's words but the fact that only a push continues it. Naming the tool is what makes the notice actable;
  // without it the front desk's only move is to go and read the Ticket itself.
  if (payload.state === 'waiting') {
    lines.push('', 'Its turn ended without a report, so nothing is running and nothing will start on its own.',
      'Push it again with `myagent_retry_ticket`, or stop it with `myagent_stop_ticket` if it should not continue.')
  }
  if (payload.files !== undefined && payload.files.length > 0) {
    lines.push('', 'Files:', ...payload.files.slice(0, 20).map(file => `- ${file}`))
  }
  if (ticket.execution !== undefined) lines.push('', `Directory: ${ticket.execution.directory}`)
  return lines.join('\n')
}

/** What `RESULT.md` says, which is the Ticket's ending in full. */
/**
 * What a requester reads when the system has stopped trying on its own. No tool names and no directories: neither is
 * something a person on a platform can act on, and telling them to use one would be a false instruction (the same
 * reason `replyText` leaves both out).
 */
export function escalationText(ticket: Ticket, why: string): string {
  return [
    `${ticket.title} — needs a person`,
    '',
    `The system stopped trying on its own: ${why}`,
    '',
    'Nothing further will happen on this until someone looks at it.',
  ].join('\n')
}

/**
 * Whether an escalation about to be recorded is this Ticket's first (S2).
 *
 * A rule with a name and a test rather than an inline `.some(...)` in the runtime, because the Watchdog re-escalates
 * on every pass for as long as a Ticket stays past `maxActions`: without this, "tell the requester" would fire every
 * `everyMs` and the alarm would train the very person it is meant to reach. The history still records every one —
 * that is what answers "how many times did we give up" — and only the telling is once.
 */
export function isFirstEscalation(events: readonly { readonly type: string }[]): boolean {
  return !events.some(event => event.type === 'escalated')
}

/** What the front desk reads for the same fact. It CAN act, so it gets the tools and the directory. */
export function escalationRelayText(ticket: Ticket, why: string): string {
  return [
    `Ticket ${ticket.id} (${ticket.title}) — the Watchdog has given up: ${why}`,
    '',
    'Nothing will happen until a person acts: push it again with `myagent_retry_ticket`, stop it with',
    '`myagent_stop_ticket`, or answer it with `myagent_answer_ticket` if it is waiting on a question.',
    '',
    `Directory: ${ticket.execution?.directory ?? '(none — it never started)'}`,
  ].join('\n')
}

/**
 * What `RESULT.md` says, which is the Ticket's ending in full.
 *
 * @param credit the borrowed-work sentence from {@link creditText}, when this Ticket borrowed anything. The SAME
 *   words the requester got in the chat room, unwrapped: a person who reads the file later and a person who read the
 *   message then must not be told two different things about where the answer came from. It is a section rather than
 *   another `- Key: value` row because it is prose about the work, not metadata about the Ticket.
 */
export function resultDocument(ticket: Ticket, payload: Extract<NotifyPayload, { kind: 'report' }>, credit?: string): string {
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
  if (credit !== undefined && credit !== '') lines.push('', '## Borrowed work', '', credit)
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

  /**
   * What this Ticket borrowed, or nothing at all — including when reading that throws.
   *
   * The try is the whole reason this is a method and not a call to `borrowedFrom` at each site. This line is a
   * courtesy that explains a report, so it may not cost the report: a store that throws while being read is answered
   * with no line and a warning, never with an exception that would leave the reply unqueued and the requester
   * unanswered. That is a strictly worse outcome than an unexplained answer, and it is reachable from a database that
   * is momentarily busy — the same shape as `machineNotification`, which logs and settles because a banner is not the
   * record.
   *
   * Warned rather than silently dropped, and rather than `complain`ed: it is not a delivery problem (nothing owed to
   * anybody went missing), so writing it onto the health board would erase a real one — the S19/N5 rule this file
   * already follows for `nowhere`.
   */
  private borrowedOf(ticketId: string): BorrowedWork | undefined {
    try {
      return borrowedFrom(this.host.store, ticketId)
    } catch (error) {
      this.host.context.logger.warn('myagent could not read what Ticket %s borrowed, so its report goes out without '
        + 'that line: %s', ticketId, reason(error))
      return undefined
    }
  }

  /**
   * The Watchdog has given up on a Ticket (S2).
   *
   * Until this existed, giving up produced two things: an `escalated` event in the Ticket's history and a line on the
   * health board. Both are read by the operator at this machine, and neither reaches the person who asked in a chat
   * room — who is left waiting on work that will never move again. That is the same shape as the `waiting` silence
   * fixed in S1, and it meets both conditions for telling someone: silence makes it worse (nothing happens again
   * without a person), and there is no other observer (the requester has never seen the panel).
   *
   * Called for the FIRST escalation only; the runtime decides that, because the Watchdog re-escalates on every pass
   * once it has given up, and one fact is pushed once.
   */
  escalated(ticket: Ticket, why: string): void {
    this.host.effects.enqueue('notify', key('escalation', ticket.id, why), {
      kind: 'escalation', ticketId: ticket.id, at: new Date().toISOString(), why,
    })
    this.send(ticket, escalationText(ticket, why))
  }

  /** Queue the telling of one Report: to the requester when there is one to tell, and to the front desk. */
  report(ticket: Ticket, report: Report): void {
    const told = TOLD.includes(report.state)
    if (!told && !DESK_ONLY.includes(report.state)) return
    this.host.effects.enqueue('notify', key('notify', ticket.id, report.at, report.state), {
      kind: 'report', ticketId: ticket.id, state: report.state, summary: report.summary,
      question: report.question, files: report.files, at: report.at,
    })
    // Only a state somebody is told about goes back to whoever asked. `progress` stops at the front desk.
    if (!told) return
    // And back to whoever asked, in the same place they asked from. This Delivery already decides where a Report goes
    // — its own file header is "where a Report goes when it is worth telling someone" — and the platform a request
    // came from is one of those places. For every one-way Source this is the counted no-op below, so a deployment
    // with no chat Source pays one map lookup per Report and sends nothing.
    const files = report.state === 'ready' && report.files !== undefined && report.files.length > 0
      ? report.files
      : undefined
    // Read here rather than inside `send`, because `send` also carries the escalation and the front desk's own words
    // back to a requester, and neither of those is a report that could have borrowed anything. The cost is one query
    // over this Ticket's own event log, paid only for a state somebody is told about — a Ticket with no address
    // (`send`'s counted no-op) pays it too, and that is accepted rather than worked around: the alternative is
    // duplicating `send`'s address lookup here, which would let the two disagree about whether a reply is going out.
    const borrowed = this.borrowedOf(ticket.id)
    this.send(ticket, replyText(ticket, report, borrowed === undefined ? undefined : creditLine(borrowed)), files)
  }

  /**
   * Send a message back to wherever this Ticket's request came from (contract §3).
   *
   * Enqueued, never sent inline: the queue is what gives the words a record of their execution and their failure, what
   * makes one platform hiccup retryable instead of final, and what deduplicates a Report that is recorded twice. An
   * inline send loses the sentence the first time the network stumbles, and loses it silently.
   */
  send(ticket: Ticket, text: string, files?: readonly string[]): void {
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
    this.host.effects.enqueue('send', sendKey(ticket.id, replyTo, text), {
      ticketId: ticket.id, replyTo, text,
      ...(files === undefined || files.length === 0 ? {} : { files }),
    })
  }

  /**
   * One reply's delivery, run by the effects queue: find the Source that wrote the address and hand it over.
   *
   * A throw is left to ride — the queue counts it, backs off, and gives up with a trace. Catching it here would turn a
   * platform that is down into a reply that looks delivered, which is the one outcome worse than a retry.
   */
  /**
   * Resolve and physically verify at most `MAX_OUTBOUND_FILES` files (each <= 20 MB, regular file, not a symlink,
   * strictly inside the Ticket's own directory) before handing their paths to a two-way Source.
   */
  private async resolveOutboundFiles(payload: SendPayload): Promise<string[]> {
    if (payload.files === undefined || payload.files.length === 0) return []
    const directory = this.host.store.tickets.get(payload.ticketId)?.execution?.directory
    if (directory === undefined) return []
    const verified: string[] = []
    for (const rel of payload.files.slice(0, MAX_OUTBOUND_FILES)) {
      const absolute = await resolveRealInside(directory, rel)
      if (absolute === undefined) continue
      try {
        const info = await lstat(absolute)
        if (info.isSymbolicLink() || !info.isFile() || info.size > MAX_OUTBOUND_FILE_BYTES) continue
        verified.push(absolute)
      } catch {
        continue
      }
    }
    return verified
  }

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
    const verifiedFiles = await this.resolveOutboundFiles(payload)
    await deliver.call(source, payload.replyTo, payload.text, {
      ticketId: payload.ticketId,
      ...(verifiedFiles.length === 0 ? {} : { files: verifiedFiles }),
    })
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
      await this.host.sessions.notify(`Settings changed for Ticket ${ticket.id} (${payload.detail}).`, key('policy-notice', payload.ticketId, payload.at), payload.ticketId)
      this.summarize()
      return
    }
    if (payload.kind === 'escalation') {
      // Wakes the front desk rather than leaving a notice: this is the "nothing moves until a person acts" case, and
      // the front desk is the one place that can act without the operator.
      await this.host.sessions.relay(key('escalation-relay', payload.ticketId, payload.at), escalationRelayText(ticket, payload.why), payload.ticketId)
      if (settings.notify.enabled) {
        await this.machineNotification({
          title: ticket.title, subtitle: 'needs a person', body: payload.why,
          ...(this.host.panelPath() === '' ? {} : { url: `${this.host.panelPath()}${ticket.id}` }),
        })
      }
      this.summarize()
      return
    }
    if (ENDING.includes(payload.state) && ticket.execution !== undefined) {
      try {
        // Read again rather than carried on the payload: the notify row is durable and may be retried long after it
        // was queued, and the log is the only place this fact lives. Keeping it out of the payload also keeps the
        // dedup key (`notify`, id, at, state) and every stored row's shape exactly as they were.
        const borrowed = this.borrowedOf(ticket.id)
        const document = resultDocument(ticket, payload, borrowed === undefined ? undefined : creditText(borrowed))
        // 【G-3 站点 2】写入走宿主成员（最终到 ExecutionSandbox.writeWorkspaceFile）：文档说什么归这里，
        // 落进工作区归沙箱——VM 那天它推过边界而不是直写宿主盘。
        await this.host.writeResultFile(ticket.execution.directory, 'RESULT.md', document)
      } catch (error) { this.complain(`Could not write RESULT.md for ${ticket.id}: ${reason(error)}`) }
    }
    const text = relayText(ticket, payload)
    const requestId = key('relay', payload.ticketId, payload.at, payload.state)
    // A Ticket that waits for a person wakes the front desk; an ending only leaves a notice in its history.
    // `waiting` wakes it too, and for the same reason as `blocked`: both mean nothing moves until a person acts, and
    // the front desk is the one place that can act without the operator (retry, stop, or answer). Leaving `waiting`
    // on the notify path filed it in a history nobody reads while the Ticket sat stalled.
    //
    // 【F1】`ready`/`failed`/`dropped` now also wake the front desk (relay) instead of only leaving a notice:
    // the desk is the one place that can decide whether to escalate a failure, add context to a result, or
    // send a summary to the requester — and it can only decide in a turn, not by accumulating injected history.
    // `progress` is the only state that stays on the inject path: one progress line per turn is not a decision point.
    // 【R2 F-D5 防回声】纯分诊单（所有 Assignment 都是 triage role）由总管自己结案，
    // ready/dropped 结案时不应反向 relay 唤醒总管再跑一轮「确认回执」（活体 seq=166→171 白烧 ~100s）。
    // 普通 worker 票的终态仍保持 F1 唤醒总管。
    const selfClosedTriage = ticket.assignments.length > 0
      && ticket.assignments.every(a => a.role === 'triage')
      && (payload.state === 'ready' || payload.state === 'dropped')
    const wakesDesk = !selfClosedTriage && (
      payload.state === 'blocked' || payload.state === 'waiting'
      || payload.state === 'ready' || payload.state === 'failed' || payload.state === 'dropped'
    )
    if (wakesDesk) await this.host.sessions.relay(requestId, text, payload.ticketId)
    else await this.host.sessions.notify(text, requestId, payload.ticketId)
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
