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
