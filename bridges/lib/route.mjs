/**
 * Canonical conversation routes (`bridges/lib/route.mjs`).
 *
 * Why this exists: every chat platform has the same three conversation shapes — a direct message (`dm`), a group chat
 * with no sub-topic (`group`), and a topic/thread inside a chat (`topic`). When each bridge encoded its own `thread`
 * field ad-hoc (Telegram leaving `thread` undefined for ordinary groups and falling back to a mutable `defaultChat`
 * in `.bridge-state.json`), a single private message poisoned `defaultChat` and caused every subsequent group report
 * to be delivered to the operator's private DM.
 *
 * By encoding the full conversation coordinate into `ReplyTo.thread` (`dm:<chatId>`, `group:<chatId>`, or
 * `topic:<chatId>:<threadId>`), outbound routing becomes a pure function of the reply envelope itself.
 */

/**
 * @param {{ kind: 'dm' | 'group' | 'topic', chatId: string | number, threadId?: string | number | null }} route
 * @returns {string}
 */
export function formatRoute({ kind, chatId, threadId }) {
  const chat = String(chatId ?? '').trim()
  if (chat === '') throw new Error('formatRoute requires a non-empty chatId')
  const topic = threadId === undefined || threadId === null ? '' : String(threadId).trim()
  if (kind === 'topic' || (kind === 'group' && topic !== '')) {
    if (topic === '') throw new Error('formatRoute(topic) requires a non-empty threadId')
    return `topic:${chat}:${topic}`
  }
  if (kind === 'dm') return `dm:${chat}`
  if (kind === 'group') return `group:${chat}`
  throw new Error(`Unknown route kind: ${String(kind)}`)
}

/**
 * Decode a stored `thread` string back into `{ kind, chatId, threadId }`.
 *
 * Backwards-compatible with pre-0.8.5 bare thread ids (e.g. `'9'` or `'omt_123'`): when the string does not start
 * with `dm:`, `group:`, or `topic:`, ` legacyRoutes[raw]` is consulted first, and if still unknown, a negative or
 * `oc_`-prefixed id is treated as a chat id while a bare number is returned as `{ kind: 'legacy', threadId: raw }`.
 *
 * @param {string | undefined | null} raw
 * @param {{ replyRoutes?: Record<string, string>, defaultChat?: string }} [fallbackState]
 * @returns {{ kind: 'dm' | 'group' | 'topic' | 'legacy', chatId?: string, threadId?: string } | undefined}
 */
export function parseRoute(raw, fallbackState = {}) {
  const text = String(raw ?? '').trim()
  if (text === '') {
    const fallbackChat = fallbackState?.defaultChat
    return fallbackChat ? { kind: 'legacy', chatId: String(fallbackChat) } : undefined
  }
  if (text.startsWith('dm:')) {
    const chatId = text.slice('dm:'.length).trim()
    return chatId === '' ? undefined : { kind: 'dm', chatId }
  }
  if (text.startsWith('group:')) {
    const chatId = text.slice('group:'.length).trim()
    return chatId === '' ? undefined : { kind: 'group', chatId }
  }
  if (text.startsWith('topic:')) {
    const rest = text.slice('topic:'.length)
    const sep = rest.lastIndexOf(':')
    if (sep <= 0 || sep === rest.length - 1) return undefined
    return {
      kind: 'topic',
      chatId: rest.slice(0, sep),
      threadId: rest.slice(sep + 1),
    }
  }
  // Legacy bare thread id: look up in `replyRoutes` first.
  const mappedChat = fallbackState?.replyRoutes?.[text] ?? fallbackState?.defaultChat
  return mappedChat !== undefined
    ? { kind: 'legacy', chatId: String(mappedChat), threadId: text }
    : undefined
}
