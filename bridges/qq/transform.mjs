import { taskTitle } from '../lib/inbound.mjs'
import { formatRoute } from '../lib/route.mjs'

/**
 * The pure half of the QQ bridge: one WebSocket dispatch payload in, a channel message (or a reason to skip) out.
 *
 * Field paths below are taken from the official docs' v2 event payloads (`C2C_MESSAGE_CREATE`,
 * `GROUP_AT_MESSAGE_CREATE` — `id`, `content`, `author.id` (openid), `group_openid`, `timestamp`), not from memory;
 * the first live dispatch is the real verification, and the bridge logs it in full for exactly that reason.
 *
 * Four decisions here are load-bearing:
 *
 * 1. **`from` is `author.id` — the per-bot openid, and it stays that way.** The SAME person has a DIFFERENT openid
 *    per bot, so an identity mapped for one bot cannot be reused for another; the README says this out loud because
 *    it is the one QQ fact that silently breaks an identity map.
 * 2. **`id` is the platform's event/message id verbatim.** It is globally unique per the docs — unlike Telegram's
 *    per-chat numbering, no scoping prefix is needed, and adding one would only hide the shape.
 * 3. **Group text keeps its leading @-mention in `content` and it is stripped here; C2C content is used verbatim.**
 *    A group message only reaches the bot when it @-ed it (the platform is the filter, as with DingTalk).
 * 4. **`seq` travels with the mapping** — the reply API wants the INBOUND message id and an incrementing `msg_seq`
 *    (up to 5 replies per inbound), so the bridge tracks `thread → {msgId, seq}` and the reply path stays testable.
 */

/** Strip a group message's leading bot-mention (QQ leaves it in `content`); C2C text is used as-is. */
export function cleanText(content, { isDirect } = {}) {
  const text = String(content ?? '').replace(/\s+/g, ' ').trim()
  if (isDirect) return text
  // 群里 QQ 把 @ 的名字留在 content 开头（也可能是斜杠命令）；剥一个前导 token，其余按正文。
  return text.replace(/^\/?\S+\s*/, '').trim()
}

/**
 * The passive-reply bookkeeping: QQ's reply API takes the inbound message's id and an incrementing `msg_seq`
 * (documented as several replies per inbound within its window). One ticket's answer is usually one reply, so the
 * bridge starts at 1 and counts; when the window closes the reply falls back to an active push (quota-limited).
 */
export const nextSeq = (previous = 0) => previous + 1

/**
 * @param {object} payload   one dispatch `d` payload
 * @param {{ allowUsers?: string[] }} [options]
 * @returns {{ message: object } | { skip: string }}
 */
export function mapEvent(payload, { allowUsers = [] } = {}) {
  if (payload === undefined || payload === null) return { skip: 'not-a-message' }
  const content = payload.content
  if (typeof content !== 'string') return { skip: `no-text:${payload.attachments !== undefined ? 'attachment' : 'unknown'}` }
  const from = payload.author?.id === undefined || payload.author?.id === ''
    ? payload.author?.member_openid
    : payload.author.id
  if (from === undefined || String(from) === '') return { skip: 'no-sender' }
  if (allowUsers.length > 0 && !allowUsers.includes(String(from))) return { skip: 'user-not-allowed' }
  const isDirect = payload.group_openid === undefined
  const body = cleanText(content, { isDirect })
  if (body === '') return { skip: 'no-text:empty-after-clean' }
  const chatId = isDirect ? String(from) : String(payload.group_openid)
  const thread = formatRoute({ kind: isDirect ? 'dm' : 'group', chatId })
  return {
    message: {
      from: String(from),
      id: String(payload.id),
      thread,
      title: taskTitle(String(from), body),
      body,
      chatId,
      isDirect,
      // The reply address: passive first (msgId + seq), active as the fallback (openid / group_openid).
      msgId: String(payload.id),
      msgSeq: 0,
      openid: String(from),
      groupOpenid: isDirect ? undefined : String(payload.group_openid),
    },
  }
}
