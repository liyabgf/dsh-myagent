/**
 * The whole chain, offline: a file in the inbox becomes a Ticket, a Ticket becomes a worker Session with a prompt and a
 * report tool, a report becomes `RESULT.md` and a notice in the main Session, and a question becomes an answer that
 * reaches the same worker.
 *
 * Nothing here touches a live host. A bundle earns an installation by passing this, not by being installed.
 */
import { mkdirSync, existsSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Config } from '../src/deployment.ts'
import { createRuntime, usageOf, type Runtime } from '../src/app/runtime.ts'
import { KNOWN_GLOBAL_TOOLS, stubHost, wait, type StubHost } from './helpers/host.ts'
import { tempDir } from './helpers/temp.ts'


/** A deployment in a temp directory, with its own inbox and work root. */
async function deployment(acceptMode: 'auto' | 'observe' = 'auto'): Promise<{ host: StubHost; runtime: Runtime; inbox: string; work: string }> {
  const stateDir = tempDir('myagent-flow-')
  const inbox = join(stateDir, 'inbox')
  const work = join(stateDir, 'work')
  const host = stubHost()
  const runtime = createRuntime(host.ctx, Config({ stateDir, inboxDir: inbox, workRoot: work }) as never)
  runtime.saveSettings({ acceptMode, allowedSenders: ['operator'], sources: { inbox: { directory: inbox, pollMs: 1000 } } })
  await runtime.start()
  return { host, runtime, inbox, work }
}

/** Drop a request file whose mtime is old enough that the Source reads it as settled. */
function drop(inbox: string, name: string, text: string): void {
  const path = join(inbox, name)
  writeFileSync(path, text, 'utf8')
  const at = new Date(Date.now() - 5_000)
  utimesSync(path, at, at)
}

const workerId = (ticketId: string) => `worker-${ticketId}`
const signal = () => new AbortController().signal

/** Ask the system to look now and run what is due, then let the pump finish. */
async function settle(runtime: Runtime, ms = 80): Promise<void> {
  await runtime.nudge()
  await wait(ms)
  runtime.passes.requestPass()
  await wait(ms)
}

