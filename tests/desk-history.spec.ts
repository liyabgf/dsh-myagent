/**
 * DeskHistory: append, dedup, recent, since, latestSeq, setSystem.
 * Uses an in-memory SQLite to run offline (same pattern as store.spec.ts).
 */
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { DeskHistory } from '../src/app/desk-history.ts'

function makeDb(): DatabaseSync {
  const db = new DatabaseSync(':memory:')
  db.exec(`CREATE TABLE desk_messages (
    seq INTEGER PRIMARY KEY AUTOINCREMENT,
    role TEXT NOT NULL, content TEXT NOT NULL,
    tool_calls TEXT, tool_call_id TEXT, name TEXT,
    ticketId TEXT, requestId TEXT, at TEXT NOT NULL
  )`)
  db.exec('CREATE UNIQUE INDEX desk_messages_request ON desk_messages (requestId) WHERE requestId IS NOT NULL')
  return db
}

describe('DeskHistory', () => {
  it('appends and returns a seq', () => {
    const h = new DeskHistory(makeDb())
    const seq = h.append({ role: 'user', content: 'hello', at: '2026-01-01T00:00:00Z' })
    expect(seq).toBeGreaterThan(0)
  })

  it('deduplicates by requestId', () => {
    const h = new DeskHistory(makeDb())
    const s1 = h.append({ role: 'user', content: 'a', requestId: 'req-1', at: '2026-01-01T00:00:00Z' })
    const s2 = h.append({ role: 'user', content: 'b', requestId: 'req-1', at: '2026-01-01T00:00:01Z' })
    expect(s1).toBe(s2)
    expect(h.recent(10).filter(m => m.role !== 'system')).toHaveLength(1)
  })

  it('recent returns system + last N non-system messages', () => {
    const h = new DeskHistory(makeDb())
    h.setSystem('you are desk')
    for (let i = 0; i < 5; i++) h.append({ role: 'user', content: `msg ${i}`, at: '2026-01-01T00:00:00Z' })
    const r = h.recent(3)
    expect(r[0]!.role).toBe('system')
    expect(r[0]!.content).toBe('you are desk')
    // 3 non-system + 1 system
    expect(r).toHaveLength(4)
    expect(r.at(-1)!.content).toBe('msg 4')
  })

  it('since returns messages after a given seq', () => {
    const h = new DeskHistory(makeDb())
    const s1 = h.append({ role: 'user', content: 'a', at: '2026-01-01T00:00:00Z' })
    h.append({ role: 'assistant', content: 'b', at: '2026-01-01T00:00:01Z' })
    const msgs = h.since(s1)
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.content).toBe('b')
  })

  it('latestSeq returns 0 when empty and grows with appends', () => {
    const h = new DeskHistory(makeDb())
    expect(h.latestSeq()).toBe(0)
    h.append({ role: 'user', content: 'x', at: '2026-01-01T00:00:00Z' })
    expect(h.latestSeq()).toBeGreaterThan(0)
  })

  it('setSystem replaces the previous system message', () => {
    const h = new DeskHistory(makeDb())
    h.setSystem('v1')
    h.setSystem('v2')
    const msgs = h.recent(10).filter(m => m.role === 'system')
    expect(msgs).toHaveLength(1)
    expect(msgs[0]!.content).toBe('v2')
  })

  it('stores and retrieves tool_calls on assistant messages', () => {
    const h = new DeskHistory(makeDb())
    const calls = [{ id: 'tc-1', name: 'myagent_list_tickets', arguments: '{}' }]
    h.append({ role: 'assistant', content: '', tool_calls: calls, at: '2026-01-01T00:00:00Z' })
    const r = h.recent(10).filter(m => m.role === 'assistant')
    expect(r[0]!.tool_calls).toEqual(calls)
  })

  it('stores and retrieves tool result with tool_call_id', () => {
    const h = new DeskHistory(makeDb())
    h.append({ role: 'tool', content: '{"ok":true}', tool_call_id: 'tc-1', name: 'myagent_list_tickets', at: '2026-01-01T00:00:00Z' })
    const r = h.recent(10).filter(m => m.role === 'tool')
    expect(r[0]!.tool_call_id).toBe('tc-1')
    expect(r[0]!.name).toBe('myagent_list_tickets')
  })
})

