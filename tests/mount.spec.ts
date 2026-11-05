/**
 * Mounting: what a bundle is allowed to do to a host while it activates.
 *
 * These cases exist because a first installation was done the other way round — into a live profile, before any of this
 * was proven. The plugin mounted, created its main Session during activation, and the host's own startup failed for an
 * unrelated reason; tearing that Session down then threw inside the host's disposal chain. The rules below are the fix:
 * mounting touches no Session, `apply` never rejects, and stopping is contained.
 */
import { describe, expect, it } from 'vitest'
import { Config } from '../src/deployment.ts'
import { createRuntime } from '../src/app/runtime.ts'
import { apply } from '../src/index.ts'
import { brokenHost, stubHost } from './helpers/host.ts'
import { tempDir } from './helpers/temp.ts'

const config = (stateDir: string) => Config({ stateDir }) as never
const directory = () => tempDir('myagent-mount-')

describe('mounting', () => {
  it('starts without creating, resolving or decorating a Session', async () => {
    const host = stubHost()
    const runtime = createRuntime(host.ctx, config(directory()))
    await runtime.start()
    try {
      expect(host.calls.sessions).toEqual([])
      expect(host.calls.renames).toBe(0)
      expect(runtime.setupProblem()).toBeUndefined()
      expect(runtime.mainSession()).toEqual({ exists: false, running: false, busy: false, id: 'myagent-main' })
      // The routes and the listeners are what mounting does register.
      expect(host.calls.routes).toContain('/myagent')
      expect(host.calls.listeners).toContain('agent/status')
      expect(host.calls.listeners).toContain('agent/disposed')
      expect(runtime.health.problems()).toEqual([])
      // A mount runs no subprocess either: no prepare command, no notification.
      expect(host.calls.spawns).toEqual([])
    } finally { await runtime.stop() }
  })

  it('creates the main Session only when somebody asks for it', async () => {
    const host = stubHost()
    const runtime = createRuntime(host.ctx, config(directory()))
    await runtime.start()
    try {
      expect(host.calls.sessions).toEqual([])
      const created = await runtime.createMainSession()
      expect(created.sessionId).toBe('myagent-main')
      expect(created.error).toBeUndefined()
      expect(host.calls.sessions).toEqual(['myagent-main'])
      expect(runtime.mainSession()).toEqual({ exists: true, running: true, busy: false, id: 'myagent-main' })
      // Creating it twice hands back the same Session instead of making a second one.
      expect((await runtime.createMainSession()).sessionId).toBe('myagent-main')
      expect(host.calls.sessions).toEqual(['myagent-main'])
      // The front desk gets the management tools, and none of a worker's limits.
      const names = host.tools.filter(tool => tool.agentId === 'myagent-main').map(tool => tool.definition.name)
      expect(names).toContain('myagent_create_ticket')
      expect(names).toContain('myagent_answer_ticket')
      expect(names).not.toContain('myagent_report')
      expect(host.restrictions).toEqual([])
    } finally { await runtime.stop() }
  })

  it('reports a main Session it cannot create instead of throwing it at the host', async () => {
    const host = stubHost({ resolve: false })
    const runtime = createRuntime(host.ctx, config(directory()))
    await runtime.start()
    try {
      // This host creates the Session but never hands an agent back, which is how a broken startup looks.
      const created = await runtime.createMainSession()
      expect(created.error).toBeTruthy()
      expect(created.sessionId).toBeUndefined()
      expect(runtime.setupProblem()).toBeUndefined()
    } finally { await runtime.stop() }
  })

  it('stops twice, and gives the state directory up so the next start takes it', async () => {
    const path = directory()
    const first = createRuntime(stubHost().ctx, config(path))
    await first.start()
    await first.stop()
    await first.stop()
    const second = createRuntime(stubHost().ctx, config(path))
    await second.start()
    await second.stop()
  })
})

describe('apply', () => {
  it('never rejects, so a bundle that cannot start does not take the host down', async () => {
    await expect(apply(brokenHost(), config(directory()))).resolves.toBeUndefined()
  })

  it('mounts on a usable host and leaves it running', async () => {
    const host = stubHost()
    await apply(host.ctx, config(directory()))
    expect(host.calls.routes).toContain('/myagent')
    expect(host.calls.sessions).toEqual([])
    await host.dispose()
  })

  it('refuses a second deployment over the same state directory, and says so plainly', async () => {
    const path = directory()
    const first = stubHost()
    await apply(first.ctx, config(path))
    // One writer per state directory: the second mount logs and returns rather than double-running the work.
    const second = stubHost()
    await expect(apply(second.ctx, config(path))).resolves.toBeUndefined()
    expect(second.calls.routes).toEqual([])
    await first.dispose()
    // With the first deployment gone, the directory is free again.
    const third = stubHost()
    await apply(third.ctx, config(path))
    expect(third.calls.routes).toContain('/myagent')
    await third.dispose()
  })
})
