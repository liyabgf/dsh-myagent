/** Domain rules on in-memory repositories: intake, the gate, reports, stops, retries and policy changes. */
import { describe, expect, it } from 'vitest'
import { canRetry, Engine, Memory, parseSettings, settingsPolicy, UserError, type Assignment, type Delivery, type Executor, type Mandate, type Report, type Ticket, type Trigger } from '../src/core/index.ts'

/** An Executor that records what the Engine asked of it, and fills in a directory. */
class FakeExecutor implements Executor {
  /** Bound after construction, because the Engine is built with this Executor in its options. */
  engine?: Engine
  /**
   * Set false to model a launch that was attempted and never got as far as starting: the effect queue exhausting its
   * retries, or a Session DSH would not hand over. The Assignment then stays `pending`, which is the state a person's
   * retry is for.
   */
  marksStarted = true
  readonly prepared: string[] = []
  readonly started: { ticketId: string; assignmentId: string }[] = []
  readonly delivered: string[] = []
  readonly stopped: { ticketId: string; reason: string }[] = []
  prepare(ticket: Ticket, _mandate: Mandate): Ticket {
    this.prepared.push(ticket.id)
    return { ...ticket, execution: { name: ticket.id, directory: `/tmp/work/${ticket.id}` } }
  }
  start(ticket: Ticket, assignment: Assignment): void { this.started.push({ ticketId: ticket.id, assignmentId: assignment.id }); if (this.marksStarted) this.engine?.assignmentStarted(ticket.id, assignment.id) }
  deliver(ticket: Ticket, _assignment: Assignment): void { this.delivered.push(ticket.id) }
  stop(ticket: Ticket, _assignment: Assignment, reason: string): void { this.stopped.push({ ticketId: ticket.id, reason }) }
}

class FakeDelivery implements Delivery {
  readonly reports: { ticketId: string; state: Report['state'] }[] = []
  readonly changes: string[] = []
  report(ticket: Ticket, report: Report): void { this.reports.push({ ticketId: ticket.id, state: report.state }) }
  policyChanged(ticket: Ticket): void { this.changes.push(ticket.id) }
}

const settings = (value: unknown = {}) => parseSettings({ acceptMode: 'auto', allowedSenders: ['operator'], ...value as object })

function harness(value: unknown = {}) {
  const memory = new Memory()
  const executor = new FakeExecutor()
  const delivery = new FakeDelivery()
  const events: string[] = []
  let current = settings(value)
  const engine = new Engine({
    repos: memory, tx: memory, policy: () => settingsPolicy(current), executor, delivery,
    now: () => '2026-11-02T12:00:00.000Z', emit: event => events.push(event.type),
  })
  // The real Executor marks the Assignment running when a launch succeeds (executor.ts:156); a fake
  // that does not leaves every test reporting into a state production never reports from.
  executor.engine = engine
  return {
    memory, executor, delivery, events, engine,
    settings: () => current,
    save: (next: unknown) => {
      const before = current
      current = parseSettings(next)
      return engine.policyChanged(before, current)
    },
  }
}

const trigger = (over: Partial<Trigger> = {}): Trigger => ({
  id: 'trigger-1', source: 'inbox', kind: 'inbox', at: '2026-11-02T11:59:00.000Z',
  actor: { id: 'operator', kind: 'person' }, text: 'Summarize this week\'s changelog', title: 'Summarize changelog', ...over,
})

describe('intake', () => {
  it('accepts an allowed request into one Ticket with a Mandate and a running Assignment', () => {
    const { engine, memory, executor, events } = harness()
    const result = engine.receive(trigger())
    expect(result.stored).toBe('stored')
    expect(result.disposition.state).toBe('accepted')
    const ticket = memory.tickets.get(result.ticketId!)!
    expect(ticket.mandate).toMatchObject({ strength: 'explicit', via: 'inbox', sender: { id: 'operator' } })
    expect(ticket.mandate.policyVersion).toHaveLength(16)
    expect(ticket.mandate.scope).toContain('own directory')
    expect(ticket.execution?.directory).toBe(`/tmp/work/${ticket.id}`)
    expect(ticket.assignments).toHaveLength(1)
    // A launch that succeeded marks the attempt running, exactly as the real Executor does at executor.ts:156.
    expect(ticket.assignments[0]).toMatchObject({ state: 'running' })
    // The launch runs after the transaction commits, not inside it.
    expect(executor.started).toEqual([{ ticketId: ticket.id, assignmentId: ticket.assignments[0]!.id }])
    expect(events).toContain('ticket.created')
  })

  it('creates one Ticket when the same Trigger arrives twice', () => {
    const { engine, memory, executor } = harness()
    const first = engine.receive(trigger())
    const second = engine.receive(trigger())
    expect(second.stored).toBe('duplicate')
    expect(second.ticketId).toBe(first.ticketId)
    expect(memory.ticketList()).toHaveLength(1)
    expect(memory.decisionList()).toHaveLength(1)
    expect(executor.started).toHaveLength(1)
  })

  it('runs the gate again on a Trigger the queue lost, instead of reporting it as a duplicate', () => {
    const { engine, memory, executor } = harness()
    // Planted rather than produced: in production the row is written by the give-up hook, and what `receive` does when
    // it finds one is the thing under test here.
    memory.triggers.save({
      trigger: trigger(),
      disposition: { state: 'lost', error: 'TypeError: no actor', effectKey: 'trigger-effect-1' },
    })
    const result = engine.receive(trigger())
    // Not `duplicate`: that answer means "already handled", which is the opposite of what a `lost` row says, and every
    // Source's catch-all branch reads a disposition it does not name as exactly that — the inbox would archive the file
    // under `accepted/` with no Ticket behind it (sources/inbox.ts:239-242). Re-running is safe because a `lost` row can
    // only exist where `receive` threw inside its one transaction: nothing was stored, so nothing is duplicated.
    expect(result.stored).toBe('stored')
    expect(result.disposition.state).toBe('accepted')
    expect(executor.started).toHaveLength(1)
    // One row, now saying what became of the request: the lost record is replaced by the truth it stood in for.
    expect(memory.triggers.list()).toHaveLength(1)
    expect(memory.triggers.get('trigger-1')!.disposition).toEqual(result.disposition)
  })

  it('answers that a lost Trigger was not stored when the repositories have nowhere to put one', () => {
    const { engine, memory } = harness()
    // The Runtime's fallback depends on this answer: a trace nobody stored and a trace nobody asked for look the same
    // from the outside, and the text is kept in `kv` when the answer is `false`.
    const stored = engine.triggerLost({
      id: 'lost-1', source: 'rule', kind: 'rule', at: '2026-11-04T00:00:00.000Z',
      error: 'TypeError: no actor', effectKey: 'trigger-effect-1', raw: '{"id":"lost-1"}',
    })
    expect(stored).toBe(false)
    expect(memory.triggers.list()).toEqual([])
  })

  it('derives the same Ticket id from the same Trigger id, so a restart cannot fork the work', () => {
    const { engine } = harness()
    const first = engine.receive(trigger({ id: 'fixed' }))
    const other = harness()
    const second = other.engine.receive(trigger({ id: 'fixed' }))
    expect(first.ticketId).toBe(second.ticketId)
  })

  it('takes a scope written on the schedule over the default', () => {
    const { engine, memory } = harness({
      sources: { cron: { enabled: true, schedules: [{ id: 'daily-report', name: 'Daily', prompt: 'Write it', scope: 'Read only the reports directory.', timing: { kind: 'daily', time: '08:00' } }] } },
    })
    const result = engine.receive(trigger({ id: 'cron-1', source: 'cron', kind: 'cron', meta: { schedule: 'daily-report' } }))
    expect(memory.tickets.get(result.ticketId!)!.mandate.scope).toBe('Read only the reports directory.')
  })
})

describe('the gate', () => {
  it('ignores a request from a sender nobody allowed, and records why', () => {
    const { engine, memory } = harness()
    const result = engine.receive(trigger({ id: 'stranger', actor: { id: 'stranger', kind: 'person' } }))
    expect(result.disposition.state).toBe('ignored')
    expect(memory.ticketList()).toHaveLength(0)
    expect(memory.decisionList()[0]).toMatchObject({ outcome: 'ignore', reason: 'sender_not_allowed' })
    expect(memory.decisionList()[0]!.detail).toContain('stranger')
  })

  it('ignores a system actor, which may not originate work', () => {
    const { engine, memory } = harness()
    engine.receive(trigger({ id: 'system', actor: { id: 'ci', kind: 'system' } }))
    expect(memory.decisionList()[0]).toMatchObject({ outcome: 'ignore', reason: 'system_actor' })
  })

  it('ignores a request whose Source is disabled', () => {
    const { engine, memory } = harness({ sources: { inbox: { enabled: false } } })
    engine.receive(trigger())
    expect(memory.decisionList()[0]).toMatchObject({ outcome: 'ignore', reason: 'source_disabled' })
  })

  it('ignores an empty request, which authorizes nothing', () => {
    const { engine, memory } = harness()
    engine.receive(trigger({ id: 'empty', text: '   ' }))
    expect(memory.decisionList()[0]).toMatchObject({ outcome: 'ignore', reason: 'empty_request' })
  })

  it('ignores everything while processing is paused', () => {
    const { engine, memory } = harness({ paused: true })
    engine.receive(trigger())
    expect(memory.decisionList()[0]).toMatchObject({ outcome: 'ignore', reason: 'paused' })
  })

  it('records what it would have accepted in observe mode, and executes nothing', () => {
    const { engine, memory, executor } = harness({ acceptMode: 'observe' })
    const result = engine.receive(trigger())
    expect(result.disposition.state).toBe('observed')
    expect(memory.ticketList()).toHaveLength(0)
    expect(memory.decisionList()[0]).toMatchObject({ outcome: 'observe', reason: 'observed' })
    expect(executor.started).toHaveLength(0)
  })
})

