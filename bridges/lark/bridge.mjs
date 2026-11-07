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
import { drainOut } from '../lib/outbound.mjs'
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
  const { chatId, isDirect, ...message } = mapped.message
  await writeMessage({ directory, ...message })
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
  const chatId = (thread !== undefined ? state.data.replyRoutes?.[thread] : undefined) ?? state.data.defaultChat
  if (thread !== undefined) {
    try {
      // Answer inside the same reply chain. The message id a thread carries IS a message id in Lark, so this is the
      // direct way to keep a conversation in one place instead of adding a new top-level message each time.
      await client.request({
        method: 'POST', url: `/open-apis/im/v1/messages/${encodeURIComponent(thread)}/reply`,
        data: { content: JSON.stringify({ text }), msg_type: 'text' },
      })
      state.data = await saveState(directory, { lastOutboundAt: new Date().toISOString(), lastOutboundFile: name })
      return
    } catch (error) {
      // Fall through to posting into the chat: an answer in the wrong place still beats no answer, and the reason is
      // in the log rather than swallowed.
      log.warn('reply-failed-falling-back-to-chat', { thread, error: String(error?.message ?? error) })
    }
  }
  if (chatId === undefined) throw new Error(`no chat known for thread ${thread ?? '(none)'} — the bridge has not seen an inbound message yet`)
  await client.im.message.create({
    params: { receive_id_type: 'chat_id' },
    data: { receive_id: chatId, content: JSON.stringify({ text }), msg_type: 'text' },
  })
  state.data = await saveState(directory, { lastOutboundAt: new Date().toISOString(), lastOutboundFile: name })
}

/** Outbound is polled, not pushed: `out/` is a directory, and myagent writes into it whenever an answer is owed. */
const startOutboundLoop = () => {
  const tick = async () => {
    try {
      await drainOut({ directory, send: outbound, log, keepDays })
    } catch (error) {
      log.error('outbound-failed', { error: String(error?.message ?? error) })
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
