/** Audit probes: assert observed defects; these are not regression acceptance tests. */
import { DatabaseSync } from 'node:sqlite'
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, it, expect } from 'vitest'
import { DeskLoop } from '../src/app/desk-loop.ts'
import { DeskHistory } from '../src/app/desk-history.ts'
import { deskGenerate } from '../src/app/desk-llm.ts'
import { LocalHostSandbox } from '../src/app/executor.ts'
import { Runtime } from '../src/app/runtime.ts'
import { Memory } from '../src/core/memory.ts'
import { Store as RealStore, KV } from '../src/app/store.ts'
import { Prompts as RealPrompts } from '../src/app/prompts.ts'
import { takeLock } from '../src/app/lock.ts'
import type { Context } from '@deepseek-ai/cordis'
import type { Store } from '../src/app/store.ts'
import type { Engine } from '../src/core/engine.ts'
import type { ToolsHost } from '../src/app/tools.ts'
import type { Prompts } from '../src/app/prompts.ts'
import { parseSettings } from '../src/core/policy.ts'

const cfg = parseSettings({ deskLlm: { provider: 'p', model: 'm' } })
function fixture(stream: (...args: any[]) => any, ticket: any = undefined, events: any[] = []) {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE desk_messages(seq INTEGER PRIMARY KEY AUTOINCREMENT, role TEXT NOT NULL,
    content TEXT NOT NULL, tool_calls TEXT, tool_call_id TEXT, name TEXT, ticketId TEXT, requestId TEXT, at TEXT NOT NULL)`)
  const history = new DeskHistory(db)
  const reports: any[] = []
  const ctx = { logger: { info() {}, warn() {}, error() {} }, llm: { stream } } as unknown as Context
  const store = { deskHistory: history, tickets: { get: () => ticket }, events: { list: () => events } } as unknown as Store
  const loop = new DeskLoop(ctx, store, {} as ToolsHost, { current: () => '' } as unknown as Prompts,
    () => cfg, { report: (id: string, report: any) => reports.push({ id, ...report }) } as unknown as Engine)
  return { loop, reports, history, ctx, db }
}
const triage = { id: 't', assignments: [{ id: 'a', role: 'triage', state: 'running', startedAt: '2026-01-01T00:00:00Z' }] }

describe('audit38 observed defects (not acceptance)', () => {
  it('CORE01-fix: foreign-host lock is NOT overwritten after C01', () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit38-lock-'))
    writeFileSync(join(dir, 'myagent.lock'), JSON.stringify({ pid: process.pid, host: 'foreign-host', token: 'foreign', at: '2026-01-01' }))
    // C01 fix: foreign-host lock is now conservatively refused, not unlinked
    expect(() => takeLock(dir)).toThrow(/Another myagent holds/)
  })

  it('CORE04-fix: Memory rolls back thread writes same as SQLite after C04', () => {
    const dir = mkdtempSync(join(tmpdir(), 'audit38-tx-'))
    const memory = new Memory()
    const store = new RealStore(join(dir, 'state.sqlite'))
    const thread = { key: 'x', subscriptions: [], contextSubscriptions: [], messages: [] } as any
    for (const repos of [memory, store]) {
      expect(() => repos.atomic(() => { repos.threads.save(thread); throw new Error('rollback') })).toThrow('rollback')
    }
    // C04 fix: Memory now also rolls back threads, so both are undefined
    expect(memory.threads.get('x')).toBeUndefined()
    expect(store.threads.get('x')).toBeUndefined()
    store.close()
  })

  it('SUP01-fix: atomic write wraps config+revision so both succeed or neither does (C05)', () => {
    // This test verifies the structural change: config and revision are now written inside atomic().
    // In production, a Store failure during the second set() rolls back the first via SQLite ROLLBACK.
    // Here we verify the calls happen inside atomic() by counting the atomic invocations.
    const values = new Map<string, unknown>()
    let atomicCalls = 0
    const prompts = new RealPrompts({
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => { values.set(key, value) },
      atomic: (run: () => unknown) => { atomicCalls++; return run() },
    } as any)
    prompts.save({ orchestrator: 'changed' })
    // C05 fix: config and revision are written inside atomic()
    expect(atomicCalls).toBeGreaterThan(0)
    expect(prompts.config().orchestrator).toBe('changed')
    expect(prompts.revision()).toBe(1)
  })

  it('RT01: main-desk recovery does nothing before DeskLoop attachment', () => {
    let interrupted = 0
    const fake = {
      store: { tickets: { open: () => [triage] }, releaseRunning: () => 0 },
      sessions: { hasDeskLoop: () => false }, settings: () => ({ triage: { desk: 'main' }, deskLlm: cfg.deskLlm }),
      engine: { assignmentInterrupted: () => interrupted++ },
      context: { agents: { get: () => undefined }, logger: { info() {} } },
      usesMainDesk: () => true,
    }
    ;(Runtime.prototype as any).recover.call(fake)
    expect(interrupted).toBe(0)
  })

  it('RT07-fix: signal IS forwarded to provider after R1-06', async () => {
    let received: any
    const f = fixture(async function* (options) { received = options; yield { type: 'finish', reason: { kind: 'stop' } } })
    const controller = new AbortController()
    controller.abort()
    await expect(deskGenerate(f.ctx, cfg.deskLlm, [], [], controller.signal)).rejects.toThrow('aborted')
    expect(received.signal).not.toBeUndefined()  // R1-06 fixed: signal is now passed
    f.db.close()
  })

  it('RT08-fix: worker timeout does NOT drop the worker ticket after R1-03', async () => {
    const worker = { id: 'worker-ticket', assignments: [{ state: 'running' }] }
    const f = fixture(() => { throw new Error('timeout') }, worker)
    await expect(f.loop.relay('ask', 'worker question', worker.id)).rejects.toThrow('timeout')
    expect(f.reports).toHaveLength(0)  // R1-03 fixed: worker id is not dropped
    f.db.close()
  })

  it('RT09-fix: prior-turn reply does NOT block settlement in new turn after R1-07', async () => {
    const f = fixture(async function* () {
      yield { type: 'text-delta', index: 0, text: 'The final answer' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }, triage, [{ type: 'replied', at: '2026-01-01T00:01:00Z' }])
    await f.loop.relay('followup', 'requester answered', 't')
    expect(f.reports).toEqual([expect.objectContaining({ state: 'ready', summary: 'The final answer' })])  // R1-07 fixed
    f.db.close()
  })

  it('RT10: repeated requestId dedupes row but executes the LLM turn again', async () => {
    let calls = 0
    const f = fixture(async function* () {
      calls++
      yield { type: 'text-delta', index: 0, text: 'ok' }
      yield { type: 'finish', reason: { kind: 'stop' } }
    })
    await f.loop.relay('same', 'hello')
    await f.loop.relay('same', 'hello')
    expect(f.history.since(0).filter(x => x.role === 'user')).toHaveLength(1)
    expect(calls).toBe(2)
    f.db.close()
  })

  it('RT11-fix: provider terminal error with partial text is reported as failed after R1-04', async () => {
    const f = fixture(async function* () {
      yield { type: 'text-delta', index: 0, text: 'partial incomplete answer' }
      yield { type: 'finish', reason: { kind: 'error', failure: { code: 'UPSTREAM', message: 'failed' } } }
    }, triage)
    await f.loop.relay('provider-error', 'question', 't')
    // R1-04 fix: error finish is now reported as 'failed', not 'ready'
    expect(f.reports).toEqual([expect.objectContaining({ state: 'failed' })])
    f.db.close()
  })

  it('RT06-fix: same-size different-content artifact is rejected after R2-12', async () => {
    const root = mkdtempSync(join(tmpdir(), 'audit38-artifact-'))
    const workspace = join(root, 'work')
    const source = join(root, 'source')
    const sandbox = new LocalHostSandbox()
    await sandbox.prepareWorkspace(workspace)
    writeFileSync(source, 'AAAA')
    await sandbox.materializeInput(workspace, source, 'ticket-id', 'data.txt')
    writeFileSync(source, 'BBBB')  // same size, different content
    // R2-12 fix: now rejects same-size different-content
    await expect(sandbox.materializeInput(workspace, source, 'ticket-id', 'data.txt')).rejects.toThrow('different content')
  })
})
