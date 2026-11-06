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
import { drainOut } from '../lib/outbound.mjs'
// 纯映射逻辑单独成模块：入口文件在 import 时就读环境并启动轮询，所以留在里面的东西一样都测不了。
import { mapUpdate } from './transform.mjs'

const API = 'https://api.telegram.org'

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

const call = async (method, params = {}) => {
  const response = await fetch(`${API}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(params),
  })
  const body = await response.json().catch(() => ({}))
  // `ok:false` is the API's way of saying no; the description is the only explanation there is, so it goes in the log
  // verbatim rather than being paraphrased into something less useful.
  if (!response.ok || body.ok !== true) {
    throw new Error(`${method} failed: HTTP ${response.status} ${body.description ?? ''} ${JSON.stringify(body.parameters ?? {})}`.trim())
  }
  return body.result
}

let me = null
const state = { data: {} }

const inbound = async update => {
  const mapped = mapUpdate(update, me, { mode, chatAllowList })
  if (mapped.skip !== undefined) return { skipped: mapped.skip }
  const { chatId, isDirect, ...message } = mapped.message
  await writeMessage({ directory, ...message })
  // Learn where answers to this thread go: a reply file carries the thread but never the chat id.
  const routes = { ...(state.data.replyRoutes ?? {}) }
  if (message.thread !== undefined) routes[message.thread] = chatId
  state.data = await saveState(directory, {
    replyRoutes: routes,
    defaultChat: isDirect || state.data.defaultChat === undefined ? chatId : state.data.defaultChat,
    lastInboundAt: new Date().toISOString(),
    lastInboundChat: chatId,
  })
  log.info('message-written', { chat: chatId, thread: message.thread ?? null, from: message.from, chars: message.body.length })
  return { written: 1 }
}

const outbound = async ({ thread, text, name }) => {
  const chatId = (thread !== undefined ? state.data.replyRoutes?.[thread] : undefined) ?? state.data.defaultChat
  if (chatId === undefined) {
    // `reply_unroutable` is myagent's word for this; here it means the bridge has never seen a message to answer.
    throw new Error(`no chat known for thread ${thread ?? '(none)'} — the bridge has not seen an inbound message yet`)
  }
  await call('sendMessage', {
    chat_id: chatId,
    text,
    ...(thread === undefined ? {} : { message_thread_id: Number(thread) }),
    // Markdown would turn an ordinary report's `*` and `_` into formatting errors, so the text goes as plain text:
    // a reply that fails to send is worse than a reply without bold.
    parse_mode: undefined,
    disable_web_page_preview: true,
  })
  state.data = await saveState(directory, { lastOutboundAt: new Date().toISOString(), lastOutboundFile: name })
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
  const replies = await drainOut({ directory, send: outbound, log, keepDays })
  return { updates: (updates ?? []).length, written, replies }
}

state.data = await loadState(directory)
log.info('config', { directory, mode, intervalMs, chatAllowList, offset: state.data.offset ?? 0, keepDays })
const { start } = supervise({ name: 'telegram', poll, log, intervalMs })
await start()
