import { taskTitle } from '../lib/inbound.mjs'
import { formatRoute } from '../lib/route.mjs'

/**
 * The pure half of the DingTalk bridge: a Stream-mode robot message in, a channel message (or a reason to skip) out.
 *
 * Field paths below are taken from the official SDK's own type declarations
 * (`dingtalk-stream-sdk-nodejs@2.0.4`, `dist/constants.d.ts` — `RobotTextMessage`), not from memory: the shapes that
 * matter are `conversationId, chatbotUserId, msgId, senderNick, senderStaffId, sessionWebhook,
 * sessionWebhookExpiredTime, conversationType, msgtype, text.content`.
 *
 * Four decisions here are load-bearing:
 *
 * 1. **The `id` is `<conversationId>-<msgId>`.** DingTalk documents `msgId` as unique per message, but the SDK's
 *    types give no uniqueness scope, and the cost of assuming global uniqueness is the Telegram lesson (the same
 *    number in two conversations collapsing into one Trigger, silently deduplicated forever). Prefixing costs
 *    nothing and closes that door.
 * 2. **`from` is `senderStaffId`, and it stays that way.** `senderId` and `senderStaffId` are two different keys for
 *    one person (staff-level vs union-level); mixing them makes the same colleague two identities in
 *    `sources.chat.identities`, and the operator cannot tell why one of them stopped working.
 * 3. **The leading `@`-token is stripped from group text.** A group message that reached the robot necessarily
 *    @-mentioned it (that is the only way a robot hears a group), and DingTalk leaves the mention in
 *    `text.content`. Single chats carry no prefix, so nothing is stripped there — stripping a leading `@` from a
 *    DM could eat a legitimate "@审批人" reference.
 * 4. **`sessionWebhook` travels with the mapping** (and its expiry), because a reply can only go through the
 *    webhook the platform handed us with THIS message — the file contract stays platform-agnostic, so the bridge
 *    keeps the `thread → webhook` map in `.bridge-state.json`, like every other bridge keeps its routing.
 */

/**
 * The request text: a group message's leading @-mention of the bot is noise the worker would otherwise look past.
 * Only ONE leading token is stripped, and only in groups — see decision 3 above.
 */
export function cleanText(content, { isDirect } = {}) {
  const text = String(content ?? '').replace(/\s+/g, ' ').trim()
  if (isDirect) return text
  return text.replace(/^@\S+\s*/, '').trim()
}

/**
 * Is the sessionWebhook this message carried still inside its reply window? DingTalk expires these
 * (`sessionWebhookExpiredTime`, a ms timestamp); a webhook that is past its window returns an error on POST, which
 * reads as "the bridge is broken" on the health board. Refusing BEFORE the POST reads as "the platform closed the
 * door", which is what actually happened.
 */
export function replyWindowOpen(data, now = Date.now()) {
  const expiry = Number(data?.sessionWebhookExpiredTime)
  if (!Number.isFinite(expiry) || expiry <= 0) {
    // No expiry stated: treat the window as open and let the POST's own error be the verdict.
    return { open: true, expiryAt: undefined }
  }
  return { open: expiry > now, expiryAt: new Date(expiry).toISOString() }
}

/**
 * @param {object} data   one Stream-mode robot message (`DWClientDownStream.data`, parsed)
 * @param {{ mode?: 'mentions'|'dm'|'all', chatAllowList?: string[] }} [options]
 * @returns {{ message: object } | { skip: string }}
 */
export function mapEvent(data, { mode = 'mentions', chatAllowList = [] } = {}) {
  if (data === undefined || data === null) return { skip: 'not-a-message' }
  if (data.msgtype !== 'text') return { skip: `no-text:${String(data.msgtype ?? 'unknown')}` }
  const conversationId = String(data.conversationId ?? '')
  if (chatAllowList.length > 0 && !chatAllowList.includes(conversationId)) return { skip: 'chat-not-allowed' }
  const senderStaffId = data.senderStaffId === undefined || data.senderStaffId === ''
    ? data.senderId
    : data.senderStaffId
  if (senderStaffId === undefined || String(senderStaffId) === '') return { skip: 'no-sender' }
  // The bot's own outgoing messages do not arrive as robot-message events, but a self-loop is cheap to refuse
  // and expensive to debug: the sender IS the bot in the misconfigured-app case.
  if (data.chatbotUserId !== undefined && String(senderStaffId) === String(data.chatbotUserId)) {
    return { skip: 'own-message' }
  }
  const isDirect = String(data.conversationType) === '1'
  if (mode === 'dm' && !isDirect) return { skip: 'not-a-dm' }
  // `mode: 'mentions'` needs no mention check of its own: a group message only reaches a robot when it @-ed that
  // robot — the platform is the filter. The mode still exists so 'dm' (single chats only) and 'all' mean something.
  const body = cleanText(data.text?.content, { isDirect })
  if (body === '') return { skip: 'no-text:empty-after-clean' }
  const thread = formatRoute({ kind: isDirect ? 'dm' : 'group', chatId: conversationId })
  const senderNick = typeof data.senderNick === 'string' && data.senderNick.trim() !== ''
    ? data.senderNick.trim()
    : String(senderStaffId)
  return {
    message: {
      from: String(senderStaffId),
      id: `${conversationId}-${data.msgId}`,
      thread,
      title: taskTitle(senderNick, body),
      body,
      chatId: conversationId,
      isDirect,
      // The reply address this specific message carries; the bridge files it under `thread`.
      sessionWebhook: data.sessionWebhook,
      sessionWebhookExpiredTime: data.sessionWebhookExpiredTime,
    },
  }
}
