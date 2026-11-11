/**
 * DeskLoop: the myagent desk (总管) driven by ctx.llm instead of a DSH Session/PTC turn.
 *
 * Architecture
 * ────────────
 * Messages arrive from two paths:
 *   - relay: a Ticket that needs a desk decision (triage, blocked, escalation)
 *   - notify: a Ticket outcome the desk should be aware of (ready, failed, dropped)
 *
 * Both are queued.  The loop processes them one at a time, calling ctx.llm.stream() with
 * the conversation history plus the new message.  If the LLM responds with tool calls,
 * the tools are executed and the results fed back to the LLM until it stops asking for
 * tools.  Every exchange is persisted to `store.deskHistory` (schema v7).
 *
 * This replaces `sessions.relay/notify → ensureMaster → DSH Session PTC` for the desk.
 * Worker Sessions are unchanged — they still run through DSH Sessions.
 *
 * Failure handling
 * ────────────────
 * LLM call failures and tool execution errors are recorded in the health board (`desk`).
 * A single failed turn does not crash the loop; the loop retries the next queued message.
 * If `deskLlm.provider` or `deskLlm.model` is empty, `enqueue` accepts messages but the
 * loop emits a health warning and processes nothing until configured.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type { Store } from './store.ts'
import type { ToolsHost } from './tools.ts'
import type { Prompts } from './prompts.ts'
import type { Settings } from '../core/policy.ts'
import type { Engine } from '../core/engine.ts'
import { DeskHistory } from './desk-history.ts'
import { deskGenerate } from './desk-llm.ts'
import { deskToolSchemas, executeDeskToolCalls } from './desk-tools.ts'

// ── constants ─────────────────────────────────────────────────────────────────────────────

/** Max tool-call rounds per desk turn before the loop gives up and treats the last text as the answer. */
const MAX_TOOL_ROUNDS = 10
/** Timeout for a single LLM generation call. */
const LLM_CALL_TIMEOUT_MS = 120_000
/** How long we store the reason behind the last n failures. */
const HEALTH_WINDOW = 5

// ── types ─────────────────────────────────────────────────────────────────────────────────

type MessageKind = 'relay' | 'notify'

interface QueueEntry {
  kind: MessageKind
  requestId: string
  text: string
  ticketId?: string
  resolve: () => void
  reject: (err: unknown) => void
}

export interface DeskStatus {
  state: 'idle' | 'thinking' | 'executing'
  /** Tool being executed right now, when state==='executing'. */
  currentTool?: string
  /** Summary of the last N health events. */
  recentErrors: string[]
  /** Whether the LLM is configured (provider + model set). */
  configured: boolean
  /** Current provider and model. */
  provider: string
  model: string
  /** Wall-clock ms of the last relay() call, for patrol scheduling. */
  lastRelayMs: number
}

// ── DeskLoop ──────────────────────────────────────────────────────────────────────────────

export class DeskLoop {
  private readonly history: DeskHistory
  private readonly queue: QueueEntry[] = []
  private running = false
  private abortController = new AbortController()
  private status: DeskStatus['state'] = 'idle'
  private currentTool: string | undefined = undefined
  private recentErrors: string[] = []
  /** Wall-clock time of the last relay() call, for patrol scheduling. */
  private lastRelayMs = Date.now()

  constructor(
    private readonly ctx: Context,
    private readonly store: Store,
    private readonly toolsHost: ToolsHost,
    private readonly prompts: Prompts,
    private readonly settings: () => Settings,
    private readonly engine?: Engine,
  ) {
    this.history = store.deskHistory
  }

  /** Called at startup: write the current orchestrator system prompt if the history is empty. */
  async init(): Promise<void> {
    const system = this.prompts.current('orchestrator')
    this.history.setSystem(system)
  }

  /** Called when the orchestrator prompt changes (prompt revision incremented). */
  onPromptsChanged(): void {
    const system = this.prompts.current('orchestrator')
    this.history.setSystem(system)
  }

  /**
   * Enqueue a relay message (desk needs to decide something).
   * Returns when the message has been accepted into the queue (not when processed).
   */
  relay(requestId: string, text: string, ticketId?: string): Promise<void> {
    this.lastRelayMs = Date.now()
    return this.enqueue({ kind: 'relay', requestId, text, ticketId })
  }

  /**
   * Enqueue a notify message (desk should be aware of an outcome).
   * Notify messages are saved to history but do NOT wake the loop for a response turn.
   */
  notify(requestId: string, text: string, ticketId?: string): Promise<void> {
    // Notify: just append to history, no LLM turn needed.
    return this.enqueue({ kind: 'notify', requestId, text, ticketId })
  }

  /** Current desk status for the panel and health board. */
  getStatus(): DeskStatus {
    const cfg = this.settings().deskLlm
    return {
      state: this.status,
      currentTool: this.currentTool,
      recentErrors: [...this.recentErrors],
      configured: Boolean(cfg.provider && cfg.model),
      provider: cfg.provider,
      model: cfg.model,
      lastRelayMs: this.lastRelayMs,
    }
  }

  // ── private ─────────────────────────────────────────────────────────────────────────────

