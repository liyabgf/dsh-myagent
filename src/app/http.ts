/**
 * The panel's HTTP surface: a JSON API over the same Engine the Sources and the Sessions use, and the panel page.
 *
 * Every route is same-origin only. The panel is served by the harness's own web server on the loopback interface, so a
 * page from anywhere else must not be able to drive this system: a request has to come to the loopback host and carry
 * the marker header the panel's own fetch sets.
 */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { stat } from 'node:fs/promises'
import { z } from 'zod'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type { Engine } from '../core/index.ts'
import { UserError } from '../core/errors.ts'
import { policyVersion, ScheduleSchema, sourcePolicy, type Settings } from '../core/policy.ts'
import { describeTiming, localZone, nextRun } from '../core/timing.ts'
import { PROMPT_ROLES, PromptConflict } from './prompts.ts'
import { scheduleView } from './views.ts'
import { isTextFile, listFiles, MAX_FILE_BYTES, readForPanel, resolveInside } from './files.ts'
import type { Recipe, WorkerProgress } from './runtime.ts'
import { SetupError, machineView, type Machine } from '../deployment.ts'
import type { HealthBoard } from './health.ts'
import type { Passes } from './passes.ts'
import type { Prompts } from './prompts.ts'
import type { SourceRegistry } from '../sources/registry.ts'
import type { SourceStatus } from '../sources/kind.ts'
import type { Artifact } from '../core/model.ts'
import { LOST_TRIGGER_CHARS, LOST_TRIGGER_KEEP, type Store } from './store.ts'
import { decisionView, ticketSummary, ticketView } from './views.ts'
import type { DshExecutor } from './executor.ts'

/** The path the panel and its API live under. */
export const BASE_PATH = '/myagent'
/** The marker header the panel's own requests carry, which a foreign page cannot set cross-origin. */
export const REQUEST_HEADER = 'x-myagent-request'

export interface HttpHost {
  readonly context: Context
  readonly engine: Engine
  readonly store: Store
  readonly health: HealthBoard
  readonly prompts: Prompts
  readonly sources: SourceRegistry
  /** The Sources' own status, with intake counts read from the record rather than from a per-process counter. */
  sourceStatus(): Record<string, SourceStatus>
  /**
   * The reply tally: how many Reports were worth sending back, and how many had no address to go to.
   *
   * A narrow read rather than the Delivery itself, for the reason `DeliveryHost.replyLost` is narrow: a route table
   * holding the whole Delivery could notify a Session, queue a send and write a `RESULT.md`, and all it has to say
   * here is two numbers. Written structurally instead of importing the class, so this interface does not have to move
   * when the Delivery grows a member.
   */
  readonly delivery: { sends(): { readonly queued: number; readonly nowhere: number } }
  /** The artifacts a Ticket registered, in the order their reports arrived. */
  artifacts(ticketId: string): readonly Artifact[]
  /** When the plugin mounted, which is how you tell a stale bundle from a stale page. */
  mountedAt(): string
  readonly executor: DshExecutor
  readonly passes: Passes
  /** Look now: poll every Source, then run what is due. */
  nudge(): Promise<void>
  /** What one Ticket's worker is doing right now. @throws `UserError('ticket_missing')`. */
  progress(ticketId: string): WorkerProgress
  /** The recipes this installation ships, which the panel offers as a starting point. */
  recipes(): readonly Recipe[]
  readonly machine: Machine
  settings(): Settings
  /** Validate, store and apply settings, telling live Tickets what changed. */
  saveSettings(value: unknown): Settings
  /** The panel page, read from this installation. */
  panelHtml(): string
  /** Whether the deployment is usable; a problem is shown instead of the panel's data. */
  setupProblem(): string | undefined
  /** Whether the main Session exists, without creating it. */
  mainSession(): { exists: boolean; running: boolean; busy: boolean }
  /** Create the main Session now, which mounting deliberately did not do. */
  createMainSession(): Promise<{ sessionId?: string; error?: string }>
}

/** A 400 or 404 raised while parsing a request or looking a record up. */
/** A refusal this route table words itself, with the field-level detail a form can point at. */
class RouteError extends Error {
  constructor(readonly status: 400 | 404, message: string, readonly issues?: readonly { path: string; message: string }[]) {
    super(message)
  }
}

interface RouteRequest {
  readonly params: Record<string, string>
  readonly query: URLSearchParams
  body(maxBytes?: number): Promise<unknown>
}

