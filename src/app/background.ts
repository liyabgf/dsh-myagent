/**
 * A worker's background work in DSH: the shell jobs its Session owns and the subagents it started.
 *
 * Both outlive the turn that started them, so a stop that only cancelled the turn would leave work running under an
 * authorization that was withdrawn. A profile without either service has none, and one failure stops nothing else.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SessionId } from '@deepseek-ai/dsh-session'

/** What this system uses of DSH's job registry: the jobs a Session can see, a wait for one, and a kill. */
interface Jobs {
  list(caller: string): readonly { id: string; owner?: string; status: string }[]
  wait(id: string, timeoutMs: number, caller: string): Promise<unknown>
  kill(id: string, caller: string, reason?: string): unknown
}

/** What this system uses of DSH's optional subagents service. */
interface Subagents {
  listDescendants(rootSessionId: string, signal?: AbortSignal): Promise<readonly { id: string }[]>
  drainDescendants(parents: readonly Agent[]): Promise<void>
  rootOf(caller: Agent): Agent
}

/** An older host shape kept only when both legacy methods are present. */
interface LegacySubagents {
  listChildren(parentSessionId: string): Promise<readonly { id: string }[]>
  drainChildren(parent: Agent, childIds: readonly string[]): Promise<void>
}

type SubagentsService = Subagents | LegacySubagents

const isFunction = (value: unknown): value is (...args: never[]) => unknown => typeof value === 'function'

/** How long a kill waits for a job to end, collecting that end so the worker is not woken to hear of it. */
const KILL_WAIT_MS = 10_000
/** Strict owner join: Runtime bounds callers without dropping the actual cleanup Promise. */
export interface BackgroundStopOptions {
  readonly cancelTurn?: boolean
  readonly shouldStop?: () => boolean
  readonly agent?: Agent
}

const jobsOf = (ctx: Context): Jobs | undefined => ctx.get('jobs') as Jobs | undefined
const subagentsOf = (ctx: Context): SubagentsService | undefined => {
  const raw = ctx.get('subagents')
  if (raw === undefined || raw === null) return undefined
  const candidate = raw as Record<string, unknown>
  if (isFunction(candidate['listDescendants']) && isFunction(candidate['drainDescendants']) && isFunction(candidate['rootOf'])) return raw as Subagents
  if (isFunction(candidate['listChildren']) && isFunction(candidate['drainChildren'])) return raw as LegacySubagents
  throw new Error('The subagents service is present but has no supported list/drain contract')
}
const live = (status: string): boolean => status === 'running' || status === 'stopping'
/** The jobs this Session owns that still run. */
const owned = (jobs: Jobs, sessionId: string) =>
  jobs.list(sessionId).filter(job => job.owner === sessionId && live(job.status))

/** `work`, or false once `signal` aborts or `ms` pass first. */
export function until<T>(work: Promise<T>, signal?: AbortSignal, ms?: number): Promise<T | false> {
  if (signal?.aborted) return Promise.resolve(false)
  let stop!: () => void
  const stopped = new Promise<false>(resolve => { stop = () => { resolve(false) } })
  signal?.addEventListener('abort', stop, { once: true })
  const timer = ms === undefined ? undefined : setTimeout(stop, ms)
  timer?.unref?.()
  return Promise.race([work, stopped]).finally(() => { signal?.removeEventListener('abort', stop); clearTimeout(timer) })
}

/** Kill the shell jobs a Session owns, collecting each end. */
export async function killJobs(ctx: Context, sessionId: string, reason: string): Promise<void> {
  const jobs = jobsOf(ctx)
  const running = jobs === undefined ? [] : owned(jobs, sessionId)
  if (running.length === 0) return
  // The waits start before the kills, so each end counts as collected and wakes nobody.
  const collected = running.map(job => jobs!.wait(job.id, KILL_WAIT_MS, sessionId).catch(() => undefined))
  const failures: unknown[] = []
  for (const job of running) {
    try { jobs!.kill(job.id, sessionId, reason) } catch (error) {
      // 【误报修正】A kill that fails because the job ended on its own is a success in disguise: the goal was
      // "this job stops", and it did — between the listing and the kill is exactly the window where a worker's
      // own job finishes. VERIFY rather than guess at the error text: re-read the registry, and only a job that
      // is STILL live after a failed kill is a real refusal. (Message-matching would couple us to DSH's wording;
      // the registry is the fact.) The first shape of this bug: a ticket with ten concurrent background jobs
      // completes them one by one, and every completion turns the ticket's own stop into a red health line.
      const stillLive = jobs!.list(sessionId).some(item => item.id === job.id && live(item.status))
      if (!stillLive) continue
      failures.push(error)
    }
  }
  await Promise.all(collected)
  // Registry waits are bounded collection, not proof that the process ended.
  const remaining = owned(jobs!, sessionId)
  if (remaining.length > 0) failures.push(new Error(`Jobs still running for ${sessionId}: ${remaining.map(job => job.id).join(', ')}`))
  if (failures.length > 0) throw new AggregateError(failures, `Killing the shell jobs of ${sessionId} failed`)
}