describe('a request from the inbox to a finished Ticket', () => {
  it('runs the whole chain and writes the answer where a person can read it', async () => {
    const { host, runtime, inbox, work } = await deployment()
    try {
      await runtime.createMainSession()
      drop(inbox, 'digest.md', '---\ntitle: 写一份目录说明\nscope: 只在本目录里工作\n---\n创建 hello.md 和 data/numbers.txt。')
      await settle(runtime)

      // One Ticket, one running Assignment, one worker Session in its own directory.
      const tickets = runtime.store.tickets.list()
      expect(tickets).toHaveLength(1)
      const ticket = tickets[0]!
      expect(ticket.title).toBe('写一份目录说明')
      expect(ticket.mandate.scope).toBe('只在本目录里工作')
      expect(ticket.assignments.at(-1)).toMatchObject({ state: 'running' })
      const directory = ticket.execution!.directory
      expect(directory.startsWith(work)).toBe(true)
      expect(existsSync(directory)).toBe(true)
      expect(host.calls.sessions).toContain(workerId(ticket.id))

      // The worker was told what to do, and given exactly one way to answer.
      const agent = host.agents.get(workerId(ticket.id))!
      expect(agent.followups).toHaveLength(1)
      expect(agent.followups[0]!.text).toContain('创建 hello.md 和 data/numbers.txt。')
      expect(agent.followups[0]!.text).toContain('只在本目录里工作')
      expect(host.tool(workerId(ticket.id), 'myagent_report')).toBeDefined()
      // Its tools are the work tools, and nothing that reaches a person or the profile.
      const allowed = host.restrictions.at(-1)!.allow!
      expect(allowed).toContain('read')
      expect(allowed).toContain('bash')
      expect(allowed).not.toContain('ask_user_question')
      expect(allowed).not.toContain('plugin_manager')
      expect(allowed).not.toContain('schedule_create')
      // `myagent_report` is registered on the worker's own scope, which a restriction does not mask — and naming it in
      // a restriction is refused by DSH, which is what took a host down the first time this was installed.
      expect(allowed).not.toContain('myagent_report')
      expect(allowed.every(name => KNOWN_GLOBAL_TOOLS.includes(name))).toBe(true)
      expect(host.tool(workerId(ticket.id), 'myagent_report')).toBeDefined()

      // The request file left the inbox, so no later poll takes it again.
      expect(readdirSync(inbox)).toEqual(['accepted'])

      // The worker reports itself done, which is the only way it speaks.
      const report = host.tool(workerId(ticket.id), 'myagent_report')!
      await report.definition.execute(
        { state: 'ready', summary: '两个文件都写好了。', files: ['hello.md', 'data/numbers.txt'] }, { signal: signal() })
      await settle(runtime)

      const ended = runtime.store.tickets.get(ticket.id)!
      expect(ended.ended).toMatchObject({ outcome: 'done' })
      expect(ended.result?.summary).toBe('两个文件都写好了。')
      // The answer outlives the process that produced it.
      const document = readFileSync(join(directory, 'RESULT.md'), 'utf8')
      expect(document).toContain('# 写一份目录说明')
      expect(document).toContain('- State: ready')
      expect(document).toContain('两个文件都写好了。')
      expect(document).toContain('- data/numbers.txt')
      // The front desk hears about it as a notice, which costs no model turn.
      const main = host.agents.get('myagent-main')!
      expect(main.followups).toEqual([])
      expect(main.notices.at(-1)!.text).toContain('done')
      expect(main.notices.at(-1)!.text).toContain(directory)
      // The queue drained, and a second report is refused because the authorization ended.
      expect(runtime.store.effectCounts()).toEqual({})
      // 【产品变更】旧断言：await expect(report.definition.execute({ state: 'ready', summary: 'again' }, { signal: signal() }))
      //   .rejects.toSatisfy((error: unknown) => error instanceof UserError)
      // 理由：`myagent_report` 现在把 Engine 的拒绝包成 refusal 返回（与同文件 `myagent_note_ticket` 的既有写法一致）。
      // 异常逃给宿主会变成 worker 读不懂的 tool error，而 `NEXT_STEP` 表里早就为 `ticket_ended` 写好了"下一步该做什么"
      // 的文案却送不到它眼前。断言没有放宽：`code` 仍然被钉住，另外新增 `next` 必须真的送到。
      const refused = await report.definition.execute({ state: 'ready', summary: 'again' }, { signal: signal() }) as Record<string, unknown>
      expect(refused).toMatchObject({ code: 'ticket_ended' })
      expect(String(refused.next)).toContain('needs a Ticket of its own')
    } finally { await runtime.stop() }
  })

  it('brings a blocked question to the front desk, and an answer back to the same worker', async () => {
    const { host, runtime, inbox } = await deployment()
    try {
      await runtime.createMainSession()
      drop(inbox, 'question.md', '整理竞品动态。')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      const id = workerId(ticket.id)
      await host.tool(id, 'myagent_report')!.definition.execute(
        { state: 'blocked', summary: '需要决定排序方式。', question: '按公司排还是按产品排？' }, { signal: signal() })
      await settle(runtime)

      // A Ticket that waits for a person keeps its Assignment, and wakes the front desk instead of only noting it.
      const waiting = runtime.store.tickets.get(ticket.id)!
      expect(waiting.ended).toBeUndefined()
      expect(waiting.attention?.question).toBe('按公司排还是按产品排？')
      const main = host.agents.get('myagent-main')!
      expect(main.followups.at(-1)!.text).toContain('按公司排还是按产品排？')
      expect(main.followups.at(-1)!.text).toContain('myagent_answer_ticket')

      // The answer reaches the same worker Session, in the same directory, as a new message.
      const before = host.agents.get(id)!.followups.length
      runtime.engine.answer(ticket.id, '按公司排，每家公司一节。')
      await settle(runtime)
      const answered = runtime.store.tickets.get(ticket.id)!
      expect(answered.attention).toBeUndefined()
      expect(host.agents.get(id)!.followups.length).toBe(before + 1)
      expect(host.agents.get(id)!.followups.at(-1)!.text).toContain('按公司排，每家公司一节。')
      expect(host.calls.sessions.filter(session => session === id)).toHaveLength(1)
    } finally { await runtime.stop() }
  })

  it('records a request in observe mode and starts no worker at all', async () => {
    const { host, runtime, inbox } = await deployment('observe')
    try {
      drop(inbox, 'observed.md', '做点事。')
      await settle(runtime)
      expect(runtime.store.tickets.list()).toEqual([])
      expect(runtime.store.decisions.list(10)[0]).toMatchObject({ outcome: 'observe' })
      expect(readdirSync(inbox)).toEqual(['observed'])
      expect(host.calls.sessions).toEqual([])
      expect(host.tools).toEqual([])
    } finally { await runtime.stop() }
  })

  it('runs a prepare command once per Ticket directory, and fails the Ticket when it fails', async () => {
    const { host, runtime, inbox, work } = await deployment()
    try {
      runtime.saveSettings({
        acceptMode: 'auto', allowedSenders: ['operator'],
        executor: { prepare: 'printf prepared > prepared.txt' },
        sources: { inbox: { directory: inbox, pollMs: 1000 } },
      })
      drop(inbox, 'prepared.md', '做点事。')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      // The stub records the spawn instead of running it, which is the point: the command is the settings' own.
      expect(host.calls.spawns.at(-1)!.argv).toEqual(['sh', '-c', 'printf prepared > prepared.txt'])
      // It runs in the parent of the Ticket's own directory, so a prepare step can put shared material beside it.
      expect(host.calls.spawns.at(-1)!.cwd).toBe(work)
      expect(ticket.assignments.at(-1)).toMatchObject({ state: 'running' })
    } finally { await runtime.stop() }
  })

  it('stops a Ticket mid-turn, which cancels the turn and ends its authorization', async () => {
    const { host, runtime, inbox } = await deployment()
    try {
      drop(inbox, 'stop.md', '做点事。')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      // A stop usually lands while the worker is working; an idle worker has no turn to cancel.
      host.agents.get(workerId(ticket.id))!.status = 'running'
      runtime.engine.stopTicket(ticket.id, '操作者停止了它')
      await settle(runtime)
      const stopped = runtime.store.tickets.get(ticket.id)!
      expect(stopped.ended).toMatchObject({ outcome: 'stopped' })
      expect(host.agents.get(workerId(ticket.id))!.cancelled).toBe(1)
      // A stopped Ticket takes no report either.
      // 【产品变更】旧断言：await expect(host.tool(workerId(ticket.id), 'myagent_report')!.definition
      //   .execute({ state: 'ready', summary: 'too late' }, { signal: signal() }))
      //   .rejects.toSatisfy((error: unknown) => error instanceof UserError)
      // 理由同上一处：`myagent_report` 改为 resolve 成 { error, code, next }。`code` 照旧钉住，另加 `next` 必须送到。
      const late = await host.tool(workerId(ticket.id), 'myagent_report')!.definition
        .execute({ state: 'ready', summary: 'too late' }, { signal: signal() }) as Record<string, unknown>
      expect(late).toMatchObject({ code: 'ticket_ended' })
      expect(String(late.next)).toContain('needs a Ticket of its own')
    } finally { await runtime.stop() }
  })

  it('stops a Ticket whose turn already ended, without cancelling anything', async () => {
    const { host, runtime, inbox } = await deployment()
    try {
      drop(inbox, 'idle.md', '做点事。')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      const agent = host.agents.get(workerId(ticket.id))!
      // A prompt wakes an agent, so a worker that has been handed work is running until its turn ends.
      expect(agent.status).toBe('running')
      agent.status = 'idle'
      runtime.engine.stopTicket(ticket.id, '操作者停止了它')
      await settle(runtime)
      expect(runtime.store.tickets.get(ticket.id)!.ended).toMatchObject({ outcome: 'stopped' })
      expect(agent.cancelled).toBe(0)
    } finally { await runtime.stop() }
  })
})