interface Route {
  readonly method: string
  readonly segments: readonly string[]
  run(request: RouteRequest): unknown | Promise<unknown>
}

const route = (method: string, path: string, run: Route['run']): Route =>
  ({ method, segments: path.split('/').filter(Boolean), run })

async function readBody(req: IncomingMessage, maxBytes = 128 * 1024): Promise<unknown> {
  let size = 0
  const chunks: Buffer[] = []
  for await (const chunk of req) {
    const bytes = Buffer.from(chunk)
    size += bytes.length
    if (size > maxBytes) throw new RouteError(400, `The request exceeds ${maxBytes} bytes`)
    chunks.push(bytes)
  }
  if (chunks.length === 0) return {}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown }
  catch { throw new RouteError(400, 'The request body is not JSON') }
}

function json(res: ServerResponse, status: number, value: unknown): void {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff',
  })
  res.end(JSON.stringify(value))
}

/**
 * Whether a request comes from the panel on this machine's loopback interface. A host header naming anything else is a
 * page from somewhere else, which must not drive this system even if it reached the port.
 * @param port the web server's port, or `undefined` when it is not published, which accepts any loopback port.
 */
export function sameOrigin(req: Pick<IncomingMessage, 'headers'>, port?: number): boolean {
  const host = req.headers.host ?? ''
  const name = host.replace(/:\d+$/, '')
  if (name !== '127.0.0.1' && name !== 'localhost' && name !== '[::1]') return false
  if (port !== undefined && host !== `127.0.0.1:${port}` && host !== `localhost:${port}` && host !== `[::1]:${port}`) return false
  if (req.headers[REQUEST_HEADER] !== '1') return false
  const origin = req.headers.origin
  return origin === undefined || origin === `http://${host}` || origin === `https://${host}`
}

/** Map an error to the status and payload the panel shows. */
function failure(error: unknown): [number, Record<string, unknown>] {
  if (error instanceof z.ZodError) {
    const issues = error.issues.map(issue => {
      // An unknown key arrives with an empty path, which would tell the operator that something is wrong without
      // saying what they typed; the key itself is the useful part.
      const keys = (issue as { keys?: string[] }).keys
      const path = issue.path.length === 0 && keys !== undefined ? keys.join(', ') : issue.path.join('.')
      return { path, message: issue.message }
    })
    return [400, { error: `Invalid settings: ${issues.map(issue => issue.path).join(', ')}`, issues }]
  }
  if (error instanceof RouteError) {
    return [error.status, error.issues === undefined ? { error: error.message } : { error: error.message, issues: error.issues }]
  }
  if (error instanceof SetupError) return [400, { error: error.message, setup: error.problem }]
  if (error instanceof PromptConflict) return [409, { error: error.message }]
  if (error instanceof UserError) return [error.missing ? 404 : 400, { error: error.message, code: error.code, values: error.values }]
  return [500, { error: error instanceof Error ? error.message : String(error) }]
}

function match(table: readonly Route[], method: string, parts: readonly string[]): { route: Route; params: Record<string, string> } | undefined {
  for (const candidate of table) {
    if (candidate.method !== method || candidate.segments.length !== parts.length) continue
    const params: Record<string, string> = {}
    let matched = true
    for (const [index, segment] of candidate.segments.entries()) {
      const part = parts[index]!
      if (segment.startsWith(':')) params[segment.slice(1)] = decodeURIComponent(part)
      else if (segment !== part) { matched = false; break }
    }
    if (matched) return { route: candidate, params }
  }
  return undefined
}

const number = (query: URLSearchParams, name: string, fallback: number, max: number): number => {
  const raw = Number.parseInt(query.get(name) ?? '', 10)
  return Number.isFinite(raw) && raw >= 0 ? Math.min(raw, max) : fallback
}

/**
 * The chat Source's own waiting line, read back into the parts a page can act on.
 *
 * The platform ids are in no record: a held message produces no Trigger and no Decision by design (contract §2.2), so
 * the only place they are ever written is the sentence the Source puts on the health board. That makes this the one
 * view that reads prose, and it reads it here rather than in the page for two reasons — it is TypeScript next to a
 * test that drives the real Source, so a rewording in `chat.ts` fails that test instead of silently emptying the
 * operator's waiting queue; and one parse in one place cannot disagree with itself across panels.
 *
 * Anchored on the sentence's own tail because an id may be `<channel>/<file> (no from)`: a `\([^)]*\)` would stop at
 * the first paren INSIDE the list and hand back half a file name.
 */
