/**
 * The Executor's own rules: how many workers may run, what a launch does when it cannot, and what happens to work that
 * is no longer wanted by the time its turn comes.
 *
 * A launch is queued rather than run, so every case here is about a queue that outlives the moment it was made in: a
 * slot that is full, a deployment that is paused, an Assignment a retry replaced, a Ticket a person stopped.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, symlinkSync, truncateSync, utimesSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { canRetry, key } from '../src/core/index.ts'
import { LocalHostSandbox } from '../src/app/executor.ts'
import { tempDir } from './helpers/temp.ts'
import { api, deployment, type Deployment } from './helpers/deployment.ts'
import { wait } from './helpers/host.ts'

const workerId = (ticketId: string) => `worker-${ticketId}`
const signal = () => new AbortController().signal

/** Ask the system to look now and run what is due, then let the pump finish. */
async function settle(runtime: Deployment['runtime'], ms = 80): Promise<void> {
  await runtime.nudge()
  await wait(ms)
  runtime.passes.requestPass()
  await wait(ms)
}

/**
 * Make a Ticket's queued launch due at once, so a test does not wait out a retry interval.
 *
 * The key is computed rather than looked up: `claimEffects` only hands back rows that are already due, which is exactly
 * what a deferred row is not.
 */
function dueNow(context: Deployment, ticketId: string, kind = 'launch'): void {
  const assignmentId = context.runtime.store.tickets.get(ticketId)!.assignments.at(-1)!.id
  context.runtime.store.deferEffect(kind, key(kind, ticketId, assignmentId), Date.now() - 1)
}

/** The health board as one string, which is how the panel shows it. */
const problems = (runtime: Deployment['runtime']): string =>
  runtime.health.problems().map(problem => `${problem.name}: ${problem.detail}`).join('\n')

/** What a refused inbox file says about itself, which is the only trace left without the panel. */
function taken(inbox: string, folder: string): string {
  return readdirSync(`${inbox}/${folder}`).map(name => readFileSync(`${inbox}/${folder}/${name}`, 'utf8')).join('\n')
}

/** Settings for this context's inbox, which every save has to repeat because a save replaces the document. */
const inboxOf = (context: Deployment, over: object = {}) => ({
  acceptMode: 'auto' as const, sources: { inbox: { directory: context.inbox, pollMs: 1000 } }, ...over,
})

/** Drop one request file whose mtime says it has settled, and let it become a Ticket. */
async function one(context: Deployment, name: string, text: string): Promise<string> {
  const path = `${context.inbox}/${name}`
  writeFileSync(path, text, 'utf8')
  const at = new Date(Date.now() - 5_000)
  utimesSync(path, at, at)
  await settle(context.runtime)
  const tickets = context.runtime.store.tickets.list()
  expect(tickets.length, `no Ticket came out of ${name}`).toBeGreaterThan(0)
  return tickets[0]!.id
}

/** Two Tickets, split by what actually happened to them rather than by the order their ids sort into. */
async function two(context: Deployment): Promise<{ ids: string[]; running: string[]; pending: string[] }> {
  await one(context, 'one.md', '第一份工作')
  await one(context, 'two.md', '第二份工作')
  const ids = context.runtime.store.tickets.list().map(ticket => ticket.id)
  expect(ids).toHaveLength(2)
  const state = (id: string) => context.runtime.store.tickets.get(id)!.assignments.at(-1)!.state
  return { ids, running: ids.filter(id => state(id) === 'running'), pending: ids.filter(id => state(id) === 'pending') }
}

describe('worker slots', () => {
  it('runs only as many workers as the settings allow, and queues the rest', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      runtime.saveSettings(inboxOf(context, { executor: { maxWorkers: 1 } }))
      const { running, pending } = await two(context)
      expect(running).toHaveLength(1)
      expect(pending).toHaveLength(1)
      // The queued one has no Session: a full slot means the work waits, not that two workers share one.
      expect(host.agents.has(workerId(pending[0]!))).toBe(false)
      expect(host.agents.get(workerId(running[0]!))!.status).toBe('running')
      expect(runtime.store.effectCounts()).toEqual({ launch: 1 })
    } finally { await runtime.stop() }
  })

  it('starts the queued worker once a slot is free, in the directory it was promised', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      runtime.saveSettings(inboxOf(context, { executor: { maxWorkers: 1 } }))
      const { running, pending } = await two(context)
      const queued = pending[0]!
      const directory = runtime.store.tickets.get(queued)!.execution!.directory
      // The running worker reports itself done, which frees its slot.
      await host.tool(workerId(running[0]!), 'myagent_report')!.definition
        .execute({ state: 'ready', summary: '做完了' }, { signal: signal() })
      await settle(runtime)
      dueNow(context, queued)
      await settle(runtime)
      expect(host.agents.get(workerId(queued))!.status).toBe('running')
      expect(runtime.store.tickets.get(queued)!.assignments.at(-1)).toMatchObject({ state: 'running' })
      expect(runtime.store.tickets.get(queued)!.execution!.directory).toBe(directory)
      expect(runtime.store.effectCounts()).toEqual({})
    } finally { await runtime.stop() }
  })

  it('runs two workers when the settings allow two', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      runtime.saveSettings(inboxOf(context, { executor: { maxWorkers: 2 } }))
      const { running } = await two(context)
      expect(running).toHaveLength(2)
      expect(runtime.store.effectCounts()).toEqual({})
      expect((await host.request(api('state'))).json.counts).toMatchObject({ workerSlots: { used: 2, max: 2 } })
    } finally { await runtime.stop() }
  })
})

describe('a pause', () => {
  it('holds new work while paused and takes it when unpaused, so nothing is refused or lost', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      runtime.saveSettings(inboxOf(context, { paused: true }))
      const path = `${context.inbox}/paused.md`
      writeFileSync(path, '做点事', 'utf8')
      const at = new Date(Date.now() - 5_000)
      utimesSync(path, at, at)
      await settle(runtime)
      // The pause happens where the work is produced, not at the gate. A gate refusal would have consumed the
      // request — filed to rejected/, stored as ignored, and unrecoverable by un-pausing, because a byte-identical
      // re-drop hits the duplicate short-circuit and is filed as refused again with the old reason.
      expect(runtime.store.tickets.list()).toEqual([])
      expect(runtime.store.triggers.list()).toEqual([])
      expect(runtime.store.decisions.list(5)).toEqual([])
      expect(host.calls.sessions).toEqual([])
      expect(readdirSync(context.inbox).filter(name => name.endsWith('.md'))).toContain('paused.md')
      // Un-pausing takes it, as the same request it always was.
      runtime.saveSettings(inboxOf(context, { paused: false }))
      await settle(runtime)
      expect(runtime.store.tickets.list()).toHaveLength(1)
      // Archived under the Trigger's own identity — the idempotency the archive name now carries.
      const archived = readdirSync(join(context.inbox, 'accepted'))
      expect(archived).toHaveLength(1)
      expect(archived[0]).toContain('paused.md')
      expect(readdirSync(context.inbox).filter(name => name.endsWith('.md'))).toEqual([])
    } finally { await runtime.stop() }
  })

  it('holds a queued launch while paused, and runs it when the pause lifts', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      runtime.saveSettings(inboxOf(context, { executor: { maxWorkers: 1 } }))
      const { running, pending } = await two(context)
      const queued = pending[0]!
      expect(host.agents.has(workerId(queued))).toBe(false)

      // A pause holds work that was already authorized but has not started; it does not withdraw it, and it does not
      // touch a worker that is running.
      runtime.saveSettings(inboxOf(context, { paused: true, executor: { maxWorkers: 2 } }))
      dueNow(context, queued)
      await settle(runtime)
      expect(host.agents.has(workerId(queued))).toBe(false)
      expect(runtime.store.effectCounts()).toEqual({ launch: 1 })
      expect(runtime.store.tickets.get(queued)!.assignments.at(-1)).toMatchObject({ state: 'pending' })
      expect(host.agents.get(workerId(running[0]!))!.status).toBe('running')

      // Lifting the pause is all it takes: the same queued launch runs, in the directory it was promised.
      const directory = runtime.store.tickets.get(queued)!.execution!.directory
      runtime.saveSettings(inboxOf(context, { executor: { maxWorkers: 2 } }))
      dueNow(context, queued)
      await settle(runtime)
      expect(host.agents.get(workerId(queued))!.status).toBe('running')
      expect(runtime.store.tickets.get(queued)!.execution!.directory).toBe(directory)
      expect(runtime.store.effectCounts()).toEqual({})
    } finally { await runtime.stop() }
  })
})