describe('DeskHistory.trim is called by DeskLoop on each successful processEntry', () => {
  it('trim reduces rows above the keep limit', () => {
    const h = new DeskHistory(makeDb())
    // Add 5 non-system messages
    for (let i = 0; i < 5; i++) h.append({ role: 'user', content: `msg ${i}`, at: '2026-01-01T00:00:00Z' })
    expect(h.since(0).length).toBe(5)
    // trim(3) should keep only the 3 most recent
    h.trim(3)
    expect(h.since(0).length).toBe(3)
    // The 3 remaining should be the most recent
    const remaining = h.since(0)
    expect(remaining[0]!.content).toBe('msg 2')
    expect(remaining[2]!.content).toBe('msg 4')
  })

  it('trim does not remove system messages', () => {
    const h = new DeskHistory(makeDb())
    h.setSystem('system prompt')
    for (let i = 0; i < 5; i++) h.append({ role: 'user', content: `msg ${i}`, at: '2026-01-01T00:00:00Z' })
    h.trim(2)  // keep 2 non-system rows
    const all = h.recent(100)
    const system = all.filter(m => m.role === 'system')
    const nonSystem = all.filter(m => m.role !== 'system')
    expect(system).toHaveLength(1)  // system always preserved
    expect(nonSystem).toHaveLength(2)
  })

  it('trim is idempotent when rows are within the limit', () => {
    const h = new DeskHistory(makeDb())
    h.append({ role: 'user', content: 'only one', at: '2026-01-01T00:00:00Z' })
    h.trim(100)
    expect(h.since(0).length).toBe(1)
  })
})

/**
 * 【R3】DeskLoop on-demand tool mounting and direct triage answer settlement.
 *
 * Key invariants:
 * 1. First round exposes only the gateway tool (myagent_use_tools) — not 11 full schemas.
 * 2. When LLM answers directly (no tool calls), engine.report(ready) is called to settle the triage Ticket.
 * 3. When LLM calls myagent_use_tools, the next round exposes all 11 management tools.
 */
describe('DeskLoop R3: on-demand tool mounting and direct triage answer settlement', () => {
  function makeStore(ticketRecord?: object): import('../src/app/store.ts').Store {
    const db = makeDb()
    // Minimal stub for store — DeskLoop only needs deskHistory, tickets.get, events.list
    return {
      deskHistory: new DeskHistory(db),
      tickets: {
        get: (id: string) => ticketRecord && (ticketRecord as { id: string }).id === id ? ticketRecord : undefined,
      },
      events: { list: (_id: string) => [] },
    } as unknown as import('../src/app/store.ts').Store
  }

  it('first round passes only 1 tool (the gateway) to the LLM', async () => {
    const seenCounts: number[] = []
    const ctx = {
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      llm: {
        stream: async function* (opts: { tools?: unknown[] }) {
          seenCounts.push(opts.tools?.length ?? 0)
          yield { type: 'text-delta', index: 0, text: '你好，我可以帮你。' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
    } as unknown as import('@deepseek-ai/cordis').Context

    const prompts = { current: () => '' } as unknown as import('../src/app/prompts.ts').Prompts
    const loop = new (await import('../src/app/desk-loop.ts')).DeskLoop(
      ctx, makeStore(), {} as import('../src/app/tools.ts').ToolsHost, prompts,
      () => ({ deskLlm: { provider: 'p', model: 'm' } } as import('../src/core/policy.ts').Settings),
    )
    await loop.relay('req-1', 'hello')
    expect(seenCounts[0], '首轮必须只挂载 1 个轻量网关工具').toBe(1)
  })

  it('direct text reply closes a running triage Assignment via engine.report(ready)', async () => {
    const reports: { state: string; summary: string }[] = []
    const engine = { report: (_id: string, r: { state: string; summary: string }) => { reports.push(r) } }
    const ctx = {
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      llm: {
        stream: async function* () {
          yield { type: 'text-delta', index: 0, text: '纽约现在是晴天，气温 18°C。' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
    } as unknown as import('@deepseek-ai/cordis').Context

    const triageTicket = {
      id: 'triage-t1', title: '天气查询',
      assignments: [{ id: 'a-1', state: 'running', role: 'triage', startedAt: '2026-11-13T00:00:00Z' }],
      inputs: [], notes: [], attachments: [],
    }
    const store = makeStore(triageTicket)
    const prompts = { current: () => '' } as unknown as import('../src/app/prompts.ts').Prompts
    const loop = new (await import('../src/app/desk-loop.ts')).DeskLoop(
      ctx, store, {} as import('../src/app/tools.ts').ToolsHost, prompts,
      () => ({ deskLlm: { provider: 'p', model: 'm' } } as import('../src/core/policy.ts').Settings),
      engine as unknown as import('../src/core/engine.ts').Engine,
    )
    await loop.relay('req-2', '现在纽约天气怎么样', 'triage-t1')
    expect(reports, '直答后必须调用 engine.report(ready) 结案分诊单').toHaveLength(1)
    expect(reports[0]!.state).toBe('ready')
    expect(reports[0]!.summary).toBe('纽约现在是晴天，气温 18°C。')
  })
})
