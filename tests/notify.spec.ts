/**
 * Telling somebody: the record a finished Ticket leaves, and the notice that reaches the operator's front desk.
 *
 * An unattended system that finishes work silently is a system nobody can use, so each of these has to land — and a
 * courtesy that cannot be delivered (a desktop notification on a machine without one) must never take the record with it.
 */
import { readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { api, deployment, type Deployment } from './helpers/deployment.ts'
import { stubHost, wait } from './helpers/host.ts'

const workerId = (ticketId: string) => `worker-${ticketId}`
const signal = () => new AbortController().signal

async function settle(runtime: Deployment['runtime'], ms = 80): Promise<void> {
  await runtime.nudge()
  await wait(ms)
  runtime.passes.requestPass()
  await wait(ms)
}

/** One Ticket, accepted, with a worker that has its report tool. */
async function started(context: Deployment, text = '写一份摘要'): Promise<string> {
  const path = `${context.inbox}/task-${Math.random().toString(36).slice(2, 8)}.md`
  writeFileSync(path, text, 'utf8')
  const at = new Date(Date.now() - 5_000)
  utimesSync(path, at, at)
  await settle(context.runtime)
  const id = context.runtime.store.tickets.list()[0]!.id
  expect(context.host.tool(workerId(id), 'myagent_report')).toBeDefined()
  return id
}

const report = (context: Deployment, id: string, args: unknown) =>
  context.host.tool(workerId(id), 'myagent_report')!.definition.execute(args, { signal: signal() })

describe('the record a finished Ticket leaves', () => {
  it('writes RESULT.md in the Ticket\'s own directory, and leaves a notice rather than waking the front desk', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      await runtime.createMainSession()
      const id = await started(context)
      const directory = runtime.store.tickets.get(id)!.execution!.directory
      await report(context, id, { state: 'ready', summary: '写好了 digest.md', files: ['digest.md'] })
      await settle(runtime)
      const document = readFileSync(join(directory, 'RESULT.md'), 'utf8')
      expect(document).toContain('# ')
      expect(document).toContain('写好了 digest.md')
      expect(document).toContain('- digest.md')
      // 【F1】An ending is now a relay (desk woken) so it can decide how to inform the operator.
      const main = host.agents.get('myagent-main')!
      expect(main.followups).toHaveLength(1)
      expect(main.notices).toEqual([])
      expect(main.followups[0]!.text).toContain('写好了 digest.md')
      expect(runtime.store.effectCounts()).toEqual({})
    } finally { await runtime.stop() }
  })

  it('wakes the front desk when the worker needs a decision', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      await runtime.createMainSession()
      const id = await started(context)
      await report(context, id, { state: 'blocked', summary: '需要决定', question: '按公司还是按产品？' })
      await settle(runtime)
      const main = host.agents.get('myagent-main')!
      // A question is a message the operator answers, so it is queued as a turn rather than injected.
      expect(main.followups).toHaveLength(1)
      expect(main.followups[0]!.text).toContain('按公司还是按产品？')
      expect(main.followups[0]!.text).toContain('myagent_answer_ticket')
      // No RESULT.md yet: the Ticket has not ended.
      expect(runtime.store.tickets.get(id)!.ended).toBeUndefined()
    } finally { await runtime.stop() }
  })

  it('still tells the front desk when the record could not be written', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      await runtime.createMainSession()
      const id = await started(context)
      const directory = runtime.store.tickets.get(id)!.execution!.directory
      rmSync(directory, { recursive: true, force: true })
      await report(context, id, { state: 'ready', summary: '写好了' })
      await settle(runtime)
      // The file is a courtesy the directory can refuse; the notice is the record that must survive.
      expect(runtime.health.problems().map(problem => problem.detail).join('\n')).toContain('RESULT.md')
      expect(host.agents.get('myagent-main')!.followups).toHaveLength(1)  // 【F1】ready → relay
      expect(runtime.store.effectCounts()).toEqual({})
    } finally { await runtime.stop() }
  })

  it('settles a notice for a Ticket that is gone, rather than retrying it forever', async () => {
    const context = await deployment('auto')
    const { runtime } = context
    try {
      runtime.store.enqueueEffect('notify', 'notify-gone', { kind: 'report', ticketId: 'no-such-ticket', state: 'ready', summary: 'x', at: '2026-11-03T03:00:00.000Z' })
      await settle(runtime)
      expect(runtime.store.effectCounts()).toEqual({})
      expect(runtime.health.problems()).toEqual([])
    } finally { await runtime.stop() }
  })
})