describe('a launch whose work is no longer wanted', () => {
  it('settles a launch for an Assignment a retry replaced, instead of starting a second worker', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      const id = await one(context, 'stale.md', '做点事')
      const before = runtime.store.tickets.get(id)!.assignments.length
      expect(host.agents.get(workerId(id))).toBeDefined()
      // A stale effect, as a crash between a retry and its launch would leave behind.
      runtime.store.enqueueEffect('launch', key('launch', id, 'assignment-gone'), { ticketId: id, assignmentId: 'assignment-gone' })
      runtime.passes.requestPass()
      await settle(runtime)
      expect(runtime.store.effectCounts()).toEqual({})
      // Nothing new was created, and the worker that is running was left alone.
      expect(host.calls.sessions.filter(session => session === workerId(id))).toHaveLength(1)
      expect(runtime.store.tickets.get(id)!.assignments).toHaveLength(before)
    } finally { await runtime.stop() }
  })

  it('settles a launch for a Ticket a person stopped before it ran', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      runtime.saveSettings(inboxOf(context, { paused: true }))
      // Authorized before the pause, so its launch is queued; then stopped while it waits.
      runtime.saveSettings(inboxOf(context))
      const id = await one(context, 'stopped.md', '做点事')
      await host.request(api(`tickets/${id}/stop`), { method: 'POST', body: { reason: '不需要了' } })
      const created = host.calls.sessions.length
      runtime.store.enqueueEffect('launch', key('launch', id, 'late'), { ticketId: id, assignmentId: 'late' })
      runtime.passes.requestPass()
      await settle(runtime)
      expect(runtime.store.effectCounts()).toEqual({})
      expect(host.calls.sessions).toHaveLength(created)
      expect(runtime.store.tickets.get(id)!.ended).toMatchObject({ outcome: 'stopped' })
    } finally { await runtime.stop() }
  })
})

describe('B2f strict stop contracts', () => {
  it('preserves the reporting worker closing turn when only background work stops', async () => {
    const context = await deployment('auto', { services: true })
    const { runtime, host } = context
    try {
      const id = runtime.engine.createTicket({ title: 'closing', text: 'work' }).ticketId!
      await settle(runtime)
      const agent = host.agents.get(workerId(id))!
      agent.status = 'running'
      await runtime.executor.haltBackground(id, 'reported done')
      expect(agent.cancelled).toBe(0)
    } finally { await runtime.stop() }
  })

  it('does not cancel a replacement Agent after an older halt reaches late cleanup', async () => {
    const context = await deployment('auto', { services: true })
    const { runtime, host } = context
    try {
      const id = runtime.engine.createTicket({ title: 'replacement', text: 'work' }).ticketId!
      await settle(runtime)
      const original = host.agents.get(workerId(id))!
      let release!: () => void
      let entered!: () => void
      const gate = new Promise<void>(resolve => { release = resolve })
      const reached = new Promise<void>(resolve => { entered = resolve })
      const originalDrain = (host.ctx as any).get('subagents')
      const blockingService = { ...originalDrain, drainDescendants: async (roots: unknown[]) => {
        if (roots[0] === original) { entered(); await gate }
        return originalDrain.drainDescendants(roots)
      } }
      ;(host.ctx as any).get = (name: string) => name === 'subagents' ? blockingService : undefined
      const ending = runtime.executor.haltBackground(id, 'closing turn')
      await reached
      runtime.engine.assignmentInterrupted(id, runtime.store.tickets.get(id)!.assignments.at(-1)!.id, 'new attempt')
      const replacement = host.spawn(original.id, 'running')
      release()
      await ending
      expect(original.cancelled).toBe(0)
      expect(replacement.cancelled).toBe(0)
    } finally { await runtime.stop() }
  })

  it('rejects explicit halt and retains failed stop evidence in drain until successful retry', async () => {
    const context = await deployment('auto', { services: true })
    const { runtime, host } = context
    try {
      const id = runtime.engine.createTicket({ title: 'failure', text: 'work' }).ticketId!
      await settle(runtime)
      host.spawn('drain-child', 'running')
      host.services.children.set(workerId(id), ['drain-child'])
      host.services.failDrains.push('drain-child')
      await expect(runtime.executor.halt(id, 'stop failed', false)).rejects.toThrow(/Stopping/)
      await expect(runtime.executor.drain()).rejects.toThrow(/stop|drain/i)
      host.services.failDrains.length = 0
      await runtime.executor.halt(id, 'retry', false)
      await expect(runtime.executor.drain()).resolves.toBeUndefined()
    } finally { host.services.failDrains.length = 0; await runtime.stop() }
  })
})

describe('stop at worker delivery await boundaries', () => {
  for (const boundary of ['late-create', 'late-create-alias', 'second-ensure', 'history'] as const) {
    it(`does not prompt after stop commits during ${boundary}`, async () => {
      const context = await deployment('auto', boundary === 'late-create-alias'
        ? { answersWith: id => id.startsWith('worker-') ? `actual-${id}` : id } : {})
      const { runtime, host } = context
      let release!: () => void
      let entered!: () => void
      const blocked = new Promise<void>(resolve => { release = resolve })
      const reached = new Promise<void>(resolve => { entered = resolve })
      if (boundary === 'late-create' || boundary === 'late-create-alias') {
        const controller = host.ctx.sessionController
        const create = controller.create.bind(controller)
        vi.spyOn(controller, 'create').mockImplementation(async request => {
          if (request.agentPreset !== undefined) { entered(); await blocked }
          const created = await create(request)
          if (request.agentPreset !== undefined) host.agents.get(created.sessionId)!.status = 'running'
          return created
        })
      } else if (boundary === 'second-ensure') {
        const ensure = runtime.sessions.ensure.bind(runtime.sessions)
        let count = 0
        vi.spyOn(runtime.sessions, 'ensure').mockImplementation(async (...args) => {
          if (++count === 2) { entered(); await blocked }
          return ensure(...args)
        })
      } else {
        const persistence = host.ctx.sessionPersistence
        const flush = persistence.flush.bind(persistence)
        vi.spyOn(persistence, 'flush').mockImplementation(async (...args) => {
          entered(); await blocked
          return flush(...args)
        })
      }
      try {
        const path = join(context.inbox, `stop-${boundary}.md`)
        writeFileSync(path, '工作')
        const old = new Date(Date.now() - 5000)
        utimesSync(path, old, old)
        await runtime.nudge()
        await reached
        const id = runtime.store.tickets.list()[0]!.id
        runtime.engine.stopTicket(id)
        // Ensure the first halt can finish BEFORE a late create returns.
        await runtime.executor.halt(id, 'test stop', false)
        release()
        await settle(runtime)
        const bound = runtime.store.tickets.get(id)!.execution?.sessionId ?? workerId(id)
        const agent = host.agents.get(bound)
        expect(agent).toBeDefined()
        expect(agent!.followups).toEqual([])
        if (agent !== undefined) expect(agent.status).toBe('idle')
        expect(runtime.store.tickets.get(id)!.assignments.at(-1)!.state).toBe('ended')
      } finally { release(); await runtime.stop() }
    })
  }
})

