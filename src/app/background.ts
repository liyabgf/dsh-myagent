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

/** What this system uses of DSH's subagents: listing a worker's children and releasing them. */
interface Subagents {
  listChildren(parentSessionId: string): Promise<readonly { id: string }[]>
  drainChildren(parent: Agent, childIds: readonly string[]): Promise<void>
}

/** How long a kill waits for a job to end, collecting that end so the worker is not woken to hear of it. */
const KILL_WAIT_MS = 10_000
/** How long a release of subagents may take; it can hold up a shutdown, so DSH's own callers bound it too. */
const DRAIN_LIMIT_MS = 10_000

const jobsOf = (ctx: Context): Jobs | undefined => ctx.get('jobs') as Jobs | undefined
const subagentsOf = (ctx: Context): Subagents | undefined => ctx.get('subagents') as Subagents | undefined
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
  if (failures.length > 0) throw new AggregateError(failures, `Killing the shell jobs of ${sessionId} failed`)
}

/**
 * Release a worker's live subagents, for a bounded time. DSH delivers each one's end to the worker before the release
 * returns, which wakes it, so its turn is cancelled after — keeping its inbox when `keepInbox` — and the stop ends with
 * that turn.
 */
export async function stopSubagents(ctx: Context, agent: Agent, keepInbox = false): Promise<void> {
  const subagents = subagentsOf(ctx)
  if (subagents === undefined) return
  // The catalog lists every subagent the Session ever had; one that already ended has no agent.
  const live_ = (await subagents.listChildren(agent.id)).map(child => child.id)
    .filter(id => ctx.agents.get(id as SessionId) !== undefined)
  if (live_.length === 0) return
  try { await until(subagents.drainChildren(agent, live_), undefined, DRAIN_LIMIT_MS) }
  finally {
    if (agent.status !== 'idle') agent.cancel({ kind: 'user' }, { keepInbox })
    await until(agent.whenIdle(), undefined, DRAIN_LIMIT_MS)
  }
}

/** Stop everything a Session runs in the background: its shell jobs and its subagents. */
export async function stopBackground(ctx: Context, sessionId: string, reason: string, keepInbox = false): Promise<void> {
  const failures: unknown[] = []
  await killJobs(ctx, sessionId, reason).catch((error: unknown) => { failures.push(error) })
  const agent = ctx.agents.get(sessionId as SessionId)
  if (agent !== undefined) {
    await stopSubagents(ctx, agent, keepInbox).catch((error: unknown) => { failures.push(error) })
  }
  if (failures.length > 0) throw new AggregateError(failures, `Stopping the background work of ${sessionId} failed`)
}
