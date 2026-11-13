/**
 * Desk LLM call layer: wraps `ctx.llm.stream()` for the DeskLoop.
 *
 * The DeskLoop sends a full conversation (system + history + new message) plus
 * the tool schemas, and gets back a completed assistant turn: either a text
 * reply, one or more tool calls, or both.  Streaming is consumed internally;
 * callers receive a finished `DeskLlmResponse`.
 *
 * Why ctx.llm and not raw fetch:
 *   - Supports every provider the user configured in DSH (OpenAI, Anthropic,
 *     DeepSeek, any third-party gateway) without adapter code here.
 *   - Retry, timeout, and waterfall are already in the LLM package.
 *   - No API key management here — that lives in DSH's provider config.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { BlockAssembler as BlockAssemblerType, ContentBlock, GenerateOptions, StreamChunk, ToolSchema } from '@deepseek-ai/dsh-llm'
import { BlockAssembler } from '@deepseek-ai/dsh-llm'
import type { DeskMessage, DeskToolCall } from './desk-history.ts'
import type { Settings } from '../core/policy.ts'

// ── types ─────────────────────────────────────────────────────────────────────────────────

export interface DeskLlmResponse {
  /** Text content of the assistant reply (may be empty when the turn is tool-calls-only). */
  text: string
  /** Tool calls the model wants to execute, if any. */
  toolCalls: readonly DeskToolCall[]
  /** Why the stream ended: 'stop' | 'tool_calls' | 'length' | other adapter values. */
  finishReason: string
}

// ── call ──────────────────────────────────────────────────────────────────────────────────

/**
 * Send one LLM request and wait for it to finish.
 * @param ctx     Cordis context carrying the `llm` service.
 * @param cfg     `deskLlm` section from the current settings.
 * @param history Ordered conversation messages (system first, then history, then the new user message).
 * @param tools   Tool schemas to send alongside the request.
 * @param signal  Optional abort signal for cancellation.
 */
export async function deskGenerate(
  ctx: Context,
  cfg: Settings['deskLlm'],
  history: readonly DeskMessage[],
  tools: readonly ToolSchema[],
  signal?: AbortSignal,
): Promise<DeskLlmResponse> {
  if (!cfg.provider || !cfg.model) {
    throw new Error('Desk LLM not configured: set deskLlm.provider and deskLlm.model in settings.')
  }

  // Build the request messages from DeskMessage rows.
  const messages = history.map(toRequestMessage)

  const options: GenerateOptions = {
    provider: cfg.provider,
    model: cfg.model,
    messages,
    tools: tools.length > 0 ? [...tools] : undefined,
    temperature: cfg.temperature,
    maxTokens: cfg.maxTokens,
    // R1-06: forward the caller's AbortSignal to the provider so Runtime.stop can
    // cancel an in-flight LLM call, not merely detect abort after the next chunk.
    ...(signal !== undefined ? { signal } : {}),
  }

  // Collect stream chunks into a finished assistant message.
  const assembler = new BlockAssembler()
  let finishReason: string = 'stop'

  const stream = ctx.llm.stream(options)
  for await (const chunk of stream) {
    if (signal?.aborted) throw new Error('Desk LLM call aborted.')
    processChunk(assembler, chunk)
    if (chunk.type === 'finish') finishReason = chunk.reason as unknown as string
  }

  return assembleResponse(assembler, finishReason)
}

// ── private ───────────────────────────────────────────────────────────────────────────────

function processChunk(assembler: BlockAssemblerType, chunk: StreamChunk): void {
  assembler.push(chunk)
}

function assembleResponse(assembler: BlockAssemblerType, finishReason: string): DeskLlmResponse {
  const blocks = assembler.blocks()
  let text = ''
  const toolCalls: DeskToolCall[] = []

  for (const block of blocks) {
    if (block.type === 'text') {
      text += block.text
    } else if (block.type === 'tool-call') {
      toolCalls.push({ id: block.id, name: block.name, arguments: block.arguments })
    }
    // reasoning blocks are silently accumulated; we don't expose them separately
  }

  return { text: text.trim(), toolCalls, finishReason }
}

/** Convert a DeskMessage row to a DSH RequestMessage. */
function toRequestMessage(msg: DeskMessage): GenerateOptions['messages'][number] {
  switch (msg.role) {
    case 'system':
      return {
        role: 'system',
        content: [{ type: 'text', text: msg.content }],
        source: { kind: 'system-prompt' },
        id: undefined as never,
} as unknown as GenerateOptions['messages'][number]

    case 'user':
      return {
        role: 'user',
        content: [{ type: 'text', text: msg.content }],
} as unknown as GenerateOptions['messages'][number]

    case 'assistant': {
      const content: ContentBlock[] = []
      if (msg.content) content.push({ type: 'text', text: msg.content })
      if (msg.tool_calls) {
        for (const tc of msg.tool_calls) {
          content.push({ type: 'tool-call', id: tc.id as never, name: tc.name, arguments: tc.arguments })
        }
      }
      return {
        role: 'assistant',
        content,
        source: { kind: 'model', model: '', provider: '' },
        id: undefined as never,
      } as GenerateOptions['messages'][number]
    }

    case 'tool':
      return {
        role: 'tool',
        content: [{ type: 'text', text: msg.content }],
        toolCallId: (msg.tool_call_id ?? '') as never,
        source: { kind: 'tool-result', toolCallId: (msg.tool_call_id ?? '') as never },
        id: undefined as never,
      } as unknown as GenerateOptions['messages'][number]
  }
}
