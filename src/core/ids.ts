/** Deterministic identifiers: equal inputs give an equal id, which is what makes intake idempotent. */
import { createHash } from 'node:crypto'

/**
 * Derive a stable id from its inputs.
 * A Source computes a Trigger's id from the facts that make the event unique (its schedule slot, or a file's
 * path, mtime and size), so a restart that observes the same event again cannot create a second Ticket.
 * @param parts - JSON-serializable inputs; their order matters.
 * @returns a 32-character hex digest.
 */
export function key(...parts: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 32)
}

/** A short, filesystem-safe slug of `text`, at most `max` characters, for directory and file names. */
export function slug(text: string, max = 40): string {
  const cleaned = text.toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, max)
    .replace(/-+$/g, '')
  return cleaned === '' ? 'ticket' : cleaned
}
