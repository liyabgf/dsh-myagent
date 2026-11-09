#!/usr/bin/env node
/**
 * The Telegram bridge: a Bot API long poll on one side, a myagent chat channel directory on the other.
 *
 * Run it with nothing installed — Node 18+ has `fetch`, and this file has no dependencies:
 *
 *     TELEGRAM_BOT_TOKEN=123:abc MYAGENT_CHANNEL_DIR=/path/to/channels/telegram-main \
 *       node bridges/telegram/bridge.mjs
 *
 * ## What it does and does not decide
 *
 * The bridge is a **transport**. It never decides who somebody is (`sources.chat.identities` does), whether they may
 * originate work (`allowedSenders` does), or what a Ticket may touch (`scope` does). Putting any of that here would
 * move a security decision into a process with no tests, no gate and no panel.
 *
 * ## The one constraint the file contract imposes
 *
 * A reply file carries `thread:` and text — **not** a chat id, because the contract is platform-agnostic. So the
 * bridge keeps its own `thread → chat_id` map, learned from inbound messages and persisted in `.bridge-state.json`.
 * The clean deployment is **one myagent channel per Telegram chat** (`channels` allows 20, each with its own
 * directory), which is what that array is for; several groups in one channel would share one read position and one
 * reply address, and the Source's schema says so explicitly.
 *
 * ## Message identity
 *
 * Telegram's `message_id` is unique **per chat**, so the `id:` written is `<chatId>-<messageId>`. Writing the bare
 * `message_id` would let the same number in two groups be one Trigger — and since a Trigger id is a pure function of
 * it, the second group's message would be silently deduplicated away.
 */
import { createLog } from '../lib/log.mjs'
import { supervise } from '../lib/run.mjs'
import { loadState, saveState } from '../lib/state.mjs'
import { writeMessage } from '../lib/inbound.mjs'
import { join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { drainOut } from '../lib/outbound.mjs'
import { parseRoute } from '../lib/route.mjs'
// 纯映射逻辑单独成模块：入口文件在 import 时就读环境并启动轮询，所以留在里面的东西一样都测不了。
import { mapUpdate } from './transform.mjs'

const API = 'https://api.telegram.org'

/**
 * Telegram's per-message limit, in UTF-16 code units — which is exactly what a JS string's `.length` counts, so no
 * conversion is needed and none is attempted.
 *
 * Passed to `drainOut` rather than handled here: the splitting has to happen where the reply is read, so that a
 * too-long answer is delivered in pieces instead of being refused forever (and myagent's panel saying "delivered"
 * while the room says nothing).
 */
const MESSAGE_LIMIT = 4096

const token = process.env.TELEGRAM_BOT_TOKEN
const directory = process.env.MYAGENT_CHANNEL_DIR
if (!token) fail('TELEGRAM_BOT_TOKEN is required — create a bot with @BotFather and paste its token here')
if (!directory) fail('MYAGENT_CHANNEL_DIR is required — the channel directory from sources.chat.channels[].directory')

/**
 * What counts as "somebody asking":
 * - `mentions` (default): direct messages, plus group messages that @ the bot. A group's whole chatter is NOT
 *   forwarded, because unmapped senders are HELD by design and a busy room would fill the channel directory and the
 *   health board with messages nobody meant as a request.
 * - `dm`: direct messages only.
 * - `all`: everything the bot can see. Choose this only for a channel whose members are all mapped.
 */
const mode = process.env.TELEGRAM_MODE ?? 'mentions'
const chatAllowList = (process.env.TELEGRAM_CHATS ?? '').split(',').map(s => s.trim()).filter(Boolean)
const intervalMs = Number(process.env.TELEGRAM_POLL_MS ?? 5_000)
const keepDays = Number(process.env.MYAGENT_REPLY_KEEP_DAYS ?? 7)
const log = createLog('telegram', { level: process.env.BRIDGE_LOG_LEVEL ?? 'info' })

function fail(message) {
  process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), bridge: 'telegram', level: 'error', event: 'config', message })}\n`)
  process.exit(2)
}

/**
 * Retry a `sendMessage` 429 inside the drain pass when Telegram tells us how long to wait (`parameters.retry_after`),
 * up to 60s total (borrowed from dsh-im's `telegram-api.mjs` #sendMessageCall). A long chunked report otherwise hits
 * Telegram's per-chat burst limit on piece 3 or 4 and has to wait for the next poll cycle.
 */
const MAX_SEND_ATTEMPTS = 4
const MAX_RATE_LIMIT_WAIT_MS = 60_000
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

const call = async (method, params = {}) => {
  let waitedMs = 0
  for (let attempt = 1; ; attempt += 1) {
    const response = await fetch(`${API}/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    })
    const body = await response.json().catch(() => ({}))
    // `ok:false` is the API's way of saying no; the description is the only explanation there is, so it goes in the log
    // verbatim rather than being paraphrased into something less useful.
    if (response.ok && body.ok === true) return body.result
    const retryAfter = Number(body?.parameters?.retry_after)
    const delayMs = Number.isFinite(retryAfter) && retryAfter > 0 ? Math.ceil(retryAfter * 1000) : null
    if (method === 'sendMessage' && (response.status === 429 || body?.error_code === 429)
      && delayMs !== null && attempt < MAX_SEND_ATTEMPTS && waitedMs + delayMs <= MAX_RATE_LIMIT_WAIT_MS) {
      waitedMs += delayMs
      log.warn('rate-limited-wait', { method, attempt, delayMs, retryAfter })
      await sleep(delayMs)
      continue
    }
    throw new Error(`${method} failed: HTTP ${response.status} ${body.description ?? ''} ${JSON.stringify(body.parameters ?? {})}`.trim())
  }
}

