/**
 * Sessions: the lifecycle of the two kinds of DSH Session this system runs, and what each one is told and allowed.
 *
 * A worker Session belongs to one Ticket and one directory; the main Session is the operator's front desk. Both are
 * created if absent, decorated before their first turn, and rebound when the prompts they run under change, so an
 * edited prompt reaches a live Session at its next turn instead of waiting for a restart.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'
import { scopeParentOf } from '@deepseek-ai/dsh-scope'
import type {} from '@deepseek-ai/dsh-api-session-controller'
import type {} from '@deepseek-ai/dsh-session-persistence'
import type {} from '@deepseek-ai/dsh-workspace'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-system-prompt'
import type {} from '@deepseek-ai/dsh-tools'
import { latestReport, ticketStage, type Ticket } from '../core/model.ts'
import { AgentDelivery } from './agent-delivery.ts'
import type { Prompts, PromptRole } from './prompts.ts'
import { definitionOf, type Tool } from './tools.ts'

/** The agent preset every worker Session runs under, which the bundle's patch defines. */
export const WORKER_PRESET = 'myagent-worker'

/** The permission preset of an unattended worker: it must be able to work without anyone to ask. */
export const WORKER_PERMISSION = 'danger-full-access'

/**
 * The tools a worker Session may call: files, search, the shell and its jobs, the web, skills, its todo list and
 * subagents. Nothing that asks or shows a person something, changes the profile, schedules work, or reaches another
 * Session — a worker reports through `myagent_report` instead, which is registered on it by name.
 */
export const WORKER_TOOLS = [
  'read', 'write', 'edit', 'read_image', 'glob', 'grep', 'bash', 'pwsh', 'job_output', 'job_list', 'job_kill',
  'web_search', 'web_fetch', 'skill', 'todo_write', 'subagent', 'list_subagent_models', 'send_message',
  'list_agents', 'interrupt_agent',
]

/** What the main Session's prompt section says about the system it fronts. */
export interface MainState {
  readonly acceptMode: string
  readonly panelPath: string
  readonly openTickets: number
  readonly waiting: number
}

export interface SessionsHost {
  readonly context: Context
  readonly prompts: Pick<Prompts, 'version' | 'revision'>
  readonly lifetime: AbortSignal
  /** The id of the operator's front-desk Session. */
  /**
   * The front desk's Session id: the one DSH gave, or the configured one when it has not been asked yet.
   *
   * A function rather than a value because DSH may reuse a blank Session and answer with an identity of its own — the
   * configured id is a request, and what comes back is the fact every later lookup has to use.
   */
  masterId(): string
  /** The directory the front desk's Session runs in, which is where it is created when it does not exist yet. */
  masterDir(): string
  /** Record the front desk's actual Session id. */
  bindMainSession(sessionId: string): void
  /** Read a Ticket, for a worker's prompt section and its tool guard. */
  ticket(ticketId: string): Ticket | undefined
  /** The Ticket a Session id belongs to, which is a recorded fact rather than a prefix. */
  ticketIdOfSession(sessionId: string): string | undefined
  /** Record the Session id DSH gave a Ticket's worker. */
  bindSession(ticketId: string, sessionId: string): void
  /**
   * Whether a Ticket has ended, which is when its worker's tools are denied.
   *
   * Answers true for a Ticket this deployment has no row for as well, and that is right for the one caller: a Session
   * whose Ticket cannot be read has no authorization to work under either way. It is not reachable through the guard,
   * which is only registered for a Ticket that existed when the Session was decorated — so the wording says "ended",
   * and a branch for the other case would be a branch nothing can reach.
   */
  ticketEnded(ticketId: string): boolean
  /**
   * Report the one fact about a Session that this class cannot act on: a Session whose id claims a Ticket that does
   * not exist, and which was therefore decorated with nothing.
   *
   * Narrow the way `DeliveryHost.replyLost` and `WatchdogHost.escalate` are narrow — the two ids and nothing else —
   * because `Sessions` is not handed the Engine or the health board: which subject accounts this fact, what the board
   * says about it and what retires it are all the Runtime's call, and a class that could reach the board could write
   * any line on it. This class has exactly one line to add, and the log line it already writes is not enough on its
   * own — a refusal only the log shows is a refusal the operator never reads (§2.2's second debt).
   */
  impostorRefused(sessionId: string, claimedTicketId: string): void
  /** Environment variables a worker's directory and prompt carry. */
  environment(ticket: Ticket): Record<string, string>
  /** The tools to register on the main Session (`ticket` absent) or on `ticket`'s worker. */
  tools(agent: Agent, ticket?: Ticket): Tool[]
  /** What the main Session's section reports about the system now. */
  mainState(): MainState
  /** Whether the Runtime is shutting down, so nothing new is created. */
  closing(): boolean
}