const WAITING_LINE = /(\d+) message\(s\) from unmapped identities are waiting \((.*)\); add each id/
/** How the Source names the identities it did not list; the count of messages carries the rest. */
const MORE_IDS = /^\+(\d+) more$/

/**
 * What the chat section of the panel cannot work out for itself, and nothing else.
 *
 * Deliberately not a copy of `settings.sources.chat`: the page already has that document in `state.settings`, and a
 * second shape for the same facts is a second thing to keep in sync. What is here is the three facts that need the
 * server — the gate's own read of the Source's policy, the waiting gauge, and the ids parsed out of the health line.
 */
function chatView(host: HttpHost, health: Record<string, { ok: boolean; detail?: string }>): Record<string, unknown> {
  const settings = host.settings()
  // Answered by the function the gate itself uses, because `paused`, `acceptMode` and `allowedSenders` each fall back
  // to the global setting. A page that re-implemented that fallback would be a second opinion about who may originate
  // work, and three fallthroughs of exactly that shape are already in this project's record (S33).
  const own = sourcePolicy('chat', settings)
  // The Source's OWN report, not `sourceStatus()`: that one replaces `counts` wholesale with the record's disposition
  // counts, so `waiting` — a gauge the Source recomputes from the directories on every pass, and the number the whole
  // waiting queue hangs on — is absent from it as soon as one chat message has ever been accepted.
  const source = host.sources.source('chat')
  const waiting = source?.status().counts?.waiting
  // Prefer the Source's own structured read. The health sentence is prose, and a panel that parses prose to work out
  // which identities are waiting breaks the moment somebody rewords it — silently, with the messages still on disk,
  // which is the worst shape: it looks like the problem went away. (`reply_unroutable` was reworded once already, in
  // round 36, and this is the second reason that reword was not free.) The regular expression stays as the path for a
  // Source that does not expose `waiting()`; `tests/http.spec.ts` pins the wording, so a reword fails loudly there.
  const structured = (source as { waiting?: () => { count: number; ids: string[]; more: number } } | undefined)?.waiting?.()
  const found = structured === undefined ? WAITING_LINE.exec(health['source:chat']?.detail ?? '') : null
  const named = structured !== undefined ? structured.ids : (found === null ? [] : found[2]!.split(', '))
  const trailing = structured === undefined ? MORE_IDS.exec(named.at(-1) ?? '') : null
  return {
    policy: {
      enabled: settings.sources.chat.enabled, paused: own.paused, deny: own.deny,
      acceptMode: own.acceptMode, allowedSenders: [...own.allowedSenders],
    },
    waiting: {
      // Omitted rather than 0 when no chat Source is running: "not running" and "nothing is waiting" are different
      // facts, and showing 0 for the first is the quiet kind of wrong this panel keeps getting caught by.
      ...(waiting === undefined ? {} : { count: waiting }),
      // Identities, deduplicated by the Source; `count` above is MESSAGES, so one id can stand for several of them.
      ids: trailing === null ? named : named.slice(0, -1),
      ...(() => {
        const extra = structured !== undefined ? structured.more : (trailing === null ? undefined : Number(trailing[1]!))
        return extra === undefined || extra === 0 ? {} : { more: extra }
      })(),
    },
  }
}

/**
 * How many requests were given up on, on each of the two paths §4.42 split them into, counted from the record.
 *
 * Two integers on `state`, and the losses themselves on `GET lost`. Split by cost rather than folded the way
 * `counts.sends` was: `state` is polled every five seconds and is the summary route, so what belongs on it is the
 * number an operator watches — "how many, and is that number growing" then rides a request the page already makes —
 * while up to twenty payloads of a thousand characters each of UNTRUSTED text are read only when a person goes to
 * look. Folding the text in would put the largest and least-often-needed body in the API on the most-polled route in
 * it, forever, and `sends` has neither of those properties: it is two numbers, read beside the health line that
 * explains them. The count here gets the same degrade `sends` gets — an older bundle answers by this KEY being
 * absent, which is also what tells the page not to ask for `GET lost` at all.
 *
 * Counted from the record rather than from a Source's memory (`Triggers.countBySource`), and summed over EVERY source
 * the grouping produced rather than over the registered ones: a lost row names the source its own payload carried,
 * which a settings edit can have removed since, and a loss that stopped being counted is a loss that looks fixed.
 *
 * `undefined` when the read fails, which the caller omits instead of zeroing: a section that could not be read must
 * not render as "nothing was lost", which is the shape this panel has been caught by repeatedly.
 */
