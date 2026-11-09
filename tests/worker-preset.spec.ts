/**
 * The research preset (S-4): a schedule can send its worker out with no shell at all.
 *
 * The scout schedule's prompt says "do not execute scripts from repositories you found, do not install dependencies".
 * A sentence in a prompt is a promise the model has to keep remembering for an hour; a Session that has no `bash` and
 * no `pwsh` cannot break it. These tests pin the wiring that makes the second one real: the choice travels from the
 * schedule onto the Trigger at acceptance, from the Trigger onto the Session DSH is asked to create, and into the
 * worker's own prompt so it does not spend its turn looking for a tool that was deliberately not given.
 */
import { describe, expect, it } from 'vitest'
import type { Trigger } from '../src/core/index.ts'
import { deployment, type Deployment } from './helpers/deployment.ts'
import { wait } from './helpers/host.ts'

const workerId = (ticketId: string) => `worker-${ticketId}`

/** One accepted, launched Ticket whose Trigger says which preset its worker runs under. */
async function startedWithPreset(context: Deployment, workerPreset?: string): Promise<string> {
  const current = context.runtime.settings() as unknown as Record<string, unknown>
  context.runtime.saveSettings({ ...current, allowedSenders: ['operator'] })
  const at = new Date(Date.now() - 5_000).toISOString()
  const trigger: Trigger = {
    id: `cron-scout-${at}-${workerPreset ?? 'worker'}`, source: 'cron', kind: 'cron', at,
    actor: { id: 'operator', kind: 'person' }, text: '去侦察外部仓库。', title: '每日技术演进侦察',
    meta: {
      schedule: 'evolution-scout-daily', scheduledAt: at,
      ...(workerPreset === undefined ? {} : { workerPreset }),
    },
  }
  const result = context.runtime.engine.receive(trigger)
  expect(result.disposition.state).toBe('accepted')
  const ticketId = (result.disposition as { ticketId: string }).ticketId
  // The same settle the other live-launch specs use: nudge alone raced the launch effect under full-suite load and
  // made the created-calls assertion flaky (one red run out of two, green in isolation).
  await context.runtime.nudge()
  await wait(80)
  context.runtime.passes.requestPass()
  await wait(80)
  return ticketId
}

describe('a Ticket whose Trigger asks for the research preset', () => {
  it('gets a Session created under myagent-researcher, and its prompt says there is no shell', async () => {
    const context = await deployment('auto')
    try {
      const id = await startedWithPreset(context, 'researcher')
      expect(context.host.calls.created).toContainEqual(
        expect.objectContaining({ sessionId: workerId(id), agentPreset: 'myagent-researcher' }),
      )
      // Said out loud: a worker that discovers the absence on its own spends the turn looking for a shell, or reports
      // the system as broken. Naming the boundary is what makes it a scope rather than a defect.
      const section = context.host.sectionText(workerId(id)) ?? ''
      expect(section).toContain('This Session has no shell')
      expect(section).toContain('report `blocked`')
    } finally { await context.runtime.stop() }
  })

  it('leaves every other Ticket on the ordinary worker preset, with no shell paragraph in its prompt', async () => {
    const context = await deployment('auto')
    try {
      // The control half: without it, "the researcher preset was used" and "the researcher preset is always used"
      // look identical, and a regression that hands every worker the restricted surface would pass the test above.
      const plain = await startedWithPreset(context)
      expect(context.host.calls.created).toContainEqual(
        expect.objectContaining({ sessionId: workerId(plain), agentPreset: 'myagent-worker' }),
      )
      expect(context.host.sectionText(workerId(plain)) ?? '').not.toContain('This Session has no shell')

      const explicit = await startedWithPreset(context, 'worker')
      expect(context.host.calls.created).toContainEqual(
        expect.objectContaining({ sessionId: workerId(explicit), agentPreset: 'myagent-worker' }),
      )
    } finally { await context.runtime.stop() }
  })

  it('treats a Trigger from before the field existed as the ordinary worker', async () => {
    const context = await deployment('auto')
    try {
      // An old Trigger has no opinion. The safe reading of no opinion is the surface every Ticket has always had,
      // not the restricted one — silently narrowing existing work would be a change nobody authorized.
      const id = await startedWithPreset(context, undefined)
      expect(context.host.calls.created).toContainEqual(
        expect.objectContaining({ sessionId: workerId(id), agentPreset: 'myagent-worker' }),
      )
    } finally { await context.runtime.stop() }
  })
})
