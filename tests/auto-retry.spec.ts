/**
 * The mechanism that keeps work moving when the upstream dies: a turn that ends in an error while its Ticket still
 * says running is relaunched automatically (unbounded unless `watchdog.autoRetryMax` caps it), and the operator's
 * decision queue — the panel's 「需要你决断的事」 — is where anything that is a person's call gets parked instead of
 * stopping the work.
 *
 * The standing instruction this implements: "一直推进，直到全部完成；中间不需要我决断". A flaky upstream used to be a
 * full stop (DSH exhausts its own five model retries and ends the turn in error; nothing in myagent moved the Ticket
 * again). These tests own both halves of the replacement: the relaunch, and the queue that catches what the relaunch
 * cannot fix.
 */
import { utimesSync, writeFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { KV } from '../src/app/store.ts'
import { waitsForPerson } from '../src/core/index.ts'
import type { Runtime } from '../src/app/runtime.ts'
import { deployment, api, type Deployment } from './helpers/deployment.ts'
import { wait, type StubHost } from './helpers/host.ts'

const workerId = (ticketId: string) => `worker-${ticketId}`
/** The panel's own headers, which is what makes a request same-origin. */
const PANEL_HEADERS = { host: '127.0.0.1:3080', 'x-myagent-request': '1' }

async function settle(runtime: Runtime, ms = 80): Promise<void> {
  await runtime.nudge()
  await wait(ms)
  runtime.passes.requestPass()
  await wait(ms)
}

/**
 * One upstream failure, arriving the way DSH delivers it: `agent/error` for the Session, then that turn ending with
 * the reason DSH wrote into the Session's log. Injected through the host's event surface, never through a hook in
 * `src/`, so the listeners under test are the ones that ship.
 */
function failUpstream(host: StubHost, sessionId: string, message: string): void {
  const agent = host.agents.get(sessionId)!
  const error = new Error(message)
  error.name = 'LlmError'
  host.emit('agent/error', { agent, error })
  agent.session.events.push({
    seq: agent.session.events.length + 1, type: 'turn/end',
    data: { turn: agent.session.events.length, reason: { kind: 'error', error: { message, code: 'RATE_LIMIT', status: 429 } } },
  })
  agent.status = 'idle'
  host.emit('agent/status', { agent, status: 'idle' })
}

/** One accepted Ticket with its worker running. */
async function started(context: Deployment, text: string): Promise<string> {
  const known = new Set(context.runtime.store.tickets.list().map(ticket => ticket.id))
  const path = `${context.inbox}/task-${Math.random().toString(36).slice(2, 8)}.md`
  writeFileSync(path, text, 'utf8')
  const at = new Date(Date.now() - 5_000)
  utimesSync(path, at, at)
  await settle(context.runtime)
  const fresh = context.runtime.store.tickets.list().filter(ticket => !known.has(ticket.id))
  expect(fresh).toHaveLength(1)
  expect(fresh[0]!.assignments.at(-1)!.state).toBe('running')
  return fresh[0]!.id
}

const merge = (context: Deployment, patch: Record<string, unknown>): void => {
  const current = context.runtime.settings() as unknown as Record<string, unknown>
  context.runtime.saveSettings({ ...current, ...patch })
}

describe('a turn that dies in an upstream error', () => {
  it('is relaunched automatically, and the relaunch is visible on the board, in the log and in the count', async () => {
    const context = await deployment()
    try {
      const id = await started(context, '信息比对')
      failUpstream(context.host, workerId(id), '429: Rate limit: 60 requests per minute per account.')
      await settle(context.runtime)

      const ticket = context.runtime.store.tickets.get(id)!
      // The dead attempt ends as interrupted and a fresh one takes over — the same primitive crash recovery uses,
      // so a relaunch is not a second code path with its own invariants.
      expect(ticket.assignments).toHaveLength(2)
      expect(ticket.assignments[0]!.state).toBe('ended')
      expect(ticket.assignments[0]!.endedReason).toBe('interrupted')
      expect(ticket.assignments.at(-1)!.state).not.toBe('ended')
      const interrupted = context.runtime.engine.history(id).find(event => event.type === 'interrupted')
      expect(interrupted?.detail).toMatchObject({ why: expect.stringContaining('auto-retry') })
      // The count is bookkeeping about the host, not part of the work's history.
      expect(context.runtime.store.get<number>(KV.autoRetry(id))).toBe(1)
      // And the operator's "now" signal says it happened, rather than showing a healthy system with a dead Ticket.
      expect(context.runtime.health.problems().map(problem => problem.detail).join('\n')).toContain('auto-relaunched')
      // Nothing went to a person: the whole point is that this is not anybody's to handle yet.
      expect(context.runtime.decisions()).toHaveLength(0)
      expect(waitsForPerson(ticket)).toBe(false)
    } finally { await context.runtime.stop() }
  })

  it('is uncapped by default: a second dead turn relaunches again instead of failing the Ticket', async () => {
    const context = await deployment()
    try {
      const id = await started(context, '搜集信息')
      failUpstream(context.host, workerId(id), '429: Rate limit.')
      await settle(context.runtime)
      failUpstream(context.host, workerId(id), 'ECONNREFUSED: the provider closed the connection')
      await settle(context.runtime)

      const ticket = context.runtime.store.tickets.get(id)!
      expect(ticket.assignments).toHaveLength(3)
      expect(context.runtime.store.get<number>(KV.autoRetry(id))).toBe(2)
      expect(ticket.ended).toBeUndefined()
      expect(context.runtime.decisions()).toHaveLength(0)
    } finally { await context.runtime.stop() }
  })

  it('stops at watchdog.autoRetryMax, fails the Ticket in front of a person, and parks a decision-queue entry', async () => {
    const context = await deployment()
    try {
      merge(context, { watchdog: { ...context.runtime.settings().watchdog, autoRetryMax: 1 } })
      const id = await started(context, '整理竞品动态')
      failUpstream(context.host, workerId(id), '429: Rate limit.')
      await settle(context.runtime)
      expect(context.runtime.store.tickets.get(id)!.assignments).toHaveLength(2)
      // The cap is reached on the SECOND dead turn: one relaunch was allowed, the next is a person's.
      failUpstream(context.host, workerId(id), '429: Rate limit.')
      await settle(context.runtime)

      const ticket = context.runtime.store.tickets.get(id)!
      expect(waitsForPerson(ticket)).toBe(true)
      const failed = ticket.assignments.at(-1)!.report
      expect(failed).toMatchObject({ state: 'failed' })
      expect(failed!.summary).toContain('自动重试 1 次后仍失败')
      const queue = context.runtime.decisions()
      expect(queue).toHaveLength(1)
      expect(queue[0]!.title).toContain('自动重试 1 次后仍失败')
      expect(queue[0]!.source).toBe('auto-retry')
    } finally { await context.runtime.stop() }
  })

  it('does nothing at all when watchdog.autoRetry is off, which is the pre-0.11.0 shape', async () => {
    const context = await deployment()
    try {
      merge(context, { watchdog: { ...context.runtime.settings().watchdog, autoRetry: false } })
      const id = await started(context, '写一份摘要')
      failUpstream(context.host, workerId(id), '429: Rate limit.')
      await settle(context.runtime)
      expect(context.runtime.store.tickets.get(id)!.assignments).toHaveLength(1)
      expect(context.runtime.store.get<number>(KV.autoRetry(id))).toBeUndefined()
    } finally { await context.runtime.stop() }
  })
})

describe('the operator decision queue', () => {
  it('is raised by a worker tool, read over the panel route, and dismissed over the panel route', async () => {
    const context = await deployment()
    try {
      const id = await started(context, '侦察 GitHub 生态')
      const tool = context.host.tool(workerId(id), 'myagent_raise_decision')
      expect(tool, 'worker 应当拿得到 myagent_raise_decision').toBeDefined()
      const raised = await tool!.definition.execute(
        { title: '要不要给桥加心跳？', detail: '桥进程死掉时聊天侧完全沉默；建议加每轮心跳文件。' },
        { signal: new AbortController().signal },
      ) as { raised: string }
      expect(raised.raised).toBeTruthy()

      const listed = await context.host.request(api('operator-queue'), { headers: PANEL_HEADERS })
      expect(listed.status).toBe(200)
      const items = listed.json.items as { id: string; title: string; source: string }[]
      expect(items.map(item => item.title)).toContain('要不要给桥加心跳？')
      expect(items[0]!.source).toBe(`ticket:${id}`)

      const dismissed = await context.host.request(api(`operator-queue/${items[0]!.id}/dismiss`),
        { method: 'POST', headers: PANEL_HEADERS, body: {} })
      expect(dismissed.status).toBe(200)
      const after = await context.host.request(api('operator-queue'), { headers: PANEL_HEADERS })
      expect((after.json.items as unknown[])).toHaveLength(0)
    } finally { await context.runtime.stop() }
  })

  it('is offered to the front desk as well, because a decision can surface while talking to the requester', async () => {
    const context = await deployment()
    try {
      const created = await context.runtime.createMainSession()
      expect(created.sessionId).toBeTruthy()
      const names = context.host.toolsOf(created.sessionId!)
      expect(names).toContain('myagent_raise_decision')
    } finally { await context.runtime.stop() }
  })
})
