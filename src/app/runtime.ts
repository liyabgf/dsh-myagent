/**
 * The Runtime: one deployment of myagent, wired together.
 *
 * Everything else in this package is a part with a narrow port; this file is the only place that knows all of them. It
 * owns the order things are made in — the Store before the Engine, the Engine before the Sources — and the order they
 * stop in, which is the reverse. It also owns the two rules that keep a restart honest: one writer per state directory,
 * and an Assignment whose worker Session is gone is interrupted rather than left looking alive.
 */
import { readdirSync, readFileSync } from 'node:fs'
import type { Dirent } from 'node:fs'
import { lstat, readdir, readFile, rm } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import {
  Engine, key, latestAssignment, lostTriggerOf, parseSettings, payloadText, policyVersion, runningAssignment,
  settingsPolicy, UserError, waitsForPerson, type DomainEvent, type Settings, type Ticket,
  canCollaborate,
} from '../core/index.ts'
import { machineOf, type DeploymentConfig, type Machine } from '../deployment.ts'
import { chatKind } from '../sources/chat.ts'
import { RESEARCHER_PRESET, WORKER_PRESET } from './sessions.ts'
import { cronKind } from '../sources/cron.ts'
import { frontMatter } from '../sources/inbox.ts'
import { inboxKind } from '../sources/inbox.ts'
import { sessionKind } from '../sources/session.ts'
import type { SourceStatus } from '../sources/kind.ts'
import type { Artifact, ReplyTo, Trigger } from '../core/model.ts'
import { SourceRegistry } from '../sources/registry.ts'
import type { Cursor, SourceHost } from '../sources/kind.ts'
import { DshExecutor, type LaunchPayload } from './executor.ts'
import { isFirstEscalation, OutcomeDelivery, type SendPayload } from './delivery.ts'
import { Effects } from './effects.ts'
import { HealthBoard } from './health.ts'
import { KV, SchemaTooNew, Store } from './store.ts'
import { LockHeld, takeLock, writeMarker, type StateLock } from './lock.ts'
import { Passes } from './passes.ts'
import { impostorDetail, impostorSubject, MAIN_SESSION, SessionHealth } from './session-health.ts'
import { Watchdog, type WatchdogHost } from './watchdog.ts'
import { ruleKind } from '../sources/rule.ts'
import { packageFile, Prompts, type PromptRole } from './prompts.ts'
import { Sessions, ticketOfSession, workerSessionId, workerSessionOf, type MainState } from './sessions.ts'
import { mainTools, workerTools, type ArtifactCatalogEntry, type ArtifactRead, type Tool, type ToolsHost } from './tools.ts'
import { listFiles, isTextFile, readForPanel, resolveInside, resolveRealInside } from './files.ts'
import { ticketSummary } from './views.ts'
import { BASE_PATH, registerHttp, type HttpHost } from './http.ts'

/** How often the pump runs what is due, in milliseconds. */
/**
 * The most artifact bytes a worker may be handed.
 *
 * Far below the panel's 16MB ceiling on purpose: a download and a model's context are different budgets, and handing
 * a worker a huge file it did not ask for is a way to lose the rest of its context.
 */
const WORKER_ARTIFACT_BYTES = 256 * 1024
/**
 * What one `materialize: true` may copy into a workspace, and what one catalog answer may contain.
 *
 * Both exist because the alternative is a number nobody chose: a registered artifact is any file a report named, and
 * nothing measures it at registration time (`engine.artifactPath` normalizes the path and says so), so without a cap one
 * worker can fill the disk through another worker's output — and the copy used to land BEFORE the size was known, which
 * meant a 400 MB artifact produced a 400 MB file and then an error saying the read failed. The catalog caps are for the
 * same reason in the other direction: its answer goes straight into a model's context, so an unbounded one is either a
 * wall of noise the worker picks wrongly from (and the operator pays for as a worse report and a re-ask) or a truncation
 * nobody can see. Newest first, because `store.tickets.list()` is `ORDER BY createdAt` and the least useful slice of a
 * long-lived deployment is its oldest Tickets.
 */
const WORKER_MATERIALIZE_BYTES = 64 * 1024 * 1024
/**
 * Total bytes one Ticket's `inputs/` may hold. The per-file cap alone let 50 Tickets × 60 MB accumulate into a
 * 3 GB workspace nobody budgeted for — every single copy legal, the sum not. Measured before the copy, so a
 * refusal leaves no orphan; the worker is told how much is already there and what the ceiling is.
 */
const WORKER_INPUTS_TOTAL_BYTES = 512 * 1024 * 1024

/** Recursive byte size of a directory that is about to be added to; absent directories answer 0. */
async function directoryBytes(root: string): Promise<number> {
  const entries: readonly Dirent[] = await readdir(root, { withFileTypes: true })
    .then(list => list, () => [] as Dirent[])
  let total = 0
  for (const entry of entries) {
    const info = await lstat(join(root, entry.name)).catch(() => undefined)
    if (info === undefined) continue
    total += info.isDirectory() ? await directoryBytes(join(root, entry.name)) : info.size
  }
  return total
}
const CATALOG_TICKETS = 50
const CATALOG_ARTIFACTS = 20
const CATALOG_SUMMARY_CHARS = 160
const CATALOG_BYTES = 32 * 1024
/** A promoted script's ceiling: a skill is a reusable craft, not an archive of one run's data. */
const SKILL_SCRIPT_BYTES = 64 * 1024

const PASS_INTERVAL_MS = 2_000
/**
 * How long a worker gets to wrap up after being told its runtime budget is up.
 *
 * Long enough to write a report and register it — the whole point of the nudge is that a partial, honest report beats
 * a killed process — and short enough that "the budget" still means something. Ten minutes against a 60-minute
 * budget is a wrap-up, not a second shift.
 */
const BUDGET_GRACE_MS = 10 * 60_000
/** The panel page, as this installation ships it. */
const PANEL_FILE = 'panel/index.html'

const reason = (error: unknown): string => error instanceof Error ? `${error.name}: ${error.message}` : String(error)

/** The last thing a worker said, which is what a turn that ended without a report is recorded as. */
function lastSaid(agent: Agent): string | undefined {
  const events = agent.session.snapshotEvents()
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event === undefined || event.type !== 'assistant/message') continue
    const content = (event.data as { message?: { content?: readonly { type: string; text?: string }[] } }).message?.content ?? []
    const text = content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n').trim()
    if (text !== '') return text
  }
  return undefined
}

/**
 * How DSH ended this agent's last turn, with the reason's own facts.
 *
 * `blocked` means the turn never reached the model at all — the Session cannot run, which is a different fact from a
 * worker that did its work and forgot to report. Telling them apart is what stops a retry loop that looks like
 * progress: each attempt delivers, the turn ends at once, and nothing is ever produced.
 *
 * `error` means the turn failed, and DSH keeps the failure in the same event: an `LlmError` contributes its own
 * serializable facts (`{message, code, status}`), anything else a flattened `errorChain` message. Reading it here is
 * what puts the cause of an upstream 429 on the Ticket instead of leaving it on a health line that answers "now" and
 * is legitimately overwritten by the next observation.
 */
interface TurnEndReason {
  readonly kind?: string
  readonly error?: { readonly message?: string; readonly code?: string; readonly status?: number }
}

function turnEndReason(agent: Agent): TurnEndReason | undefined {
  const events = agent.session.snapshotEvents()
  for (let index = events.length - 1; index >= 0; index--) {
    const event = events[index]
    if (event === undefined || event.type !== 'turn/end') continue
    // The event's own shape is `{turn, reason}`; `reason` is what says how the turn ended.
    return (event.data as { reason?: TurnEndReason } | undefined)?.reason
  }
  return undefined
}

/** What the operator reads when a worker's Session turns out to be one DSH will not run. */
const UNRUNNABLE_SESSION = 'The worker Session could not run: DSH ended its turn as blocked before any model request, '
  + 'so nothing was produced. Retrying reuses this same Session and ends the same way. Stop this Ticket and open a new '
  + 'one for the work; its directory is left exactly as it was, so a new Ticket can continue from whatever is in it.'

/** What a worker is doing right now, which is the only thing that makes watching a long task bearable. */
export interface WorkerProgress {
  readonly sessionId: string
  /** The title DSH gave the worker's Session, which is what the operator looks for in the GUI's session list. */
  readonly sessionTitle: string
  readonly loaded: boolean
  readonly agentStatus?: string
  /**
   * The number of the turn in progress, read from the most recent `turn/start` WITHIN the last {@link PROGRESS_SCAN}
   * events — so it is absent, not zero, once a single long turn has produced more events than that.
   *
   * That is not a theoretical edge: in the round-50 production run both workers showed `turn: 1` early and no `turn` at
   * all fifty minutes later, after a hundred-odd tool calls in one turn had pushed the `turn/start` out of the window.
   * The field was recorded as "semantics unclear" (F9); it was in fact a windowed reading that disappears exactly when
   * a long task makes it most interesting. Absent therefore means "not in the window", never "no turn has started" —
   * a reader that needs the latter must look at `agentStatus`.
   */
  readonly turn?: number
  readonly lastSaid?: string
  readonly lastEventAt?: string
  readonly recentTools: readonly { readonly name: string; readonly at?: string }[]
  /**
   * Real token counts, summed from the worker's own `assistant/message` events.
   *
   * `windowed` says whether the sum covers the whole Session: the progress view reads only the newest
   * `PROGRESS_SCAN` events, so on a long task this is the cost of that window and not the cost of the work. Presenting
   * a window as a total is how a budget number becomes a lie, and the operator asked specifically that token counts
   * not be invented — so the number is either DSH's or nothing, and it says which slice of the Session it covers.
   */
  readonly usage?: {
    readonly inputTokens: number
    readonly outputTokens: number
    readonly cacheReadTokens: number
    readonly totalTokens: number
    /** How many assistant messages the sum is over. */
    readonly messages: number
    readonly windowed: boolean
  }
  readonly assignment?: {
    readonly id: string; readonly state: string; readonly startedAt?: string
    readonly deliveredAt?: string; readonly deliveryError?: string
  }
}

