#!/usr/bin/env node
/**
 * The DingTalk bridge: a Stream-mode robot connection on one side, a myagent chat channel directory on the other.
 *
 *     cd bridges/dingtalk && npm install
 *     DINGTALK_CLIENT_ID=xxx DINGTALK_CLIENT_SECRET=xxx MYAGENT_CHANNEL_DIR=/path/to/channels/dingtalk-main \
 *       node bridge.mjs
 *
 * ## Why this bridge has a dependency
 *
 * DingTalk's Stream mode is a WebSocket protocol of the platform's own design (registration over HTTP, then
 * frames), and the official SDK (`dingtalk-stream-sdk-nodejs`) implements it. Hand-rolling a protocol nobody can
 * verify from documentation is the opposite of what a bridge should be — the same reasoning that gave Lark the
 * only other dependency in the suite. The SDK is used for TRANSPORT only: identity, authorization and
 * deduplication stay in myagent, and the message mapping stays in `transform.mjs`, which needs no SDK to test.
 *
 * ## What it does and does not decide
 *
 * The bridge is a **transport**. It never decides who somebody is (`sources.chat.identities` does), whether they
 * may originate work (`allowedSenders` does), or what a Ticket may touch (`scope` does).
 *
 * ## Replies go through the webhook the message carried
 *
 * DingTalk's robot model does not give a persistent "send into conversation X" API for free: each inbound message
 * carries a `sessionWebhook` with a limited lifetime (the platform documents ~90 minutes), and replies POST to it.
 * So the bridge keeps `thread → { webhook, expiry }` in `.bridge-state.json`, learned from inbound messages, and
 * **refuses before POSTing** when the window is past — a POST to an expired webhook returns a platform error that
 * would read as "the bridge is broken" on the health board, when what happened is "the platform closed the door".
 * A refused reply stays in `out/` (the panel shows it as 待取回信) until a newer message from the same
 * conversation re-opens the door.
 *
 * ## The heartbeat
 *
 * Stream mode is push-only: no poll loop exists to hang a heartbeat on, so the bridge touches
 * `<directory>/.heartbeat` on a 5-second interval of its own. The file says "the PROCESS is alive" (G-2's
 * contract), not "traffic is flowing" — an idle-but-healthy channel is alive, and myagent's staleness check
 * reads exactly that.
 */
import { createLog } from '../lib/log.mjs'
import { loadState, saveState } from '../lib/state.mjs'
import { writeMessage } from '../lib/inbound.mjs'
import { join } from 'node:path'
import { utimes, writeFile } from 'node:fs/promises'
import { basename } from 'node:path'
import { drainOut } from '../lib/outbound.mjs'
import { parseRoute } from '../lib/route.mjs'
import { mapEvent, replyWindowOpen } from './transform.mjs'

const log = createLog('dingtalk', { level: process.env.BRIDGE_LOG_LEVEL ?? 'info' })