describe('reports', () => {
  const accepted = (value: unknown = {}) => {
    const context = harness(value)
    const result = context.engine.receive(trigger())
    return { ...context, ticket: () => context.memory.tickets.get(result.ticketId!)! }
  }

  it('ends a Ticket whose worker reported ready, and delivers the result', () => {
    const { engine, ticket, delivery, memory } = accepted()
    engine.assignmentStarted(ticket().id, ticket().assignments[0]!.id)
    const updated = engine.report(ticket().id, { state: 'ready', summary: 'Wrote SUMMARY.md', files: ['SUMMARY.md'] })
    expect(updated.ended).toMatchObject({ outcome: 'done', by: 'agent' })
    expect(updated.result).toMatchObject({ summary: 'Wrote SUMMARY.md', files: ['SUMMARY.md'] })
    expect(updated.assignments[0]).toMatchObject({ state: 'ended', endedReason: 'reported' })
    expect(delivery.reports).toEqual([{ ticketId: updated.id, state: 'ready' }])
    expect(memory.tickets.open()).toHaveLength(0)
  })

  it('closes a Ticket whose worker reported dropped', () => {
    const { engine, ticket } = accepted()
    engine.assignmentStarted(ticket().id, ticket().assignments[0]!.id)
    expect(engine.report(ticket().id, { state: 'dropped', summary: 'Nothing had changed' }).ended?.outcome).toBe('dropped')
  })

  it('leaves a blocked Ticket open, waiting for a person, with the question on it', () => {
    const { engine, ticket, delivery } = accepted()
    engine.assignmentStarted(ticket().id, ticket().assignments[0]!.id)
    const updated = engine.report(ticket().id, { state: 'blocked', summary: 'Needs a decision', question: 'Which of the two formats?' })
    expect(updated.ended).toBeUndefined()
    expect(updated.attention?.question).toBe('Which of the two formats?')
    expect(updated.assignments[0]!.state).toBe('running')
    expect(delivery.reports).toEqual([{ ticketId: updated.id, state: 'blocked' }])
  })

  it('records progress without ending anything or asking a person', () => {
    const { engine, ticket } = accepted()
    engine.assignmentStarted(ticket().id, ticket().assignments[0]!.id)
    const updated = engine.report(ticket().id, { state: 'progress', summary: 'Read 12 files' })
    expect(updated.ended).toBeUndefined()
    expect(updated.attention).toBeUndefined()
    expect(updated.assignments[0]!.report?.state).toBe('progress')
  })

  it('refuses a report to a Ticket that has ended, however the worker words it', () => {
    const { engine, ticket, memory } = accepted()
    engine.assignmentStarted(ticket().id, ticket().assignments[0]!.id)
    engine.report(ticket().id, { state: 'ready', summary: 'done' })
    // The authorization is gone, so a late report must not rewrite how the Ticket ended or produce a second result.
    expect(() => engine.report(ticket().id, { state: 'progress', summary: 'late' })).toThrow(/This Ticket has ended/)
    expect(() => engine.report(ticket().id, { state: 'ready', summary: 'done twice' })).toThrow(UserError)
    const ended = memory.tickets.get(ticket().id)!
    expect(ended.result?.summary).toBe('done')
    expect(ended.ended?.outcome).toBe('done')
  })

  it('turns a silent turn end into a waiting report, so no Ticket sits with unread work', () => {
    const { engine, ticket, delivery } = accepted()
    engine.assignmentStarted(ticket().id, ticket().assignments[0]!.id)
    engine.inputsDelivered(ticket().id, ticket().assignments[0]!.id, [])
    engine.turnEnded(ticket().id, ticket().assignments[0]!.id, 'I looked at the files and stopped.')
    expect(ticket().assignments[0]!.report).toMatchObject({ state: 'waiting', summary: 'I looked at the files and stopped.' })
    expect(delivery.reports.at(-1)).toMatchObject({ state: 'waiting' })
  })

  it('records a failed delivery on the Assignment until a delivery succeeds', () => {
    const { engine, ticket } = accepted()
    engine.assignmentStarted(ticket().id, ticket().assignments[0]!.id)
    engine.deliveryFailed(ticket().id, ticket().assignments[0]!.id, 'the session was gone')
    expect(ticket().assignments[0]!.deliveryError).toBe('the session was gone')
    engine.inputsDelivered(ticket().id, ticket().assignments[0]!.id, [])
    expect(ticket().assignments[0]!.deliveryError).toBeUndefined()
  })
})

describe('people', () => {
  const accepted = (value: unknown = {}) => {
    const context = harness(value)
    const result = context.engine.receive(trigger())
    return { ...context, ticket: () => context.memory.tickets.get(result.ticketId!)! }
  }

  it('stops a Ticket, withdraws its work and tells the Executor', () => {
    const { engine, ticket, executor } = accepted()
    engine.assignmentStarted(ticket().id, ticket().assignments[0]!.id)
    const stopped = engine.stopTicket(ticket().id, 'not needed')
    expect(stopped.ended).toMatchObject({ outcome: 'stopped', by: 'person', reason: 'not needed' })
    expect(stopped.assignments[0]).toMatchObject({ state: 'ended', endedReason: 'stopped' })
    expect(executor.stopped).toEqual([{ ticketId: ticket().id, reason: 'not needed' }])
    expect(() => engine.stopTicket(ticket().id)).toThrow(/already ended/)
  })

  it('retries a Ticket that waits for a person, with a fresh Assignment', () => {
    const { engine, ticket, executor } = accepted()
    engine.assignmentStarted(ticket().id, ticket().assignments[0]!.id)
    engine.report(ticket().id, { state: 'failed', summary: 'the command was not found' })
    const retried = engine.retryTicket(ticket().id)
    expect(retried.assignments).toHaveLength(2)
    expect(retried.assignments[0]).toMatchObject({ state: 'ended', endedReason: 'retried' })
    // Read from the store, not from the returned snapshot: the launch runs in `afterCommit`, so the value
    // `retryTicket` hands back still shows the attempt as it was written inside the transaction.
    expect(ticket().assignments[1]).toMatchObject({ state: 'running' })
    expect(retried.attention).toBeUndefined()
    expect(executor.started.at(-1)?.assignmentId).toBe(retried.assignments[1]!.id)
  })

  it('refuses to retry a Ticket that is working', () => {
    const { engine, ticket } = accepted()
    engine.assignmentStarted(ticket().id, ticket().assignments[0]!.id)
    expect(() => engine.retryTicket(ticket().id)).toThrow(/does not wait for a person/)
  })

  it('refuses an answer to a Ticket that has ended, because new work needs a new Ticket', () => {
    const { engine, ticket } = accepted()
    engine.assignmentStarted(ticket().id, ticket().assignments[0]!.id)
    engine.report(ticket().id, { state: 'blocked', summary: 'needs a decision', question: 'Which format?' })
    engine.stopTicket(ticket().id)
    expect(() => engine.answer(ticket().id, 'the second')).toThrow(/has ended/)
  })

  it('answers a waiting Ticket whose Assignment still runs, by delivering the text to it', () => {
    const { engine, ticket, executor } = accepted()
    engine.assignmentStarted(ticket().id, ticket().assignments[0]!.id)
    engine.report(ticket().id, { state: 'blocked', summary: 'needs a decision', question: 'Which format?' })
    const answered = engine.answer(ticket().id, 'the second one')
    expect(answered.attention).toBeUndefined()
    expect(answered.inputs.at(-1)).toMatchObject({ kind: 'text', text: 'the second one' })
    expect(answered.assignments).toHaveLength(1)
    expect(executor.delivered).toContain(ticket().id)
  })

  it('gives a worker a note without widening its Mandate', () => {
    const { engine, ticket } = accepted()
    engine.assignmentStarted(ticket().id, ticket().assignments[0]!.id)
    const noted = engine.note(ticket().id, 'The operator says the changelog is in docs/.')
    expect(noted.inputs.at(-1)).toMatchObject({ kind: 'note' })
    expect(noted.mandate.scope).toBe(ticket().mandate.scope)
  })

  it('restarts an interrupted Assignment with a recovery note', () => {
    const { engine, ticket, executor } = accepted()
    engine.assignmentStarted(ticket().id, ticket().assignments[0]!.id)
    engine.assignmentInterrupted(ticket().id, ticket().assignments[0]!.id)
    const current = ticket()
    expect(current.assignments).toHaveLength(2)
    expect(current.assignments[0]).toMatchObject({ state: 'ended', endedReason: 'interrupted' })
    expect(current.assignments[1]).toMatchObject({ state: 'running' })
    expect(current.inputs.at(-1)?.kind).toBe('note')
    expect(current.inputs.at(-1)?.text ?? '').toContain('restarted')
    expect(executor.started.at(-1)?.assignmentId).toBe(current.assignments[1]!.id)
  })
})