/** What `Sessions` registered for one agent, so a rebind can release it in reverse order. */
interface Binding {
  disposers: (() => void)[]
  revision: number
  role: PromptRole
  ticketId?: string
}

/** The session id a Ticket's worker is asked for, before DSH answers with the one it actually gave. */
export const workerSessionId = (ticketId: string): SessionId => `worker-${ticketId}` as SessionId
/** The Session a Ticket's worker runs under: the recorded one, or the one it was asked for. */
export const workerSessionOf = (ticket: Ticket): SessionId =>
  (ticket.execution?.sessionId ?? `worker-${ticket.id}`) as SessionId
/** The Ticket a session id belongs to by its shape, for a Session that was never recorded. */
export const ticketOfSession = (sessionId: string): string | undefined =>
  sessionId.startsWith('worker-') ? sessionId.slice('worker-'.length) : undefined

const truncate = (text: string, max: number): string =>
  text.length <= max ? text : `${text.slice(0, Math.max(0, max - 1))}…`
/** DSH's bound on a notice's one-line summary (`CONTEXT_SUMMARY_MAX_CHARS`); a longer one is rejected, not shortened. */
const SUMMARY_MAX_CHARS = 120

/** The section of a worker's system prompt that names its Ticket, its scope and how to report. */
/** The tool names DSH says it knows, when its refusal lists them; `undefined` when the message is not that refusal. */
export function knownToolsOf(message: string): readonly string[] | undefined {
  const tail = /known global tools: (.*)$/s.exec(message)?.[1]
  if (tail === undefined) return undefined
  const trimmed = tail.trim()
  return trimmed === '' || trimmed === '(none)' ? [] : trimmed.split(', ').filter(name => name !== '')
}

