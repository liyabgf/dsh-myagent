/**
 * The chat Source: messages a platform bridge drops into a channel's directory become Triggers, and a Ticket's
 * answer goes back as a file in that directory's `out/`.
 *
 * This is the P8 reference implementation — both ends are the filesystem, so a live acceptance can watch the whole
 * loop close — and the shape a third-party platform Source copies. One instance reads several channels
 * (`sources.chat.channels`), because the standing decision is one instance per kind (D3) while an operator may have
 * more than one room; each channel carries its own directory, its own read of the identity map, and its own reply
 * address.
 *
 * ## The message file
 *
 * One `*.md` file at the top level of a channel directory is one message: an optional `---` front matter plus a
 * body — the shape the inbox already taught operators, chosen so the body IS the request text and the platform's
 * metadata stays fenced out of what a worker reads:
 *
 * ```md
 * ---
 * from: U01ABCDEF        the platform identity — the key into `sources.chat.identities`
 * id: msg-123            the platform's message id; without it the FILE NAME is the message's identity
 * thread: t-9            optional; travels on `replyTo.thread`
 * title: weekly alerts   optional; the file name is the fallback
 * ---
 * Sort out this week's alerts.
 * ```
 *
 * A malformed front matter, or one without `from`, is not refused over punctuation (the inbox's lesson): the file is
 * held exactly like an unmapped message, so fixing it in place is enough — the next scan accepts it.
 *
 * ## Identity is mapped, never inferred (contract §2 — the reason P8 exists)
 *
 * The actor of a Trigger is the mapped `actor` NAME with `kind: 'person'`; the mapping entry is itself the
 * operator's assertion, and this Source never decides `kind` from what a platform id looks like (§2.1). A platform
 * id that is not in `sources.chat.identities` produces NO Trigger and NO Decision: the message stays exactly where
 * it is, and the health board says how many are waiting (§2.2). Holding is the only reversible answer — a gate
 * refusal would store the Trigger as `ignored`, and since a Trigger id is a pure function of the message, a refused
 * message could never be re-evaluated even after the operator adds the mapping (the S9 / N4 lesson). The map
 * decides *who*; `allowedSenders` still decides *who may ask*, and one is not worth the other.
 *
 * ## Idempotence
 *
 * The Trigger id is `key('chat', channelId, messageId)` — the message's identity only, never a timestamp and never
 * the instant of the scan (S31: a timestamp-derived archive name let one request produce two archived copies and
 * made the intake counts lie). Without an `id:` field the file name is the identity, so a re-dropped file is the
 * same message; a genuinely new message needs a new name or a new `id:`. Claim-before-process, as in the inbox:
 * taking a message unlinks the original first, so of two overlapping scans exactly one archives it, and a crash
 * between `receive` and the move is healed by the next scan, which sees a duplicate and retries only the move.
 *
 * ## Replies
 *
 * `deliver` writes `<channel directory>/out/reply-<hash>.md`, the hash a pure function of (channel, thread, text),
 * so a retried delivery overwrites the same bytes instead of duplicating. Under `out/` rather than beside the
 * inbound files because this Source reads every top-level `*.md` in the channel: a reply dropped there would be
 * re-read as a `from`-less message and wait on the health board forever.
 */
import type { Dirent } from 'node:fs'
import { mkdir, readFile, readdir, rename, stat, unlink, writeFile } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { key, UserError } from '../core/index.ts'

/**
 * How long a channel's bridge may go without touching its heartbeat file before the health board says so (G-2).
 * Five minutes against a default poll of 5 s is sixty missed beats — a bridge that is alive but merely slow will
 * never trip it, and one that is dead trips it fast enough to matter the same evening.
 */
const HEARTBEAT_STALE_MS = 5 * 60_000
import { sourcePolicy, type Settings } from '../core/policy.ts'
import { latestReport, waitsForPerson, type ReplyTo, type Ticket, type Trigger } from '../core/model.ts'
import type { HealthEntry } from '../app/health.ts'
import type { DeliverOptions, SourceHost, SourceKind, SourceStatus, TwoWaySource } from './kind.ts'

/** A file younger than this may still be being written, so one more poll waits for it (the inbox's window). */
const SETTLE_MS = 1000
/** The largest message file this Source reads; a bigger one is set aside rather than loaded. */
const MAX_BYTES = 512 * 1024
/** Where a taken message goes, by what the gate decided — the inbox's folders, so the directory shows what is waiting. */
const TAKEN = {
  accepted: 'accepted', observed: 'observed', rejected: 'rejected',
  // Where a message goes when its disposition is a state this Source does not handle. Not `rejected`: a rejection is
  // a verdict the gate issued, and filing an unhandled state there would claim one. See the backlog line in
  // scanChannel for what the operator is told — the event itself is recorded in the archived file's annotation, which
  // is where `take` already puts every note, because a past event does not belong on a board that means "right now".
  unhandled: 'unhandled',
} as const
type Taken = keyof typeof TAKEN
/** Where `deliver` writes, inside the channel directory; see the file header for why not the directory itself. */
const OUT_DIR = 'out'
/** How many unmapped platform ids the waiting line names; the count carries the rest. */
const LIST_LIMIT = 5