function lostCount(host: HttpHost): { rows: number; payloads: number } | undefined {
  try {
    const counted = host.store.triggers.countBySource()
    return {
      rows: Object.values(counted).reduce((total, states) => total + (states['lost'] ?? 0), 0),
      payloads: host.store.lostPayloads().length,
    }
  } catch { return undefined }
}

/** The counts and health of a system that is working, which is what the panel's header shows. */
function stateView(host: HttpHost): Record<string, unknown> {
  const settings = host.settings()
  const counts = host.store.tickets.count()
  const effects = host.store.effectCounts()
  const health = host.health.snapshot()
  const lost = lostCount(host)
  return {
    settings,
    settingsRevision: host.store.settingsRevision(),
    // Exposed because it is otherwise unobservable from outside: the only place it surfaced was on a Ticket's Mandate,
    // so checking that a settings change moved the authorization version meant creating a probe Ticket and stopping it.
    policyVersion: policyVersion(host.settings()),
    mountedAt: host.mountedAt(),
    machine: machineView(host.machine),
    setupProblem: host.setupProblem(),
    counts: {
      ...counts,
      triggers: host.store.triggers.since('', 1000).length,
      decisions: host.store.decisions.list(1000).length,
      effects,
      workerSlots: { used: host.executor.used(), max: settings.executor.maxWorkers },
      /**
       * The way back, counted: how many Reports were queued for the platform that asked, and how many had no address
       * to go to (contract §3.3 — `send` does nothing and says nothing when a Trigger carries no `replyTo`, so the
       * doing-nothing has to be observable somewhere).
       *
       * Folded into `state` rather than given a route of its own: `state` is the one route every bundle answers, so a
       * host older than the page degrades by this KEY being absent instead of by a 404 the page would toast about
       * every five seconds — the failure `docs/v2/05-panel-v2-ui.md` §4 measured in the live host. It also keeps the
       * tally in the same snapshot as the settings, the Source status and the health line the chat section reads it
       * beside, so a number can never be shown next to an explanation from a different pass.
       *
       * Both numbers are per-process: they count since this Delivery was constructed, so a plugin reload starts them
       * at zero. The panel says so next to them, because a 0 that reads as "never happened" is worse than no number.
       */
      sends: host.delivery.sends(),
      /**
       * Requests the queue gave up on, which nothing else on this page counts: a `lost` row is not a Decision, not a
       * Ticket and not a queued effect, so the row the effect was deleted from leaves the header saying "all clear".
       * Omitted rather than `{rows: 0, payloads: 0}` when the read failed, so the page can tell "nothing was lost"
       * from "I could not look" — the second must never render as the first.
       */
      ...(lost === undefined ? {} : { lost }),
    },
    health,
    sources: host.sourceStatus(),
    chat: chatView(host, health),
    prompts: {
      revision: host.prompts.revision(), maxChars: host.machine.promptMaxChars.get(),
      roles: PROMPT_ROLES.map(role => ({
        role, overridden: host.prompts.config()[role] !== undefined, chars: host.prompts.current(role).length,
      })),
    },
    paused: settings.paused,
    mainSession: host.mainSession(),
  }
}

