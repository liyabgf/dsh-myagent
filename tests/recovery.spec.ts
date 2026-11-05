/**
 * Recovery: what a restart finds, and what it does about it.
 *
 * An unattended system is restarted by things it does not control — a host upgrade, a crash, a machine that slept. The
 * database says an Assignment was running; whether a worker still exists is a fact about the process, not about the
 * record. Getting this wrong either loses work or runs the same work twice in one directory.
 */
import { existsSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Config } from '../src/deployment.ts'
import { api } from './helpers/deployment.ts'
import { createRuntime, type Runtime } from '../src/app/runtime.ts'
import { deployment } from './helpers/deployment.ts'
import { stubHost, wait, type StubHost } from './helpers/host.ts'

const workerId = (ticketId: string) => `worker-${ticketId}`
const signal = () => new AbortController().signal

/** A fresh process over the same state directory, which is what a restart is. */
async function restart(stateDir: string, host: StubHost = stubHost()): Promise<{ host: StubHost; runtime: Runtime }> {
  const inbox = join(stateDir, 'inbox')
  const runtime = createRuntime(host.ctx, Config({ stateDir, inboxDir: inbox, workRoot: join(stateDir, 'work') }) as never)
  runtime.saveSettings({ acceptMode: 'auto', sources: { inbox: { directory: inbox, pollMs: 1000 } } })
  await runtime.start()
  return { host, runtime }
}

const settle = async (runtime: Runtime, ms = 80): Promise<void> => {
  await runtime.nudge()
  await wait(ms)
  runtime.passes.requestPass()
  await wait(ms)
}

describe('a restart', () => {
  it('takes over an Assignment whose worker died with the process, in the same directory', async () => {
    const first = await deployment('auto')
    const stateDir = first.stateDir
    let ticketId = ''
    let directory = ''
    try {
      const path = `${first.inbox}/crash.md`
        writeFileSync(path, '写一份摘要', 'utf8')
      const at = new Date(Date.now() - 5_000)
      utimesSync(path, at, at)
      await settle(first.runtime)
      const ticket = first.runtime.store.tickets.list()[0]!
      ticketId = ticket.id
      directory = ticket.execution!.directory
      expect(ticket.assignments.at(-1)).toMatchObject({ state: 'running' })
      expect(existsSync(directory)).toBe(true)
    } finally { await first.runtime.stop() }

    // A new process: the database still says the Assignment runs, and no worker exists.
    const second = await restart(stateDir)
    try {
      const { runtime, host } = second
      const ticket = runtime.store.tickets.get(ticketId)!
      expect(ticket.assignments).toHaveLength(2)
      expect(ticket.assignments[0]).toMatchObject({ state: 'ended', endedReason: 'interrupted' })
      expect(ticket.assignments[1]).toMatchObject({ state: 'pending' })
      // The worker is told it is continuing, not starting, and where its work already is.
      const note = ticket.inputs.find(input => input.text.includes('restarted'))
      expect(note?.text).toContain('continue the assignment from where it stopped')
      expect(note?.text).toContain('do not repeat completed work')
      // And it continues in the same directory, so what it already produced is still there.
      await settle(runtime)
      expect(runtime.store.tickets.get(ticketId)!.execution!.directory).toBe(directory)
      expect(host.agents.get(workerId(ticketId))!.status).toBe('running')
      const prompt = host.agents.get(workerId(ticketId))!.followups[0]!.text
      expect(prompt).toContain('写一份摘要')
      expect(prompt).toContain(directory)
    } finally { await second.runtime.stop() }
  })

  it('leaves alone a worker whose Session is still loaded, which is a resume rather than a crash', async () => {
    const first = await deployment('auto')
    const { runtime: old, host } = first
    const path = `${first.inbox}/resume.md`
    writeFileSync(path, '写一份摘要', 'utf8')
    const at = new Date(Date.now() - 5_000)
    utimesSync(path, at, at)
    await settle(old)
    const ticketId = old.store.tickets.list()[0]!.id
    expect(host.agents.get(workerId(ticketId))!.status).toBe('running')
    const followups = host.agents.get(workerId(ticketId))!.followups.length
    await old.stop()

    // The same host, so the worker's Session is still loaded: a restart that finds its worker alive must not
    // interrupt it, or the same directory gets two workers and the work is done twice.
    const second = await restart(first.stateDir, host)
    try {
      const ticket = second.runtime.store.tickets.get(ticketId)!
      expect(ticket.assignments).toHaveLength(1)
      expect(ticket.assignments[0]).toMatchObject({ state: 'running' })
      expect(ticket.inputs.find(input => input.text.includes('restarted'))).toBeUndefined()
      // And it was not handed its work a second time.
      expect(host.agents.get(workerId(ticketId))!.followups).toHaveLength(followups)
    } finally { await second.runtime.stop() }
  })

  it('replays a launch that was queued but never started, without marking anything interrupted', async () => {
    const first = await deployment('auto')
    const { runtime } = first
    // One slot and two requests: the second is authorized, queued, and has no worker yet.
    runtime.saveSettings({ acceptMode: 'auto', executor: { maxWorkers: 1 }, sources: { inbox: { directory: first.inbox, pollMs: 1000 } } })
    for (const name of ['first.md', 'second.md']) {
      const path = `${first.inbox}/${name}`
      writeFileSync(path, `写一份摘要：${name}`, 'utf8')
      const at = new Date(Date.now() - 5_000)
      utimesSync(path, at, at)
      await settle(runtime)
    }
    const ids = runtime.store.tickets.list().map(ticket => ticket.id)
    expect(ids).toHaveLength(2)
    const stateOf = (id: string) => runtime.store.tickets.get(id)!.assignments.at(-1)!.state
    const runningId = ids.find(id => stateOf(id) === 'running')!
    const queuedId = ids.find(id => stateOf(id) === 'pending')!
    expect(runtime.store.effectCounts()).toEqual({ launch: 1 })
    await runtime.stop()

    const second = await restart(first.stateDir)
    try {
      const queued = second.runtime.store.tickets.get(queuedId)!
      // Nothing was running, so nothing was interrupted: still one attempt, still pending, no recovery note.
      expect(queued.assignments).toHaveLength(1)
      expect(queued.assignments[0]).toMatchObject({ state: 'pending' })
      expect(queued.inputs).toEqual([])
      // Its queued launch survived the restart.
      expect(second.runtime.store.effectCounts().launch).toBeGreaterThanOrEqual(1)
      // The one that was running is taken over instead, which is the other half of the same restart.
      expect(second.runtime.store.tickets.get(runningId)!.assignments).toHaveLength(2)
      expect(second.runtime.store.tickets.get(runningId)!.assignments[0]).toMatchObject({ endedReason: 'interrupted' })
      await settle(second.runtime)
      // One slot: the taken-over worker runs, and the queued one is still waiting its turn rather than lost.
      expect(second.runtime.store.tickets.get(runningId)!.assignments.at(-1)).toMatchObject({ state: 'running' })
      expect(second.runtime.store.tickets.get(queuedId)!.assignments.at(-1)).toMatchObject({ state: 'pending' })
      expect(second.runtime.store.effectCounts()).toEqual({ launch: 1 })
    } finally { await second.runtime.stop() }
  })

  it('leaves an ended Ticket alone, and does not resurrect its worker', async () => {
    const first = await deployment('auto')
    const { runtime, host } = first
    const path = `${first.inbox}/done.md`
    writeFileSync(path, '写一份摘要', 'utf8')
    const at = new Date(Date.now() - 5_000)
    utimesSync(path, at, at)
    await settle(runtime)
    const ticketId = runtime.store.tickets.list()[0]!.id
    await host.tool(workerId(ticketId), 'myagent_report')!.definition
      .execute({ state: 'ready', summary: '写好了', files: ['digest.md'] }, { signal: signal() })
    await settle(runtime)
    const directory = runtime.store.tickets.get(ticketId)!.execution!.directory
    expect(readFileSync(join(directory, 'RESULT.md'), 'utf8')).toContain('写好了')
    await runtime.stop()

    const second = await restart(first.stateDir)
    try {
      const ticket = second.runtime.store.tickets.get(ticketId)!
      expect(ticket.ended).toMatchObject({ outcome: 'done' })
      expect(ticket.assignments).toHaveLength(1)
      expect(second.runtime.store.effectCounts()).toEqual({})
      expect(second.host.calls.sessions).toEqual([])
    } finally { await second.runtime.stop() }
  })

  it('refuses a second deployment over the same state, so two processes cannot work one queue', async () => {
    const first = await deployment('auto')
    try {
      const host = stubHost()
      // The lock names who holds it, so an operator can tell a live deployment from a stale file.
      expect(() => createRuntime(host.ctx, Config({ stateDir: first.stateDir }) as never)).toThrow(/Another myagent holds/)
    } finally { await first.runtime.stop() }
  })
})