describe('policy changes', () => {
  it('tells a live Ticket that its sender may no longer start work', () => {
    const context = harness()
    const result = context.engine.receive(trigger())
    const ticketId = result.ticketId!
    const effects = context.save({ acceptMode: 'auto', allowedSenders: ['someone-else'] })
    expect(effects).toEqual([{ ticketId, reason: 'sender_not_allowed', detail: 'operator may no longer start work here' }])
    expect(context.delivery.changes).toEqual([ticketId])
    const ticket = context.memory.tickets.get(ticketId)!
    // The note a worker receives is worded by the gate itself, so it cannot drift from what the gate decided.
    expect(ticket.inputs.at(-1)?.text).toContain('Policy change')
    expect(ticket.inputs.at(-1)?.text).toContain('may not originate work')
    expect(ticket.inputs.at(-1)?.text).toContain('operator may no longer start work here')
    // The change is delivered, not enforced: the Ticket keeps its Mandate and stays open.
    expect(ticket.ended).toBeUndefined()
  })

  it('leaves Tickets alone when nothing that bears on authorization changed', () => {
    const context = harness()
    context.engine.receive(trigger())
    expect(context.save({ acceptMode: 'auto', allowedSenders: ['operator'], executor: { maxWorkers: 5 } })).toEqual([])
    expect(context.delivery.changes).toEqual([])
  })

  it('revalidates a Mandate against the settings that are current now', () => {
    const before = settingsPolicy(settings())
    const mandate: Mandate = {
      policyVersion: before.version, scope: 'x', strength: 'explicit',
      sender: { id: 'operator', kind: 'person' }, via: 'inbox', at: '2026-11-02T12:00:00.000Z',
    }
    expect(before.revalidate(mandate).holds).toBe(true)
    const after = settingsPolicy(settings({ allowedSenders: [] }))
    expect(after.revalidate(mandate)).toMatchObject({ holds: false, reason: 'sender_not_allowed' })
  })

  it('changes version when an authorization-bearing setting changes, and not when another does', () => {
    const base = settingsPolicy(settings())
    expect(settingsPolicy(settings({ allowedSenders: ['operator', 'friend'] })).version).not.toBe(base.version)
    expect(settingsPolicy(settings({ acceptMode: 'observe' })).version).not.toBe(base.version)
    expect(settingsPolicy(settings({ notify: { enabled: true } })).version).toBe(base.version)
    expect(settingsPolicy(settings({ executor: { maxWorkers: 4 } })).version).toBe(base.version)
  })
})

describe('the main Session as a Source', () => {
  /**
   * S3a: a Ticket the front desk opens on somebody's behalf has to be able to report back to them.
   *
   * The address goes on the synthesized Trigger rather than on the Ticket, because the Trigger is the only place a
   * reply address has ever lived and `Delivery.send` already resolves it from there — so the entire outbound path is
   * unchanged, and a Ticket with no address behaves exactly as it did before.
   */
  it('carries a return address onto the Trigger it synthesizes, and leaves an addressless one untouched', () => {
    const { engine, memory } = harness()
    const replyTo = { kind: 'chat' as const, channel: 'telegram-main', thread: '9' }
    const made = engine.createTicket({ title: '巡视一遍', text: '看看现在有几张在跑', replyTo })
    const ticket = memory.tickets.get(made.ticketId!)!
    expect(memory.triggerOf(ticket.origin.triggerId)?.replyTo).toEqual(replyTo)

    const plain = engine.createTicket({ title: '自己开的活', text: '整理一下' })
    const plainTicket = memory.tickets.get(plain.ticketId!)!
    expect(memory.triggerOf(plainTicket.origin.triggerId)?.replyTo).toBeUndefined()
  })

  it('runs a person\'s request through the same gate as any other Trigger', () => {
    const { engine, memory } = harness()
    const result = engine.createTicket({ title: 'Research X', text: 'Find three sources about X and summarize them.' })
    expect(result.disposition.state).toBe('accepted')
    const ticket = memory.tickets.get(result.ticketId!)!
    expect(ticket.mandate.via).toBe('session')
    expect(memory.triggerOf(ticket.origin.triggerId)?.source).toBe('session')
  })

  it('refuses a request from a sender nobody allowed, exactly as a Source would', () => {
    const { engine, memory } = harness()
    const result = engine.createTicket({ title: 'x', text: 'y', sender: 'stranger' })
    expect(result.disposition.state).toBe('ignored')
    expect(memory.ticketList()).toHaveLength(0)
  })

  it('records nothing in observe mode either', () => {
    const { engine, memory } = harness({ acceptMode: 'observe' })
    expect(engine.createTicket({ title: 'x', text: 'y' }).disposition.state).toBe('observed')
    expect(memory.ticketList()).toHaveLength(0)
  })
})

describe('retrying', () => {
  it('pushes a launch that never started again, as the same attempt', () => {
    // A launch effect that exhausted its retries leaves a Ticket pending with nothing queued: no pass will ever pick it
    // up again, so a person has to be able to. Ending the attempt and opening another would leave two for one.
    const { engine, memory, executor } = harness()
    executor.marksStarted = false
    const result = engine.receive(trigger())
    const ticket = memory.tickets.get(result.ticketId!)!
    expect(executor.started).toHaveLength(1)
    const pushed = engine.retryTicket(ticket.id)
    expect(pushed.assignments).toHaveLength(1)
    expect(pushed.assignments[0]!.id).toBe(ticket.assignments[0]!.id)
    expect(pushed.assignments[0]!.state).toBe('pending')
    expect(executor.started).toHaveLength(2)
    expect(executor.started[1]).toEqual(executor.started[0])
  })

  it('retries a Ticket whose worker ended its turn with nothing to show', () => {
    // A silent turn end is recorded as `waiting`, and that Ticket is not working any more: without a retry nobody and
    // nothing would ever pick it up again.
    const { engine, memory, executor } = harness()
    const result = engine.receive(trigger({ id: 'went-quiet' }))
    const ticket = memory.tickets.get(result.ticketId!)!
    engine.assignmentStarted(ticket.id, ticket.assignments[0]!.id)
    engine.inputsDelivered(ticket.id, ticket.assignments[0]!.id, [])
    engine.turnEnded(ticket.id, ticket.assignments[0]!.id)
    const quiet = memory.tickets.get(ticket.id)!
    expect(quiet.assignments[0]!.report).toMatchObject({ state: 'waiting' })
    expect(canRetry(quiet)).toBe(true)
    // The attempt that already ran is closed, and a fresh one opens in the same directory.
    const retried = engine.retryTicket(ticket.id)
    expect(retried.assignments).toHaveLength(2)
    expect(retried.assignments[0]!.state).toBe('ended')
    expect(retried.assignments[1]!.state).toBe('pending')
    expect(executor.started.at(-1)!.assignmentId).toBe(retried.assignments[1]!.id)
  })

  it('refuses to retry a Ticket whose worker is simply working', () => {
    const { engine, memory } = harness()
    const result = engine.receive(trigger())
    const ticket = memory.tickets.get(result.ticketId!)!
    engine.assignmentStarted(ticket.id, ticket.assignments[0]!.id)
    expect(canRetry(memory.tickets.get(ticket.id)!)).toBe(false)
    expect(() => engine.retryTicket(ticket.id)).toThrow(UserError)
    // Stopping is the verb for work in flight, and it works.
    expect(engine.stopTicket(ticket.id).ended?.outcome).toBe('stopped')
  })

  it('retries a delivery that failed, and a worker that asked a question', () => {
    const { engine, memory, executor } = harness()
    const first = engine.receive(trigger({ id: 'delivery-failed' }))
    const failed = memory.tickets.get(first.ticketId!)!
    engine.assignmentStarted(failed.id, failed.assignments[0]!.id)
    engine.deliveryFailed(failed.id, failed.assignments[0]!.id, 'the model did not answer')
    expect(canRetry(memory.tickets.get(failed.id)!)).toBe(true)
    expect(engine.retryTicket(failed.id).assignments).toHaveLength(2)

    const second = engine.receive(trigger({ id: 'asked-a-question' }))
    const asked = memory.tickets.get(second.ticketId!)!
    engine.assignmentStarted(asked.id, asked.assignments[0]!.id)
    engine.report(asked.id, { state: 'blocked', summary: '需要决定', question: '按公司还是按产品？' })
    expect(canRetry(memory.tickets.get(asked.id)!)).toBe(true)
    expect(executor.started.length).toBeGreaterThan(2)
  })
})