/**
 * Release a worker's live subagents and join the real cleanup. DSH delivers each one's end to the worker before the release
 * returns, which wakes it, so its turn is cancelled after — keeping its inbox when `keepInbox` — and the stop ends with
 * that turn.
 *
 * 【误报修正的同族】A drain that fails because a child ended ON ITS OWN between the listing and the drain is
 * success in disguise — the goal was "these subagents stop", and they did. Verified by re-listing, exactly as
 * `killJobs` verifies a failed kill against the job registry: message-matching would couple us to DSH's wording,
 * the agent list is the fact. Production showed this shape a day after the killJobs fix: the same red line,
 * from the OTHER half of `stopBackground`.
 */
export async function stopSubagents(ctx: Context, agent: Agent, keepInbox = false, options: BackgroundStopOptions = {}): Promise<void> {
  const subagents = subagentsOf(ctx)
  if (subagents === undefined || options.shouldStop?.() === false) return
  const cancelParent = async (): Promise<void> => {
    if (options.cancelTurn === false || options.shouldStop?.() === false) return
    if (ctx.agents.get(agent.id) !== agent) return
    if (agent.status !== 'idle') agent.cancel({ kind: 'user' }, { keepInbox })
    await agent.whenIdle()
  }
  // The catalog lists every subagent the Session ever had; one that already ended has no agent.
  const live = (id: string) => ctx.agents.get(id as SessionId) !== undefined
  const modern = 'listDescendants' in subagents
  const list = () => modern
    ? subagents.listDescendants(agent.id)
    : subagents.listChildren(agent.id)
  if (modern) {
    // drainDescendants closes admission and waits for pending startup as well as
    // materialized children, so it must run even when the catalog is currently empty.
    // It accepts exact roots only; promote only a true root from its actual runtime tree.
    const root = subagents.rootOf(agent)
    if (root !== agent) {
      throw new Error(`Cannot drain descendants of ${agent.id}: an exact subagent tree root is required (actual tree root ${root.id})`)
    }
    try {
      await subagents.drainDescendants([root])
    } finally {
      await cancelParent()
    }
    return
  }
  const liveDescendants = (await list()).filter(child => live(child.id))
  if (liveDescendants.length === 0) return
  if (options.shouldStop?.() === false) return
  try {
    await subagents.drainChildren(agent, liveDescendants.map(child => child.id))
  } catch (error) {
    // Re-list: every child that no longer has an agent ended on its own. Only a
    // child still live after the failed drain is a real refusal.
    const stillLive = (await list()).some(child => live(child.id))
    if (!stillLive) return
    throw error
  } finally {
    await cancelParent()
  }
}

/** Stop everything a Session runs in the background: its shell jobs and its subagents. */
export async function stopBackground(ctx: Context, sessionId: string, reason: string, keepInbox = false, options: BackgroundStopOptions = {}): Promise<void> {
  if (options.shouldStop?.() === false) return
  const agent = options.agent ?? ctx.agents.get(sessionId as SessionId)
  const failures: unknown[] = []
  await killJobs(ctx, sessionId, reason).catch((error: unknown) => { failures.push(error) })
  if (agent !== undefined && options.shouldStop?.() !== false && ctx.agents.get(agent.id) === agent) {
    await stopSubagents(ctx, agent, keepInbox, options).catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length > 0) throw new AggregateError(failures, `Stopping the background work of ${sessionId} failed`)
}