/** The route table, in the order the panel's own navigation reads. */
function table(host: HttpHost): readonly Route[] {
  return [
    route('GET', 'state', () => stateView(host)),
    route('GET', 'tickets', ({ query }) => {
      const filter = (query.get('state') ?? 'open') as 'open' | 'ended' | 'attention' | 'all'
      const offset = number(query, 'offset', 0, 100_000)
      const limit = number(query, 'limit', 50, 200)
      const tickets = host.store.tickets.page(filter === 'open' || filter === 'ended' || filter === 'attention' || filter === 'all' ? filter : 'open', offset, limit)
      return { offset, limit, count: tickets.length, tickets: tickets.map(ticketSummary) }
    }),
    route('GET', 'tickets/:id', ({ params }) => {
      const ticket = host.engine.require(params.id!)
      return {
        ...ticketView(ticket),
        // What the worker claimed it produced, one entry per normalized path, with the report that claimed it. The
        // `files` route answers "what is on disk right now"; this answers "what did this Ticket say it made".
        artifacts: host.artifacts(params.id!),
        /**
         * Where this Ticket's answer goes back to, read from the Trigger that asked — the only place an address was
         * ever written down (contract §3.3). Resolved here rather than in `ticketView` because a view computes what one
         * record says about itself, and this is a second record: the Trigger behind `origin.triggerId`.
         *
         * Absent for every one-way Source, which is exactly what the Delivery counts as `nowhere`; the panel says so
         * beside the tally, so an operator can see which of their Tickets moved it and why that is not a failure.
         */
        replyTo: host.store.triggers.get(ticket.origin.triggerId)?.trigger.replyTo,
      }
    }),
    route('POST', 'tickets', async ({ body }) => {
      const request = BodySchemas.create.parse(await body())
      const result = host.engine.createTicket({
        title: request.title, text: request.request, scope: request.scope, sender: request.sender,
        attachments: request.attachments,
      })
      host.passes.requestPass()
      const decision = result.disposition.state === 'accepted' || result.disposition.state === 'ignored' || result.disposition.state === 'observed'
        ? host.engine.decisionOf(result.disposition.decisionId) : undefined
      return {
        stored: result.stored, disposition: result.disposition.state, ticketId: result.ticketId,
        reason: decision?.reason, detail: decision?.detail, acceptMode: host.settings().acceptMode,
      }
    }),
    route('POST', 'tickets/:id/answer', async ({ params, body }) => {
      const request = BodySchemas.text.parse(await body())
      const ticket = host.engine.answer(params.id!, request.text)
      host.passes.requestPass()
      return ticketView(ticket)
    }),
    // Project, Work and the edges between Tickets. These were Engine commands with no caller at all, which is the
    // difference between "tested" and "usable": nothing an operator could reach exercised them.
    // `?archived=1` includes the archived ones. Lists are for choosing, so they hide archived by default (U21);
    // a detail view is for reading, so it never hides anything — see `projects/:id` below.
    route('GET', 'projects', ({ query }) => ({ projects: host.engine.projects(query.get('archived') === '1') })),
    route('POST', 'projects', async ({ body }) => host.engine.createProject(BodySchemas.project.parse(await body()))),
    route('GET', 'projects/:id', ({ params }) => {
      const project = host.engine.project(params.id!)
      if (project === undefined) throw new RouteError(404, 'No Project has this id')
      // Archived Works are included here on purpose: opening a Project to read it must not look like losing data.
      return { project, works: host.engine.works(project.id, true) }
    }),
    route('GET', 'works', ({ query }) => ({
      works: host.engine.works(query.get('project') ?? undefined, query.get('archived') === '1'),
    })),
    // Archive / unarchive / delete, for Projects and Works (U21). POST rather than DELETE: a delete here is a command
    // with a result the caller has to read (how many Tickets lost their Work), and the route table's other commands
    // — `decisions/:id/dismiss`, `tickets/:id/stop` — are POSTs for the same reason.
    route('POST', 'projects/:id/archive', ({ params }) => host.engine.archiveProject(params.id!)),
    route('POST', 'projects/:id/unarchive', ({ params }) => host.engine.unarchiveProject(params.id!)),
    route('POST', 'projects/:id/delete', ({ params }) => host.engine.deleteProject(params.id!)),
    route('POST', 'works/:id/archive', ({ params }) => host.engine.archiveWork(params.id!)),
    route('POST', 'works/:id/unarchive', ({ params }) => host.engine.unarchiveWork(params.id!)),
    route('POST', 'works/:id/delete', ({ params }) => host.engine.deleteWork(params.id!)),
    route('POST', 'works', async ({ body }) => host.engine.createWork(BodySchemas.work.parse(await body()))),
    route('GET', 'works/:id', ({ params }) => {
      const work = host.engine.work(params.id!)
      if (work === undefined) throw new RouteError(404, 'No Work has this id')
      return { work, tickets: host.engine.ticketsOfWork(work.id).map(ticketSummary) }
    }),
    route('POST', 'tickets/:id/work', async ({ params, body }) => {
      const request = BodySchemas.workId.parse(await body())
      return ticketView(host.engine.attachWork(params.id!, request.workId))
    }),
    route('GET', 'tickets/:id/events', ({ params, query }) => {
      const events = host.engine.history(params.id!)
      // Newest first, because a panel shows what just happened; the log itself stays oldest-first, which is the order
      // the facts occurred in and the order `seq` counts them.
      const limit = Number(query.get('limit') ?? '200')
      const clipped = Number.isFinite(limit) && limit > 0 ? events.slice(-limit) : events
      return { count: events.length, returned: clipped.length, events: [...clipped].reverse() }
    }),
    route('GET', 'tickets/:id/dependencies', ({ params }) => ({
      // What it waits for, what waits for it, and — the part a panel has to say out loud — which of the former are
      // still unsatisfied, because that is why nothing has started.
      waitsFor: host.engine.blockedBy(params.id!),
      waitedOnBy: host.engine.dependantsOf(params.id!),
    })),
    route('POST', 'tickets/:id/dependencies', async ({ params, body }) => {
      const request = BodySchemas.dependency.parse(await body())
      const dependency = host.engine.dependOn(params.id!, request.upstream, request.on)
      // A new edge can release nothing, but it can hold a launch that is already queued, so let the pump look again.
      host.passes.requestPass()
      return dependency
    }),
    route('POST', 'tickets/:id/dependencies/drop', async ({ params, body }) => {
      const request = BodySchemas.dependency.parse(await body())
      host.engine.dropDependency(params.id!, request.upstream)
      host.passes.requestPass()
      return { dropped: request.upstream, waitsFor: host.engine.blockedBy(params.id!) }
    }),
    route('POST', 'tickets/:id/note', async ({ params, body }) => {
      const request = BodySchemas.text.parse(await body())
      const ticket = host.engine.note(params.id!, request.text)
      host.passes.requestPass()
      return ticketView(ticket)
    }),
    route('POST', 'tickets/:id/stop', async ({ params, body }) => {
      const request = BodySchemas.reason.parse(await body(16 * 1024))
      const ticket = host.engine.stopTicket(params.id!, request.reason ?? 'A person stopped this Ticket')
      host.passes.requestPass()
      return ticketView(ticket)
    }),
    route('POST', 'tickets/:id/retry', ({ params }) => {
      const ticket = host.engine.retryTicket(params.id!)
      host.passes.requestPass()
      return ticketView(ticket)
    }),
    // A Decision is what a person dismisses ("I saw this refusal, it is fine"), so it lives under decisions.
    route('POST', 'decisions/:id/dismiss', ({ params }) => {
      const id = params.id!
      host.engine.dismiss(id)
      return { dismissed: id, decision: decisionView(host.store.decisions.get(id)!) }
    }),
    // What a person can start from: the shipped recipes, so a request is edited rather than written from nothing.
    route('GET', 'recipes', () => host.recipes()),
    // What a worker is doing right now: the panel polls this while the operator watches a long task.
    route('GET', 'tickets/:id/progress', ({ params }) => host.progress(params.id!)),
    // What a run produced, so seeing whether anything came out does not need a terminal.
    route('GET', 'tickets/:id/files', async ({ params }) => {
      const ticket = host.engine.require(params.id!)
      const directory = ticket.execution?.directory
      if (directory === undefined) return { directory: undefined, files: [], count: 0, truncated: false }
      return { directory, ...(await listFiles(directory)) }
    }),
    // One file: text is shown, anything else is handed over as base64 for the panel to turn into a download.
    route('GET', 'tickets/:id/file', async ({ params, query }) => {
      const ticket = host.engine.require(params.id!)
      const directory = ticket.execution?.directory
      if (directory === undefined) throw new RouteError(404, 'This Ticket has no directory')
      const requested = query.get('path') ?? ''
      if (requested === '') throw new RouteError(400, 'A path is required')
      // A `../` here would turn a file route into a way out of the Ticket's directory.
      const absolute = resolveInside(directory, requested)
      if (absolute === undefined) throw new RouteError(400, `That path is outside this Ticket's directory`)
      let info
      try { info = await stat(absolute) } catch { throw new RouteError(404, `There is no file at ${requested}`) }
      if (info.isDirectory()) throw new RouteError(400, `${requested} is a directory`)
      if (info.size > MAX_FILE_BYTES) {
        throw new RouteError(400, `${requested} is ${(info.size / 1_048_576).toFixed(1)} MB; the panel serves up to `
          + `${Math.floor(MAX_FILE_BYTES / 1_048_576)} MB. Open it where it is: ${absolute}`)
      }
      return { path: requested, absolute, text: isTextFile(requested, info.size), ...(await readForPanel(absolute)) }
    }),
    // The schedule list, with the next run of each computed in the host's own zone.
    route('GET', 'schedules', () => {
      const now = Date.now()
      const last = host.sourceStatus().cron?.lastTriggerAt
      return {
        zone: localZone(), now: new Date(now).toISOString(), lastTriggerAt: last,
        schedules: host.settings().sources.cron.schedules.map(schedule => scheduleView(schedule, now)),
      }
    }),
    // What a schedule a person is editing would actually do: validated, and with its next few runs named.
    route('POST', 'schedules/preview', async ({ body }) => {
      const parsed = ScheduleSchema.safeParse(await body())
      if (!parsed.success) {
        const issues = parsed.error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message }))
        throw new RouteError(400, `That schedule cannot be used: ${issues.map(issue => issue.message).join('; ')}`, issues)
      }
      const now = Date.now()
      const runs: string[] = []
      // Walk the next few runs rather than one, so a weekday-only or monthly schedule shows what it means.
      for (let at = now; runs.length < 3;) {
        const next = nextRun(parsed.data.timing, new Date(at))
        if (next === undefined) break
        runs.push(new Date(next).toISOString())
        at = next
      }
      return {
        schedule: scheduleView(parsed.data, now), next: runs, zone: localZone(),
        describe: describeTiming(parsed.data.timing),
        ...(runs.length === 0 ? { warning: 'This timing never matches: no run could be computed.' } : {}),
      }
    }),
    route('GET', 'decisions', ({ query }) => {
      const limit = number(query, 'limit', 50, 500)
      const decisions = host.store.decisions.list(limit)
      return {
        count: decisions.length,
        decisions: decisions.map(decision => decisionView(decision, host.store.triggers.get(decision.triggerId)?.trigger.title)),
      }
    }),
    route('GET', 'triggers', ({ query }) => {
      const limit = number(query, 'limit', 50, 500)
      const records = host.store.triggers.since('', limit)
      return {
        count: records.length,
        triggers: records.map(record => ({
          id: record.trigger.id, source: record.trigger.source, kind: record.trigger.kind, at: record.trigger.at,
          title: record.trigger.title, actor: record.trigger.actor, disposition: record.disposition,
        })),
      }
    }),
    /**
     * What was lost, on both of the paths §4.42 split it into, kept visibly apart.
     *
     * `rows` are the requests that were understood and then dropped: each has a real source and kind and is counted
     * in that Source's intake. `payloads` are the ones that could not be understood at all, which are deliberately in
     * no table and in no count — a route that merged the two would hide which of the two happened, and the second is
     * the one where the only thing left to read is the text.
     *
     * Named `lost` rather than `triggers/lost` because half of what it answers is not a Trigger: `triggers/lost`
     * would say the degenerate payloads were rows in that table, which is the same false statement §4.42 refused
     * when it kept them out of it.
     */
    route('GET', 'lost', ({ query }) => {
      const limit = number(query, 'limit', 50, 500)
      /**
       * `list()` rather than `since()`: `since` is a NEWEST window, so a producer broken on every firing pushes an
       * older loss out of it while `countBySource` still counts it — a list that disagrees with the number beside it,
       * on the page whose job is saying how many were lost. This is the only member that enumerates every row, so the
       * read is unbounded and that is why this route is fetched on demand while the COUNT rides `state`.
       */
      const lost: { id: string; source: string; kind: string; at: string; title?: string; error: string; effectKey: string }[] = []
      for (const record of host.store.triggers.list()) {
        const disposition = record.disposition
        if (disposition.state !== 'lost') continue
        const trigger = record.trigger as { title?: unknown }
        lost.push({
          // The four columns the row promises, and the two the disposition carries. `title` is offered when the
          // payload had one because it is the only human-readable name of the request, and it is checked rather than
          // dereferenced: `LostTrigger.raw` promises those four columns and nothing else beside them.
          id: record.trigger.id, source: record.trigger.source, kind: record.trigger.kind, at: record.trigger.at,
          ...(typeof trigger.title === 'string' && trigger.title.trim() !== '' ? { title: trigger.title } : {}),
          error: disposition.error, effectKey: disposition.effectKey,
        })
      }
      // `list()` reads oldest first; an operator reads the newest loss first, and the page has no other order to go by.
      lost.reverse()
      return {
        // Both numbers, so a list shorter than the total says so instead of looking complete: `shown < total` is the
        // page's cue to offer more, and a bound nobody states is a truncation nobody can see.
        total: lost.length,
        shown: Math.min(lost.length, limit),
        rows: lost.slice(0, limit),
        // Newest first, all of them: the Store already bounds this list, so there is nothing left to page through and
        // a limit here would hide a loss behind a number that looked like the whole answer.
        payloads: host.store.lostPayloads().slice().reverse(),
        // The bounds the Store keeps these under, so the page states them from the build that enforces them rather
        // than from a copy of two numbers in a file that can drift: `chars` is what makes a cut payload say it was cut.
        bounds: { keep: LOST_TRIGGER_KEEP, chars: LOST_TRIGGER_CHARS },
      }
    }),
    route('PUT', 'settings', async ({ body }) => {
      const settings = host.saveSettings(await body())
      host.passes.requestPass()
      return { settings, settingsRevision: host.store.settingsRevision() }
    }),
    route('GET', 'prompts', () => ({
      revision: host.prompts.revision(), maxChars: host.machine.promptMaxChars.get(),
      roles: PROMPT_ROLES.map(role => ({
        role, current: host.prompts.current(role), base: host.prompts.base(role), override: host.prompts.config()[role],
        // An override that only repeats the shipped text pins the role to it, which the panel marks.
        pinsBase: host.prompts.overrideIsBase(role),
      })),
    })),
    route('PUT', 'prompts', async ({ body }) => {
      const request = BodySchemas.prompts.parse(await body(512 * 1024))
      const revision = host.prompts.save(request)
      host.passes.requestPass()
      return { revision }
    }),
    route('POST', 'pass', async () => {
      await host.nudge()
      return { requested: true, effects: host.store.effectCounts() }
    }),
    // The main Session is created on demand, never at mount: an agent born during activation is torn down with it.
    route('POST', 'main-session', async () => {
      const result = await host.createMainSession()
      if (result.error !== undefined) throw new RouteError(400, result.error)
      return result
    }),
    route('GET', 'effects', () => ({ counts: host.store.effectCounts() })),
  ]
}