describe('worker Session ownership on late create', () => {
  it('refuses a returned Session owned by another Ticket without cancelling it', async () => {
    let answer: string | undefined
    const context = await deployment('auto', { answersWith: id => answer ?? id })
    const { runtime, host } = context
    try {
      const first = await one(context, 'owner.md', 'first')
      const owner = host.agents.get(workerId(first))!
      answer = workerId(first)
      const path = join(context.inbox, 'unrelated.md')
      writeFileSync(path, 'second')
      const old = new Date(Date.now() - 5000)
      utimesSync(path, old, old)
      await settle(runtime)
      const replacement = host.agents.get(workerId(first))!
      expect(replacement.cancelled).toBe(0)
      expect(replacement.followups).toEqual([])
      expect(owner.cancelled).toBe(0)
      expect(runtime.store.tickets.list().find(t => t.id !== first)!.execution?.sessionId).toBeUndefined()
    } finally { await runtime.stop() }
  })
})

describe('stop while a launch is preparing', () => {
  it('does not start the assignment after stop commits during prepare', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    let release!: () => void
    const blocked = new Promise<void>(resolve => { release = resolve })
    const original = runtime.executor.sandbox.runPrepare.bind(runtime.executor.sandbox)
    vi.spyOn(runtime.executor.sandbox, 'runPrepare').mockImplementation(async (...args) => {
      await blocked
      return original(...args)
    })
    try {
      runtime.saveSettings(inboxOf(context, { executor: { prepare: 'true' } }))
      const id = await one(context, 'stop-during-prepare.md', '工作')
      // Launch is now held inside prepare. Commit stop before the prepare promise resumes.
      runtime.engine.stopTicket(id)
      release()
      await settle(runtime)
      expect(host.agents.get(workerId(id))).toBeUndefined()
      expect(runtime.store.tickets.get(id)!.ended).toMatchObject({ outcome: 'stopped' })
    } finally { release(); await runtime.stop() }
  })
})

describe('the prepare command', () => {
  it('runs once per Ticket directory, in the parent of that directory', async () => {
    const context = await deployment('auto', { spawn: { exitCode: 0, stdout: 'prepared\n' } })
    const { runtime, host } = context
    try {
      runtime.saveSettings(inboxOf(context, { executor: { prepare: 'git init -q' } }))
      const id = await one(context, 'prepared.md', '做点事')
      expect(host.calls.spawns).toEqual([{ argv: ['sh', '-c', 'git init -q'], cwd: context.work }])
      expect(runtime.store.tickets.get(id)!.assignments.at(-1)).toMatchObject({ state: 'running' })
    } finally { await runtime.stop() }
  })

  it('reports a prepare failure and leaves the Ticket retryable, because the directory may be half-made', async () => {
    const context = await deployment('auto', { spawn: { exitCode: 2, stderr: 'git: not a repository\n' } })
    const { runtime, host } = context
    try {
      runtime.saveSettings(inboxOf(context, { executor: { prepare: 'git init -q' } }))
      const id = await one(context, 'broken.md', '做点事')
      await settle(runtime)
      const ticket = runtime.store.tickets.get(id)!
      // No Session was created: nothing may run in a directory the prepare step left uncertain.
      expect(host.agents.has(workerId(id))).toBe(false)
      // Not ended. A Ticket that could not even be prepared is waiting for someone to fix the directory and try
      // again; ending it made that impossible AND invisible — no report, no attention, no notice to the front desk,
      // and a retry refused because the Ticket was over. A retry prepares a fresh attempt, so the half-made directory
      // is not reused: `launch` runs the prepare command only for an Assignment that has never started.
      expect(ticket.ended).toBeUndefined()
      const report = ticket.assignments.at(-1)!.report!
      expect(report).toMatchObject({ state: 'failed' })
      expect(report.summary).toContain('git: not a repository')
      expect(ticket.attention).toBeDefined()
      expect(canRetry(ticket)).toBe(true)
      // The effect is gone rather than queued, and the board says why.
      expect(runtime.store.effectCounts()).toEqual({})
      expect(host.calls.spawns).toHaveLength(1)
      expect(problems(runtime)).toContain('Prepare failed')
    } finally { await runtime.stop() }
  })

  it('says plainly when a prepare command was stopped before it finished', async () => {
    const context = await deployment('auto', { spawn: { exitCode: null } })
    const { runtime } = context
    try {
      runtime.saveSettings(inboxOf(context, { executor: { prepare: 'sleep 100' } }))
      const id = await one(context, 'cut-short.md', '做点事')
      await settle(runtime)
      const ticket = runtime.store.tickets.get(id)!
      const report = ticket.assignments.at(-1)!.report!
      expect(report).toMatchObject({ state: 'failed' })
      expect(report.summary).toContain('stopped before it finished')
    } finally { await runtime.stop() }
  })
})

describe('a launch that keeps failing', () => {
  it('leaves the work queued and says so on the board, without pretending the Ticket started', async () => {
    // A host that creates Sessions but hands no agent back: the launch cannot complete, and it must not be silent.
    const context = await deployment('auto', { resolve: false })
    const { runtime, host } = context
    try {
      const id = await one(context, 'no-agent.md', '做点事')
      await settle(runtime)
      const ticket = runtime.store.tickets.get(id)!
      expect(ticket.assignments.at(-1)).toMatchObject({ state: 'pending' })
      expect(ticket.ended).toBeUndefined()
      // Still queued, so a host that recovers picks it up; and the board carries the reason.
      expect(runtime.store.effectCounts()).toEqual({ launch: 1 })
      expect(problems(runtime)).toContain('did not hand it over')
      expect(host.agents.size).toBe(0)
    } finally { await runtime.stop() }
  })

  it('tells the Ticket when the queue gives up, so it does not wait forever with no reason on it', async () => {
    const context = await deployment('auto', { resolve: false })
    const { runtime } = context
    try {
      const id = await one(context, 'given-up.md', '做点事')
      runtime.executor.gaveUp('launch', { ticketId: id, assignmentId: 'assignment-1' }, new Error('DSH did not hand it over'))
      const ticket = runtime.store.tickets.get(id)!
      expect(ticket.assignments.at(-1)!.report).toMatchObject({ state: 'failed' })
      expect(ticket.assignments.at(-1)!.report!.summary).toContain('gave up after repeated attempts')
      expect(ticket.assignments.at(-1)!.report!.summary).toContain('DSH did not hand it over')
      // It waits for a person now, and a person can push it again.
      expect(ticket.attention).toBeDefined()
      expect(canRetry(ticket)).toBe(true)
      expect(ticket.ended).toBeUndefined()
      // Telling a Ticket that has ended is not an error: there is nothing left to tell.
      runtime.engine.stopTicket(id)
      expect(() => runtime.executor.gaveUp('launch', { ticketId: id, assignmentId: 'assignment-1' }, new Error('late')))
        .not.toThrow()
    } finally { await runtime.stop() }
  })
})

describe('looking now', () => {
  it('takes a request the moment a pass is asked for, rather than at the next poll', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      const path = `${context.inbox}/nudge.md`
      writeFileSync(path, '做点事', 'utf8')
      const at = new Date(Date.now() - 5_000)
      utimesSync(path, at, at)
      // The panel's button is the only thing that happens here: no waiting out a poll interval.
      const response = await host.request(api('pass'), { method: 'POST', body: {} })
      expect(response.status).toBe(200)
      await settle(runtime, 40)
      expect(runtime.store.tickets.list()).toHaveLength(1)
      expect(host.agents.size).toBe(1)
    } finally { await runtime.stop() }
  })

  it('takes two requests dropped together in one look', async () => {
    const context = await deployment('auto')
    const { runtime } = context
    try {
      runtime.saveSettings(inboxOf(context, { executor: { maxWorkers: 2 } }))
      for (const name of ['a.md', 'b.md']) {
        const path = `${context.inbox}/${name}`
        writeFileSync(path, `做点事：${name}`, 'utf8')
        const at = new Date(Date.now() - 5_000)
        utimesSync(path, at, at)
      }
      await settle(runtime)
      expect(runtime.store.tickets.list()).toHaveLength(2)
    } finally { await runtime.stop() }
  })
})

