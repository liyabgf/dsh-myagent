/**
 * The message file's front matter, read and written exactly the way `src/sources/chat.ts:parseMessage` reads it.
 *
 * This module exists because the bridge and the Source must agree byte for byte, and "agree" is not a guess:
 *
 * - a file counts as having front matter only when it STARTS with `---`, and the closing fence is the first
 *   `\n---` after that;
 * - each head line is matched by `/^\s*([A-Za-z][\w-]*)\s*:\s*(.*)$/`, the key is lowercased, and the value is
 *   trimmed and then has **one** leading and **one** trailing quote stripped;
 * - values are therefore single-line, and there is **no backslash unescaping** — writing `\"` would leave the
 *   backslash inside the value. So a writer must SANITIZE, never escape (see `scalar`);
 * - a missing or malformed front matter is not an error at the Source: the message is HELD as unmapped. That is
 *   why a bridge that cannot determine a sender still writes the file — holding is the reversible answer.
 */

/** One `key: value` line's worth of text, made safe for the parser above. */
export function scalar(value) {
  // Newlines would split the value across two head lines and the tail would be dropped, so they become spaces.
  let text = String(value ?? '').replace(/[\r\n]+/g, ' ').trim()
  if (text === '') return "''"
  // The parser strips ONE leading and ONE trailing quote. If the value itself begins or ends with a quote,
  // wrap it in the other kind so what gets stripped is my wrapper and the value survives intact.
  const startsQuote = /^["']/.test(text)
  const endsQuote = /["']$/.test(text)
  if (startsQuote || endsQuote) {
    const wrap = text.includes("'") ? '"' : "'"
    // A value containing BOTH quote kinds cannot be wrapped losslessly; drop the outer ones instead and say so
    // in the log-free way a file can: the value simply loses its quotes. Losing a quote is cosmetic, splitting a
    // field is not.
    if (text.includes('"') && text.includes("'")) return text.replace(/^["']|["']$/g, '')
    return `${wrap}${text}${wrap}`
  }
  return text
}

/** Render a message file: front matter for the fields that are present, then the body verbatim. */
export function stringify(fields, body) {
  const lines = []
  for (const [key, value] of Object.entries(fields)) {
    if (value === undefined || value === null || value === '') continue
    lines.push(`${key}: ${scalar(value)}`)
  }
  const text = String(body ?? '').trim()
  return lines.length === 0 ? `${text}\n` : `---\n${lines.join('\n')}\n---\n${text}\n`
}

/**
 * Read a message file back. Mirrors the Source's parser, including its tolerance: no front matter, or a broken
 * one, yields an empty field set and the whole text as the body — never a throw. A bridge that threw here would
 * stop delivering replies because one file was odd.
 */
export function parse(text) {
  const fields = {}
  let body = String(text ?? '').trim()
  if (body.startsWith('---')) {
    const end = body.indexOf('\n---', 3)
    if (end !== -1) {
      const head = body.slice(3, end).replace(/^\r?\n/, '')
      const rest = body.slice(end + 4)
      body = rest.slice(rest.indexOf('\n') + 1).trim()
      for (const line of head.split(/\r?\n/)) {
        const match = /^\s*([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line)
        if (match !== null) fields[match[1].toLowerCase()] = match[2].trim().replace(/^["']|["']$/g, '')
      }
    }
  }
  return { fields, body }
}
