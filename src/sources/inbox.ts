/**
 * The inbox Source: a Markdown file dropped in a directory is a request.
 *
 * The file's name becomes the Ticket's title and its body the request, with an optional front matter that narrows the
 * scope. Each file is taken exactly once — its Trigger id comes from its name, mtime and size — and then moved out of
 * the inbox, so the directory itself shows what is waiting: `accepted/`, `observed/`, or `rejected/` with the reason
 * prepended to the file that was refused.
 */
import { statSync, type Dirent } from 'node:fs'
import { mkdir, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { key } from '../core/index.ts'
import { sourcePolicy } from '../core/policy.ts'
import type { Trigger } from '../core/model.ts'
import type { HealthEntry } from '../app/health.ts'
import type { Source, SourceHost, SourceKind, SourceStatus } from './kind.ts'

/** A file younger than this may still be being written, so one more poll waits for it. */
const SETTLE_MS = 1000
/** The largest request file this Source reads; a bigger one is refused rather than loaded. */
const MAX_BYTES = 512 * 1024
/** Where a taken file goes, by what the gate decided. */
const TAKEN = {
  accepted: 'accepted', observed: 'observed', rejected: 'rejected',
  // Where a request goes when its disposition is a state this Source does not handle. Not `accepted`: that folder's
  // name is a claim, and filing something there that was never accepted is a sentence the operator reads and believes.
  unhandled: 'unhandled',
} as const
type Taken = keyof typeof TAKEN

/** What a request file's front matter may say. Unknown keys stay in the body. */
export interface FrontMatter {
  readonly title?: string
  readonly scope?: string
  /** Absolute paths of files the request brings with it, comma-separated in the front matter. */
  readonly attachments?: readonly string[]
  readonly body: string
}

/**
 * Read the optional `---` front matter of a request file.
 * A file without one is all body, and a malformed one is a body too: refusing a request over punctuation would cost
 * the operator more attention than the punctuation is worth.
 */
export function frontMatter(text: string, fallbackTitle: string): FrontMatter {
  if (!text.startsWith('---')) return { body: text.trim(), title: fallbackTitle }
  const end = text.indexOf('\n---', 3)
  if (end === -1) return { body: text.trim(), title: fallbackTitle }
  const head = text.slice(3, end).replace(/^\r?\n/, '')
  const rest = text.slice(end + 4)
  const body = rest.slice(rest.indexOf('\n') + 1).trim()
  const fields: Record<string, string> = {}
  for (const line of head.split(/\r?\n/)) {
    const match = /^\s*([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line)
    if (match !== null) fields[match[1]!.toLowerCase()] = match[2]!.trim().replace(/^["']|["']$/g, '')
  }
  const title = fields.title ?? ''
  const attach = fields.attach ?? fields.attachments ?? ''
  const attachments = attach.split(',').map(item => item.trim()).filter(item => item !== '')
  return {
    body: body === '' ? text.trim() : body,
    title: title === '' ? fallbackTitle : title,
    scope: fields.scope === undefined || fields.scope === '' ? undefined : fields.scope,
    attachments: attachments.length === 0 ? undefined : attachments,
  }
}

const reason = (error: unknown): string => error instanceof Error ? `${error.name}: ${error.message}` : String(error)

async function readdirSafe(directory: string): Promise<Dirent[]> {
  try { return await readdir(directory, { withFileTypes: true }) }
  catch { return [] }
}

/** A name that does not collide in `folder`, so two takes of the same file name both survive. */
/**
 * The archived name of a taken request: the identity of the event, not the instant it was taken.
 *
 * A name derived from the event makes archiving idempotent — two scans that both take one file write the same
 * destination, so the second is an overwrite of the same bytes. A timestamped name gave the operator two copies of one
 * request and made the intake counts lie, because the only thing preventing the second copy was the original already
 * being gone, which is exactly what two overlapping scans defeat.
 */
function uniqueName(identity: string, name: string): string {
  return `${identity}-${name}`
}

export class InboxSource implements Source {
  readonly id = 'inbox'
  readonly kind = 'inbox' as const
  private healthEntry?: HealthEntry
  private get health(): HealthEntry { return this.healthEntry ??= this.host.health.entry('source:inbox') }
  private timer?: ReturnType<typeof setTimeout>
  /** The scan in flight, if any; a second poll waits for it rather than reading the directory alongside it. */
  private scanning?: Promise<void>
  private stopped = false
  private last: SourceStatus = { ok: true }
  private readonly counts = { accepted: 0, ignored: 0, observed: 0, duplicate: 0, unhandled: 0 }
  private lastTriggerAt?: string

  constructor(private readonly host: SourceHost, private readonly defaultDirectory: string) {}

  /** The directory watched now: the settings' own value, or the deployment's default. */
  directory(): string {
    const configured = this.host.settings().sources.inbox.directory.trim()
    return configured === '' ? this.defaultDirectory : configured
  }

  start(): void {
    this.checkWritableByOthers()
    void this.poll()
  }

  /**
   * Say out loud when the inbox is a door anybody can walk through.
   *
   * The gate decides who may originate work by sender name, and an inbox request carries its sender in the file
   * itself — so the real boundary is this directory's permissions, not that name. A directory writable by others lets
   * anyone submit work as an allowed sender, and the Decision record would show a sender that looks legitimate. That
   * bypasses the whole gate, and until now it failed silently.
   *
   * Checked once at start rather than on every scan: permissions do not usually change while a Source runs, and a
   * per-scan problem would fight the scan's own health summary for the same entry.
   */
  private checkWritableByOthers(): void {
    const directory = this.directory()
    if (directory === '') return
    try {
      const mode = statSync(directory).mode & 0o777
      if ((mode & 0o022) !== 0) {
        this.health.problem(
          `the inbox directory is writable by others (mode ${mode.toString(8)}), so anyone who can write there can `
          + 'submit work as an allowed sender; tighten it with chmod go-w')
      }
    } catch {
      // A directory that cannot be statted is reported by the scan itself, which has to read it anyway.
    }
  }

  /** Look at the inbox now, cancelling the wait that was armed; the poll rearms it. */
  async poll(): Promise<void> {
    if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined }
    await this.pollOnce()
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  status(): SourceStatus { return this.last }

  /** One poll: take whatever has settled in the inbox, then wait for the configured interval. */
  private async pollOnce(): Promise<void> {
    // One scan at a time. A request to look now can arrive while a timer-driven scan is still reading the directory,
    // and two scans would both take the same file: the Trigger is idempotent so one Ticket comes out, but the file is
    // annotated and moved twice, which leaves two copies of one request in `accepted/` and inflates the counts.
    while (this.scanning !== undefined) await this.scanning
    if (this.stopped) return
    const settings = this.host.settings()
    const pass = (async (): Promise<void> => {
      try {
        if (!settings.sources.inbox.enabled) {
          this.last = { ok: true, detail: 'disabled', counts: { ...this.counts } }
          this.health.record('disabled')
          return
        }
        await this.scan()
      } catch (error) {
        this.health.problem(reason(error))
        this.last = { ok: false, detail: reason(error), counts: { ...this.counts } }
      }
    })()
    this.scanning = pass
    try {
      await pass
    } finally {
      if (this.scanning === pass) this.scanning = undefined
      if (!this.stopped) {
        // Exactly one timer survives, however many polls were asked for while one was running.
        if (this.timer !== undefined) clearTimeout(this.timer)
        this.timer = setTimeout(() => { void this.pollOnce() }, settings.sources.inbox.pollMs)
        this.timer.unref?.()
      }
    }
  }

  /** Take every settled `*.md` request in the inbox, once each. */
  private async scan(): Promise<void> {
    const directory = this.directory()
    await mkdir(directory, { recursive: true })
    const now = Date.now()
    let settling = 0
    // What went wrong during this pass, collected rather than reported as it happens. The reason is at the end of the
    // pass: `record(detail)` overwrites the entry wholesale (`health.ts:17`), so a `problem()` called mid-pass was
    // erased before the pass finished and the operator never saw it. That is the S19/N5 shape — chat collects issues
    // this way already, and its spec says cron and rule each shipped the bug once. inbox still had it.
    const issues: string[] = []
    for (const entry of await readdirSafe(directory)) {
      if (this.stopped) return
      if (!entry.isFile() || entry.name.startsWith('.') || !entry.name.toLowerCase().endsWith('.md')) continue
      const path = join(directory, entry.name)
      let info: { mtimeMs: number; size: number }
      try { info = await stat(path) } catch { continue }
      // A file still being written is taken by a later poll, not read half-finished.
      // Paused or denied means the file stays exactly where it is. The gate's refusal would move it to `rejected/` and
      // store the Trigger as ignored, and neither can be undone: re-dropping a byte-identical file afterwards hits the
      // duplicate short-circuit and is filed as refused again, still wearing the old reason.
      const own = sourcePolicy('inbox', this.host.settings())
      if (own.paused || own.deny) continue
      if (now - info.mtimeMs < SETTLE_MS) { settling++; continue }
      if (info.size > MAX_BYTES) {
        this.counts.ignored++
        await this.take(path, directory, entry.name, 'rejected', `Refused: larger than ${MAX_BYTES} bytes`, key('inbox', entry.name, info.mtimeMs, info.size), issues)
        continue
      }
      let text: string
      try { text = await readFile(path, 'utf8') }
      catch (error) { issues.push(`Could not read ${entry.name}: ${reason(error)}`); continue }
      const parsed = frontMatter(text, entry.name.replace(/\.md$/i, ''))
      const at = new Date(info.mtimeMs).toISOString()
      const trigger: Trigger = {
        id: key('inbox', entry.name, info.mtimeMs, info.size),
        source: this.id, kind: 'inbox', at,
        // Dropping a file in the inbox is the operator asking, so the operator is the actor.
        actor: { id: 'operator', kind: 'person' },
        text: parsed.body, title: (parsed.title ?? entry.name).slice(0, 200),
        meta: {
          file: entry.name,
          ...(parsed.scope === undefined ? {} : { scope: parsed.scope }),
          ...(parsed.attachments === undefined ? {} : { attachments: parsed.attachments }),
        },
      }
      const result = this.host.engine.receive(trigger)
      this.lastTriggerAt = at
      const disposition = result.disposition
      if (disposition.state === 'accepted') {
        this.counts.accepted++
        await this.take(path, directory, entry.name, 'accepted', `Ticket ${disposition.ticketId}`, trigger.id, issues)
      } else if (disposition.state === 'observed') {
        this.counts.observed++
        await this.take(path, directory, entry.name, 'observed', 'The accept mode records this request and executes nothing', trigger.id, issues)
      } else if (disposition.state === 'ignored') {
        this.counts.ignored++
        const decision = this.host.engine.decisionOf(disposition.decisionId)
        const why = decision === undefined ? 'refused' : `${decision.reason}${decision.detail === undefined ? '' : `: ${decision.detail}`}`
        await this.take(path, directory, entry.name, 'rejected', why, trigger.id, issues)
      } else {
        // A disposition state this Source does not know. The comment that used to be here said "seen before this
        // process started and left behind", but that was already false: a duplicate carries the STORED disposition, so
        // one whose request was accepted takes the first branch and one that was refused takes the third — this branch
        // is reached only by a state nothing produces (`pending` has no producer in src/, and `Engine.receive` re-runs
        // the gate for a stored `lost` row so it can never return `lost`). A false comment is the mildest form of the
        // thing discipline 0.10 exists to prevent; a false folder name is the same sentence written on disk.
        //
        // No `issues.push` here: this is a past event, and the board means "right now". The event is recorded where
        // `take` records every note — the first line of the archived file. The board gets the backlog, below.
        this.counts.unhandled++
        await this.take(path, directory, entry.name, 'unhandled',
          `Disposition "${disposition.state}" is not handled by this Source; nothing was executed`, trigger.id, issues)
      }
      this.host.requestPass()
    }
    // The backlog, not the event: how many requests are parked in `unhandled/` right now. Recomputed every pass, so a
    // quiet pass cannot erase it and it retires on its own once a person deals with the files.
    const parked = join(directory, TAKEN.unhandled)
    const backlog = await readdirSafe(parked).then(entries => entries.filter(e => e.isFile()).length)
    if (backlog > 0) {
      issues.push(`${backlog} request(s) are parked in ${TAKEN.unhandled}/ because their disposition was not a state `
        + 'this Source handles; nothing was executed for them, and each file says why')
    }
    const detail = settling > 0 ? `${settling} file(s) still settling` : undefined
    // One decision at the end of the pass, not a `problem()` mid-pass that this line would overwrite.
    if (issues.length > 0) this.health.problem(issues.join('; '))
    else this.health.record(detail)
    this.last = { ok: true, detail, lastTriggerAt: this.lastTriggerAt, counts: { ...this.counts } }
  }

  /**
   * Move a taken file into `target/` with what became of it prepended, so the inbox holds only what is waiting.
   * The Trigger is already stored when this runs, so a file that cannot be moved is reported rather than retried into
   * a second Ticket.
   */
  private async take(
    path: string, directory: string, name: string, target: Taken, note: string, identity: string, issues: string[],
  ): Promise<void> {
    const folder = join(directory, TAKEN[target])
    try {
      const body = await readFile(path, 'utf8')
      // The claim comes first: whoever removes the original is the only one who archives it. Writing the copy before
      // unlinking let two overlapping scans each keep one — a single Trigger and Ticket, but two files in `accepted/`,
      // a millisecond apart — because both had written before either removed the original. A scan that loses the
      // race sees ENOENT here and leaves quietly; the request text is already stored, so nothing is lost.
      try {
        await unlink(path)
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, uniqueName(identity, name)), `<!-- myagent: ${note} -->\n${body}`, 'utf8')
    } catch (error) {
      issues.push(`Could not move ${name} out of the inbox: ${reason(error)}`)
    }
  }
}

export const inboxKind = (defaultDirectory: string): SourceKind =>
  ({ name: 'inbox', create: (host: SourceHost): Source => new InboxSource(host, defaultDirectory) })
