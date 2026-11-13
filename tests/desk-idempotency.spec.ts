import { mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { Store } from '../src/app/store.ts'
import { DeskLoop } from '../src/app/desk-loop.ts'
import * as deskTools from '../src/app/desk-tools.ts'
import type { ToolsHost } from '../src/app/tools.ts'
import type { Prompts } from '../src/app/prompts.ts'
import type { Engine } from '../src/core/engine.ts'
import { parseSettings } from '../src/core/policy.ts'

const cfg = parseSettings({ deskLlm: { provider: 'p', model: 'm' } })
const dirs: string[] = []
const stores = new Set<Store>()
afterEach(() => { vi.restoreAllMocks(); for (const store of stores) store.close(); stores.clear(); for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true }) })
function open(path?: string) {
  if (!path) { const dir = mkdtempSync('/tmp/myagent-desk-db-'); dirs.push(dir); path = join(dir, 'state.sqlite') }
  const store = new Store(path); stores.add(store); return { store, path }
}
function close(store: Store) { store.close(); stores.delete(store) }
function fixture(store: Store, generate?: (n: number) => AsyncGenerator<unknown>, engine?: Engine) {
  let calls = 0
  const ctx = { logger: { info() {}, warn() {}, error() {} }, llm: { stream: async function* () {
    calls++; if (generate) yield* generate(calls)
    else { yield { type: 'text-delta', index: 0, text: 'done' }; yield { type: 'finish', reason: { kind: 'stop' } } }
  } } } as unknown as Context
  const loop = new DeskLoop(ctx, store, {} as ToolsHost, { current: () => '' } as unknown as Prompts, () => cfg, engine)
  return { loop, calls: () => calls }
}
const receiptKeys = (store: Store) => store.keys('desk:request:success:')