describe('files that came with the request', () => {
  /** A real file to attach, and a request that names it. */
  async function withAttachment(context: Deployment, source: string, content: string): Promise<string> {
    writeFileSync(source, content, 'utf8')
    const path = `${context.inbox}/with-file.md`
    writeFileSync(path, `---\ntitle: 处理附件\nattach: ${source}\n---\n读附件里的内容并汇报。`, 'utf8')
    const at = new Date(Date.now() - 5_000)
    utimesSync(path, at, at)
    await settle(context.runtime)
    const ticket = context.runtime.store.tickets.list()[0]!
    expect(ticket.attachments).toHaveLength(1)
    return ticket.id
  }

  it('copies them into the Ticket\'s own directory before the worker starts', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      const source = join(context.stateDir, 'sales-q3.csv')
      const id = await withAttachment(context, source, 'date,amount\n2026-08-01,100\n')
      const directory = runtime.store.tickets.get(id)!.execution!.directory
      const copied = join(directory, 'attachments', 'sales-q3.csv')
      expect(readFileSync(copied, 'utf8')).toBe('date,amount\n2026-08-01,100\n')
      // The source is left alone: copying is not moving.
      expect(readFileSync(source, 'utf8')).toBe('date,amount\n2026-08-01,100\n')
      // And the worker is told the copies are what it works from.
      const prompt = host.agents.get(workerId(id))!.followups[0]!.text
      expect(prompt).toContain('Files that came with the request')
      expect(prompt).toContain('attachments/sales-q3.csv')
      expect(prompt).toContain(source)
    } finally { await runtime.stop() }
  })

  it('refuses to attach a file from inside workRoot (another Ticket\'s workspace) or a symbolic link', async () => {
    const context = await deployment('auto')
    const { runtime } = context
    try {
      const otherDir = join(context.stateDir, 'work', 'other-ticket-11111111')
      mkdirSync(otherDir, { recursive: true })
      const stolen = join(otherDir, 'secret.csv')
      writeFileSync(stolen, 'secret', 'utf8')
      const path = join(context.inbox, 'steal-attach.md')
      writeFileSync(path, `---\ntitle: 偷挂附件\nattach: ${stolen}\n---\n读附件。`, 'utf8')
      const at = new Date(Date.now() - 5_000)
      utimesSync(path, at, at)
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      expect(ticket.assignments.at(-1)!.report).toMatchObject({ state: 'failed' })
      expect(ticket.assignments.at(-1)!.report!.summary).toContain('workRoot')
    } finally { await runtime.stop() }
  })

  it('reports a file that cannot be copied, rather than starting the Ticket without its input', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      const missing = join(context.stateDir, 'gone.csv')
      const path = join(context.inbox, 'missing-file.md')
      writeFileSync(path, `---\ntitle: 缺附件\nattach: ${missing}\n---\n读附件。`, 'utf8')
      const at = new Date(Date.now() - 5_000)
      utimesSync(path, at, at)
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      // No Session, no half-run: the request named a file that is not there.
      expect(host.agents.has(workerId(ticket.id))).toBe(false)
      expect(ticket.ended).toBeUndefined()
      const report = ticket.assignments.at(-1)!.report!
      expect(report).toMatchObject({ state: 'failed' })
      expect(report.summary).toContain(missing)
      expect(report.summary).toContain('could not be copied')
      // Visible where the operator looks, which is the whole point of not ending it.
      expect(ticket.attention).toBeDefined()
      expect(canRetry(ticket)).toBe(true)
      expect(problems(runtime)).toContain('Prepare failed')
      // Not retried: copying the same missing path again would fail the same way.
      expect(runtime.store.effectCounts()).toEqual({})
    } finally { await runtime.stop() }
  })

  it('gives two files with the same name room to coexist', async () => {
    const context = await deployment('auto')
    const { runtime } = context
    try {
      const one = join(context.stateDir, 'a', 'report.csv')
      const two = join(context.stateDir, 'b', 'report.csv')
      mkdirSync(join(context.stateDir, 'a'), { recursive: true })
      mkdirSync(join(context.stateDir, 'b'), { recursive: true })
      writeFileSync(one, 'from a\n', 'utf8')
      writeFileSync(two, 'from b\n', 'utf8')
      const path = join(context.inbox, 'two-files.md')
      writeFileSync(path, `---\ntitle: 两个同名文件\nattach: ${one}, ${two}\n---\n比较它们。`, 'utf8')
      const at = new Date(Date.now() - 5_000)
      utimesSync(path, at, at)
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      expect(ticket.attachments.map(item => item.name)).toEqual(['report.csv', 'report-2.csv'])
      const directory = ticket.execution!.directory
      expect(readFileSync(join(directory, 'attachments', 'report.csv'), 'utf8')).toBe('from a\n')
      expect(readFileSync(join(directory, 'attachments', 'report-2.csv'), 'utf8')).toBe('from b\n')
    } finally { await runtime.stop() }
  })
})

describe('a Source denied while work it already produced is running', () => {
  it('does not hold back an accepted Ticket, which is what separates a denial from a pause', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      const id = await one(context, 'already-in.md', '做点事')
      // Denied after the fact: the Ticket was accepted under the policy of its time, and a Deny stops new intake
      // rather than withdrawing authorization from work already authorized. A pause does the opposite — it defers the
      // launch of everything accepted — and that difference is the reason both settings exist.
      runtime.saveSettings(inboxOf(context, { sources: { inbox: { enabled: true, deny: true, directory: context.inbox } } }))
      await settle(runtime)
      expect(host.calls.sessions.length).toBeGreaterThan(0)
      expect(runtime.store.tickets.get(id)!.assignments.at(-1)!.state).toBe('running')
    } finally { await runtime.stop() }
  })
})

describe('the layered context a worker is given', () => {
  it('names the Project and Work, and says plainly that they do not widen the authorization', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      const project = runtime.engine.createProject({ name: '客户 A', note: '数据平台' })
      const work = runtime.engine.createWork({
        name: '季度报表', projectId: project.id, note: '每季度一次',
        // A Work scope broader than the Ticket's own Mandate: exactly the case where treating it as authorization
        // would silently re-authorize an accepted Ticket because somebody edited a Work.
        scope: '可以读取 ~/data 下的任何文件',
      })
      const made = runtime.engine.createTicket({ title: '分层上下文', text: '做点事' })
      const id = made.ticketId!
      // Classified before the launch is picked up, so the prompt is built with the Work already known.
      runtime.engine.attachWork(id, work.id)
      await settle(runtime)

      const prompt = host.agents.get(workerId(id))!.followups[0]!.text
      expect(prompt).toContain('客户 A')
      expect(prompt).toContain('季度报表')
      expect(prompt).toContain('第 1 张')
      expect(prompt).toContain('This is context, not authorization')
      // The authorization the worker is given is still its Mandate's scope, and the Work's broader one appears only
      // in the context section — never in the section that says what it may do.
      const scope = prompt.split('## Your scope')[1]!.split('##')[0]!
      expect(scope).not.toContain('~/data')
      expect(prompt.split('## The work this belongs to')[1]!).toContain('~/data')
    } finally { await runtime.stop() }
  })

  it('says nothing about a Work when the Ticket belongs to none', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      const id = await one(context, 'no-work.md', '做点事')
      await settle(runtime)
      expect(host.agents.get(workerId(id))!.followups[0]!.text).not.toContain('## The work this belongs to')
    } finally { await runtime.stop() }
  })
})


