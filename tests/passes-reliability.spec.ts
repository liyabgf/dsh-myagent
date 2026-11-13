import { describe, expect, it, vi } from 'vitest'
import { Passes } from '../src/app/passes.ts'

const deferred = () => {
  let resolve!: () => void
  const promise = new Promise<void>(done => { resolve = done })
  return { promise, resolve }
}

describe('Passes stop', () => {
  it('does not begin extra work after stop during runDue', async () => {
    const gate = deferred()
    const entered = deferred()
    const extra = vi.fn()
    const passes = new Passes({ effects: { runDue: async () => { entered.resolve(); await gate.promise } }, extra: [extra] })
    passes.requestPass()
    await entered.promise
    const stopping = passes.stop()
    gate.resolve()
    await stopping
    expect(extra).not.toHaveBeenCalled()
  })

  it('rejects observably on timeout and skips subsequent extra/store work', async () => {
    const gate = deferred()
    const entered = deferred()
    const extra = vi.fn()
    const passes = new Passes({ effects: { runDue: async () => { entered.resolve(); await gate.promise } }, extra: [extra] })
    passes.requestPass()
    await entered.promise
    await expect(passes.stop(1)).rejects.toThrow(/did not finish/i)
    gate.resolve()
    await Promise.resolve()
    await Promise.resolve()
    expect(extra).not.toHaveBeenCalled()
  })

  it('joins the real pass with Infinity after an observed timeout', async () => {
    const gate = deferred()
    const entered = deferred()
    const passes = new Passes({ effects: { runDue: async () => { entered.resolve(); await gate.promise } } })
    passes.requestPass()
    await entered.promise
    await expect(passes.stop(1)).rejects.toThrow(/did not finish/i)
    let joined = false
    const join = passes.stop(Infinity).then(() => { joined = true })
    await Promise.resolve()
    expect(joined).toBe(false)
    gate.resolve()
    await join
    expect(joined).toBe(true)
  })

  it('stops between extras instead of starting the next Store write', async () => {
    const gate = deferred()
    const entered = deferred()
    const storeWrite = vi.fn()
    const passes = new Passes({ effects: { runDue: async () => {} }, extra: [
      async () => { entered.resolve(); await gate.promise }, storeWrite,
    ] })
    passes.requestPass()
    await entered.promise
    const stopping = passes.stop()
    gate.resolve()
    await stopping
    expect(storeWrite).not.toHaveBeenCalled()
  })

  it('does not start an asked-again pass once stop begins', async () => {
    const gate = deferred()
    const entered = deferred()
    const runDue = vi.fn(async () => { if (runDue.mock.calls.length === 1) { entered.resolve(); await gate.promise } })
    const passes = new Passes({ effects: { runDue } })
    passes.requestPass()
    await entered.promise
    passes.requestPass()
    const stopping = passes.stop()
    gate.resolve()
    await stopping
    expect(runDue).toHaveBeenCalledTimes(1)
  })
})
