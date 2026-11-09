#!/usr/bin/env node
/**
 * The QQ bridge: a QQ Bot WebSocket connection on one side, a myagent chat channel directory on the other.
 *
 *     QQ_APP_ID=xxx QQ_APP_SECRET=xxx MYAGENT_CHANNEL_DIR=/path/to/channels/qq-main \
 *       node bridge.mjs
 *
 * ## Why zero dependencies is possible here
 *
 * The official docs name WebSocket as the connection for exactly this deployment shape ("不依赖公网服务器部署，
 * 适合个人单机使用"). The protocol is documented (IDENTIFY/RESUME/heartbeat opcodes), and Node 22+ ships a native
 * `WebSocket`, so this bridge installs with nothing — the same reasoning that gave Telegram its zero-dependency
 * transport. No SDK means no SDK's reconnection policy to audit, but also no SDK's bugfixes: the reconnect paths
 * below are ours and are logged.
 *
 * ## Reply strategy: passive first, active as the fallback, queued if both refuse
 *
 * myagent's answers arrive long after the question, so a reply has two doors: the **passive** one (the inbound
 * message's id + an incrementing `msg_seq` — several replies per inbound inside its window) and the **active**
 * push (`/v2/users/{openid}/messages` — subject to the platform's per-user monthly quota). The bridge tries passive
 * first (no quota consumed), active second; when both refuse (window closed AND quota spent) the reply file STAYS
 * in `out/` and the panel shows it as 待取回信 — that is the honest shape: the platform closed the doors, and
 * pretending otherwise would be a bridge that logs success to a room that never heard anything.
 *
 * ## What it does and does not decide
 *
 * The bridge is a **transport**. It never decides who somebody is (`sources.chat.identities` does), whether they
 * may originate work (`allowedSenders` does), or what a Ticket may touch (`scope` does).
 *
 * ## The heartbeat
 *
 * The WebSocket's own heartbeat is protocol-level; myagent's file heartbeat is process-level. The outbound tick
 * touches `<directory>/.heartbeat` every 3 seconds, and a dead file says "the process died" even when the socket
 * looked fine right up to the end.
 */
import { createLog } from '../lib/log.mjs'
import { loadState, saveState } from '../lib/state.mjs'
import { writeMessage } from '../lib/inbound.mjs'
import { join } from 'node:path'
import { utimes, writeFile } from 'node:fs/promises'
import { drainOut } from '../lib/outbound.mjs'
import { parseRoute } from '../lib/route.mjs'
import { cleanText, mapEvent, nextSeq } from './transform.mjs'

const log = createLog('qq', { level: process.env.BRIDGE_LOG_LEVEL ?? 'info' })

const appId = process.env.QQ_APP_ID
const appSecret = process.env.QQ_APP_SECRET
const directory = process.env.MYAGENT_CHANNEL_DIR
const fail = message => {
  process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), bridge: 'qq', level: 'error', event: 'config', message })}\n`)
  process.exit(2)
}
if (!appId) fail('QQ_APP_ID is required — QQ 开放平台 → 机器人管理端 → 开发设置')
if (!appSecret) fail('QQ_APP_SECRET is required — 同上（App Secret）')
if (!directory) fail('MYAGENT_CHANNEL_DIR is required — sources.chat.channels[].directory')
if (typeof WebSocket !== 'function') fail('this bridge needs Node 22+ (native WebSocket)')

const allowUsers = (process.env.QQ_USERS ?? '').split(',').map(item => item.trim()).filter(Boolean)
const keepDays = Number(process.env.MYAGENT_REPLY_KEEP_DAYS ?? 7)
const heartbeatFile = join(directory, '.heartbeat')
const WS_URL = 'https://api.sgroup.qq.com/websocket'
const TOKEN_URL = 'https://bots.qq.com/app/getAppAccessToken'

/**
 * The documented text-content ceiling for a QQ message is 4096 bytes of UTF-8 in the API's generous reading and
 * less in the strict one; 600 characters chunks like the other bridges (CJK worst case 3 bytes/char), because a
 * chunk that always fits beats a ceiling that is argued about.
 */
const MESSAGE_LIMIT = 600

/** Touch the heartbeat (create once if missing) — see the file header for what it promises. */
const touchHeartbeat = async () => {
  const fresh = new Date()
  try {
    await utimes(heartbeatFile, fresh, fresh)
  } catch {
    try { await writeFile(heartbeatFile, `${fresh.toISOString()}\nbridge heartbeat: mtime says alive\n`, { flag: 'wx' }) }
    catch (error) { log.debug('heartbeat-create', { error: String(error?.message ?? error) }) }
  }
}

// ----------------------------------------------------------------- access token
const tokenState = { token: undefined, expiresAt: 0 }
const accessToken = async () => {
  if (tokenState.token !== undefined && Date.now() < tokenState.expiresAt) return tokenState.token
  const response = await fetch(TOKEN_URL, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ appId, clientSecret: appSecret }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || body.access_token === undefined) {
    throw new Error(`getAppAccessToken failed: HTTP ${response.status} ${JSON.stringify(body).slice(0, 200)}`)
  }
  tokenState.token = body.access_token
  tokenState.expiresAt = Date.now() + Math.max(0, Number(body.expires_in ?? 7200) * 1000 - 200_000)
  return tokenState.token
}

/** POST one JSON body to the v2 API with the bot's token. */
const post = async (path, data) => {
  const token = await accessToken()
  const response = await fetch(`https://api.sgroup.qq.com${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `QQBot ${token}` },
    body: JSON.stringify(data),
  })
  const body = await response.json().catch(() => ({}))
  return { ok: response.ok && (body.code === undefined || body.code === 0 || body.code === 304023 || body.code === 304024), body, status: response.status }
}

