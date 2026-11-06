/**
 * Consuming `<channel directory>/out/` — the replies myagent owes back to the platform.
 *
 * The Source writes `out/reply-<hash>.md`, where the hash is a pure function of (channel, thread, text), so a
 * retried delivery writes the SAME BYTES under the SAME NAME. That is what makes at-least-once delivery safe here:
 *
 * - the file is moved to `out/sent/` only AFTER the platform accepted it, so a crash between reading and sending
 *   re-sends rather than silently dropping (an answer that never arrived must not be indistinguishable from an
 *   answer that was never owed);
 * - a name already in `sent/` is skipped, so myagent retrying the same reply does not post it to the room twice.
 *
 * Files are never deleted on success, only moved: what the operator's colleagues received is worth keeping, and
 * `keepDays` prunes it on an age the operator chooses.
 */
import { mkdir, readdir, rename, rm, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { parse } from './frontmatter.mjs'
import { describeError } from './log.mjs'

const OUT = 'out'
const SENT = 'sent'

async function readText(path) {
  const { readFile } = await import('node:fs/promises')
  return readFile(path, 'utf8')
}

/**
 * @param {object} options
 * @param {string} options.directory  the channel directory (the one that holds inbound `*.md` and an `out/`)
 * @param {(reply: { thread: string | undefined, text: string, name: string }) => Promise<void>} options.send
 * @param {{ info?: Function, warn?: Function, error?: Function }} [options.log]
 * @param {number} [options.keepDays] how long delivered replies are kept in `out/sent/` (0 keeps them forever)
 * @returns {Promise<{ sent: number, failed: number, skipped: number }>}
 */
export async function drainOut({ directory, send, log = {}, keepDays = 7 }) {
  const out = join(directory, OUT)
  const sent = join(out, SENT)
  const tally = { sent: 0, failed: 0, skipped: 0 }
  let entries
  try {
    entries = await readdir(out, { withFileTypes: true })
  } catch {
    return tally   // no `out/` yet: nothing has been owed back so far, which is not an error
  }
  let delivered
  try {
    delivered = new Set(await readdir(sent))
  } catch {
    delivered = new Set()
  }
  for (const entry of entries) {
    // Top-level `*.md` only, and never a dotfile: `sent/` is a directory, and a temporary is dot-prefixed.
    if (!entry.isFile() || entry.name.startsWith('.') || !entry.name.toLowerCase().endsWith('.md')) continue
    if (delivered.has(entry.name)) { tally.skipped += 1; continue }
    const path = join(out, entry.name)
    let text
    try {
      text = await readText(path)
    } catch (error) {
      log.warn?.('reply-unreadable', { name: entry.name, error: String(error) })
      tally.failed += 1
      continue
    }
    const { fields, body } = parse(text)
    try {
      await send({ thread: fields.thread === '' || fields.thread === undefined ? undefined : fields.thread, text: body, name: entry.name })
    } catch (error) {
      // Leave it where it is: the next drain tries again, and myagent's own retry may rewrite the same bytes.
      log.error?.('reply-send-failed', { name: entry.name, ...describeError(error) })
      tally.failed += 1
      continue
    }
    await mkdir(sent, { recursive: true })
    await rename(path, join(sent, entry.name))
    tally.sent += 1
    log.info?.('reply-sent', { name: entry.name, thread: fields.thread ?? null, chars: body.length })
  }
  if (keepDays > 0) await prune(sent, keepDays, log)
  return tally
}

/** Delete delivered replies older than `keepDays`, so `out/sent/` does not grow without bound. */
async function prune(sent, keepDays, log) {
  const cutoff = Date.now() - keepDays * 86_400_000
  let entries
  try {
    entries = await readdir(sent)
  } catch {
    return
  }
  for (const name of entries) {
    const path = join(sent, name)
    try {
      const info = await stat(path)
      if (info.mtimeMs < cutoff) { await rm(path); log.info?.('reply-pruned', { name }) }
    } catch { /* a file that vanished under us is already pruned */ }
  }
}
