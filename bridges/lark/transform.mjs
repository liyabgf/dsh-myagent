import { taskTitle } from '../lib/inbound.mjs'
import { formatRoute } from '../lib/route.mjs'

/**
 * The pure half of the Lark/Feishu bridge: an `im.message.receive_v1` event in, a channel message (or a reason to
 * skip) out.
 *
 * Field paths below are taken from the official SDK's own normalizer
 * (`larksuite/node-sdk`, `channel/normalize/index.ts`), not from memory — the shapes that matter are
 * `event.sender.sender_id.open_id`, `event.message.{message_id,chat_id,chat_type,content,message_type,mentions,
 * root_id,thread_id,parent_id,create_time}`.
 *
 * Four decisions here are load-bearing:
 *
 * 1. **`content` is a JSON STRING, not an object.** `{"text":"..."}` for `text`, a nested structure for `post`.
 *    Parsing it as an object is the single most common way a Lark bridge silently produces empty requests.
 * 2. **Mentions arrive as placeholders.** In group text the message body contains `@_user_1`, and the `mentions`
 *    array maps that key to an id and a display name. The SDK's own comment records that Feishu *frequently omits*
 *    `mentions` even when `@所有人` is present, leaving `@_all` inline — so mention detection needs a content-level
 *    fallback, and the placeholder must be stripped from the request text either way.
 * 3. **`from` is the sender's `open_id`, and it stays that way.** `open_id`, `union_id` and `user_id` are three
 *    different keys for one person; mixing them makes the same colleague two identities in
 *    `sources.chat.identities`, and the operator cannot tell why one of them stopped working.
 * 4. **`thread` is `root_id`, falling back to `thread_id`.** `root_id` is the head of the reply chain the message
 *    belongs to, `thread_id` is a topic-group thread, and `parent_id` is only the immediate parent — replying to
 *    the parent would nest answers one level deeper each time.
 *
 * Unlike Telegram, Lark's `message_id` (`om_...`) is globally unique, so the message identity is the id itself and
 * does not need the chat id in front of it.
 */

/** Text out of a Lark `content` JSON string, for the message types worth forwarding. */
export function contentText(messageType, content) {
  if (typeof content !== 'string' || content === '') return ''
  let parsed
  try {
    parsed = JSON.parse(content)
  } catch {
    // Not JSON we understand. Returning the raw string would put platform encoding into a worker's request text,
    // so an unparsable body is treated as "nothing to ask" and the caller logs the type.
    return ''
  }
  if (messageType === 'text') return typeof parsed?.text === 'string' ? parsed.text : ''
  if (messageType === 'post') {
    // A rich-text post is { title, content: [[{tag:'text',text}|{tag:'a',text}|{tag:'at',user_id}, ...], ...] }.
    const lines = Array.isArray(parsed?.content) ? parsed.content : []
    const title = typeof parsed?.title === 'string' && parsed.title.trim() !== '' ? `${parsed.title.trim()}\n` : ''
    const body = lines
      .map(line => (Array.isArray(line) ? line.map(part => (typeof part?.text === 'string' ? part.text : '')).join('') : ''))
      .filter(line => line !== '')
      .join('\n')
    return `${title}${body}`.trim()
  }
  return ''
}

/**
 * Which mentions address the bot. `botOpenId` may be undefined when the bridge could not read it; then any mention
 * counts, which is the permissive reading — logged by the caller so the operator knows the filter is loose.
 */
export function mentionInfo(message, botOpenId) {
  const mentions = Array.isArray(message?.mentions) ? message.mentions : []
  const keys = mentions.map(item => item?.key).filter(key => typeof key === 'string' && key !== '')
  const mentionedBot = botOpenId === undefined
    ? mentions.length > 0
    : mentions.some(item => item?.id?.open_id === botOpenId || item?.id?.union_id === botOpenId)
  // `@_all` stays inline in the content when Feishu omits the mentions array (the SDK's own note).
  const mentionAll = mentions.some(item => item?.key === '@_all') || /@_all\b/.test(String(message?.content ?? ''))
  return { keys, mentionedBot, mentionAll }
}

/** Remove mention placeholders so the request text is what a person actually asked for. */
export function stripMentions(text) {
  return String(text ?? '')
    .replace(/@_user_\d+/g, ' ')
    .replace(/@_all\b/g, ' ')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\s*\n\s*/g, '\n')
    .trim()
}

/**
 * @param {object} event   the `im.message.receive_v1` event body
 * @param {{ botOpenId?: string, mode?: 'mentions'|'dm'|'all', chatAllowList?: string[], title?: string }} options
 * @returns {{ message: object } | { skip: string }}
 */
export function mapEvent(event, { botOpenId, mode = 'mentions', chatAllowList = [], title } = {}) {
  const message = event?.message
  const sender = event?.sender?.sender_id
  if (message === undefined || message === null) return { skip: 'not-a-message' }
  const senderId = sender?.open_id ?? sender?.user_id ?? sender?.union_id
  if (senderId === undefined || senderId === '') return { skip: 'no-sender' }
  const chatId = String(message.chat_id ?? '')
  if (chatAllowList.length > 0 && !chatAllowList.includes(chatId)) return { skip: 'chat-not-allowed' }
  if (botOpenId !== undefined && senderId === botOpenId) return { skip: 'own-message' }
  const isDirect = message.chat_type === 'p2p'
  const { mentionedBot, mentionAll } = mentionInfo(message, botOpenId)
  if (mode === 'dm' && !isDirect) return { skip: 'not-a-dm' }
  if (mode === 'mentions' && !isDirect && !mentionedBot && !mentionAll) return { skip: 'not-mentioned' }
  const text = stripMentions(contentText(message.message_type, message.content))
  if (text === '') return { skip: `no-text:${String(message.message_type ?? 'unknown')}` }
  const rawThread = message.root_id ?? message.thread_id
  const hasTopic = rawThread !== undefined && rawThread !== ''
  const thread = formatRoute({
    kind: isDirect ? 'dm' : hasTopic ? 'topic' : 'group',
    chatId,
    threadId: hasTopic ? String(rawThread) : undefined,
  })
  const replyToMessageId = message.parent_id ?? message.root_id
  const derivedTitle = title ?? taskTitle(String(senderId), text)
  return {
    message: {
      from: String(senderId),
      id: String(message.message_id),
      thread,
      ...(replyToMessageId === undefined || replyToMessageId === '' ? {} : { replyToMessageId: String(replyToMessageId) }),
      title: derivedTitle,
      body: text,
      chatId,
      isDirect,
      chatType: message.chat_type,
      messageType: message.message_type,
    },
  }
}