// ----------------------------------------------------------------- state and inbound
const state = { data: {} }

const onDispatch = async (event, payload) => {
  if (event !== 'C2C_MESSAGE_CREATE' && event !== 'GROUP_AT_MESSAGE_CREATE') {
    log.debug('skipped', { reason: `not-a-message:${event}` })
    return
  }
  const mapped = mapEvent(payload, { allowUsers })
  if (mapped.skip !== undefined) { log.debug('skipped', { reason: mapped.skip }); return }
  const { msgId, msgSeq, openid, groupOpenid, chatId, isDirect, ...message } = mapped.message
  await writeMessage({ directory, ...message })
  const routes = { ...(state.data.replyRoutes ?? {}) }
  // The reply address for this thread: passive (msgId + seq bookkeeping) and active (openid / group_openid).
  if (message.thread !== undefined) {
    routes[message.thread] = { msgId, seq: 0, openid, groupOpenid }
  }
  state.data = await saveState(directory, {
    replyRoutes: routes,
    defaultChat: isDirect || state.data.defaultChat === undefined ? chatId : state.data.defaultChat,
    lastInboundAt: new Date().toISOString(),
    lastInboundChat: chatId,
  })
  log.info('message-written', {
    event, from: message.from, thread: message.thread ?? null, chars: message.body.length,
    seq: nextSeq(routes[message.thread]?.seq),
  })
}

// ----------------------------------------------------------------- outbound
const sendPassive = async (carried, text) => {
  const seq = nextSeq(carried.seq)
  const result = await post('/v2/messages', { content: text, msg_type: 0, msg_id: carried.msgId, msg_seq: seq })
  // 304023/304024: window closed or reply refused — the documented "passive door is shut" answers.
  if (result.ok) return { seq }
  return { refused: `passive refused (HTTP ${result.status} code ${result.body.code ?? '?'})` }
}

const sendActive = async (carried, text) => {
  const path = carried.groupOpenid === undefined
    ? `/v2/users/${encodeURIComponent(carried.openid)}/messages`
    : `/v2/groups/${encodeURIComponent(carried.groupOpenid)}/messages`
  const result = await post(path, { content: text, msg_type: 0, msg_seq: 1 })
  if (result.ok) return { ok: true }
  return { refused: `active refused (HTTP ${result.status} code ${result.body.code ?? '?'}) — quota or permission` }
}

const outbound = async ({ thread, text, name }) => {
  const route = parseRoute(thread, state.data)
  const carried = state.data.replyRoutes?.[thread] ?? (route === undefined ? undefined : state.data.replyRoutes?.[route.threadId])
  if (carried === undefined) {
    throw new Error(`no reply address for thread ${thread ?? '(none)'} — the bridge has not seen an inbound message yet`)
  }
  // 被动门先开（不耗配额）；关了走主动门（耗平台配额）；两扇都关：留在 out/，面板见「待取回信」。
  const passive = await sendPassive(carried, text)
  if (passive.seq !== undefined) {
    const routes = { ...(state.data.replyRoutes ?? {}) }
    routes[thread] = { ...carried, seq: passive.seq }
    state.data = await saveState(directory, { replyRoutes: routes, lastOutboundAt: new Date().toISOString(), lastOutboundFile: name })
    log.info('reply-sent', { name, door: 'passive', seq: passive.seq, chars: text.length })
    return
  }
  log.warn('passive-refused', { thread, detail: passive.refused, next: 'active' })
  const active = await sendActive(carried, text)
  if (active.ok !== undefined) {
    state.data = await saveState(directory, { lastOutboundAt: new Date().toISOString(), lastOutboundFile: name })
    log.info('reply-sent', { name, door: 'active', chars: text.length })
    return
  }
  // 两扇门都关：抛出去（drainOut 把文件留在 out/），操作者在面板上看见它——不是桥坏了，是平台的门关了。
  throw new Error(`${passive.refused}; ${active.refused} — the reply stays queued in out/ (面板「待取回信」)，新消息会重新打开被动门`)
}

