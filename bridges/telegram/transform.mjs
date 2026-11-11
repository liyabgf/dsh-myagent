import { taskTitle } from '../lib/inbound.mjs'
import { formatRoute } from '../lib/route.mjs'

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

/**
 * Does this message address the bot? Uses Telegram's entities rather than a substring guess.
 *
 * 【实捕修正】**回复机器人自己的消息也算找它。** Telegram 的"回复"不产生 mention entity——
 * 只有真的打出 @bot 才有。而平台的隐私模式恰恰会把"回复机器人的消息"投递给机器人，
 * 也就是说：**平台认为这是找它的，而 mentions 过滤器认为不是**。后果是操作者最自然的那个动作
 * （对着答案回一句）被静默丢掉：频道目录没文件、面板 waiting=0、日志只有 debug 级的一行——
 * 三处都没有痕迹。这条是 11-10 晚上一次真实投诉（"我从电报回复安装技能，没有响应"）查出来的。
 */
export function mentionsBot(message, me) {
  // 回复机器人自己的消息：平台已经判定这是给它的（隐私模式只投递这几类），不需要再有 @。
  if (me?.id !== undefined && message?.reply_to_message?.from?.id !== undefined
    && String(message.reply_to_message.from.id) === String(me.id)) return true
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
  // Collect downloadable file references (photo, document, video, audio, voice)
  // Each ref: { fileId, ext, description } — bridge calls getFile then downloadAttachment
  const fileRefs = []
  if (message.photo?.length) {
    // photo array: last element is highest resolution
    const best = message.photo.at(-1)
    fileRefs.push({ fileId: best.file_id, ext: 'jpg', description: '图片' })
    // If multiple photos in one message (album), Telegram sends separate updates — this handles single photo
  }
  if (message.document) {
    const doc = message.document
    const ext = doc.file_name?.split('.').pop()?.toLowerCase() ?? (doc.mime_type?.split('/')[1] ?? 'bin')
    fileRefs.push({ fileId: doc.file_id, ext, description: doc.file_name ?? '文件', fileName: doc.file_name })
  }
  if (message.video) fileRefs.push({ fileId: message.video.file_id, ext: 'mp4', description: '视频' })
  if (message.audio) fileRefs.push({ fileId: message.audio.file_id, ext: message.audio.mime_type?.split('/')[1] ?? 'mp3', description: '音频' })
  if (message.voice) fileRefs.push({ fileId: message.voice.file_id, ext: 'ogg', description: '语音' })

  const effectiveBody = body !== '' ? body
    : fileRefs.length > 0 ? `[${fileRefs.map(r => r.description).join('，')}]`
    : ''
  if (effectiveBody === '') return { skip: 'no-text' }
  const rawThread = message.message_thread_id === undefined ? undefined : String(message.message_thread_id)
  const thread = formatRoute({
    kind: isDirect ? 'dm' : rawThread !== undefined ? 'topic' : 'group',
    chatId,
    threadId: rawThread,
  })
  const isAnonymousAdmin = String(message.from.id) === '1087968824'
    || message.from.username === 'GroupAnonymousBot'
    || message.sender_chat !== undefined
  const senderName = [message.from.first_name, message.from.last_name].filter(Boolean).join(' ')
  const signature = typeof message.author_signature === 'string' ? message.author_signature.trim() : ''
  const chatTitle = typeof message.sender_chat?.title === 'string' && message.sender_chat.title.trim() !== ''
    ? message.sender_chat.title.trim()
    : typeof message.chat?.title === 'string' && message.chat.title.trim() !== ''
      ? message.chat.title.trim()
      : ''
  const senderLabel = isAnonymousAdmin
    ? (signature || (chatTitle ? `${chatTitle}（匿名管理员）` : '匿名管理员'))
    : (senderName || message.from.username || `user-${message.from.id}`)
  const replyToMessageId = message.reply_to_message?.message_id === undefined
    ? undefined
    : `${chatId}-${message.reply_to_message.message_id}`
  return {
    message: {
      from: String(message.from.id),
      id: `${chatId}-${message.message_id}`,
      thread,
      ...(replyToMessageId === undefined ? {} : { replyToMessageId }),
      // 标题是「发起者 + 任务内容简要」，不再用群名（匿名管理员用签名或「群名（匿名管理员）」，绝不显示无意义的 "Group"）。
      title: taskTitle(senderLabel, effectiveBody),
      body: effectiveBody,
      ...(fileRefs.length ? { fileRefs } : {}),
      chatId,
      isDirect,
    },
  }
}
