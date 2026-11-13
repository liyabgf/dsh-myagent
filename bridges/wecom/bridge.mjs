#!/usr/bin/env node
/**
 * The WeCom (企业微信) bridge: an HTTP callback server on one side, a myagent chat channel directory on the other.
 *
 *     WECOM_CORP_ID=ww_xxx WECOM_APP_SECRET=xxx WECOM_AGENT_ID=1000002 \
 *     WECOM_TOKEN=xxx WECOM_ENCODING_AES_KEY=xxx MYAGENT_CHANNEL_DIR=/path/to/channels/wecom-main \
 *       node bridge.mjs
 *
 * ## The one platform constraint that shapes everything: WeCom needs a PUBLIC URL
 *
 * There is no long-poll and no stream mode. A self-built app's messages arrive at an HTTP callback URL you
 * configure in the admin console, and that URL must be reachable from WeCom's servers — for a single-machine
 * deployment that means a reverse proxy or a tunnel in front of this process. The honest README documents both
 * options; the bridge itself only listens.
 *
 * ## Replies are active pushes, not passive callbacks
 *
 * The callback expects a passive reply within 5 seconds; myagent's answers arrive much later. So the bridge
 * answers POSTs with the literal string `success` (the documented "no passive reply" response) and sends real
 * answers later through `message/send` with the `touser` learned from the inbound message. Text messages carry
 * up to 2048 bytes; `drainOut` chunks by a conservative 600 characters so a CJK answer fits in one piece.
 *
 * ## What it does and does not decide
 *
 * The bridge is a **transport**. It never decides who somebody is (`sources.chat.identities` does), whether they
 * may originate work (`allowedSenders` does), or what a Ticket may touch (`scope` does).
 *
 * ## The heartbeat
 *
 * Push transport again: no poll loop to hang a heartbeat on, so the outbound tick touches
 * `<directory>/.heartbeat` every 3 seconds. The file says "the PROCESS is alive", not "traffic is flowing".
 */
import { createServer } from 'node:http'
import { createLog } from '../lib/log.mjs'
import { loadState, saveState } from '../lib/state.mjs'
import { writeMessage } from '../lib/inbound.mjs'
import { join } from 'node:path'
import { utimes, writeFile } from 'node:fs/promises'
import { drainOut } from '../lib/outbound.mjs'
import { parseRoute } from '../lib/route.mjs'
import { aesKeyFrom, verifiedDecrypt } from './crypt.mjs'
import { echoAnswer, mapMessage, xmlField } from './transform.mjs'

const log = createLog('wecom', { level: process.env.BRIDGE_LOG_LEVEL ?? 'info' })

const corpId = process.env.WECOM_CORP_ID
const appSecret = process.env.WECOM_APP_SECRET
const agentId = process.env.WECOM_AGENT_ID
const callbackToken = process.env.WECOM_TOKEN
const encodingAesKey = process.env.WECOM_ENCODING_AES_KEY
const directory = process.env.MYAGENT_CHANNEL_DIR
const port = Number(process.env.WECOM_PORT ?? 3001)
const fail = message => {
  process.stderr.write(`${JSON.stringify({ at: new Date().toISOString(), bridge: 'wecom', level: 'error', event: 'config', message })}\n`)
  process.exit(2)
}
if (!corpId) fail('WECOM_CORP_ID is required — 管理后台 → 我的企业 → 企业ID')
if (!appSecret) fail('WECOM_APP_SECRET is required — 管理后台 → 应用管理 → 自建应用 → Secret')
if (!agentId) fail('WECOM_AGENT_ID is required — 同上页面的 AgentId')
if (!callbackToken) fail('WECOM_TOKEN is required — 应用 → 接收消息 → 设置 API 接收 里的 Token')
if (!encodingAesKey) fail('WECOM_ENCODING_AES_KEY is required — 同上，43 位')
if (!directory) fail('MYAGENT_CHANNEL_DIR is required — sources.chat.channels[].directory')

const aesKey = aesKeyFrom(encodingAesKey)
const mode = process.env.WECOM_MODE ?? 'mentions'   // WeCom 只有单聊；mode 保留是为与其它桥同形。
const allowUsers = (process.env.WECOM_USERS ?? '').split(',').map(item => item.trim()).filter(Boolean)
const keepDays = Number(process.env.MYAGENT_REPLY_KEEP_DAYS ?? 7)
const heartbeatFile = join(directory, '.heartbeat')

