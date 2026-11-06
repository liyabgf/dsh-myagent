import { describeError } from './log.mjs'

/**
 * The loop every bridge runs: poll, back off when something throws, stop cleanly on a signal, and say once in a
 * while that it is still alive.
 *
 * Backoff matters because the alternative is a bridge that fails 20 times a second against a platform that is
 * rate-limiting it — which reads as an attack, and can get the credentials revoked. The ceiling is deliberately
 * modest: a bridge that has been failing for ten minutes should still notice recovery within a minute.
 *
 * `stop()` is exposed (rather than only handled here) so a bridge can be driven from a test without signals.
 */
export function supervise({ name, poll, log, intervalMs = 5_000, maxIntervalMs = 60_000, heartbeatMs = 300_000 }) {
  let stopped = false
  let failures = 0
  const stop = reason => {
    if (stopped) return
    stopped = true
    log.info?.('stopping', { reason: reason ?? 'requested' })
  }
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop(signal))

  const run = async () => {
    log.info?.('started', { name, intervalMs, pid: process.pid, node: process.version })
    let lastHeartbeat = Date.now()
    while (!stopped) {
      try {
        const result = await poll()
        failures = 0
        if (result !== undefined && result !== null) log.debug?.('poll', result)
      } catch (error) {
        failures += 1
        // `describeError` rather than `error.message`: for a failed fetch the message is only "fetch failed",
        // and the reason that tells you what to fix is on `.cause`.
        log.error?.('poll-failed', { failures, ...describeError(error) })
      }
      if (Date.now() - lastHeartbeat >= heartbeatMs) {
        lastHeartbeat = Date.now()
        log.info?.('alive', { failures })
      }
      const delay = failures === 0 ? intervalMs : Math.min(maxIntervalMs, intervalMs * 2 ** Math.min(failures, 6))
      await sleep(delay, () => stopped)
    }
    log.info?.('stopped', { name })
  }
  return { start: run, stop }
}

/** Sleep, but wake early when `done()` becomes true so a stop is not delayed by a whole interval. */
async function sleep(ms, done) {
  const slice = 100
  for (let waited = 0; waited < ms; waited += slice) {
    if (done()) return
    await new Promise(resolve => setTimeout(resolve, Math.min(slice, ms - waited)))
  }
}
