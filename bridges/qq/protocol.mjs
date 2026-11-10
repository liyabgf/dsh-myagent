/**
 * The QQ WebSocket protocol's DECISIONS, apart from its socket.
 *
 * Why this file exists: the first version of this bridge put the frame handling inline in `bridge.mjs`, whose top
 * level runs `await main()` — so importing it in a test connects to the platform. The result was a protocol bug
 * that no offline test could have caught and that production reported 46 times in a row (a socket dropped every
 * ~60s with code 1006, beside a perfectly fresh heartbeat file). Every rule the platform enforces is now a pure
 * function here, and `tests/bridges.spec.ts` pins each one:
 *
 * 1. IDENTIFY must not go out before HELLO (op 10) — and the heartbeat interval is HELLO's, never a fallback;
 * 2. `shard` is part of IDENTIFY;
 * 3. `session_id` comes from the READY dispatch ONLY — reading it off every frame clobbers it to `undefined`,
 *    which silently turns every RESUME into a fresh IDENTIFY;
 * 4. op 9 (invalid session) means RESUME is off the table; op 7 (reconnect) means close and reopen.
 *
 * The transport (open, send, timers) stays in `bridge.mjs`, where a live account is the only test that counts.
 */

/** Frame opcodes, as the platform numbers them. */
export const OP = {
  DISPATCH: 0, HEARTBEAT: 1, IDENTIFY: 2, RESUME: 6, RECONNECT: 7,
  INVALID_SESSION: 9, HELLO: 10, HEARTBEAT_ACK: 11,
}

/** C2C_MESSAGE_CREATE and GROUP_AT_MESSAGE_CREATE: what a personal-subject bot can be given. */
export const INTENTS = 1 << 25

/**
 * What HELLO tells us. `heartbeatMs` falls back to 30s only if the frame carries nothing usable — a wrong interval
 * is not a cosmetic detail: the server drops a socket whose heartbeats do not arrive on ITS schedule, which is
 * precisely the 60-second 1006 loop this module was extracted to prevent.
 */
export const helloOf = frame => ({
  heartbeatMs: Number(frame?.d?.heartbeat_interval) > 0 ? Number(frame.d.heartbeat_interval) : 30_000,
})

/**
 * The handshake frame for a session state: RESUME when a session id was kept, IDENTIFY otherwise.
 * @param {string} token the `QQBot <access_token>` string
 * @param {{ id?: string, seq?: number }} session
 */
export const handshakeFrame = (token, session) => (session?.id === undefined
  ? { op: OP.IDENTIFY, d: { token, intents: INTENTS, shard: [0, 1] } }
  : { op: OP.RESUME, d: { token, session_id: session.id, seq: session.seq ?? 0 } })

/** One heartbeat frame: the last sequence number seen, or null before any dispatch. */
export const heartbeatFrame = seq => ({ op: OP.HEARTBEAT, d: typeof seq === 'number' ? seq : null })

/**
 * Read one DISPATCH frame: the new sequence number, whether it carried the session id, and what to do with it.
 *
 * `sessionId` is non-undefined ONLY on READY. That single rule is the difference between a bridge that can resume
 * and one that re-identifies forever: every other dispatch has no `session_id` at the top level, so assigning from
 * each of them erases the one READY gave us.
 *
 * @returns {{ seq?: number, sessionId?: string, resumed?: boolean, dispatch?: { type: string, data: unknown } }}
 */
export const dispatchOf = frame => {
  const out = {}
  if (typeof frame?.s === 'number') out.seq = frame.s
  if (frame?.t === 'READY') {
    if (frame.d?.session_id !== undefined) out.sessionId = String(frame.d.session_id)
    out.resumed = Boolean(frame.d?.resumed)
    return out
  }
  if (frame?.t === 'RESUMED') { out.resumed = true; return out }
  if (frame?.t !== undefined && frame?.t !== null) out.dispatch = { type: String(frame.t), data: frame.d }
  return out
}

/** What a control frame asks us to do; `none` for anything we only log. */
export const controlOf = frame => {
  switch (frame?.op) {
    case OP.RECONNECT: return { action: 'reconnect', dropSession: false }
    case OP.INVALID_SESSION: return { action: 'reconnect', dropSession: true }
    case OP.HEARTBEAT_ACK: return { action: 'ack' }
    default: return { action: 'none' }
  }
}