let me = null
const state = { data: {} }

const MAX_SENT_LEDGER = 500

const inbound = async update => {
  const mapped = mapUpdate(update, me, { mode, chatAllowList })
  if (mapped.skip !== undefined) return { skipped: mapped.skip }
  const { chatId, isDirect, replyToMessageId, ...message } = mapped.message
  const replyToTicket = replyToMessageId === undefined ? undefined : state.data.sentMessages?.[replyToMessageId]
  await writeMessage({
    directory,
    ...message,
    ...(replyToTicket === undefined ? {} : { replyToTicket }),
  })
  const routes = { ...(state.data.replyRoutes ?? {}) }
  if (message.thread !== undefined) routes[message.thread] = chatId
  state.data = await saveState(directory, {
    replyRoutes: routes,
    defaultChat: isDirect || state.data.defaultChat === undefined ? chatId : state.data.defaultChat,
    lastInboundAt: new Date().toISOString(),
    lastInboundChat: chatId,
  })
  log.info('message-written', {
    chat: chatId, thread: message.thread ?? null, from: message.from, chars: message.body.length,
    ...(replyToTicket === undefined ? {} : { replyToTicket }),
  })
  return { written: 1 }
}

const outbound = async ({ thread, text, name }) => {
  const route = parseRoute(thread, state.data)
  const chatId = route?.chatId
  if (chatId === undefined) {
    throw new Error(`no chat known for thread ${thread ?? '(none)'} — the bridge has not seen an inbound message yet`)
  }
  const topicId = route?.kind === 'topic' || route?.kind === 'legacy' ? route.threadId : undefined
  const sent = await call('sendMessage', {
    chat_id: chatId,
    text,
    ...(topicId === undefined ? {} : { message_thread_id: Number(topicId) }),
    parse_mode: undefined,
    disable_web_page_preview: true,
  })
  state.data = await saveState(directory, { lastOutboundAt: new Date().toISOString(), lastOutboundFile: name })
  return sent?.message_id === undefined ? undefined : { messageId: `${chatId}-${sent.message_id}` }
}

const sendOutboundFile = async ({ thread, filePath }) => {
  const route = parseRoute(thread, state.data)
  const chatId = route?.chatId
  if (chatId === undefined) throw new Error(`no chat known for file on thread ${thread ?? '(none)'}`)
  const topicId = route?.kind === 'topic' || route?.kind === 'legacy' ? route.threadId : undefined
  const bytes = await readFile(filePath)
  const form = new FormData()
  form.append('chat_id', String(chatId))
  if (topicId !== undefined) form.append('message_thread_id', String(Number(topicId)))
  form.append('document', new Blob([bytes]), basename(filePath))
  const response = await fetch(`${API}/bot${token}/sendDocument`, {
    method: 'POST',
    body: form,
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.ok !== true) {
    throw new Error(`sendDocument failed: HTTP ${response.status} ${body.description ?? ''}`.trim())
  }
  log.info('file-sent', { chat: chatId, file: basename(filePath), bytes: bytes.length })
}

const recordSentReceipt = async ({ messageId, ticketId }) => {
  const existing = { ...(state.data.sentMessages ?? {}), [messageId]: ticketId }
  const keys = Object.keys(existing)
  if (keys.length > MAX_SENT_LEDGER) {
    for (const k of keys.slice(0, keys.length - MAX_SENT_LEDGER)) delete existing[k]
  }
  state.data = await saveState(directory, { sentMessages: existing })
}

const poll = async () => {
  if (me === null) {
    me = await call('getMe')
    log.info('bot-identified', { id: me.id, username: me.username ?? null })
  }
  // Long polling with a 25s server-side wait: fewer requests, and a message arrives within a second of being sent.
  const updates = await call('getUpdates', {
    offset: (state.data.offset ?? 0) + 1 || undefined,
    timeout: 25,
    allowed_updates: ['message', 'edited_message'],
  })
  let written = 0
  for (const update of updates ?? []) {
    // The offset is advanced BEFORE processing is known to succeed only in the sense that a re-read of the same
    // update is harmless: writing the same message id produces the same file name and the same bytes.
    if (update.update_id !== undefined) state.data = await saveState(directory, { offset: update.update_id })
    const result = await inbound(update)
    if (result?.written !== undefined) written += result.written
    else if (result?.skipped !== undefined) log.debug('skipped', result)
  }
  const replies = await drainOut({ directory, send: outbound, sendFile: sendOutboundFile, onSent: recordSentReceipt, log, keepDays, limit: MESSAGE_LIMIT })
  return { updates: (updates ?? []).length, written, replies }
}

state.data = await loadState(directory)
log.info('config', { directory, mode, intervalMs, chatAllowList, offset: state.data.offset ?? 0, keepDays })
// 【G-2】心跳文件落在频道目录里，myagent 的 chat 扫描看它的年龄——桥活着这件事终于不用读 launchd 日志才知道。
const { start } = supervise({ name: 'telegram', poll, log, intervalMs, heartbeatFile: join(directory, '.heartbeat') })
await start()