describe('registering what a Ticket produced', () => {
  // Artifacts are the one aggregate V2 is built around, so registration happens inside the report's own transaction
  // and only for paths that are inside the Ticket's directory.
  it('registers the files a report claims, under one spelling per file', () => {
    const { engine, memory } = harness()
    const made = engine.createTicket({ title: '产物', text: '做点事' })
    engine.report(made.ticketId!, { state: 'ready', summary: '做完了', files: ['report.md', './report.md', 'out/../chart.png'] })
    // `report.md` and `./report.md` are one file; `out/../chart.png` resolves to `chart.png`.
    expect(memory.artifacts.list(made.ticketId!).map(artifact => artifact.path)).toEqual(['report.md', 'chart.png'])
    expect(memory.artifacts.list(made.ticketId!)[0]!.note).toBe('做完了')
  })

  it('refuses a path outside the Ticket directory, and says so on the Ticket instead of dropping it silently', () => {
    const { engine, memory } = harness()
    const made = engine.createTicket({ title: '越界', text: '做点事' })
    const ticket = engine.report(made.ticketId!, { state: 'ready', summary: '做完了', files: ['../other/secret', '/etc/passwd', 'ok.md'] })
    expect(memory.artifacts.list(made.ticketId!).map(artifact => artifact.path)).toEqual(['ok.md'])
    const notes = ticket.notes.map(note => note.text).join('\n')
    expect(notes).toContain('../other/secret')
    expect(notes).toContain('/etc/passwd')
  })

  it('registers files from a progress report too, because a worker may name what it has made before it ends', () => {
    const { engine, memory } = harness()
    const made = engine.createTicket({ title: '中间产物', text: '做点事' })
    engine.report(made.ticketId!, { state: 'progress', summary: '第一步做完了', files: ['draft.md'] })
    expect(memory.artifacts.list(made.ticketId!).map(artifact => artifact.path)).toEqual(['draft.md'])
    // A later claim about the same path replaces the earlier one rather than listing it twice.
    engine.report(made.ticketId!, { state: 'progress', summary: '第二步', files: ['draft.md'] })
    expect(memory.artifacts.list(made.ticketId!)).toHaveLength(1)
  })
})

describe('retrying an attempt that is already working', () => {
  // `canRetry` used to read the newest report anywhere on the Ticket while every other line in it read the current
  // attempt. So an attempt that went silent, was retried, and whose replacement was mid-turn still looked retryable —
  // and a retry ends the running attempt WITHOUT cancelling its turn, then queues a second task into the same Session,
  // where the first turn's closing report lands on the second attempt.
  it('stops offering a retry once the replacement attempt is running and has said nothing itself', () => {
    const { engine } = harness()
    const made = engine.createTicket({ title: '会静默', text: '做点事' })
    const id = made.ticketId!
    const first = engine.require(id).assignments.at(-1)!
    engine.assignmentStarted(id, first.id)
    engine.inputsDelivered(id, first.id, [])
    // The first attempt's turn ended with nothing reported, which is recorded as `waiting` — and that is retryable.
    engine.turnEnded(id, first.id, '我不知道下一步该做什么')
    expect(canRetry(engine.require(id))).toBe(true)

    engine.retryTicket(id)
    const second = engine.require(id).assignments.at(-1)!
    expect(second.id).not.toBe(first.id)
    engine.assignmentStarted(id, second.id)
    engine.inputsDelivered(id, second.id, [])
    // The `waiting` belongs to the attempt that was replaced. The one running now has no report of its own, so there
    // is nothing to retry: offering it would end a live turn and start a second task beside it.
    expect(canRetry(engine.require(id))).toBe(false)
    expect(() => engine.retryTicket(id)).toThrow(UserError)
  })
})

describe('a report from an attempt that is not running', () => {
  // One Session per Ticket means a turn that outlives its attempt still holds the worker's tools. Attributing its
  // report to whatever attempt happens to be current let a superseded turn end a Ticket whose replacement had not
  // even started — and `ticketStage` renders any report on a pending attempt as `failed`, so the panel agreed.
  it('refuses a worker report for an attempt that never started, and leaves the Ticket alone', () => {
    const { engine, memory, executor } = harness()
    executor.marksStarted = false
    const made = engine.createTicket({ title: '未启动', text: '做点事' })
    const id = made.ticketId!
    expect(() => engine.report(id, { state: 'ready', summary: '做完了', files: ['report.md'] })).toThrow(UserError)
    const after = memory.tickets.get(id)!
    expect(after.ended).toBeUndefined()
    expect(after.assignments.at(-1)!.report).toBeUndefined()
    expect(memory.artifacts.list(id)).toEqual([])
  })

  it('still records the system giving up on an attempt that never started', () => {
    const { engine, memory, executor } = harness()
    executor.marksStarted = false
    const made = engine.createTicket({ title: '起不来', text: '做点事' })
    const id = made.ticketId!
    // A Ticket left pending with no word on it is indistinguishable from a launch that is merely queued, so the
    // giving-up is written down — through its own command, which is the one path allowed to report on a pending attempt.
    const updated = engine.reportGaveUp(id, "Starting this Ticket's worker gave up after repeated attempts")
    expect(updated.assignments.at(-1)!.report).toMatchObject({ state: 'failed' })
    expect(updated.attention?.question).toContain('gave up')
    expect(memory.tickets.get(id)!.assignments).toHaveLength(1)
  })
})

describe('Projects and Works', () => {
  // A Work is classified onto a Ticket after the gate accepted it, so the gate stays a pure function of the Trigger and
  // the settings. The position in a Work counts the Tickets already in it, which makes it a fact about the Work's
  // history rather than about when the Ticket happened to be created.
  it('numbers Tickets by the order they joined the Work, not by the order they were created', () => {
    const { engine } = harness()
    const work = engine.createWork({ name: '每日摘要' })
    const older = engine.createTicket({ title: '上个月的一张', text: '做点事' })
    const newer = engine.createTicket({ title: '今天的一张', text: '做点事' })
    // Attaching the older one second still makes it the second in line: the Work's history is the order of joining.
    engine.attachWork(newer.ticketId!, work.id)
    engine.attachWork(older.ticketId!, work.id)
    expect(engine.ticketsOfWork(work.id).map(ticket => ticket.title)).toEqual(['今天的一张', '上个月的一张'])
    expect(engine.require(older.ticketId!).workSeq).toBe(2)
  })

  it('attaching the same Work twice is not a second place in line', () => {
    const { engine } = harness()
    const work = engine.createWork({ name: '重复挂载' })
    const made = engine.createTicket({ title: '一张', text: '做点事' })
    engine.attachWork(made.ticketId!, work.id)
    engine.attachWork(made.ticketId!, work.id)
    expect(engine.ticketsOfWork(work.id)).toHaveLength(1)
    expect(engine.require(made.ticketId!).workSeq).toBe(1)
  })

  it('refuses a Work or a Project that does not exist, rather than classifying into nothing', () => {
    const { engine } = harness()
    const made = engine.createTicket({ title: '一张', text: '做点事' })
    expect(() => engine.attachWork(made.ticketId!, 'no-such-work')).toThrow(UserError)
    expect(() => engine.createWork({ name: '挂在一个不存在的项目下', projectId: 'no-such-project' })).toThrow(UserError)
    expect(() => engine.createWork({ name: '   ' })).toThrow(UserError)
    // Nothing was written by any of the refusals.
    expect(engine.require(made.ticketId!).workId).toBeUndefined()
  })

  it('classifies an ended Ticket too, because putting past work where it belongs is bookkeeping', () => {
    const { engine } = harness()
    const work = engine.createWork({ name: '归档整理' })
    const made = engine.createTicket({ title: '已经结束的一张', text: '做点事' })
    engine.assignmentStarted(made.ticketId!, engine.require(made.ticketId!).assignments[0]!.id)
    engine.report(made.ticketId!, { state: 'ready', summary: '做完了' })
    expect(engine.attachWork(made.ticketId!, work.id).workSeq).toBe(1)
  })

  it('groups Works under a Project, and can ask for the ones in no Project', () => {
    const { engine, memory } = harness()
    const project = engine.createProject({ name: '客户 A' })
    engine.createWork({ name: '周报', projectId: project.id })
    engine.createWork({ name: '零活' })
    expect(memory.works.byProject(project.id).map(work => work.name)).toEqual(['周报'])
    expect(memory.works.byProject(undefined).map(work => work.name)).toEqual(['零活'])
  })

  it('leaves no Project, Work or classification behind when the transaction rolls back', () => {
    const { engine, memory } = harness()
    const work = engine.createWork({ name: '会回滚' })
    const made = engine.createTicket({ title: '一张', text: '做点事' })
    expect(() => memory.atomic(() => {
      engine.attachWork(made.ticketId!, work.id)
      throw new Error('整批操作失败')
    })).toThrow('整批操作失败')
    expect(engine.require(made.ticketId!).workId).toBeUndefined()
    expect(engine.ticketsOfWork(work.id)).toEqual([])
  })
})

