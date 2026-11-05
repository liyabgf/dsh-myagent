/**
 * Idempotent delivery: the reason a retry after a crash does not hand a worker the same work twice.
 *
 * Two faces are deduplicated — the Session's persisted history and the messages still waiting in its inbox — because a
 * restore sees the first and a live agent the second. Missing either one means a daily digest gets written twice, or a
 * question gets asked twice, and nothing in the record says why.
 */
import { describe, expect, it } from 'vitest'
import { AgentDelivery, messageId } from '../src/app/agent-delivery.ts'
import { stubHost, type AgentRecord } from './helpers/host.ts'

const signal = () => new AbortController().signal

interface Harness {
  readonly host: ReturnType<typeof stubHost>
  readonly delivery: AgentDelivery
  readonly agent: AgentRecord
}

function harness(): Harness {
  const host = stubHost()
  const agent = host.spawn('worker-1')
  return { host, delivery: new AgentDelivery(host.ctx), agent }
}

describe('the delivery id', () => {
  it('is derived from the request, so every retry of one request produces the same message id', () => {
    expect(messageId('launch:ticket-1')).toBe(messageId('launch:ticket-1'))
    expect(messageId('launch:ticket-1')).not.toBe(messageId('launch:ticket-2'))
    expect(String(messageId('launch:ticket-1'))).toContain('myagent:launch:ticket-1')
  })
})

describe('delivering work', () => {
  it('queues a message the worker answers in its next turn, and flushes before the caller acknowledges', async () => {
    const { delivery, agent, host } = harness()
    let acknowledged = 0
    await delivery.send(agent as never, 'launch:ticket-1', '# Ticket: 做点事', 'queue', signal(), () => { acknowledged++ })
    expect(agent.followups).toHaveLength(1)
    expect(agent.followups[0]!.text).toBe('# Ticket: 做点事')
    expect(agent.followups[0]!.source).toEqual({ kind: 'myagent', form: 'relay' })
    expect(acknowledged).toBe(1)
    expect(host.flushes()).toBeGreaterThan(0)
    // The message waits in the inbox, which is what a second attempt sees.
    expect(agent.inbox.nextTurn).toHaveLength(1)
  })

  it('does not deliver the same request twice while the first is still waiting', async () => {
    const { delivery, agent } = harness()
    let acknowledged = 0
    await delivery.send(agent as never, 'launch:ticket-1', '做点事', 'queue', signal(), () => { acknowledged++ })
    await delivery.send(agent as never, 'launch:ticket-1', '做点事', 'queue', signal(), () => { acknowledged++ })
    expect(agent.followups).toHaveLength(1)
    // The caller still acknowledges: the work is in the Session's hands, which is all it asked to know.
    expect(acknowledged).toBe(2)
  })

  it('delivers a different request to the same worker, which is how an answer follows the task', async () => {
    const { delivery, agent } = harness()
    await delivery.send(agent as never, 'launch:ticket-1', '做点事', 'queue', signal())
    await delivery.send(agent as never, 'input:ticket-1:2', '按公司排', 'queue', signal())
    expect(agent.followups.map(item => item.text)).toEqual(['做点事', '按公司排'])
  })

  it('injects a notice into the history without waking the worker', async () => {
    const { delivery, agent } = harness()
    await delivery.send(agent as never, 'notify:ticket-1', 'Ticket 已完成', { inject: '每日摘要 — done' }, signal())
    expect(agent.followups).toEqual([])
    expect(agent.notices).toHaveLength(1)
    expect(agent.notices[0]!.source).toEqual({ kind: 'myagent', form: 'notice', summary: '每日摘要 — done' })
    // The notice is in the Session's own log, which is what a restore reads.
    expect(agent.log.map(event => event.type)).toEqual(['user/message'])
  })

  it('does not inject the same notice twice, in one process or after a restart', async () => {
    const { host, delivery, agent } = harness()
    await delivery.send(agent as never, 'notify:ticket-1', 'Ticket 已完成', { inject: '每日摘要 — done' }, signal())
    await delivery.send(agent as never, 'notify:ticket-1', 'Ticket 已完成', { inject: '每日摘要 — done' }, signal())
    expect(agent.notices).toHaveLength(1)
    // A restart builds a new delivery over the same persisted Session, and the log is what stops the duplicate.
    const revived = new AgentDelivery(host.ctx)
    await revived.send(agent as never, 'notify:ticket-1', 'Ticket 已完成', { inject: '每日摘要 — done' }, signal())
    expect(agent.notices).toHaveLength(1)
    expect(await revived.holds(agent as never, 'notify:ticket-1')).toBe(true)
    expect(await revived.holds(agent as never, 'notify:other')).toBe(false)
  })

  it('reads a restored Session\'s history across pages, so a long log still deduplicates', async () => {
    const { host, agent } = harness()
    // A Session whose log is longer than one page, with the delivery somewhere in the middle.
    for (let index = 0; index < 1200; index++) {
      agent.log.push({ seq: index, type: index === 700 ? 'user/message' : 'step/start', data: index === 700
        ? { id: messageId('launch:ticket-1'), role: 'user', content: [{ type: 'text', text: '做点事' }], source: { kind: 'myagent', form: 'relay' } }
        : {} })
    }
    const revived = new AgentDelivery(host.ctx)
    expect(await revived.holds(agent as never, 'launch:ticket-1')).toBe(true)
    await revived.send(agent as never, 'launch:ticket-1', '做点事', 'queue', signal())
    expect(agent.followups).toEqual([])
  })

  it('does not mistake another producer\'s message for one of its own', async () => {
    const { delivery, agent } = harness()
    agent.log.push({
      seq: 0, type: 'user/message',
      data: { id: messageId('launch:ticket-1'), role: 'user', content: [{ type: 'text', text: '同一段文字' }], source: { kind: 'user' } },
    })
    // Same text, same id shape, another producer: this delivery has not happened.
    expect(await delivery.holds(agent as never, 'launch:ticket-1')).toBe(false)
    await delivery.send(agent as never, 'launch:ticket-1', '做点事', 'queue', signal())
    expect(agent.followups).toHaveLength(1)
  })

  it('records what reached the history by another route, through the session event listener', async () => {
    const { host, delivery, agent } = harness()
    // A message this process did not send — the worker's own Session received it — still counts as delivered.
    host.emit('session/event', [agent.session, {
      type: 'user/message',
      data: { id: messageId('launch:ticket-1'), role: 'user', content: [], source: { kind: 'myagent', form: 'relay' } },
    }])
    expect(await delivery.holds(agent as never, 'launch:ticket-1')).toBe(true)
  })
})