describe('a settings change that bears on live work', () => {
  it('tells the front desk in the gate\'s own words', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      await runtime.createMainSession()
      const id = await started(context)
      runtime.saveSettings({ acceptMode: 'auto', allowedSenders: ['someone-else'], sources: { inbox: { directory: context.inbox, pollMs: 1000 } } })
      await settle(runtime)
      const main = host.agents.get('myagent-main')!
      expect(main.notices.at(-1)!.text).toContain(id.slice(0, 8))
      expect(main.notices.at(-1)!.text).toContain('may not originate work')
      // The Ticket keeps working: a change is delivered, never enforced by cancellation.
      expect(runtime.store.tickets.get(id)!.ended).toBeUndefined()
    } finally { await runtime.stop() }
  })
})

describe('the machine notification', () => {
  it('asks the desktop when the operator turned it on, with the summary quoted into it', async () => {
    if (process.platform !== 'darwin') return
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      runtime.saveSettings({ acceptMode: 'auto', notify: { enabled: true }, sources: { inbox: { directory: context.inbox, pollMs: 1000 } } })
      const id = await started(context)
      await report(context, id, { state: 'ready', summary: '写好了 "digest.md"' })
      await settle(runtime)
      const notification = host.calls.spawns.find(spawn => spawn.argv[0] === 'osascript')
      expect(notification).toBeDefined()
      expect(notification!.argv.join(' ')).toContain('display notification')
      // A quote in the summary must not break out of the AppleScript string.
      expect(notification!.argv.join(' ')).toContain('\\"digest.md\\"')
    } finally { await runtime.stop() }
  })

  it('does not ask the desktop when the operator did not turn it on', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      const id = await started(context)
      await report(context, id, { state: 'ready', summary: '写好了' })
      await settle(runtime)
      expect(host.calls.spawns.filter(spawn => spawn.argv[0] === 'osascript')).toEqual([])
    } finally { await runtime.stop() }
  })

  it('carries on when the desktop will not take it, because the notice is the record', async () => {
    if (process.platform !== 'darwin') return
    const context = await deployment('auto', { spawn: { throws: 'osascript: command not found' } })
    const { runtime, host } = context
    try {
      runtime.saveSettings({ acceptMode: 'auto', notify: { enabled: true }, sources: { inbox: { directory: context.inbox, pollMs: 1000 } } })
      const id = await started(context)
      await report(context, id, { state: 'ready', summary: '写好了' })
      await settle(runtime)
      expect(host.agents.size).toBeGreaterThan(0)
      // Settled rather than retried: a courtesy that failed is not work that is owed.
      expect(runtime.store.effectCounts()).toEqual({})
      expect(runtime.store.tickets.get(id)!.ended).toMatchObject({ outcome: 'done' })
    } finally { await runtime.stop() }
  })
})

describe('the panel\'s own view of a finished Ticket', () => {
  it('shows the result and the files, so the operator does not have to open the directory', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      const id = await started(context)
      await report(context, id, { state: 'ready', summary: '写好了', files: ['digest.md', 'notes/x.md'] })
      await settle(runtime)
      const { json } = await host.request(api(`tickets/${id}`))
      expect(json.result).toMatchObject({ summary: '写好了', files: ['digest.md', 'notes/x.md'] })
      expect(json.ended).toMatchObject({ outcome: 'done', by: 'agent' })
      expect(json.stage).toBe('done')
    } finally { await runtime.stop() }
  })

})