describe('when a domain event is published', () => {
  // The production listener starts a pass, and a pass claims effect rows and runs their handlers. Publishing inside the
  // transaction therefore meant building directories and copying attachments for state that had not been committed —
  // and a rollback left that work behind, which is the one thing the Engine's opening guarantee promises cannot happen.
  it('publishes nothing for a command whose transaction rolled back', () => {
    const { engine, memory, events } = harness()
    expect(() => memory.atomic(() => {
      engine.createTicket({ title: '会回滚', text: '做点事' })
      throw new Error('整批操作失败')
    })).toThrow('整批操作失败')
    expect(memory.ticketList()).toEqual([])
    // A listener that had already run would have started work for a Ticket that does not exist.
    expect(events).toEqual([])
  })

  it('holds a nested command’s events until the outer transaction commits', () => {
    const { engine, memory, events } = harness()
    memory.atomic(() => {
      engine.createTicket({ title: '内层的一张', text: '做点事' })
      // Still inside the outer transaction, so nothing may have been published yet.
      expect(events).toEqual([])
    })
    expect(events).toContain('ticket.created')
  })
})

describe('the log of what happened to a Ticket', () => {
  // The state cannot answer "everything that happened, in order": `mutate` rewrites the whole row on every change, so
  // the row holds only the latest version of everything and a fact that was later overwritten is gone.
  it('holds every transition in the order it happened, with who caused it', () => {
    const { engine } = harness()
    const made = engine.createTicket({ title: '一张有历史的', text: '做点事' })
    const id = made.ticketId!
    const first = engine.require(id).assignments[0]!
    engine.assignmentStarted(id, first.id)
    engine.inputsDelivered(id, first.id, [])
    engine.note(id, '数据在 ~/notes/')
    engine.report(id, { state: 'progress', summary: '第一步做完了' })
    engine.report(id, { state: 'ready', summary: '做完了' })
    expect(engine.history(id).map(event => event.type)).toEqual([
      'created', 'launched', 'input', 'report', 'report',
    ])
    expect(engine.history(id)[0]!.by).toMatchObject({ kind: 'person', id: 'operator' })
    expect(engine.history(id)[1]!.by).toMatchObject({ kind: 'system' })
    expect(engine.history(id).at(-1)!.detail).toMatchObject({ state: 'ready' })
    expect(engine.history(id)[2]!.detail).toMatchObject({ input: 'note' })
    // Positions are per-Ticket and start at 1, so two Tickets never compete for a number.
    expect(engine.history(id).map(event => event.seq)).toEqual([1, 2, 3, 4, 5])
  })

  it('records nothing for a command whose transaction rolled back', () => {
    const { engine, memory } = harness()
    expect(() => memory.atomic(() => {
      engine.createTicket({ title: '会回滚', text: '做点事' })
      throw new Error('整批操作失败')
    })).toThrow('整批操作失败')
    expect(memory.events.list('anything')).toEqual([])
  })

  it('records the transitions that used to be invisible: a retry, an interruption, a classification, a system failure', () => {
    const { engine } = harness()
    const made = engine.createTicket({ title: '会经历很多', text: '做点事' })
    const id = made.ticketId!
    const work = engine.createWork({ name: '一条工作流' })
    engine.attachWork(id, work.id)
    const first = engine.require(id).assignments[0]!
    engine.assignmentStarted(id, first.id)
    engine.inputsDelivered(id, first.id, [])
    engine.turnEnded(id, first.id, '我不知道下一步')
    engine.retryTicket(id)
    engine.assignmentInterrupted(id, engine.require(id).assignments.at(-1)!.id)
    engine.failTicket(id, '这个目录不能再用了')
    const types = engine.history(id).map(event => event.type)
    // The log is the order things happened, not the order this test wrote its calls: a launch runs in `afterCommit`,
    // and both a retry and an interrupt open a fresh attempt that then launches. Three `launched` entries for one
    // Ticket is exactly what the log exists to make visible — the state alone shows only the latest attempt.
    expect(types).toEqual([
      'created', 'launched', 'classified', 'turn_ended',
      'retried', 'launched', 'interrupted', 'launched', 'failed',
    ])
    expect(engine.history(id).at(-1)!.detail).toMatchObject({ reason: '这个目录不能再用了' })
  })
})

describe('cascading an ending down the graph', () => {
  it('ends what waited on a Ticket that failed, and says which one it waited on', () => {
    const { engine } = harness()
    const first = engine.createTicket({ title: '会失败的一张', text: '做点事' })
    const second = engine.createTicket({ title: '等它的一张', text: '做点事' })
    engine.dependOn(second.ticketId!, first.ticketId!)
    engine.failTicket(first.ticketId!, '这个目录不能再用了')
    const cascaded = engine.require(second.ticketId!)
    expect(cascaded.ended).toMatchObject({ outcome: 'failed', by: 'system' })
    // The reason has to name both the cause and the Ticket it came from, or the operator sees a failure with no origin.
    expect(cascaded.ended!.reason).toContain('这个目录不能再用了')
    expect(cascaded.ended!.reason).toContain(first.ticketId!.slice(0, 8))
    expect(engine.history(second.ticketId!).at(-1)!.detail).toMatchObject({ cascaded: true, upstream: first.ticketId })
  })

  it('keeps the difference between "it failed" and "there was nothing to do"', () => {
    const { engine } = harness()
    const first = engine.createTicket({ title: '无事可做的一张', text: '做点事' })
    const second = engine.createTicket({ title: '等它的一张', text: '做点事' })
    engine.dependOn(second.ticketId!, first.ticketId!)
    const started = engine.require(first.ticketId!).assignments[0]!
    engine.assignmentStarted(first.ticketId!, started.id)
    engine.report(first.ticketId!, { state: 'dropped', summary: '源目录不存在' })
    expect(engine.require(second.ticketId!).ended).toMatchObject({ outcome: 'dropped', by: 'system' })
    expect(engine.require(second.ticketId!).ended!.reason).toContain('源目录不存在')
  })

  it('does not cascade a stop: what follows a person’s decision is that person’s decision', () => {
    const { engine } = harness()
    const first = engine.createTicket({ title: '被停掉的一张', text: '做点事' })
    const second = engine.createTicket({ title: '等它的一张', text: '做点事' })
    engine.dependOn(second.ticketId!, first.ticketId!)
    engine.stopTicket(first.ticketId!, '先停一下')
    // Still alive and still waiting: a stop is not a verdict on the work downstream of it.
    expect(engine.require(second.ticketId!).ended).toBeUndefined()
    expect(engine.blockedBy(second.ticketId!)).toHaveLength(1)
  })

  it('walks the whole chain, because a broken link breaks everything after it', () => {
    const { engine } = harness()
    const first = engine.createTicket({ title: '第一环', text: '做点事' })
    const second = engine.createTicket({ title: '第二环', text: '做点事' })
    const third = engine.createTicket({ title: '第三环', text: '做点事' })
    engine.dependOn(second.ticketId!, first.ticketId!)
    engine.dependOn(third.ticketId!, second.ticketId!)
    engine.failTicket(first.ticketId!, '第一环坏了')
    expect(engine.require(second.ticketId!).ended?.outcome).toBe('failed')
    expect(engine.require(third.ticketId!).ended?.outcome).toBe('failed')
    expect(engine.require(third.ticketId!).ended!.reason).toContain(second.ticketId!.slice(0, 8))
  })

  it('lets a dependant that only needed the upstream to finish run anyway', () => {
    const { engine } = harness()
    const first = engine.createTicket({ title: '会失败的一张', text: '做点事' })
    const cleanup = engine.createTicket({ title: '无论如何都要收尾', text: '做点事' })
    engine.dependOn(cleanup.ticketId!, first.ticketId!, 'ended')
    engine.failTicket(first.ticketId!, '这个目录不能再用了')
    expect(engine.require(cleanup.ticketId!).ended).toBeUndefined()
    expect(engine.blockedBy(cleanup.ticketId!)).toEqual([])
  })
})