/**
 * The text-message ceiling is 2048 BYTES (the platform's documented limit); a CJK answer is up to 3 bytes per
 * character, so 600 characters is the conservative chunk that keeps every piece under the byte limit without
 * measuring bytes per chunk — measuring is the honest version, chunking is the simple one, and 600 is the number
 * where the simple one stops lying.
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
const API = 'https://qyapi.weixin.qq.com'
const accessToken = async () => {
  if (tokenState.token !== undefined && Date.now() < tokenState.expiresAt) return tokenState.token
  const url = `${API}/cgi-bin/gettoken?corpid=${encodeURIComponent(corpId)}&corpsecret=${encodeURIComponent(appSecret)}`
  const response = await fetch(url)
  const body = await response.json().catch(() => ({}))
  if (body.errcode !== undefined && body.errcode !== 0) {
    throw new Error(`gettoken failed: errcode ${body.errcode} ${body.errmsg ?? ''}`.trim())
  }
  tokenState.token = body.access_token
  // Expire 200s early rather than at the platform's number: a send that lands in the last seconds and fails
  // reads as a bridge bug, and the refresh costs nothing when it is early.
  tokenState.expiresAt = Date.now() + Math.max(0, Number(body.expires_in ?? 7200) * 1000 - 200_000)
  return tokenState.token
}

// ----------------------------------------------------------------- inbound server
const state = { data: {} }

const onInbound = async (xml) => {
  const mapped = mapMessage(xml, { allowUsers })
  if (mapped.skip !== undefined) { log.debug('skipped', { reason: mapped.skip }); return }
  const { agentId: msgAgent, createTime, ...message } = mapped.message
  await writeMessage({ directory, ...message })
  const routes = { ...(state.data.replyRoutes ?? {}) }
  // The reply address: WeCom needs touser + agentid to push, learned from the inbound message.
  if (message.thread !== undefined) routes[message.thread] = { touser: message.from, agentid: Number(agentId) }
  state.data = await saveState(directory, {
    replyRoutes: routes,
    defaultChat: message.from,   // a corp has no public rooms for a robot: whoever last spoke is the default.
    lastInboundAt: new Date().toISOString(),
    lastInboundChat: message.from,
  })
  log.info('message-written', { from: message.from, thread: message.thread ?? null, chars: message.body.length, createTime: createTime ?? null })
}

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`)
  if (url.pathname !== '/callback') {
    res.writeHead(404, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ error: 'this bridge only serves /callback' }))
    return
  }
  const timestamp = String(url.searchParams.get('timestamp') ?? '')
  const nonce = String(url.searchParams.get('nonce') ?? '')
  const msgSignature = String(url.searchParams.get('msg_signature') ?? '')
  const finish = (status, body) => {
    res.writeHead(status, { 'content-type': 'text/plain; charset=utf-8' })
    res.end(body)
  }
  try {
    if (req.method === 'GET') {
      // URL verification: the admin console sends an encrypted echostr; the right answer is the decrypted text.
      const echo = String(url.searchParams.get('echostr') ?? '')
      const plain = verifiedDecrypt({ token: callbackToken, aesKey, corpId, timestamp, nonce, msgSignature, encrypted: echo })
      const answer = echoAnswer(plain)
      log.info('callback-verified', { chars: answer.length })
      finish(200, answer)
      return
    }
    if (req.method !== 'POST') { finish(405, 'method not allowed'); return }
    // B04 fix: limit body size before buffering to prevent memory exhaustion from unauthenticated POST.
    const MAX_BODY_BYTES = 64 * 1024
    let totalBytes = 0
    const chunks = []
    req.on('data', chunk => {
      totalBytes += chunk.length
      if (totalBytes > MAX_BODY_BYTES) {
        finish(413, 'body too large')
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      if (totalBytes > MAX_BODY_BYTES) return  // already responded
      const raw = Buffer.concat(chunks).toString('utf8')
      try {
        const encrypted = xmlField(raw, 'Encrypt')
        if (encrypted === undefined) {
          log.warn('unencrypted-post', { bytes: raw.length, note: 'callback bodies are encrypted; this was not' })
          finish(400, 'expected an encrypted body')
          return
        }
        const plain = verifiedDecrypt({ token: callbackToken, aesKey, corpId, timestamp, nonce, msgSignature, encrypted })
        // B04 fix: write the file BEFORE responding, then ack 200.
        // The original code acked first to satisfy the 5s window; that creates a gap where the
        // platform received 200 but the file was never written. If we cannot write, we return a
        // non-200 so the platform will re-push.
        onInbound(plain).then(() => { finish(200, 'success') }).catch(error => {
          log.error('inbound-failed', { error: String(error?.message ?? error) })
          finish(500, 'inbound write failed')
        })
      } catch (error) {
        log.error('callback-rejected', { error: String(error?.message ?? error) })
        finish(400, 'bad signature or key')
      }
    })
  } catch (error) {
    log.error('server-error', { error: String(error?.message ?? error) })
    finish(500, 'internal error')
  }
})

// ----------------------------------------------------------------- outbound
const outbound = async ({ thread, text, name }) => {
  const route = parseRoute(thread, state.data)
  const carried = state.data.replyRoutes?.[thread]
  const touser = route?.chatId ?? carried?.touser
  if (touser === undefined) {
    throw new Error(`no reply address for thread ${thread ?? '(none)'} — the bridge has not seen an inbound message yet`)
  }
  const token = await accessToken()
  const response = await fetch(`${API}/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      touser: String(touser),
      msgtype: 'text',
      agentid: Number(agentId),
      text: { content: text },
      safe: 0,
    }),
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || (body.errcode !== undefined && body.errcode !== 0)) {
    throw new Error(`message/send failed: HTTP ${response.status} errcode ${body.errcode} ${body.errmsg ?? ''}`.trim())
  }
  state.data = await saveState(directory, { lastOutboundAt: new Date().toISOString(), lastOutboundFile: name })
  log.info('reply-sent', { name, touser, chars: text.length })
  return body.msgid === undefined ? undefined : { messageId: String(body.msgid) }
}

const sendOutboundFile = async ({ thread, filePath }) => {
  throw new Error(`file delivery is not implemented for WeCom yet (${filePath}) — replies still arrive as text`)
}

const recordSentReceipt = async () => {
  // Receipt ledger arrives with the first live traffic, as for DingTalk: no replyToTicket until a real push
  // receipt is observed. Refusing to invent the shape now is the honest move.
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
  log.info('config', { directory, mode, allowUsers, port, agentId, keepDays })
  log.info('constraint', { note: '企业微信没有长轮询与 Stream：回调 URL 必须公网可达（反向代理或隧道，README 有两条现成的路子）' })
  server.listen(port, () => {
    log.info('listening', { url: `http://0.0.0.0:${port}/callback`, note: '回调 URL 要能从企业微信的服务器到达——公网入口是你自己的反向代理或隧道' })
  })
  const timer = startOutboundLoop()
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => { log.info('stopping', { reason: signal }); clearInterval(timer); server.close(); process.exit(0) })
  }
}

await main()