describe('the identities and bounds DSH insists on', () => {
  it('keeps the Session identity DSH answers with, and addresses the worker by it', async () => {
    // DSH may reuse a blank Session, so the id it returns is not the one asked for. A caller that assumed its own id
    // would deliver to, and stop, a Session that does not exist.
    const host = stubHost({ answersWith: requested => requested.startsWith('worker-') ? 'blank-session-7' : requested })
    const stateDir = tempDir('myagent-flow-')
    const inbox = join(stateDir, 'inbox')
    const runtime = createRuntime(host.ctx, Config({ stateDir, inboxDir: inbox, workRoot: join(stateDir, 'work') }) as never)
    runtime.saveSettings({ acceptMode: 'auto', sources: { inbox: { directory: inbox, pollMs: 1000 } } })
    await runtime.start()
    try {
      drop(inbox, 'renamed.md', '做点事。')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      expect(ticket.execution?.sessionId).toBe('blank-session-7')
      expect(host.agents.has('blank-session-7')).toBe(true)
      expect(host.agents.has(workerId(ticket.id))).toBe(false)
      // The work still reached the Session that exists.
      expect(host.agents.get('blank-session-7')!.followups[0]!.text).toContain('做点事。')
      // And a stop halts that one, not the id that was asked for.
      host.agents.get('blank-session-7')!.status = 'running'
      runtime.engine.stopTicket(ticket.id, '操作者停止了它')
      await settle(runtime)
      expect(runtime.store.tickets.get(ticket.id)!.ended).toMatchObject({ outcome: 'stopped' })
      expect(host.agents.get('blank-session-7')!.cancelled).toBe(1)
    } finally { await runtime.stop() }
  })

  it('bounds a notice summary to what DSH accepts, however long the report is', async () => {
    const { host, runtime, inbox } = await deployment()
    try {
      await runtime.createMainSession()
      drop(inbox, 'long.md', '做点事。')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      await host.tool(workerId(ticket.id), 'myagent_report')!.definition.execute(
        { state: 'ready', summary: '很长'.repeat(400) }, { signal: signal() })
      await settle(runtime)
      const notice = host.agents.get('myagent-main')!.notices.at(-1)!
      const summary = (notice.source as { form: string; summary: string }).summary
      expect((notice.source as { form: string }).form).toBe('notice')
      expect(summary.length).toBeLessThanOrEqual(120)
      // The full text still reaches the Session; only the one-line account is bounded.
      expect(notice.text).toContain('很长')
      expect(notice.text.length).toBeGreaterThan(120)
    } finally { await runtime.stop() }
  })
})

describe('a listener must never take the host down', () => {
  it('contains a decoration failure inside the agent/created dispatch', async () => {
    // DSH announces a new agent from inside its own dispatch, where a throwing listener is a fatal load failure that
    // ends the host process. This is the exact path that crashed a live host during a first installation.
    const host = stubHost({ restrictFails: true })
    const stateDir = tempDir('myagent-flow-')
    const inbox = join(stateDir, 'inbox')
    const runtime = createRuntime(host.ctx, Config({ stateDir, inboxDir: inbox, workRoot: join(stateDir, 'work') }) as never)
    runtime.saveSettings({ acceptMode: 'auto', sources: { inbox: { directory: inbox, pollMs: 1000 } } })
    await runtime.start()
    try {
      drop(inbox, 'unrestrictable.md', '做点事。')
      await settle(runtime)
      // The dispatch itself does not throw, so the host lives.
      expect(() => host.emit('agent/created', { agent: host.agents.values().next().value })).not.toThrow()
      // The Ticket does not run unrestricted: its Assignment is still pending and the launch is queued for a retry.
      const ticket = runtime.store.tickets.list()[0]!
      expect(ticket.assignments.at(-1)!.state).toBe('pending')
      expect(runtime.store.effectCounts().launch).toBe(1)
      expect(runtime.health.problems().length).toBeGreaterThan(0)
    } finally { await runtime.stop() }
  })

  it('drops a tool name the profile does not know, and keeps the rest of the restriction', async () => {
    // Which globals exist belongs to the profile, not to this code: `pwsh` is absent on macOS, and a worker must still
    // be restricted to what is left rather than running with everything.
    const host = stubHost({ knownTools: ['read', 'write', 'bash'] })
    const stateDir = tempDir('myagent-flow-')
    const inbox = join(stateDir, 'inbox')
    const runtime = createRuntime(host.ctx, Config({ stateDir, inboxDir: inbox, workRoot: join(stateDir, 'work') }) as never)
    runtime.saveSettings({ acceptMode: 'auto', sources: { inbox: { directory: inbox, pollMs: 1000 } } })
    await runtime.start()
    try {
      drop(inbox, 'narrow-profile.md', '做点事。')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      expect(ticket.assignments.at(-1)!.state).toBe('running')
      expect(host.restrictions.at(-1)!.allow).toEqual(['read', 'write', 'bash'])
      expect(host.tool(workerId(ticket.id), 'myagent_report')).toBeDefined()
    } finally { await runtime.stop() }
  })
})