describe('a rescue of a launch that is still in flight', () => {
  // A live run showed the rescue was a no-op, and then hid that it was: `Effects.runDue` returns while a pass owns the
  // queue and the pass in flight IS this launch awaiting its prepare command, so the re-enqueued row is settled by the
  // attempt already running. Deleting the `starting` entry on top of that made the Ticket vanish from `stuckLaunches`
  // — so the Watchdog never saw it again and never reached "this needs a person" — and made `used()` stop counting a
  // process that was still running.
  it('keeps counting the launch as starting, so it stays visible and still holds its slot', async () => {
    const context = await deployment('auto', { spawn: { delayMs: 1_500 } })
    const { runtime, host } = context
    try {
      // The prepare command goes through settings, not through the deployment options: that is what makes the launch
      // take time, and a launch that finishes instantly cannot be observed in flight at all.
      runtime.saveSettings(inboxOf(context, { executor: { maxWorkers: 1, prepare: 'a command that takes its time' } }))
      const id = await one(context, 'slow-prepare.md', '做点事')
      await wait(400)

      const stuck = runtime.executor.stuckLaunches(0, Date.now() + 1_000)
      expect(stuck.map(item => item.ticketId)).toContain(id)
      expect(host.calls.spawns.length).toBeGreaterThan(0)
      // One slot, taken by the process that is genuinely still running.
      const before = await context.host.request(api('state'))
      expect((before.json as { counts: { workerSlots: { used: number } } }).counts.workerSlots.used).toBe(1)

      runtime.executor.rescueStuckLaunch(id, stuck.find(item => item.ticketId === id)!.assignmentId)
      // Still visible: a rescue that could not preempt anything must not make the problem disappear, or the Watchdog
      // has no way to notice that its own remedy did not work.
      expect(runtime.executor.stuckLaunches(0, Date.now() + 1_000).map(item => item.ticketId)).toContain(id)
      const after = await context.host.request(api('state'))
      expect((after.json as { counts: { workerSlots: { used: number } } }).counts.workerSlots.used).toBe(1)
    } finally { await runtime.stop() }
  })
})

