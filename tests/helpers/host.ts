/**
 * A stand-in host, so the whole system can be run offline.
 *
 * Mounting into a live profile is the last step of proving a bundle works, not the first: it reloads the host, and a
 * plugin that misbehaves takes the operator's session with it. Everything here runs against these stubs instead, and
 * records every call the system makes, so a test can assert not only what happened but what was *not* touched.
 */
import type { Context } from '@deepseek-ai/cordis'

/** A Session's own event log, as far as this system reads it. */
/** A Session's own event log. `data` is whatever DSH puts in it: a job id, a turn's end reason, a message. */
export interface SessionRecord {
  id: string
  events: { seq: number; type: string; data?: Record<string, unknown> }[]
  consumed: number[]
  snapshotEvents(): readonly { seq: number; type: string; data?: Record<string, unknown> }[]
  consumeEvents(seqs: readonly number[]): void
}

/** A shell job, as `ctx.get('jobs')` reports it. */
export interface JobRecord {
  readonly id: string
  readonly owner: string
  status: string
  killedWith?: string
}

/** What the jobs and subagents services did, in order, which is what "the stop really stopped it" is checked against. */
export interface ServiceCalls {
  /** Every call the two services received, in the order they arrived: `wait:job-1`, `kill:job-1`, `drain:child-1`. */
  readonly log: string[]
  readonly jobs: JobRecord[]
  /** Children the subagents service lists for a Session, by parent Session id. */
  readonly children: Map<string, string[]>
  /** Set to make a kill or a drain fail, which is how one bad job must not stop the rest. */
  failKills: string[]
  failDrains: string[]
}

/** A registered tool, as the agent's own scope holds it. */
export interface RegisteredTool {
  readonly agentId: string
  readonly definition: {
    name: string
    description: string
    parameters: Record<string, unknown>
    output?: { schema: Record<string, unknown>; render(args: unknown, value: unknown): unknown }
    execute(args: unknown, exec: { signal: AbortSignal }): Promise<unknown>
  }
}

/**
 * A registered tool guard, as the agent's own scope holds it.
 *
 * Recorded rather than dropped, because the guard's answer is the one thing a Session reads when its authorization is
 * over — a refusal message is what teaches the next caller what to do instead, and a message nobody can assert on is a
 * message that can silently stop saying anything.
 */
export interface RecordedGuard {
  readonly agentId: string
  readonly guard: () => string | undefined
}

/** What a stub agent records, which is what a test asserts on. */
export interface AgentRecord {
  id: string
  status: 'idle' | 'running'
  /** The Session, which is where DSH keeps the event log a caller reads and consumes. */
  session: SessionRecord
  /** Messages queued as a turn the agent would answer. */
  followups: { id: string; text: string; source: unknown }[]
  /** Messages injected into its history without waking it. */
  notices: { id: string; text: string; source: unknown }[]
  cancelled: number
  ctx: {
    systemPrompt: { section(definition: unknown): () => void }
    tools: {
      register(definition: RegisteredTool['definition']): () => void
      restrict(filter: { allow?: readonly string[] }): () => void
      guard(guard: () => string | undefined): () => void
      get(name: string, scope?: unknown): unknown
    }
  }
  inbox: { nextTurn: unknown[]; nextStep: unknown[] }
  /** The Session's own persisted event log, which is what a restore reads. */
  readonly log: { seq: number; type: string; data?: Record<string, unknown> }[]
  /** How many times persistence was flushed on this agent's behalf. */
  flushes: number
  cancel(cause?: unknown, options?: unknown): void
  whenIdle(): Promise<void>
  followup(message: { id: string; content: readonly { type: string; text?: string }[]; source?: unknown }): void
  inject(message: { id: string; content: readonly { type: string; text?: string }[]; source?: unknown }): void
}

/** A Session log with the two methods this system uses. */
export function sessionRecord(id: string): SessionRecord {
  const record: SessionRecord = {
    id, events: [], consumed: [],
    snapshotEvents: () => record.events,
    consumeEvents: seqs => { record.consumed.push(...seqs) },
  }
  return record
}

const textOf = (message: { content: readonly { type: string; text?: string }[] }): string =>
  message.content.filter(block => block.type === 'text').map(block => block.text ?? '').join('\n')

/** Where a message says it came from, which is what DSH validates before it accepts it. */
const sourceOf = (message: { source?: unknown }): unknown => message.source