describe('what a delivery and an ending leave behind', () => {
  it('stamps the delivery, so a turn that ends without a report is not mistaken for one that never started', async () => {
    const { host, runtime, inbox } = await deployment()
    try {
      drop(inbox, 'stamp.md', '做点事。')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      const assignment = ticket.assignments.at(-1)!
      // No Input was waiting — the request itself lives on the Trigger — and the stamp is recorded anyway.
      expect(assignment.state).toBe('running')
      expect(assignment.startedAt).toBeTruthy()
      expect(assignment.deliveredAt).toBeTruthy()
      expect(assignment.deliveryError).toBeUndefined()
      // So a silent turn end becomes a `waiting` report instead of leaving the Ticket hanging in `running` forever.
      host.agents.get(workerId(ticket.id))!.status = 'idle'
      host.emit('agent/status', { agent: host.agents.get(workerId(ticket.id))!, status: 'idle' })
      await settle(runtime)
      expect(runtime.store.tickets.get(ticket.id)!.assignments.at(-1)!.report).toMatchObject({ state: 'waiting' })
      // The listener ran cleanly; had it thrown, the containment would have recorded it here instead of the report.
      expect(runtime.health.problems()).toEqual([])
    } finally { await runtime.stop() }
  })

  it('leaves a reporting worker to close its own turn, and cuts short only what a person stopped', async () => {
    const { host, runtime, inbox } = await deployment()
    try {
      drop(inbox, 'done.md', '做完就汇报。')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      const agent = host.agents.get(workerId(ticket.id))!
      agent.status = 'running'
      await host.tool(workerId(ticket.id), 'myagent_report')!.definition
        .execute({ state: 'ready', summary: '做完了。' }, { signal: signal() })
      await settle(runtime)
      expect(runtime.store.tickets.get(ticket.id)!.ended).toMatchObject({ outcome: 'done' })
      // Its turn was ending on its own and its tools are denied now; cancelling it would only lose its last word.
      expect(agent.cancelled).toBe(0)
    } finally { await runtime.stop() }
  })
})

describe('a Session a dead launch left half-configured', () => {
  it('re-authorizes a restored worker instead of trusting what the crash left behind', async () => {
    // This is the failure a real host showed: DSH announces a new agent from inside `create`, so a listener that throws
    // there leaves a Session persisted with the profile's own preset — `workspace-write` and `approval: ask`. Resuming
    // it without re-authorizing gives a worker that cannot work: its turn ends blocked, waiting for an approval nobody
    // is there to give, and the Ticket silently stalls.
    const host = stubHost()
    const stateDir = tempDir('myagent-flow-')
    const inbox = join(stateDir, 'inbox')
    const runtime = createRuntime(host.ctx, Config({ stateDir, inboxDir: inbox, workRoot: join(stateDir, 'work') }) as never)
    runtime.saveSettings({ acceptMode: 'auto', sources: { inbox: { directory: inbox, pollMs: 1000 } } })
    await runtime.start()
    try {
      drop(inbox, 'half-configured.md', '做点事，然后问一个问题。')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      const id = workerId(ticket.id)
      expect(host.permissions).toEqual([{ sessionId: id, preset: 'danger-full-access' }])

      // The worker asks, then its Session goes cold with the profile default on it, as a crash would leave it.
      await host.tool(id, 'myagent_report')!.definition
        .execute({ state: 'blocked', summary: '需要决定', question: '按公司还是按产品？' }, { signal: signal() })
      await settle(runtime)
      host.agents.delete(id)
      host.seedRestored(id, 'workspace-write')

      // Answering it resumes the cold Session, which must be authorized again before any work is handed to it.
      runtime.engine.answer(ticket.id, '按公司排。')
      await settle(runtime)
      expect(host.permissions.filter(item => item.sessionId === id)).toEqual([
        { sessionId: id, preset: 'danger-full-access' },
        { sessionId: id, preset: 'danger-full-access' },
      ])
      expect(host.agents.get(id)!.followups.at(-1)!.text).toContain('按公司排。')
      expect(runtime.store.tickets.get(ticket.id)!.attention).toBeUndefined()
      expect(runtime.health.problems()).toEqual([])
    } finally { await runtime.stop() }
  })

  it('does not rewrite a permission preset a worker already runs under', async () => {
    const { host, runtime, inbox } = await deployment()
    try {
      drop(inbox, 'already-authorized.md', '做点事，然后问一个问题。')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      const id = workerId(ticket.id)
      await host.tool(id, 'myagent_report')!.definition
        .execute({ state: 'blocked', summary: '需要决定', question: '哪一个？' }, { signal: signal() })
      await settle(runtime)
      expect(host.permissions).toHaveLength(1)
      // A warm Session keeps what it was given; answering it writes no second preset event.
      runtime.engine.answer(ticket.id, '第一个。')
      await settle(runtime)
      expect(host.permissions).toHaveLength(1)
    } finally { await runtime.stop() }
  })
})