type ChatSettings = Settings['sources']['chat']
type ChatChannel = ChatSettings['channels'][number]

/** One message file's parsed shape: the platform's metadata, and the body that becomes the request text. */
/**
 * One channel's health, as facts rather than as a sentence (U21-round / N5).
 *
 * The three numbers answer the only three questions an operator has about a bridge they cannot see:
 * - `waiting` — messages held because their platform identity is not mapped. The operator's to answer.
 * - `pendingReplies` — answers written to `out/` that no bridge has collected. **This one being non-zero for a while
 *   means the bridge is not running**, which is otherwise invisible: myagent did its part and the room heard nothing.
 * - `lastAcceptedAt` — when something last came in, so "the bridge is connected but the room is quiet" is
 *   distinguishable from "nothing has arrived in three days".
 */
export interface ChannelFact {
  readonly id: string
  readonly enabled: boolean
  readonly waiting: number
  readonly settling: number
  readonly pendingReplies: number
  readonly lastAcceptedAt?: string
  /**
   * When this channel's bridge last touched its heartbeat file (G-2/B-6): the panel shows "X seconds/minutes ago",
   * which is the one number that answers "is the aorta connected". Absent rather than 0 when the file does not
   * exist — an older bridge never promised to write one, and "no promise" is not an age.
   */
  readonly heartbeatAt?: string
  /** Why this channel could not be read, when it could not be. A channel that errors must not look like a quiet one. */
  readonly error?: string
}

interface Message {
  /** The platform identity the file asserts; '' when it asserts none, which is held as unmapped. */
  readonly from: string
  /** The message's identity: the platform's `id` field, or the file name when it carries none. */
  readonly id: string
  readonly thread?: string
  readonly title?: string
  /** Explicit Ticket id when the sender replied to a bot message that reported on a Ticket. */
  readonly replyToTicket?: string
  /** Absolute paths of downloaded attachments (images, files) placed by the bridge. */
  readonly attachments?: readonly string[]
  readonly body: string
}

/**
 * Read the optional `---` front matter of a message file.
 *
 * A file without one is all body and asserts no identity, and a malformed one is the same: neither is refused here.
 * A message this Source cannot identify is HELD (§2.2), and holding is exactly the right answer for a file the
 * operator can still fix — refusing it at the gate would be irreversible, because the Trigger id is a pure function
 * of the message.
 */