describe('a worker reading another Ticket’s artifact', () => {
  it('hands back the registered file’s text, and refuses one nobody claimed', async () => {
    const context = await deployment('auto')
    const { runtime } = context
    try {
      const work = runtime.engine.createWork({ name: '同一条工作流' })
      await one(context, 'produces.md', '产出报告的一方')
      await one(context, 'reads.md', '想读报告的一方')
      // Picked apart explicitly, because the `one()` helper answers with the first Ticket in the store: calling it
      // twice and trusting it to mean two different Tickets silently tests a Ticket reading its own artifact.
      const sorted = [...runtime.store.tickets.list()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      const first = sorted[0]!.id
      const second = sorted[1]!.id
      expect(first).not.toBe(second)
      runtime.engine.attachWork(first, work.id)
      runtime.engine.attachWork(second, work.id)

      // A real file in the first Ticket's real directory, claimed by a real report: the registry is what makes it
      // readable, and the directory is what makes the read return bytes rather than a promise.
      const directory = runtime.store.tickets.get(first)!.execution!.directory
      writeFileSync(join(directory, 'report.md'), '# 摘要\n数字是 42。\n', 'utf8')
      writeFileSync(join(directory, 'secrets.env'), 'TOKEN=nope\n', 'utf8')
      runtime.engine.report(first, { state: 'ready', summary: '写好了', files: ['report.md'] })

      const read = await runtime.readArtifact(second, first, 'report.md')
      expect(read).toMatchObject({ ok: true, content: '# 摘要\n数字是 42。\n' })
      // Present on disk, in the same directory, in the same Work — and still refused, because no report claimed it.
      const refused = await runtime.readArtifact(second, first, 'secrets.env')
      expect(refused).toMatchObject({ ok: false, code: 'artifact_missing' })
      // A traversal spelling is refused by the guard rather than resolved, and says so as itself.
      expect(await runtime.readArtifact(second, first, '../report.md')).toMatchObject({ ok: false })
      // Reading your own artifact through this door is refused too: the worker can already read its own directory, and
      // a door that opens onto yourself is a door nobody can audit.
      expect(await runtime.readArtifact(first, first, 'report.md')).toMatchObject({ ok: false, code: 'artifact_missing' })
      // A Ticket in another Work is refused, and the refusal names the boundary rather than the file.
      const stranger = runtime.engine.createTicket({ title: '别的工作流里的一张', text: '做点事' })
      expect(await runtime.readArtifact(stranger.ticketId!, first, 'report.md'))
        .toMatchObject({ ok: false, code: 'collaboration_refused' })
    } finally { await runtime.stop() }
  })
})

describe('artifact catalog discovery and workspace materialization for VM compatibility (E1)', () => {
  it('lists accessible Tickets and their registered artifacts when path is omitted, and materializes a safe local copy under inputs/', async () => {
    const context = await deployment('auto')
    const { runtime } = context
    try {
      await one(context, 'producer.md', '产出数据表')
      await one(context, 'consumer.md', '使用数据表')
      const sorted = [...runtime.store.tickets.list()].sort((x, y) => x.createdAt.localeCompare(y.createdAt))
      const producer = sorted[0]!.id
      const consumer = sorted[1]!.id
      const prodDir = runtime.store.tickets.get(producer)!.execution!.directory
      const consDir = runtime.store.tickets.get(consumer)!.execution!.directory
      mkdirSync(join(prodDir, 'data'), { recursive: true })
      writeFileSync(join(prodDir, 'data', 'companies.csv'), 'name,round\nDeepSeek,A\n', 'utf8')
      runtime.engine.report(producer, { state: 'ready', summary: '产出公司表', files: ['data/companies.csv'] })

      // 1. Catalog discovery (no target or no path)
      const catalog = await runtime.readArtifact(consumer)
      expect(catalog).toMatchObject({
        ok: true,
        catalog: [expect.objectContaining({
          ticket_id: producer,
          artifacts: [expect.objectContaining({ path: 'data/companies.csv' })],
        })],
      })

      // 2. Materialize into consumer's own `inputs/<ticket_id>/data/companies.csv`
      // 【P-3 产品变更】旧断言：materialized_to/localCopy 用 `producer.slice(0, 8)`（8 位前缀目录）。
      // 理由：前缀目录意味着两张前缀相同的任务**静默共享**一个 inputs/ 目录——没有任何错误，只有悄悄混在一起
      // 的数据；而 worker.md 从头到尾写的都是 `inputs/<ticket_id>`，这次是实现向文档兑现。
      const mat = await runtime.readArtifact(consumer, producer, 'data/companies.csv', true)
      expect(mat).toMatchObject({
        ok: true,
        materialized_to: join('inputs', producer, 'data', 'companies.csv'),
      })
      const localCopy = join(consDir, 'inputs', producer, 'data', 'companies.csv')
      expect(existsSync(localCopy)).toBe(true)
      expect(readFileSync(localCopy, 'utf8')).toBe('name,round\nDeepSeek,A\n')
      // Both sides recorded lineage
      expect(runtime.engine.citationsOf(producer).citedBy).toContain(consumer)
      expect(runtime.engine.citationsOf(consumer).cites).toContain(producer)
    } finally { await runtime.stop() }
  })
})

describe('the artifact catalog a worker browses is bounded and newest-first', () => {
  /** Register `files` on a fresh Ticket and end it, so its artifacts are readable through the audited door. */
  const published = (runtime: Deployment['runtime'], title: string, files: string[], summary = '产出了这些'): string => {
    const id = runtime.engine.createTicket({ title, text: `请产出 ${title}` }).ticketId!
    runtime.engine.assignmentStarted(id, runtime.engine.require(id).assignments[0]!.id)
    runtime.engine.report(id, { state: 'ready', summary, files })
    return id
  }

  it('answers newest first, cuts at the ticket cap, and says that it cut', async () => {
    const context = await deployment('auto')
    const { runtime } = context
    try {
      // More Tickets than the cap, each with one registered artifact so the browse case keeps them.
      for (let index = 0; index < 55; index++) published(runtime, `资料 ${index}`, [`data/f${index}.csv`])
      const viewer = runtime.engine.createTicket({ title: '要浏览目录的', text: '看看有什么可用' }).ticketId!
      const read = await runtime.readArtifact(viewer)
      if (!('catalog' in read)) throw new Error(`expected a catalog, got ${JSON.stringify(read).slice(0, 120)}`)
      expect(read.ok).toBe(true)
      expect(read.total).toBe(55)
      expect(read.truncated).toBe(true)
      expect(read.catalog).toHaveLength(50)
      // `store.tickets.list()` is ORDER BY createdAt, i.e. OLDEST first — the least useful end of a long-lived
      // deployment. Whatever is cut has to be the old end, not the new one.
      // `list()` includes the viewer itself, which the catalog excludes, so the expected newest is the last of the
      // OTHERS. (Asserting against `list().at(-1)` compares the catalog to the viewer and can never pass.)
      const oldestFirst = runtime.store.tickets.list().map(item => item.id).filter(id => id !== viewer)
      expect(oldestFirst).toHaveLength(55)
      expect(read.catalog[0]!.ticket_id).toBe(oldestFirst.at(-1)!)
      expect(read.catalog[0]!.ticket_id).not.toBe(oldestFirst[0]!)
      expect(read.catalog.every(entry => entry.ticket_id !== viewer)).toBe(true)
    } finally { await runtime.stop() }
  })

  it('caps each entry at 20 artifacts and a 160-character summary, and answers a named Ticket that registered nothing', async () => {
    const context = await deployment('auto')
    const { runtime } = context
    try {
      const files = Array.from({ length: 25 }, (_, index) => `data/part-${index}.csv`)
      const producer = published(runtime, '产出很多的一份', files, 'x'.repeat(5000))
      const viewer = runtime.engine.createTicket({ title: '要浏览目录的', text: '看看有什么可用' }).ticketId!
      const read = await runtime.readArtifact(viewer, producer)
      if (!('catalog' in read)) throw new Error('expected a catalog')
      const entry = read.catalog[0]!
      expect(entry.ticket_id).toBe(producer)
      expect(entry.artifacts).toHaveLength(20)
      // A short list must not read as a complete one.
      expect(entry.artifacts_total).toBe(25)
      expect(entry.summary!.length).toBeLessThanOrEqual(160)
      expect(read.truncated).toBe(false)

      // A NAMED target that registered nothing still answers, so a worker can tell "that Ticket claimed no files"
      // from "I got the id wrong"; in the browse case the same entry would be pure noise, so it is dropped.
      const empty = runtime.engine.createTicket({ title: '什么都没产出', text: '空跑一趟' }).ticketId!
      const named = await runtime.readArtifact(viewer, empty)
      if (!('catalog' in named)) throw new Error('expected a catalog')
      expect(named.catalog[0]).toMatchObject({ ticket_id: empty, no_artifacts: true, artifacts: [] })
      const browse = await runtime.readArtifact(viewer)
      if (!('catalog' in browse)) throw new Error('expected a catalog')
      expect(browse.catalog.some(item => item.ticket_id === empty)).toBe(false)
    } finally { await runtime.stop() }
  })

  it('refuses an artifact over the materialize cap, and refuses it BEFORE copying a byte', async () => {
    const context = await deployment('auto')
    const { runtime } = context
    try {
      const viewer = runtime.engine.createTicket({ title: '要物化的', text: '把大文件搬进来' }).ticketId!
      const producer = runtime.engine.createTicket({ title: '产出大文件的', text: '产出一个大文件' }).ticketId!
      const producerDir = runtime.engine.require(producer).execution!.directory
      mkdirSync(join(producerDir, 'data'), { recursive: true })
      // Sparse, so this costs no disk: only the SIZE is being tested, and the size is what the guard reads.
      // `truncateSync` extends an existing file and does not create one, so the empty file comes first.
      const huge = join(producerDir, 'data', 'huge.csv')
      writeFileSync(huge, '', 'utf8')
      truncateSync(huge, 65 * 1024 * 1024)
      runtime.engine.assignmentStarted(producer, runtime.engine.require(producer).assignments[0]!.id)
      runtime.engine.report(producer, { state: 'ready', summary: '产出了一个大文件', files: ['data/huge.csv'] })

      const read = await runtime.readArtifact(viewer, producer, 'data/huge.csv', true)
      expect(read.ok).toBe(false)
      if (read.ok) throw new Error('expected a refusal')
      expect(read.error).toContain('over the')
      // The point of measuring first: the old order copied the file and then discovered its size, so a refusal left a
      // 65 MB orphan in the workspace — and the worker, told only that the read failed, would likely try again.
      const target = join(runtime.engine.require(viewer).execution!.directory, 'inputs', producer, 'data', 'huge.csv')
      expect(existsSync(target)).toBe(false)
      // A refused read also leaves no lineage: see `Engine.recordArtifactRead`.
      expect(runtime.engine.citationsOf(producer).citedBy).not.toContain(viewer)
    } finally { await runtime.stop() }
  })

  it('refuses a copy that would take inputs/ over the TOTAL quota, before copying, and says both numbers (P-2)', async () => {
    const context = await deployment('auto')
    const { runtime } = context
    try {
      const viewer = runtime.engine.createTicket({ title: '快装满的', text: '再搬一个进来' }).ticketId!
      const producer = runtime.engine.createTicket({ title: '产出补充文件的', text: '产出一个文件' }).ticketId!
      const viewerDir = runtime.engine.require(viewer).execution!.directory
      const producerDir = runtime.engine.require(producer).execution!.directory
      // 预填 500MB（稀疏文件，不占真实磁盘）：单文件上限（64MB）挡不住它，总配额（512MB）才挡得住——
      // 这正是 P-2 存在的理由：每一次拷贝都合法，总和却没人预算过。
      const fillerDir = join(viewerDir, 'inputs', 'filler')
      mkdirSync(fillerDir, { recursive: true })
      const filler = join(fillerDir, 'old.bin')
      writeFileSync(filler, '', 'utf8')
      truncateSync(filler, 500 * 1024 * 1024)
      mkdirSync(join(producerDir, 'data'), { recursive: true })
      const extra = join(producerDir, 'data', 'more.bin')
      writeFileSync(extra, '', 'utf8')
      truncateSync(extra, 20 * 1024 * 1024)
      runtime.engine.assignmentStarted(producer, runtime.engine.require(producer).assignments[0]!.id)
      runtime.engine.report(producer, { state: 'ready', summary: '产出了补充文件', files: ['data/more.bin'] })

      const read = await runtime.readArtifact(viewer, producer, 'data/more.bin', true)
      expect(read.ok).toBe(false)
      if (read.ok) throw new Error('expected a refusal')
      // 两个数字都在错误里：worker 得知道"已经有多少"和"上限是多少"才能决定下一步。
      expect(read.error).toContain('together over')
      expect(read.error).toContain('536870912')
      // 先量后拷：拒绝之后 inputs/ 里没有这次拷贝的孤儿。
      expect(existsSync(join(viewerDir, 'inputs', producer, 'data', 'more.bin'))).toBe(false)
      // 拒绝不产生血缘。
      expect(runtime.engine.citationsOf(producer).citedBy).not.toContain(viewer)
    } finally { await runtime.stop() }
  })
})

describe('LocalHostSandbox 的 G-3 新接口方法（站点 1/2/3）', () => {
  it('deliverAttachment puts verified bytes under attachments/, creating the directory lazily', async () => {
    const root = tempDir('myagent-sb3-')
    const workspace = join(root, 'ws')
    await new LocalHostSandbox().deliverAttachment(workspace, 'data.csv', Buffer.from('a,b\n1,2\n'))
    expect(readFileSync(join(workspace, 'attachments', 'data.csv'), 'utf8')).toBe('a,b\n1,2\n')
  })

  it('writeWorkspaceFile writes the text, and refuses a path that escapes the workspace', async () => {
    const root = tempDir('myagent-sb4-')
    const workspace = join(root, 'ws')
    // 生产语义原样保留：写 RESULT.md 不隐式建目录（目录该由 launch 的 prepareWorkspace 建好；
    // 缺目录的写入失败由 delivery 捕获并上健康板——REPLY-UNDELIVERED 那侧才自己 mkdir，理由在它的注释里）。
    mkdirSync(workspace, { recursive: true })
    const sandbox = new LocalHostSandbox()
    await sandbox.writeWorkspaceFile(workspace, 'RESULT.md', '# done\n')
    expect(readFileSync(join(workspace, 'RESULT.md'), 'utf8')).toBe('# done\n')
    // 接口是通用的，守卫就不能指望每个调用方都传常量名——带 ../ 的名字必须被拒绝而不是写出工作区。
    await expect(sandbox.writeWorkspaceFile(workspace, '../escape.md', 'x')).rejects.toThrow(/outside the workspace/)
  })

  it('removeWorkspace removes the tree, and an absent directory is fine (force)', async () => {
    const root = tempDir('myagent-sb5-')
    const workspace = join(root, 'ws')
    mkdirSync(join(workspace, 'nested'), { recursive: true })
    writeFileSync(join(workspace, 'nested', 'deep.txt'), 'x', 'utf8')
    await new LocalHostSandbox().removeWorkspace(workspace)
    expect(existsSync(workspace)).toBe(false)
    // 幂等：删一个不存在目录不是错误（runtime 的 force 语义原样保留）。
    await new LocalHostSandbox().removeWorkspace(workspace)
  })
})

describe('LocalHostSandbox.materializeInput refuses what it cannot do safely', () => {
  it('rejects a traversal instead of rewriting it, rejects a symlinked destination, never clobbers a different file, and is idempotent for the same one', async () => {
    const root = tempDir('myagent-sandbox-')
    const workspace = join(root, 'ws')
    const sourceDir = join(root, 'src')
    const outside = join(root, 'outside')
    for (const directory of [workspace, sourceDir, outside]) mkdirSync(directory, { recursive: true })
    const source = join(sourceDir, 'table.csv')
    writeFileSync(source, 'a,b\n1,2\n', 'utf8')
    const sandbox = new LocalHostSandbox()

    // 1. Rejected, not rewritten. Stripping a leading `../` or `/` before the containment check turned the two most
    //    common escapes into legal paths inside inputs/, leaving the guard to catch only a mid-path `data/../../x`.
    for (const escape of ['../escape.csv', '/abs/escape.csv', 'data/../../escape.csv', '']) {
      await expect(sandbox.materializeInput(workspace, source, 'bbbb1111cccc', escape)).rejects.toThrow(/inputs\/|empty destination/)
    }
    expect(existsSync(join(workspace, 'escape.csv'))).toBe(false)
    expect(existsSync(join(root, 'abs'))).toBe(false)

    // 2. A symlink planted in the DESTINATION is refused, so the host never writes outside the workspace on a
    //    worker's behalf. `mkdir(recursive)` is a no-op on an existing segment and `copyFile` follows links.
    const planted = join(workspace, 'inputs', 'bbbb1111')
    mkdirSync(planted, { recursive: true })
    symlinkSync(outside, join(planted, 'data'))
    await expect(sandbox.materializeInput(workspace, source, 'bbbb1111cccc', 'data/table.csv')).rejects.toThrow(/symbolic link/)
    expect(readdirSync(outside)).toEqual([])

    // 3. The normal path still works, and returns a workspace-relative path.
    const relative = await sandbox.materializeInput(workspace, source, 'dddd2222eeee', 'data/table.csv')
    expect(relative).toBe(join('inputs', 'dddd2222eeee', 'data', 'table.csv'))
    expect(readFileSync(join(workspace, relative), 'utf8')).toBe('a,b\n1,2\n')

    // 4. Re-materializing the same artifact is idempotent: a retried Ticket must not fail on its own earlier copy.
    await expect(sandbox.materializeInput(workspace, source, 'dddd2222eeee', 'data/table.csv')).resolves.toBe(relative)

    // 5. A DIFFERENT file at that path is the worker's own and is left alone, with an error that says so — the old
    //    behaviour replaced it and returned ok, indistinguishable from a fresh copy.
    const mine = join(workspace, 'inputs', 'eeee3333', 'mine.csv')
    mkdirSync(dirname(mine), { recursive: true })
    writeFileSync(mine, '我自己的东西', 'utf8')
    await expect(sandbox.materializeInput(workspace, source, 'eeee3333ffff', 'mine.csv')).rejects.toThrow(/different file is already/)
    expect(readFileSync(mine, 'utf8')).toBe('我自己的东西')
  })

  it('names the inputs/ directory by the FULL source Ticket id (P-3)', async () => {
    const root = tempDir('myagent-fullid-')
    const workspace = join(root, 'ws')
    const sourceDir = join(root, 'src')
    for (const directory of [workspace, sourceDir]) mkdirSync(directory, { recursive: true })
    const source = join(sourceDir, 'table.csv')
    writeFileSync(source, 'a,b\n1,2\n', 'utf8')
    const id = 'a1b2c3d4e5f60718293a4b5c6d7e8f90'
    const relative = await new LocalHostSandbox().materializeInput(workspace, source, id, 'data/table.csv')
    expect(relative).toBe(join('inputs', id, 'data', 'table.csv'))
    // 8 位前缀目录不再被创建：前缀目录是静默碰撞的根源（两张前缀相同的任务共享一个目录，谁都不报错）。
    expect(existsSync(join(workspace, 'inputs', id.slice(0, 8)))).toBe(false)
  })

  it('reuses the legacy 8-hex directory when an older build already made one, rather than splitting a source in two', async () => {
    const root = tempDir('myagent-legacy-')
    const workspace = join(root, 'ws')
    const sourceDir = join(root, 'src')
    for (const directory of [workspace, sourceDir]) mkdirSync(directory, { recursive: true })
    const source = join(sourceDir, 'table.csv')
    writeFileSync(source, 'a,b\n1,2\n', 'utf8')
    const id = 'ffff0000eeee1111dddd2222cccc3333'
    const legacy = join(workspace, 'inputs', id.slice(0, 8))
    mkdirSync(legacy, { recursive: true })
    writeFileSync(join(legacy, 'first.csv'), 'a,b\n1,2\n', 'utf8')
    const relative = await new LocalHostSandbox().materializeInput(workspace, source, id, 'second.csv')
    // 同一个来源在一个工作区里只能有一个目录：worker 刚看过的路径不该在下一份文件里变样。
    expect(relative).toBe(join('inputs', id.slice(0, 8), 'second.csv'))
    expect(existsSync(join(workspace, 'inputs', id))).toBe(false)
  })
})

describe('a sandbox this build cannot provide says so instead of pretending', () => {
  it('announces executor.sandbox "vm" on the health board and clears the announcement when it goes back', async () => {
    const context = await deployment('auto')
    const { runtime } = context
    try {
      expect(runtime.health.problems().map(item => item.name)).not.toContain('executor')
      runtime.saveSettings({ acceptMode: 'auto', executor: { sandbox: 'vm' } })
      const problem = runtime.health.problems().find(item => item.name === 'executor')
      expect(problem?.detail).toContain('no VM sandbox')
      expect(problem?.detail).toContain('Set it back to "local"')
      // And it is cleared rather than left to go stale, so the board means what it says.
      runtime.saveSettings({ acceptMode: 'auto', executor: { sandbox: 'local' } })
      expect(runtime.health.problems().map(item => item.name)).not.toContain('executor')
    } finally { await runtime.stop() }
  })
})

describe('where an Input says it came from', () => {
  // The collaboration channel let one Ticket's worker write an Input on another, and both renderings attributed every
  // Input to the operator — the delivery path said "A note from the operator" outright. That made the channel an
  // injection channel: text a model wrote arrived as an instruction from the person who authorized the work.
  it('names the worker that wrote it, and does not claim it came from the operator', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      const work = runtime.engine.createWork({ name: '同一条工作流' })
      await one(context, 'writer.md', '写的一方')
      await one(context, 'reader.md', '读的一方')
      const sorted = [...runtime.store.tickets.list()].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      const writer = sorted[0]!.id
      const reader = sorted[1]!.id
      expect(writer).not.toBe(reader)
      runtime.engine.attachWork(writer, work.id)
      runtime.engine.attachWork(reader, work.id)
      await settle(runtime)

      runtime.engine.noteFromWorker(writer, reader, '报表口径按季度')
      await settle(runtime)
      const followups = host.agents.get(workerId(reader))!.followups.map(item => item.text)
      const delivered = followups.find(text => text.includes('报表口径按季度'))
      expect(delivered).toBeDefined()
      expect(delivered).toContain(`the worker of Ticket ${writer.slice(0, 8)}`)
      expect(delivered).toContain('not from the operator')
      expect(delivered).not.toContain('A note from the operator')
    } finally { await runtime.stop() }
  })

  it('still says the operator wrote it when the operator wrote it', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      const id = await one(context, 'asked.md', '被问的一张')
      await settle(runtime)
      runtime.engine.note(id, '数据在 ~/notes/')
      await settle(runtime)
      const delivered = host.agents.get(workerId(id))!.followups.map(item => item.text)
        .find(text => text.includes('数据在 ~/notes/'))
      expect(delivered).toContain('A note from the operator')
      expect(delivered).not.toContain('not from the operator')
    } finally { await runtime.stop() }
  })
})