/** The request bodies the panel may send. */
const BodySchemas = {
  create: z.object({
    // Trimmed rather than merely non-empty: whitespace would wake a worker with nothing to read.
    title: z.string().trim().min(1).max(200), request: z.string().trim().min(1).max(20_000),
    scope: z.string().trim().max(2_000).optional(), sender: z.string().trim().max(120).optional(),
    attachments: z.array(z.string().trim().min(1).max(4_000)).max(20).optional(),
  }).strict(),
  text: z.object({ text: z.string().trim().min(1).max(20_000) }).strict(),
  reason: z.object({ reason: z.string().trim().max(500).optional() }).strict(),
  prompts: z.object({ worker: z.string().max(1_000_000).optional(), orchestrator: z.string().max(1_000_000).optional() }).strict(),
  project: z.object({ name: z.string().trim().min(1).max(120), note: z.string().trim().max(2_000).optional() }).strict(),
  work: z.object({
    name: z.string().trim().min(1).max(120),
    projectId: z.string().trim().min(1).max(64).optional(),
    scope: z.string().trim().max(2_000).optional(),
    note: z.string().trim().max(2_000).optional(),
  }).strict(),
  workId: z.object({ workId: z.string().trim().min(1).max(64) }).strict(),
  dependency: z.object({
    upstream: z.string().trim().min(1).max(64),
    // `done` waits for success; `ended` accepts any ending, which is how work that must happen either way is expressed.
    on: z.enum(['done', 'ended']).optional(),
  }).strict(),
}

