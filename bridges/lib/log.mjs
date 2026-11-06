/**
 * One JSON object per line, on stdout for everything and stderr for warnings and errors.
 *
 * Structured rather than pretty because a bridge runs unattended under launchd/systemd, where the only thing anybody
 * ever does with its output is grep it after something went wrong. A line a human cannot paste into a search is a
 * line that will be read wrong.
 */
export function createLog(name, { stream = process.stdout, errorStream = process.stderr, level = 'info' } = {}) {
  const rank = { debug: 10, info: 20, warn: 30, error: 40 }
  const floor = rank[level] ?? 20
  const emit = (severity, event, fields) => {
    if ((rank[severity] ?? 20) < floor) return
    const line = `${JSON.stringify({ at: new Date().toISOString(), bridge: name, level: severity, event, ...fields })}\n`
    ;(severity === 'warn' || severity === 'error' ? errorStream : stream).write(line)
  }
  return {
    debug: (event, fields) => emit('debug', event, fields),
    info: (event, fields) => emit('info', event, fields),
    warn: (event, fields) => emit('warn', event, fields),
    error: (event, fields) => emit('error', event, fields),
  }
}

/**
 * Everything worth knowing about a failure, as plain fields.
 *
 * Node's `fetch` wraps the real reason: the outer message is just "fetch failed" and the useful part —
 * `ENOTFOUND`, `ECONNREFUSED`, `UND_ERR_CONNECT_TIMEOUT`, a TLS error, the proxy refusing — lives on
 * `error.cause`. Logging only `error.message` produces a line that says a thing broke and not why, which
 * costs an hour of guessing: that is exactly what happened when this bridge failed under launchd and
 * worked in a shell (same binary, same env file, and the log could not tell the two apart).
 *
 * So the cause is walked (two levels, because undici nests) and its `code` is lifted out, since `code` is
 * the part you can search for.
 */
export function describeError(error) {
  const out = { message: String(error?.message ?? error) }
  if (error?.name !== undefined && error.name !== 'Error') out.name = error.name
  if (error?.code !== undefined) out.code = error.code
  const cause = error?.cause
  if (cause !== undefined && cause !== null) {
    out.cause = String(cause?.message ?? cause)
    if (cause?.code !== undefined) out.causeCode = cause.code
    const deeper = cause?.cause
    if (deeper !== undefined && deeper !== null) {
      out.rootCause = String(deeper?.message ?? deeper)
      if (deeper?.code !== undefined) out.rootCauseCode = deeper.code
    }
  }
  return out
}