describe('an escalation is told once, seen from the front desk (S2)', () => {
  /**
   * The same rule as the chat-side test, observed from the other end and in the other harness: this deployment has no
   * `replyTo` at all (the inbox shape), so nothing can reach a requester and the only observer is the front desk.
   *
   * It exists because the wiring guard in `chat-send.spec.ts` is otherwise the ONLY thing standing between the
   * runtime's call to `isFirstEscalation` and silence: the pure function has its own unit test, and that test stays
   * green when the mutation removes the CALL. Two layers, two directions — deleting either one leaves the other red.
   */
  it('wakes the front desk for the first give-up and not for the two that follow', async () => {
    const context = await deployment('auto')
    const runtime = context.runtime
    try {
      await runtime.createMainSession()
      // 用本文件已有的 helper 起一张真实的任务：自己往 inbox 丢文件再 wait(120) 不够，扫描要一个 pass。
      const id = await started(context)
      const ticket = runtime.store.tickets.get(id)!
      const host = (runtime as unknown as {
        watchdogHost(): { escalate(ticketId: string, why: string): void }
      }).watchdogHost()
      const why = 'has not started after 2 attempts to rescue it; it needs a person'
      host.escalate(ticket.id, why)
      await settle(runtime)
      host.escalate(ticket.id, why)
      host.escalate(ticket.id, why)
      await settle(runtime)

      // Recorded every time — the history is what answers "how many times did we give up".
      expect(runtime.store.events.list(ticket.id).filter(event => event.type === 'escalated')).toHaveLength(3)
      // Told once: the front desk was woken for the first and not for the repeats.
      const desk = context.host.agents.get('myagent-main')!
      expect(desk.followups.filter(item => item.text.includes('the Watchdog has given up'))).toHaveLength(1)
      expect(desk.followups.at(-1)!.text).toContain('myagent_retry_ticket')
    } finally { await runtime.stop() }
  })
})

/**
 * 【R2 F-D5 防回声】纯分诊单（所有 Assignment 都是 triage role）由总管自己调 close_ticket 结案，
 * 结案后 delivery 不应反向 relay 唤醒总管再跑「确认回执」空轮次（活体 seq=166→171 白烧 ~100s）。
 * 普通 worker 票的 ready/failed/dropped 仍保持 F1 唤醒总管。
 */
describe('self-closed triage Ticket does not echo-relay back to the desk (R2 F-D5)', () => {
  it('a triage ready result leaves a silent notify and does not wake the desk a second time', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      await runtime.createMainSession()
      runtime.saveSettings({
        acceptMode: 'auto',
        allowedSenders: ['operator'],
        triage: { enabled: true, desk: 'main', sources: ['chat', 'inbox', 'cron'] },
        sources: { inbox: { directory: context.inbox, pollMs: 1000 } },
      })

      // 创建一张分诊单并手动推进到 running
      const path = `${context.inbox}/triage-echo-test.md`
      writeFileSync(path, '现在纽约天气怎么样', 'utf8')
      const at = new Date(Date.now() - 5_000)
      utimesSync(path, at, at)
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      expect(ticket.assignments.at(-1)!.role).toBe('triage')

      const desk = host.agents.get('myagent-main')!
      const followupsBefore = desk.followups.length

      // 总管调 engine.report(ready) 结案分诊单（模拟 close_ticket 结果）
      runtime.engine.assignmentStarted(ticket.id, ticket.assignments.at(-1)!.id)
      runtime.engine.report(ticket.id, { state: 'ready', summary: '直接回答了请求者。' })
      await settle(runtime)

      // 结案后 notify 只留档，不 relay 唤醒总管
      expect(desk.followups.length, '分诈单结案后绝不能有新的 relay 唤醒总管').toBe(followupsBefore)
      // 分诈单真的结案了
      expect(runtime.store.tickets.get(ticket.id)!.ended?.outcome).toBe('done')
    } finally { await runtime.stop() }
  })
})
