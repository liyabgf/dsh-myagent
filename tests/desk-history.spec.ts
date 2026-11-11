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