describe('changing how often the Watchdog looks', () => {
  // A live acceptance run measured this as NOT fixed even after `settingsChanged()` existed: every path from a settings
  // save to `refresh()` is closed at exactly the moment a re-arm matters, because a watchdog-only change does not move
  // `policyVersion` (so no `policy.changed` event) and no pass completes while a launch awaits its prepare command (so
  // the deferred refresh never runs). The new interval therefore took effect only at the next tick of the OLD grid —
  // 34.7s of detection latency against a 15s threshold, the rescue landing on mountedAt + 7×60s to within 23ms.
  it('takes effect on the save itself, not at the next tick of the old grid', async () => {
    const context = await deployment('auto')
    const { runtime } = context
    try {
      runtime.saveSettings(inboxOf(context, {
        watchdog: { enabled: true, everyMs: 60_000, launchStuckMs: 15_000, maxActions: 2 },
      }))
      expect(runtime.watchdogArmedInterval()).toBe(60_000)
      // The change that used to be invisible: only `everyMs` moves, so nothing else in the system notices it happened.
      runtime.saveSettings(inboxOf(context, {
        watchdog: { enabled: true, everyMs: 10_000, launchStuckMs: 15_000, maxActions: 2 },
      }))
      expect(runtime.watchdogArmedInterval()).toBe(10_000)
      // And saving the same interval again does not push the next look further away.
      runtime.saveSettings(inboxOf(context, {
        watchdog: { enabled: true, everyMs: 10_000, launchStuckMs: 15_000, maxActions: 2 },
      }))
      expect(runtime.watchdogArmedInterval()).toBe(10_000)
    } finally { await runtime.stop() }
  })
})

