/**
 * Idempotent message delivery to DSH agents.
 *
 * A launch or a notification may be retried after a crash, and a Session may be restored from its log; both must not
 * hand the same text to the model twice. Every message therefore carries an id derived from the request that produced
 * it, and is skipped when that id is already in the Session's history or its inbox.
 */
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { freezeMessage, MessageId, type ContextFormed, type Message, type UserMessage } from '@deepseek-ai/dsh-llm'
import type { Session } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-persistence'

declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap {
    'myagent': { kind: 'myagent' } & ContextFormed
  }
}

type Seen = { ids: Set<string>; loaded?: Promise<void> }

/** The id of the message delivered under `requestId`, the same on every retry. */
export const messageId = (requestId: string): ReturnType<typeof MessageId> => MessageId(`myagent:${requestId}`)

/** The idempotency key of a message, when myagent produced it; another kind of message has none. */
function deliveryId(message: Message): string | undefined {
  if (message.role !== 'user' || message.source === undefined) return undefined
  const source: { kind: string } = message.source
  return source.kind === 'myagent' ? message.id : undefined
}

/**
 * Delivers at most once per request id, across active and restored Sessions.
 * `queue` wakes the agent with a message it answers in its next turn; `inject` puts text into its history without
 * waking it, for a notice that must be there when it next runs.
 */
export class AgentDelivery {
  private readonly seen = new WeakMap<Session, Seen>()

  constructor(private readonly ctx: Context) {
    // Contained like every other listener: this runs inside DSH's dispatch, where a throw is fatal for the host.
    ctx.on('session/event', (session, event) => {
      try {
        if (event.type !== 'user/message') return
        const id = deliveryId(event.data)
        // The entry is created here rather than looked up: a message that reaches the history before this process
        // delivers anything of its own would otherwise be recorded nowhere, and the ordering would be an assumption
        // rather than a guarantee. `history()` merges the persisted log into the same set whenever it runs.
        if (id === undefined) return
        let seen = this.seen.get(session)
        if (seen === undefined) { seen = { ids: new Set() }; this.seen.set(session, seen) }
        seen.ids.add(id)
      } catch (error) {
        ctx.logger.error('myagent could not record a delivered message: %s', String(error))
      }
    })
  }

  /** The ids already in this Session's persisted history, loaded once and kept for its lifetime. */
  private async history(agent: Agent): Promise<Seen> {
    let seen = this.seen.get(agent.session)
    if (seen === undefined) { seen = { ids: new Set() }; this.seen.set(agent.session, seen) }
    const state = seen
    state.loaded ??= (async () => {
      await this.ctx.sessionPersistence.flush()
      await using handle = await this.ctx.sessionPersistence.open(agent.id, 'read')
      for (let offset = 0; ;) {
        const { events } = await handle.read(offset, 512)
        if (events.length === 0) break
        for (const event of events) {
          if (event.type !== 'user/message') continue
          const id = deliveryId(event.data)
          if (id !== undefined) state.ids.add(id)
        }
        offset += events.length
      }
    })().catch((error: unknown) => { state.loaded = undefined; throw error })
    await state.loaded
    return state
  }

  /** Whether `requestId` already reached `agent`, so a retry would duplicate it. */
  async holds(agent: Agent, requestId: string): Promise<boolean> {
    const id = messageId(requestId)
    return (await this.history(agent)).ids.has(id)
      || [...agent.inbox.nextTurn, ...agent.inbox.nextStep].some(message => deliveryId(message) === id)
  }

  /**
   * Deliver `text` once under `requestId`, then flush persistence before the caller acknowledges the work.
   * @param mode `queue` wakes the agent; `inject` records a notice without waking it.
   * @param accepted called once the message is in the Session's own hands, which survives a restart.
   */
  async send(agent: Agent, requestId: string, text: string, mode: 'queue' | { inject: string }, signal: AbortSignal,
    accepted?: () => void): Promise<void> {
    signal.throwIfAborted()
    const seen = await this.history(agent)
    signal.throwIfAborted()
    if (this.ctx.agents.get(agent.id) !== agent) throw new Error('The delivery target was disposed')
    const id = messageId(requestId)
    const pending = [...agent.inbox.nextTurn, ...agent.inbox.nextStep].some(message => deliveryId(message) === id)
    if (!seen.ids.has(id) && !pending) {
      const source = typeof mode === 'object'
        ? { kind: 'myagent' as const, form: 'notice' as const, summary: mode.inject }
        : { kind: 'myagent' as const, form: 'relay' as const }
      const message = freezeMessage({ id, role: 'user' as const, content: [{ type: 'text' as const, text }], source })
      if (typeof mode === 'object') { agent.inject(message); seen.ids.add(id) }
      else agent.followup(message)
    }
    // Flush first: a caller told the message is durable must not be told that before it is. Acknowledging first made
    // a flush failure indistinguishable from a successful delivery, which is the whole thing this class exists to avoid.
    await this.ctx.sessionPersistence.flush()
    accepted?.()
  }
}
