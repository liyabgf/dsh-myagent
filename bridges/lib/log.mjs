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