/**
 * Sum the token counts DSH reports on each assistant message.
 *
 * Every field comes from the event; nothing here estimates, scales or guesses. `totalTokens` is the sum of the three
 * DSH reports (input + output + cache read), which is how DSH itself relates them — recomputing it rather than copying
 * its `totalTokens` keeps the three parts and the total consistent when a message reports only some of them.
 */
export function usageOf(scanned: readonly { type?: string; data?: unknown }[], total: number): WorkerProgress['usage'] {
  let inputTokens = 0
  let outputTokens = 0
  let cacheReadTokens = 0
  let messages = 0
  for (const event of scanned) {
    if (event.type !== 'assistant/message') continue
    const usage = (event.data as { usage?: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number } } | undefined)?.usage
    if (usage === undefined) continue
    messages++
    inputTokens += usage.inputTokens ?? 0
    outputTokens += usage.outputTokens ?? 0
    cacheReadTokens += usage.cacheReadTokens ?? 0
  }
  if (messages === 0) return undefined
  return {
    inputTokens, outputTokens, cacheReadTokens, messages,
    totalTokens: inputTokens + outputTokens + cacheReadTokens,
    windowed: total > scanned.length,
  }
}

/** How far back the progress view reads; a long task has thousands of events and the panel asks every few seconds. */
const PROGRESS_SCAN = 400
/** How many recent tool calls the progress view shows. */
const PROGRESS_TOOLS = 8

/** Read a worker's recent activity out of its own Session log, newest first. */
function progressOf(agent: Agent | undefined): Pick<WorkerProgress, 'turn' | 'lastSaid' | 'lastEventAt' | 'recentTools' | 'usage'> {
  if (agent === undefined) return { recentTools: [] }
  const events = agent.session.snapshotEvents()
  const recentTools: { name: string; at?: string }[] = []
  let turn: number | undefined
  let lastSaid: string | undefined
  let lastEventAt: string | undefined
  for (let index = events.length - 1; index >= 0 && index >= events.length - PROGRESS_SCAN; index--) {
    const event = events[index]
    if (event === undefined) continue
    const data = event.data as Record<string, unknown> | undefined
    const at = typeof (event as { time?: unknown }).time === 'number'
      ? new Date((event as { time: number }).time).toISOString() : undefined
    lastEventAt ??= at
    if (event.type === 'tool/call' && recentTools.length < PROGRESS_TOOLS) {
      const name = data?.name
      if (typeof name === 'string') recentTools.push({ name, at })
      continue
    }
    if (event.type === 'turn/start' && turn === undefined) {
      const value = data?.turn
      if (typeof value === 'number') turn = value
      continue
    }
    if (event.type === 'assistant/message' && lastSaid === undefined) {
      lastSaid = lastSaid === undefined ? saidText(data) : lastSaid
    }
    if (turn !== undefined && lastSaid !== undefined && recentTools.length >= PROGRESS_TOOLS) break
  }
  return { turn, lastSaid, lastEventAt, recentTools, usage: usageOf(events, agent.session.snapshotEvents().length) }
}

/** The text of one assistant message event, or undefined when it said nothing a person can read. */
function saidText(data: Record<string, unknown> | undefined): string | undefined {
  const content = (data?.message as { content?: readonly { type: string; text?: string }[] } | undefined)?.content ?? []
  const text = content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n').trim()
  return text === '' ? undefined : text
}

/** One shipped recipe: a request file a person can start from, or a settings file whose schedule they can adopt. */
export interface Recipe {
  readonly name: string
  readonly kind: 'request' | 'settings'
  readonly title?: string
  readonly text?: string
  readonly scope?: string
  readonly schedule?: Record<string, unknown>
}

export class Runtime implements HttpHost {
  readonly machine: Machine
  readonly health = new HealthBoard()
  readonly context: Context
  /** Aborted when this Runtime stops, so nothing new starts and every wait ends. */
  readonly lifetime: AbortSignal
  readonly store: Store
  readonly prompts: Prompts
  readonly effects: Effects
  readonly passes: Passes
  readonly sessions: Sessions
  readonly executor: DshExecutor
  readonly delivery: OutcomeDelivery
  readonly engine: Engine
  readonly sources: SourceRegistry
  private readonly watchdog: Watchdog
  private readonly listeners = new Set<(event: DomainEvent) => void>()
  readonly subprocess: SubprocessRuntime

  private readonly lock: StateLock
  private readonly abort = new AbortController()
  private readonly disposers: (() => void)[] = []
  private settingsValue: Settings
  private settingsRevisionValue: number
  private panel: MainState = { acceptMode: 'observe', panelPath: `${BASE_PATH}/`, openTickets: 0, waiting: 0 }
  /** Session id to Ticket id, from the bindings DSH answered with; a worker's id is a fact, not a prefix. */
  private readonly sessionIndex = new Map<string, string>()
  /**
   * The `sessions` health entry, accounted per subject rather than written by whoever complained last.
   *
   * Every write to that entry goes through this, which is what makes its quiet line a claim it can keep: a problem it
   * knows is live is composed into the detail instead of being overwritten, and one Ticket's recovery cannot erase
   * another Ticket's failure.
   */
  private readonly sessionHealth = new SessionHealth(this.health.entry('sessions'), () => this.store.tickets.open().length)
  /** The error `agent/error` saw for one Session, which the turn end that follows it writes onto that Ticket. */
  private readonly sessionErrors = new Map<string, string>()
  private stopped = false
  private problem?: string

