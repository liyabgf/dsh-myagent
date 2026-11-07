/**
 * What a Session is decorated with, and the one Session that must be decorated with nothing.
 *
 * S44 (`docs/v2/06-security-risk-register.md` §2.2): `ticketOfSession` answers by SHAPE — any id starting with
 * `worker-` is a worker's, including one myagent never created and no Ticket ever authorized. `decorate` reads
 * `ticket === undefined` as "this is the front desk", so passing that `undefined` on handed such a Session the
 * orchestrator's management tools — `myagent_create_ticket` among them, which opens work that then runs with full
 * access. The fix in `src/app/sessions.ts` `decorateAgent` refuses to decorate at all when the Ticket is missing.
 * This file is what makes reverting it red.
 *
 * Two earlier attempts went green with the defect live, which is why the shape below is not negotiable:
 *
 * 1. The first probed `host.guardOf`. A guard is registered only for a worker — the front desk gets management tools
 *    and no guard — so "no guard" was true of a correctly refused impostor and of one decorated as the orchestrator
 *    alike. An assertion that cannot fail reads as coverage, which is worse than none (discipline 0.8).
 * 2. The second probed `host.toolsOf`, the right probe, but announced a bare `{ id }` as the agent. `decorateAgent`
 *    reached for more of the agent and threw, and the `catch` on its own listener swallowed the throw, so nothing was
 *    registered in either version and the assertion could not tell them apart.
 *
 * Hence the two rules this file follows. The impostor is built by the stub's own factory (`fakeAgent`), so it carries
 * every surface `decorate` touches and records into the very arrays `toolsOf` reads. And the first assertion is a
 * positive control announced through the *identical* mechanism — same factory, same `agent/created` emit — for a
 * Session that IS the front desk, and so must be decorated. Without that control, "this harness records no
 * registration at all", "an announced agent throws before it is decorated" and "the impostor was refused" are one
 * observation, which is exactly how both earlier attempts passed.
 */
import { utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { ticketSummary } from '../src/app/views.ts'
import { deployment, type Deployment } from './helpers/deployment.ts'
import { fakeAgent, KNOWN_GLOBAL_TOOLS, wait, type RestrictPolicy } from './helpers/host.ts'

const workerId = (ticketId: string): string => `worker-${ticketId}`

/** A Ticket id no request ever produced: the shape `ticketOfSession` answers to, with nothing behind it. */
const UNBACKED_TICKET = '0'.repeat(32)

/**
 * The answer a plain stub host gives `restrict`, which `fakeAgent` requires and neither path here reaches: the
 * orchestrator is neither restricted nor guarded, and the impostor is refused before the worker path. Spelled out
 * rather than borrowed because the host keeps its own policy private — while the arrays handed in are the host's own,
 * which is the only thing that lets `toolsOf` see what this agent registers.
 */
const POLICY: RestrictPolicy = { knownTools: KNOWN_GLOBAL_TOOLS, fails: false }

/** Ask the system to look now and run what is due, then let the pump finish. */
async function settle(runtime: Deployment['runtime'], ms = 80): Promise<void> {
  await runtime.nudge()
  await wait(ms)
  runtime.passes.requestPass()
  await wait(ms)
}

/** Drop a request file whose mtime is old enough that the Source reads it as settled. */
function drop(inbox: string, name: string, text: string): void {
  const path = join(inbox, name)
  writeFileSync(path, text, 'utf8')
  const at = new Date(Date.now() - 5_000)
  utimesSync(path, at, at)
}

describe('what a Session is decorated with', () => {
  it('gives a Session named like a worker nothing at all when no Ticket is behind the name', async () => {
    const { host, runtime, inbox } = await deployment('auto')
    try {
      /** Announce a Session the way DSH does when one appears, built by the stub's own factory. */
      const announce = (id: string): void => {
        host.emit('agent/created', { agent: fakeAgent(id, host.tools, host.restrictions, host.sections, host.guards, POLICY) })
      }

      // (1) The control: an announced Session whose id IS the front desk's is decorated as the orchestrator. Mounting
      // creates no Session (`tests/mount.spec.ts`), so nothing else can have registered under this id yet — whatever
      // `toolsOf` finds here, the announcement above put there. The id is read from the deployment rather than spelled
      // out, so a front desk that moved fails here instead of passing over an id nobody decorated.
      const frontDesk = runtime.machine.mainSessionId
      announce(frontDesk)
      await settle(runtime)
      expect(host.toolsOf(frontDesk)).toContain('myagent_create_ticket')

      // (2) The impostor, announced the same way and differing only in having no Ticket behind its name.
      const impostorId = workerId(UNBACKED_TICKET)
      announce(impostorId)
      await settle(runtime)
      // No myagent tool of any kind — not a worker's, and not the orchestrator's management tools either. This is the
      // assertion mutation M1 must redden: with the fix reverted it reads `[ 'myagent_create_ticket', …(6) ]`.
      expect(host.toolsOf(impostorId)).toEqual([])

      // (3) The contrast, which keeps (2) from being satisfied by a decoration path that stopped running for everyone:
      // a real Ticket's worker, made the ordinary way by dropping a request in the inbox, still gets the one tool it
      // reports with.
      drop(inbox, 'real.md', '做点事。')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      expect(host.toolsOf(workerId(ticket.id))).toContain('myagent_report')
    } finally { await runtime.stop() }
  })
})

describe('what a triage attempt is decorated with (S3b)', () => {
  /**
   * The desk decides, it does not do — and the two halves of that are wired in two different files: `runtime.ts`
   * picks the tools and `sessions.ts` picks the prompt role. Both are asserted here, because a wrong role with a
   * right tool set passes every tool assertion while the Session runs under the wrong instructions (that is why the
   * stub now records prompt sections instead of discarding them).
   */
  it('gets the desk’s tools plus the one report a decision is expressed with, and runs under the triage prompt', async () => {
    const { host, runtime, inbox } = await deployment('auto')
    try {
      runtime.saveSettings({ acceptMode: 'auto', allowedSenders: ['operator'], triage: { enabled: true } })
      drop(inbox, 'ask.md', '现在有几张在跑？')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      expect(ticket.assignments.at(-1)!.role, '这张任务应当被标记为分诊').toBe('triage')

      const id = workerId(ticket.id)
      const tools = host.toolsOf(id)
      // It has to be able to dispatch...
      expect(tools).toContain('myagent_create_ticket')
      expect(tools).toContain('myagent_reply')
      // ...and a decision is expressed as a report, so that one worker tool comes along.
      expect(tools).toContain('myagent_report')
      // Reading another Ticket's output is doing work. Its absence is the assertion, not an omission.
      expect(tools).not.toContain('myagent_read_artifact')
      // Both tool sets define `myagent_note_ticket`; registering it twice would be a second opinion about one tool.
      expect(tools.filter(name => name === 'myagent_note_ticket')).toHaveLength(1)
      // And the prompt is the triage one, not the worker's.
      const prompt = host.sectionText(id) ?? ''
      expect(prompt).toContain('first stop')
      expect(prompt).toContain('Do not do the work')
      expect(prompt).not.toContain('You have three tools, and no others')
    } finally { await runtime.stop() }
  })

  it('decorates an ordinary worker exactly as before when the switch is off', async () => {
    const { host, runtime, inbox } = await deployment('auto')
    try {
      drop(inbox, 'work.md', '做点事。')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      const id = workerId(ticket.id)
      expect(host.toolsOf(id)).toContain('myagent_report')
      expect(host.toolsOf(id)).not.toContain('myagent_create_ticket')
      expect(host.sectionText(id) ?? '').toContain('You have three tools, and no others')
    } finally { await runtime.stop() }
  })
})

describe('the operator’s own Session as the triage desk (B1)', () => {
  /**
   * `desk: 'main'` changes WHO triages, and the observable difference is that no worker Session is made at all: the
   * request is queued into the conversation the operator is already in. `relay` resolves or creates the front desk
   * rather than giving up quietly, which is the property that keeps a triage item from vanishing without a trace.
   */
  it('queues the request into the front desk, makes no worker Session, and starts only after the queueing worked', async () => {
    const { host, runtime, inbox } = await deployment('auto')
    try {
      await runtime.createMainSession()
      runtime.saveSettings({ acceptMode: 'auto', allowedSenders: ['operator'], triage: { enabled: true, desk: 'main' } })
      drop(inbox, 'ask.md', '现在有几张在跑？')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      expect(ticket.assignments.at(-1)!.role).toBe('triage')
      // The panel's marker is DERIVED from this same fact rather than stored beside it, so a real Ticket produced by
      // the Engine is the only honest way to check the derivation: the views-level test builds the Assignment by hand,
      // and would pass even if the derivation read a field no Engine ever writes.
      expect(ticketSummary(ticket).triage, '面板要能认出这是一张分诊任务').toBe(true)
      // The difference that matters: nothing was made for it.
      expect(host.agents.has(workerId(ticket.id))).toBe(false)
      expect(host.toolsOf(workerId(ticket.id))).toEqual([])
      // And the front desk has the request, with the instruction that makes it actable — naming the closing tool is
      // what distinguishes "decide this" from "here is some text".
      const desk = host.agents.get('myagent-main')!
      const text = desk.followups.at(-1)!.text
      expect(text).toContain('triage desk')
      expect(text).toContain('myagent_close_ticket')
      expect(text).toContain('现在有几张在跑')
      // Started only after the queueing succeeded: a launch that cannot reach the desk must not pretend it did.
      expect(ticket.assignments.at(-1)!.state).toBe('running')
    } finally { await runtime.stop() }
  })

  it('still makes a dedicated Session when the desk is the default, so B1 is a switch and not a replacement', async () => {
    const { host, runtime, inbox } = await deployment('auto')
    try {
      runtime.saveSettings({ acceptMode: 'auto', allowedSenders: ['operator'], triage: { enabled: true } })
      drop(inbox, 'ask2.md', '现在有几张在跑？')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      expect(host.agents.has(workerId(ticket.id))).toBe(true)
      expect(host.toolsOf(workerId(ticket.id))).toContain('myagent_create_ticket')
    } finally { await runtime.stop() }
  })

  /**
   * `myagent_close_ticket` exists because the desk in B1 mode has no `myagent_report` — that one is a worker's, bound
   * to an attempt. It is deliberately narrow: triage Tickets only, ending states only.
   */
  it('closes a triage Ticket, and refuses to be a second way of ending ordinary work', async () => {
    const { host, runtime, inbox } = await deployment('auto')
    try {
      // 工具是**注册在 Session 上**的，所以主 Session 必须先存在——否则 host.tool 找不到它，
      // 而报错长得像"工具没注册"，其实是"没人可以持有它"。
      await runtime.createMainSession()
      runtime.saveSettings({ acceptMode: 'auto', allowedSenders: ['operator'], triage: { enabled: true } })
      drop(inbox, 'close-me.md', '现在有几张在跑？')
      await settle(runtime)
      const triage = runtime.store.tickets.list()[0]!
      const close = host.tool('myagent-main', 'myagent_close_ticket')!

      // An unknown Ticket, said plainly.
      expect(await close.definition.execute({ ticket_id: 'nosuchticket', state: 'ready', summary: 'x' }, { signal: new AbortController().signal }))
        .toMatchObject({ error: 'There is no Ticket nosuchticket.' })
      // `blocked` is not a closing state: a triage Ticket that still needs somebody is a question, and in B1 the desk
      // IS the operator's Session, so asking is just saying it. Accepting `blocked` would also relay the question back
      // to the desk that just asked it.
      // 参数是**同步**校验的（tool() 包装器先 parse 再调 execute），所以这里抛而不是 reject——
      // 断言写成 rejects 会让错误直接逃出测试，看起来像测试坏了。
      expect(() => close.definition.execute({ ticket_id: triage.id, state: 'blocked', summary: 'x' }, { signal: new AbortController().signal }))
        .toThrowError(/ready.*dropped.*failed/)
      // Closing it works, and the report is the one that reaches whoever asked.
      const closed = await close.definition.execute(
        { ticket_id: triage.id, state: 'ready', summary: '三张在跑，没有卡住的。' }, { signal: new AbortController().signal })
      expect(closed).toMatchObject({ ticket_id: triage.id, state: 'ready' })
      expect(runtime.store.tickets.get(triage.id)!.ended).toBeDefined()

      // And an ordinary worker Ticket is refused: without that, the front desk would have gained a way to end real
      // work by REPORTING a result on it, which reads as "the work finished" rather than "somebody stopped it".
      // 分诊要先关掉，否则这一份也会变成分诊任务——那样 find 就找不到"普通任务"，
      // 而报错是 `Cannot read properties of undefined (reading 'id')`，指向的是断言而不是前置状态。
      runtime.saveSettings({ acceptMode: 'auto', allowedSenders: ['operator'], triage: { enabled: false } })
      drop(inbox, 'real-work.md', '做点事。')
      await settle(runtime)
      const worker = runtime.store.tickets.list().find(item => item.assignments.at(-1)!.role !== 'triage')!
      expect(worker, '关分诊之后进来的请求应当是一张普通任务').toBeDefined()
      const refused = await close.definition.execute(
        { ticket_id: worker.id, state: 'ready', summary: 'x' }, { signal: new AbortController().signal }) as { error: string }
      expect(refused.error).toContain('not a triage Ticket')
      expect(refused.error).toContain('myagent_stop_ticket')
      expect(runtime.store.tickets.get(worker.id)!.ended).toBeUndefined()
    } finally { await runtime.stop() }
  })
})
