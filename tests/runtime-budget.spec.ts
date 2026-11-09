/**
 * The wall-clock budget a scheduled firing can carry (S-1).
 *
 * The scout schedule says "at most 60 minutes, and do not get around it by delegating". A sentence in a prompt is not
 * an enforcement, so these tests pin the enforcement: the budget travels on the Trigger, the worker is told to wrap up
 * when it is reached, and a grace period later a still-running attempt is stopped and the Ticket goes to a person.
 *
 * The measurement is the attempt's own `startedAt`, which is why delegation cannot escape it: a subagent's work
 * happens inside the same wall clock, and stopping the attempt stops its background work too.
 */
import { describe, expect, it } from 'vitest'
import { KV } from '../src/app/store.ts'
import { waitsForPerson, type Trigger } from '../src/core/index.ts'
import { deployment, type Deployment } from './helpers/deployment.ts'

/** A cron-shaped Trigger that carries a runtime budget, the way `cron` writes one. */
const budgeted = (at: string, runtimeBudgetMs: number): Trigger => ({
  id: `cron-scout-${at}`, source: 'cron', kind: 'cron', at,
  actor: { id: 'operator', kind: 'person' }, text: '去侦察，最多 60 分钟。', title: '每日技术演进侦察',
  meta: { schedule: 'evolution-scout-daily', scheduledAt: at, runtimeBudgetMs },
})

/** One accepted, launched Ticket whose Trigger carries the given budget. */
async function startedWithBudget(context: Deployment, runtimeBudgetMs: number): Promise<string> {
  const current = context.runtime.settings() as unknown as Record<string, unknown>
  context.runtime.saveSettings({ ...current, allowedSenders: ['operator'] })
  const at = new Date(Date.now() - 5_000).toISOString()
  const result = context.runtime.engine.receive(budgeted(at, runtimeBudgetMs))
  expect(result.disposition.state).toBe('accepted')
  const ticketId = (result.disposition as { ticketId: string }).ticketId
  await context.runtime.nudge()
  return ticketId
}

/** Push the running attempt's clock back, because a test that waits an hour is not a test. */
function backdate(context: Deployment, ticketId: string, startedAt: string): string {
  const ticket = context.runtime.store.tickets.get(ticketId)!
  const assignment = ticket.assignments.at(-1)!
  expect(assignment.state).toBe('running')
  context.runtime.store.tickets.save({
    ...ticket,
    assignments: [...ticket.assignments.slice(0, -1), { ...assignment, startedAt }],
  })
  return assignment.id
}

const MINUTE = 60_000

describe('a scheduled firing with a wall-clock budget', () => {
  it('says nothing while the work is inside its budget', async () => {
    const context = await deployment('auto')
    try {
      const id = await startedWithBudget(context, 60 * MINUTE)
      const startedAt = new Date(Date.now() - 10 * MINUTE).toISOString()
      backdate(context, id, startedAt)
      context.runtime.enforceRuntimeBudgets(Date.parse(startedAt) + 10 * MINUTE)
      // No note, no health line, no interference: a budget that fires early is a budget nobody can plan around.
      expect(context.runtime.store.tickets.get(id)!.inputs).toHaveLength(0)
      expect(context.runtime.store.get<boolean>(KV.budgetNudge(id, backdate(context, id, startedAt)))).toBeUndefined()
    } finally { await context.runtime.stop() }
  })

  it('tells the worker to wrap up and report when the budget is reached, exactly once per attempt', async () => {
    const context = await deployment('auto')
    try {
      const id = await startedWithBudget(context, 60 * MINUTE)
      const startedAt = new Date(Date.now() - 61 * MINUTE).toISOString()
      const assignmentId = backdate(context, id, startedAt)
      const now = Date.parse(startedAt) + 61 * MINUTE

      context.runtime.enforceRuntimeBudgets(now)
      const ticket = context.runtime.store.tickets.get(id)!
      expect(ticket.inputs).toHaveLength(1)
      expect(ticket.inputs[0]!.text).toContain('时间预算已用完')
      expect(ticket.inputs[0]!.text).toContain('myagent_report')
      // Told, not stopped: the work is still running, because the point is to get a report out of it.
      expect(ticket.ended).toBeUndefined()
      expect(waitsForPerson(ticket)).toBe(false)
      expect(context.runtime.store.get<boolean>(KV.budgetNudge(id, assignmentId))).toBe(true)
      expect(context.runtime.health.problems().map(problem => problem.detail).join('\n')).toContain('runtime budget')

      // A second look inside the grace period repeats nothing: a nag is noise, and noise gets ignored.
      context.runtime.enforceRuntimeBudgets(now + MINUTE)
      expect(context.runtime.store.tickets.get(id)!.inputs).toHaveLength(1)
    } finally { await context.runtime.stop() }
  })

  it('stops the work a grace period later and hands the Ticket to a person, naming the budget', async () => {
    const context = await deployment('auto')
    try {
      const id = await startedWithBudget(context, 60 * MINUTE)
      const startedAt = new Date(Date.now() - 61 * MINUTE).toISOString()
      backdate(context, id, startedAt)
      context.runtime.enforceRuntimeBudgets(Date.parse(startedAt) + 61 * MINUTE)
      // Past the 10-minute wrap-up window: the budget is not a request.
      context.runtime.enforceRuntimeBudgets(Date.parse(startedAt) + 61 * MINUTE + 11 * MINUTE)

      const ticket = context.runtime.store.tickets.get(id)!
      // Stopped, not failed: the work is over, and the record says the SYSTEM stopped it and why. Attributing it to
      // a person would put a decision in the operator's history that the operator never made.
      expect(ticket.ended).toBeDefined()
      expect(ticket.ended!.outcome).toBe('stopped')
      expect(ticket.ended!.reason).toContain('超出时间预算')
      expect(ticket.ended!.reason).toContain('60 分钟')
      const stopped = context.runtime.engine.history(id).filter(event => event.type === 'stopped')
      expect(stopped).toHaveLength(1)
      expect(stopped[0]!.by).toEqual({ kind: 'system', id: 'runtime-budget' })
      // Its attempt is closed too, so nothing is left running that the panel would still call "in progress".
      expect(ticket.assignments.at(-1)!.state).toBe('ended')
      // And the operator is told in the queue, because "raise the budget or split the job" is their call.
      const queue = context.runtime.decisions()
      expect(queue).toHaveLength(1)
      expect(queue[0]!.source).toBe('runtime-budget')
      expect(queue[0]!.title).toContain('超出墙钟预算被停下')
    } finally { await context.runtime.stop() }
  })

  it('leaves a Ticket with no budget alone, whatever how long it has been running', async () => {
    const context = await deployment('auto')
    try {
      const id = await startedWithBudget(context, 0)
      const startedAt = new Date(Date.now() - 500 * MINUTE).toISOString()
      backdate(context, id, startedAt)
      context.runtime.enforceRuntimeBudgets(Date.parse(startedAt) + 500 * MINUTE)
      expect(context.runtime.store.tickets.get(id)!.inputs).toHaveLength(0)
      expect(context.runtime.store.tickets.get(id)!.ended).toBeUndefined()
    } finally { await context.runtime.stop() }
  })
})