/** How a host answers `restrict`, which is the part a stub must not fake away. */
export interface RestrictPolicy {
  readonly knownTools: readonly string[]
  readonly fails: boolean
}

/**
 * Where this host refuses a delivery myagent asked DSH to make, which is how the `notify` knob injects its fault.
 *
 * Handed to the agent rather than closed over by the caller, because the agent object is what DSH would throw from:
 * the failure has to arrive where the production failure arrives, so the effect handler fails for its own real reason
 * and the queue's retry, backoff and give-up run unmodified. A hook inside `src/` would prove the hook works; this
 * proves the system does.
 */
export interface DeliveryFault {
  /** Refuse a message put into this Session's history, which is how a notice reaches the front desk. */
  notice(session: string): void
  /** Refuse a message queued as a turn for this Session, when it is the front desk and not a worker. */
  relay(session: string): void
}

/** One fake agent, with the surface myagent decorates, prompts and stops. */
export function fakeAgent(id: string, tools: RegisteredTool[], restrictions: { allow?: readonly string[] }[],
  guards: RecordedGuard[], policy: RestrictPolicy,
  log: { seq: number; type: string; data?: Record<string, unknown> }[] = [], fault?: DeliveryFault): AgentRecord {
  const agent: AgentRecord = {
    id, status: 'idle', session: sessionRecord(id), followups: [], notices: [], cancelled: 0, flushes: 0, log,
    inbox: { nextTurn: [], nextStep: [] },
    cancel() { agent.cancelled++ },
    whenIdle: async () => {},
    followup(message) {
      fault?.relay(id)
      agent.followups.push({ id: message.id, text: textOf(message), source: sourceOf(message) })
      agent.inbox.nextTurn.push(message)
      // A queued message wakes an idle agent, and a worker running a turn is what holds a slot.
      if (agent.status === 'idle') agent.status = 'running'
    },
    // An injected message goes straight into the Session's history, which is the other face dedup reads.
    inject(message) {
      fault?.notice(id)
      agent.notices.push({ id: message.id, text: textOf(message), source: sourceOf(message) })
      log.push({ seq: log.length, type: 'user/message', data: message })
    },
    ctx: {
      systemPrompt: { section: () => () => {} },
      tools: {
        register(definition) { tools.push({ agentId: id, definition }); return () => {} },
        // Faithful to DSH: a name it does not know globally is refused, and the message carries the name.
        restrict(filter) {
          restrictions.push(filter)
          if (policy.fails) throw new Error('this profile accepts no tool restriction')
          // Faithful to DSH in shape as well as content: it collects EVERY unknown name and refuses once, plural
          // above one name. Throwing on the first name only — always singular — left the multi-name case unreachable,
          // which is exactly where the plugin's own recovery broke in production.
          const unknown = (filter.allow ?? []).filter(name => !policy.knownTools.includes(name))
          if (unknown.length > 0) {
            throw new Error(`tools.restrict() names unknown global tool${unknown.length > 1 ? 's' : ''} `
              + `${unknown.map(name => `"${name}"`).join(', ')}; known global tools: ${policy.knownTools.join(', ')}`)
          }
          return () => {}
        },
        // Recorded, so a test can ask what a Session is told once its authorization is over.
        guard: (deny: () => string | undefined) => { guards.push({ agentId: id, guard: deny }); return () => {} },
        get: () => ({}),
      },
    },
  }
  return agent
}

