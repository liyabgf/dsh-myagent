/**
 * Desk conversation history: a durable, append-only log of every message exchanged between
 * the DeskLoop and the LLM, stored in the `desk_messages` table (schema v7).
 *
 * Each row is one LLM message: system / user / assistant / tool.
 * `requestId` deduplicates relay/notify entries — an effect that is retried does not add a
 * second row.  `ticketId` ties each user message to the Ticket that triggered the desk turn.
 *
 * Context-window management: `recent(maxMessages)` returns the last N non-system messages
 * plus the system prompt, oldest first.  The system message is always included regardless of
 * `maxMessages` so the desk never loses its identity.
 */
import type { DatabaseSync } from 'node:sqlite'

// ── types ─────────────────────────────────────────────────────────────────────────────────

export type DeskRole = 'system' | 'user' | 'assistant' | 'tool'

/** One tool call inside an assistant message, as returned by the LLM. */
export interface DeskToolCall {
  id: string
  name: string
  arguments: string   // raw JSON string as the LLM produced it
}

/** A single message row, ready for use as an LLM RequestMessage. */
export interface DeskMessage {
  seq: number
  role: DeskRole
  content: string
  /** Present on assistant messages that contain tool calls. */
  tool_calls?: readonly DeskToolCall[]
  /** Present on tool-result messages. */
  tool_call_id?: string
  /** Tool name on tool-result messages (required by some adapters). */
  name?: string
  ticketId?: string
  requestId?: string
  at: string
}

// ── store ─────────────────────────────────────────────────────────────────────────────────

export class DeskHistory {
  constructor(private readonly db: DatabaseSync) {}

  /**
   * Append one message.  Returns the assigned `seq`.
   * Silently skips if `requestId` is already in the table (dedup).
   */
  append(msg: Omit<DeskMessage, 'seq'>): number {
    const existing = msg.requestId
      ? (this.db.prepare('SELECT seq FROM desk_messages WHERE requestId = ?').get(msg.requestId) as { seq: number } | undefined)
      : undefined
    if (existing !== undefined) return existing.seq
    const result = this.db.prepare(`
      INSERT INTO desk_messages (role, content, tool_calls, tool_call_id, name, ticketId, requestId, at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      msg.role,
      msg.content,
      msg.tool_calls !== undefined ? JSON.stringify(msg.tool_calls) : null,
      msg.tool_call_id ?? null,
      msg.name ?? null,
      msg.ticketId ?? null,
      msg.requestId ?? null,
      msg.at,
    )
    return Number((result as { lastInsertRowid: bigint | number }).lastInsertRowid)
  }

  /**
   * Return up to `maxMessages` most-recent non-system messages, plus the latest system
   * message prepended, oldest first.  Used to build the LLM prompt for each desk turn.
   */
  recent(maxMessages = 40): readonly DeskMessage[] {
    // Most-recent N non-system rows, then we'll prepend the system message.
    const rows = this.db.prepare(`
      SELECT seq, role, content, tool_calls, tool_call_id, name, ticketId, requestId, at
      FROM desk_messages
      WHERE role != 'system'
      ORDER BY seq DESC
      LIMIT ?
    `).all(maxMessages) as unknown as RawRow[]

    const messages: DeskMessage[] = rows.reverse().map(deserialize)

    // Prepend the latest system message (there is usually only one; it is re-written when the
    // orchestrator prompt changes).
    const systemRow = this.db.prepare(`
      SELECT seq, role, content, tool_calls, tool_call_id, name, ticketId, requestId, at
      FROM desk_messages
      WHERE role = 'system'
      ORDER BY seq DESC
      LIMIT 1
    `).get() as unknown as RawRow | undefined

    if (systemRow !== undefined) messages.unshift(deserialize(systemRow))
    return messages
  }

  /** Return messages after `afterSeq`, oldest first (used for panel paging). */
  since(afterSeq: number, limit = 50): readonly DeskMessage[] {
    const rows = this.db.prepare(`
      SELECT seq, role, content, tool_calls, tool_call_id, name, ticketId, requestId, at
      FROM desk_messages
      WHERE seq > ?
      ORDER BY seq ASC
      LIMIT ?
    `).all(afterSeq, limit) as unknown as RawRow[]
    return rows.map(deserialize)
  }

  /** Latest seq written, or 0 when the table is empty.  Used for long-polling. */
  latestSeq(): number {
    const row = this.db.prepare('SELECT MAX(seq) AS s FROM desk_messages').get() as { s: number | null }
    return row.s ?? 0
  }

  /** Update the system message (replace the latest one). */
  setSystem(content: string): void {
    // Remove old system message(s) first; there should only ever be one.
    this.db.prepare("DELETE FROM desk_messages WHERE role = 'system'").run()
    this.append({ role: 'system', content, at: new Date().toISOString() })
  }

  /**
   * Trim the table to `keep` most-recent non-system rows.  Called after each append so the table
   * does not grow without bound over months of operation.  System messages are never trimmed.
   */
  trim(keep = 2000): void {
    const result = this.db.prepare(`
      SELECT seq FROM desk_messages WHERE role != 'system' ORDER BY seq DESC LIMIT 1 OFFSET ?
    `).get(keep - 1) as { seq: number } | undefined
    if (result !== undefined) {
      this.db.prepare("DELETE FROM desk_messages WHERE role != 'system' AND seq <= ?").run(result.seq)
    }
  }
}

// ── private helpers ───────────────────────────────────────────────────────────────────────

interface RawRow {
  seq: number
  role: string
  content: string
  tool_calls: string | null
  tool_call_id: string | null
  name: string | null
  ticketId: string | null
  requestId: string | null
  at: string
}

function deserialize(row: RawRow): DeskMessage {
  const msg: DeskMessage = {
    seq: row.seq,
    role: row.role as DeskRole,
    content: row.content,
    at: row.at,
  }
  if (row.tool_calls !== null) {
    try { msg.tool_calls = JSON.parse(row.tool_calls) } catch { /* corrupted row: skip */ }
  }
  if (row.tool_call_id !== null) msg.tool_call_id = row.tool_call_id
  if (row.name !== null) msg.name = row.name
  if (row.ticketId !== null) msg.ticketId = row.ticketId
  if (row.requestId !== null) msg.requestId = row.requestId
  return msg
}