describe('settings that say whether a Source works', () => {
  it('refuses a Ticket from the main Session while the session Source is switched off', async () => {
    // `sources.session.enabled` has to mean something: a panel that shows a Source as off while it still takes work
    // is a panel that lies. The gate is what enforces it, and it enforces it for the panel's own create route too.
    const { host, runtime } = await deployment()
    try {
      runtime.saveSettings({ acceptMode: 'auto', sources: { session: { enabled: false } } })
      const result = runtime.engine.createTicket({ title: '被关掉的来源', text: '做点事。' })
      expect(result.disposition.state).toBe('ignored')
      expect(result.ticketId).toBeUndefined()
      expect(runtime.store.decisions.list(5)[0]).toMatchObject({ outcome: 'ignore', reason: 'source_disabled' })
      expect(runtime.store.tickets.list()).toEqual([])
      expect(host.calls.sessions).toEqual([])
      // And it works again once the Source is switched back on.
      runtime.saveSettings({ acceptMode: 'auto', sources: { session: { enabled: true } } })
      expect(runtime.engine.createTicket({ title: '重新打开', text: '做点事。' }).disposition.state).toBe('accepted')
    } finally { await runtime.stop() }
  })
})

describe('the front desk\'s identity', () => {
  it('keeps the Session DSH gave, so a report still reaches the operator', async () => {
    // DSH may hand back a blank Session of its own rather than the id asked for. Everything that reaches the front
    // desk later looks it up by id, so the id it answered with is the one that has to be remembered.
    const host = stubHost({ answersWith: requested => requested === 'myagent-main' ? 'session-blank-9' : requested })
    const stateDir = tempDir('myagent-flow-')
    const inbox = join(stateDir, 'inbox')
    const runtime = createRuntime(host.ctx, Config({ stateDir, inboxDir: inbox, workRoot: join(stateDir, 'work') }) as never)
    runtime.saveSettings({ acceptMode: 'auto', sources: { inbox: { directory: inbox, pollMs: 1000 } } })
    await runtime.start()
    try {
      const created = await runtime.createMainSession()
      expect(created).toEqual({ sessionId: 'session-blank-9' })
      expect(runtime.mainSession()).toMatchObject({ exists: true, id: 'session-blank-9' })
      expect(host.agents.has('myagent-main')).toBe(false)

      drop(inbox, 'front-desk.md', '做点事。')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      await host.tool(workerId(ticket.id), 'myagent_report')!.definition
        .execute({ state: 'ready', summary: '做完了。' }, { signal: signal() })
      await settle(runtime)
      // The notice landed on the Session that exists, which is the whole point of recording it.
      expect(host.agents.get('session-blank-9')!.notices.at(-1)!.text).toContain('做完了。')
      // And it survives a restart, because the id is in the Store rather than in memory.
      expect(runtime.store.get('main-session:id')).toBe('session-blank-9')
    } finally { await runtime.stop() }
  })
})

describe('a turn DSH ended as blocked', () => {
  it('is told apart from a worker that did its work and forgot to report', async () => {
    // A Session DSH will not run — one left half-created by a crash, for instance — consumes the message and ends the
    // turn at once, with no model request in between. Recorded as `waiting`, that looks like work in progress and
    // invites a retry that fails the same way forever. Recorded as a failure, a person decides what to do.
    const { host, runtime, inbox } = await deployment()
    try {
      drop(inbox, 'unrunnable.md', '做点事。')
      drop(inbox, 'ordinary.md', '做点别的事。')
      await settle(runtime)
      const tickets = runtime.store.tickets.list()
      expect(tickets).toHaveLength(2)
      const broken = tickets.find(t => t.title.includes('unrunnable')) ?? tickets[0]!
      const ordinary = tickets.find(t => t.id !== broken.id)!

      const brokenAgent = host.agents.get(workerId(broken.id))!
      brokenAgent.session.events.push({ seq: 1, type: 'turn/end', data: { reason: { kind: 'blocked' } } })
      host.emit('agent/status', [{ agent: brokenAgent, status: 'idle' }])

      const ordinaryAgent = host.agents.get(workerId(ordinary.id))!
      ordinaryAgent.session.events.push({ seq: 1, type: 'turn/end', data: { reason: { kind: 'completed' } } })
      host.emit('agent/status', [{ agent: ordinaryAgent, status: 'idle' }])
      await settle(runtime)

      const failed = runtime.store.tickets.get(broken.id)!
      expect(failed.assignments.at(-1)!.report).toMatchObject({ state: 'failed' })
      expect(failed.assignments.at(-1)!.report!.summary).toContain('could not run')
      // A person has to decide, and the Ticket is not killed behind their back: for another cause a retry may be right.
      expect(failed.attention).toBeDefined()
      expect(failed.ended).toBeUndefined()
      expect(runtime.health.problems().map(problem => problem.detail).join('\n')).toContain('blocked without reaching the model')

      const waited = runtime.store.tickets.get(ordinary.id)!
      expect(waited.assignments.at(-1)!.report).toMatchObject({ state: 'waiting' })
      expect(waited.attention).toBeUndefined()
    } finally { await runtime.stop() }
  })
})

describe('a Session whose authorization is over', () => {
  it('is told how work is dispatched, not only that a new Ticket is needed', async () => {
    const { host, runtime, inbox } = await deployment()
    try {
      drop(inbox, 'over.md', '做点事。')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      const id = workerId(ticket.id)
      // The guard is the one thing this Session ever hears from myagent again, so this reads what it actually says.
      const guard = host.guardOf(id)!
      expect(guard()).toBeUndefined()

      runtime.engine.stopTicket(ticket.id)
      await settle(runtime)
      expect(runtime.store.tickets.get(ticket.id)!.ended).toBeDefined()

      const message = guard()!
      expect(message).toContain('has ended')
      // "New work needs a new Ticket" was the whole of it, which names a requirement and not a way to meet it — and
      // the person who meets this refusal is as often as not one who opened a Session in the GUI, picked the worker
      // preset and wondered why the panel stayed empty (`19-production-findings.md` F7).
      expect(message).toContain('派活')
      expect(message).toContain('myagent-main')
      expect(message).toContain('inbox')
    } finally { await runtime.stop() }
  })
})