/** Every tool name DSH refused, in both the singular and the plural wording. */
export function refusedNamesOf(message: string): readonly string[] {
  const segment = /unknown global tools? ((?:"[^"]*"(?:,\s*)?)+)/.exec(message)?.[1]
  if (segment === undefined) return []
  return [...segment.matchAll(/"([^"]*)"/g)].map(match => match[1]!)
}

function workerSection(ticket: Ticket, environment: Record<string, string>): string {
  const report = latestReport(ticket)
  const lines = [
    '## Your Ticket',
    `- Ticket: ${ticket.id}`,
    `- Title: ${ticket.title}`,
    `- Directory: ${ticket.execution?.directory ?? '(not prepared yet)'}`,
    `- Authorized by: ${ticket.mandate.sender.id} (${ticket.mandate.via}) at ${ticket.mandate.at}`,
    `- Policy version: ${ticket.mandate.policyVersion}`,
    `- Stage: ${ticketStage(ticket)}`,
    '',
    '### Scope',
    ticket.mandate.scope,
  ]
  const variables = Object.entries(environment)
  if (variables.length > 0) {
    lines.push('', '### Environment', ...variables.map(([name, value]) => `- \`${name}\` = \`${value}\``))
  }
  if (report !== undefined) {
    lines.push('', '### Your last report', `${report.state}: ${truncate(report.summary, 4000)}`)
  }
  lines.push('', 'Report with `myagent_report` before your turn ends. Its `state` classifies your work; the system',
    'reads that field, never your prose.')
  return lines.join('\n')
}

/** The section of the main Session's system prompt that names the system it fronts. */
function mainSection(state: MainState): string {
  return [
    '## myagent',
    `You are the front desk of myagent. Accept mode: \`${state.acceptMode}\`. Panel: \`${state.panelPath}\`.`,
    `Open Tickets: ${state.openTickets}, of which waiting for a person: ${state.waiting}.`,
    'Open a Ticket with `myagent_create_ticket` for work that needs its own directory and time; answer directly for',
    'everything else.',
  ].join('\n')
}

export class Sessions {
  private readonly ctx: Context
  private readonly bindings = new Map<Agent, Binding>()
  /** The attempt each Ticket's worker was last launched for; see {@link attempt}. */
  private readonly attempts = new Map<string, string>()
  /** The sessions this class created, so `status` can tell an existing Session from one it never made. */
  private readonly known = new Set<string>()
  private agentDelivery?: AgentDelivery
  private readonly disposers: (() => void)[] = []

  constructor(private readonly host: SessionsHost) {
    this.ctx = host.context
    // A restored Session is bound when it appears, so a resume after a restart runs under the current prompts.
    // The listener body is contained: it runs inside DSH's own dispatch, where a throw is a fatal load failure that
    // takes the host process down, not a plugin error.
    this.disposers.push(this.ctx.on('agent/created', ({ agent }) => {
      this.decorateAgent(agent).catch((error: unknown) => {
        this.ctx.logger.warn('myagent could not decorate the Session %s: %s', agent.id, String(error))
      })
    }))
  }

  /** Idempotent delivery to DSH agents, created with the context that must outlive a Session swap. */
  get delivery(): AgentDelivery {
    return this.agentDelivery ??= new AgentDelivery(this.ctx)
  }

  /** Whether a Session exists, and whether its agent is alive and running a turn. */
  status(sessionId: string): { exists: boolean; running: boolean; busy: boolean } {
    const agent = this.ctx.agents.get(sessionId as SessionId)
    return { exists: this.known.has(sessionId) || agent !== undefined, running: agent !== undefined, busy: agent?.status === 'running' }
  }

  // --------------------------------------------------------------- Creation

  /**
   * Resolve a Session to its live agent, or `undefined` when DSH has none — no such Session, or one it will not hand
   * over. The distinction matters: only `undefined` may lead to creating a Session.
   */
  private async resolve(sessionId: SessionId): Promise<Agent | undefined> {
    const resolved = await this.ctx.sessionController.resolveAgent(sessionId).catch(() => undefined)
    if (resolved === undefined || !('agent' in resolved)) return undefined
    this.known.add(sessionId)
    return resolved.agent
  }

  /** The main Session's agent, creating it in `cwd` if absent. */
  async ensureMaster(cwd: string): Promise<Agent> {
    const existing = this.ctx.agents.get(this.host.masterId() as SessionId)
    if (existing !== undefined) { await this.decorate(existing, undefined); return existing }
    const restored = await this.resumeMaster()
    if (restored !== undefined) return restored
    if (this.host.closing()) throw new Error('myagent is stopping')
    const requested = this.host.masterId() as SessionId
    const made = await this.ctx.sessionController.create({ sessionId: requested, cwd })
    // DSH may reuse a blank Session and answer with another identity; its answer is the truth from here on, and it is
    // recorded, because everything that reaches the front desk later looks the Session up by id.
    const sessionId = made?.sessionId ?? requested
    if (sessionId !== requested) this.host.bindMainSession(sessionId)
    const created = await this.resolve(sessionId)
    if (created === undefined) throw new Error(`DSH created the main Session ${sessionId} but did not hand it over`)
    await this.ctx.sessionController.rename({ sessionId, title: 'myagent' }).catch(() => undefined)
    await this.decorate(created, undefined)
    return created
  }

  /** The main Session's agent when it already exists, decorated and ready. */
  async resumeMaster(): Promise<Agent | undefined> {
    const existing = this.ctx.agents.get(this.host.masterId() as SessionId)
    if (existing !== undefined) { await this.decorate(existing, undefined); return existing }
    const restored = await this.resolve(this.host.masterId() as SessionId)
    if (restored === undefined) return undefined
    await this.decorate(restored, undefined)
    return restored
  }

  /**
   * A Ticket's worker agent, creating its Session in the Ticket's own directory if absent.
   * @param model `provider/model` for this worker, or the profile's default when absent or empty.
   */
  async ensure(ticket: Ticket, model?: string): Promise<Agent> {
    const directory = ticket.execution?.directory
    if (directory === undefined) throw new Error(`Ticket ${ticket.id} has no directory yet`)
    const existing = await this.resume(ticket, model)
    if (existing !== undefined) return existing
    if (this.host.closing()) throw new Error('myagent is stopping')
    const requested = workerSessionId(ticket.id)
    const created = await this.ctx.sessionController.create({ sessionId: requested, cwd: directory, agentPreset: WORKER_PRESET })
    // DSH may reuse a blank Session and answer with another identity; from here on, its answer is the truth.
    const sessionId = created?.sessionId ?? requested
    if (sessionId !== requested) this.host.bindSession(ticket.id, sessionId)
    const agent = await this.resolve(sessionId)
    if (agent === undefined) throw new Error(`DSH created the worker Session ${sessionId} but did not hand it over`)
    await this.authorize(agent, model)
    await this.ctx.sessionController.rename({ sessionId, title: truncate(ticket.title, 60) }).catch(() => undefined)
    await this.decorate(agent, { ...ticket, execution: { ...ticket.execution!, sessionId } })
    return agent
  }

  /** Point a Session at `provider/model`, when that is what the settings say. */
  private async selectModel(sessionId: SessionId, model?: string): Promise<void> {
    const slash = model?.indexOf('/') ?? -1
    if (model === undefined || slash <= 0) return
    await this.ctx.sessionController.selectModel({
      sessionId, provider: model.slice(0, slash), model: model.slice(slash + 1),
    }).catch((error: unknown) => {
      this.ctx.logger.warn('myagent could not select the model %s for %s: %s', model, sessionId, String(error))
    })
  }

  /**
   * A Ticket's worker agent when its Session already exists, configured and ready.
   *
   * A restored Session is configured exactly like a new one. It may have been left half-configured by a launch that
   * failed partway — DSH announces a new agent before `create` returns, so a listener that throws there leaves a
   * Session that never received its permission preset. Resuming such a Session without re-authorizing it produces a
   * worker that cannot work: an unattended turn that ends blocked, waiting for an approval nobody can give.
   */
  async resume(ticket: Ticket, model?: string): Promise<Agent | undefined> {
    const sessionId = workerSessionOf(ticket)
    const existing = this.ctx.agents.get(sessionId)
    if (existing !== undefined) { await this.authorize(existing, model); await this.decorate(existing, ticket); return existing }
    const restored = await this.resolve(sessionId)
    if (restored === undefined) return undefined
    await this.authorize(restored, model)
    await this.decorate(restored, ticket)
    return restored
  }

  /**
   * Give a worker the authorization its Ticket runs under: nobody is there to ask, so it works with full access, and
   * its own directory plus the end of its Ticket are the boundary rather than a per-call approval. Setting what is
   * already set writes nothing.
   */
  private async authorize(agent: Agent, model?: string): Promise<void> {
    const presets = this.ctx.permissionPresets
    if (presets.current(agent.session) !== WORKER_PERMISSION) presets.set(agent.session, WORKER_PERMISSION)
    await this.selectModel(agent.id, model)
  }

  // -------------------------------------------------------------- Decoration

  /** Decorate an agent that appeared, by what its session id says it is. */
  private async decorateAgent(agent: Agent): Promise<void> {
    const ticketId = this.host.ticketIdOfSession(agent.id)
    if (ticketId === undefined) {
      if (agent.id === this.host.masterId()) await this.decorate(agent, undefined)
      return
    }
    const ticket = this.host.ticket(ticketId)
    if (ticket === undefined) {
      // A Session whose id merely LOOKS like a worker's, with no Ticket behind it. `ticketIdOfSession` answers by
      // SHAPE (`worker-<id>`), deliberately, so that a Session myagent never recorded can still be recognized — which
      // means anyone who can create a Session with such a name reaches this branch.
      //
      // Passing the `undefined` on would be a privilege escalation, not a harmless default: `decorate` reads
      // `ticket === undefined` as "this is the front desk" and hands over the orchestrator's management tools —
      // create a Ticket (which then runs with full access), stop one, retry one, answer one. Two different facts
      // ("this is the main Session" and "I could not find that Ticket") must not share one value; this is the fifth
      // time that shape has appeared here and the first whose fallback grants permission (§0.10).
      //
      // So: no decoration at all, which means no myagent tools and no myagent prompt section. Reported rather than
      // silent, because a refusal nobody can see is how S33's false audit line happened — and reported in BOTH places
      // this class can reach, because they have different readers: the log is where a developer looks afterwards, the
      // health board is what the operator is actually reading while it happens. The board is reached through the narrow
      // `impostorRefused` port member rather than through a health board this class does not hold.
      this.ctx.logger.warn(
        'myagent — Session %s is named like a worker\'s but no Ticket %s exists, so it gets no myagent tools',
        agent.id, ticketId,
      )
      this.host.impostorRefused(agent.id, ticketId)
      return
    }
    await this.decorate(agent, ticket)
  }

  /**
   * Limit what an agent may call, tell it what it is, and register its tools — before its first turn, and again when
   * the prompts changed. Registration is idempotent: a repeated call releases what it registered first.
   */
  async decorate(agent: Agent, ticket: Ticket | undefined): Promise<void> {
    const revision = this.host.prompts.revision()
    // A triage attempt gets the triage prompt: same Ticket facts, a different job (decide, do not do).
    const role: PromptRole = ticket === undefined
      ? 'orchestrator'
      : ticket.assignments.at(-1)?.role === 'triage' ? 'triage' : 'worker'
    const binding = this.bindings.get(agent)
    if (binding !== undefined && binding.revision === revision && binding.role === role
      && binding.ticketId === ticket?.id) return
    if (binding !== undefined) this.release(agent)
    const prompt = this.host.prompts.version(role)
    const section = ticket === undefined ? mainSection(this.host.mainState()) : workerSection(ticket, this.host.environment(ticket))
    // Interpolation is off: a prompt is the operator's own text, and a literal brace in it must not fail an assembly.
    const text = () => `${prompt.text}\n\n${section}`
    const disposers: (() => void)[] = [
      agent.ctx.systemPrompt.section({ name: 'myagent', order: 100, interpolate: false, text }),
    ]
    if (ticket !== undefined) {
      // A worker keeps the profile's work tools and loses everything aimed at a person. `restrict` accepts only names
      // DSH knows globally, so the list is filtered, and `myagent_report` is not in it: it is registered on this
      // agent's own scope below, which a restriction does not mask.
      disposers.push(this.restrict(agent, ticket))
      // The refusal a Session gets once its Ticket is over. It used to stop at "New work needs a new Ticket", which
      // names the requirement and not the way to meet it — and this is the message a person meets who opened a Session
      // in the GUI, picked the worker preset and wondered why nothing reached the panel. A refusal is a teaching
      // moment, so it names the three ways work actually enters: none of them is this Session.
      disposers.push(agent.ctx.tools.guard(() => this.host.ticketEnded(ticket.id)
        ? `Ticket ${ticket.id} has ended, so this Session's authorization ended with it. New work needs a new Ticket: `
          + 'dispatch it from the panel\'s 派活 tab, ask in the main Session (myagent-main), '
          + 'or drop a request file in the inbox directory.'
        : undefined))
    }
    for (const tool of this.host.tools(agent, ticket)) disposers.push(agent.ctx.tools.register(definitionOf(tool)))
    this.bindings.set(agent, { disposers, revision, role, ticketId: ticket?.id })
  }

  /**
   * Limit a worker to the work tools DSH will accept, and refuse to run it at all when none are acceptable.
   *
   * `restrict` throws for a name it does not know globally, and which names those are belongs to the profile, not to
   * this code. So an unknown name is dropped and the rest is tried again. Falling all the way through is not a warning:
   * an unattended worker with no restriction is worse than a Ticket that does not run, so the launch fails instead and
   * the reason lands on the Assignment.
   */
  private restrict(agent: Agent, ticket: Ticket): () => void {
    const parent = scopeParentOf(agent)
    let allow = WORKER_TOOLS.filter(name => agent.ctx.tools.get(name, parent) !== undefined)
    const dropped: string[] = []
    for (;;) {
      try {
        const dispose = agent.ctx.tools.restrict({ allow })
        if (dropped.length > 0) {
          this.ctx.logger.warn('myagent restricted the worker for Ticket %s to %s; DSH does not know %s globally',
            ticket.id, allow.join(', '), dropped.join(', '))
        }
        return dispose
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        // DSH refuses in one message and names every unknown tool, singular or plural
        // (`unknown global tool "x"` vs `unknown global tools "x", "y"`), and it also lists what it does know.
        // Prefer the known list: it does not depend on the wording of the refusal, and one pass replaces the loop.
        // A regex that only matched the singular form survived every test and failed every launch on a profile
        // missing two or more of the names below — the exact case this recovery exists for.
        const known = knownToolsOf(message)
        const next = known === undefined
          ? allow.filter(name => !refusedNamesOf(message).includes(name))
          : allow.filter(name => known.includes(name))
        if (next.length === allow.length) throw error
        dropped.push(...allow.filter(name => !next.includes(name)))
        allow = next
        if (allow.length === 0) {
          throw new Error(`DSH accepts no work tool for a worker Session; refusing to run Ticket ${ticket.id} unrestricted`)
        }
      }
    }
  }

  /** Release what was registered for an agent, in reverse order. */
  private release(agent: Agent): void {
    const binding = this.bindings.get(agent)
    if (binding === undefined) return
    this.bindings.delete(agent)
    for (const dispose of binding.disposers.splice(0).reverse()) {
      try { dispose() }
      catch (error) { this.ctx.logger.warn('myagent could not release what it registered for a Session: %s', String(error)) }
    }
  }

  /** Forget an agent that left the registry, so a restored one is decorated again. */
  forget(agent: Agent): void { this.release(agent) }

  // ---------------------------------------------------------------- Delivery

  /** Put a notice in the main Session's history without waking it. */
  async notify(text: string, requestId: string): Promise<void> {
    // Resolve or create, never give up quietly: returning nothing here meant a deployment whose main Session was
    // missing lost EVERY report to the front desk with a clean health board — the one failure an unattended system
    // must not hide. Creating it on demand is what "the front desk is on demand" already means everywhere else.
    const agent = await this.ensureMaster(this.host.masterDir())
    await this.delivery.send(agent, requestId, text, { inject: truncate(text, SUMMARY_MAX_CHARS) }, this.host.lifetime)
  }

  /**
   * Wake the main Session with a message it answers in its next turn, for a Ticket that waits for a person.
   * @returns false when there is no front desk yet, so the caller knows nobody was told.
   */
  async relay(requestId: string, text: string): Promise<boolean> {
    // Resolve or create, never give up quietly: returning nothing here meant a deployment whose main Session was
    // missing lost EVERY report to the front desk with a clean health board — the one failure an unattended system
    // must not hide. Creating it on demand is what "the front desk is on demand" already means everywhere else.
    const agent = await this.ensureMaster(this.host.masterDir())
    await this.delivery.send(agent, requestId, text, 'queue', this.host.lifetime)
    return true
  }

  /** Wake the main Session with a message it answers in its next turn. */
  async promptMaster(requestId: string, text: string): Promise<void> {
    const agent = await this.resumeMaster()
    if (agent === undefined) throw new Error('The main Session does not exist yet')
    await this.delivery.send(agent, requestId, text, 'queue', this.host.lifetime)
  }

  /**
   * Wake a Ticket's worker with `text`, creating its Session when this is its first launch.
   * The delivery is idempotent under `requestId`, so a retried launch hands the work over once.
   */
  /**
   * Which attempt a Ticket's worker was last launched for, so its report can name the attempt it belongs to.
   *
   * A launch is the only moment this is knowable: the worker's Session outlives the attempt, and its tools are
   * registered once per Session rather than once per launch.
   */
  attempt(ticketId: string): string | undefined { return this.attempts.get(ticketId) }

  async promptWorker(ticket: Ticket, requestId: string, text: string, model?: string): Promise<void> {
    // `launch:<assignmentId>` is the request id the Executor uses for a launch; an input delivery is not a new attempt.
    if (requestId.startsWith('launch:')) this.attempts.set(ticket.id, requestId.slice('launch:'.length))
    const agent = await this.ensure(ticket, model)
    await this.delivery.send(agent, requestId, text, 'queue', this.host.lifetime)
  }

  /** Release every registration this class made. */
  dispose(): void {
    for (const dispose of this.disposers.splice(0).reverse()) {
      try { dispose() } catch { /* a listener that will not release must not hold the shutdown */ }
    }
    for (const agent of [...this.bindings.keys()]) this.release(agent)
  }
}