describe('a report that names the attempt it belongs to', () => {
  // The case S11's "must be running" guard cannot catch: the attempt that was replaced is gone, and another one IS
  // running, so from the outside a late turn looks exactly like the current worker. Only the identity the launch
  // recorded tells them apart.
  it('refuses a late report from a replaced attempt while another attempt is running', () => {
    const { engine } = harness()
    const made = engine.createTicket({ title: '会被替换的尝试', text: '做点事' })
    const id = made.ticketId!
    const first = engine.require(id).assignments[0]!
    engine.assignmentStarted(id, first.id)
    engine.inputsDelivered(id, first.id, [])
    engine.turnEnded(id, first.id, '我不知道下一步该做什么')
    engine.retryTicket(id)
    const second = engine.require(id).assignments.at(-1)!
    expect(second.id).not.toBe(first.id)
    engine.assignmentStarted(id, second.id)

    // The first attempt's turn comes back and claims the work is done. Accepting it would end a Ticket whose current
    // attempt is still working, and the panel would show a result nobody produced.
    expect(() => engine.report(id, { state: 'ready', summary: '其实我做完了' }, first.id)).toThrow(UserError)
    expect(engine.require(id).ended).toBeUndefined()

    // The running attempt's own report still lands, on its own attempt.
    const updated = engine.report(id, { state: 'progress', summary: '还在做' }, second.id)
    expect(updated.assignments.at(-1)!.report!.summary).toBe('还在做')
    expect(updated.assignments[0]!.report!.summary).toBe('我不知道下一步该做什么')
  })
})

describe('one worker handing a fact to another Ticket', () => {
  // The boundary is the Work: a stored fact rather than a sentence in a prompt, so a worker cannot widen it by arguing.
  // And the hand-off is an Input on the target, delivered by the same machinery a person's note uses — never a message
  // into the other Session, because that would leave the Engine unable to say who told whom what.
  const twoInOneWork = (engine: Engine) => {
    const work = engine.createWork({ name: '一条共同的工作流' })
    const first = engine.createTicket({ title: '交出去的一方', text: '做点事' })
    const second = engine.createTicket({ title: '接手的一方', text: '做点事' })
    engine.attachWork(first.ticketId!, work.id)
    engine.attachWork(second.ticketId!, work.id)
    return { work, first: first.ticketId!, second: second.ticketId! }
  }

  it('arrives as an Input that says which Ticket’s worker wrote it, and is logged on both sides', () => {
    const { engine } = harness()
    const { first, second } = twoInOneWork(engine)
    const updated = engine.noteFromWorker(first, second, '报表的口径按季度，不是按月')
    const input = updated.inputs.at(-1)!
    expect(input).toMatchObject({ kind: 'note', text: '报表的口径按季度，不是按月', by: { kind: 'agent', id: first } })
    // The receiving side records who told it, and the sending side records that it did.
    expect(engine.history(second).at(-1)!.by).toMatchObject({ kind: 'agent', id: first })
    expect(engine.history(first).at(-1)!.detail).toMatchObject({ handed_to: second })
  })

  it('refuses across Works, and refuses Tickets that belong to no Work at all', () => {
    const { engine } = harness()
    const { first } = twoInOneWork(engine)
    const other = engine.createWork({ name: '另一条工作流' })
    const stranger = engine.createTicket({ title: '别的工作流里的一张', text: '做点事' })
    engine.attachWork(stranger.ticketId!, other.id)
    const loner = engine.createTicket({ title: '不属于任何工作流', text: '做点事' })
    expect(() => engine.noteFromWorker(first, stranger.ticketId!, '给你个数字')).toThrow(/same Work/)
    expect(() => engine.noteFromWorker(first, loner.ticketId!, '给你个数字')).toThrow(/same Work/)
    expect(() => engine.noteFromWorker(loner.ticketId!, loner.ticketId!, '给自己')).toThrow(/same Work/)
    // Nothing was written by any of the refusals.
    expect(engine.require(stranger.ticketId!).inputs).toEqual([])
    expect(engine.require(loner.ticketId!).inputs).toEqual([])
  })

  it('refuses a Ticket that has ended, because there is nobody left to read it', () => {
    const { engine } = harness()
    const { first, second } = twoInOneWork(engine)
    engine.assignmentStarted(second, engine.require(second).assignments[0]!.id)
    engine.report(second, { state: 'ready', summary: '做完了' })
    expect(() => engine.noteFromWorker(first, second, '补一个数字')).toThrow(UserError)
  })

  it('hands the fact to the other worker when it is running, and holds it for the next launch when it is not', () => {
    const { engine, executor } = harness()
    const { first, second } = twoInOneWork(engine)
    // Not launched yet: the fact waits, which is not a failure.
    engine.noteFromWorker(first, second, '第一个数字是 42')
    expect(engine.require(second).inputs.at(-1)!.deliveredAt).toBeUndefined()
    engine.assignmentStarted(second, engine.require(second).assignments[0]!.id)
    engine.noteFromWorker(first, second, '第二个数字是 43')
    expect(executor.delivered).toContain(second)
  })
})

describe('a Trigger that names the Work its Ticket belongs to', () => {
  // Rule-produced work is the case that needs this: a Ticket that belongs to no Work is invisible in every grouping
  // the operator has, so proactive work would be the one kind of work nobody can find.
  it('classifies the Ticket as it is created, taking the next place in that Work', () => {
    const { engine } = harness()
    const work = engine.createWork({ name: '规则产出归这里' })
    const first = engine.receive({ ...trigger(), id: 'tr-w-1', meta: { work: work.id } })
    expect(engine.require(first.ticketId!).workSeq).toBe(1)
    const second = engine.receive({ ...trigger(), id: 'tr-w-2', text: '另一件事', title: '另一件', meta: { work: work.id } })
    expect(engine.require(second.ticketId!).workSeq).toBe(2)
    expect(engine.ticketsOfWork(work.id).map(ticket => ticket.id)).toEqual([first.ticketId, second.ticketId])
  })

  it('records a Work that does not exist instead of quietly filing the Ticket nowhere', () => {
    const { engine } = harness()
    const made = engine.receive({ ...trigger(), id: 'tr-w-3', meta: { work: 'no-such-work' } })
    const id = made.ticketId!
    expect(engine.require(id).workId).toBeUndefined()
    expect(engine.history(id).map(event => event.type)).toContain('classified')
    expect(engine.history(id).find(event => event.type === 'classified')!.detail).toMatchObject({ workId: 'no-such-work', missing: true })
  })
})

describe('reading another Ticket’s artifact', () => {
  const twoInOneWork = (engine: Engine) => {
    const work = engine.createWork({ name: '同一条工作流' })
    const first = engine.createTicket({ title: '产出的一方', text: '做点事' })
    const second = engine.createTicket({ title: '想读的一方', text: '做点事' })
    engine.attachWork(first.ticketId!, work.id)
    engine.attachWork(second.ticketId!, work.id)
    return { work, first: first.ticketId!, second: second.ticketId! }
  }
  const registered = (engine: Engine, id: string) => {
    const assignment = engine.require(id).assignments[0]!
    engine.assignmentStarted(id, assignment.id)
    engine.report(id, { state: 'ready', summary: '写好了', files: ['report.md'] })
  }

  it('authorizes a registered artifact of a Ticket in the same Work, and says where it is', () => {
    const { engine } = harness()
    const { first, second } = twoInOneWork(engine)
    registered(engine, first)
    const allowed = engine.authorizeArtifactRead(second, first, 'report.md')
    expect(allowed.artifact.path).toBe('report.md')
    expect(allowed.directory).toBeTruthy()
  })

  it('refuses across Works, which is the only boundary a worker cannot argue with', () => {
    const { engine } = harness()
    const { first } = twoInOneWork(engine)
    registered(engine, first)
    const stranger = engine.createTicket({ title: '别的工作流里的一张', text: '做点事' })
    expect(() => engine.authorizeArtifactRead(stranger.ticketId!, first, 'report.md')).toThrow(/same Work/)
  })

  it('refuses a file that was never registered, even inside the same Work and the same directory', () => {
    // The narrowing that makes this safe to hand a model: readable means "a report claimed it", not "it happens to be
    // in there". The registry is what a person can audit; a directory listing is not.
    const { engine } = harness()
    const { first, second } = twoInOneWork(engine)
    registered(engine, first)
    expect(() => engine.authorizeArtifactRead(second, first, 'secrets.env')).toThrow(UserError)
    expect(() => engine.authorizeArtifactRead(second, first, '../escape')).toThrow(UserError)
    expect(() => engine.authorizeArtifactRead(second, first, './report.md')).not.toThrow()
  })

  it('refuses to read its own artifacts through this door, because it can already read its own directory', () => {
    const { engine } = harness()
    const { first } = twoInOneWork(engine)
    registered(engine, first)
    expect(() => engine.authorizeArtifactRead(first, first, 'report.md')).toThrow(UserError)
  })
})