const clientId = process.env.DINGTALK_CLIENT_ID
const clientSecret = process.env.DINGTALK_CLIENT_SECRET
const directory = process.env.MYAGENT_CHANNEL_DIR
const fail = message => {
  process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), bridge: 'dingtalk', level: 'error', event: 'config', message })}\n`)
  process.exit(2)
}
if (!clientId) fail('DINGTALK_CLIENT_ID is required — 开放平台 → 应用详情 → 凭证')
if (!clientSecret) fail('DINGTALK_CLIENT_SECRET is required — 同上')
if (!directory) fail('MYAGENT_CHANNEL_DIR is required — sources.chat.channels[].directory')

let SDK
try {
  SDK = await import('dingtalk-stream-sdk-nodejs')
} catch {
  fail('需要先安装依赖：cd bridges/dingtalk && npm install（Stream 模式的 WebSocket 协议用官方 SDK，原因见文件头）')
}

const mode = process.env.DINGTALK_MODE ?? 'mentions'
const chatAllowList = (process.env.DINGTALK_CHATS ?? '').split(',').map(item => item.trim()).filter(Boolean)
const keepDays = Number(process.env.MYAGENT_REPLY_KEEP_DAYS ?? 7)
const heartbeatFile = join(directory, '.heartbeat')

/**
 * DingTalk robot replies have no cleanly documented ceiling for plain text. 2000 characters is the conservative
 * number — long enough for any real answer's first chunk, short enough that a chunked report cannot be refused
 * outright. A real long reply on a live channel is the experiment that raises it; a refusal nobody ever sees is
 * not the experiment that lowers it.
 */
const MESSAGE_LIMIT = 2000

/** Touch the heartbeat file (create it once if missing) — see the file header for what it promises. */
const touchHeartbeat = async () => {
  const fresh = new Date()
  try {
    await utimes(heartbeatFile, fresh, fresh)
  } catch {
    try {
      await writeFile(heartbeatFile, `${fresh.toISOString()}\nbridge heartbeat: mtime says alive\n`, { flag: 'wx' })
    } catch (error) {
      log.debug('heartbeat-create', { file: heartbeatFile, error: String(error?.message ?? error) })
    }
  }
}

const state = { data: {} }

const onMessage = async data => {
  const mapped = mapEvent(data, { mode, chatAllowList })
  if (mapped.skip !== undefined) { log.debug('skipped', { reason: mapped.skip }); return }
  const { chatId, isDirect, sessionWebhook, sessionWebhookExpiredTime, ...message } = mapped.message
  const replyToTicket = undefined   // receipt ledger arrives with the first live traffic; see the README's TODO.
  await writeMessage({ directory, ...message, ...(replyToTicket === undefined ? {} : { replyToTicket }) })
  const routes = { ...(state.data.replyRoutes ?? {}) }
  if (message.thread !== undefined) {
    routes[message.thread] = { webhook: sessionWebhook, expiresAt: sessionWebhookExpiredTime }
  }
  state.data = await saveState(directory, {
    replyRoutes: routes,
    defaultChat: isDirect || state.data.defaultChat === undefined ? chatId : state.data.defaultChat,
    lastInboundAt: new Date().toISOString(),
    lastInboundChat: chatId,
  })
  log.info('message-written', {
    chat: chatId, thread: message.thread ?? null, from: message.from, chars: message.body.length,
    webhookWindow: replyWindowOpen({ sessionWebhookExpiredTime }).expiryAt ?? 'unknown',
  })
}

const outbound = async ({ thread, text, name }) => {
  const route = parseRoute(thread, state.data)
  // DingTalk's routes are `{webhook, expiresAt}` rather than a bare chat id — the platform has no
  // send-into-conversation API for a robot to fall back on, so there is nothing to do but the webhook.
  const carried = state.data.replyRoutes?.[thread]
  if (carried === undefined) {
    throw new Error(`no webhook known for thread ${thread ?? '(none)'} — the bridge has not seen an inbound message yet`)
  }
  const window = replyWindowOpen({ sessionWebhookExpiredTime: carried.expiresAt })
  if (!window.open) {
    // Refused BEFORE the POST: an expired webhook's platform error would read as "the bridge is broken" on the
    // health board. The reply file stays in out/ until a newer message re-opens the door; the log says that.
    throw new Error(`sessionWebhook for thread ${thread} expired at ${window.expiryAt} — the reply stays queued; a newer message from the same conversation re-opens the door`)
  }
  const response = await fetch(carried.webhook, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    // `text` rather than `markdown`: an answer must arrive as the worker wrote it, not re-interpreted into
    // someone's markup dialect — and msgtype errors are how an invisible reply happens.
    body: JSON.stringify({ msgtype: 'text', text: { content: text } }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || (body.errcode !== undefined && body.errcode !== 0)) {
    throw new Error(`sessionWebhook POST failed: HTTP ${response.status} ${body.errmsg ?? ''} (errcode ${body.errcode ?? '?'})`.trim())
  }
  state.data = await saveState(directory, { lastOutboundAt: new Date().toISOString(), lastOutboundFile: name })
  log.info('reply-sent', { name, thread: thread ?? null, chars: text.length })
}

const sendOutboundFile = async ({ thread, filePath }) => {
  // sessionWebhook accepts a text/markdown body only; files need the platform's upload API, which this first
  // version does not carry. Saying so is better than a silent no-op: the error lands in the bridge log where the
  // operator can see it, and the file stays in out/ rather than disappearing.
  throw new Error(`file delivery is not implemented for DingTalk yet (${basename(filePath)} stays queued) — replies still arrive as text`)
}

const recordSentReceipt = async () => {
  // Receipt ledger (sentMessages → replyToTicket) arrives with the first live traffic: the platform's reply
  // carries no message id we can key on until one is observed. Refusing to invent the shape now is the honest move.
}

/** Outbound is polled, not pushed: `out/` is a directory, and myagent writes into it whenever an answer is owed. */
const startOutboundLoop = () => {
  let inFlight = false
  const tick = async () => {
    if (inFlight) return  // B05 fix
    inFlight = true
    try {
      await touchHeartbeat()
      await drainOut({ directory, send: outbound, sendFile: sendOutboundFile, onSent: recordSentReceipt, log, keepDays, limit: MESSAGE_LIMIT })
    } catch (error) {
      log.error('outbound-failed', { error: String(error?.message ?? error) })
    } finally {
      inFlight = false
    }
  }
  void tick()
  const timer = setInterval(() => void tick(), Number(process.env.MYAGENT_OUTBOUND_MS ?? 3_000))
  timer.unref?.()
  return timer
}

const main = async () => {
  state.data = await loadState(directory)
  log.info('config', { directory, mode, chatAllowList, keepDays, sdk: SDK?.DWClient ? 'official' : 'unknown' })
  log.info('constraint', { note: '一个应用只能跑一个桥：Stream 模式的推送是集群分发而非广播，跑两个会把消息劈成两半，而两边看起来都健康' })
  const client = new SDK.DWClient({ clientId, clientSecret })
  client.registerCallbackListener(SDK.TOPIC_ROBOT, async message => {
    // `DWClientDownStream.data` is a JSON string (the SDK's own .d.ts says so; parsing is our job).
    let data
    try {
      data = JSON.parse(message?.data ?? '{}')
    } catch (error) {
      log.warn('event-unparsable', { error: String(error?.message ?? error) })
      return SDK.EventAck?.LATER
    }
    await onMessage(data)
    return SDK.EventAck?.SUCCESS
  })
  await client.connect()
  log.info('connected', { transport: 'dingtalk-stream-mode' })
  const timer = startOutboundLoop()
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { log.info('stopping', { reason: signal }); clearInterval(timer); process.exit(0) })
  }
}

await main()
