#!/usr/bin/env node
/**
 * The Lark/Feishu bridge: a long-connection event subscription on one side, a myagent chat channel directory on the
 * other.
 *
 *     cd bridges/lark && npm install
 *     LARK_APP_ID=cli_xxx LARK_APP_SECRET=xxx MYAGENT_CHANNEL_DIR=/path/to/channels/lark-main \
 *       node bridge.mjs
 *
 * ## Why this one bridge has a dependency
 *
 * Every other bridge is dependency-free, because its platform speaks plain HTTP. Lark's long-connection transport
 * speaks **protobuf over a WebSocket** (the official SDK ships ~29 KB of generated `pbbp2` code for it), so
 * reimplementing it with no dependencies would mean hand-writing a protocol nobody can verify from documentation —
 * the opposite of what a bridge should be. The official SDK is used for transport ONLY: identity, authorization and
 * deduplication stay in myagent, and the message mapping stays in `transform.mjs`, which needs no SDK to test.
 *
 * ## Three platform constraints that shape this file
 *
 * - **An event must be handled within 3 seconds or Lark re-pushes it.** So the handler writes one file and returns;
 *   it never waits on myagent, and never calls an API on the inbound path (chat names are cached from an earlier
 *   lookup, not fetched here). A re-push is harmless — the file name is the message id, so the second write is the
 *   same bytes — but a slow handler would double every message.
 * - **Pushes are cluster-distributed, not broadcast: with several clients on one app, only one random client gets
 *   each event.** So run exactly ONE bridge per app. Two bridges do not duplicate work, they SPLIT it, and each one
 *   looks healthy while half the messages go to the other.
 * - **Long connection carries event subscriptions only**, not card callbacks. Interactive cards would need webhook
 *   mode; nothing here needs them.
 *
 * ## Routing a reply back
 *
 * A reply file carries `thread` (Lark's `root_id`) and text, but not a chat id — the file contract is
 * platform-agnostic. So the bridge keeps the `thread → chat_id` and `defaultChat` it learned from inbound messages,
 * in `.bridge-state.json`. Replying into the thread uses `im.message.reply`; if that is unavailable the bridge falls
 * back to posting into the chat, because an answer in the wrong place still beats no answer.
 */
import { createLog } from '../lib/log.mjs'
import { loadState, saveState } from '../lib/state.mjs'
import { writeMessage } from '../lib/inbound.mjs'
import { utimes, writeFile } from 'node:fs/promises'
import { createReadStream } from 'node:fs'
import { basename, join } from 'node:path'
import { drainOut } from '../lib/outbound.mjs'
import { parseRoute } from '../lib/route.mjs'
import { mapEvent } from './transform.mjs'

const log = createLog('lark', { level: process.env.BRIDGE_LOG_LEVEL ?? 'info' })