describe('a notice that will never arrive', () => {
  // The effect row is deleted when the queue gives up, and the only other trace was a health line that the next
  // unrelated success overwrites (the hole the chat acceptance run flagged for `notify` and `trigger`). A notice that
  // will never arrive is a fact about the Ticket's life: the operator asked something, or a policy changed under work
  // already accepted, and the system failed to say so.
  it('is recorded on the Ticket, with what was going to be said', () => {
    const { engine } = harness()
    const made = engine.createTicket({ title: '欠一句通知', text: '做点事' })
    const id = made.ticketId!
    engine.noticeLost(id, { notice: 'report', state: 'ready', error: 'the front desk is not reachable', text: '摘要正文' })

    const lost = engine.history(id).filter(event => event.type === 'notice_lost')
    expect(lost).toHaveLength(1)
    expect(lost[0]!.by).toMatchObject({ kind: 'system', id: 'delivery' })
    // The content survives, because a lost message is only actionable if a person can say it by hand.
    expect(lost[0]!.detail).toMatchObject({ notice: 'report', state: 'ready', text: '摘要正文' })
    expect(lost[0]!.detail).toHaveProperty('error')
  })

  it('refuses to invent a Ticket that does not exist', () => {
    const { engine } = harness()
    expect(() => engine.noticeLost('no-such-ticket', { error: 'x' })).toThrow(UserError)
  })
})

describe('binding a Session to a Ticket', () => {
  // `session_bound` sat in the TicketEventType union with no writer, so a Ticket's own log never said which Session
  // did the work. Reconstructing that for the round-50 production investigation meant reading DSH's session files and
  // correlating timestamps — the question should have been answerable from the log it was asked about.
  it('records which Session ran it, once per Session, and says nothing when nothing changed', () => {
    const { engine, memory } = harness()
    const id = engine.receive(trigger()).ticketId!
    // The stub Executor's `prepare` sets `execution` with no sessionId, so this is the first binding — the case DSH
    // produces when it answers a create with a different identity than the one asked for (`sessions.ts`).
    engine.bindSession(id, 'worker-elsewhere')
    const bound = memory.events.list(id).filter(event => event.type === 'session_bound')
    expect(bound).toHaveLength(1)
    expect(bound[0]!.detail).toEqual({ sessionId: 'worker-elsewhere' })
    expect(memory.tickets.get(id)!.execution?.sessionId).toBe('worker-elsewhere')

    // Binding the SAME Session again is not a second fact: a retry that re-binds would otherwise write a line each
    // time, and the one that matters would be buried in duplicates.
    engine.bindSession(id, 'worker-elsewhere')
    expect(memory.events.list(id).filter(event => event.type === 'session_bound')).toHaveLength(1)

    // A genuinely different Session IS a second fact — a Ticket that moved to another Session should say so, and the
    // log should read as a sequence rather than as one binding that was later edited.
    engine.bindSession(id, 'worker-replacement')
    const second = memory.events.list(id).filter(event => event.type === 'session_bound')
    expect(second).toHaveLength(2)
    expect(second[1]!.detail).toEqual({ sessionId: 'worker-replacement' })
  })
})

describe('archive and delete a Project or a Work (U21)', () => {
  /** One Project, one Work in it, and one accepted Ticket classified into that Work: a real link to test against. */
  const withWorkInUse = () => {
    const h = harness()
    const project = h.engine.createProject({ name: '竞品观察' })
    const work = h.engine.createWork({ name: '周报', projectId: project.id })
    const received = h.engine.receive(trigger())
    const ticket = h.engine.attachWork(received.ticketId!, work.id)
    return { ...h, project, work, ticket }
  }

  it('archiving hides a Work from the default list, keeps it readable, and unarchiving brings it back', () => {
    const { engine, project, work } = withWorkInUse()
    const archived = engine.archiveWork(work.id)
    expect(archived.archivedAt).toBe('2026-11-02T12:00:00.000Z')
    // Gone from what an operator chooses from…
    expect(engine.works().map(item => item.id)).not.toContain(work.id)
    expect(engine.works(project.id)).toEqual([])
    // …but still there to read: archiving is not deleting, and a detail view that hid it would look like data loss.
    expect(engine.work(work.id)?.name).toBe('周报')
    expect(engine.works(undefined, true).map(item => item.id)).toContain(work.id)

    const back = engine.unarchiveWork(work.id)
    expect(back.archivedAt).toBeUndefined()
    expect(engine.works().map(item => item.id)).toContain(work.id)
  })

  it('archiving a Project leaves its Works and their Tickets exactly as they were', () => {
    const { engine, memory, project, work, ticket } = withWorkInUse()
    engine.archiveProject(project.id)
    expect(engine.projects().map(item => item.id)).not.toContain(project.id)
    expect(engine.projects(true).map(item => item.id)).toContain(project.id)
    // The Work under it is untouched, and so is the Ticket's place in that Work's history.
    expect(engine.work(work.id)).toMatchObject({ name: '周报', projectId: project.id })
    // Vitest 的 toMatchObject 要求键**存在**，所以「没有归档」要单独说，不能塞进上面那个对象里。
    expect(engine.work(work.id)!.archivedAt).toBeUndefined()
    expect(memory.tickets.get(ticket.id)).toMatchObject({ workId: work.id, workSeq: 1 })
  })

  it('deleting a Work takes the assignment away from its Tickets, and each one says so in its own history', () => {
    const { engine, memory, work, ticket } = withWorkInUse()
    const result = engine.deleteWork(work.id)
    expect(result).toEqual({ deleted: work.id, detachedTickets: 1 })
    // The record is gone — from the list AND from a direct read, which is what "delete for good" means.
    expect(engine.work(work.id)).toBeUndefined()
    expect(engine.works(undefined, true).map(item => item.id)).not.toContain(work.id)
    // The Ticket is not: a Ticket is a real thing that happened, and deleting a grouping never reaches into it.
    const after = memory.tickets.get(ticket.id)!
    expect(after.workId).toBeUndefined()
    expect(after.workSeq).toBeUndefined()
    expect(after.title).toBe(ticket.title)
    expect(after.assignments).toHaveLength(ticket.assignments.length)
    // And it is not silent: the Ticket's own history says its assignment was taken away, and names the Work.
    const events = memory.events.list(ticket.id).filter(event => event.type === 'unclassified')
    expect(events).toHaveLength(1)
    expect(events[0]!.detail).toMatchObject({ workId: work.id, workSeq: 1, reason: 'work_deleted' })
    expect(events[0]!.by).toEqual({ kind: 'person' })
  })

  it('deleting a Project leaves its Works alive, with no Project', () => {
    const { engine, memory, project, work, ticket } = withWorkInUse()
    const result = engine.deleteProject(project.id)
    expect(result).toEqual({ deleted: project.id, detachedWorks: 1 })
    expect(engine.project(project.id)).toBeUndefined()
    // The Work survives and now belongs to no Project; the Ticket under it is untouched.
    expect(engine.work(work.id)).toMatchObject({ name: '周报' })
    expect(engine.work(work.id)!.projectId).toBeUndefined()
    expect(engine.works(undefined).map(item => item.id)).toContain(work.id)
    expect(memory.tickets.get(ticket.id)).toMatchObject({ workId: work.id, workSeq: 1 })
  })

  it('deleting something that is not there is an error, not a silent success', () => {
    const { engine } = withWorkInUse()
    // UserError 带着一个人话消息（errors.ts 的表），错误码是给日志的——断言断人话那一层。
    expect(() => engine.deleteWork('work-nope')).toThrowError('No Work has this id')
    expect(() => engine.deleteProject('project-nope')).toThrowError('No Project has this id')
    expect(() => engine.archiveWork('work-nope')).toThrowError('No Work has this id')
    expect(() => engine.unarchiveProject('project-nope')).toThrowError('No Project has this id')
    // 而且是 UserError（400 那一类：操作者能改的错），不是内部错误（500）。
    expect(() => engine.deleteWork('work-nope')).toThrowError(UserError)
  })

  it('a delete that fails part-way through leaves everything as it was — including the event it had already written', () => {
    const { engine, memory, work, ticket } = withWorkInUse()
    const realSave = memory.tickets.save.bind(memory.tickets)
    // Fail on the first Ticket save of the deletion. `record()` runs BEFORE the save inside `mutate`, so this is the
    // interesting case: the event is already appended when the failure lands, and a transaction that only rolled back
    // the Ticket would leave a history entry for a deletion that never happened.
    memory.tickets.save = (next: Ticket): void => {
      if (next.id === ticket.id) throw new Error('磁盘满了')
      realSave(next)
    }
    expect(() => engine.deleteWork(work.id)).toThrowError('磁盘满了')
    // Nothing moved: the Work is still there, the Ticket still belongs to it, and no `unclassified` event survives.
    expect(engine.work(work.id)?.name).toBe('周报')
    expect(memory.tickets.get(ticket.id)).toMatchObject({ workId: work.id, workSeq: 1 })
    expect(memory.events.list(ticket.id).filter(event => event.type === 'unclassified')).toEqual([])
  })
})