describe('cross-Ticket workspace isolation guard (Pkg 1)', () => {
  it('allows tools inside the Ticket\'s own directory and refuses access to .. or sibling Ticket directories', async () => {
    const { host, runtime, inbox } = await deployment()
    try {
      drop(inbox, 'isolated.md', '做点事。')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      const id = workerId(ticket.id)
      const guard = host.guardOf(id)!

      // Own directory is allowed
      expect(guard({ name: 'read', arguments: { file_path: 'RESULT.md' } })).toBeUndefined()
      expect(guard({ name: 'bash', arguments: { command: 'ls -la && python3 scripts/run.py' } })).toBeUndefined()

      // Inspecting `..` or a sibling Ticket directory is refused
      expect(guard({ name: 'read', arguments: { file_path: '../other-ticket/raw/data.json' } })).toContain('outside this Ticket\'s own directory')
      expect(guard({ name: 'glob', arguments: { path: '..' } })).toContain('outside this Ticket\'s own directory')
      expect(guard({ name: 'bash', arguments: { command: 'ln -s ../group-68172c09/raw raw' } })).toContain('symbolic links')
      expect(guard({ name: 'bash', arguments: { command: 'ls -la ..' } })).toContain('outside this Ticket\'s directory')
    } finally { await runtime.stop() }
  })
})

