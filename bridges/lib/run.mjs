import { utimes, writeFile } from 'node:fs/promises'
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
/**
 * `heartbeatFile` (G-2): a file whose mtime says "this loop is alive", touched after EVERY iteration — success or
 * failure — because "the process is up but its poll has been erroring for an hour" is exactly the state myagent
 * should be able to see. The log line above only reaches whoever reads launchd logs; the mtime reaches the panel.
 * Write failures are logged once and ignored: the heartbeat is a courtesy, not a dependency of the bridge itself.
 */
export function supervise({ name, poll, log, intervalMs = 5_000, maxIntervalMs = 60_000, heartbeatMs = 300_000, heartbeatFile }) {
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
      if (heartbeatFile !== undefined) {
        // 每次 touch 都取当下时刻：`utimes` 是"设为指定时刻"而不是"设为现在"，
        // 用循环外算好的固定 Date 会把 mtime 钉死在进程启动那一刻——5 分钟后心跳必假红。
        const fresh = new Date()
        try {
          await utimes(heartbeatFile, fresh, fresh)
        } catch {
          // `utimes` cannot create a missing file; make it once with a readable timestamp inside, then the
          // mtime keeps it fresh on its own. `wx` so two loops cannot clobber each other's meaning.
          try { await writeFile(heartbeatFile, `${new Date().toISOString()}\nbridge heartbeat: mtime says alive\n`, { flag: 'wx' }) }
          catch (error) { log.debug?.('heartbeat-create', { file: heartbeatFile, ...describeError(error) }) }
        }
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
