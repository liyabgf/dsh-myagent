/**
 * The state lock: one writer per state directory.
 *
 * Two hosts loading this plugin over the same directory would run two Engines over one database, and both would launch
 * the same Ticket's worker. SQLite's own locking keeps the rows honest but nothing else, so the directory carries a
 * lock file with the holder's pid. A lock whose holder is gone is stolen; a lock whose holder lives is reported, and
 * the second deployment stays stopped instead of double-running work.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'

/** Who holds a state directory's lock. */
export interface LockRecord {
  readonly pid: number
  readonly host: string
  readonly token: string
  readonly at: string
}

/** Another live process holds the lock, so this deployment must not start. */
export class LockHeld extends Error {
  constructor(readonly holder: LockRecord) {
    super(`Another myagent holds ${holder.host}:${holder.pid} (since ${holder.at}); one writer per state directory`)
    this.name = 'LockHeld'
  }
}

/** Whether a pid still lives on this machine. A process this one may not signal still lives. */
function alive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true }
  catch (error) { return (error as NodeJS.ErrnoException).code === 'EPERM' }
}

function read(path: string): LockRecord | undefined {
  try {
    const value = JSON.parse(readFileSync(path, 'utf8')) as Partial<LockRecord>
    return typeof value.pid === 'number' && typeof value.token === 'string' ? value as LockRecord : undefined
  } catch { return undefined }
}

/** A held lock, released by `release()` and by the process ending. */
export class StateLock {
  private released = false
  constructor(readonly path: string, readonly record: LockRecord) {}

  /** Give the directory up, so another deployment may take it. */
  release(): void {
    if (this.released) return
    this.released = true
    // Only our own lock is removed; one stolen meanwhile belongs to its new holder.
    if (read(this.path)?.token === this.record.token) {
      try { unlinkSync(this.path) } catch { /* already gone */ }
    }
  }
}

/**
 * Take the lock of `directory`, stealing one whose holder is gone.
 * @throws LockHeld when another live process on this machine holds it.
 */
export function takeLock(directory: string): StateLock {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, 'myagent.lock')
  const record: LockRecord = { pid: process.pid, host: hostname(), token: randomUUID(), at: new Date().toISOString() }
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(path, 'wx')
      try { writeFileSync(fd, JSON.stringify(record)) } finally { closeSync(fd) }
      const lock = new StateLock(path, record)
      // A crash must not leave the directory locked for the next start.
      const release = (): void => { lock.release() }
      process.once('exit', release)
      return lock
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const holder = read(path)
      const ours = holder !== undefined && holder.host === record.host && alive(holder.pid)
      if (ours) throw new LockHeld(holder!)
      // Gone, unreadable or on another machine: the directory is free, so take it on the next attempt.
      try { unlinkSync(path) } catch { /* another taker got there first */ }
      if (!existsSync(path)) continue
    }
  }
  // Two takers raced and the other one won, which is exactly what a held lock means.
  const holder = read(path)
  throw new LockHeld(holder ?? { ...record, at: new Date().toISOString() })
}

/** Write a marker file next to the lock, so a person can see which deployment owns the directory. */
export function writeMarker(directory: string, contents: Record<string, unknown>): void {
  try { writeFileSync(join(directory, 'myagent.json'), `${JSON.stringify(contents, null, 2)}\n`, 'utf8') }
  catch { /* a marker is a courtesy */ }
}