export interface StubHost {
  readonly ctx: Context
  readonly calls: {
    sessions: string[]; routes: string[]; listeners: string[]; renames: number; spawns: { argv: string[]; cwd: string }[]
    /** What DSH was asked to create, including the directory the Session runs in and the preset it runs as. */
    created: { sessionId: string; cwd?: string; agentPreset?: string }[]
  }
  readonly agents: Map<string, AgentRecord>
  /** How many times persistence was flushed, which a delivery does before acknowledging work. */
  flushes(): number
  /**
   * The deliveries this host refused under the `notify` knob, in order.
   *
   * Recorded so a test can prove its fault actually fired. A knob that silently refused nothing — because the front
   * desk was identified wrongly, or because the delivery went down another path — leaves a give-up test green for a
   * reason of its own invention, which is the round-25 failure shape this harness exists to prevent.
   */
  readonly refusals: { session: string; mode: 'notice' | 'relay' }[]
  /** Sessions that exist in persistence but are not loaded; `resolveAgent` publishes one when asked. */
  readonly restored: Map<string, AgentRecord>
  /** Every permission preset this system set, with the Session it set it on. */
  readonly permissions: { sessionId: string; preset: string }[]
  readonly services: ServiceCalls
  /** The routes registered on the web server, by path, so a test can call one without a server. */
  readonly routes: Map<string, (req: unknown, res: unknown) => void | Promise<void>>
  /**
   * Call a registered route as the panel's fetch would.
   * @param path a path under the registered prefix, such as `/myagent/api/state`.
   * @returns the status and the parsed JSON body.
   */
  request(path: string, init?: { method?: string; body?: unknown; headers?: Record<string, string> }): Promise<{ status: number; json: Record<string, unknown>; text: string }>
  /** Put a Session into persistence without loading it, as a launch that died partway leaves one behind. */
  seedRestored(sessionId: string, permission?: string): AgentRecord
  /** Publish a live agent under `sessionId`, as a Session that is loaded and running looks. */
  spawn(sessionId: string, status?: 'idle' | 'running'): AgentRecord
  readonly tools: RegisteredTool[]
  readonly restrictions: { allow?: readonly string[] }[]
  /** Every tool guard registered, in order, which is how a test reads a refusal's own wording. */
  readonly guards: RecordedGuard[]
  /** The tool registered under `name` on `agentId`, which is how a test plays the worker. */
  tool(agentId: string, name: string): RegisteredTool | undefined
  /**
   * The guard now registered on `agentId` — the last one, because a rebind registers a second and releases the first.
   * Its answer is what a Session is told when it calls a tool with no live Ticket behind it.
   */
  guardOf(agentId: string): (() => string | undefined) | undefined
  /** Dispatch an event to the plugin's listeners, without containing what they throw. */
  emit(name: string, payload: unknown): void
  /** Run what `apply` registered for disposal, which is how the host stops a plugin. */
  dispose(): Promise<void>
}

/**
 * The global tools a real DSH host knows, taken from the error it answers a bad `restrict` with. A stub that accepts any
 * name hides the bug this list exists to catch.
 */
export const KNOWN_GLOBAL_TOOLS = [
  'bash', 'edit', 'glob', 'grep', 'interrupt_agent', 'job_kill', 'job_list', 'job_output', 'list_agents',
  'list_subagent_models', 'read', 'read_image', 'send_message', 'skill', 'subagent', 'todo_write', 'web_fetch',
  'web_search', 'working_directory', 'write',
]

export interface StubOptions {
  /** Global tool names this host knows; `restrict` refuses any other name, as DSH does. */
  readonly knownTools?: readonly string[]
  /** Make every `restrict` call fail, for the case where a profile accepts no restriction at all. */
  readonly restrictFails?: boolean
  /** The permission preset a Session is restored with, which is the profile default rather than what myagent wants. */
  readonly permissionCurrent?: string
  /** Whether this host runs the jobs and subagents services a stop reaches for. */
  readonly services?: boolean
  /** Jobs the service reports, which a stop kills by owner. */
  readonly jobs?: readonly { id: string; owner: string; status?: string }[]
  /** Children the subagents service lists for a Session, by parent Session id. */
  readonly children?: Record<string, string[]>
  /** What a spawned subprocess exits with, and what it writes; the default is a command that worked. */
  readonly spawn?: {
    exitCode?: number | null; stdout?: string; stderr?: string; throws?: string
    /**
     * Make the command take time, so a launch can be caught in flight.
     *
     * Without this the suite could not model a slow prepare at all, which is why the Watchdog's rescue looked correct
     * offline and was a no-op in a live host: every stubbed command finished before anything could observe it running.
     */
    delayMs?: number
  }
  /** Whether DSH hands back an agent for a Session it created; a real host does, a broken one does not. */
  readonly resolve?: boolean
  /**
   * Make the front desk unreachable: the DSH agent call that carries a notice — or a relay for a Ticket that waits —
   * throws instead of accepting it, which is how a Session that is gone or being torn down fails a delivery.
   *
   * Without this the suite could not make a `notify` effect fail at all, and so could not reach `onPermanentFailure`
   * for one: the desktop banner swallows its own errors (`delivery.ts:431`), so the `spawn` knob cannot fail a notify,
   * and the only other thing a notify touches is the front desk's own agent. That is why round 40 shipped the
   * `onPermanentFailure → noticeLost` wiring with no test of the wiring, recorded as debt rather than as coverage.
   * What becomes testable: a notification the queue gives up on, and everything that has to survive that give-up.
   *
   * Per-Session, not per-Ticket, because that is the shape the real failure has — DSH refuses an inject on account of
   * the Session it is aimed at, never on account of the Ticket the text happens to concern. A per-Ticket knob would
   * model a failure that cannot occur, and would need the stub to recompute myagent's own `key()` digests to recognise
   * one Ticket's notice: `key()` returns a bare 32-hex digest (`core/ids.ts`), so nothing about a message says which
   * Ticket it belongs to. Proving the system survives a per-Ticket notice failure would then prove nothing about the
   * front desk being down, which is the case an unattended deployment actually meets.
   *
   * `fails` is a budget rather than a switch, and it is required so that an omitted field cannot mean "forever" by
   * accident: refuse exactly `fails` deliveries and then accept one. `fails: 2` is a front desk that comes back —
   * which must leave no `notice_lost` behind, or a transient failure would read as a lost message — and
   * `fails: Infinity` is one that never does, which is what reaches the give-up.
   */
  readonly notify?: {
    /** How many deliveries the front desk refuses before it accepts one; `Infinity` for a Session that never returns. */
    readonly fails: number
    /** The error DSH answers with. */
    readonly error?: string
  }
  /**
   * The identity DSH answers a create with, when it is not the one asked for: it may reuse a blank Session, and a
   * caller that assumed its own id then addresses a Session that does not exist.
   */
  readonly answersWith?: (requested: string) => string
}