const sendOutboundFile = async ({ thread, filePath }) => {
  throw new Error(`file delivery is not implemented for QQ yet (${filePath}) — replies still arrive as text`)
}

const recordSentReceipt = async () => {
  // Receipt ledger arrives with the first live traffic, as for the other two new bridges: no invented shapes.
}

/** Outbound is polled, not pushed: `out/` is a directory, and myagent writes into it whenever an answer is owed. */
const startOutboundLoop = () => {
  const tick = async () => {
    try {
      await touchHeartbeat()
      await drainOut({ directory, send: outbound, sendFile: sendOutboundFile, onSent: recordSentReceipt, log, keepDays, limit: MESSAGE_LIMIT })
    } catch (error) {
      log.error('outbound-failed', { error: String(error?.message ?? error) })
    }
  }
  void tick()
  const timer = setInterval(() => void tick(), Number(process.env.MYAGENT_OUTBOUND_MS ?? 3_000))
  timer.unref?.()
  return timer
}

// ----------------------------------------------------------------- the WebSocket
/**
 * The protocol opcodes (official docs): 0 DISPATCH, 1 HEARTBEAT, 2 IDENTIFY, 6 RESUME, 7 RECONNECT, 10 HELLO.
 * `intents: 1 << 25` is the C2C-and-group-events window the docs name for robots of this kind.
 */
const session = { id: undefined, seq: undefined }
let socket = undefined

const connect = async () => {
  const token = await accessToken()
  await new Promise((resolve, reject) => {
    socket = new WebSocket(WS_URL, { headers: { authorization: `QQBot ${token}`, 'x-app-id': appId } })
    const openFailure = setTimeout(() => reject(new Error('websocket open timed out (30s)')), 30_000)
    socket.addEventListener('open', () => { clearTimeout(openFailure); resolve() })
    socket.addEventListener('error', event => { clearTimeout(openFailure); reject(new Error(`websocket error: ${String(event.message ?? 'unknown')}`)) })
  })
  let hello
  socket.addEventListener('message', event => {
    const frame = JSON.parse(String(event.data ?? '{}'))
    if (frame.op === 10) hello = frame.d
    if (frame.op === 0) {
      session.id = frame.session_id
      session.seq = frame.s
      void onDispatch(frame.t, frame.d).catch(error => log.error('inbound-failed', { error: String(error?.message ?? error) }))
    }
    if (frame.op === 7) { log.warn('server-asked-reconnect', { note: 'RESUME with the kept session, falling back to IDENTIFY' }); void reconnect() }
    if (frame.op === 11) log.debug('heartbeat-acked', {})
  })
  // IDENTIFY or RESUME: the kept session resumes the stream where it broke; a lost one re-identifies from zero
  // (the platform does not redeliver what was missed in between — the log says which path ran).
  socket.send(JSON.stringify({
    op: session.id === undefined ? 2 : 6,
    d: session.id === undefined
      ? { token: `QQBot ${token}`, intents: 1 << 25 }
      : { token: `QQBot ${token}`, session_id: session.id, seq: session.seq },
  }))
  const interval = hello?.heartbeat_interval ?? 30_000
  const beat = setInterval(() => {
    try { socket.send(JSON.stringify({ op: 1, d: session.seq })) }
    catch (error) { log.warn('heartbeat-failed', { error: String(error?.message ?? error) }) }
  }, interval)
  beat.unref?.()
  socket.addEventListener('close', ({ code, reason }) => {
    clearInterval(beat)
    log.warn('socket-closed', { code, reason: String(reason ?? ''), note: 'reconnecting with RESUME after 3s' })
    setTimeout(() => void reconnect(), 3_000)
  })
  log.info('connected', { transport: 'qq-websocket', resumed: session.id !== undefined, heartbeatMs: interval })
}

let reconnecting = false
const reconnect = async () => {
  if (reconnecting) return
  reconnecting = true
  try { await connect() } catch (error) {
    log.error('reconnect-failed', { error: String(error?.message ?? error), note: 'retrying in 30s' })
    setTimeout(() => void reconnect(), 30_000)
  } finally { reconnecting = false }
}

const main = async () => {
  state.data = await loadState(directory)
  log.info('config', { directory, allowUsers, keepDays, note: '个人主体：机器人只进自己是群主/管理员的群；私聊要加体验号码（README 有步骤）' })
  await connect()
  const timer = startOutboundLoop()
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { log.info('stopping', { reason: signal }); clearInterval(timer); try { socket?.close() } catch {}; process.exit(0) })
  }
}

await main()