const appId = process.env.LARK_APP_ID
const appSecret = process.env.LARK_APP_SECRET
const directory = process.env.MYAGENT_CHANNEL_DIR
const fail = message => {
  process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), bridge: 'lark', level: 'error', event: 'config', message })}\n`)
  process.exit(2)
}
if (!appId) fail('LARK_APP_ID is required — 开发者后台 → 凭证与基础信息')
if (!appSecret) fail('LARK_APP_SECRET is required — 同上')
if (!directory) fail('MYAGENT_CHANNEL_DIR is required — sources.chat.channels[].directory')

let lark
try {
  lark = await import('@larksuiteoapi/node-sdk')
} catch {
  fail('需要先安装依赖：cd bridges/lark && npm install（这个桥是套件里唯一需要装依赖的，原因见文件头）')
}

const mode = process.env.LARK_MODE ?? 'mentions'
const chatAllowList = (process.env.LARK_CHATS ?? '').split(',').map(item => item.trim()).filter(Boolean)
const keepDays = Number(process.env.MYAGENT_REPLY_KEEP_DAYS ?? 7)
const domain = process.env.LARK_DOMAIN === 'lark' ? lark.Domain.Lark : lark.Domain.Feishu

const client = new lark.Client({ appId, appSecret, domain, appType: lark.AppType.SelfBuild })

const state = { data: await loadState(directory) }
const chatNames = new Map(state.data.chatNames ?? {})

/**
 * The bot's own open_id, so a group mention of THIS bot can be told apart from a mention of somebody else.
 * `LARK_BOT_OPEN_ID` overrides it. If neither is available the bridge falls back to "any mention counts", which is
 * permissive — and says so in the log, because a filter that is looser than it looks is worse than one that is
 * stricter.
 */
const resolveBotOpenId = async () => {
  if (process.env.LARK_BOT_OPEN_ID) return process.env.LARK_BOT_OPEN_ID
  try {
    const info = await client.request({ method: 'GET', url: '/open-apis/bot/v3/info' })
    const openId = info?.bot?.open_id
    if (typeof openId === 'string' && openId !== '') return openId
    log.warn('bot-open-id-unavailable', { reason: 'bot/v3/info 没给出 open_id', effect: '群里任何 @ 都会被视为找它' })
  } catch (error) {
    log.warn('bot-open-id-unavailable', { error: String(error?.message ?? error), effect: '群里任何 @ 都会被视为找它' })
  }
  return undefined
}

/** A chat's name, for the message title. Looked up OUTSIDE the 3-second handler and cached; never on the hot path. */
const chatName = async chatId => {
  if (chatNames.has(chatId)) return chatNames.get(chatId)
  try {
    const info = await client.request({ method: 'GET', url: `/open-apis/im/v1/chats/${encodeURIComponent(chatId)}` })
    const name = typeof info?.data?.name === 'string' && info.data.name !== '' ? info.data.name : undefined
    chatNames.set(chatId, name)
    state.data = await saveState(directory, { chatNames: Object.fromEntries(chatNames) })
    return name
  } catch (error) {
    // A name is a courtesy: without it the Source falls back to the file name, which still identifies the message.
    log.warn('chat-name-unavailable', { chatId, error: String(error?.message ?? error) })
    chatNames.set(chatId, undefined)
    return undefined
  }
}

const onMessage = async event => {
  const mapped = mapEvent(event, {
    botOpenId: state.data.botOpenId,
    mode,
    chatAllowList,
  })
  if (mapped.skip !== undefined) { log.debug('skipped', { reason: mapped.skip }); return }
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
  log.info('message-written', { chat: chatId, thread: message.thread ?? null, from: message.from, chars: message.body.length })
  // Fill in chat names in the background: the 3-second deadline belongs to the event, not to a courtesy lookup.
  if (!chatNames.has(chatId)) void chatName(chatId).catch(() => {})
}

const outbound = async ({ thread, text, name }) => {
  const route = parseRoute(thread, state.data)
  const chatId = route?.chatId
  const replyTarget = route?.kind === 'topic' || route?.kind === 'legacy' ? route.threadId : undefined
  if (replyTarget !== undefined) {
    try {
      const res = await client.request({
        method: 'POST', url: `/open-apis/im/v1/messages/${encodeURIComponent(replyTarget)}/reply`,
        data: { content: JSON.stringify({ text }), msg_type: 'text' },
      })
      state.data = await saveState(directory, { lastOutboundAt: new Date().toISOString(), lastOutboundFile: name })
      const msgId = res?.data?.message_id
      return msgId ? { messageId: String(msgId) } : undefined
    } catch (error) {
      log.warn('reply-failed-falling-back-to-chat', { thread, error: String(error?.message ?? error) })
    }
  }
  if (chatId === undefined) throw new Error(`no chat known for thread ${thread ?? '(none)'} — the bridge has not seen an inbound message yet`)
  const res = await client.im.message.create({
    params: { receive_id_type: 'chat_id' },
    data: { receive_id: chatId, content: JSON.stringify({ text }), msg_type: 'text' },
  })
  state.data = await saveState(directory, { lastOutboundAt: new Date().toISOString(), lastOutboundFile: name })
  const msgId = res?.data?.message_id
  return msgId ? { messageId: String(msgId) } : undefined
}

const sendOutboundFile = async ({ thread, filePath }) => {
  const route = parseRoute(thread, state.data)
  const chatId = route?.chatId
  if (chatId === undefined) throw new Error(`no chat known for file on thread ${thread ?? '(none)'}`)
  const uploaded = await client.im.file.create({
    data: { file_type: 'stream', file_name: basename(filePath), file: createReadStream(filePath) },
  })
  const fileKey = uploaded?.data?.file_key ?? uploaded?.file_key
  if (!fileKey) throw new Error(`Lark file upload returned no file_key for ${basename(filePath)}`)
  await client.im.message.create({
    params: { receive_id_type: 'chat_id' },
    data: { receive_id: chatId, content: JSON.stringify({ file_key: fileKey }), msg_type: 'file' },
  })
  log.info('file-sent', { chat: chatId, file: basename(filePath) })
}

const recordSentReceipt = async ({ messageId, ticketId }) => {
  const existing = { ...(state.data.sentMessages ?? {}), [messageId]: ticketId }
  state.data = await saveState(directory, { sentMessages: existing })
}

/**
 * 【G-2 补缺口】心跳：长连接是推送制，没有轮询循环可挂，所以进程自己每 3 秒（随出站 tick）touch
 * `<频道目录>/.heartbeat`。文件说的是「进程活着」不是「流量在流」，与 G-2 的判据一致——
 * 之前飞书桥是唯一没接心跳的 ready 桥（§4.146 记过这个洞）。
 */
const heartbeatFile = join(directory, '.heartbeat')
const touchHeartbeat = async () => {
  const fresh = new Date()
  try {
    await utimes(heartbeatFile, fresh, fresh)
  } catch {
    try { await writeFile(heartbeatFile, `${fresh.toISOString()}\nbridge heartbeat: mtime says alive\n`, { flag: 'wx' }) }
    catch (error) { log.debug('heartbeat-create', { error: String(error?.message ?? error) }) }
  }
}

/** Outbound is polled, not pushed: `out/` is a directory, and myagent writes into it whenever an answer is owed. */
const startOutboundLoop = () => {
  let inFlight = false
  const tick = async () => {
    if (inFlight) return  // B05 fix
    inFlight = true
    try {
      await touchHeartbeat()
      await drainOut({ directory, send: outbound, sendFile: sendOutboundFile, onSent: recordSentReceipt, log, keepDays })
    } catch (error) {
      log.error('outbound-failed', { error: String(error?.message ?? error) })
    } finally {
      inFlight = false
    }
  }
  void tick()
  const timer = setInterval(() => void tick(), Number(process.env.MYAGENT_OUTBOUND_MS ?? 3_000))
  // Do not hold the process open for the timer alone: a SIGTERM should stop the bridge, not wait for the next tick.
  timer.unref?.()
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { log.info('stopping', { reason: signal }); clearInterval(timer); process.exit(0) })
  }
}

const main = async () => {
  state.data = await saveState(directory, { botOpenId: await resolveBotOpenId() })
  log.info('config', {
    directory, mode, chatAllowList, domain: process.env.LARK_DOMAIN ?? 'feishu',
    botOpenId: state.data.botOpenId ?? null, keepDays,
  })
  log.info('constraint', { note: '一个应用只能跑一个桥：推送是集群分发而非广播，跑两个会把消息劈成两半，而两边看起来都健康' })
  const dispatcher = new lark.EventDispatcher({}).register({ 'im.message.receive_v1': onMessage })
  const wsClient = new lark.WSClient({ appId, appSecret, domain, loggerLevel: lark.LoggerLevel.info })
  await wsClient.start({ eventDispatcher: dispatcher })
  log.info('connected', { transport: 'websocket-long-connection' })
  startOutboundLoop()
}

await main()
