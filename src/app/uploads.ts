import { randomUUID } from 'node:crypto'
import { mkdirSync, readFileSync, readdirSync, lstatSync, rmSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'

export const UPLOAD_MAX_BYTES = 8 * 1024 * 1024
export const UPLOAD_BODY_BYTES = 12 * 1024 * 1024
export const UPLOAD_MAX_TOTAL_BYTES = 32 * 1024 * 1024
export const UPLOAD_TTL_MS = 24 * 60 * 60_000
const ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
interface Metadata { uploadId: string; name: string; size: number; createdAt: number; ticketId?: string }
export interface UploadedFile { uploadId: string; name: string; size: number }
export class UploadError extends Error {}

function safeName(name: string): string {
  if (typeof name !== 'string' || name.length > 240 || basename(name) !== name || /[\\/\u0000-\u001f\u007f]/.test(name) || name.trim() === '' || name === '.' || name === '..') throw new UploadError('Invalid upload filename')
  return name
}

/** Opaque upload receipts; browser strings never become filesystem paths. */
export class Uploads {
  private readonly directory: string
  constructor(stateDir: string) { this.directory = join(stateDir, 'uploads') }
  private path(id: string): string {
    if (!ID.test(id)) throw new UploadError('Invalid upload id')
    return join(this.directory, id)
  }
  private metadata(id: string): Metadata {
    const dir = this.path(id)
    try {
      if (lstatSync(dir).isSymbolicLink() || lstatSync(join(dir, 'receipt.json')).isSymbolicLink()) throw new Error('symbolic link')
      const meta = JSON.parse(readFileSync(join(dir, 'receipt.json'), 'utf8')) as Metadata
      if (meta.uploadId !== id || typeof meta.createdAt !== 'number' || typeof meta.size !== 'number') throw new Error('bad receipt')
      safeName(meta.name)
      const info = lstatSync(join(dir, meta.name))
      if (!info.isFile() || info.isSymbolicLink() || info.size !== meta.size) throw new Error('bad file')
      return meta
    } catch { throw new UploadError('Upload is unavailable or corrupted') }
  }
  save(filename: string, data: string): UploadedFile {
    const name = safeName(filename)
    if (name === 'receipt.json') throw new UploadError('Reserved upload filename')
    if (typeof data !== 'string' || data.length > Math.ceil(UPLOAD_MAX_BYTES / 3) * 4 || data.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data)) throw new UploadError('Invalid or oversized base64 upload data')
    const bytes = Buffer.from(data, 'base64')
    if (bytes.toString('base64') !== data || bytes.length > UPLOAD_MAX_BYTES) throw new UploadError('Invalid or oversized upload data')
    const uploadId = randomUUID(), dir = this.path(uploadId)
    mkdirSync(dir, { recursive: true, mode: 0o700 })
    try {
      writeFileSync(join(dir, name), bytes, { flag: 'wx', mode: 0o600 })
      writeFileSync(join(dir, 'receipt.json'), JSON.stringify({ uploadId, name, size: bytes.length, createdAt: Date.now() }), { flag: 'wx', mode: 0o600 })
    } catch (error) { rmSync(dir, { recursive: true, force: true }); throw error }
    return { uploadId, name, size: bytes.length }
  }
  /** Resolve and claim in the same synchronous turn as the Engine command. */
  consume<T>(ids: readonly string[], create: (sources: readonly string[]) => { value: T; ticketId?: string }): T {
    if (ids.length > 10 || new Set(ids).size !== ids.length) throw new UploadError('Invalid upload id list')
    const metadata = ids.map(id => this.metadata(id))
    let total = 0
    for (const meta of metadata) {
      if (meta.ticketId !== undefined || Date.now() - meta.createdAt > UPLOAD_TTL_MS) throw new UploadError('Upload is expired or already assigned')
      total += meta.size
    }
    if (total > UPLOAD_MAX_TOTAL_BYTES) throw new UploadError('Uploads exceed the 32 MiB total limit')
    const reserved: Metadata[] = []
    let result: { value: T; ticketId?: string }
    try {
      for (const meta of metadata) {
        writeFileSync(join(this.path(meta.uploadId), 'receipt.json'), JSON.stringify({ ...meta, ticketId: 'reserved' }), { mode: 0o600 })
        reserved.push(meta)
      }
      result = create(metadata.map(meta => join(this.path(meta.uploadId), meta.name)))
    } catch (error) {
      // Engine did not return committed work: restore only successfully reserved receipts.
      for (const meta of reserved) writeFileSync(join(this.path(meta.uploadId), 'receipt.json'), JSON.stringify(meta), { mode: 0o600 })
      throw error
    }
    // A failed final receipt write must remain reserved, never become reusable after a Ticket exists.
    for (const meta of metadata) {
      if (result.ticketId === undefined) rmSync(this.path(meta.uploadId), { recursive: true, force: true })
      else writeFileSync(join(this.path(meta.uploadId), 'receipt.json'), JSON.stringify({ ...meta, ticketId: result.ticketId }), { mode: 0o600 })
    }
    return result.value
  }
  /** Active/failed Tickets retain sources; completed/deleted Tickets are reclaimed at next upload/start. */
  cleanup(isActive: (ticketId: string) => boolean, now = Date.now()): void {
    mkdirSync(this.directory, { recursive: true, mode: 0o700 })
    for (const id of readdirSync(this.directory)) {
      if (!ID.test(id)) continue
      try {
        const meta = this.metadata(id)
        const expired = meta.ticketId === undefined ? now - meta.createdAt > UPLOAD_TTL_MS : meta.ticketId !== 'reserved' && !isActive(meta.ticketId)
        if (expired) rmSync(this.path(id), { recursive: true, force: true })
      } catch { /* corrupted receipts stay unavailable; do not follow unknown filesystem entries */ }
    }
  }
}
