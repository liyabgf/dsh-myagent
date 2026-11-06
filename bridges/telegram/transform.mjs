/**
 * The pure half of the Telegram bridge: a platform update in, a channel message (or a reason to skip) out.
 *
 * It lives apart from `bridge.mjs` for one reason — `bridge.mjs` reads the environment and starts polling at import
 * time, so nothing in it can be tested. Everything that can be wrong about the mapping is here instead, where a test
 * can hand it an update and read the answer.
 *
 * Three decisions in this file are load-bearing:
 *
 * 1. **The `id` is `<chatId>-<messageId>`.** Telegram's `message_id` is unique per chat, so the bare number would let
 *    the same id in two groups collapse into one Trigger — and because a Trigger id is a pure function of the message,
 *    the second group's message would be silently deduplicated away, not merely mislabeled.
 * 2. **A message with no `from` is skipped, not held.** Holding is the right answer for a person the operator has not
 *    mapped yet; a channel broadcast has no person to map, so holding it would leave a file that can never be
 *    resolved, forever, on the health board.
 * 3. **The bot's own @handle is stripped from the body.** "​@bot 整理周报" is the request "整理周报"; leaving the handle
 *    in makes every request begin with noise the worker has to look past.
 */

/** Does this message address the bot? Uses Telegram's entities rather than a substring guess. */
export function mentionsBot(message, me) {
  if (me?.username === undefined) return false
  const text = message.text ?? message.caption ?? ''
  const handle = `@${me.username.toLowerCase()}`
  const entities = [...(message.entities ?? []), ...(message.caption_entities ?? [])]
  for (const entity of entities) {
    const slice = text.slice(entity.offset, entity.offset + entity.length).toLowerCase()
    if (entity.type === 'mention' && slice === handle) return true
    // `/start@mybot` is a command addressed to this bot in a group where several bots may sit.
    if (entity.type === 'bot_command' && slice.startsWith('/') && slice.endsWith(handle)) return true
  }
  return false
}

/** The request text with the bot's own handle and a bot-addressed command removed. */
export function cleanText(message, me) {
  const text = message.text ?? message.caption ?? ''
  if (me?.username === undefined) return text.trim()
  // 顺序要紧：**先**去掉整条 `/cmd@bot`，**再**去掉裸 @handle。
  // 反过来的话 `/start@myagent_bot` 会先变成 `/start`，第二条规则就永远匹配不上，
  // 于是一条"启动命令"会被当成请求正文交给 worker（这一条是测试抓出来的）。
  return text
    .replace(new RegExp(`^/\\w+@${me.username}\\b\\s*`, 'i'), '')
    .replace(new RegExp(`@${me.username}\\b`, 'gi'), '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * @param {object} update   one Telegram Update
 * @param {object} me       the bot's own `getMe` result
 * @param {{ mode?: 'mentions'|'dm'|'all', chatAllowList?: string[] }} [options]
 * @returns {{ message: object } | { skip: string }}
 */
export function mapUpdate(update, me, { mode = 'mentions', chatAllowList = [] } = {}) {
  const message = update.message ?? update.edited_message
  if (message === undefined) return { skip: 'not-a-message' }
  const chatId = String(message.chat?.id ?? '')
  if (chatAllowList.length > 0 && !chatAllowList.includes(chatId)) return { skip: 'chat-not-allowed' }
  if (message.from?.id === undefined) return { skip: 'no-sender' }
  if (me?.id !== undefined && String(message.from.id) === String(me.id)) return { skip: 'own-message' }
  const isDirect = message.chat?.type === 'private'
  if (mode === 'dm' && !isDirect) return { skip: 'not-a-dm' }
  if (mode === 'mentions' && !isDirect && !mentionsBot(message, me)) return { skip: 'not-mentioned' }
  const body = cleanText(message, me)
  if (body === '') return { skip: 'no-text' }
  const thread = message.message_thread_id === undefined ? undefined : String(message.message_thread_id)
  const senderName = [message.from.first_name, message.from.last_name].filter(Boolean).join(' ')
  return {
    message: {
      from: String(message.from.id),
      id: `${chatId}-${message.message_id}`,
      ...(thread === undefined ? {} : { thread }),
      title: isDirect ? (senderName || message.from.username || `user-${message.from.id}`) : (message.chat?.title ?? chatId),
      body,
      chatId,
      isDirect,
    },
  }
}