describe('tool asset promotion and skill reuse lineage (E2)', () => {
  it('validates a worker script (refusing hardcoded private paths), promotes it to a virtual skill, and records bidirectional lineage when another Ticket loads it', async () => {
    const { host, runtime, inbox } = await deployment()
    try {
      drop(inbox, 'builder.md', '写一个通用去重脚本。')
      drop(inbox, 'user.md', '复用去重脚本。')
      await settle(runtime)
      const sorted = [...runtime.store.tickets.list()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      const builder = sorted[0]!
      const consumer = sorted[1]!
      const dir = builder.execution!.directory
      mkdirSync(dir, { recursive: true })

      // 1. Hardcoded private directory path is refused by the quality gate
      writeFileSync(join(dir, 'bad.py'), `open('${dir}/raw.json')\n`, 'utf8')
      const badRes = await runtime.promoteSkill(builder.id, {
        name: 'dedup-merger', title: '实体去重器', description: '去重多源JSON', script_path: 'bad.py',
      })
      expect(badRes.ok).toBe(false)
      expect(badRes.error).toContain('hardcodes this Ticket')

      // 2. Clean parameterized script passes and is saved in Prompts
      writeFileSync(join(dir, 'dedup.py'), 'import sys\nprint(sys.argv[1:])\n', 'utf8')
      const goodRes = await runtime.promoteSkill(builder.id, {
        name: 'dedup-merger', title: '实体去重器', description: '去重多源JSON', script_path: 'dedup.py', usage: 'python3 dedup.py in.json out.json',
      })
      expect(goodRes).toEqual({ ok: true, skill_name: 'myagent-dedup-merger' })
      expect(runtime.prompts.skills().map(s => s.name)).toContain('myagent-dedup-merger')
      expect(runtime.store.events.list(builder.id).some(e => e.type === 'skill_promoted')).toBe(true)

      // 3. Consumer worker invokes the `skill` tool -> useCount increments & bidirectional lineage is recorded
      const guard = host.guardOf(workerId(consumer.id))!
      expect(guard({ name: 'skill', arguments: { name: 'myagent-dedup-merger' } })).toBeUndefined()
      // 【产品变更】旧断言：紧跟在上面那句 guard 调用之后的是
      //   expect(runtime.prompts.skills().find(s => s.name === 'myagent-dedup-merger')!.useCount).toBe(1)
      // 理由：guard 是 `tools/pre-execute` 的最后一道，宿主随后才 `dispatchToolBody`
      // （packages/core/tools/src/pipeline.ts），所以工具体还没跑、甚至随后抛错，计数就已经 +1；worker 反复调用
      // 就能把数字刷高，而面板把它读作"这门手艺有用"。计数改到 `tools/result`——宿主在工具体跑完之后带着最终
      // 结果发这个事件。断言没有放宽：下面钉住了 guard 调用后仍然是 0（这一条单独就能让旧写法判红），
      // 并且失败的加载不计、同一张任务重复加载只计一次、没保存过的名字不计。
      const craft = (): number => runtime.prompts.skills().find(s => s.name === 'myagent-dedup-merger')!.useCount
      expect(craft()).toBe(0)
      const consumerAgent = host.agents.get(workerId(consumer.id))!
      /** The host's own announcement that a `skill` call finished, with the outcome it finished with. */
      const finished = (name: string, isError: boolean): void => {
        host.emit('tools/result', [{ name: 'skill', arguments: { name }, agent: consumerAgent }, { isError }])
      }
      // A load that failed is not a reuse of anything.
      finished('myagent-dedup-merger', true)
      expect(craft()).toBe(0)
      // A load that succeeded is, and it writes both directions of the lineage.
      finished('myagent-dedup-merger', false)
      expect(craft()).toBe(1)
      expect(runtime.engine.citationsOf(builder.id).citedBy).toContain(consumer.id)
      expect(runtime.engine.citationsOf(consumer.id).cites).toContain(builder.id)
      // One Ticket counts one craft once, however often its worker loads it — the vector this closes is a worker
      // raising its own craft's score by calling in a loop.
      finished('myagent-dedup-merger', false)
      finished('myagent-dedup-merger', false)
      expect(craft()).toBe(1)
      // A name nobody saved is not a reuse: it must not create a record either.
      finished('myagent-no-such-craft', false)
      expect(craft()).toBe(1)
      expect(runtime.prompts.skills().map(s => s.name)).not.toContain('myagent-no-such-craft')
    } finally { await runtime.stop() }
  })
})

describe('a profile that does not know several of the worker tools', () => {
  // DSH collects every unknown name and refuses ONCE, plural above one name. A recovery written against the singular
  // wording passed every test the stub could offer and failed every launch on a real profile missing two or more names.
  const runtimeFor = async (knownTools: readonly string[]) => {
    const host = stubHost({ knownTools })
    const stateDir = tempDir('myagent-flow-')
    const inbox = join(stateDir, 'inbox')
    const runtime = createRuntime(host.ctx, Config({ stateDir, inboxDir: inbox, workRoot: join(stateDir, 'work') }) as never)
    runtime.saveSettings({ acceptMode: 'auto', sources: { inbox: { directory: inbox, pollMs: 1000 } } })
    await runtime.start()
    return { host, runtime, inbox }
  }

  it('drops every name DSH refuses in one pass, and still restricts the worker', async () => {
    const { host, runtime, inbox } = await runtimeFor(['read', 'write'])
    try {
      drop(inbox, 'many-unknown.md', '做点事。')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      expect(ticket.assignments.at(-1)!.state).toBe('running')
      expect(host.restrictions.at(-1)!.allow).toEqual(['read', 'write'])
      expect(host.tool(workerId(ticket.id), 'myagent_report')).toBeDefined()
    } finally { await runtime.stop() }
  })

  it('leaves the Ticket unlaunched rather than running a worker with no restriction at all', async () => {
    const { host, runtime, inbox } = await runtimeFor([])
    try {
      drop(inbox, 'no-tools.md', '做点事。')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      expect(ticket.assignments.at(-1)!.state).toBe('pending')
      expect(host.restrictions.length).toBeGreaterThan(0)
      expect(runtime.health.problems().length).toBeGreaterThan(0)
    } finally { await runtime.stop() }
  })

  it('creates the worker Session in the Ticket directory, which is the whole isolation claim', async () => {
    const { host, runtime, inbox } = await runtimeFor(['read', 'write', 'bash'])
    try {
      drop(inbox, 'where-it-runs.md', '做点事。')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      const directory = ticket.execution!.directory
      // Nothing else in the suite looks at the cwd handed to DSH, so a regression here would leave the design's
      // central promise — one directory per Ticket — asserted only by prose.
      expect(host.calls.created).toContainEqual({
        sessionId: workerId(ticket.id), cwd: directory, agentPreset: 'myagent-worker',
      })
    } finally { await runtime.stop() }
  })
})

describe('the token counts a worker’s progress reports', () => {
  const message = (input: number, output: number, cache: number) => ({
    type: 'assistant/message', data: { usage: { inputTokens: input, outputTokens: output, cacheReadTokens: cache } },
  })

  it('sums what DSH reported and nothing else', () => {
    const usage = usageOf([
      message(2211, 155, 4513),
      { type: 'tool/result', data: {} },
      message(100, 20, 0),
    ], 3)
    // These are the real numbers from a live worker log: 2211 + 155 + 4513 = 6879, which is how DSH itself relates
    // input, output, cache read and total. Recomputing the total keeps the parts and the whole consistent.
    expect(usage).toEqual({
      inputTokens: 2311, outputTokens: 175, cacheReadTokens: 4513,
      // 2311 + 175 + 4513 = 6999
      totalTokens: 6999, messages: 2, windowed: false,
    })
  })

  it('answers nothing rather than zero when no message reported usage', () => {
    // Zero is also an invented number: it says "this work cost nothing", which is a claim, and a false one when the
    // truth is that nothing was measured. The operator asked specifically that token counts not be fabricated.
    expect(usageOf([{ type: 'turn/start', data: {} }], 1)).toBeUndefined()
    expect(usageOf([], 0)).toBeUndefined()
  })

  it('says when the sum covers only a window, so a long task’s cost is not read as its whole cost', () => {
    const usage = usageOf([message(10, 10, 0)], 500)
    expect(usage).toMatchObject({ messages: 1, windowed: true })
    expect(usageOf([message(10, 10, 0)], 1)).toMatchObject({ windowed: false })
  })
})

// A regression test for S44 (a Session merely NAMED like a worker getting the orchestrator's management tools) was
// written and then removed, because its mutation check failed: with the fix reverted, the test still passed. The probe
// was wrong, not the fix. `host.guardOf(id)` reads the tool GUARD, and the orchestrator path never registers one —
// only workers are restricted — so "no guard" is true for a correctly-refused impostor AND for one that was decorated
// as the front desk. The assertion could not fail, which is exactly the shape discipline 0.8 warns about, and a green
// test that cannot fail is worse than no test: it reads as coverage.
//
// What writing it properly needs: a stub accessor for what myagent REGISTERED on a Session — the tools from
// `agent.ctx.tools.register(...)` and/or the prompt section from `agent.ctx.systemPrompt.section(...)`. `AgentRecord`
// has both surfaces (`tests/helpers/host.ts`) but exposes only `guardOf`. With that, the pair of assertions is
//   expect(host.toolsOf(impostorId)).toEqual([])                      // no myagent tools at all
//   expect(host.toolsOf(workerId(ticket.id))).toContain('myagent_report')   // a real worker still gets them
// and the second is what makes the first able to fail. Recorded in docs/v2/06-security-risk-register.md §2.2.

// S44's regression test — SECOND attempt, also removed, and the reason is now narrow and known.
//
// W0 added `host.toolsOf(agentId)` (the right probe: a guard is registered only for workers, so `guardOf` cannot
// distinguish a refused Session from one decorated as the front desk). With it, the contrast half of the test PASSES
// — a real Ticket's worker does get `myagent_report` — so registration recording works. But reverting the fix in
// `decorateAgent` (mutation M1) left the impostor half passing too: `toolsOf(impostor)` is `[]` in BOTH versions.
//
// The likely cause, not yet proven: the test emitted `agent/created` with a bare `{ id }` object, and `decorateAgent`
// reaches for more of the agent (`agent.session`, the prompt section's inputs) — so it throws, and the listener is
// wrapped in `contained(...)`, which swallows listener exceptions by design (S8: one Source's bug must not silence
// another's work). Both the fixed and the reverted code throw at the same place, so nothing is registered either way
// and the assertion cannot distinguish them.
//
// What the next attempt needs, in order:
//   1. Build the impostor with the stub's own factory — `fakeAgent(id, tools, restrictions, guards, policy)`
//      (`tests/helpers/host.ts:133`) — so `decorateAgent` does not throw before it decides anything.
//   2. FIRST assert the harness is live: `expect(host.toolsOf(<front desk id>)).toContain('myagent_create_ticket')`.
//      Without this, "nothing is ever registered in this harness" and "the impostor was correctly refused" look
//      identical — which is precisely how both attempts so far went green for the wrong reason.
//   3. Then the pair: `toolsOf(impostor)` toEqual [] AND `toolsOf(workerId(ticket.id))` toContain 'myagent_report'.
//   4. Mutation M1 must go red on assertion (3a), and M2 (delete 3b) must leave it red — 0.8's strong form.
//
// `toolsOf` stays in the harness: it is correct, it is used by step 2 above, and W1 in
// `docs/v2/21-engineering-plan.md` is still open. Recorded in `docs/v2/06-security-risk-register.md` §2.2.

describe('the operator is told where the panel is, by the system itself', () => {
  /**
   * A harness with an instrumented logger. The local `deployment()` builds its own stub host internally, so a test
   * that needs to observe what the system LOGS has to build the runtime itself with a host it instrumented first —
   * passing `host` as an extra argument to `deployment()` does nothing (the first version of this test did exactly
   * that and asserted against a logger nothing ever called).
   */
  const instrumented = async (): Promise<{ runtime: Runtime; lines: string[] }> => {
    const host = stubHost()
    const lines: string[] = []
    const logger = host.ctx.logger as unknown as { info(...args: unknown[]): void }
    logger.info = (...args: unknown[]): void => {
      // The stub logger does not do printf substitution the way the real one does, so the test does it: otherwise
      // the recorded line carries the `%s` placeholder and the assertion measures the template, not the sentence.
      const [format, ...rest] = args as [string, ...unknown[]]
      let index = 0
      lines.push(String(format).replace(/%[sd]/g, () => String(rest[index++])))
    }
    const stateDir = tempDir('myagent-flow-')
    const inbox = join(stateDir, 'inbox')
    const work = join(stateDir, 'work')
    const runtime = createRuntime(host.ctx, Config({ stateDir, inboxDir: inbox, workRoot: work }) as never)
    runtime.saveSettings({ acceptMode: 'auto', allowedSenders: ['operator'], sources: { inbox: { directory: inbox, pollMs: 1000 } } })
    await runtime.start()
    return { runtime, lines }
  }

  it('prints the real panel address at startup, read from the host rather than guessed', async () => {
    const { runtime, lines } = await instrumented()
    try {
      const panel = lines.find(line => line.includes('myagent panel:'))
      expect(panel, '启动日志里应当有一行告诉操作者面板在哪').toBeDefined()
      // The stub host serves on 3080, and `panelPath()` reads that port from the host — so the line carries the
      // address the panel is actually reachable at, not a hardcoded example.
      expect(panel).toContain('http://127.0.0.1:3080/myagent/')
      expect(panel).toContain('DSH Web GUI address plus /myagent/')
      // And the address stands on its own line, not buried among four paths.
      expect(panel!.startsWith('myagent panel: http://127.0.0.1:3080/myagent/')).toBe(true)
    } finally { await runtime.stop() }
  })

  it('says there is no panel when the profile has no web server, instead of printing an empty address', async () => {
    const host = stubHost()
    // Drop the PORT, not the web server: `start()` registers its routes through `webServer.register`, so deleting the
    // whole object would make startup fail for a reason that has nothing to do with the panel. A profile without a
    // web server is exactly this shape from `panelPath()`'s point of view: no port, therefore no address.
    ;(host.ctx as unknown as { webServer: { port?: number } }).webServer.port = undefined
    const lines: string[] = []
    const logger = host.ctx.logger as unknown as { info(...args: unknown[]): void }
    logger.info = (...args: unknown[]): void => {
      // The stub logger does not do printf substitution the way the real one does, so the test does it: otherwise
      // the recorded line carries the `%s` placeholder and the assertion measures the template, not the sentence.
      const [format, ...rest] = args as [string, ...unknown[]]
      let index = 0
      lines.push(String(format).replace(/%[sd]/g, () => String(rest[index++])))
    }
    const stateDir = tempDir('myagent-flow-')
    const runtime = createRuntime(host.ctx, Config({ stateDir, inboxDir: join(stateDir, 'inbox'), workRoot: join(stateDir, 'work') }) as never)
    try {
      await runtime.start()
      const panel = lines.find(line => line.includes('myagent panel:'))
      expect(panel).toContain('no web server, so there is no panel')
      expect(panel).not.toContain('http://127.0.0.1:undefined')
    } finally { await runtime.stop() }
  })
})
  