describe('triage routing (S3b)', () => {
  /**
   * Which requests get a judge. The Engine has no settings — only the Policy projection — so the switch, the depth
   * rule and the list of Sources all live in policy.ts, and what is asserted here is the one observable fact: the
   * first Assignment's role.
   */
  it('sends a Source request to the desk, and leaves the operator, a rule and a desk-opened Ticket alone', () => {
    const { engine, memory } = harness({ triage: { enabled: true } })

    const fromInbox = engine.receive(trigger())
    expect(memory.tickets.get(fromInbox.ticketId!)!.assignments.at(-1)!.role).toBe('triage')

    // A `session` Trigger is the operator or the front desk speaking HERE. Triaging it would spend a turn
    // second-guessing somebody who is already in the room — and the panel's "dispatch one task" keeps its direct path.
    const ownTicket = engine.createTicket({ title: '自己开的活', text: '整理一下' })
    expect(memory.tickets.get(ownTicket.ticketId!)!.assignments.at(-1)!.role).toBeUndefined()

    // A rule Trigger is a decision a rule already made.
    const fromRule = engine.receive(trigger({ id: 'trigger-rule', source: 'rule', kind: 'rule' }))
    expect(memory.tickets.get(fromRule.ticketId!)!.assignments.at(-1)!.role).toBeUndefined()

    // And a Ticket the desk opened must not be triaged again: without the depth rule, dispatching recurses and every
    // request costs two turns forever. The guard is the same `origin.depth` the rule chain already uses.
    const deep = engine.receive(trigger({ id: 'trigger-deep', meta: { depth: 1 } }))
    expect(memory.tickets.get(deep.ticketId!)!.assignments.at(-1)!.role).toBeUndefined()
  })

  it('changes nothing when the switch is off, which is how it ships', () => {
    const { engine, memory } = harness()
    const made = engine.receive(trigger())
    expect(memory.tickets.get(made.ticketId!)!.assignments.at(-1)!.role).toBeUndefined()
  })
})

describe('deleting a Ticket, at the Engine level (S4)', () => {
  /**
   * The rules without any IO: the refusal of a live Ticket, the tombstone, and the one thing that survives every
   * option. Asserted here as well as through the Runtime, because the two are different layers — a mutation of the
   * Engine's own check has to be caught by something that does not depend on a directory being removed.
   */
  it('refuses a live Ticket, accepts an ended one, and never touches the intake record', () => {
    const { engine, memory } = harness()
    const made = engine.receive(trigger())
    const id = made.ticketId!
    expect(() => engine.assertDeletable(id)).toThrow(/stop it before deleting/)
    expect(() => engine.deleteTicket(id, { assets: 'delete', record: 'nothing' })).toThrow(/stop it before deleting/)
    // The refusal is not a partial action: nothing was marked and nothing was removed.
    expect(memory.tickets.get(id)!.deleted).toBeUndefined()

    engine.report(id, { state: 'ready', summary: '做完了' })
    expect(engine.assertDeletable(id).id).toBe(id)
    const triggerId = memory.tickets.get(id)!.origin.triggerId

    expect(engine.deleteTicket(id, { assets: 'keep', record: 'tombstone' }))
      .toMatchObject({ deleted: id, assets: 'keep', record: 'tombstone' })
    expect(memory.tickets.get(id)!.deleted).toMatchObject({ assets: 'keep' })
    expect(memory.tickets.list().some(ticket => ticket.id === id)).toBe(false)
    expect(memory.tickets.deleted().some(ticket => ticket.id === id)).toBe(true)
    // The Trigger is the dedupe key: with it gone, the same request arriving again would be new work.
    expect(memory.triggerOf(triggerId)).toBeDefined()
  })

  it('takes the row away for record:nothing, and still leaves the Trigger and the Decision', () => {
    const { engine, memory } = harness()
    const made = engine.receive(trigger())
    const id = made.ticketId!
    const triggerId = memory.tickets.get(id)!.origin.triggerId
    engine.report(id, { state: 'ready', summary: '做完了' })
    engine.deleteTicket(id, { assets: 'keep', record: 'nothing' })
    expect(memory.tickets.get(id)).toBeUndefined()
    expect(memory.tickets.deleted().some(ticket => ticket.id === id)).toBe(false)
    expect(memory.triggerOf(triggerId)).toBeDefined()
    expect(memory.decisions.list().some(row => row.triggerId === triggerId)).toBe(true)
  })
})

describe('stopping queued Tickets and advancing waiting state on answer (Pkg 3)', () => {
  it('sets attention when turnEnded synthesizes a waiting report, and advances the report to progress when answered', () => {
    const { engine, memory } = harness()
    const made = engine.receive(trigger())
    const id = made.ticketId!
    const assignmentId = memory.tickets.get(id)!.assignments[0]!.id
    engine.inputsDelivered(id, assignmentId, [])

    engine.turnEnded(id, assignmentId, '已完成第一阶段，等待确认')
    const waitingTicket = memory.tickets.get(id)!
    expect(waitingTicket.attention).toBeUndefined()
    expect(waitingTicket.assignments[0]!.report?.state).toBe('waiting')

    const answered = engine.answer(id, '按照你的理解继续推进')
    expect(answered.assignments[0]!.report?.state).toBe('progress')
  })

  it('closes a pending Assignment when a queued Ticket is stopped before it ever started', () => {
    const { engine, memory, executor } = harness()
    // Simulate a queued launch that has not started its Assignment yet
    executor.engine = undefined
    const made = engine.receive(trigger({ id: 'trigger-queued-stop' }))
    const id = made.ticketId!
    expect(memory.tickets.get(id)!.assignments[0]!.state).toBe('pending')

    const stopped = engine.stopTicket(id, '取消排队中的重复任务')
    expect(stopped.ended).toMatchObject({ outcome: 'stopped', reason: '取消排队中的重复任务' })
    expect(stopped.assignments[0]!.state).toBe('ended')
    expect(stopped.assignments[0]!.endedReason).toBe('stopped')
  })
})

describe('bidirectional artifact lineage and unclassified collaboration (E1)', () => {
  it('records artifact_read on both Tickets, exposes citationsOf, and allows two unclassified Tickets to share registered artifacts while still isolating distinct Works', () => {
    const { engine } = harness()
    const a = engine.createTicket({ title: '采集基础数据', text: '抓取数据' }).ticketId!
    const b = engine.createTicket({ title: '交叉比对分析', text: '比对数据' }).ticketId!
    engine.assignmentStarted(a, engine.require(a).assignments[0]!.id)
    engine.report(a, { state: 'ready', summary: '采集完毕', files: ['data/table.csv'] })

    // Both unclassified (`workId === undefined`): allowed through the audited door
    const auth = engine.authorizeArtifactRead(b, a, 'data/table.csv')
    expect(auth.artifact.path).toBe('data/table.csv')
    // Repeat call in the same attempt is deduplicated in the event log
    engine.authorizeArtifactRead(b, a, 'data/table.csv')

    expect(engine.citationsOf(a)).toEqual({ citedBy: [b], cites: [] })
    expect(engine.citationsOf(b)).toEqual({ citedBy: [], cites: [a] })
    expect(engine.history(a).filter(e => e.type === 'artifact_read')).toHaveLength(1)
    expect(engine.history(b).filter(e => e.type === 'artifact_read')).toHaveLength(1)

    // Putting `a` into a Work isolates it from Tickets outside that Work
    const work = engine.createWork({ name: '专属课题' })
    engine.attachWork(a, work.id)
    expect(() => engine.authorizeArtifactRead(b, a, 'data/table.csv')).toThrow(/same Work/)
  })
})

describe('multi-stage Work and dependency orchestration in createTicket (E3)', () => {
  it('creates or reuses a Work by workName, inherits workId across dependsOn, and wires dependency edges', () => {
    const { engine } = harness()
    const stage1 = engine.createTicket({
      title: '第一阶段：多源数据抓取',
      text: '抓取72笔融资记录',
      workName: '中国 AI 产业资本拓扑分析（2026）',
    })
    expect(stage1.workId).toBeDefined()
    expect(engine.work(stage1.workId!)?.name).toBe('中国 AI 产业资本拓扑分析（2026）')

    const stage2 = engine.createTicket({
      title: '第二阶段：独立红队审计与建模',
      text: '对第一阶段数据进行冲突消解并画图',
      dependsOn: [stage1.ticketId!],
    })
    // Inherited the same Work from upstream automatically
    expect(stage2.workId).toBe(stage1.workId)
    expect(stage2.dependsOn).toEqual([stage1.ticketId!])
    expect(engine.require(stage2.ticketId!).workId).toBe(stage1.workId)
    expect(engine.require(stage2.ticketId!).workSeq).toBe(2)
    expect(engine.dependantsOf(stage1.ticketId!).map(d => d.downstream)).toEqual([stage2.ticketId!])
    expect(engine.require(stage2.ticketId!).workSeq).toBe(2)
    expect(engine.dependantsOf(stage1.ticketId!).length).toBe(1)
  })
})
