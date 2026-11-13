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
import { createHash } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolSchema } from '@deepseek-ai/dsh-llm'
import type { Store } from './store.ts'
import type { ToolsHost } from './tools.ts'
import type { Prompts } from './prompts.ts'
import type { Settings } from '../core/policy.ts'
import type { Engine } from '../core/engine.ts'
import { DeskHistory } from './desk-history.ts'
import { deskGenerate } from './desk-llm.ts'
import { DESK_GATE_TOOL_NAME, deskGateToolSchema, deskToolSchemas, executeDeskToolCalls } from './desk-tools.ts'
import { latestAssignment, liveTicket } from '../core/model.ts'

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
  fingerprint: string
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
  /** The currently-executing processEntry promise, so stop() can await it before Store closes. */
  private currentTurn: Promise<void> | undefined = undefined
  /** In-flight Promises keyed by requestId to deduplicate concurrent relay() calls (P1-4). */
  private readonly inFlightByRequestId = new Map<string, { fingerprint: string; promise: Promise<void> }>()

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

  /** R1-02: Stop the loop, abort any in-flight LLM call, reject queued entries, and
   *  await the currently-executing turn so the Store is not closed while it still writes. */
  async stop(): Promise<void> {
    this.abortController.abort()
    // Only splice entries that have NOT yet started (the queue excludes the current entry
    // which is tracked via currentTurn; processEntry will abort via the signal).
    for (const entry of this.queue.splice(1)) {
      entry.reject(new Error('DeskLoop stopped'))
    }
    // Wait for the in-flight turn to finish (it will abort via the signal).
    await this.currentTurn?.catch(() => {})
  }

  private enqueue(entry: Omit<QueueEntry, 'resolve' | 'reject' | 'fingerprint'>): Promise<void> {
    // R1-10: Reject immediately when already stopped.
    if (this.abortController.signal.aborted) {
      return Promise.reject(new Error('DeskLoop stopped'))
    }
    const fingerprint = requestFingerprint(entry)
    // Stable request identity is exclusive to one payload for the life of the receipt.
    if (entry.requestId) {
      const pending = this.inFlightByRequestId.get(entry.requestId)
      if (pending) {
        if (pending.fingerprint !== fingerprint) return Promise.reject(requestConflict(entry.requestId))
        return pending.promise
      }
    }
    // Create the Promise with external resolve/reject so we can attach .catch
    // before pushing to the queue — this ensures the Promise is permanently
    // "handled" even if stop() calls entry.reject() synchronously during
    // scheduleRun(), preventing Node's unhandledRejection event.
    let resolve!: () => void
    let reject!: (err: unknown) => void
    const promise = new Promise<void>((res, rej) => { resolve = res; reject = rej })
    promise.catch(() => {})  // mark as handled before any async rejection can occur
    const queued: QueueEntry = { ...entry, fingerprint, resolve, reject }
    this.queue.push(queued)
    if (entry.requestId) {
      this.inFlightByRequestId.set(entry.requestId, { fingerprint, promise })
      const release = (): void => { this.inFlightByRequestId.delete(entry.requestId) }
      // Handle both outcomes: an ignored finally() result would reject again on failure.
      void promise.then(release, release)
    }
    this.scheduleRun()
    return promise
  }

  private scheduleRun(): void {
    if (this.running) return
    this.running = true
    void this.runLoop().catch(() => { /* runLoop errors are handled per-entry via entry.reject */ })
  }

  private async runLoop(): Promise<void> {
    while (this.queue.length > 0) {
      const entry = this.queue[0]!
      // Track the in-flight turn so stop() can await it.
      this.recentErrors = []
      this.currentTurn = this.processEntry(entry).then(() => {
        this.history.trim()
        entry.resolve()
      }).catch((error: unknown) => {
        const msg = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
        // 【修复】LLM 超时是运行限制，不是故障——不写进健康板的 recentErrors
        // 真正的错误（工具失败、API 拒绝等）才写
        const isTimeout = msg.includes('aborted') || msg.includes('timeout') || msg.includes('Timeout')
        if (!isTimeout) this.addError(msg)
        else this.ctx.logger.warn('[DeskLoop] turn timed out for %s: %s', entry.ticketId?.slice(0, 8) ?? '?', msg)
        // R1-03: Only drop a *triage* Ticket on timeout.  A worker's askDesk() relay also
        // carries a ticketId, but that ticketId belongs to a *worker* Ticket — dropping it
        // would silently end work that is still running in a separate Session.
        if (isTimeout && entry.ticketId) {
          const ticket = this.store.tickets.get(entry.ticketId)
          const assignment = ticket?.assignments.at(-1)
          const isRunningTriage = assignment?.role === 'triage' && assignment.state === 'running'
          if (isRunningTriage) {
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
        }
        entry.reject(error)
      })
      await this.currentTurn
      this.queue.shift()
    }
    this.currentTurn = undefined
    this.status = 'idle'
    this.currentTool = undefined
    this.running = false
  }

  private async processEntry(entry: QueueEntry): Promise<void> {
    if (entry.requestId) {
      const receipt = this.store.get<DeskSuccessReceipt>(deskReceiptKey(entry.requestId))
      if (receipt !== undefined) {
        if (receipt.version !== 1 || typeof receipt.fingerprint !== 'string' || typeof receipt.completedAt !== 'string') {
          throw new Error(`Invalid Desk success receipt for requestId '${entry.requestId}'.`)
        }
        if (receipt.fingerprint !== entry.fingerprint) throw requestConflict(entry.requestId)
        return
      }
    }
    const cfg = this.settings().deskLlm

    // Append the incoming message to history (dedup by requestId).
    const role = 'user'
    const turnStartedAt = new Date().toISOString()
    if (entry.kind === 'notify') {
      if (entry.requestId) this.store.atomic(() => {
        this.history.append({ role, content: entry.text, ticketId: entry.ticketId, requestId: entry.requestId, at: turnStartedAt })
        this.store.set(deskReceiptKey(entry.requestId), { version: 1, fingerprint: entry.fingerprint, completedAt: new Date().toISOString() } satisfies DeskSuccessReceipt)
      })
      else this.history.append({ role, content: entry.text, ticketId: entry.ticketId, at: turnStartedAt })
      return
    }
    this.history.append({ role, content: entry.text, ticketId: entry.ticketId, requestId: entry.requestId, at: turnStartedAt })

    // R1-09: Throw so the caller gets an error and the queue entry is rejected.
    // A silent return here would leave a running triage Ticket open forever when
    // the desk LLM is not yet configured.
    if (!cfg.provider || !cfg.model) {
      throw new Error('Desk LLM not configured (deskLlm.provider / deskLlm.model empty).')
    }

    // A failed triage request can be redelivered after report(failed/dropped) ended its Ticket.
    // Do not ask the model to act on that terminal assignment again; a new assignment is required.
    const ticket = entry.ticketId ? this.store.tickets.get(entry.ticketId) : undefined
    if (ticket && !liveTicket(ticket) && latestAssignment(ticket)?.role === 'triage') return

    // 【R3】First round uses only the lightweight gateway tool — not all 11 management schemas.
    // Simple questions and notice acknowledgements complete in one round with no tool call.
    const outcome = await this.runTurn(cfg, false, entry.ticketId, turnStartedAt)
    if (outcome === 'success' && entry.requestId) {
      // Never hold a synchronous SQLite transaction across model or tool I/O.
      // External tool effects may already have happened if this commit fails: no exactly-once claim.
      this.store.atomic(() => {
        this.store.set(deskReceiptKey(entry.requestId), { version: 1, fingerprint: entry.fingerprint, completedAt: new Date().toISOString() } satisfies DeskSuccessReceipt)
      })
    }
  }

  private async runTurn(
    cfg: Settings['deskLlm'],
    toolsMounted: boolean,
    ticketId: string | undefined,
    turnStartedAt: string,
    round = 0,
    unresolvedToolErrors = new Set<string>(),
  ): Promise<'success' | 'failure'> {
    if (round >= MAX_TOOL_ROUNDS) {
      this.addError(`Desk turn exceeded ${MAX_TOOL_ROUNDS} tool-call rounds; stopping.`)
      return 'failure'
    }

    this.status = 'thinking'
    const activeTools: readonly ToolSchema[] = toolsMounted
      ? deskToolSchemas(this.toolsHost)
      : [deskGateToolSchema()]

    // Build conversation from history.
    const history = this.history.recent(50)

    // Set up abort with timeout.
    const parent = this.abortController.signal
    const tac = new AbortController()
    const timer = setTimeout(() => tac.abort(), LLM_CALL_TIMEOUT_MS)
    const combined = anyAbort([parent, tac.signal])

    let response
    try {
      response = await deskGenerate(this.ctx, cfg, history, activeTools, combined)
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

    // No tool calls: LLM answered directly. Close any pending triage Ticket via engine.report.
    if (response.toolCalls.length === 0) {
      // R1-04: An error/aborted/max-tokens finish is NOT a successful answer even if partial text
      // was emitted. Settling the Ticket as 'ready' with partial text would misrepresent a failure.
      const failFinish = response.finishReason === 'error' || response.finishReason === 'aborted'
        || response.finishReason === 'max-tokens'
      if (failFinish) {
        if (ticketId) {
          const ticket = this.store.tickets.get(ticketId)
          const assignment = ticket?.assignments.at(-1)
          const isRunningTriage = assignment?.role === 'triage' && assignment.state === 'running'
          if (isRunningTriage) {
            try {
              this.engine?.report(ticketId, {
                state: 'failed',
                summary: `Desk LLM ended with reason '${response.finishReason}'; ${response.text || '(no text)'}`,
              })
              this.ctx.logger.warn('[DeskLoop] triage %s failed: finish=%s', ticketId.slice(0, 8), response.finishReason)
            } catch (err) {
              this.ctx.logger.warn('[DeskLoop] could not report failed triage %s: %s', ticketId.slice(0, 8), String(err).slice(0, 80))
            }
          }
        }
        this.addError(`Desk LLM ended with reason '${response.finishReason}'.`)
        this.status = 'idle'
        return 'failure'
      }
      this.status = 'idle'
      if (response.finishReason !== 'stop') {
        this.addError(`Desk LLM ended without a normal stop: '${response.finishReason}'.`)
        return 'failure'
      }
      if (unresolvedToolErrors.size > 0) {
        this.addError(`Desk turn ended with unresolved tool errors: ${[...unresolvedToolErrors].join(', ')}`)
        return 'failure'
      }
      return this.settleDirectTriageAnswer(ticketId, response.text, turnStartedAt) ? 'success' : 'failure'
    }

    // P1-3 fix: if the finish reason indicates a provider error, do not execute
    // tool calls even if they were returned — a failed generation must not cause
    // side effects (creating tickets, dispatching work, etc.).
    const failFinishWithTools = response.toolCalls.length > 0 && (
      response.finishReason === 'error' ||
      response.finishReason === 'aborted' ||
      response.finishReason === 'max-tokens'
    )
    if (failFinishWithTools) {
      if (ticketId) {
        const ticket = this.store.tickets.get(ticketId)
        const assignment = ticket?.assignments.at(-1)
        const isRunningTriage = assignment?.role === 'triage' && assignment.state === 'running'
        if (isRunningTriage) {
          try {
            this.engine?.report(ticketId, {
              state: 'failed',
              summary: `Desk LLM ended with reason '${response.finishReason}' alongside tool calls; aborting to avoid side effects.`,
            })
          } catch (err) {
            this.ctx.logger.warn('[DeskLoop] could not report failed triage %s: %s', ticketId.slice(0, 8), String(err).slice(0, 80))
          }
        }
      } else {
        this.addError(`Desk LLM ended with reason '${response.finishReason}' alongside tool calls; aborted tool execution.`)
      }
      this.status = 'idle'
      return 'failure'
    }

    // Execute tool calls, mounting the full toolset when the gateway tool is called.
    this.status = 'executing'
    let nextMounted = toolsMounted
    for (const call of response.toolCalls) {
      this.currentTool = call.name
      if (call.name === DESK_GATE_TOOL_NAME) {
        // 【R3】Gateway called: mount full toolset for next round (0 ms, in-memory).
        nextMounted = true
        const allNames = deskToolSchemas(this.toolsHost).map(t => t.name)
        this.history.append({
          role: 'tool',
          content: JSON.stringify({ mounted: true, count: allNames.length, tools: allNames }),
          tool_call_id: call.id,
          name: call.name,
          ticketId,
          at: new Date().toISOString(),
        })
        continue
      }
      // Any real myagent_* tool: execute normally and keep full toolset mounted.
      nextMounted = true
      const results = await executeDeskToolCalls([call], this.toolsHost, combined)
      const result = results[0]!
      // Only the same command payload can repair an earlier failed action.
      // A successful call to the same tool for another Ticket does not confirm that action.
      const action = JSON.stringify([call.name, call.arguments])
      if (result.isError) unresolvedToolErrors.add(action)
      else unresolvedToolErrors.delete(action)
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
    return this.runTurn(cfg, nextMounted, ticketId, turnStartedAt, round + 1, unresolvedToolErrors)
  }

  /**
   * 【R3】When the LLM gives a direct text reply (no tool calls) for a pending triage Ticket,
   * close it via engine.report(ready) so the answer reaches the requester and the Ticket ends cleanly.
   *
   * Guards (all must pass):
   * - ticketId present, engine injected, text non-empty
   * - Ticket is live and its latest Assignment is running triage
   * - No `replied` event in THIS turn (since the user message was appended)
   *
   * P1-2 fix: turnStartedAt is the timestamp of the user message appended at the start
   * of this relay turn. Using this.history.recent(1) was wrong because by the time
   * settleDirectTriageAnswer is called the assistant message has already been appended,
   * so recent(1) returned the assistant's timestamp, not the user's.
   */
  private settleDirectTriageAnswer(ticketId: string | undefined, text: string, turnStartedAt: string): boolean {
    const summary = text.trim()
    if (!ticketId) return true
    const ticket = this.store.tickets.get(ticketId)
    if (ticket === undefined) return true
    if (!liveTicket(ticket)) return ticket.ended?.outcome === 'done'
    const assignment = latestAssignment(ticket)
    if (assignment === undefined || assignment.state !== 'running' || assignment.role !== 'triage') return true
    if (!this.engine) return false
    // Only block settlement if a 'replied' event occurred in THIS relay turn
    // (at or after the user message we appended), not across the whole Assignment history.
    const events = this.store.events.list(ticketId)
    const repliedInThisTurn = events.some(ev =>
      ev.type === 'replied' && ev.at >= turnStartedAt)
    if (repliedInThisTurn) return false
    try {
      if (summary === '') {
        // 【Bug fix】LLM returned empty text with no tool calls (e.g. timeout truncation or content filter).
        // Silently returning here left the triage Ticket running indefinitely (live: 3ba0fe58, 8 hours stuck).
        // Drop it so the Ticket ends cleanly and the requester is not left waiting forever.
        this.engine.report(ticketId, { state: 'dropped', summary: 'The desk LLM returned an empty response; this triage item was dropped automatically.' })
        this.ctx.logger.warn('[DeskLoop] empty LLM reply for triage ticket %s — dropping', ticketId.slice(0, 8))
        return false
      } else {
        this.engine.report(ticketId, { state: 'ready', summary })
        this.ctx.logger.info('[DeskLoop] direct triage answer settled ticket %s', ticketId.slice(0, 8))
      }
      return true
    } catch (error) {
      this.ctx.logger.warn('[DeskLoop] could not settle direct triage answer for %s: %s',
        ticketId.slice(0, 8), String(error).slice(0, 80))
      return false
    }
  }

  private addError(msg: string): void {
    this.recentErrors.push(msg)
    if (this.recentErrors.length > HEALTH_WINDOW) this.recentErrors.shift()
    this.ctx.logger.warn('[DeskLoop] %s', msg)
  }
}

interface DeskSuccessReceipt {
  version: 1
  fingerprint: string
  completedAt: string
}

function deskReceiptKey(requestId: string): string {
  return `desk:request:success:${encodeURIComponent(requestId)}`
}

function requestFingerprint(entry: Pick<QueueEntry, 'kind' | 'requestId' | 'text' | 'ticketId'>): string {
  return createHash('sha256').update(JSON.stringify({ kind: entry.kind, requestId: entry.requestId, text: entry.text, ticketId: entry.ticketId ?? null })).digest('hex')
}

function requestConflict(requestId: string): Error {
  return new Error(`Desk requestId '${requestId}' payload conflict`)
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