describe('a delivery that cannot be made', () => {
  it('refuses a target that was disposed, rather than writing into a Session nobody owns', async () => {
    const { host, delivery, agent } = harness()
    host.agents.delete('worker-1')
    await expect(delivery.send(agent as never, 'launch:ticket-1', '做点事', 'queue', signal()))
      .rejects.toThrow(/delivery target was disposed/)
    expect(agent.followups).toEqual([])
  })

  it('refuses an aborted signal before it touches anything', async () => {
    const { delivery, agent, host } = harness()
    const controller = new AbortController()
    controller.abort()
    const flushes = host.flushes()
    await expect(delivery.send(agent as never, 'launch:ticket-1', '做点事', 'queue', controller.signal))
      .rejects.toSatisfy((error: unknown) => error instanceof Error)
    expect(agent.followups).toEqual([])
    expect(host.flushes()).toBe(flushes)
  })

  it('survives a persistence layer that will not read, and says so instead of duplicating', async () => {
    const host = stubHost()
    const agent = host.spawn('worker-1')
    // A history that cannot be read must not be treated as an empty one: that is how a duplicate gets delivered.
    const broken = new AgentDelivery({
      ...host.ctx,
      sessionPersistence: { flush: async () => {}, open: async () => { throw new Error('the log is locked') } },
    } as never)
    await expect(broken.send(agent as never, 'launch:ticket-1', '做点事', 'queue', signal())).rejects.toThrow(/the log is locked/)
    expect(agent.followups).toEqual([])
    // And the failure is not cached: once the log can be read again, the delivery goes through once.
    const working = new AgentDelivery(host.ctx)
    await working.send(agent as never, 'launch:ticket-1', '做点事', 'queue', signal())
    expect(agent.followups).toHaveLength(1)
  })
})