  private enqueue(entry: Omit<QueueEntry, 'resolve' | 'reject'>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.queue.push({ ...entry, resolve, reject })
      this.scheduleRun()
    })
  }

  private scheduleRun(): void {
    if (this.running) return
    this.running = true
    void this.runLoop()
  }

  private async runLoop(): Promise<void> {
    while (this.queue.length > 0) {
      const entry = this.queue[0]!
      try {
        await this.processEntry(entry)
        // Keep desk_messages bounded: trim every processed entry.
        this.history.trim()
        // 【修复】成功的 turn 清掉 recentErrors——健康板不应该因为历史错误永远红
        this.recentErrors = []
        entry.resolve()
      } catch (error) {
        const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        // 【修复】LLM 超时是运行限制，不是故障——不写进健康板的 recentErrors
        // 真正的错误（工具失败、API 拒绝等）才写
        const isTimeout = msg.includes('aborted') || msg.includes('timeout') || msg.includes('Timeout')
        if (!isTimeout) this.addError(msg)
        else this.ctx.logger.warn('[DeskLoop] turn timed out for %s: %s', entry.ticketId?.slice(0, 8) ?? '?', msg)
        // 【E 真修】triage turn 超时后，直接调 engine.report(dropped) 结束 assignment
        // 不经过模型工具层——engine.report 是领域层唯一写者，这是正确的接口
        if (isTimeout && entry.ticketId) {
          try {
            this.engine?.report(entry.ticketId, {
              state: 'dropped',
              summary: 'Triage timed out — desk LLM did not respond in time. Ticket dropped automatically.',
            })
            this.ctx.logger.info('[DeskLoop] closed timed-out triage ticket %s via engine.report', entry.ticketId.slice(0, 8))
          } catch (closeError) {
            this.ctx.logger.warn('[DeskLoop] could not close timed-out ticket %s: %s',
              entry.ticketId.slice(0, 8), String(closeError).slice(0, 80))
          }
        }
        entry.reject(error)
      }
      this.queue.shift()
    }
    this.status = 'idle'
    this.currentTool = undefined
    this.running = false
  }

  private async processEntry(entry: QueueEntry): Promise<void> {
    const cfg = this.settings().deskLlm

    // Append the incoming message to history (dedup by requestId).
    const role = 'user'
    this.history.append({
      role,
      content: entry.text,
      ticketId: entry.ticketId,
      requestId: entry.requestId,
      at: new Date().toISOString(),
    })

    // Notify messages are saved to history but don't trigger a desk turn.
    if (entry.kind === 'notify') return

    // If not configured, record a warning but don't crash.
    if (!cfg.provider || !cfg.model) {
      this.addError('Desk LLM not configured (deskLlm.provider / deskLlm.model empty).')
      return
    }

    // Run the LLM turn loop (may involve multiple tool-call rounds).
    const tools = deskToolSchemas(this.toolsHost)
    await this.runTurn(cfg, tools, entry.ticketId)
  }

  private async runTurn(
    cfg: Settings['deskLlm'],
    tools: readonly ToolSchema[],
    ticketId: string | undefined,
    round = 0,
  ): Promise<void> {
    if (round >= MAX_TOOL_ROUNDS) {
      this.addError(`Desk turn exceeded ${MAX_TOOL_ROUNDS} tool-call rounds; stopping.`)
      return
    }

    this.status = 'thinking'

    // Build conversation from history.
    const history = this.history.recent(50)

    // Set up abort with timeout.
    const parent = this.abortController.signal
    const tac = new AbortController()
    const timer = setTimeout(() => tac.abort(), LLM_CALL_TIMEOUT_MS)
    const combined = anyAbort([parent, tac.signal])

    let response
    try {
      response = await deskGenerate(this.ctx, cfg, history, tools, combined)
    } finally {
      clearTimeout(timer)
    }

    // Persist the assistant reply.
    this.history.append({
      role: 'assistant',
      content: response.text,
      tool_calls: response.toolCalls.length > 0 ? response.toolCalls : undefined,
      ticketId,
      at: new Date().toISOString(),
    })

    // If no tool calls, we're done.
    if (response.toolCalls.length === 0) {
      this.status = 'idle'
      return
    }

    // Execute tool calls.
    this.status = 'executing'
    for (const call of response.toolCalls) {
      this.currentTool = call.name
      const results = await executeDeskToolCalls([call], this.toolsHost, combined)
      const result = results[0]!
      this.history.append({
        role: 'tool',
        content: result.content,
        tool_call_id: result.toolCallId,
        name: result.name,
        ticketId,
        at: new Date().toISOString(),
      })
    }
    this.currentTool = undefined

    // Continue the turn so the LLM can see the tool results.
    await this.runTurn(cfg, tools, ticketId, round + 1)
  }

  private addError(msg: string): void {
    this.recentErrors.push(msg)
    if (this.recentErrors.length > HEALTH_WINDOW) this.recentErrors.shift()
    this.ctx.logger.warn('[DeskLoop] %s', msg)
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────────────────

/** Combine multiple AbortSignals: abort as soon as any one aborts. */
function anyAbort(signals: AbortSignal[]): AbortSignal {
  const ac = new AbortController()
  for (const s of signals) {
    if (s.aborted) { ac.abort(s.reason); return ac.signal }
    s.addEventListener('abort', () => ac.abort(s.reason), { once: true })
  }
  return ac.signal
}