/**
 * Register the panel and its API on the harness's web server.
 * @returns the disposer that removes both.
 */
export function registerHttp(host: HttpHost): () => void {
  const routes = table(host)
  const ctx = host.context
  return ctx.webServer.register({
    kind: 'prefix', path: BASE_PATH, handler: async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      const method = req.method ?? 'GET'
      if (!url.pathname.startsWith(`${BASE_PATH}/api/`)) {
        if (method !== 'GET' || (url.pathname !== `${BASE_PATH}/` && url.pathname !== BASE_PATH && url.pathname !== `${BASE_PATH}/index.html`)) {
          res.writeHead(404).end()
          return
        }
        try {
          const html = host.panelHtml()
          res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
          res.end(html)
        } catch (error) {
          res.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' })
          res.end(`myagent could not read its panel page: ${error instanceof Error ? error.message : String(error)}`)
        }
        return
      }
      if (!sameOrigin(req, ctx.webServer.port)) { json(res, 403, { error: 'A same-origin management request is required' }); return }
      const found = match(routes, method, url.pathname.slice(`${BASE_PATH}/api/`.length).split('/').filter(Boolean))
      if (found === undefined) { json(res, 404, { error: `No route for ${method} ${url.pathname}` }); return }
      try {
        json(res, 200, await found.route.run({ params: found.params, query: url.searchParams, body: maxBytes => readBody(req, maxBytes) }))
      } catch (error) {
        const [status, payload] = failure(error)
        json(res, status, payload)
      }
    },
  })
}
