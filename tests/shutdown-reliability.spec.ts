import { describe, expect, it, vi } from 'vitest'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DeskLoop } from '../src/app/desk-loop.ts'
import { mainTools } from '../src/app/tools.ts'
import { InboxSource } from '../src/sources/inbox.ts'
import { ChatSource } from '../src/sources/chat.ts'
import { createRuntime } from '../src/app/runtime.ts'
import { Config } from '../src/deployment.ts'
import { stubHost } from './helpers/host.ts'
import { tempDir } from './helpers/temp.ts'
import { SourceRegistry } from '../src/sources/registry.ts'
import type { Source, SourceHost } from '../src/sources/kind.ts'
import { HealthBoard } from '../src/app/health.ts'
import { Engine, Memory, parseSettings, settingsPolicy } from '../src/core/index.ts'

const deferred = <T = void>() => {
  let resolve!: (value: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

function hostHarness() {
  const memory = new Memory()
  const executor = { prepare: (ticket: any) => ticket, start() {}, deliver() {}, stop() {} }
  const delivery = { report() {} }
  const engine = new Engine({ repos: memory, tx: memory, policy: () => settingsPolicy(parseSettings({ acceptMode: 'auto', allowedSenders: ['operator'] })), executor: executor as any, delivery: delivery as any })
  const health = new HealthBoard()
  const host = {
    engine, health, lifetime: new AbortController().signal,
    settings: () => parseSettings({ acceptMode: 'auto', allowedSenders: ['operator'], sources: { inbox: { enabled: true, directory: '/tmp/shutdown-test' }, chat: { enabled: true } } }),
    requestPass() {}, subscribe: () => () => {}, cursor: () => ({ get() {}, set() {} }),
  } as unknown as SourceHost
  return { host, health }
}

describe('shutdown reliability', () => {
  it('joins real direct artifact materialization through its post-await audit write', async () => {
    const runtime = createRuntime(stubHost().ctx, Config({ stateDir: tempDir('myagent-direct-artifact-') }) as never)
    runtime.saveSettings({ acceptMode: 'auto', allowedSenders: ['operator'] })
    const source = runtime.engine.createTicket({ title: 'source', text: 'source' }).ticketId!
    const target = runtime.engine.createTicket({ title: 'target', text: 'target' }).ticketId!
    const producer = runtime.engine.require(target)
    mkdirSync(producer.execution!.directory, { recursive: true })
    writeFileSync(join(producer.execution!.directory, 'data.txt'), 'artifact')
    runtime.store.artifacts.save({ ticketId: target, path: 'data.txt', at: new Date().toISOString() })
    const entered = deferred(); const release = deferred()
    vi.spyOn(runtime.executor.sandbox, 'materializeInput').mockImplementation(async () => { entered.resolve(); await release.promise; return 'inputs/data.txt' })
    const recorded = vi.spyOn(runtime.engine, 'recordArtifactRead')
    const reading = runtime.readArtifact(source, target, 'data.txt', true)
    await entered.promise
    const close = vi.spyOn(runtime.store, 'close')
    const stopping = runtime.stop()
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(close, 'Store must remain open for the real artifact audit write').not.toHaveBeenCalled()
    release.resolve()
    expect(await reading).toMatchObject({ ok: true })
    await stopping
    expect(recorded).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
    await expect(runtime.readArtifact(source)).rejects.toThrow(/clos|stop/i)
  })

  it('joins nested admitted operation after closing begins', async () => {
    const runtime = createRuntime(stubHost().ctx, Config({ stateDir: tempDir('myagent-nested-operation-') }) as never)
    const entered = deferred(); const release = deferred()
    const outer = (runtime as any).runOperation(async () => {
      entered.resolve()
      await release.promise
      return runtime.readArtifact('missing')
    })
    await entered.promise
    const stopping = runtime.stop()
    await new Promise<void>(resolve => setImmediate(resolve))
    release.resolve()
    await expect(outer).resolves.toMatchObject({ ok: false })
    await stopping
  })

  it('joins real direct delete after workspace listing and rejects cached tools after closing', async () => {
    const runtime = createRuntime(stubHost().ctx, Config({ stateDir: tempDir('myagent-direct-delete-') }) as never)
    runtime.saveSettings({ acceptMode: 'auto', allowedSenders: ['operator'] })
    const id = runtime.engine.createTicket({ title: 'remove', text: 'remove' }).ticketId!
    runtime.engine.stopTicket(id, 'done')
    const entered = deferred(); const release = deferred()
    vi.spyOn(runtime.executor.sandbox, 'listWorkspace').mockImplementation(async () => { entered.resolve(); await release.promise; return { count: 0, files: [], truncated: false } })
    const cached = mainTools((runtime as any).toolsHost()).find(tool => tool.name === 'myagent_create_ticket')!
    const deleting = runtime.deleteTicket(id, { assets: 'delete', record: 'tombstone' })
    await entered.promise
    const close = vi.spyOn(runtime.store, 'close')
    const stopping = runtime.stop()
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(close).not.toHaveBeenCalled()
    release.resolve()
    expect(await deleting).toMatchObject({ deleted: id })
    await stopping
    await expect(cached.execute({ title: 'late', request: 'late' }, new AbortController().signal)).rejects.toThrow(/clos|stop/i)
  })

  it.each(['desk-init', 'sources-sync'])('joins startup at %s and never restarts producers after closing', async stage => {
    const runtime = createRuntime(stubHost().ctx, Config({ stateDir: tempDir('myagent-start-stop-') }) as never)
    const entered = deferred(); const release = deferred()
    const init = vi.spyOn(DeskLoop.prototype, 'init')
    const sync = vi.spyOn(runtime.sources, 'sync')
    if (stage === 'desk-init') init.mockImplementationOnce(async function (this: DeskLoop) { entered.resolve(); await release.promise; this.onPromptsChanged() })
    else sync.mockImplementationOnce(async () => { entered.resolve(); await release.promise; runtime.store.set('startup-tail', true) })
    const passStart = vi.spyOn(runtime.passes, 'start')
    const watchdogStart = vi.spyOn((runtime as any).watchdog, 'start')
    const starting = runtime.start()
    await entered.promise
    const close = vi.spyOn(runtime.store, 'close')
    const stopping = runtime.stop()
    await new Promise<void>(resolve => setImmediate(resolve))
    expect(close).not.toHaveBeenCalled()
    release.resolve()
    await Promise.all([starting, stopping])
    expect(passStart).not.toHaveBeenCalled()
    expect(watchdogStart).not.toHaveBeenCalled()
    expect((runtime as any).budgetTimer).toBeUndefined()
    expect(close).toHaveBeenCalledTimes(1)
    await expect(runtime.start()).rejects.toThrow(/clos|stop/i)
    init.mockRestore(); sync.mockRestore()
  })

  it.each(['inbox', 'chat'])('%s stop joins scanning and prevents queued polls from restarting work', async kind => {
    const { host } = hostHarness()
    const scanning = deferred()
    const source = kind === 'inbox' ? new InboxSource(host, '/tmp/unused') : new ChatSource(host)
    const scan = vi.spyOn(source as any, 'scan').mockImplementation(() => scanning.promise)
    const poll = source.poll()
    const queued = source.poll()
    let settled = false
    const stopping = Promise.resolve(source.stop()).then(() => { settled = true })
    await Promise.resolve(); await Promise.resolve()
    expect(settled).toBe(false)
    scanning.resolve()
    await Promise.all([poll, queued, stopping])
    expect(scan).toHaveBeenCalledTimes(1)
    expect((source as any).timer).toBeUndefined()
  })

  it('registry stop joins a pending start and prevents later source starts', async () => {
    const { host } = hostHarness()
    const scanning = deferred()
    const started = deferred()
    let stopped = false
    const source: Source = {
      id: 'inbox', kind: 'inbox', async start() { started.resolve(); await scanning.promise },
      stop() { stopped = true }, status() { return { ok: true } },
    }
    const registry = new SourceRegistry(host, [{ name: 'inbox', create: () => source }])
    const syncing = registry.sync()
    await started.promise
    const stopping = registry.stop()
    scanning.resolve()
    await Promise.all([syncing, stopping])
    expect(stopped).toBe(true)
    expect(registry.status()).toEqual({})
  })

  it('runtime timeout retains DB/lock, retry reuses work, and late completion closes exactly once', async () => {
    vi.useFakeTimers()
    const path = tempDir('myagent-stop-')
    const runtime = createRuntime(stubHost().ctx, Config({ stateDir: path }) as never)
    const pending = deferred()
    const stopSource = vi.spyOn(runtime.sources, 'stop').mockImplementation(async () => { await pending.promise; runtime.store.set('late-shutdown-write', true) })
    const close = vi.spyOn(runtime.store, 'close')
    try {
      const first = runtime.stop()
      const concurrent = runtime.stop()
      const rejected = Promise.all([expect(first).rejects.toThrow(/incomplete/i), expect(concurrent).rejects.toThrow(/incomplete/i)])
      await vi.advanceTimersByTimeAsync(15_000)
      await rejected
      expect(close).not.toHaveBeenCalled()
      expect(() => createRuntime(stubHost().ctx, Config({ stateDir: path }) as never)).toThrow()
      runtime.store.set('still-open', true)
      const retry = runtime.stop()
      pending.resolve()
      await retry
      expect(stopSource).toHaveBeenCalledTimes(1)
      expect(close).toHaveBeenCalledTimes(1)
      const next = createRuntime(stubHost().ctx, Config({ stateDir: path }) as never)
      await next.stop()
    } finally { pending.resolve(); await runtime.stop().catch(() => {}); vi.useRealTimers() }
  })

  it('failed drain and failed close retain resources and retry only failed work', async () => {
    const path = tempDir('myagent-stop-retry-')
    const runtime = createRuntime(stubHost().ctx, Config({ stateDir: path }) as never)
    const stopSource = vi.spyOn(runtime.sources, 'stop').mockRejectedValueOnce(new Error('scan failed')).mockResolvedValue(undefined)
    const stopPass = vi.spyOn(runtime.passes, 'stop')
    const close = vi.spyOn(runtime.store, 'close')
    await expect(runtime.stop()).rejects.toThrow(/Sources:failed/)
    expect(close).not.toHaveBeenCalled()
    let releaseCalls = 0
    const lockRelease = vi.spyOn((runtime as any).lock, 'release').mockImplementation(() => { releaseCalls++ })
    close.mockImplementationOnce(() => { throw new Error('sqlite close failed') })
    await expect(runtime.stop()).rejects.toThrow(/finalization/)
    expect(releaseCalls).toBe(0)
    expect(stopSource).toHaveBeenCalledTimes(2)
    expect(stopPass).toHaveBeenCalledTimes(1)
    await runtime.stop()
    expect(close).toHaveBeenCalledTimes(2)
    expect(releaseCalls).toBe(1)
    expect(lockRelease).toHaveBeenCalledTimes(1)
    expect(stopSource).toHaveBeenCalledTimes(2)
  })

  it('late completion automatically finalizes after caller deadline without an explicit retry', async () => {
    vi.useFakeTimers()
    const runtime = createRuntime(stubHost().ctx, Config({ stateDir: tempDir('myagent-stop-late-') }) as never)
    const pending = deferred()
    vi.spyOn(runtime.sources, 'stop').mockImplementation(async () => { await pending.promise; runtime.store.set('late', 'written') })
    const closed = deferred()
    const realClose = runtime.store.close.bind(runtime.store)
    vi.spyOn(runtime.store, 'close').mockImplementation(() => { realClose(); closed.resolve() })
    const outcome = runtime.stop().then(() => undefined, error => error)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(await outcome).toMatchObject({ name: 'StopIncompleteError' })
    pending.resolve()
    await closed.promise
    await runtime.stop()
    vi.useRealTimers()
  })

  it('HTTP drain includes handlers already entered before unregister', async () => {
    const host = stubHost()
    const runtime = createRuntime(host.ctx, Config({ stateDir: tempDir('myagent-stop-http-') }) as never)
    const pending = deferred()
    const entered = deferred()
    vi.spyOn(runtime, 'createMainSession').mockImplementation(async () => { entered.resolve(); await pending.promise; runtime.store.set('http-tail', true); return {} })
    const request = host.request('/myagent/api/main-session', { method: 'POST' })
    await entered.promise
    const close = vi.spyOn(runtime.store, 'close')
    const stopping = runtime.stop()
    await Promise.resolve()
    expect(close).not.toHaveBeenCalled()
    pending.resolve()
    await Promise.all([request, stopping])
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('Effects drain joins settlement and stops a claimed batch from starting more handlers', async () => {
    const runtime = createRuntime(stubHost().ctx, Config({ stateDir: tempDir('myagent-stop-effects-') }) as never)
    const pending = deferred()
    const entered = deferred()
    const handler = vi.fn(async () => { entered.resolve(); await pending.promise })
    runtime.effects.handle('slow-shutdown', handler)
    runtime.effects.enqueue('slow-shutdown', 'first', {})
    runtime.effects.enqueue('slow-shutdown', 'second', {})
    const pass = runtime.effects.runDue()
    await entered.promise
    const close = vi.spyOn(runtime.store, 'close')
    const stopping = runtime.stop()
    await Promise.resolve()
    expect(close).not.toHaveBeenCalled()
    pending.resolve()
    await Promise.all([pass, stopping])
    expect(handler).toHaveBeenCalledTimes(1)
    expect(close).toHaveBeenCalledTimes(1)
  })

  it('registry does not erase source stop failure or forget the source', async () => {
    const { host } = hostHarness()
    const stopFailure = new Error('stop did not join')
    const source: Source = { id: 'inbox', kind: 'inbox', start() {}, stop() { throw stopFailure }, status() { return { ok: true } } }
    const registry = new SourceRegistry(host, [{ name: 'inbox', create: () => source }])
    await registry.sync()
    await expect(registry.stop()).rejects.toBe(stopFailure)
    expect(registry.source('inbox')).toBe(source)
  })
})


describe('B2h ended stop recovery', () => {
  it('retries an ended ticket once on the next stop attempt and closes only after real success', async () => {
    const host = stubHost({ services: true })
    const path = tempDir('myagent-ended-stop-retry-')
    const runtime = createRuntime(host.ctx, Config({ stateDir: path }) as never)
    runtime.saveSettings({ acceptMode: 'auto', allowedSenders: ['operator'] })
    const id = runtime.engine.createTicket({ title: 'ended cleanup', text: 'work' }).ticketId!
    const assignment = runtime.store.tickets.get(id)!.assignments.at(-1)!
    runtime.engine.assignmentStarted(id, assignment.id)
    const agent = host.spawn(`worker-${id}`, 'running')
    runtime.engine.stopTicket(id, 'ended')
    await runtime.executor.drain()
    const child = host.spawn('retry-ended-child', 'running')
    host.services.children.set(agent.id, [child.id])
    host.services.failDrains.push(child.id)
    const cancel = vi.spyOn(agent, 'cancel')
    await expect(runtime.executor.haltBackground(id, 'original closing cleanup')).rejects.toThrow()
    const close = vi.spyOn(runtime.store, 'close')
    const release = vi.spyOn((runtime as any).lock, 'release')
    try {
      await expect(runtime.stop()).rejects.toThrow(/incomplete/i)
      expect(close).not.toHaveBeenCalled(); expect(release).not.toHaveBeenCalled()
      const failedCalls = host.services.drainedRoots.length
      host.services.failDrains.length = 0
      await runtime.stop()
      expect(host.services.drainedRoots.length).toBe(failedCalls + 1)
      expect(host.agents.has(child.id)).toBe(false)
      expect(cancel).not.toHaveBeenCalled()
      expect(close).toHaveBeenCalledTimes(1); expect(release).toHaveBeenCalledTimes(1)
    } finally { host.services.failDrains.length = 0; await runtime.stop() }
  })
})
