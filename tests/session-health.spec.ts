/**
 * What the health board says about a Session that named itself after a Ticket which does not exist.
 *
 * S44 (`docs/v2/06-security-risk-register.md` §2.2) was a privilege escalation: `ticketOfSession` answers by SHAPE, so
 * a Session myagent never created and no Ticket ever authorized reached `decorateAgent` looking like a worker, and the
 * `undefined` it came back with was read as "this is the front desk" — which handed over `myagent_create_ticket`, and a
 * Ticket created that way runs with full access. The fix refuses to decorate such a Session at all.
 * `tests/session-decoration.spec.ts` pins the refusal itself. This file pins the half of §2.2's debt that was still
 * open: the refusal reached only `logger.warn`, and *a refusal nobody can see is how S33's false audit line happened*.
 * It now reaches the `sessions` health entry, which is what the panel shows and what the operator reads.
 *
 * Three properties are asserted, and each one is a defect this project has already paid for:
 *
 * 1. **It is accounted under its own subject.** `SessionHealth` keys every problem by subject — a ticketId or
 *    `MAIN_SESSION` — because one shared slot is how N9 happened: one subject's observation overwrote another's, with
 *    no acknowledgement, and a quiet pass could erase a problem that was live. An impostor is not any Ticket's problem
 *    (there is no Ticket) and not the front desk's (`createMainSession` clears `MAIN_SESSION` when it succeeds, so the
 *    front desk's good news would take a live security refusal with it). It gets `impostorSubject(sessionId)` — its own
 *    key, one per Session id, so two impostors are two subjects and neither can overwrite or retire the other.
 *    Tests 2 and 3 are the guards; a single shared impostor key reddens test 3.
 * 2. **It names both ids.** "A Session was refused" is not actionable: an operator cannot tell which Session to close or
 *    which Ticket it claimed. The detail carries `worker-<id>` and the `<id>` it claimed. Test 1 strips the Session id
 *    out of the detail before looking for the ticket id, because the Session id *contains* it — an assertion that reads
 *    `toContain(ticketId)` on that detail is satisfied by the Session id alone and cannot fail (discipline 0.8, and the
 *    exact shape that made the first two S44 regression attempts empty).
 * 3. **It goes away.** A permanent false alarm is its own defect (S38/S41/F2), so the entry is retired by the fact that
 *    ends the condition: the Session leaving the registry, which DSH announces as `agent/disposed`. Deliberately not a
 *    non-error turn end — for a 429 a completed turn is evidence the Session can reach the model again, while the fact
 *    here is "this Session has no authorization and was given nothing", which a turn it completes changes not at all.
 *    Test 4 retires one impostor and keeps the other, then retires the last one and asks the quiet pass to say so.
 *
 * The log line stays: the board is added to it, not substituted for it, and test 1 asserts both. The stub host's logger
 * swallows everything, so the warn is recorded by replacing it here — `tests/helpers/*` is out of this package's
 * boundary, and a helper that cannot be edited must not be a reason to leave an assertion unmade.
 */
import { utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import type { HealthState } from '../src/app/health.ts'
import type { Runtime } from '../src/app/runtime.ts'
import { deployment, type Deployment } from './helpers/deployment.ts'
import { fakeAgent, KNOWN_GLOBAL_TOOLS, wait, type AgentRecord, type RestrictPolicy, type StubHost } from './helpers/host.ts'

const workerId = (ticketId: string): string => `worker-${ticketId}`
const signal = (): AbortSignal => new AbortController().signal

/** Ticket ids no request ever produced: the shape `ticketOfSession` answers to, with nothing behind it. */
const UNBACKED = '0'.repeat(32)
const ALSO_UNBACKED = '1'.repeat(32)

/**
 * The answer a plain stub host gives `restrict`, which `fakeAgent` requires and no path here reaches: an impostor is
 * refused before the worker path, and the front desk is neither restricted nor guarded.
 */
const POLICY: RestrictPolicy = { knownTools: KNOWN_GLOBAL_TOOLS, fails: false }

/** Ask the system to look now and run what is due, then let the pump finish. */
async function settle(runtime: Runtime, ms = 80): Promise<void> {
  await runtime.nudge()
  await wait(ms)
  runtime.passes.requestPass()
  await wait(ms)
}

/** The health line the panel's header and its health table both read. */
const board = (runtime: Runtime): HealthState => runtime.health.entry('sessions').snapshot()
/** Whether the operator's board shows a Sessions problem at all, which is the claim the page makes. */
const onBoard = (runtime: Runtime): boolean => runtime.health.problems().some(problem => problem.name === 'sessions')

/**
 * Announce a Session the way DSH does when one appears, and hold it the way DSH's registry does.
 *
 * Built by the stub's own factory rather than announced as a bare `{ id }`, for the reason recorded in
 * `tests/session-decoration.spec.ts`: `decorateAgent` reaches for more of the agent than its id, and a throw there is
 * swallowed by the `catch` on its own listener — so a half-built agent makes "refused" and "never got that far" the
 * same observation.
 */
function announce(host: StubHost, id: string): AgentRecord {
  const agent = fakeAgent(id, host.tools, host.restrictions, host.sections, host.guards, POLICY)
  host.agents.set(id, agent)
  host.emit('agent/created', { agent })
  return agent
}

/** Dispose a Session the way DSH does: out of the registry, then announced to every listener. */
function dispose(host: StubHost, agent: AgentRecord): void {
  host.agents.delete(agent.id)
  host.emit('agent/disposed', { agent })
}

/**
 * Record what the system logs at warn, which the stub otherwise drops.
 *
 * W2 keeps the existing `logger.warn` — the board is a second reader, not a replacement — and "kept" is a claim that
 * needs an observation like any other.
 */
function recordWarns(host: StubHost): string[] {
  const lines: string[] = []
  const logger = host.ctx.logger as unknown as { warn(...args: unknown[]): void }
  logger.warn = (...args: unknown[]): void => { lines.push(args.map(arg => String(arg)).join(' ')) }
  return lines
}

/** One Ticket of its own, accepted from the inbox and with its worker launched. */
async function started(context: Deployment, text = '写一份摘要'): Promise<string> {
  const known = new Set(context.runtime.store.tickets.list().map(ticket => ticket.id))
  const path = join(context.inbox, `task-${Math.random().toString(36).slice(2, 8)}.md`)
  writeFileSync(path, text, 'utf8')
  const at = new Date(Date.now() - 5_000)
  utimesSync(path, at, at)
  await settle(context.runtime)
  const fresh = context.runtime.store.tickets.list().filter(ticket => !known.has(ticket.id))
  // The premise asserted rather than assumed: what follows needs a Ticket with a running attempt, and a request that
  // was not accepted would leave every later assertion reading a board nothing had written to.
  expect(fresh).toHaveLength(1)
  expect(fresh[0]!.assignments.at(-1)!.state).toBe('running')
  return fresh[0]!.id
}

/**
 * One upstream failure, arriving the way DSH delivers it: an `agent/error` for the Session, then that turn ending with
 * the reason DSH wrote into the Session's own log. Injected through the host's event surface and never through a hook
 * in `src/`, so the listeners under test are the ones that ship.
 */
function failUpstream(host: StubHost, sessionId: string, message: string): void {
  const agent = host.agents.get(sessionId)!
  const error = new Error(message)
  error.name = 'LlmError'
  host.emit('agent/error', { agent, error })
  agent.session.events.push({
    seq: agent.session.events.length + 1, type: 'turn/end',
    data: { turn: 1, reason: { kind: 'error', error: { message, code: 'RATE_LIMIT', status: 429 } } },
  })
  agent.status = 'idle'
  host.emit('agent/status', { agent, status: 'idle' })
}

/** The worker's own report tool, which is how a Ticket ends the ordinary way. */
const report = (context: Deployment, id: string, args: unknown): Promise<unknown> =>
  context.host.tool(workerId(id), 'myagent_report')!.definition.execute(args, { signal: signal() })

describe('a Session named after a Ticket that does not exist, on the health board', () => {
  it('says so, and names the Session and the Ticket it claimed', async () => {
    const context = await deployment('auto')
    const { host, runtime } = context
    try {
      const warns = recordWarns(host)
      // The control, and the premise of the assertion that follows: the board starts quiet, and announcing a Session
      // that IS legitimate — the front desk, through the identical mechanism — leaves it quiet. Without this half,
      // "the board is red" could be anything a startup wrote, and "it is red because a refusal was reported" would be
      // an inference. Proving the fixture is alive before asserting on it is what the two empty S44 attempts lacked.
      await settle(runtime)
      expect(board(runtime)).toMatchObject({ ok: true })
      expect(board(runtime).detail).toContain('no Session problem is live')
      announce(host, runtime.machine.mainSessionId)
      await settle(runtime)
      expect(onBoard(runtime)).toBe(false)

      const impostor = announce(host, workerId(UNBACKED))
      await settle(runtime)

      expect(board(runtime)).toMatchObject({ ok: false })
      expect(onBoard(runtime)).toBe(true)
      // The Session id, which is what an operator has to close.
      expect(board(runtime).detail).toContain(impostor.id)
      // And the Ticket id it claimed, looked for in what is left once the Session id is taken out: the Session id is
      // `worker-<ticketId>`, so an assertion that did not strip it first would be satisfied by the Session id alone and
      // could not fail — the hollow-assertion shape discipline 0.8 exists to catch.
      expect(board(runtime).detail!.replace(impostor.id, '')).toContain(UNBACKED)
      expect(board(runtime).detail).toContain('does not exist')
      // Both halves of the refusal, kept: the log for whoever reads it afterwards, the board for whoever is watching.
      expect(warns.some(line => line.includes(impostor.id) && line.includes('named like a worker'))).toBe(true)
      // The board line reports a refusal, so the refusal has to be one: nothing was registered on this Session.
      expect(host.toolsOf(impostor.id)).toEqual([])
    } finally { await runtime.stop() }
  })

  it('survives an unrelated Ticket’s problem and that Ticket ending', async () => {
    const context = await deployment('auto')
    const { host, runtime } = context
    try {
      const impostor = announce(host, workerId(UNBACKED))
      await settle(runtime)
      expect(board(runtime)).toMatchObject({ ok: false })

      // Another subject's problem, live at the same time. Both are named, which is the observation a shared slot
      // cannot produce: the second complaint would have overwritten the first with no acknowledgement (N9).
      const id = await started(context)
      failUpstream(host, workerId(id), '429: Rate limit: 60 requests per minute per account.')
      await settle(runtime)
      expect(board(runtime)).toMatchObject({ ok: false })
      expect(board(runtime).detail).toContain(impostor.id)
      expect(board(runtime).detail).toContain(id)

      // That Ticket ends the ordinary way. Its own line goes, and the refusal — which is not its business and not its
      // subject — stays.
      await report(context, id, { state: 'ready', summary: '做完了。' })
      await settle(runtime)
      expect(runtime.store.tickets.get(id)!.ended?.outcome).toBe('done')
      expect(board(runtime)).toMatchObject({ ok: false })
      expect(board(runtime).detail).toContain(impostor.id)
      expect(board(runtime).detail!).not.toContain(id)

      // And a quiet pass is not evidence that nothing is wrong: two more of them leave the live refusal on the board,
      // because `summarize` is guarded on the account being empty rather than on the pass having nothing to say.
      await settle(runtime)
      runtime.passes.requestPass()
      await wait(80)
      expect(onBoard(runtime)).toBe(true)
      expect(board(runtime).detail).toContain(impostor.id)
      // The header the operator reads first still counts it, rather than reporting a system that is fine.
      expect(runtime.health.entry('runtime').snapshot().detail).toContain('problem(s)')
    } finally { await runtime.stop() }
  })

  it('survives the front desk’s own recovery, which clears MAIN_SESSION and nothing else', async () => {
    const context = await deployment('auto')
    const { host, runtime } = context
    try {
      const impostor = announce(host, workerId(UNBACKED))
      await settle(runtime)
      expect(board(runtime)).toMatchObject({ ok: false })

      // The front desk's own problem, made live first: a `clear(MAIN_SESSION)` that finds nothing is a no-op, so
      // asserting only after a successful create would pass whether the impostor shares that subject or not — an
      // assertion that cannot fail. This is the half that makes the routing choice observable.
      expect((await runtime.createMainSession()).error).toBeUndefined()
      const frontDesk = host.agents.get(runtime.machine.mainSessionId)!
      host.emit('agent/error', { agent: frontDesk, error: new Error('ECONNREFUSED: the provider closed the connection') })
      await settle(runtime)
      expect(board(runtime).detail).toContain('ECONNREFUSED')
      expect(board(runtime).detail).toContain(impostor.id)

      // The front desk recovers, which clears its own subject and only its own.
      expect((await runtime.createMainSession()).error).toBeUndefined()
      await settle(runtime)
      expect(board(runtime)).toMatchObject({ ok: false })
      expect(board(runtime).detail).toContain(impostor.id)
      expect(board(runtime).detail!).not.toContain('ECONNREFUSED')
    } finally { await runtime.stop() }
  })

  it('accounts two impostors separately, and retires the line when the Session is gone', async () => {
    const context = await deployment('auto')
    const { host, runtime } = context
    try {
      const first = announce(host, workerId(UNBACKED))
      const second = announce(host, workerId(ALSO_UNBACKED))
      await settle(runtime)
      expect(board(runtime)).toMatchObject({ ok: false })
      expect(board(runtime).detail).toContain(first.id)
      expect(board(runtime).detail).toContain(second.id)

      // One Session leaves the registry, which is the fact that ends its condition: nothing is standing at the door
      // under a name it has no Ticket for any more. Its line goes with it and the other impostor's stays — two Sessions
      // are two subjects, and this is the assertion a single shared impostor key reddens.
      dispose(host, second)
      await settle(runtime)
      expect(host.agents.has(second.id)).toBe(false)
      expect(board(runtime)).toMatchObject({ ok: false })
      expect(board(runtime).detail).toContain(first.id)
      expect(board(runtime).detail!).not.toContain(second.id)

      // The condition is over once the last one is gone, and the board says so in the present tense instead of holding
      // a false alarm about a Session that no longer exists.
      dispose(host, first)
      await settle(runtime)
      expect(host.agents.has(first.id)).toBe(false)
      expect(onBoard(runtime)).toBe(false)
      expect(board(runtime)).toMatchObject({ ok: true })
      expect(board(runtime).detail).toContain('no Session problem is live')
    } finally { await runtime.stop() }
  })

  it('ignores agent/error from an unrelated DSH Session, and retires MAIN_SESSION when the front desk completes a turn', async () => {
    const context = await deployment('auto')
    const { host, runtime } = context
    try {
      expect((await runtime.createMainSession()).error).toBeUndefined()
      await settle(runtime)
      expect(onBoard(runtime)).toBe(false)

      // 1. An unrelated user conversation in the DSH GUI hits an upstream 500: `agent/error` is global across the host,
      // so its `ticketIdOfSession` is undefined, and it must NOT be misattributed to `MAIN_SESSION`.
      const bystander = announce(host, 'session-user-chat-999')
      host.emit('agent/error', { agent: bystander, error: new Error('LlmError: 500: upstream error') })
      await settle(runtime)
      expect(onBoard(runtime)).toBe(false)
      expect(board(runtime)).toMatchObject({ ok: true })

      // 2. When the front desk ITSELF hits an upstream error, it IS recorded under MAIN_SESSION...
      const frontDesk = host.agents.get(runtime.machine.mainSessionId)!
      host.emit('agent/error', { agent: frontDesk, error: Object.assign(new Error('500: upstream error on main'), { name: 'LlmError' }) })
      await settle(runtime)
      expect(onBoard(runtime)).toBe(true)
      expect(board(runtime).detail).toContain('the main Session: LlmError: 500: upstream error on main')

      // ...a failing turn ending does NOT retire it...
      frontDesk.session.events.push({
        seq: frontDesk.session.events.length + 1, type: 'turn/end',
        data: { turn: 1, reason: { kind: 'error', error: { message: '500', code: 'UPSTREAM', status: 500 } } },
      })
      frontDesk.status = 'idle'
      host.emit('agent/status', { agent: frontDesk, status: 'idle' })
      await settle(runtime)
      expect(onBoard(runtime)).toBe(true)

      // ...and a subsequent turn that completes normally DOES retire it, without needing createMainSession again.
      frontDesk.session.events.push({
        seq: frontDesk.session.events.length + 1, type: 'turn/end',
        data: { turn: 2, reason: { kind: 'completed' } },
      })
      frontDesk.status = 'idle'
      host.emit('agent/status', { agent: frontDesk, status: 'idle' })
      await settle(runtime)
      expect(onBoard(runtime)).toBe(false)
      expect(board(runtime)).toMatchObject({ ok: true })
      expect(board(runtime).detail).toContain('no Session problem is live')
    } finally { await runtime.stop() }
  })
})
