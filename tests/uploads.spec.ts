import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { readFileSync, symlinkSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { Uploads, UPLOAD_MAX_BYTES, UPLOAD_TTL_MS } from '../src/app/uploads.ts'
import { tempDir } from './helpers/temp.ts'

describe('opaque browser uploads', () => {
  it('keeps original names, claims once, persists across restart and retains active/failed input', () => {
    const root = tempDir('myagent-uploads-'), uploads = new Uploads(root)
    const saved = uploads.save('notes.md', Buffer.from('hello').toString('base64'))
    let source = ''
    uploads.consume([saved.uploadId], sources => { source = sources[0]!; return { value: true, ticketId: 'ticket-a' } })
    expect(source.endsWith('/notes.md')).toBe(true)
    expect(readFileSync(source, 'utf8')).toBe('hello')
    const restored = new Uploads(root)
    restored.cleanup(id => id === 'ticket-a', Date.now() + 2 * UPLOAD_TTL_MS)
    expect(readFileSync(source, 'utf8')).toBe('hello')
    expect(() => restored.consume([saved.uploadId], () => ({ value: true, ticketId: 'ticket-b' }))).toThrow(/assigned/)
  })
  it('rejects paths, forged ids, malformed base64 and oversized files', () => {
    const uploads = new Uploads(tempDir('myagent-uploads-invalid-'))
    for (const name of ['../secret', '/tmp/file', 'a/b', 'a\\b', 'a\n.txt', 'receipt.json']) expect(() => uploads.save(name, 'YQ==')).toThrow()
    for (const data of ['=', 'AA=A', '!!!!', 'YQ']) expect(() => uploads.save('a', data)).toThrow()
    expect(() => uploads.save('a', Buffer.alloc(UPLOAD_MAX_BYTES + 1).toString('base64'))).toThrow()
    expect(() => uploads.consume(['../../secret'], () => ({ value: true }))).toThrow()
  })
  it('retains uploads after create failure, cleans unclaimed expiry, and accepts empty files', () => {
    const root = tempDir('myagent-uploads-retry-'), uploads = new Uploads(root)
    const file = uploads.save('empty.txt', '')
    expect(file.size).toBe(0)
    expect(() => uploads.consume([file.uploadId], () => { throw new Error('transaction failed') })).toThrow('transaction failed')
    uploads.consume([file.uploadId], sources => { expect(readFileSync(sources[0]!)).toHaveLength(0); return { value: true, ticketId: 'retry-ticket' } })
    const unused = uploads.save('unused.txt', 'YQ==')
    uploads.cleanup(() => true, Date.now() + 2 * UPLOAD_TTL_MS)
    expect(() => uploads.consume([unused.uploadId], () => ({ value: true }))).toThrow()
  })
  it('does not make an already-created Ticket upload reusable after receipt finalization fails', () => {
    const root = tempDir('myagent-uploads-finalize-'), uploads = new Uploads(root)
    const file = uploads.save('safe.txt', 'YQ==')
    const receipt = join(root, 'uploads', file.uploadId, 'receipt.json')
    let created = 0
    expect(() => uploads.consume([file.uploadId], () => {
      created++
      unlinkSync(receipt)
      // Replace the metadata file with a directory to deterministically make the final write fail.
      mkdirSync(receipt)
      return { value: true, ticketId: 'created-ticket' }
    })).toThrow()
    expect(created).toBe(1)
    expect(() => new Uploads(root).consume([file.uploadId], () => { created++; return { value: true, ticketId: 'another-ticket' } })).toThrow()
    expect(created).toBe(1)
  })
  it('refuses a symlink substituted for staged bytes', () => {
    const root = tempDir('myagent-uploads-link-'), uploads = new Uploads(root)
    const file = uploads.save('safe.txt', 'YQ==')
    const outside = join(root, 'outside'); writeFileSync(outside, 'secret')
    unlinkSync(join(root, 'uploads', file.uploadId, 'safe.txt')); symlinkSync(outside, join(root, 'uploads', file.uploadId, 'safe.txt'))
    expect(() => uploads.consume([file.uploadId], () => ({ value: true }))).toThrow(/unavailable/)
  })
})
