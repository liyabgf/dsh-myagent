/**
 * DeskHistory: append, dedup, recent, since, latestSeq, setSystem.
 * Uses an in-memory SQLite to run offline (same pattern as store.spec.ts).
 */
import { DatabaseSync } from 'node:sqlite'
import { describe, expect, it } from 'vitest'
import { DeskHistory } from '../src/app/desk-history.ts'

function receiptStore(): Pick<import('../src/app/store.ts').Store, 'get' | 'set' | 'atomic'> {
  const values = new Map<string, unknown>()
  return {
    get: <T>(key: string) => values.get(key) as T | undefined,
    set: (key: string, value: unknown) => { values.set(key, value) },
    atomic: <T>(run: () => T): T => run(),
  }
}

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

  it('projects a context window without orphan tool results or incomplete tool calls', () => {
    const db = makeDb()
    const h = new DeskHistory(db)
    try {
      h.append({ role: 'assistant', content: 'calling', tool_calls: [{ id: 'pair', name: 'tool', arguments: '{}' }], at: '2026-01-01T00:00:00Z' })
      h.append({ role: 'tool', content: 'done', tool_call_id: 'pair', at: '2026-01-01T00:00:01Z' })
      h.append({ role: 'user', content: 'next', at: '2026-01-01T00:00:02Z' })
      expect(h.recent(2).map(m => m.role)).toEqual(['user'])
      expect(h.recent(3).map(m => m.role)).toEqual(['assistant', 'tool', 'user'])
      h.append({ role: 'assistant', content: 'partial', tool_calls: [{ id: 'missing', name: 'tool', arguments: '{}' }], at: '2026-01-01T00:00:03Z' })
      expect(h.recent(4).some(m => m.tool_calls?.some(call => call.id === 'missing'))).toBe(false)
      expect(h.since(0).at(-1)?.tool_calls?.[0]?.id).toBe('missing') // audit rows stay intact
      h.append({ role: 'user', content: 'interrupted', at: '2026-01-01T00:00:04Z' })
      h.append({ role: 'tool', content: 'late orphan', tool_call_id: 'missing', at: '2026-01-01T00:00:05Z' })
      expect(h.recent(10).some(m => m.tool_call_id === 'missing' || m.tool_calls?.some(c => c.id === 'missing'))).toBe(false)
      h.append({ role: 'assistant', content: '', tool_calls: [
        { id: 'multi-a', name: 'tool', arguments: '{}' }, { id: 'multi-b', name: 'tool', arguments: '{}' },
      ], at: '2026-01-01T00:00:06Z' })
      h.append({ role: 'tool', content: 'only half', tool_call_id: 'multi-a', at: '2026-01-01T00:00:07Z' })
      expect(h.recent(10).some(m => m.tool_call_id === 'multi-a' || m.tool_calls?.some(c => c.id === 'multi-b'))).toBe(false)
    } finally { db.close() }
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
    const r = h.since(0).filter(m => m.role === 'assistant')
    expect(r[0]!.tool_calls).toEqual(calls)
    expect(h.recent(10).filter(m => m.role === 'assistant')).toHaveLength(0) // incomplete call is not a model context
  })

  it('stores and retrieves tool result with tool_call_id', () => {
    const h = new DeskHistory(makeDb())
    h.append({ role: 'tool', content: '{"ok":true}', tool_call_id: 'tc-1', name: 'myagent_list_tickets', at: '2026-01-01T00:00:00Z' })
    const r = h.since(0).filter(m => m.role === 'tool')
    expect(h.recent(10).filter(m => m.role === 'tool')).toHaveLength(0) // orphan stays in audit history only
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
      ...receiptStore(),
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

  it('calling myagent_use_tools mounts all 11 management tools for the next round', async () => {
    const seenCounts: number[] = []
    let round = 0
    const ctx = {
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      llm: {
        stream: async function* (opts: { tools?: { name: string }[] }) {
          seenCounts.push(opts.tools?.length ?? 0)
          round++
          if (round === 1) {
            // Round 0: LLM calls the gateway tool
            yield { type: 'tool-call-delta', index: 0, id: 'tc-gate', name: 'myagent_use_tools', argumentsDelta: '{}' }
            yield { type: 'finish', reason: { kind: 'tool-calls' } }
          } else {
            // Round 1+: LLM sees full toolset, answers
            yield { type: 'text-delta', index: 0, text: '已处理。' }
            yield { type: 'finish', reason: { kind: 'stop' } }
          }
        },
      },
    } as unknown as import('@deepseek-ai/cordis').Context

    const store = makeStore()
    const prompts = { current: () => '' } as unknown as import('../src/app/prompts.ts').Prompts
    const loop = new (await import('../src/app/desk-loop.ts')).DeskLoop(
      ctx, store, {} as import('../src/app/tools.ts').ToolsHost, prompts,
      () => ({ deskLlm: { provider: 'p', model: 'm' } } as import('../src/core/policy.ts').Settings),
    )
    await loop.relay('req-3', '帮我查一下现在有几张票')

    // Round 0 should see 1 tool (gateway), round 1 should see >1 (full toolset)
    expect(seenCounts[0], '首轮必须只有 1 个网关工具').toBe(1)
    expect(seenCounts[1], '调 myagent_use_tools 后必须挂载全套工具').toBeGreaterThan(1)
  })

  it('empty LLM reply drops a running triage Ticket instead of leaving it stuck forever', async () => {
    const reports: { state: string; summary: string }[] = []
    const engine = { report: (_id: string, r: { state: string; summary: string }) => { reports.push(r) } }
    const ctx = {
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      llm: {
        stream: async function* () {
          yield { type: 'text-delta', index: 0, text: '' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
    } as unknown as import('@deepseek-ai/cordis').Context

    const triageTicket = {
      id: 'triage-empty', title: 'test',
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
    await loop.relay('req-empty', 'some question', 'triage-empty')
    expect(reports, '空回复必须触发 engine.report 而非静默返回').toHaveLength(1)
    expect(reports[0]!.state, '空回复应 dropped 而非 ready').toBe('dropped')
  })

  it('P1-2: replied event in this turn blocks settlement; old replied in prior turn does not', async () => {
    const reports: any[] = []
    const triage = {
      id: 't-p12', title: 'triage',
      assignments: [{ id: 'a-1', state: 'running', role: 'triage', startedAt: '2026-01-01T00:00:00Z' }],
      inputs: [], notes: [], attachments: [],
    }
    // A replied event from a PRIOR turn (should not block settlement)
    const oldReplied = { type: 'replied', at: '2026-01-01T00:01:00Z', by: { kind: 'system' } }

    const ctx = {
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      llm: {
        stream: async function* () {
          yield { type: 'text-delta', index: 0, text: 'direct answer' }
          yield { type: 'finish', reason: { kind: 'stop' } }
        },
      },
    } as unknown as import('@deepseek-ai/cordis').Context

    const store = {
      ...receiptStore(),
      deskHistory: new DeskHistory(makeDb()),
      tickets: { get: () => triage },
      events: { list: () => [oldReplied] },   // only old replied, not in this turn
    } as unknown as import('../src/app/store.ts').Store

    const { DeskLoop } = await import('../src/app/desk-loop.ts')
    const prompts = { current: () => '' } as unknown as import('../src/app/prompts.ts').Prompts
    const loop = new DeskLoop(
      ctx, store, {} as import('../src/app/tools.ts').ToolsHost, prompts,
      () => ({ deskLlm: { provider: 'p', model: 'm' } } as import('../src/core/policy.ts').Settings),
      { report: (_id: string, r: any) => reports.push(r) } as unknown as import('../src/core/engine.ts').Engine,
    )

    // Old replied should NOT block — settlement should happen
    await loop.relay('req-p12-a', 'follow-up', 't-p12')
    expect(reports).toHaveLength(1)
    expect(reports[0]!.state).toBe('ready')
    reports.length = 0

    // Now simulate a replied event timestamped AFTER the turn started
    const thisReplied = { type: 'replied', at: '', by: { kind: 'system' } }
    const inTurnContext = {
      ...ctx,
      llm: { stream: async function* () {
        thisReplied.at = new Date().toISOString()
        yield { type: 'text-delta', index: 0, text: 'direct answer' }
        yield { type: 'finish', reason: { kind: 'stop' } }
      } },
    } as unknown as import('@deepseek-ai/cordis').Context
    const store2 = {
      ...receiptStore(),
      deskHistory: new DeskHistory(makeDb()),
      tickets: { get: () => triage },
      events: { list: () => [thisReplied] },  // in-turn replied
    } as unknown as import('../src/app/store.ts').Store

    const loop2 = new DeskLoop(
      inTurnContext, store2, {} as import('../src/app/tools.ts').ToolsHost, prompts,
      () => ({ deskLlm: { provider: 'p', model: 'm' } } as import('../src/core/policy.ts').Settings),
      { report: (_id: string, r: any) => reports.push(r) } as unknown as import('../src/core/engine.ts').Engine,
    )

    // In-turn replied SHOULD block — no report
    await loop2.relay('req-p12-b', 'question', 't-p12')
    expect(reports, 'in-turn replied should block settlement').toHaveLength(0)
    await loop.stop().catch(() => {})
    await loop2.stop().catch(() => {})
  })

  it('P1-1: stop() is async and awaits the in-flight turn', async () => {
    let release!: () => void
    let started!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    const running = new Promise<void>(resolve => { started = resolve })
    const db = makeDb()
    const store = {
      ...receiptStore(),
      deskHistory: new DeskHistory(db),
      tickets: { get: () => undefined },
      events: { list: () => [] },
    } as unknown as import('../src/app/store.ts').Store
    const ctx = {
      logger: { info: () => {}, warn: () => {}, error: () => {} },
      llm: { stream: async function* () { started(); await held; yield { type: 'finish', reason: { kind: 'stop' } } } },
    } as unknown as import('@deepseek-ai/cordis').Context
    const prompts = { current: () => '' } as unknown as import('../src/app/prompts').Prompts
    const { DeskLoop } = await import('../src/app/desk-loop.ts')
    const loop = new DeskLoop(
      ctx, store, {} as import('../src/app/tools.ts').ToolsHost, prompts,
      () => ({ deskLlm: { provider: 'p', model: 'm' } } as import('../src/core/policy.ts').Settings),
    )
    const relay = loop.relay('stop-join', 'question').catch(() => {})
    await running
    let stopped = false
    const stopping = loop.stop().then(() => { stopped = true })
    try {
      await new Promise<void>(resolve => setImmediate(resolve))
      expect(stopped).toBe(false)
      release()
      await stopping
      await relay
      expect(stopped).toBe(true)
    } finally {
      release()
      await stopping
      await relay
      db.close()
    }
  })
})
