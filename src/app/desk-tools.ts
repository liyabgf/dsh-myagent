/**
 * Desk tool bridge: converts myagent's mainTools definitions into DSH ToolSchema objects
 * for ctx.llm.stream(), and executes tool calls returned by the LLM.
 *
 * This replaces the PTC (run_code) mechanism for the desk.  Instead of injecting a JS SDK
 * and asking the model to call it via code, we use the LLM provider's native function-
 * calling protocol, which every major provider supports directly.
 *
 * The execute path calls the same `definition.execute` functions that the PTC path uses —
 * the tools themselves are unchanged.
 */
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type { DeskToolCall } from './desk-history.ts'
import { definitionOf, mainTools, type ToolsHost } from './tools.ts'
import type { Ticket } from '../core/model.ts'

// ── types ─────────────────────────────────────────────────────────────────────────────────

export interface ToolCallResult {
  toolCallId: string
  name: string
  /** JSON-serialisable result, or an error message string. */
  content: string
  isError: boolean
}

// ── schema projection ─────────────────────────────────────────────────────────────────────

/**
 * 【R3】The name of the lightweight gateway tool that mounts the full desk toolset on demand.
 * Exposed so desk-loop.ts can intercept it without a string literal.
 */
export const DESK_GATE_TOOL_NAME = 'myagent_use_tools' as const

/**
 * 【R3】A minimal zero-parameter gateway tool for the first LLM round.
 *
 * Why: passing all 11 management tool schemas on every turn is expensive. Most desk messages
 * (simple questions, notice acknowledgements) need no tools at all — the LLM can answer or
 * acknowledge in one round with no tool call. Only when the LLM decides it needs to query
 * tickets, dispatch work, or ask a clarifying question does it call this gateway, which causes
 * DeskLoop to mount the full toolset for the next round (0 ms, in-memory).
 *
 * Two clean exits on every turn — no dangling triage Ticket, no invented state:
 *   1. No tool call → LLM answered directly. DeskLoop calls settleDirectTriageAnswer() to
 *      close the triage Ticket (if any) via engine.report(ready) and deliver the answer.
 *   2. myagent_use_tools called → full toolset mounted for round+1; LLM uses normal tools.
 */
export function deskGateToolSchema(): ToolSchema {
  return {
    name: DESK_GATE_TOOL_NAME,
    description:
      'Mount the full myagent desk toolset (myagent_list_tickets, myagent_ticket_status, '
      + 'myagent_recall, myagent_create_ticket, myagent_close_ticket, myagent_reply, '
      + 'myagent_note_ticket, myagent_answer_ticket, myagent_stop_ticket, '
      + 'myagent_retry_ticket, myagent_raise_decision). '
      + 'Call this ONLY when you need to query or modify Tickets, dispatch work, ask a '
      + 'clarifying question while keeping a triage Ticket open, or drop a non-request. '
      + 'If you can answer directly from context — a capability question, a greeting, '
      + 'acknowledging a completion notice — write your reply directly WITHOUT calling '
      + 'any tool. For a pending triage Ticket, your direct reply text is automatically '
      + 'delivered to the requester and closes the triage Ticket as ready.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
  }
}

/**
 * Build the ToolSchema array to pass to ctx.llm.stream().
 * Uses the same host that the DSH session path uses, so authorisation rules are identical.
 */
export function deskToolSchemas(host: ToolsHost): readonly ToolSchema[] {
  return mainTools(host).map(tool => {
    const def = definitionOf(tool)
    return { name: def.name, description: def.description, parameters: def.parameters }
  })
}

// ── execution ─────────────────────────────────────────────────────────────────────────────

/**
 * Execute one round of tool calls returned by the LLM.
 * Returns one ToolCallResult per call, in the same order.
 * Never throws — errors are captured into the result's `content` and `isError` flag so the
 * LLM can see what failed and decide what to do next.
 */
export async function executeDeskToolCalls(
  calls: readonly DeskToolCall[],
  host: ToolsHost,
  signal: AbortSignal,
): Promise<readonly ToolCallResult[]> {
  const tools = mainTools(host)
  const byName = new Map(tools.map(t => [t.name, t]))

  const results: ToolCallResult[] = []
  for (const call of calls) {
    const tool = byName.get(call.name)
    if (tool === undefined) {
      results.push({ toolCallId: call.id, name: call.name, content: `Unknown tool: ${call.name}`, isError: true })
      continue
    }
    try {
      let parsed: unknown
      try { parsed = JSON.parse(call.arguments) } catch {
        results.push({ toolCallId: call.id, name: call.name, content: `Could not parse arguments: ${call.arguments}`, isError: true })
        continue
      }
      const def = definitionOf(tool)
      const value = await def.execute(parsed, { signal })
      results.push({ toolCallId: call.id, name: call.name, content: JSON.stringify(value), isError: false })
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      results.push({ toolCallId: call.id, name: call.name, content: msg, isError: true })
    }
  }
  return results
}