export function stubHost(options: StubOptions = {}): StubHost {
  const resolve = options.resolve ?? true
  const policy: RestrictPolicy = { knownTools: options.knownTools ?? KNOWN_GLOBAL_TOOLS, fails: options.restrictFails === true }
  const restored = new Map<string, AgentRecord>()
  /** One event log per Session, shared by every agent object that stands for it. */
  const logs = new Map<string, { seq: number; type: string; data?: Record<string, unknown> }[]>()
  const logOf = (sessionId: string) => {
    let log = logs.get(sessionId)
    if (log === undefined) { log = []; logs.set(sessionId, log) }
    return log
  }
  const services: ServiceCalls = {
    log: [], failKills: [], failDrains: [],
    jobs: (options.jobs ?? []).map(job => ({ id: job.id, owner: job.owner, status: job.status ?? 'running' })),
    children: new Map(Object.entries(options.children ?? {})),
  }
  const permissions: { sessionId: string; preset: string }[] = []
  const presets = new Map<string, string>()
  const routes = new Map<string, (req: unknown, res: unknown) => void | Promise<void>>()
  const calls = {
    sessions: [] as string[], routes: [] as string[], listeners: [] as string[], renames: 0,
    spawns: [] as { argv: string[]; cwd: string }[],
    created: [] as { sessionId: string; cwd?: string; agentPreset?: string }[],
  }
  const disposals: (() => Promise<void>)[] = []
  const agents = new Map<string, AgentRecord>()
  const tools: RegisteredTool[] = []
  const restrictions: { allow?: readonly string[] }[] = []
  const guards: RecordedGuard[] = []
  const listeners = new Map<string, ((...args: never[]) => void)[]>()
  const refusals: { session: string; mode: 'notice' | 'relay' }[] = []
  /**
   * The Sessions myagent created without a worker preset, which is its front desk: every worker Session is created
   * with `WORKER_PRESET` (`sessions.ts:244`) and the main Session never is (`sessions.ts:211`).
   *
   * Learned from what the system under test does rather than from a copy of its default id, so the two cannot drift —
   * a knob that stopped matching would fail nothing and every give-up test would stay green for the wrong reason.
   */
  const frontDesk = new Set<string>()
  const budget = options.notify === undefined
    ? undefined
    : { left: options.notify.fails, error: options.notify.error ?? 'the front desk is not reachable' }
  const refuse = (session: string, mode: 'notice' | 'relay'): void => {
    // A notice is only ever injected into the front desk — `inject` has exactly one call site in `src/`, reached from
    // `sessions.notify` alone — so it counts wherever it lands, and landing somewhere else is itself worth knowing.
    if (mode === 'notice') frontDesk.add(session)
    // A followup is shared with a worker's launch prompt and carries the same `form: 'relay'` source, so refusing one
    // by shape would fail launches the test never asked about. Only the front desk's own is refused.
    else if (!frontDesk.has(session)) return
    if (budget === undefined || budget.left <= 0) return
    budget.left--
    refusals.push({ session, mode })
    throw new Error(budget.error)
  }
  const fault: DeliveryFault = { notice: session => refuse(session, 'notice'), relay: session => refuse(session, 'relay') }
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    on: (name: string, listener: (...args: never[]) => void) => {
      calls.listeners.push(name)
      const list = listeners.get(name) ?? []
      list.push(listener)
      listeners.set(name, list)
      return () => { listeners.set(name, list.filter(item => item !== listener)) }
    },
    // Cordis calls the effect's function and keeps what it returns as the disposer.
    effect: (fn: () => () => Promise<void>) => { disposals.push(fn()); return () => {} },
    fiber: {},
    agents: { get: (id: string) => agents.get(id) },
    webServer: {
      port: 3080,
      register: (route: { path: string; handler: (req: unknown, res: unknown) => void | Promise<void> }) => {
        calls.routes.push(route.path)
        routes.set(route.path, route.handler)
        return () => { routes.delete(route.path) }
      },
    },
    sessionController: {
      create: async (request: { sessionId: string; cwd?: string; agentPreset?: string }) => {
        calls.sessions.push(request.sessionId)
        // Recorded separately: `sessions` stays a list of ids because a dozen assertions read it that way, and the
        // cwd is the one fact that makes "one directory per Ticket" a claim about DSH rather than about this stub.
        calls.created.push({ sessionId: request.sessionId, cwd: request.cwd, agentPreset: request.agentPreset })
        const sessionId = options.answersWith?.(request.sessionId) ?? request.sessionId
        const agent = resolve ? fakeAgent(sessionId, tools, restrictions, guards, policy, logOf(sessionId), fault) : undefined
        // No preset means this is the front desk; a worker is always created under `WORKER_PRESET`.
        if (request.agentPreset === undefined) frontDesk.add(sessionId)
        if (agent !== undefined) presets.set(sessionId, options.permissionCurrent ?? 'workspace-write')
        if (agent !== undefined) agents.set(sessionId, agent)
        // DSH announces a new agent to every listener before create returns, and a listener that throws there is a
        // fatal load failure for the whole host.
        if (agent !== undefined) host.emit('agent/created', { agent })
        return { sessionId, agentPreset: request.agentPreset }
      },
      // DSH answers with an error for a Session that does not exist, not with a rejection.
      resolveAgent: async (sessionId: string) => {
        // Resolving a persisted Session publishes it, which is what a real host does.
        const cold = restored.get(sessionId)
        if (cold !== undefined) { agents.set(sessionId, cold); restored.delete(sessionId) }
        const agent = agents.get(sessionId)
        return agent === undefined ? { error: { code: 'session/not-found' } } : { agent }
      },
      rename: async () => { calls.renames++; return { title: '', seq: 1 } },
      selectModel: async () => ({ selected: { provider: 'p', model: 'm' } }),
    },
    workspaceRegistry: { create: async () => ({ id: 'workspace-1' }) },
    permissionPresets: {
      set: (session: { id: string }, preset: string) => { permissions.push({ sessionId: session.id, preset }); presets.set(session.id, preset) },
      current: (session: { id: string }) => presets.get(session.id) ?? options.permissionCurrent ?? 'workspace-write',
    },
    sessionPersistence: {
      flush: async () => { for (const agent of agents.values()) agent.flushes++ },
      open: async (sessionId: string) => ({
        read: async (offset: number, limit: number) => ({
          events: (agents.get(sessionId)?.log ?? []).slice(offset, offset + limit),
        }),
        [Symbol.dispose]() {},
      }),
    },
    subprocess: {
      spawn: (spec: { argv: string[]; cwd: string }) => {
        calls.spawns.push({ argv: spec.argv, cwd: spec.cwd })
        const outcome = options.spawn ?? {}
        if (outcome.throws !== undefined) throw new Error(outcome.throws)
        const exitCode = outcome.exitCode === undefined ? 0 : outcome.exitCode
        return {
          // `null` means the process was stopped before it finished, which is not the same as 0.
          done: (outcome.delayMs ?? 0) > 0
            ? new Promise<{ exitCode: number | null }>(resolve => { setTimeout(() => resolve({ exitCode }), outcome.delayMs) })
            : Promise.resolve({ exitCode }),
          collected: {
            stdout: outcome.stdout === undefined ? undefined : { readFrom: () => ({ text: outcome.stdout! }) },
            stderr: outcome.stderr === undefined ? undefined : { readFrom: () => ({ text: outcome.stderr! }) },
          },
        }
      },
    },
    get: (name: string) => {
      if (options.services !== true) return undefined
      if (name === 'jobs') {
        return {
          list: () => services.jobs.map(job => ({ id: job.id, owner: job.owner, status: job.status })),
          // A wait resolves at once here; what matters is that it was asked for before the kill landed.
          wait: async (id: string) => { services.log.push(`wait:${id}`) },
          kill: (id: string, _caller: string, reason?: string) => {
            services.log.push(`kill:${id}`)
            if (services.failKills.includes(id)) throw new Error(`job ${id} will not die`)
            const job = services.jobs.find(item => item.id === id)
            if (job !== undefined) { job.status = 'killed'; job.killedWith = reason }
            return {}
          },
        }
      }
      if (name === 'subagents') {
        return {
          listChildren: async (parentId: string) => (services.children.get(parentId) ?? []).map(id => ({ id })),
          drainChildren: async (_parent: unknown, childIds: readonly string[]) => {
            for (const id of childIds) {
              services.log.push(`drain:${id}`)
              if (services.failDrains.includes(id)) throw new Error(`subagent ${id} will not release`)
            }
          },
        }
      }
      return undefined
    },
  }
  const host: StubHost = {
    ctx: ctx as unknown as Context, calls, agents, restored, tools, restrictions, guards, permissions, refusals,
    flushes: () => [...agents.values()].reduce((total, agent) => total + agent.flushes, 0), services,
    spawn: (sessionId: string, status: 'idle' | 'running' = 'idle') => {
      const agent = fakeAgent(sessionId, tools, restrictions, guards, policy, logOf(sessionId), fault)
      agent.status = status
      agents.set(sessionId, agent)
      return agent
    },
    seedRestored: (sessionId: string, permission?: string) => {
      const agent = fakeAgent(sessionId, tools, restrictions, guards, policy, logOf(sessionId), fault)
      restored.set(sessionId, agent)
      if (permission !== undefined) presets.set(sessionId, permission)
      return agent
    },
    tool: (agentId: string, name: string) => tools.find(tool => tool.agentId === agentId && tool.definition.name === name),
    guardOf: (agentId: string) => guards.filter(item => item.agentId === agentId).at(-1)?.guard,
    // Dispatch as DSH does: a throwing listener propagates to the caller, which is what makes it fatal.
    emit: (name: string, payload: unknown) => {
      const args = (Array.isArray(payload) ? payload : [payload]) as never[]
      for (const listener of listeners.get(name) ?? []) listener(...args)
    },
    routes,
    request: async (path, init = {}) => {
      const prefix = [...routes.keys()].find(registered => path.startsWith(registered))
      if (prefix === undefined) throw new Error(`no route registered for ${path}`)
      const body = init.body === undefined ? undefined : JSON.stringify(init.body)
      const req = {
        method: init.method ?? 'GET', url: path,
        // Explicit headers replace the panel's own, so a test can send a request the fence must refuse.
        headers: init.headers ?? { host: '127.0.0.1:3080', 'x-myagent-request': '1' },
        // A request body arrives as a stream of chunks, which is what the route reads.
        [Symbol.asyncIterator]: async function* () { if (body !== undefined) yield Buffer.from(body) },
      }
      const res = {
        status: 0, headers: {} as Record<string, string>, text: '',
        writeHead(status: number, headers: Record<string, string> = {}) { res.status = status; res.headers = headers; return res },
        end(text = '') { res.text = String(text) },
      }
      await routes.get(prefix)!(req, res)
      let json: Record<string, unknown> = {}
      try { json = JSON.parse(res.text) as Record<string, unknown> } catch { /* a page, not JSON */ }
      return { status: res.status, json, text: res.text }
    },
    dispose: async () => { for (const dispose of disposals.splice(0)) await dispose() },
  }
  return host
}

/** A host whose every service fails, which is what a broken startup looks like from inside a plugin. */
export function brokenHost(): Context {
  const fail = (): never => { throw new Error('this host is not usable') }
  const ctx = {
    logger: { info() {}, warn() {}, error() {}, debug() {} },
    on: fail, effect: fail, agents: { get: fail }, webServer: { port: 3080, register: fail },
    sessionController: { create: fail, resolveAgent: fail, rename: fail, selectModel: fail },
    workspaceRegistry: { create: fail }, permissionPresets: { set: fail },
    sessionPersistence: { flush: fail, open: fail }, subprocess: { spawn: fail }, get: fail,
  }
  return ctx as unknown as Context
}

export const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))