function parseMessage(text: string, fileName: string): Message {
  const fields: Record<string, string> = {}
  let body = text.trim()
  if (text.startsWith('---')) {
    const end = text.indexOf('\n---', 3)
    if (end !== -1) {
      const head = text.slice(3, end).replace(/^\r?\n/, '')
      const rest = text.slice(end + 4)
      body = rest.slice(rest.indexOf('\n') + 1).trim()
      for (const line of head.split(/\r?\n/)) {
        const match = /^\s*([A-Za-z][\w-]*)\s*:\s*(.*)$/.exec(line)
        if (match !== null) fields[match[1]!.toLowerCase()] = match[2]!.trim().replace(/^["']|["']$/g, '')
      }
    }
  }
  const id = fields.id ?? ''
  const thread = fields.thread ?? ''
  const title = fields.title ?? ''
  const replyToTicket = fields['reply-to-ticket'] ?? fields.replytoticket ?? ''
  const attachmentsRaw = fields.attachments ?? ''
  const attachments = attachmentsRaw === '' ? [] : attachmentsRaw.split(',').map(a => a.trim()).filter(a => a !== '')
  return {
    from: fields.from ?? '',
    id: id === '' ? fileName : id,
    ...(thread === '' ? {} : { thread }),
    ...(title === '' ? {} : { title }),
    ...(replyToTicket === '' ? {} : { replyToTicket }),
    ...(attachments.length > 0 ? { attachments } : {}),
    body,
  }
}

/**
 * Fallback title when a message file omits `title:`: `<actor>：<first line of body>`.
 *
 * Matches the bridge's `taskTitle` shape so a hand-dropped or legacy bridge file without a title field still names
 * who asked and what they asked for, instead of the raw `msg-<chatId>-<msgId>` file name.
 */
/**
 * Replace Telegram's literal `Group` anonymous-admin placeholder with the mapped actor name when the message came
 * from an older bridge file, and fall back to `defaultChatTitle` when `title` is absent.
 */
function normalizeChatTitle(rawTitle: string | undefined, actor: string, body: string, fileName: string): string {
  if (rawTitle === undefined || rawTitle.trim() === '') return defaultChatTitle(actor, body, fileName)
  if (rawTitle === 'Group') return defaultChatTitle(actor, body, fileName)
  if (rawTitle.startsWith('Group：')) return `${actor}：${rawTitle.slice('Group：'.length)}`
  return rawTitle
}

function defaultChatTitle(actor: string, body: string, fileName: string): string {
  const first = body
    .split(/\r?\n/)
    .map(line => line.replace(/^#+\s*/, '').replace(/\s+/g, ' ').trim())
    .find(line => line !== '') ?? ''
  const snippet = first.length > 48 ? `${first.slice(0, 48)}…` : first
  if (snippet !== '') return `${actor}：${snippet}`
  return fileName.replace(/\.md$/i, '')
}

const reason = (error: unknown): string => error instanceof Error ? `${error.name}: ${error.message}` : String(error)

export class ChatSource implements TwoWaySource {
  readonly id = 'chat'
  readonly kind = 'chat' as const
  private healthEntry?: HealthEntry
  private get health(): HealthEntry { return this.healthEntry ??= this.host.health.entry('source:chat') }
  private timer?: ReturnType<typeof setTimeout>
  /** The scan in flight, if any; a second poll waits for it rather than reading the directories alongside it. */
  private scanning?: Promise<void>
  private stopped = false
  private last: SourceStatus = { ok: true }
  /** `waiting` is a gauge recomputed from the directories each pass; the rest accumulate for the life of the instance. */
  private readonly counts = { accepted: 0, ignored: 0, observed: 0, duplicate: 0, waiting: 0, unhandled: 0 }
  /** Per-channel facts from the last pass; empty until the first scan has run. */
  private channelFacts: ChannelFact[] = []
  /** The waiting queue as data, not as a sentence. Set by the same pass that composes the health line. */
  private waitingNow: { count: number; ids: string[]; more: number } = { count: 0, ids: [], more: 0 }
  private lastTriggerAt?: string

  constructor(private readonly host: SourceHost) {}

  start(): void {
    void this.poll()
  }

  /** Look now, cancelling the wait that was armed; the poll rearms it. */
  async poll(): Promise<void> {
    if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined }
    await this.pollOnce()
  }

  async stop(): Promise<void> {
    this.stopped = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    // A scan awaiting I/O still owns the Store until its processing tail settles.
    await this.scanning
  }

  status(): SourceStatus { return this.last }

  /**
   * The messages being held because their platform identity is not mapped: how many, which ids, and how many more
   * than the list limit.
   *
   * Exposed as data because the panel offers a "map it" button per identity, and getting those ids by regular
   * expression out of the English health sentence would make the UI depend on prose. A reworded message would then
   * silently empty the queue on screen while the messages are still on disk — the worst kind of failure, because it
   * looks like the problem went away. The sentence and this record are composed from the same values in one place.
   */
  waiting(): { count: number; ids: string[]; more: number } { return this.waitingNow }

  /**
   * Every configured channel's health from the last pass, disabled ones included.
   *
   * Disabled channels are listed rather than dropped: the panel has to be able to say "this one exists and is off",
   * because a channel that vanished from the list looks like a channel that was never configured.
   */
  channels(): ChannelFact[] { return this.channelFacts }

  /** One poll: take whatever has settled in every enabled channel, then wait for the configured interval. */
  private async pollOnce(): Promise<void> {
    // One scan at a time, as in the inbox: a request to look now can arrive while a timer-driven scan is still
    // reading, and two scans would both take the same file. The Trigger is idempotent so one Ticket comes out, but
    // the file would be annotated and archived twice, which inflates the counts — the S31 shape of lying.
    while (this.scanning !== undefined) await this.scanning
    if (this.stopped) return
    // Read once per pass: every channel in one pass sees the same settings, and a change mid-pass waits for the
    // next one. (The registry recreates this instance on any `sources.chat` edit anyway.)
    const settings = this.host.settings()
    const pass = (async (): Promise<void> => {
      try {
        if (!settings.sources.chat.enabled) {
          this.counts.waiting = 0
          this.last = { ok: true, detail: 'disabled', counts: { ...this.counts } }
          this.health.record('disabled')
          return
        }
        await this.scan(settings)
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
        this.timer = setTimeout(() => { void this.pollOnce() }, settings.sources.chat.pollMs)
        this.timer.unref?.()
      }
    }
  }

  /** Take every settled message in every enabled channel, once each, and hold everything that is not mappable. */
  private async scan(settings: Settings): Promise<void> {
    const chat = settings.sources.chat
    // Paused or denied means "produce nothing", on the produce side exactly as for cron, inbox and rule — never via
    // the gate. A gate refusal here would be doubly irreversible: it stores the Trigger as `ignored`, and because the
    // Trigger id is a pure function of the message, that message could never be re-evaluated after the lift (S9 / N4).
    // The files simply stay where they are; the scan after the lift takes them, because holding is not dropping.
    const own = sourcePolicy('chat', settings)
    if (own.paused || own.deny) {
      const detail = own.paused
        ? 'paused — messages stay where they are until the pause lifts'
        : 'denied — messages stay where they are until the denial lifts'
      this.last = { ok: true, detail, counts: { ...this.counts } }
      this.health.record(detail)
      return
    }
    // One list of everything this pass has to complain about, written to the board at the END of the pass and only
    // then: `record` writes `ok: true`, so a summary written after a problem erases the problem in the same pass
    // that found it — the bug cron, rule and N5 each shipped once (S19 / N5).
    const issues: string[] = []
    let settling = 0
    let waiting = 0
    const waitingIds: string[] = []
    let channels = 0
    const facts: ChannelFact[] = []
    for (const channel of chat.channels) {
      // A disabled channel is not read at all — not even counted: a message sitting in a directory nobody promised
      // to watch is not "waiting" on anything, and saying so would train the operator to ignore the waiting line.
      // It IS still listed in `facts`, because "off" and "never configured" must not look the same on screen.
      if (!channel.enabled) {
        facts.push({ id: channel.id, enabled: false, waiting: 0, settling: 0, pendingReplies: 0 })
        continue
      }
      channels++
      if (this.stopped) break
      try {
        const found = await this.scanChannel(channel, chat, issues)
        settling += found.settling
        waiting += found.waiting
        waitingIds.push(...found.ids)
        // `outboundFacts` is skipped for a channel that could not be read: its zeros would otherwise sit next to
        // the error and read as "nothing pending either", which is not something anybody knows.
        const outbound = found.error === undefined ? await this.outboundFacts(channel.directory) : { pendingReplies: 0 }
        // 【G-2】桥的心跳：每轮由桥自己 touch `<channel directory>/.heartbeat`，这里只看它的年龄。
        // 文件不存在 = 旧版桥没写过（或频道从未接过桥）——沉默，不报警：只有桥先承诺"我会写心跳"，
        // 我们才敢把"它没写"说成"它死了"。年龄超过阈值 = 循环停了：进程被杀、机器睡了、或它一直在报错。
        // 这正是"面板说系统安静，而聊天室一片沉默"那个事故的形状——桥死掉时它欠的消息在频道目录里堆积，
        // 而 myagent 的每条健康线都读不到它。
        const beat = join(channel.directory, '.heartbeat')
        const beatInfo = await stat(beat).catch(() => undefined)
        // 一次 stat 两用：年龄进健康板（有问题才说），时刻进 fact（B-6 的面板列随时可读）。
        const heartbeatAt = beatInfo === undefined ? undefined : new Date(beatInfo.mtimeMs).toISOString()
        if (beatInfo !== undefined) {
          const ageMs = Date.now() - beatInfo.mtimeMs
          if (ageMs > HEARTBEAT_STALE_MS) {
            issues.push(`channel ${channel.id}: its bridge has not written a heartbeat for ${Math.round(ageMs / 60000)} `
              + 'minute(s) — the loop died, was killed, or has been erroring; messages it owes are piling up unseen')
          }
        }
        facts.push({
          id: channel.id, enabled: true, waiting: found.waiting, settling: found.settling,
          ...(found.error === undefined ? {} : { error: found.error }),
          ...outbound,
          ...(heartbeatAt === undefined ? {} : { heartbeatAt }),
        })
      } catch (error) {
        // A channel that could not be read says so on its own row: without this it would render as zeros, and
        // "0 waiting, 0 pending" is exactly what a healthy quiet channel looks like.
        facts.push({ id: channel.id, enabled: true, waiting: 0, settling: 0, pendingReplies: 0, error: reason(error) })
        issues.push(`channel ${channel.id}: ${reason(error)}`)
      }
    }
    this.channelFacts = facts
    this.counts.waiting = waiting
    if (waiting > 0) {
      // The line the contract names (§2.2): how many, which platform ids, and the two ways out. Held messages are
      // the operator's to answer — mapping the identity admits them on the next pass; nothing here expires them.
      const unique = [...new Set(waitingIds)]
      const shown = unique.slice(0, LIST_LIMIT).join(', ')
      const more = unique.length > LIST_LIMIT ? `, +${unique.length - LIST_LIMIT} more` : ''
      issues.push(`${waiting} message(s) from unmapped identities are waiting (${shown}${more}); `
        + 'add each id to sources.chat.identities, or remove the file')
      // The same facts, structured, set from the same values that compose the sentence above so the two cannot drift.
      // The panel needs the ids to offer a "map it" button per identity, and reading them back out of an English
      // sentence with a regular expression makes the UI depend on prose — which is exactly how a reworded message
      // silently empties a panel. (`reply_unroutable` was reworded once already, in round 36.)
      this.waitingNow = {
        count: waiting,
        ids: unique.slice(0, LIST_LIMIT),
        more: unique.length > LIST_LIMIT ? unique.length - LIST_LIMIT : 0,
      }
    } else {
      this.waitingNow = { count: 0, ids: [], more: 0 }
    }
    const detail = [
      `${channels} channel(s)`,
      ...(settling > 0 ? [`${settling} message(s) still settling`] : []),
      ...(waiting > 0 ? [`${waiting} waiting (unmapped)`] : []),
    ].join(', ')
    if (issues.length > 0) this.health.problem(issues.join('; '))
    else this.health.record(detail)
    this.last = { ok: true, detail, lastTriggerAt: this.lastTriggerAt, counts: { ...this.counts } }
  }

  /**
   * The two facts about a channel that its own scan does not produce: how many answers are waiting for a bridge to
   * collect them, and when something last came in.
   *
   * Both are deliberately cheap, because this runs for every channel on every pass:
   * - `out/` is listed and its top-level `*.md` counted — those are replies myagent wrote and nobody has taken.
   *   `sent/` (a bridge's own) and dotfiles are not counted, so a bridge that is keeping its history does not look
   *   like a pile of undelivered answers.
   * - `lastAcceptedAt` is the **directory's** mtime, not the newest file's: adding an entry moves a directory's mtime,
   *   which is exactly "something was accepted", and it costs one `stat` instead of a `readdir` plus a `stat` per
   *   archived message. On a filesystem that did not move it this would read as stale rather than as wrong.
   *
   * A failure here is not a failure of the channel: the scan already took what it took, so these two are reported as
   * absent rather than turning a working channel into an error row.
   */
  private async outboundFacts(directory: string): Promise<{ pendingReplies: number; lastAcceptedAt?: string }> {
    let pendingReplies = 0
    try {
      const entries = await readdir(join(directory, OUT_DIR), { withFileTypes: true })
      pendingReplies = entries.filter(entry => entry.isFile() && !entry.name.startsWith('.')
        && entry.name.toLowerCase().endsWith('.md')).length
    } catch { /* no `out/` yet: nothing has ever been owed back through this channel */ }
    try {
      const info = await stat(join(directory, TAKEN.accepted))
      return { pendingReplies, lastAcceptedAt: new Date(info.mtimeMs).toISOString() }
    } catch {
      return { pendingReplies }
    }
  }

  /** One channel's directory: what is settling, what is waiting, and everything taken. */
  private async scanChannel(
    channel: ChatChannel, chat: ChatSettings, issues: string[],
  ): Promise<{ settling: number; waiting: number; ids: string[]; error?: string }> {
    const directory = channel.directory
    let entries: Dirent[]
    try {
      await mkdir(directory, { recursive: true })
      entries = await readdir(directory, { withFileTypes: true })
    } catch (error) {
      // Named, not swallowed: a channel that cannot be read looks exactly like a channel nobody writes to, and only
      // one of those is a fact the operator can do nothing about.
      issues.push(`channel ${channel.id}: could not read ${directory}: ${reason(error)}`)
      // Returned as well as reported: the per-channel row has to say WHY it is empty, because "could not read" and
      // "nobody writes here" are the same zeros and only one of them is something the operator can fix.
      return { settling: 0, waiting: 0, ids: [], error: `could not read ${directory}: ${reason(error)}` }
    }
    // The mapping is a logical guard, so the real boundary is the directory's permissions — the same fact the inbox
    // reports, and more load-bearing here: whoever can write to this directory can submit work as any mapped
    // identity, and the Decision record would show a sender that looks legitimate (contract §7.6). Checked on every
    // pass rather than once at start, so a directory this Source just created, or a chmod while it runs, is seen.
    try {
      const mode = (await stat(directory)).mode & 0o777
      if ((mode & 0o022) !== 0) {
        issues.push(`channel ${channel.id}: directory ${directory} is writable by others (mode ${mode.toString(8)}), `
          + 'so anyone who can write there can submit work as any mapped identity; tighten it with chmod go-w')
      }
    } catch {
      // A directory that cannot be statted was just read above; there is nothing more to say about it.
    }
    const now = Date.now()
    let settling = 0
    let waiting = 0
    const ids: string[] = []
    for (const entry of entries) {
      if (this.stopped) break
      // Top-level `*.md` files only. Subdirectories are the Source's own — `out/`, `accepted/`, `observed/`,
      // `rejected/` — which is what keeps a delivered reply from being re-read as an inbound message.
      if (!entry.isFile() || entry.name.startsWith('.') || !entry.name.toLowerCase().endsWith('.md')) continue
      const path = join(directory, entry.name)
      let info: { mtimeMs: number; size: number }
      try { info = await stat(path) } catch { continue }
      // A file still being written is taken by a later poll, not read half-finished.
      if (now - info.mtimeMs < SETTLE_MS) { settling++; continue }
      if (info.size > MAX_BYTES) {
        // Set aside rather than held: a message this large can never be accepted, and leaving it in the directory
        // would wait on the board forever. The file is preserved in `rejected/`, so nothing is destroyed.
        this.counts.ignored++
        await this.take(path, directory, entry.name, 'rejected', `Refused: larger than ${MAX_BYTES} bytes`,
          key('chat', channel.id, entry.name), issues)
        continue
      }
      let text: string
      try { text = await readFile(path, 'utf8') }
      catch (error) { issues.push(`channel ${channel.id}: could not read ${entry.name}: ${reason(error)}`); continue }
      const message = parseMessage(text, entry.name)
      const mapped = message.from === '' ? undefined : chat.identities[message.from]
      if (mapped === undefined) {
        // HELD, not consumed: no Trigger, no Decision, the file stays exactly where it is (contract §2.2). This is
        // the load-bearing line of P8. Routing it through the gate instead would store the Trigger as `ignored`,
        // and because the id below is a pure function of the message, adding the mapping later could never
        // resurrect it — the refusal would be permanent for a problem the operator can still fix. Holding means the
        // next scan accepts it, once. A file with no `from` at all lands here too, named by its path: it is held for
        // the same reversible reason, and editing the file in place is enough to admit it.
        waiting++
        ids.push(message.from === '' ? `${channel.id}/${entry.name} (no from)` : message.from)
        continue
      }
      const normalizedTitle = normalizeChatTitle(message.title, mapped.actor, message.body, entry.name)
      const triggerId = key('chat', channel.id, message.id)
      const threadKey = `chat:${channel.id}:${message.thread ?? `dm:${message.from}`}`
      const trigger: Trigger = {
        // A pure function of the message's identity — channel and message id, never the scan instant, never the
        // mtime (S31). A bridge that re-delivers the same message under a fresh file write must deduplicate.
        id: key('chat', channel.id, message.id),
        source: this.id, kind: 'chat',
        // The file's mtime is when the message arrived; the scan instant is when nobody was looking.
        at: new Date(info.mtimeMs).toISOString(),
        // The operator's assertion, not this Source's judgement: the mapped NAME, always `person`. Inferring "this
        // id looks like a bot, so `system`" is exactly the judgement contract §2.1 forbids — the map decides who.
        actor: { id: mapped.actor, kind: 'person' },
        text: message.body,
        title: normalizedTitle.slice(0, 200),
        // 【W8】threadKey identifies the conversation for Thread+Subscription.
        // Format: chat:<channelId>:<thread> (for group/topic threads) or chat:<channelId>:dm:<from> (for DMs).
        threadKey: `chat:${channel.id}:${message.thread ?? `dm:${message.from}`}`,
        meta: {
          channel: channel.id, file: entry.name, from: message.from,
          ...(message.thread === undefined ? {} : { thread: message.thread }),
          // The Ticket this message follows up on, as DATA. Grouping the two is the Engine's decision and happens only
          // if the gate accepts this request (`Engine.receive` resolves `meta.followupTicket` inside its accepted
          // branch): doing it here would create a Work and reclassify a historical Ticket even for a message the gate
          // refuses — including every message in an `observe`-mode deployment, which promises to execute nothing.
          ...(message.replyToTicket === undefined ? {} : { followupTicket: message.replyToTicket }),
          // 【附件传送】Bridge downloads images/files to channel's attachments/ subdir and writes absolute paths here.
          // attachmentsOf() in engine.ts derives Attachment records; executor copies them to Ticket's inputs/ dir.
          ...(message.attachments?.length ? { attachments: message.attachments } : {}),
        },
        // Where the answer goes, written from the MESSAGE's own facts — the channel this file was read from and the
        // thread it names. Never derived from the actor: an actor id says who asked, not where to answer, and an
        // inferred address would post a report to a place that never asked for one.
        replyTo: {
          kind: 'chat', channel: channel.id,
          ...(message.thread === undefined ? {} : { thread: message.thread }),
        },
      }
      // Receipts must win before looking for today's targets: the original Ticket may have ended.
      const consumed = this.host.engine.sourceConsumptionOf(trigger)
      if (consumed !== undefined) {
        this.counts.duplicate++
        await this.take(path, directory, entry.name, 'accepted',
          `Already consumed on Ticket ${consumed.targets.map(target => target.ticketId).join(', ')}`, triggerId, issues)
        continue
      }
      const alreadyReceived = this.host.engine.triggerExists(triggerId)
      const thread = this.host.engine.getThread(threadKey)
      const subscribed = alreadyReceived ? [] : (thread?.subscriptions ?? [])
        .map(id => this.host.engine.open().find(ticket => ticket.id === id))
        .filter((ticket): ticket is Ticket => ticket !== undefined)
      const first = subscribed[0]
      const continuation = alreadyReceived ? undefined : first === undefined
        ? this.findContinuationTarget(channel.id, message, mapped.actor)
        : { ticket: first, mode: waitsForPerson(first)
          || ['waiting', 'blocked'].includes(latestReport(first)?.state ?? '') ? 'answer' as const : 'note' as const }
      if (continuation !== undefined) {
        const result = this.host.engine.consumeContinuation({
          trigger, target: { ticketId: continuation.ticket.id, mode: continuation.mode }, threadKey,
          contextTicketIds: thread?.contextSubscriptions,
        })
        if (result.stored !== 'trigger') {
          if (result.stored === 'duplicate') this.counts.duplicate++
          else this.counts.accepted++
          await this.take(path, directory, entry.name, 'accepted',
            `${result.stored === 'duplicate' ? 'Already consumed on' : continuation.mode === 'answer' ? 'Answered' : 'Noted on'} Ticket ${continuation.ticket.id}`,
            triggerId, issues)
          if (result.stored === 'consumed') this.host.requestPass()
          continue
        }
      }

      // Received inline rather than enqueued like the rule Source's Triggers: there, the event is transient, so the
      // queue is what survives a crash between the ending and the asking. Here the message FILE is the durable
      // record until it is claimed — a crash between `receive` and the move is healed by the next scan, which sees a
      // duplicate and retries only the move. Enqueueing a copy would keep two durable records of one message.
      const result = this.host.engine.receive(trigger)
      this.lastTriggerAt = trigger.at
      const disposition = result.disposition
      if (result.stored === 'duplicate') {
        // The same message seen again — a re-delivery, or a crash that struck between `receive` and the move. No
        // second Ticket exists (the id is the message's identity), so only the move is retried, into the folder the
        // FIRST disposition earned rather than a blanket `accepted/`.
        this.counts.duplicate++
        const folder: Taken = disposition.state === 'observed' ? 'observed'
          : disposition.state === 'ignored' ? 'rejected'
          : disposition.state === 'accepted' ? 'accepted'
          : 'unhandled'
        await this.take(path, directory, entry.name, folder, `Already taken as Trigger ${trigger.id}`, trigger.id, issues)
      } else if (disposition.state === 'accepted') {
        this.counts.accepted++
        // 【W9 Subscription】Subscribe the new Ticket to its Thread so future Triggers on this
        // conversation are delivered to it rather than creating a new Ticket.
        if (trigger.threadKey !== undefined) {
          this.host.engine.subscribeTicketToThread(disposition.ticketId, trigger.threadKey)
        }
        await this.take(path, directory, entry.name, 'accepted', `Ticket ${disposition.ticketId}`, trigger.id, issues)
      } else if (disposition.state === 'observed') {
        this.counts.observed++
        await this.take(path, directory, entry.name, 'observed', 'The accept mode records this message and executes nothing', trigger.id, issues)
      } else if (disposition.state === 'ignored') {
        this.counts.ignored++
        const decision = this.host.engine.decisionOf(disposition.decisionId)
        const why = decision === undefined ? 'refused' : `${decision.reason}${decision.detail === undefined ? '' : `: ${decision.detail}`}`
        await this.take(path, directory, entry.name, 'rejected', why, trigger.id, issues)
      } else {
        // A disposition state this Source does not know. Neither is reachable today — `pending` has no producer
        // anywhere in src/ (a grep for `state: 'pending'` finds only `Assignment.state`), and `Engine.receive` re-runs
        // the gate for a stored `lost` row so it can never return `lost` — but the union is closed only by its
        // declaration, so any future member walks straight in here. This is the fifth member of the family discipline
        // 0.10 exists for; an earlier one put a false sentence into the audit record.
        //
        // What is NOT done here, and why: no `issues.push`. The board means "right now" (round 43), and this is a past
        // event — putting it there has exactly two outcomes and both are defects: it either stays forever (the S38/S41
        // permanent false alarm) or the next quiet pass overwrites it with `record(detail)` and the operator never
        // sees it. The event is recorded where `take` already records every note: the first line of the archived file.
        // What the board gets instead is the BACKLOG, recomputed every pass, below.
        this.counts.unhandled++
        await this.take(path, directory, entry.name, 'unhandled',
          `Disposition "${disposition.state}" is not handled by this Source; nothing was executed`, trigger.id, issues)
      }
      this.host.requestPass()
    }
    // The backlog, not the event: how many messages are parked in `unhandled/` right now. Recomputed every pass, so
    // a quiet pass cannot erase it (the directory is still there) and it retires on its own once a person deals with
    // the files (the count reaches zero and the line stops being pushed). That is the shape a board entry needs; an
    // event is not, which is why the `else` above records the event in the file and says nothing here.
    const parked = join(directory, TAKEN.unhandled)
    const backlog = await readdir(parked).then(names => names.length, () => 0)
    if (backlog > 0) {
      issues.push(`channel ${channel.id}: ${backlog} message(s) are parked in ${TAKEN.unhandled}/ because their `
        + 'disposition was not a state this Source handles; nothing was executed for them, and each file says why')
    }
    return { settling, waiting, ids }
  }

  /**
   * Move a taken message into `target/` with what became of it prepended, so the channel holds only what is waiting.
   *
   * The claim comes first: whoever removes the original is the only one who archives it — the inbox learned this
   * when writing the copy first let two overlapping scans each keep one. The archived name is the Trigger id, not
   * the instant (S31), so a retried take overwrites the same bytes instead of leaving two copies of one message.
   * The Trigger is already stored when this runs, so a file that cannot be moved is reported and retried by the
   * next scan as a duplicate, never received into a second Ticket.
   */
  private async take(
    path: string, directory: string, name: string, target: Taken, note: string, identity: string, issues: string[],
  ): Promise<void> {
    const folder = join(directory, TAKEN[target])
    try {
      const body = await readFile(path, 'utf8')
      try {
        await unlink(path)
      } catch (error) {
        // A scan that lost the claim race sees ENOENT here and leaves quietly; the message is already stored.
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
      await mkdir(folder, { recursive: true })
      await writeFile(join(folder, `${identity}-${name}`), `<!-- myagent: ${note} -->\n${body}`, 'utf8')
    } catch (error) {
      issues.push(`could not move ${name} out of ${directory}: ${reason(error)}`)
    }
  }

  /**
   * Deliver a reply to the platform, as a file in the channel's `out/` directory.
   *
   * Called by the effects queue (task C2's `send` handler), so it may be retried: the file name is a pure function
   * of what the reply carries and where it goes, and a retry overwrites the same bytes instead of duplicating.
   *
   * Deliberately NOT gated on `sources.chat.enabled`, `paused` or `deny`: all three hold INTAKE — they say "produce
   * no new work" — and a report owed to work that was already authorized is not new work. Stranding it would make
   * "the answer never arrived" indistinguishable from "the answer was never owed". A channel that is gone or
   * switched off is different in kind: an address WAS written down and nothing is there to receive it, which is
   * the exact fact `reply_unroutable` names.
   */
  /**
   * 【W12】Explicit ticket targeting via bridge-provided `reply-to-ticket:` frontmatter,
   * OR a DM reply to a group Ticket when no Thread subscription is active on the DM thread yet.
   *
   * The 60-second rapid-coalescing heuristic has been retired — Thread+Subscription (W9) handles
   * ongoing same-thread conversations. DM-to-group answers are kept because Thread+Subscription
   * does not yet bridge cross-thread actor matching (the sender DMs the bot to answer a group Ticket).
   */
  private findContinuationTarget(
    channelId: string,
    message: Message,
    actorId: string,
  ): { ticket: Ticket; mode: 'answer' | 'note' } | undefined {
    const open = this.host.engine.open()
    // Explicit reply-to-ticket from bridge frontmatter.
    if (message.replyToTicket !== undefined) {
      const explicit = open.find(t => t.id === message.replyToTicket || t.id.startsWith(message.replyToTicket!))
      if (explicit !== undefined) {
        const needsAnswer = waitsForPerson(explicit) || ['waiting', 'blocked'].includes(latestReport(explicit)?.state ?? '')
        return { ticket: explicit, mode: needsAnswer ? 'answer' : 'note' }
      }
    }
    // DM-to-group answer: a person DMs the bot to answer a group Ticket they started.
    // This is only reached when Thread+Subscription didn't find a match (no active subscription on this DM thread).
    const candidates = open.filter(t => {
      if (t.mandate.via !== 'chat' || t.mandate.sender.id !== actorId) return false
      try {
        const trig = this.host.engine.trigger(t.origin.triggerId)
        if (trig.replyTo?.channel !== channelId) return false
        // Only allow cross-thread (DM→group) when this message is a DM.
        if (message.thread !== undefined && trig.replyTo?.thread !== undefined && trig.replyTo.thread !== message.thread) {
          if (!message.thread.startsWith('dm:')) return false
        }
        return true
      } catch { return false }
    })
    const pool = candidates.filter(t => waitsForPerson(t) || ['waiting', 'blocked'].includes(latestReport(t)?.state ?? ''))
    if (pool.length === 1) return { ticket: pool[0]!, mode: 'answer' }
    // Note: 60-second rapid-coalescing heuristic retired (W12). Thread+Subscription handles same-thread follow-ups.
    return undefined
  }

  async deliver(replyTo: ReplyTo, text: string, options?: DeliverOptions): Promise<void> {
    const chat = this.host.settings().sources.chat
    const channel = chat.channels.find(item => item.id === replyTo.channel)
    if (channel === undefined || !channel.enabled) {
      throw new UserError('reply_unroutable', { channel: replyTo.channel })
    }
    const directory = join(channel.directory, OUT_DIR)
    await mkdir(directory, { recursive: true })
    const headers: string[] = []
    if (replyTo.thread !== undefined) headers.push(`thread: ${replyTo.thread}`)
    if (options?.ticketId !== undefined) headers.push(`ticket: ${options.ticketId}`)
    if (options?.files !== undefined && options.files.length > 0) headers.push(`files: ${options.files.join(', ')}`)
    const front = headers.length === 0 ? '' : `---\n${headers.join('\n')}\n---\n`
    // Include delivery metadata in the identity: two Tickets may owe identical text to one room with different files.
    const metadata = options?.ticketId !== undefined || (options?.files?.length ?? 0) > 0
      ? [JSON.stringify({ ticketId: options?.ticketId ?? null, files: options?.files ?? [] })] : []
    const name = `reply-${key('chat-reply', replyTo.channel, replyTo.thread ?? '', text, ...metadata)}.md`
    const target = join(directory, name)
    const temporary = join(directory, `.tmp-${process.pid}-${randomUUID()}`)
    try {
      await writeFile(temporary, `${front}${text}`, { encoding: 'utf8', flag: 'wx' })
      await rename(temporary, target)
    } catch (error) {
      await unlink(temporary).catch(() => {})
      throw error
    }
  }
}

/**
 * The reusable kind. `create` answers a `TwoWaySource`, which IS a `Source` — the registry runs it unchanged, and
 * the `send` dispatcher narrows with `typeof source.deliver === 'function'` when it routes a reply here.
 */
export const chatKind: SourceKind = {
  name: 'chat',
  create: (host: SourceHost): TwoWaySource => new ChatSource(host),
}
