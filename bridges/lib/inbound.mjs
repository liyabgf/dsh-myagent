/**
 * Writing one platform message into a channel directory, so the chat Source picks it up on its next scan.
 *
 * Two properties matter more than convenience here:
 *
 * - **The file name is a pure function of the message's identity.** The Source derives a Trigger id from
 *   `key('chat', channelId, messageId)`, and without an `id:` field the FILE NAME is that identity. A name with a
 *   timestamp in it would let one message become two Triggers — the exact bug the Source's own header records
 *   (S31). So re-delivering the same platform event overwrites the same bytes and changes nothing.
 * - **The write is atomic.** The Source reads every top-level `*.md` in the channel, so a half-written file could
 *   be read mid-write. Write to a dot-prefixed temporary (the Source skips dotfiles AND non-`.md` names, so a
 *   temporary is doubly invisible) and rename it into place.
 */
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'
import { stringify } from './frontmatter.mjs'

/**
 * Compose a human-readable task title from the sender and the first meaningful line of the request body:
 * `<sender>：<snippet>`.
 *
 * A group name (`回收站`, `周报群`) says where the message was posted, not who asked or what they want done — and the
 * Ticket's own directory (`executor.ts:109`) is named after `slug(ticket.title, 48)`, so a group name made every
 * Ticket in the group share a useless directory prefix. Leading markdown headings (`# ...`) and blank lines are
 * skipped when picking the snippet so a structured prompt's first real line wins.
 *
 * @param {string | undefined} sender
 * @param {string | undefined} body
 * @param {number} [maxChars]
 * @returns {string}
 */
export function taskTitle(sender, body, maxChars = 48) {
  const who = String(sender ?? '').replace(/\s+/g, ' ').trim()
  const lines = String(body ?? '')
    .split(/\r?\n/)
    .map(line => line.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim())
    .filter(line => line !== '')
  const first = lines[0] ?? ''
  const snippet = first.length > maxChars ? `${first.slice(0, maxChars)}…` : first
  if (who !== '' && snippet !== '') return `${who}：${snippet}`
  return who || snippet || 'unnamed'
}

/** A file name that is safe on every filesystem, never starts with a dot, and always ends in `.md`. */
export function messageFileName(id) {
  const slug = String(id ?? '').replace(/[^A-Za-z0-9._-]/g, '-').replace(/^\.+/, '').slice(0, 120)
  return `msg-${slug === '' ? 'unnamed' : slug}.md`
}

/**
 * @param {{ directory: string, from: string, id?: string, thread?: string, title?: string, body: string }} message
 * @returns {Promise<string>} the path written
 */
export async function writeMessage(message) {
  await mkdir(message.directory, { recursive: true })
  const name = messageFileName(message.id ?? message.body.slice(0, 40))
  const text = stringify({
    from: message.from,
    ...(message.id === undefined ? {} : { id: message.id }),
    ...(message.thread === undefined ? {} : { thread: message.thread }),
    ...(message.title === undefined ? {} : { title: message.title }),
    ...(message.replyToTicket === undefined || message.replyToTicket === '' ? {} : { 'reply-to-ticket': message.replyToTicket }),
    // Comma-separated absolute paths of downloaded attachments (images, files, etc.)
    ...(message.attachments?.length ? { attachments: message.attachments.join(',') } : {}),
  }, message.body)
  const target = join(message.directory, name)
  const temporary = join(message.directory, `.tmp-${process.pid}-${randomBytes(4).toString('hex')}`)
  await writeFile(temporary, text, 'utf8')
  await rename(temporary, target)
  return target
}

/**
 * Download one attachment from a URL into the channel's `attachments/` subdirectory.
 * Returns the local absolute path, or throws on download failure.
 *
 * The file name is derived from `filename` (sanitised to be filesystem-safe).
 * If a file already exists at that path it is overwritten — same message re-delivered means same bytes.
 *
 * @param {string} url         HTTP(S) URL to fetch
 * @param {string} directory   channel directory (attachments/ will be created inside it)
 * @param {string} filename    desired filename (will be sanitised; keeps extension)
 * @returns {Promise<string>}  absolute path of the saved file
 */
export async function downloadAttachment(url, directory, filename, msgId) {
  const { mkdir: mkdirFs, writeFile: writeFileFs, rename: renameFs } = await import('node:fs/promises')
  const { join: joinPath } = await import('node:path')
  const { randomBytes: rand } = await import('node:crypto')

  const safe = String(filename ?? 'file').replace(/[^A-Za-z0-9._-]/g, '_').replace(/^\.+/, '').slice(0, 120) || 'file'
  const attachDir = joinPath(directory, 'attachments')
  await mkdirFs(attachDir, { recursive: true })
  // B07 fix: prefix with msgId (first 16 chars) so attachments from different messages
  // never overwrite each other even when they share a filename.
  const prefix = msgId ? String(msgId).replace(/[^A-Za-z0-9_-]/g, '').slice(0, 16) + '-' : ''
  const dest = joinPath(attachDir, prefix + safe)

  // X08 fix: stream with a size cap so a large attachment cannot exhaust memory.
  const MAX_ATTACHMENT_BYTES = 20 * 1024 * 1024
  const response = await fetch(url, { signal: AbortSignal.timeout(30_000) })
  if (!response.ok) throw new Error(`attachment download failed: ${response.status} ${url.slice(0, 80)}`)
  const chunks = []
  let totalBytes = 0
  for await (const chunk of response.body) {
    totalBytes += chunk.length
    if (totalBytes > MAX_ATTACHMENT_BYTES) throw new Error(`attachment too large (>${MAX_ATTACHMENT_BYTES} bytes): ${url.slice(0, 80)}`)
    chunks.push(chunk)
  }
  const buf = Buffer.concat(chunks)

  const tmp = joinPath(attachDir, `.tmp-${process.pid}-${rand(4).toString('hex')}`)
  await writeFileFs(tmp, buf)
  await renameFs(tmp, dest)
  return dest
}