describe('the front desk across a restart', () => {
  it('is still there under the id DSH gave, and asking for it again restores rather than creates', async () => {
    const host = stubHost({ answersWith: requested => requested === 'myagent-main' ? 'session-blank-3' : requested })
    const first = await deployment('auto', {}, host)
    const stateDir = first.stateDir
    try {
      await first.runtime.createMainSession()
      expect(first.runtime.mainSession()).toMatchObject({ exists: true, id: 'session-blank-3' })
    } finally { await first.runtime.stop() }

    // A new process, with the front desk stored but not loaded. Saying "not created" here would offer a button that in
    // fact restores the old Session, which is not what an operator reads it as.
    host.agents.delete('session-blank-3')
    host.seedRestored('session-blank-3')
    const second = await restart(stateDir, host)
    try {
      expect(second.runtime.mainSession()).toMatchObject({ exists: true, running: false, id: 'session-blank-3' })
      const created = second.host.calls.sessions.length
      await second.host.request(api('main-session'), { method: 'POST', body: {} })
      // Restored from storage under the recorded id: no second front desk was made.
      expect(second.host.calls.sessions).toHaveLength(created)
      expect(second.runtime.mainSession()).toMatchObject({ exists: true, running: true, id: 'session-blank-3' })
    } finally { await second.runtime.stop() }
  })

  it('reports no front desk at all when none was ever created', async () => {
    const context = await deployment('auto')
    try {
      expect(context.runtime.mainSession()).toEqual({ exists: false, running: false, busy: false, id: 'myagent-main' })
    } finally { await context.runtime.stop() }
  })
})
