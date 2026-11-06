/**
 * Where a bridge remembers how far it got — a Telegram `offset`, a Lark checkpoint, the last heartbeat.
 *
 * The file is dot-prefixed and lives in the channel directory, which the Source scans for top-level `*.md`:
 * a dotfile is skipped by that scan, so bridge bookkeeping can never be mistaken for a message.
 */
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

const NAME = '.bridge-state.json'

export async function loadState(directory) {
  try {
    return JSON.parse(await readFile(join(directory, NAME), 'utf8'))
  } catch {
    // No state, or state a previous crash left half-written: start over rather than refuse to run. Losing a cursor
    // can re-deliver a message, and re-delivery is a no-op because the file name is a pure function of the id.
    return {}
  }
}

export async function saveState(directory, patch) {
  await mkdir(directory, { recursive: true })
  const next = { ...(await loadState(directory)), ...patch, updatedAt: new Date().toISOString() }
  const temporary = join(directory, `.tmp-state-${process.pid}-${randomBytes(4).toString('hex')}`)
  await writeFile(temporary, `${JSON.stringify(next, null, 2)}\n`, 'utf8')
  await rename(temporary, join(directory, NAME))
  return next
}
