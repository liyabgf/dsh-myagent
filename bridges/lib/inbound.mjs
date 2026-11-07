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
  }, message.body)
  const target = join(message.directory, name)
  const temporary = join(message.directory, `.tmp-${process.pid}-${randomBytes(4).toString('hex')}`)
  await writeFile(temporary, text, 'utf8')
  await rename(temporary, target)
  return target
}