  constructor(context: Context, config: DeploymentConfig) {
    this.context = context
    this.subprocess = context.subprocess
    this.lifetime = this.abort.signal
    this.machine = machineOf(config)
    this.lock = takeLock(this.machine.stateDir)
    // Spelled out rather than spread: `machine.promptMaxChars` is a Volatile, and spreading it wrote `"promptMaxChars": {}`
    // into the one file whose job is to tell a person where this deployment keeps its things.
    writeMarker(this.machine.stateDir, {
      pid: process.pid, stateDir: this.machine.stateDir, workRoot: this.machine.workRoot,
      inboxDir: this.machine.inboxDir, mainSessionId: this.machine.mainSessionId,
      promptMaxChars: this.machine.promptMaxChars.get(), at: new Date().toISOString(),
    })
    try {
      this.store = new Store(join(this.machine.stateDir, 'myagent.sqlite3'))
    } catch (error) {
      this.lock.release()
      if (error instanceof SchemaTooNew) {
        throw new Error(`This state directory was written by a newer myagent (schema ${error.found}); refusing to open it`)
      }
      throw error
    }
    this.settingsValue = this.store.settings()
    this.settingsRevisionValue = this.store.settingsRevision()
    this.prompts = new Prompts(this.store)

    // The Engine's ports need it, and it needs them; the getters break the cycle and are read only after this
    // constructor returns, when every one of them is assigned.
    let engine!: Engine
    let sessions!: Sessions
    this.effects = new Effects(this.store, {
      health: this.health.entry('effects'), lifetime: this.lifetime,
      onPermanentFailure: (kind, key, payload, error) => {
        this.health.entry('effects').problem(`${kind} ${key} gave up: ${reason(error)}`)
        // Work that will not start, or an answer that will not arrive, is the Ticket's business and not only the
        // board's. The line above answers "how are things now" and is genuinely transient: the queue ends every pass
        // by recording a summary over it, unless that pass complained or a row it complained about is still queued —
        // and a give-up settles its row, so the next pass with nothing wrong erases this line, as a restart erases the
        // board outright. That is why every kind writes a durable trace of its own below, and why none of them may
        // treat this line as even the transient half of one: `launch` and `input` a failed Report on the Ticket, `send`
        // `reply_lost` plus REPLY-UNDELIVERED.md, `notify` `notice_lost`, `trigger` a `lost` row in `triggers`.
        if (kind === 'launch' || kind === 'input') this.executor.gaveUp(kind, payload as LaunchPayload, error)
        // Somebody asked in a room myagent is now silent in, so the owed words go where that Ticket's own record is.
        if (kind === 'send') this.delivery.sendGaveUp(payload as SendPayload, error)
        // A notice that will never arrive. Called on the Engine directly rather than through a Delivery port member:
        // the Runtime is the composition root and already holds the Engine, whereas the narrow `replyLost` port exists
        // precisely because a Delivery holding the Engine could write any domain state.
        if (kind === 'notify') {
          const notice = payload as { ticketId?: string; kind?: string; state?: string; summary?: string; detail?: string }
          if (notice.ticketId !== undefined) {
            try {
              this.engine.noticeLost(notice.ticketId, {
                ...(notice.kind === undefined ? {} : { notice: notice.kind }),
                ...(notice.state === undefined ? {} : { state: notice.state }),
                error: reason(error),
                // What was going to be said, so a person can say it by hand — the same reasoning as the
                // REPLY-UNDELIVERED.md file: a lost message is only actionable if its content survived.
                // Spelled out rather than as a `?? … === undefined` chain: `??` binds LOOSER than `===`, so that
                // spelling parses as `summary ?? (detail === undefined)` and silently does the wrong thing for a
                // policy notice, which has `detail` and no `summary` — the words it was going to deliver were dropped,
                // measured end to end by the fault-injection run. A report notice happened to work, which is why no
                // test caught it: the accident and the intent agreed on the only case that was covered.
                ...(notice.summary === undefined && notice.detail === undefined
                  ? {}
                  : { text: String(notice.summary ?? notice.detail).slice(0, 400) }),
              })
            } catch {
              // The Ticket may be gone; losing the trace of a lost notice must not also lose the pass.
            }
          }
        }
        // A request the queue dropped. Until this branch it left nothing at all behind: no Trigger row, no Decision, no
        // Ticket, the effect row deleted, and after a restart not one byte on disk about work a rule had asked for.
        if (kind === 'trigger') {
          try {
            const detail = { error: reason(error), effectKey: key }
            const lost = lostTriggerOf(payload, detail)
            // Two paths, because what can honestly be said depends on what the payload still carries. One that names
            // its request is stored as one, under its own identity, in the table whose semantics are "every request,
            // and what became of it" — the real case, since a permanent failure here is `receive` throwing over a
            // payload that reads fine. One that does not name it cannot fill the columns that table declares NOT NULL,
            // and inventing them would put a Source named "lost" into the intake counts on the page whose job is
            // answering where work comes from, so its text is kept instead, bounded, where it says nothing else.
            if (lost === undefined || !this.engine.triggerLost(lost)) {
              this.store.pushLostPayload({ at: new Date().toISOString(), payload: payloadText(payload), ...detail })
            }
          } catch {
            // The other real cause of a permanent `trigger` failure is the Store itself failing, and then this write
            // fails too — `kv` is in the same file as `triggers`, so no fallback could have done better. Losing the
            // trace must not also lose the pass: the queue guards this hook (effects.ts:188-189), but it reports an
            // escaped throw as a hook failure, and a second line saying the hook broke is not the fact worth reading.
          }
        }
      },
    })
    this.executor = new DshExecutor({
      context, store: this.store, effects: this.effects, health: this.health, lifetime: this.lifetime,
      subprocess: this.subprocess,
      get engine(): Engine { return engine },
      get sessions(): Sessions { return sessions },
      settings: () => this.settings(),
      workRoot: () => this.machine.workRoot,
      closing: () => this.stopped,
    })
    sessions = this.sessions = new Sessions({
      context, prompts: this.prompts, lifetime: this.lifetime,
      masterId: (): string => this.store.get<string>(KV.mainSession) ?? this.machine.mainSessionId,
      masterDir: (): string => this.machine.workRoot,
      bindMainSession: (sessionId: string): void => { this.store.set(KV.mainSession, sessionId) },
      ticket: (ticketId: string): Ticket | undefined => this.store.tickets.get(ticketId),
      ticketIdOfSession: (sessionId: string): string | undefined => this.ticketIdOfSession(sessionId),
      bindSession: (ticketId: string, sessionId: string): void => {
        this.sessionIndex.set(sessionId, ticketId)
        this.engine.bindSession(ticketId, sessionId)
      },
      ticketEnded: (ticketId: string): boolean => {
        const ticket = this.store.tickets.get(ticketId)
        return ticket === undefined || ticket.ended !== undefined
      },
      // A Session named after a Ticket that does not exist, which `Sessions` decorated with nothing: the refusal goes
      // on the board the operator reads, and not only into the log. Accounted under the impostor's OWN subject — not a
      // Ticket's, because there is no Ticket, and not `MAIN_SESSION`'s, because the front desk's own problem and its
      // recovery are another subject's business — so neither an unrelated Ticket's ending nor a successful
      // `createMainSession` can erase it, and two impostors cannot erase each other. Retired below, by `agent/disposed`.
      skillLoaded: (ticketId: string, skillName: string): void => {
        const used = this.prompts.recordSkillUse(skillName)
        if (used?.fromTicketId !== undefined && used.fromTicketId !== ticketId) {
          this.engine.skillUsed(ticketId, used.fromTicketId, skillName)
        }
      },
      impostorRefused: (sessionId: string, claimedTicketId: string): void => {
        this.sessionHealth.problem(impostorSubject(sessionId), impostorDetail(sessionId, claimedTicketId))
      },
      environment: (ticket: Ticket): Record<string, string> => this.executor.environment(ticket),
      presetFor: (ticket: Ticket): string => this.presetFor(ticket),
      tools: (agent: Agent, ticket?: Ticket): Tool[] => {
        const host = this.toolsHost()
        if (ticket === undefined) return mainTools(host)
        // A triage attempt decides what a request becomes, so it gets the front desk's management tools — it has to be
        // able to open Tickets — plus the ONE worker tool a decision is expressed with: the report. Taking only that
        // one avoids registering `myagent_note_ticket` twice (both sets define it), and leaving out
        // `myagent_read_artifact` says what is true: a desk that starts reading another Ticket's output is doing work.
        if (ticket.assignments.at(-1)?.role === 'triage') {
          return [...mainTools(host), ...workerTools(host, ticket).filter(tool => tool.name === 'myagent_report')]
        }
        return workerTools(host, ticket)
      },
      mainState: (): MainState => this.panel,
      closing: () => this.stopped,
    })
    this.delivery = new OutcomeDelivery({
      context, store: this.store, effects: this.effects, sessions: this.sessions, health: this.health,
      lifetime: this.lifetime, subprocess: this.subprocess, settings: () => this.settings(),
      // A reply is dispatched by the kind its address names, so the Delivery asks the registry for that kind's one
      // running instance rather than holding a reference of its own: the registry replaces an instance when its
      // settings change, and a stale reference would deliver to a Source that has already been stopped.
      source: kind => this.sources.source(kind),
      // Handed one writer rather than the Engine: a Delivery that could reach the Engine could write any domain state,
      // and a lost reply is the only fact about a Ticket's life it has to add. Read at call time, because the Engine is
      // constructed after the Delivery that needs it.
      replyLost: (ticketId, detail) => { this.engine.replyLost(ticketId, detail) },
      panelPath: (): string => this.panelPath(),
    })
    this.engine = engine = new Engine({
      repos: this.store, tx: this.store,
      policy: () => settingsPolicy(this.settings()),
      executor: this.executor, delivery: this.delivery,
      emit: (event: DomainEvent): void => this.onEvent(event),
    })
    // The one effect that turns an event into a request. A rule Source enqueues a Trigger instead of calling `receive`
    // inline, because its callback runs inside the transaction that ended the upstream Ticket; handling it here keeps
    // the Engine the only writer and gives the request the queue's durability, deduplication and backoff for free.
    this.effects.handle('trigger', payload => { this.engine.receive(payload as Trigger) })
    this.passes = new Passes({
      effects: this.effects, intervalMs: PASS_INTERVAL_MS, health: this.health.entry('passes'),
      lifetime: this.lifetime,
      extra: [async (): Promise<void> => this.refresh(), async (): Promise<void> => this.enforceRuntimeBudgets()],
      onPassError: (error: unknown): void => { context.logger.warn('a myagent pass failed: %s', reason(error)) },
    })
    this.sources = new SourceRegistry(this.sourceHost(), [cronKind, inboxKind(this.machine.inboxDir), sessionKind, ruleKind, chatKind])
    this.watchdog = new Watchdog(this.watchdogHost())
    this.disposers.push(registerHttp(this))
  }

  // ------------------------------------------------------------------- Ports

  /** The Engine and Store the tools read and command. */
  private toolsHost(): ToolsHost {
    return {
      engine: this.engine, store: this.store, acceptMode: () => this.settings().acceptMode,
      // Answered by the Sessions, which is the only place that knows: the attempt is recorded when a launch prompts
      // the worker, and a worker's Session outlives the attempt its tools were registered for.
      attempt: (ticketId: string) => this.sessions.attempt(ticketId),
      readArtifact: (source, target, path, materialize) => this.readArtifact(source, target, path, materialize),
      returnAddressOf: (ticketId: string) => this.returnAddressOf(ticketId),
      replyToRequester: (ticketId: string, text: string) => this.replyToRequester(ticketId, text),
      promoteSkill: (ticketId, input) => this.promoteSkill(ticketId, input),
      raiseDecision: (title, detail, source) => this.raiseDecision(title, detail, source),
    }
  }

  /**
   * Where a Ticket's reports go: the address on its Trigger, which is the only place an address is ever written down
   * (contract §3.3 — never inferred from the actor, because an id says who asked and not where to answer).
   */
  private returnAddressOf(ticketId: string): ReplyTo | undefined {
    const ticket = this.store.tickets.get(ticketId)
    if (ticket === undefined) return undefined
    return this.store.triggers.get(ticket.origin.triggerId)?.trigger.replyTo
  }

  /**
   * Write back to whoever asked for a Ticket (S3a).
   *
   * The address is resolved here and never taken from the caller: the front desk names a Ticket, this looks up where
   * its request came from. A tool that let it type an address would let a prompt-injected front desk post to any
   * channel it could name.
   *
   * Recorded on the Ticket as well as sent, because "we wrote to them" is a fact about this Ticket's life: without the
   * event, an operator reading the history cannot tell whether the requester was ever told anything.
   */
  private replyToRequester(ticketId: string, text: string): { sent: boolean; address?: string; reason?: string } {
    const ticket = this.store.tickets.get(ticketId)
    if (ticket === undefined) return { sent: false, reason: `There is no Ticket ${ticketId}.` }
    const replyTo = this.returnAddressOf(ticketId)
    if (replyTo === undefined) {
      // Said plainly, with the reason: "nowhere to send it" is the shape of every panel, inbox and schedule Ticket,
      // and a front desk that only learned `false` would try something else or, worse, say it had replied.
      return {
        sent: false,
        reason: `Ticket ${ticketId.slice(0, 8)} has nowhere to write back to — its Trigger carries no reply address, `
          + 'which is the shape of a request that came from the panel, the inbox or a schedule. Tell the operator here instead.',
      }
    }
    const address = `${replyTo.kind}/${replyTo.channel}${replyTo.thread === undefined ? '' : ` (thread ${replyTo.thread})`}`
    this.delivery.send(ticket, text)
    this.engine.replied(ticketId, { address, chars: text.length })
    return { sent: true, address }
  }

  /**
   * Delete a Ticket, and — when asked — the files it produced (S4).
   *
   * The order is the point. Validation happens first and has no side effects, so a refusal arrives BEFORE anything is
   * removed; the Engine then records the tombstone; only then is a byte touched. The opposite order would fail the
   * worse way: files gone and no record of why. This way the worst outcome is a tombstone that claims a deletion
   * which did not happen — recoverable, visible, and nothing lost.
   *
   * The measurement happens before the removal for the same reason the tombstone carries numbers at all: once the
   * directory is gone, "17 files, 2.4 MB" exists nowhere else.
   */
  async deleteTicket(id: string, options: { assets: 'keep' | 'delete'; record: 'tombstone' | 'nothing' }): Promise<{
    deleted: string; assets: 'keep' | 'delete'; record: 'tombstone' | 'nothing'
    directory?: string; files?: number; bytes?: number
  }> {
    const ticket = this.engine.assertDeletable(id)
    const directory = ticket.execution?.directory
    const removing = options.assets === 'delete' && directory !== undefined
    let files: number | undefined
    let bytes: number | undefined
    if (removing) {
      // A directory that cannot be listed is not a reason to refuse the deletion of the RECORD, so the numbers are
      // simply left off and the removal is still attempted.
      const listing = await listFiles(directory!).catch(() => undefined)
      if (listing !== undefined) {
        files = listing.count
        bytes = listing.files.filter(file => !file.directory).reduce((sum, file) => sum + file.size, 0)
      }
    }
    const result = this.engine.deleteTicket(id, {
      ...options, ...(files === undefined ? {} : { files }), ...(bytes === undefined ? {} : { bytes }),
    })
    if (removing) await this.removeAssets(directory!, id)
    return { ...result, ...(files === undefined ? {} : { files }), ...(bytes === undefined ? {} : { bytes }) }
  }