describe('Desk durable successful request receipts', () => {
  it('shares in-flight work and skips sequential replay without appending', async () => {
    const { store } = open(); const f = fixture(store)
    const first = f.loop.relay('same', 'hello'); const duplicate = f.loop.relay('same', 'hello')
    expect(duplicate).toBe(first); await first
    const before = store.deskHistory.latestSeq(); await f.loop.relay('same', 'hello')
    expect(f.calls()).toBe(1); expect(store.deskHistory.latestSeq()).toBe(before)
    const receipt = store.get<any>(receiptKeys(store)[0]!)
    expect(receipt.version).toBe(1); expect(receipt.fingerprint).toMatch(/^[a-f0-9]{64}$/); expect(Number.isNaN(Date.parse(receipt.completedAt))).toBe(false)
  })

  it('survives real Store close/reopen and history trim for relay and notify', async () => {
    const { store, path } = open(); const f = fixture(store)
    await f.loop.relay('restart', 'hello'); await f.loop.notify('notice', 'news')
    store.deskHistory.append({ role: 'user', content: 'later', at: new Date().toISOString() }); store.deskHistory.trim(1)
    expect(store.deskHistory.since(0).some(m => m.requestId === 'restart')).toBe(false)
    close(store); const reopened = open(path).store; const next = fixture(reopened)
    const seq = reopened.deskHistory.latestSeq(); await next.loop.relay('restart', 'hello'); await next.loop.notify('notice', 'news')
    expect(next.calls()).toBe(0); expect(reopened.deskHistory.latestSeq()).toBe(seq); expect(receiptKeys(reopened)).toHaveLength(2)
  })

  it('rejects concurrent and durable conflicts in text, kind, and ticket identity', async () => {
    const { store } = open(); const f = fixture(store)
    const first = f.loop.relay('conflict', 'a')
    await expect(f.loop.relay('conflict', 'b')).rejects.toThrow(/conflict/i); await first
    await expect(f.loop.notify('conflict', 'a')).rejects.toThrow(/conflict/i)
    await expect(f.loop.relay('conflict', 'a', 'other-ticket')).rejects.toThrow(/conflict/i)
    expect(f.calls()).toBe(1)
  })

  it('registers the Map before synchronous schedule reentry', async () => {
    const { store } = open(); const f = fixture(store)
    const internal = f.loop as any; const schedule = internal.scheduleRun.bind(f.loop)
    let nested: Promise<void> | undefined; let entered = false
    internal.scheduleRun = () => { if (!entered) { entered = true; nested = f.loop.relay('reentry', 'hello') }; schedule() }
    const first = f.loop.relay('reentry', 'hello'); expect(nested).toBe(first); await first; expect(f.calls()).toBe(1)
  })

  it('atomically rolls notify history back when receipt persistence fails, then retries', async () => {
    const { store } = open(); const f = fixture(store); const original = store.set.bind(store)
    const fail = vi.spyOn(store, 'set').mockImplementation((key, value) => { original(key, value); throw new Error('receipt disk failure') })
    await expect(f.loop.notify('atomic-notice', 'news')).rejects.toThrow('receipt disk failure')
    expect(store.deskHistory.since(0)).toHaveLength(0); expect(receiptKeys(store)).toHaveLength(0)
    fail.mockRestore(); await f.loop.notify('atomic-notice', 'news'); await f.loop.notify('atomic-notice', 'news')
    expect(store.deskHistory.since(0)).toHaveLength(1); expect(receiptKeys(store)).toHaveLength(1)
  })

  it.each(['error', 'aborted', 'max-tokens'])('does not stamp a %s finish (legacy caller still resolves), and retries', async reason => {
    const { store } = open(); const f = fixture(store, async function* (n) {
      yield { type: 'text-delta', index: 0, text: 'answer' }; yield { type: 'finish', reason: { kind: n === 1 ? reason : 'stop' } }
    })
    await f.loop.relay('failed-finish', 'hello'); expect(receiptKeys(store)).toHaveLength(0)
    await f.loop.relay('failed-finish', 'hello'); await f.loop.relay('failed-finish', 'hello'); expect(f.calls()).toBe(2)
  })

  it('does not receipt successful-resolution non-stop finishes', async () => {
    const { store } = open(); const f = fixture(store, async function* (n) {
      yield { type: 'text-delta', index: 0, text: 'partial' }
      yield { type: 'finish', reason: { kind: n === 1 ? 'tool-calls' : 'stop' } }
    })
    await f.loop.relay('non-stop', 'hello'); expect(receiptKeys(store)).toHaveLength(0)
    await f.loop.relay('non-stop', 'hello'); await f.loop.relay('non-stop', 'hello'); expect(f.calls()).toBe(2)
  })

  it('retries provider throw and receipt write failure without pretending exactly-once', async () => {
    const { store } = open(); const f = fixture(store, async function* (n) {
      if (n === 1) throw new Error('provider failure')
      yield { type: 'text-delta', index: 0, text: 'done' }; yield { type: 'finish', reason: { kind: 'stop' } }
    })
    await expect(f.loop.relay('retry', 'hello')).rejects.toThrow('provider failure'); expect(receiptKeys(store)).toHaveLength(0)
    const fail = vi.spyOn(store, 'set').mockImplementation(() => { throw new Error('disk failure') })
    await expect(f.loop.relay('retry', 'hello')).rejects.toThrow('disk failure'); expect(receiptKeys(store)).toHaveLength(0)
    fail.mockRestore(); await f.loop.relay('retry', 'hello'); await f.loop.relay('retry', 'hello'); expect(f.calls()).toBe(3)
  })

  it('allows a confirmed retry of the same failed tool action', async () => {
    const { store } = open(); let attempts = 0
    vi.spyOn(deskTools, 'executeDeskToolCalls').mockImplementation(async calls => {
      const call = calls[0]!; attempts++
      return [{ toolCallId: call.id, name: call.name, content: attempts === 1 ? 'temporary failure' : 'done', isError: attempts === 1 }]
    })
    const f = fixture(store, async function* (n) {
      if (n <= 2) yield { type: 'tool-call-delta', index: 0, id: `call-${n}`, name: 'myagent_close_ticket', argumentsDelta: '{"ticketId":"a"}' }
      else yield { type: 'text-delta', index: 0, text: 'done' }
      yield { type: 'finish', reason: { kind: n <= 2 ? 'tool-calls' : 'stop' } }
    })
    await f.loop.relay('repair', 'hello'); await f.loop.relay('repair', 'hello')
    expect(attempts).toBe(2); expect(f.calls()).toBe(3); expect(receiptKeys(store)).toHaveLength(1)
  })

  it('documents the tool-effect-before-receipt crash window by retrying unconfirmed work', async () => {
    const { store } = open(); let sideEffects = 0
    vi.spyOn(deskTools, 'executeDeskToolCalls').mockImplementation(async calls => {
      sideEffects++; const call = calls[0]!
      return [{ toolCallId: call.id, name: call.name, content: 'effect completed', isError: false }]
    })
    const f = fixture(store, async function* (n) {
      if (n % 2 === 1) yield { type: 'tool-call-delta', index: 0, id: `call-${n}`, name: 'myagent_close_ticket', argumentsDelta: '{"ticketId":"a"}' }
      else yield { type: 'text-delta', index: 0, text: 'done' }
      yield { type: 'finish', reason: { kind: n % 2 === 1 ? 'tool-calls' : 'stop' } }
    })
    const fail = vi.spyOn(store, 'set').mockImplementation(() => { throw new Error('crash before receipt commit') })
    await expect(f.loop.relay('window', 'hello')).rejects.toThrow('crash before receipt commit')
    expect(sideEffects).toBe(1); expect(receiptKeys(store)).toHaveLength(0)
    fail.mockRestore(); await f.loop.relay('window', 'hello'); await f.loop.relay('window', 'hello')
    expect(sideEffects).toBe(2); expect(f.calls()).toBe(4)
  })

  it('does not stamp tool round exhaustion and permits retry', async () => {
    const { store } = open(); let exhaust = true
    const f = fixture(store, async function* () {
      if (exhaust) yield { type: 'tool-call-delta', index: 0, id: 'gate', name: 'myagent_use_tools', argumentsDelta: '{}' }
      else yield { type: 'text-delta', index: 0, text: 'done' }
      yield { type: 'finish', reason: { kind: exhaust ? 'tool-calls' : 'stop' } }
    })
    await f.loop.relay('rounds', 'hello'); expect(f.calls()).toBe(10); expect(receiptKeys(store)).toHaveLength(0)
    exhaust = false; await f.loop.relay('rounds', 'hello'); await f.loop.relay('rounds', 'hello'); expect(f.calls()).toBe(11)
  })

  it('does not stamp a final answer after an unresolved tool failure', async () => {
    const { store } = open(); const f = fixture(store, async function* (n) {
      if (n === 1) yield { type: 'tool-call-delta', index: 0, id: 'bad', name: 'unknown_action', argumentsDelta: '{}' }
      else yield { type: 'text-delta', index: 0, text: 'done' }
      yield { type: 'finish', reason: { kind: n === 1 ? 'tool-calls' : 'stop' } }
    })
    await f.loop.relay('tool-error', 'hello'); expect(receiptKeys(store)).toHaveLength(0)
    await f.loop.relay('tool-error', 'hello'); await f.loop.relay('tool-error', 'hello'); expect(f.calls()).toBe(3)
  })

  it('does not stamp failed or empty direct triage settlement; never reopens ended tickets', async () => {
    const { store } = open(); const ticket = { id: 'triage', assignments: [{ id: 'a', role: 'triage', state: 'running' }] }
    vi.spyOn(store.tickets, 'get').mockReturnValue(ticket as any)
    const report = vi.fn<() => void>(() => { throw new Error('settlement failure') })
    const f = fixture(store, undefined, { report } as unknown as Engine)
    await f.loop.relay('settle', 'hello', 'triage'); expect(receiptKeys(store)).toHaveLength(0)
    report.mockImplementation(() => {}); await f.loop.relay('settle', 'hello', 'triage'); expect(receiptKeys(store)).toHaveLength(1)
    const empty = fixture(store, async function* () { yield { type: 'finish', reason: { kind: 'stop' } } }, { report } as unknown as Engine)
    await empty.loop.relay('empty', 'hello', 'triage'); expect(receiptKeys(store)).toHaveLength(1)
    expect(report).toHaveBeenLastCalledWith('triage', expect.objectContaining({ state: 'dropped' }))
    vi.mocked(store.tickets.get).mockReturnValue({ ...ticket, ended: { outcome: 'failed' } } as any)
    const before = f.calls(); await f.loop.relay('terminal', 'hello', 'triage'); expect(f.calls()).toBe(before)
    expect(receiptKeys(store)).toHaveLength(1)
  })
})