describe('the worker-slot count after a worker finishes', () => {
  // S38: the health board used to carry a second, stored copy of this number ("1 of 2 worker slots in use"), written
  // only from `launch()`. A live run caught it four minutes stale, in the same snapshot as `workerSlots.used = 0` —
  // contradicting the count a panel shows right next to it. Refreshing it per pass was worse, because the refresh then
  // overwrote a sticky `Prepare failed` on the next quiet pass. Nothing read the sentence, so it is gone and this is
  // the one live source. What must stay true is that the count itself follows reality immediately.
  it('is zero as soon as the worker has reported, and the board carries problems only', async () => {
    const context = await deployment('auto')
    const { runtime } = context
    try {
      const id = await one(context, 'finishes.md', '做点事')
      await settle(runtime)
      const busy = await context.host.request(api('state'))
      expect((busy.json as { counts: { workerSlots: { used: number } } }).counts.workerSlots.used).toBe(1)

      runtime.engine.report(id, { state: 'ready', summary: '写好了' })
      await settle(runtime)
      const view = await context.host.request(api('state'))
      const state = view.json as {
        counts: { workerSlots: { used: number } }
        health: Record<string, { ok: boolean; detail?: string }>
      }
      expect(state.counts.workerSlots.used).toBe(0)
      // The executor's board entry is created lazily, and the sentence that used to create it on every launch is gone,
      // so a healthy run has no entry at all: the executor speaks only when it has something to say. That is the point
      // of the change — an entry whose only job was to repeat a number that `counts.workerSlots` already gives, and
      // that could go stale while doing it, is not worth a line on the board.
      expect(state.health.executor).toBeUndefined()
      // While a failure still gets one, and it stays: a problem here is sticky, which is why a per-pass gauge could
      // not coexist with it.
      expect(state.health.runtime?.ok).toBe(true)
    } finally { await runtime.stop() }
  })
})


describe('B2h stop retry evidence', () => {
  it('serializes same-scope stops so a delayed old failure cannot poison a later success', async () => {
    const context = await deployment('auto', { services: true })
    const { runtime, host } = context
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    try {
      const id = runtime.engine.createTicket({ title: 'serial stop', text: 'work' }).ticketId!
      await settle(runtime)
      const service = (host.ctx as any).get('subagents')
      const get = host.ctx.get.bind(host.ctx)
      vi.spyOn(host.ctx, 'get').mockImplementation((name: string) => name === 'subagents' ? service : get(name as never))
      let calls = 0
      const entered = new Promise<void>(resolve => {
        vi.spyOn(service, 'drainDescendants').mockImplementation(async () => {
          if (++calls === 1) { resolve(); await gate; throw new Error('old stop failed') }
        })
      })
      const first = runtime.executor.halt(id, 'old reason', true).catch(error => error)
      await entered
      const second = runtime.executor.halt(id, 'new reason', true)
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(calls, 'same scope must not run a newer stop ahead of pending failure evidence').toBe(1)
      release()
      expect(await first).toBeInstanceOf(Error)
      await second
      await expect(runtime.executor.drain()).resolves.toBeUndefined()
    } finally { release(); vi.restoreAllMocks(); await runtime.stop() }
  })

  it('retains real old failure while the newer stop is pending or also fails', async () => {
    const context = await deployment('auto', { services: true })
    const { runtime, host } = context
    let release!: () => void
    const gate = new Promise<void>(resolve => { release = resolve })
    try {
      const id = runtime.engine.createTicket({ title: 'failed evidence', text: 'work' }).ticketId!
      await settle(runtime)
      const service = (host.ctx as any).get('subagents')
      const get = host.ctx.get.bind(host.ctx)
      vi.spyOn(host.ctx, 'get').mockImplementation((name: string) => name === 'subagents' ? service : get(name as never))
      let calls = 0
      const entered = new Promise<void>(resolve => {
        vi.spyOn(service, 'drainDescendants').mockImplementation(async () => {
          if (++calls === 2) { resolve(); await gate }
          throw new Error(`failure ${calls}`)
        })
      })
      await expect(runtime.executor.halt(id, 'first', true)).rejects.toThrow()
      const second = runtime.executor.halt(id, 'second', true).catch(error => error)
      await entered
      expect((runtime.executor as any).haltFailures.size).toBeGreaterThan(0)
      release(); await second
      await expect(runtime.executor.drain()).rejects.toThrow(/stop drain failed/)
      vi.restoreAllMocks()
      await runtime.executor.halt(id, 'successful evidence', true)
    } finally { release(); vi.restoreAllMocks(); await runtime.stop() }
  })
})
