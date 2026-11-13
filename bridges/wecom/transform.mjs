import { taskTitle } from '../lib/inbound.mjs'
import { formatRoute } from '../lib/route.mjs'

/**
 * The pure half of the WeCom bridge: one decrypted callback XML in, a channel message (or a reason to skip) out.
 *
 * WeCom's callback body is XML with a fixed, small key set — `<xml><ToUserName/><FromUserName/><MsgType/>
 * <Content/><MsgId/><CreateTime/><AgentID/></xml>`. There is no nesting, no attributes, no namespaces, so a
 * well-scoped extractor over the documented keys is the honest parser: a general XML library would add a
 * dependency to guard against shapes this protocol does not have.
 *
 * Three decisions here are load-bearing:
 *
 * 1. **`from` is `FromUserName` (the corp userid), and it stays that way.** The same person may also have an
 *    open-userid for cross-corp scenarios; mixing them makes one colleague two identities in
 *    `sources.chat.identities`.
 * 2. **`id` is `FromUserName-<MsgId>`** — WeCom documents `MsgId` uniqueness only as "unique for each message
 *    arrival", which retries can duplicate by design, but says nothing about scope across users; prefixing costs
 *    nothing and closes the two-users-one-id door the Telegram bridge documented.
 * 3. **Only `text` messages map.** The other types (image/voice/event/…) have no place in a request text yet;
 *    skipping with the type named is visible in the log, unlike skipping silently.
 */

/** The known callback keys; anything else in the XML is none of this bridge's business. */
export const xmlField = (xml, key) => {
  const match = new RegExp(`<${key}><!\\[CDATA\\[(.*?)\\]\\]></${key}>`, 's').exec(String(xml ?? ''))
  if (match !== null) return match[1]
  const plain = new RegExp(`<${key}>([^<]*)</${key}>`, 's').exec(String(xml ?? ''))
  return plain === null ? undefined : plain[1]
}

/**
 * The URL-verification echostr: WeCom sends it encrypted on the GET when you configure the callback URL, and the
 * correct response is the DECRYPTED string, verbatim. This is the first thing that happens on a live deployment
 * and the loudest place a crypto bug can speak.
 */
export const echoAnswer = (decrypted) => String(decrypted ?? '').trim()

/**
 * @param {string} xml   one decrypted callback body
 * @param {{ allowUsers?: string[] }} [options]
 * @returns {{ message: object } | { skip: string }}
 */
export const mapMessage = (xml, { allowUsers = [] } = {}) => {
  if (xml === undefined || xml === null || String(xml).trim() === '') return { skip: 'not-a-message' }
  const msgType = xmlField(xml, 'MsgType')
  if (msgType !== 'text') return { skip: `no-text:${String(msgType ?? 'unknown')}` }
  const from = xmlField(xml, 'FromUserName')
  if (from === undefined || from === '') return { skip: 'no-sender' }
  if (allowUsers.length > 0 && !allowUsers.includes(from)) return { skip: 'user-not-allowed' }
  const body = String(xmlField(xml, 'Content') ?? '').replace(/\s+/g, ' ').trim()
  if (body === '') return { skip: 'no-text:empty' }
  const agentId = xmlField(xml, 'AgentID')
  // B03 fix: use the actual sender (FromUserName) as the dm coordinate, not the AgentID.
  // Previously thread=dm:AgentID, so all users shared one thread and outbound touser was wrong.
  const thread = formatRoute({ kind: 'dm', chatId: String(from) })
  return {
    message: {
      from: String(from),
      id: `${from}-${xmlField(xml, 'MsgId') ?? xmlField(xml, 'CreateTime')}`,
      thread,
      title: taskTitle(String(from), body),
      body,
      agentId,
      createTime: xmlField(xml, 'CreateTime'),
    },
  }
}