  /**
   * Remove a Ticket's own directory, and only ever inside the work root.
   *
   * `rm -r` unlinks a symlink rather than following it, so a link inside the directory cannot escape; the guard here is
   * for the other direction — a stored path that is not ours must not be removed on the strength of being stored.
   * A failure goes to the health board rather than to the Ticket, because with `record: 'nothing'` there is no row
   * left to carry an event, and "we said we deleted it and could not" must still be visible somewhere.
   */
  private async removeAssets(directory: string, ticketId: string): Promise<void> {
    const root = resolve(this.machine.workRoot)
    const target = resolve(directory)
    if (target === root || !target.startsWith(root + sep)) {
      this.health.entry('panel').problem(`refused to delete Ticket ${ticketId.slice(0, 8)}'s assets: ${directory} is not inside the work root`)
      return
    }
    try {
      await rm(target, { recursive: true, force: true })
    } catch (error) {
      this.health.entry('panel').problem(
        `could not delete Ticket ${ticketId.slice(0, 8)}'s assets at ${directory}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /** Attempts that are running but whose Session has produced no event for at least `olderThanMs`. */
  private silentAttempts(olderThanMs: number, now: number): { ticketId: string; assignmentId: string; silentForMs: number }[] {
    const silent: { ticketId: string; assignmentId: string; silentForMs: number }[] = []
    for (const ticket of this.store.tickets.open()) {
      const assignment = latestAssignment(ticket)
      if (assignment === undefined || assignment.state !== 'running') continue
      const progress = this.progress(ticket.id)
      // With no events yet the attempt has been silent since it started, which is the honest reading rather than zero.
      const lastAt = progress.lastEventAt ?? assignment.startedAt ?? assignment.createdAt
      const silentForMs = now - Date.parse(lastAt)
      if (silentForMs >= olderThanMs) silent.push({ ticketId: ticket.id, assignmentId: assignment.id, silentForMs })
    }
    return silent
  }

  /**
   * When this Runtime mounted, so "which mount am I talking to?" has an answer instead of an inference.
   *
   * Three rounds were spent establishing exactly that by correlating a marker file's timestamp against source mtimes,
   * because nothing in the API said when the plugin came up. Cheap to expose, and it is the first thing to look at when
   * the panel and the API disagree about what exists.
   */
  private readonly mountedAtIso: string = new Date().toISOString()

  /** When this Runtime mounted. A method because the Runtime *is* the HttpHost, and the port declares one. */
  mountedAt(): string { return this.mountedAtIso }

  /**
   * The interval the Watchdog's running timer is actually on.
   *
   * A diagnostic read, not test scaffolding: without it, "did my `everyMs` change take effect?" can only be answered by
   * inference, and the acceptance run that found N2 unfixed had to do exactly that — matching a rescue's timestamp to
   * `mountedAt + 7×60s` within 23ms to prove the timer was still on the old grid.
   */
  watchdogArmedInterval(): number { return this.watchdog.armedInterval() }

  /**
   * Validate and promote a worker's battle-tested script into a virtual DSH skill stored in `Prompts` (E2).
   * Hard quality gates:
   * 1. Must resolve inside the Ticket's own directory via `resolveRealInside` (no symlinks, no `..`).
   * 2. Must be a non-empty text file <= 64 KB.
   * 3. Must NOT hardcode the Ticket's private directory path or `workRoot` path.
   */
  async promoteSkill(ticketId: string, input: {
    name: string; title: string; description: string; script_path: string; usage?: string
  }): Promise<{ ok: boolean; skill_name?: string; error?: string }> {
    const ticket = this.store.tickets.get(ticketId)
    const ownDir = ticket?.execution?.directory
    if (ticket === undefined || ownDir === undefined) {
      return { ok: false, error: `Ticket ${ticketId} has no workspace directory.` }
    }
    const absolute = await resolveRealInside(ownDir, input.script_path)
    if (absolute === undefined) {
      return { ok: false, error: `Script path ${input.script_path} is outside this Ticket's directory or is a symbolic link.` }
    }
    try {
      // Measured before reading: a worker can point `script_path` at anything in its own directory, including the
      // gigabyte of HTML a polite batch fetch just produced, and reading it to discover it is too big would spend that
      // memory in the host process every other Ticket lives in.
      const info = await lstat(absolute)
      if (info.isDirectory()) return { ok: false, error: `Script ${input.script_path} is a directory, not a file.` }
      if (info.size === 0) return { ok: false, error: `Script ${input.script_path} is empty.` }
      if (info.size > SKILL_SCRIPT_BYTES) return { ok: false, error: `Script ${input.script_path} is ${info.size} bytes, over the ${SKILL_SCRIPT_BYTES} skill limit.` }
      const code = await readFile(absolute, 'utf8')
      const dirName = ticket.execution!.name
      if (code.includes(ownDir) || (dirName.length >= 6 && code.includes(dirName))) {
        return {
          ok: false,
          error: `Script ${input.script_path} hardcodes this Ticket's private directory (${dirName}); parameterize input/output paths via CLI arguments before promoting.`,
        }
      }
      const ext = input.script_path.split('.').pop()?.toLowerCase() ?? 'py'
      const lang = ext === 'py' ? 'python' : ext === 'mjs' || ext === 'js' ? 'javascript' : ext === 'sh' ? 'bash' : ''
      const usageBlock = input.usage?.trim() ? `\n## Usage\n\n\`\`\`bash\n${input.usage.trim()}\n\`\`\`\n` : ''
      const content = `# ${input.title.trim()}\n\n${input.description.trim()}\n${usageBlock}\n## Program (${input.script_path})\n\n\`\`\`${lang}\n${code.trim()}\n\`\`\`\n`
      const saved = this.prompts.saveSkill({
        name: input.name,
        title: input.title,
        description: input.description,
        content,
        fromTicketId: ticketId,
      })
      // The two writes live in different stores (the prompt/skill KV and the Engine's event log), so they cannot share a
      // transaction. The event is the audit record of a skill that is already live, so a failure to write it is undone
      // by taking the skill back: "promoted but nobody recorded who promoted it" is the one outcome an auditor cannot
      // reason about, and a compensating removal is cheaper than that.
      try {
        this.engine.skillPromoted(ticketId, { name: saved.name, title: saved.title, scriptPath: input.script_path })
      } catch (error) {
        try { this.prompts.removeSkill(saved.name) } catch { /* already gone; the refusal below is what matters */ }
        throw error
      }
      return { ok: true, skill_name: saved.name }
    } catch (error) {
      return { ok: false, error: reason(error) }
    }
  }

  /**
   * Browse the accessible artifact catalog, or read/materialize one registered artifact of another Ticket (E1).
   * When `path` is omitted, returns the catalog of accessible Tickets and their registered artifacts so the worker LLM
   * can judge which data assets are relevant without rummaging through `workRoot`.
   */
  async readArtifact(sourceTicketId: string, targetTicketId?: string, path?: string, materialize?: boolean): Promise<ArtifactRead> {
    let source: Ticket
    try {
      source = this.engine.require(sourceTicketId)
    } catch (error) {
      return error instanceof UserError
        ? { ok: false, error: error.message, code: error.code }
        : { ok: false, error: reason(error) }
    }
    if (targetTicketId === undefined || targetTicketId.trim() === '' || path === undefined || path.trim() === '') {
      const wantedTarget = targetTicketId?.trim()
      // Newest first: see `CATALOG_*` above for why the order is part of the answer's usefulness.
      const candidates = this.store.tickets.list().reverse().filter(item => {
        if (wantedTarget !== undefined && wantedTarget !== '' && item.id !== wantedTarget) return false
        return canCollaborate(source, item)
      })
      const entries: ArtifactCatalogEntry[] = []
      let bytes = 0
      let truncated = false
      for (const item of candidates) {
        if (entries.length >= CATALOG_TICKETS) { truncated = true; break }
        const all = this.store.artifacts.list(item.id)
        // A named target that registered nothing is still an answer ("that Ticket exists and claimed no files"), which
        // is what tells a worker its id was right; in the browse case an empty entry is pure noise, so it is dropped.
        if (all.length === 0 && (wantedTarget === undefined || wantedTarget === '')) continue
        const summary = ticketSummary(item)
        const entry: ArtifactCatalogEntry = {
          ticket_id: item.id, title: item.title, stage: summary.stage,
          ...(item.workId === undefined ? {} : { work_id: item.workId }),
          ...(summary.summary === undefined
            ? {}
            : { summary: summary.summary.slice(0, CATALOG_SUMMARY_CHARS).replace(/\s+/g, ' ') }),
          artifacts: all.slice(0, CATALOG_ARTIFACTS).map(a => ({
            path: a.path, at: a.at, ...(a.note === undefined ? {} : { note: a.note }),
          })),
          ...(all.length === 0 ? { no_artifacts: true } : {}),
          ...(all.length > CATALOG_ARTIFACTS ? { artifacts_total: all.length } : {}),
        }
        const size = JSON.stringify(entry).length
        if (bytes + size > CATALOG_BYTES) { truncated = true; break }
        bytes += size
        entries.push(entry)
      }
      return { ok: true, catalog: entries, total: candidates.length, truncated }
    }
    let authorized: { directory: string; artifact: Artifact }
    try {
      authorized = this.engine.authorizeArtifactRead(sourceTicketId, targetTicketId, path)
    } catch (error) {
      return error instanceof UserError
        ? { ok: false, error: error.message, code: error.code }
        : { ok: false, error: reason(error) }
    }
    const absolute = await resolveRealInside(authorized.directory, authorized.artifact.path)
    if (absolute === undefined) return { ok: false, error: 'That artifact is not a path inside its Ticket directory (or is a symbolic link).', code: 'artifact_missing' }
    try {
      // Measured BEFORE anything is copied or read into memory. `readForPanel` reads the whole file and base64-encodes
      // it, so on a large artifact the old order produced a copy on disk (or a several-hundred-megabyte string in this
      // process, which is the host every other Ticket and the operator's own Session live in) and only then discovered
      // the size. The panel's own file route has always done it in this order.
      const info = await lstat(absolute)
      if (info.isDirectory()) {
        return { ok: false, error: `That artifact is a directory, not a file: ${authorized.artifact.path}` }
      }
      if (materialize === true) {
        const ownDir = source.execution?.directory
        if (ownDir === undefined) return { ok: false, error: 'This Ticket has no workspace directory to materialize into.' }
        if (info.size > WORKER_MATERIALIZE_BYTES) {
          return {
            ok: false,
            error: `That artifact is ${info.size} bytes, over the ${WORKER_MATERIALIZE_BYTES} a worker may copy into inputs/. `
              + 'Ask the other Ticket for the part you need, or have it publish a smaller extract.',
          }
        }
        // The total quota (P-2): every single copy being legal is exactly how an un-budgeted 3 GB workspace happens.
        // Measured BEFORE the copy so a refusal leaves no orphan, and the worker is told both numbers.
        const alreadyHere = await directoryBytes(join(ownDir, 'inputs'))
        if (alreadyHere + info.size > WORKER_INPUTS_TOTAL_BYTES) {
          return {
            ok: false,
            error: `That artifact is ${info.size} bytes and this workspace's inputs/ already holds ${alreadyHere}, together over `
              + `the ${WORKER_INPUTS_TOTAL_BYTES} a Ticket may hold in total. Ask the other Ticket for a smaller extract, `
              + 'or report `blocked` if the work genuinely needs more than the budget.',
          }
        }
        const rel = await this.executor.sandbox.materializeInput(ownDir, absolute, targetTicketId, authorized.artifact.path)
        // Recorded on the SUCCESS path only — see `Engine.recordArtifactRead` for why authorization time was wrong.
        this.engine.recordArtifactRead(sourceTicketId, targetTicketId, authorized.artifact.path)
        const includeInline = isTextFile(authorized.artifact.path, info.size) && info.size <= WORKER_ARTIFACT_BYTES
        return {
          ok: true, size: info.size, at: authorized.artifact.at,
          materialized_to: rel,
          ...(authorized.artifact.note === undefined ? {} : { note: authorized.artifact.note }),
          ...(includeInline ? { content: await readFile(absolute, 'utf8') } : {}),
        }
      }
      if (!isTextFile(authorized.artifact.path, info.size)) {
        return { ok: false, error: `That artifact is not a text file, so it cannot go into a worker's context: ${authorized.artifact.path} (pass materialize: true to copy it into inputs/)` }
      }
      if (info.size > WORKER_ARTIFACT_BYTES) {
        return {
          ok: false,
          error: `That artifact is ${info.size} bytes, over the ${WORKER_ARTIFACT_BYTES} a worker may be handed inline. `
            + 'Pass `materialize: true` to copy it into `inputs/` in your workspace and process it with a script.',
        }
      }
      const content = await readFile(absolute, 'utf8')
      this.engine.recordArtifactRead(sourceTicketId, targetTicketId, authorized.artifact.path)
      return {
        ok: true, size: info.size, at: authorized.artifact.at,
        ...(authorized.artifact.note === undefined ? {} : { note: authorized.artifact.note }),
        content,
      }
    } catch (error) {
      return { ok: false, error: reason(error) }
    }
  }

  /** Everything the Watchdog may touch: the judgement is its own, but every action is one something else already does. */
  private watchdogHost(): WatchdogHost {
    return {
      settings: () => {
        const watchdog = this.settings().watchdog
        return {
          enabled: watchdog.enabled, everyMs: watchdog.everyMs, launchStuckMs: watchdog.launchStuckMs,
          silentMs: watchdog.silentMs, maxActions: watchdog.maxActions,
        }
      },
      stuckLaunches: (olderThanMs, now) => this.executor.stuckLaunches(olderThanMs, now),
      rescue: (ticketId, assignmentId, why) => {
        this.executor.rescueStuckLaunch(ticketId, assignmentId)
        // Recorded through the Engine, which is the only writer: the Watchdog may not write state of its own.
        this.engine.watchdogActed(ticketId, why)
      },
      silentAttempts: (olderThanMs, now) => this.silentAttempts(olderThanMs, now),
      interrupt: (ticketId, assignmentId, why) => {
        // The pair `recover()` already uses for an attempt whose worker is gone: stop what it left running, then
        // replace it. Halting first matters — an interrupted attempt whose background jobs keep running would spend
        // the operator's machine on work nobody is waiting for.
        void this.executor.haltBackground(ticketId, why)
        this.engine.assignmentInterrupted(ticketId, assignmentId, why)
      },
      // The log is the counter, so a restart cannot make the Watchdog forget how many times it already tried. It
      // counts both kinds of action, because to the operator they are the same fact: myagent intervened here.
      actionsTaken: ticketId => this.engine.history(ticketId)
        .filter(event => event.type === 'rescued' || (event.type === 'interrupted' && event.by?.id === 'watchdog')).length,
      // Durable copy of the escalation: the board is the signal, the Ticket's log is the record. Not counted by
      // `actionsTaken` above, because escalating is not an action taken — it is the conclusion that actions failed.
      escalate: (ticketId, why) => {
        // Recorded every time, TOLD once. The Watchdog re-escalates on every pass for as long as a Ticket stays past
        // `maxActions`, so delivering each one would message the requester every `everyMs` — and a repeated alarm
        // trains a person to ignore it, which is the failure the operator's own push rule names ("one fact, once").
        // The Ticket's history is the right place for the repeats: it answers "how many times did we give up".
        const first = isFirstEscalation(this.store.events.list(ticketId))
        this.engine.watchdogEscalated(ticketId, why)
        if (!first) return
        const ticket = this.store.tickets.get(ticketId)
        if (ticket !== undefined) this.delivery.escalated(ticket, why)
      },
      health: this.health.entry('watchdog'),
      requestPass: () => this.passes.requestPass(),
    }
  }

  /**
   * Every domain event, multiplexed to whoever is watching.
   *
   * A listener that throws is contained: an exception here would arrive inside the transaction that emitted the event,
   * and one listener's bug must not be able to roll back a commit or take down the pump.
   */
  private subscribe(listener: (event: DomainEvent) => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Everything a Source may touch, and nothing more. */
  private sourceHost(): SourceHost {
    return {
      engine: this.engine, effects: this.effects, health: this.health, lifetime: this.lifetime,
      settings: () => this.settings(),
      requestPass: () => this.passes.requestPass(),
      subscribe: (listener: (event: DomainEvent) => void) => this.subscribe(listener),
      cursor: (id: string): Cursor => {
        const key = KV.sourceCursor(id)
        return {
          get: <T>(): T | undefined => this.store.get<T>(key),
          set: <T>(value: T): void => { this.store.set(key, value) },
        }
      },
    }
  }

  // ------------------------------------------------------------------- State

  /** The settings as they are now, read from the Store when its revision moved. */
  settings(): Settings {
    const revision = this.store.settingsRevision()
    if (revision !== this.settingsRevisionValue) {
      this.settingsValue = this.store.settings()
      this.settingsRevisionValue = revision
    }
    return this.settingsValue
  }

  /**
   * Validate and store new settings, then tell the live Tickets what the change means for them.
   * @throws a ZodError naming what is wrong, which the panel shows next to the field.
   */
  saveSettings(value: unknown): Settings {
    const before = this.settings()
    const next = parseSettings(value)
    const revision = this.store.saveSettings(next)
    this.settingsValue = next
    this.settingsRevisionValue = revision
    // Called here, and not only from `refresh()`, because a live acceptance run measured that every path from a
    // settings save to `refresh()` is closed at exactly the moment a re-arm matters: `policyChanged` emits nothing for
    // a watchdog- or executor-only change (`authorizationShape` covers neither, so `policyVersion` does not move), and
    // no pass completes while a launch is awaiting its prepare command — which is the very situation the Watchdog
    // exists for. The result was that a new `everyMs` took effect only at the next tick of the OLD grid: 34.7s of
    // detection latency against a 15s threshold, with the rescue landing on mountedAt + 7×60s to within 23ms.
    this.watchdog.settingsChanged()
    this.announceSandbox()
    const effects = this.engine.policyChanged(before, next)
    this.context.logger.info('myagent settings saved (version %s, %d live Ticket(s) affected)', policyVersion(next), effects.length)
    void this.sources.sync().catch((error: unknown) => { this.health.entry('sources').problem(reason(error)) })
    this.passes.requestPass()
    return next
  }

  /**
   * Relaunch a Ticket whose turn died in an upstream error, unbounded unless `watchdog.autoRetryMax` says otherwise.
   *
   * The count lives in `kv` rather than on the Ticket: it is bookkeeping about the host's behaviour, not part of the
   * work's history, and the history already carries one `interrupted` event per relaunch with its own cause.
   */
  private autoRetry(ticketId: string, assignmentId: string, cause: { reason?: string; error?: string } | undefined): void {
    const watchdog = this.settings().watchdog
    if (!watchdog.autoRetry) return
    const max = watchdog.autoRetryMax
    const retryKey = KV.autoRetry(ticketId)
    const count = this.store.get<number>(retryKey) ?? 0
    const causeText = [cause?.reason, cause?.error].filter(part => part !== undefined).join(': ') || 'unknown upstream error'
    if (max > 0 && count >= max) {
      try {
        this.engine.report(ticketId, { state: 'failed', summary: `自动重试 ${count} 次后仍失败：${causeText}` })
      } catch (error) {
        this.context.logger.warn('myagent could not record the exhausted auto-retry of %s: %s', ticketId, reason(error))
      }
      this.raiseDecision(`任务 ${ticketId.slice(0, 8)} 自动重试 ${count} 次后仍失败，需要人处理`, causeText, 'auto-retry')
      return
    }
    this.engine.assignmentInterrupted(ticketId, assignmentId, 'auto-retry: the turn ended in an upstream error',
      '你的上一轮因为上游 API 错误而中断（通常是超时重试耗尽），不是你的错。读一遍目录里的当前状态，从停下的地方继续；不要重复已完成的工作。',
      'auto-retry')
    this.store.set(retryKey, count + 1)
    const detail = `Ticket ${ticketId}: its turn ended in an error (${causeText}); auto-relaunched, attempt ${count + 1}${max > 0 ? ` of ${max}` : ' (uncapped)'}`
    this.sessionHealth.problem(ticketId, detail)
    this.context.logger.warn('myagent — %s', detail)
  }

  /**
   * Park something in front of the operator without stopping anything: the queue the panel shows as
   * 「需要你决断的事」. Raised by the system when it reaches a decision that is a person's (an exhausted retry), and by
   * workers through `myagent_raise_decision` when they meet something worth expanding but not theirs to decide.
   */
  raiseDecision(title: string, detail: string, source: string): string {
    const at = new Date().toISOString()
    const id = key('decision-request', source, title, at)
    const items = this.store.get<DecisionRequest[]>(KV.operatorQueue) ?? []
    this.store.set(KV.operatorQueue, [...items, { id, title, detail, source, raisedAt: at }])
    return id
  }

  decisions(): readonly DecisionRequest[] { return this.store.get<DecisionRequest[]>(KV.operatorQueue) ?? [] }

  dismissDecision(id: string): void {
    this.store.set(KV.operatorQueue, (this.store.get<DecisionRequest[]>(KV.operatorQueue) ?? []).filter(item => item.id !== id))
  }

  /**
   * Which preset a Ticket's worker runs under, read from the Trigger that authorized it.
   *
   * Absent or unrecognized means the ordinary worker: a Trigger written before this field existed has no opinion, and
   * the safe reading of no opinion is the surface every existing Ticket has always had.
   */
  private presetFor(ticket: Ticket): string {
    const meta = this.store.triggers.get(ticket.origin.triggerId)?.trigger.meta
    return meta?.workerPreset === 'researcher' ? RESEARCHER_PRESET : WORKER_PRESET
  }

  /**
   * Enforce the wall-clock budget a scheduled firing carries: tell the worker to wrap up at the budget, and stop it
   * a grace period later if it is still running.
   *
   * On the pass loop rather than on a timer of its own: the pass already runs every two seconds and already has the
   * lifetime and the health entry, and a second timer is a second thing that has to be disposed correctly. The
   * measurement is the running attempt's own `startedAt`, so it covers the subagents and background jobs the worker
   * started — a limit a worker could delegate its way around would not be a limit.
   *
   * The nudge is remembered per attempt in `kv` rather than in the Ticket's log: the log already carries the note
   * itself (that IS the nudge), and a second record of "we told them" would be one fact with two owners.
   */
  enforceRuntimeBudgets(now = Date.now()): void {
    for (const ticket of this.store.tickets.list()) {
      if (ticket.ended !== undefined) continue
      const assignment = runningAssignment(ticket)
      if (assignment === undefined || assignment.startedAt === undefined) continue
      const trigger = this.store.triggers.get(ticket.origin.triggerId)?.trigger
      const budget = typeof trigger?.meta?.runtimeBudgetMs === 'number' ? trigger.meta.runtimeBudgetMs : 0
      if (budget <= 0) continue
      const elapsed = now - Date.parse(assignment.startedAt)
      if (elapsed < budget) continue
      const nudgeKey = KV.budgetNudge(ticket.id, assignment.id)
      if (this.store.get<boolean>(nudgeKey) !== true) {
        this.store.set(nudgeKey, true)
        this.engine.note(ticket.id,
          `时间预算已用完（${Math.round(budget / 60000)} 分钟）。停止开始新的搜索或新的子任务，把已有的结论写成产物并登记，`
          + '然后用 myagent_report 收尾——一份说明"预算到了、做到哪里、还差什么"的报告，好过一份永远交不出的完美报告。')
        this.sessionHealth.problem(ticket.id,
          `Ticket ${ticket.id}: its runtime budget of ${Math.round(budget / 60000)} minute(s) is up; it has been told to wrap up and report`)
        this.context.logger.warn('myagent — runtime budget reached for %s after %s ms', ticket.id, elapsed)
        continue
      }
      if (elapsed < budget + BUDGET_GRACE_MS) continue
      // Still running a grace period after being told: the budget is not a request. `stopTicket` withdraws the
      // Mandate, cancels the turn and stops background work — including the subagents, which is what makes
      // "delegate your way past the limit" not a strategy. Attributed to the system, not to the operator.
      const reason = `超出时间预算：预算 ${Math.round(budget / 60000)} 分钟，宽限 ${Math.round(BUDGET_GRACE_MS / 60000)} 分钟后仍在运行，已被系统停下。`
      this.engine.stopTicket(ticket.id, reason, { kind: 'system', id: 'runtime-budget' })
      // And it lands in the operator's decision queue: whether to raise the budget, split the job, or leave it is
      // theirs, and a stopped Ticket on a list is easy to miss while a queue entry says "this needs a decision".
      this.raiseDecision(`任务 ${ticket.id.slice(0, 8)} 超出墙钟预算被停下`, reason, 'runtime-budget')
      this.sessionHealth.problem(ticket.id,
        `Ticket ${ticket.id}: ran past a ${Math.round(budget / 60000)}-minute budget plus the ${Math.round(BUDGET_GRACE_MS / 60000)}-minute wrap-up window, and was stopped`)
      this.context.logger.warn('myagent — stopped %s for exceeding its runtime budget', ticket.id)
    }
  }

  /**
   * The panel's URL prefix, with a Ticket id appendable after the `#ticket=`.
   * Empty when this profile has no web server, which makes a notification fall back to its text alone.
   */
  panelPath(): string {
    const port = (this.context as { webServer?: { port?: number } }).webServer?.port
    return port === undefined ? '' : `http://127.0.0.1:${port}${BASE_PATH}/#ticket=`
  }

  /**
   * What one Ticket's worker is doing, for a panel that refreshes while the operator watches.
   * @throws `UserError('ticket_missing')` when there is no such Ticket.
   */
  progress(ticketId: string): WorkerProgress {
    const ticket = this.store.tickets.get(ticketId)
    if (ticket === undefined) throw new UserError('ticket_missing', { ticketId })
    const sessionId = ticket.execution?.sessionId ?? workerSessionId(ticketId)
    const agent = this.context.agents.get(sessionId as SessionId)
    const assignment = latestAssignment(ticket)
    return {
      sessionId, sessionTitle: ticket.title, loaded: agent !== undefined, agentStatus: agent?.status,
      ...progressOf(agent),
      ...(assignment === undefined ? {} : {
        assignment: {
          id: assignment.id, state: assignment.state, startedAt: assignment.startedAt,
          deliveredAt: assignment.deliveredAt, deliveryError: assignment.deliveryError,
        },
      }),
    }
  }

  /** When each Source last fired, which the panel shows beside what happens next. */
  /** What a Ticket registered as its own output, which is a claim about the work rather than a listing of the disk. */
  artifacts(ticketId: string): readonly Artifact[] { return this.store.artifacts.list(ticketId) }

  sourceStatus(): Record<string, SourceStatus> {
    // Counts are read from the record, not from each Source's memory: see `Triggers.countBySource`. A read failure
    // must not take the panel down, so the Source's own numbers stand in for it.
    let counted: Record<string, Record<string, number>> = {}
    try { counted = this.store.triggers.countBySource() } catch { /* the panel still renders without counts */ }
    return Object.fromEntries(Object.entries(this.sources.status()).map(([name, own]) => [
      name, counted[name] === undefined ? own : { ...own, counts: counted[name]! },
    ]))
  }

  /**
   * Look now and run what is due: every Source is asked to poll, then the pump is asked for a pass.
   *
   * This is what the panel's "run a pass" does, and what makes dropping a request into the inbox take effect at once
   * rather than up to one poll interval later.
   */
  async nudge(): Promise<void> {
    try {
      await this.sources.nudge()
    } catch (error) {
      this.health.entry('sources').problem(reason(error))
    }
    this.passes.requestPass()
  }

  setupProblem(): string | undefined { return this.problem }

  /** The panel page of this installation. @throws when it does not ship one. */
  panelHtml(): string {
    return readFileSync(packageFile(PANEL_FILE), 'utf8')
  }

  /**
   * The recipes this installation ships, for the panel to offer as a starting point.
   *
   * Read from `examples/` rather than copied into the panel, so there is one text of each recipe: the files a person
   * can copy by hand, the ones `tests/recipes.spec.ts` keeps valid, and the ones the panel offers are the same bytes.
   */
  recipes(): readonly Recipe[] {
    let directory: string
    try { directory = packageFile('examples') } catch { return [] }
    let names: string[]
    try { names = readdirSync(directory) } catch { return [] }
    const recipes: Recipe[] = []
    for (const name of names.sort()) {
      const path = join(directory, name)
      try {
        // examples/README.md documents the recipes; offering it as one puts 1500 characters of documentation into the
        // panel's request box, which is what it did until this line existed.
        if (name.toLowerCase() === 'readme.md') continue
        if (name.endsWith('.md')) {
          const parsed = frontMatter(readFileSync(path, 'utf8'), name.replace(/\.md$/, ''))
          recipes.push({
            name, kind: 'request', title: parsed.title ?? name, text: parsed.body,
            ...(parsed.scope === undefined ? {} : { scope: parsed.scope }),
          })
        } else if (name.endsWith('.json')) {
          const document = JSON.parse(readFileSync(path, 'utf8')) as
            { sources?: { cron?: { schedules?: readonly Record<string, unknown>[] } } }
          const schedule = document.sources?.cron?.schedules?.[0]
          if (schedule !== undefined) recipes.push({ name, kind: 'settings', schedule })
        }
      } catch {
        // A recipe that cannot be read is not offered. `tests/recipes.spec.ts` is what keeps them valid; guessing here
        // would put a broken template in front of the operator.
        this.health.entry('panel').problem(`The recipe ${name} could not be read`)
      }
    }
    return recipes
  }

  // ------------------------------------------------------------------- Start

  /**
   * Start the deployment: wire the listeners, recover what a crash left behind, start the pump and the Sources.
   *
   * Nothing here creates, resolves or decorates a Session, and nothing here awaits a DSH service that could block:
   * mounting a bundle must not be able to hang or break the host's own startup. The main Session is created on demand
   * by {@link createMainSession}, from the panel or from a Ticket somebody opens in it.
   */
  async start(): Promise<void> {
    this.indexSessions()
    this.wireAgents()
    this.recover()
    this.refresh()
    try {
      await this.sources.sync()
    } catch (error) {
      // A Source that will not start is that Source's problem, not a deployment that refuses to run.
      this.health.entry('sources').problem(reason(error))
      this.context.logger.warn('myagent could not start its Sources: %s', reason(error))
    }
    this.passes.start()
    this.watchdog.start()
    this.health.entry('runtime').record(this.machine.stateDir)
    this.announceSandbox()
    this.context.logger.info('myagent runs: state %s, work %s, inbox %s, accept mode %s',
      this.machine.stateDir, this.machine.workRoot, this.machine.inboxDir, this.settings().acceptMode)
    // The one line that answers "where do I look at this thing". The panel is a subpath of the DSH Web GUI, whose
    // port only the host knows; `panelPath()` reads it from the host, so what is printed here is the real address
    // and not a guess. Before this line existed the address lived only in the middle of the README, and an operator
    // who had just installed the bundle could not learn it from the system itself — the most prominent place a
    // running system has is its own startup log.
    const panel = this.panelPath()
    if (panel === '') {
      this.context.logger.info('myagent panel: this profile has no web server, so there is no panel; '
        + 'the chat room and each Ticket directory\'s RESULT.md are your only windows')
    } else {
      this.context.logger.info('myagent panel: %s — open it in a browser on this machine '
        + '(it is the DSH Web GUI address plus /myagent/)', panel.replace(/#ticket=$/, ''))
    }
  }

  /**
   * Say out loud when the executor is configured for a boundary this build cannot provide.
   *
   * `settings.executor.sandbox` has no consumer but this one: `DshExecutor` always constructs a `LocalHostSandbox`,
   * because the rest of the boundary is still direct host IO (attachment delivery, `RESULT.md`,
   * `REPLY-UNDELIVERED.md`, workspace removal, listing, and the `prepare` command). A knob that silently does nothing
   * is worse than no knob — an operator who sets `vm` believes their Tickets are isolated, and finds out otherwise
   * only from whatever the isolation was supposed to prevent. So the unsupported value is announced on the health
   * board, and the announcement is cleared by `record()` when it goes back, rather than being left to go stale.
   */
  private announceSandbox(): void {
    if (this.settings().executor.sandbox === 'vm') {
      this.health.entry('executor').problem('executor.sandbox is "vm", but this build has no VM sandbox: every Ticket '
        + 'still runs in a directory on this host. Set it back to "local" until a VmSandbox exists.')
      return
    }
    // Cleared only when an entry already exists. `entry()` creates on demand, so calling `record()` unconditionally
    // would add a healthy `executor` row to a board whose exact shape an existing assertion pins — and "no row" and
    // "a row saying ok" are the same fact, so the row would be noise.
    if ('executor' in this.health.snapshot()) this.health.entry('executor').record()
  }

  /** Record a problem the panel shows in its header, without stopping anything. */
  markProblem(detail: string): void {
    this.problem = detail
    this.health.entry('runtime').problem(detail)
  }

  /**
   * Create the main Session now, which mounting deliberately did not do.
   * @returns its id, or the reason it could not be created, which the panel shows.
   */
  async createMainSession(): Promise<{ sessionId?: string; error?: string }> {
    try {
      const agent = await this.sessions.ensureMaster(this.machine.workRoot)
      // Clears the front desk's own problem and nothing else. This used to `record` on the shared entry, so creating
      // the main Session erased whatever a worker's failure had written there — one subject's good news overwriting
      // another's, with no acknowledgement from either.
      this.sessionHealth.clear(MAIN_SESSION)
      return { sessionId: agent.id }
    } catch (error) {
      const detail = reason(error)
      this.sessionHealth.problem(MAIN_SESSION, `The main Session could not be created: ${detail}`)
      return { error: detail }
    }
  }

  /** Whether the main Session exists, without creating it. */
  /**
   * The front desk as the panel shows it, under the id DSH actually gave it.
   *
   * `exists` covers a Session that is stored but not loaded in this process, which is the ordinary state after a
   * restart: saying "not created" there would offer a button that in fact restores the old Session rather than making
   * a new one. A front desk the operator deleted in the GUI still counts as existing until the next create rebinds it.
   */
  mainSession(): { exists: boolean; running: boolean; busy: boolean; id: string } {
    const recorded = this.store.get<string>(KV.mainSession)
    const id = recorded ?? this.machine.mainSessionId
    const status = this.sessions.status(id)
    return { ...status, exists: status.exists || recorded !== undefined, id }
  }

  /**
   * Stop the Sources, the pump, the workers and the Store, in that order.
   *
   * This runs while the host is disposing, possibly because something else already failed, so every step is contained
   * and bounded: a step that throws or hangs must not take the host's shutdown with it.
   */
  async stop(): Promise<void> {
    if (this.stopped) return
    this.stopped = true
    this.abort.abort()
    const step = async (name: string, work: () => unknown | Promise<unknown>, timeoutMs: number): Promise<void> => {
      try {
        await Promise.race([
          Promise.resolve(work()),
          new Promise((_resolve, reject) => {
            const timer = setTimeout(() => reject(new Error(`${name} did not finish in ${timeoutMs} ms`)), timeoutMs)
            timer.unref?.()
          }),
        ])
      } catch (error) {
        this.context.logger.warn('myagent could not %s while stopping: %s', name, reason(error))
      }
    }
    for (const dispose of this.disposers.splice(0).reverse()) {
      try { dispose() } catch { /* a route that will not unregister must not hold the shutdown */ }
    }
    this.watchdog.stop()
    await step('stop the pump', () => this.passes.stop(5_000), 8_000)
    await step('stop the Sources', () => this.sources.stop(), 8_000)
    await step('release the Sessions', () => this.sessions.dispose(), 5_000)
    this.effects.dispose()
    // A stopped deployment leaves no worker running under an authorization nobody holds any more.
    await step('stop the workers', async () => {
      for (const ticket of this.store.tickets.open()) {
        if (runningAssignment(ticket) === undefined) continue
        await this.executor.halt(ticket.id, 'myagent stopped', true)
      }
    }, 15_000)
    await step('close the database', () => this.store.close(), 5_000)
    this.lock.release()
  }

  /**
   * The Ticket a Session belongs to: the binding DSH answered with first, and the id's own shape as a fallback for a
   * worker whose binding was never recorded.
   */
  private ticketIdOfSession(sessionId: string): string | undefined {
    return this.sessionIndex.get(sessionId) ?? ticketOfSession(sessionId)
  }

  /** Read every recorded binding, so a restart knows which Session belongs to which Ticket. */
  private indexSessions(): void {
    for (const ticket of this.store.tickets.list()) {
      const sessionId = ticket.execution?.sessionId
      if (sessionId !== undefined) this.sessionIndex.set(sessionId, ticket.id)
    }
  }

  /**
   * Watch the agents this system runs, so a worker's turn ending is recorded and a disposed Session is forgotten —
   * including the one Sessions problem whose subject is a Session rather than a Ticket, which a disposal retires.
   *
   * Every listener is contained. These run inside DSH's own event dispatch, where an exception is a fatal load failure
   * that ends the host process — a plugin's bug must never become the operator's crashed harness. What a listener
   * cannot do is logged and recorded on the health board, which the panel shows.
   */
  private wireAgents(): void {
    const contained = <A extends unknown[]>(name: string, run: (...args: A) => void): ((...args: A) => void) =>
      (...args: A) => {
        try { run(...args) } catch (error) {
          const detail = `${name} listener: ${reason(error)}`
          this.health.entry('listeners').problem(detail)
          this.context.logger.error('myagent contained an exception in its %s', detail)
        }
      }
    this.disposers.push(this.context.on('agent/status', contained('agent/status', ({ agent, status }) => {
      if (status !== 'idle') return
      const ticketId = this.ticketIdOfSession(agent.id)
      if (ticketId === undefined) {
        // The front desk has no Ticket, so its only recovery evidence is its own Session completing a non-error turn —
        // without this, an upstream error recorded under MAIN_SESSION stayed on the board until `createMainSession` ran
        // again, even after the front desk recovered and finished subsequent turns.
        if (agent.id === (this.store.get<string>(KV.mainSession) ?? this.machine.mainSessionId)) {
          const ended = turnEndReason(agent)
          if (ended !== undefined && ended.kind !== 'error' && ended.kind !== 'aborted') {
            this.sessionHealth.clear(MAIN_SESSION)
            this.passes.requestPass()
          }
        }
        return
      }
      const ticket = this.store.tickets.get(ticketId)
      const assignment = ticket === undefined ? undefined : runningAssignment(ticket)
      if (assignment === undefined) return
      const ended = turnEndReason(agent)
      if (ended?.kind === 'blocked') {
        // Not a worker that forgot to report: a Session DSH will not run. Recorded as a failure, which puts it in front
        // of a person, rather than as `waiting`, which would look like work still in progress and invite a retry that
        // cannot succeed.
        const detail = `Ticket ${ticketId}: its Session ended the turn as blocked without reaching the model`
        this.sessionHealth.problem(ticketId, detail)
        this.context.logger.warn('myagent — %s', detail)
        this.engine.report(ticketId, { state: 'failed', summary: UNRUNNABLE_SESSION })
        this.passes.requestPass()
        return
      }
      // Every non-blocked turn end is recorded, whatever the worker did inside it; whether a `waiting` Report is
      // written underneath is `Engine.turnEnded`'s own call, and a turn the worker DID report in still ends here. With
      // the ending's own reason — the part that used to be lost: an upstream 429 reached the health board and a warn
      // log, and reached the Ticket not at all, so a Ticket that a person had to rescue was recorded exactly like one
      // that ran smoothly. The board stays (it is the "now" signal); the event is the record.
      this.engine.turnEnded(ticketId, assignment.id, lastSaid(agent), this.causeOf(agent.id, ended))
      // A turn that ran to a real ending is the Session's own evidence that it works again, which is what retires the
      // problem this entry reported for that Ticket. Deliberately not the turn end as such: the turn that FAILED also
      // ends, and clearing on it would erase the line nine milliseconds after writing it. `aborted` is somebody
      // cancelling rather than a Session working, and no `turn/end` at all is no evidence either way — both leave the
      // problem live, and a Ticket that ends clears it whatever happened to its Session.
      if (ended !== undefined && ended.kind !== 'error' && ended.kind !== 'aborted') this.sessionHealth.clear(ticketId)
      // A turn that ended in error while the Ticket still says running is a dead turn: DSH exhausted its own model
      // retries (five API timeouts is the usual shape) and, left alone, nothing would ever move this Ticket again —
      // the operator's standing instruction is that work keeps moving until it is done. Relaunch it from here; the
      // failed turn's own duration is the backoff, so this needs no timer of its own.
      if (ended?.kind === 'error') {
        const still = this.store.tickets.get(ticketId)
        const running = still === undefined ? undefined : runningAssignment(still)
        if (running !== undefined) this.autoRetry(ticketId, running.id, this.causeOf(agent.id, ended))
      }
      this.passes.requestPass()
    })))
    this.disposers.push(this.context.on('agent/disposed', contained('agent/disposed', ({ agent }) => {
      this.sessionErrors.delete(agent.id)
      this.sessions.forget(agent)
      // The impostor subject's one retirement fact: the Session is gone, so nothing is standing at the door under a
      // name it has no Ticket for any more. A Ticket's problem is retired by its Ticket ending or by its Session
      // completing a non-error turn, and neither is available or meaningful here — see `impostorSubject`. Run for every
      // disposed Session rather than only a refused one, because clearing a subject that is not in the account writes
      // nothing, and asking first would mean holding a second list of which Sessions were refused.
      this.sessionHealth.clear(impostorSubject(agent.id))
    })))
    this.disposers.push(this.context.on('agent/error', contained('agent/error', ({ agent, error }) => {
      const ticketId = this.ticketIdOfSession(agent.id)
      // Ignore Sessions that belong neither to a Ticket nor to the front desk: `agent/error` is global across the DSH
      // host, so an ordinary user conversation in the GUI that hits an upstream 500 has `ticketId === undefined` and
      // used to be misattributed to `MAIN_SESSION` ("the main Session: LlmError: 500…"), where it then stuck forever.
      if (ticketId === undefined && agent.id !== (this.store.get<string>(KV.mainSession) ?? this.machine.mainSessionId)) return
      const detail = `${ticketId === undefined ? 'the main Session' : `Ticket ${ticketId}`}: ${reason(error)}`
      // Per subject rather than into one shared slot: a second Ticket's failure used to overwrite the first one's
      // line, and the first Ticket's recovery used to leave a line on the board about work that had succeeded hours
      // earlier. `SessionHealth` composes the entry from every problem it knows is live.
      this.sessionHealth.problem(ticketId ?? MAIN_SESSION, detail)
      this.context.logger.warn('myagent worker error — %s', detail)
      // Kept for the turn end that follows, which is where this cause is written onto the Ticket: DSH emits
      // `agent/error` from inside the failing turn and ends that turn immediately after, so the text belongs to it.
      // One slot per Session, consumed by that turn end, so an error can never be attributed to a later turn.
      this.sessionErrors.set(agent.id, reason(error))
    })))
  }

  /**
   * Why a turn ended, for the Ticket's own log.
   *
   * The error text prefers what `agent/error` handed this listener, so the log carries the same sentence the health
   * board showed (`LlmError: 429: …`, with the error's own name); the reason DSH wrote into the Session's `turn/end`
   * event is the fallback for an error this process never saw, which is what a `turn/end` whose append failed leaves
   * behind. Consumed rather than read, so a failure that never ends a turn cannot be blamed on the next one.
   */
  private causeOf(sessionId: string, ended: TurnEndReason | undefined): { reason?: string; error?: string } | undefined {
    const error = this.sessionErrors.get(sessionId) ?? ended?.error?.message
    this.sessionErrors.delete(sessionId)
    if (ended?.kind === undefined && error === undefined) return undefined
    return { ...(ended?.kind === undefined ? {} : { reason: ended.kind }), ...(error === undefined ? {} : { error }) }
  }

  /**
   * Recover what a crash left behind: an Assignment that says a worker is running while no Session is loaded was
   * interrupted, so it ends as such and a fresh one starts in the same directory with a note saying what happened.
   */
  private recover(): void {
    let recovered = 0
    for (const ticket of this.store.tickets.open()) {
      const assignment = runningAssignment(ticket)
      if (assignment === undefined) continue
      const agent = this.context.agents.get(workerSessionOf(ticket))
      if (agent === undefined) {
        this.engine.assignmentInterrupted(ticket.id, assignment.id)
        recovered++
        continue
      }
      // The Session outlived the reload but its turn did not: unloading the plugin cancels a running turn
      // (`turn/end` with reason `aborted`), and myagent's listeners were already detached, so the ending was never
      // observed and nothing was recorded. What is left is an Assignment that says "running" beside an agent that is
      // idle — a dead attempt wearing a live badge, invisible to every other mechanism (auto-retry needs the
      // `agent/status` event that already fired into the void; the watchdog's silence check is off by default).
      // A production run proved it: a worker hung in this exact shape for hours with a green health board.
      // A worker genuinely mid-turn is `status === 'running'` and stays untouched — that is the resume case.
      if (agent.status !== 'running') {
        this.engine.assignmentInterrupted(ticket.id, assignment.id,
          'myagent was reloaded while this turn was in flight, so its ending was never observed',
          undefined, 'reload')
        recovered++
      }
    }
    // A lock holder that is gone left its effects claimed; the Store gives them back before the first pass.
    const released = this.store.releaseRunning()
    if (recovered > 0 || released > 0) {
      this.context.logger.info('myagent recovered %d interrupted Assignment(s) and released %d claimed effect(s)', recovered, released)
    }
  }

  /** Recompute what the panel's header and the main Session's prompt section say, and keep the health board current. */
  private refresh(): void {
    const settings = this.settings()
    // Cheap and idempotent: it re-arms only when the interval actually differs, so calling it on every refresh cannot
    // push the next look further away. Without it, changing `watchdog.everyMs` took effect only after a restart.
    this.watchdog.settingsChanged()
    const open = this.store.tickets.open()
    // The quiet line is written here as well as when the last problem clears, so a board that is fine says so instead
    // of saying nothing: an empty board and a silent board are different claims. It writes nothing while any problem
    // is live, which is the guard that keeps a quiet pass from becoming a false all-clear.
    this.sessionHealth.summarize()
    this.panel = {
      acceptMode: settings.acceptMode, panelPath: `${BASE_PATH}/`, openTickets: open.length,
      waiting: open.filter(ticket => waitsForPerson(ticket)).length,
    }
    const problems = this.health.problems()
    this.health.entry('runtime').record(problems.length === 0
      ? `${this.panel.openTickets} open Ticket(s), accept mode ${settings.acceptMode}${settings.paused ? ', paused' : ''}`
      : `${problems.length} problem(s)`)
  }

  /** What a domain event changes outside the Engine's own writes. */
  private onEvent(event: DomainEvent): void {
    // Watchers first, and each one contained.
    //
    // This comment used to justify the containment by saying an event arrives inside the transaction that emitted it,
    // so a throwing listener would roll back a commit. That stopped being true when `emit` moved to after-commit (S8),
    // and the wrong reason was left behind — load-bearing, because it is the only stated reason for the try below.
    // The containment is still right, for the reasons that survive: a listener that throws would otherwise abort the
    // loop and leave every watcher after it unnotified, and one Source's bug must not be able to silence another's.
    // A wrong reason that happens to justify a right decision is still a defect: the next person to read it will
    // believe something false about when events are published.
    for (const listener of [...this.listeners]) {
      try { listener(event) } catch (error) { this.health.entry('sources').problem(`a listener failed: ${reason(error)}`) }
    }
    switch (event.type) {
      case 'ticket.ended':
        // A Ticket's ending retires its Session problem with it: work that is over is not failing now, whatever the
        // way it ended. Nothing is lost by the clearing — the cause, since it exists, is in the Ticket's own log,
        // which is the half of this fix the `turn_ended` detail carries.
        this.sessionHealth.clear(event.ticket.id)
        // Work left running under an authorization that ended stops with it, keeping the Session readable. A stop
        // already halted it — halting again would cancel twice, and with different inbox handling.
        if (event.ticket.ended?.outcome !== 'stopped') {
          void this.executor.haltBackground(event.ticket.id, 'the Ticket ended')
        }
        // Whatever waited for this Ticket is told at once instead of noticing at the end of a deferral interval.
        this.executor.releaseDependants(event.ticket.id)
        this.executor.releaseWaitingSlots()
        this.refresh()
        this.passes.requestPass()
        break
      case 'ticket.created': case 'ticket.resumed': case 'report.recorded':
      case 'assignment.started': case 'assignment.ended': case 'trigger.received':
        this.refresh()
        this.passes.requestPass()
        break
      case 'policy.changed':
        this.refresh()
        break
    }
  }
}

/** Build a Runtime from the plugin's own configuration, or say why it cannot run. */
export function createRuntime(context: Context, config: DeploymentConfig): Runtime {
  try {
    return new Runtime(context, config)
  } catch (error) {
    if (error instanceof LockHeld) context.logger.error('myagent did not start: %s', error.message)
    throw error
  }
}

/** One item in the operator's decision queue: parked, visible on the panel, dismissed by a person. */
export interface DecisionRequest {
  readonly id: string
  readonly title: string
  readonly detail: string
  readonly source: string
  readonly raisedAt: string
}

export type { PromptRole }
