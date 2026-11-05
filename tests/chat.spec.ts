/**
 * The chat Source (P8 task C1): the identity map as the security boundary, holding unmapped and paused messages on
 * the produce side instead of consuming them, message identity as a pure function, and the outbound half of a
 * `TwoWaySource`.
 *
 * The shape rows come from contract §6 (`docs/v2/15-p8-contract.md`); the contract-layer rows — settings parsing,
 * the gate's `via: 'chat'`, `policyVersion` moving for `identities` — are asserted in `chat-contract.spec.ts` at
 * the layer that owns them and are not repeated here. What lives here needs a running Source, which is what C1 adds.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { HealthBoard } from '../src/app/health.ts'
import type { Effects } from '../src/app/effects.ts'
import {
  Engine, Memory, key, parseSettings, settingsPolicy,
  type Assignment, type Executor, type Mandate, type Settings, type Ticket,
} from '../src/core/index.ts'
import { ChatSource } from '../src/sources/chat.ts'
import type { Cursor, SourceHost } from '../src/sources/kind.ts'
import { tempDir } from './helpers/temp.ts'

class RecordingExecutor implements Executor {
  /** Bound after construction, because the Engine is built with this Executor in its options. */
  engine?: Engine
  prepare(ticket: Ticket, _mandate: Mandate): Ticket {
    return { ...ticket, execution: { name: ticket.id, directory: `/tmp/work/${ticket.id}` } }
  }
  start(ticket: Ticket, assignment: Assignment): void { this.engine?.assignmentStarted(ticket.id, assignment.id) }
  deliver(): void { /* nothing runs here */ }
  stop(): void { /* nothing runs here */ }
}

function harness(value: unknown = {}) {
  const memory = new Memory()
  const executor = new RecordingExecutor()
  const health = new HealthBoard()
  const cursors = new Map<string, unknown>()
  let current: Settings = parseSettings(value)
  const engine = new Engine({
    repos: memory, tx: memory, policy: () => settingsPolicy(current), executor,
    delivery: { report: (): void => {} },
    now: () => new Date().toISOString(),
  })
  // The real Executor marks the Assignment running when a launch succeeds; a fake that does not leaves every test
  // reporting into a state production never reports from.
  executor.engine = engine
  const host: SourceHost = {
    engine, health, lifetime: new AbortController().signal,
    settings: () => current,
    requestPass: (): void => {},
    subscribe: () => () => {},
    effects: {
      enqueue: (): void => {}, handle: (): void => {}, pending: () => false,
      runDue: async (): Promise<void> => {}, idle: async (): Promise<boolean> => true, dispose: (): void => {},
    } as unknown as Effects,
    cursor: (id: string): Cursor => ({
      get: <T>(): T | undefined => cursors.get(id) as T | undefined,
      set: <T>(value: T): void => { cursors.set(id, value) },
    }),
  }
  return {
    engine, memory, health, host, cursors,
    save: (next: unknown) => { current = parseSettings(next) },
    tickets: () => memory.tickets.list(),
    triggers: () => memory.triggers.list(),
    decisions: () => memory.decisions.list(50),
  }
}

const directory = (): string => tempDir('myagent-chat-')

/** Write a message file whose mtime is `ageMs` in the past, so the Source sees it as settled. */
function drop(dir: string, name: string, text: string, ageMs = 5_000): string {
  mkdirSync(dir, { recursive: true })
  const path = join(dir, name)
  writeFileSync(path, text, 'utf8')
  const at = new Date(Date.now() - ageMs)
  utimesSync(path, at, at)
  return path
}

/** A message file in the shape the Source documents: `---` front matter plus the body that is the request. */
const message = (fields: Record<string, string>, body: string): string =>
  `---\n${Object.entries(fields).map(([name, value]) => `${name}: ${value}`).join('\n')}\n---\n${body}\n`

/** The operator's identity map: two platform accounts, each speaking as one allowed actor name. */
const IDS = { U01ABCDEF: { actor: 'alice' }, U09XYZ: { actor: 'teammate-a' } }

const channel = (id: string, dir: string, enabled = true): { id: string; directory: string; enabled: boolean } =>
  ({ id, directory: dir, enabled })

/** A whole settings document: intake in `auto`, the mapped names allowed to ask, and `chat` overrides on top. */
function doc(chat: Record<string, unknown> = {}): unknown {
  return {
    acceptMode: 'auto', allowedSenders: ['operator', 'alice', 'teammate-a'],
    sources: { chat: { enabled: true, identities: IDS, ...chat } },
  }
}

const problems = (context: ReturnType<typeof harness>): string =>
  context.health.problems().map(problem => problem.detail).join('\n')

describe('a message from a mapped identity', () => {
  it('becomes a Trigger whose actor is the mapped name, kind person, via chat, with the reply address of its channel', async () => {
    const ops = directory()
    const context = harness(doc({ channels: [channel('ops', ops)] }))
    const source = new ChatSource(context.host)
    await source.start()
    try {
      drop(ops, 'alert.md', message(
        { from: 'U01ABCDEF', id: 'msg-1', thread: 't-9', title: 'weekly alerts' },
        'Sort out this week\'s alerts.'))
      await source.poll()

      expect(context.triggers()).toHaveLength(1)
      const trigger = context.triggers()[0]!.trigger
      // The mapping is the operator's assertion (contract §2.1): the actor is the mapped NAME, always `person`.
      // Passing the platform id through would trust the file about who it is — the inbox's mistake, and the reason
      // P8 exists.
      expect(trigger.actor).toEqual({ id: 'alice', kind: 'person' })
      expect(trigger.actor.id).not.toBe('U01ABCDEF')
      expect(trigger.kind).toBe('chat')
      // The id is a pure function of the message's identity — the channel and the platform's message id (§4).
      expect(trigger.id).toBe(key('chat', 'ops', 'msg-1'))
      expect(trigger.text).toBe('Sort out this week\'s alerts.')
      expect(trigger.title).toBe('weekly alerts')
      expect(trigger.replyTo).toEqual({ kind: 'chat', channel: 'ops', thread: 't-9' })
      // Read from the store, not from what a call returned: the Mandate carries `via: 'chat'`, so the audit record
      // says the request came from a chat platform and not from the main Session.
      const ticket = context.tickets()[0]!
      expect(ticket.mandate.via).toBe('chat')
      expect(ticket.mandate.sender).toEqual({ id: 'alice', kind: 'person' })
      expect(ticket.origin.triggerId).toBe(trigger.id)
      // Taken exactly once: out of the channel's top level, archived under its Trigger id.
      expect(readdirSync(ops).filter(name => name.endsWith('.md'))).toEqual([])
      expect(readdirSync(join(ops, 'accepted'))).toEqual([`${trigger.id}-alert.md`])
      expect(source.status().counts).toMatchObject({ accepted: 1, waiting: 0 })
    } finally { await source.stop() }
  })
})

describe('a message from an unmapped identity', () => {
  it('produces nothing, stays where it is, and the board says how many are waiting', async () => {
    const ops = directory()
    const context = harness(doc({ channels: [channel('ops', ops)] }))
    const source = new ChatSource(context.host)
    await source.start()
    try {
      const path = drop(ops, 'stranger.md', message({ from: 'U777UNKNOWN', id: 'msg-7' }, 'Let me in.'))
      await source.poll()

      // The security core (contract §2.2): NO Trigger and NO Decision. A gate refusal would store the Trigger as
      // `ignored`, and since its id is a pure function of the message, adding the mapping later could never
      // re-evaluate it — the refusal would be permanent for a problem the operator can still fix.
      expect(context.triggers()).toEqual([])
      expect(context.decisions()).toEqual([])
      expect(context.tickets()).toEqual([])
      expect(existsSync(path)).toBe(true)

      expect(context.health.problems()).toHaveLength(1)
      expect(context.health.problems()[0]!.name).toBe('source:chat')
      expect(problems(context)).toContain('1 message(s) from unmapped identities are waiting')
      expect(problems(context)).toContain('U777UNKNOWN')
      expect(problems(context)).toContain('sources.chat.identities')
      expect(source.status().counts).toMatchObject({ waiting: 1, accepted: 0 })

      // A second pass must not erase the line with its own all-quiet summary — the bug cron, rule and N5 each
      // shipped once — and must not double-count: waiting is a gauge read off the directory, not an accumulator.
      await source.poll()
      expect(context.health.problems()).toHaveLength(1)
      expect(problems(context)).toContain('1 message(s) from unmapped')
      expect(source.status().counts).toMatchObject({ waiting: 1 })
      expect(context.triggers()).toEqual([])
    } finally { await source.stop() }
  })

  it('is accepted once the operator maps the identity — the same message, exactly once', async () => {
    const ops = directory()
    const context = harness(doc({ channels: [channel('ops', ops)] }))
    const source = new ChatSource(context.host)
    await source.start()
    try {
      drop(ops, 'stranger.md', message({ from: 'U777', id: 'msg-7' }, 'Let me in.'))
      await source.poll()
      expect(context.triggers()).toEqual([])

      // The operator adds the mapping. In production the registry also recreates the Source on any chat-settings
      // edit (chat-contract.spec.ts pins that); the Source must not depend on recreation — it re-reads the
      // settings on every pass, so the held message is admitted by the next scan of the SAME instance too.
      context.save(doc({ channels: [channel('ops', ops)], identities: { ...IDS, U777: { actor: 'teammate-a' } } }))
      await source.poll()

      expect(context.triggers()).toHaveLength(1)
      expect(context.triggers()[0]!.trigger.actor).toEqual({ id: 'teammate-a', kind: 'person' })
      expect(context.tickets()).toHaveLength(1)
      expect(readdirSync(join(ops, 'accepted'))).toEqual([`${key('chat', 'ops', 'msg-7')}-stranger.md`])
      expect(context.health.problems()).toEqual([])

      // Exactly once: later scans find the channel empty, and the waiting gauge is back to zero.
      await source.poll()
      expect(context.triggers()).toHaveLength(1)
      expect(context.tickets()).toHaveLength(1)
      expect(source.status().counts).toMatchObject({ accepted: 1, waiting: 0 })
    } finally { await source.stop() }
  })

  it('does not even look at a disabled channel, so nothing in it counts as waiting', async () => {
    const ops = directory()
    const dev = directory()
    const context = harness(doc({ channels: [channel('ops', ops), channel('dev', dev, false)] }))
    const source = new ChatSource(context.host)
    await source.start()
    try {
      const path = drop(dev, 'stranger.md', message({ from: 'U777', id: 'msg-9' }, 'Nobody watches this.'))
      drop(ops, 'mapped.md', message({ from: 'U01ABCDEF', id: 'msg-1' }, 'Watched.'))
      await source.poll()

      // A message in a directory nobody promised to watch is not waiting on anything; counting it would train the
      // operator to ignore the waiting line that matters.
      expect(source.status().counts).toMatchObject({ waiting: 0, accepted: 1 })
      expect(context.health.problems()).toEqual([])
      expect(source.status().detail).toContain('1 channel(s)')
      expect(existsSync(path)).toBe(true)
    } finally { await source.stop() }
  })
})

describe('paused or denied on the produce side', () => {
  // Holding is not dropping — and here chat differs from the rule Source, deliberately. A rule answers
  // `ticket.ended` events, which are gone forever once the moment passes: lifting a denial never resurrects them,
  // and its test says so. A chat message is a FILE, and a produce-side hold leaves it in place, so the scan after
  // the lift takes everything that settled meanwhile: the held message AND the next one. Contract §6's "the one
  // that passed is not resurrected" is written for transient events; a file in a directory has not passed.
  it.each([
    { knob: 'paused', override: { paused: true } },
    { knob: 'denied', override: { deny: true } },
  ])('produces nothing while $knob, and after the lift takes the held message and the next one both', async ({ knob, override }) => {
    const ops = directory()
    const context = harness(doc({ channels: [channel('ops', ops)], ...override }))
    const source = new ChatSource(context.host)
    await source.start()
    try {
      const held = drop(ops, 'held.md', message({ from: 'U01ABCDEF', id: 'msg-1' }, 'First.'))
      await source.poll()

      // Nothing produced, so nothing refused and nothing consumed: the file is untouched and no Decision exists.
      // Going through the gate instead would store an ignored Trigger this message could never escape (S9 / N4).
      expect(context.triggers()).toEqual([])
      expect(context.decisions()).toEqual([])
      expect(existsSync(held)).toBe(true)
      expect(readdirSync(ops).filter(name => name.endsWith('.md'))).toEqual(['held.md'])
      expect(source.status().detail).toContain(knob)

      context.save(doc({ channels: [channel('ops', ops)] }))
      drop(ops, 'next.md', message({ from: 'U01ABCDEF', id: 'msg-2' }, 'Second.'))
      await source.poll()

      expect(context.tickets()).toHaveLength(2)
      expect(context.triggers().map(record => record.trigger.id).sort())
        .toEqual([key('chat', 'ops', 'msg-1'), key('chat', 'ops', 'msg-2')].sort())
      expect(context.decisions().map(decision => decision.outcome)).toEqual(['accept', 'accept'])
      expect(readdirSync(ops).filter(name => name.endsWith('.md'))).toEqual([])
      expect(readdirSync(join(ops, 'accepted'))).toHaveLength(2)
    } finally { await source.stop() }
  })
})

describe('the same message twice', () => {
  it('is one Trigger with one id, however many scans or re-deliveries see it', async () => {
    const ops = directory()
    const context = harness(doc({ channels: [channel('ops', ops)] }))
    const source = new ChatSource(context.host)
    await source.start()
    try {
      const text = message({ from: 'U01ABCDEF', id: 'msg-1' }, 'Once is enough.')
      drop(ops, 'alert.md', text)
      await source.poll()
      expect(context.tickets()).toHaveLength(1)
      const id = context.triggers()[0]!.trigger.id
      expect(id).toBe(key('chat', 'ops', 'msg-1'))

      // A bridge retry: the same platform message written again, with a fresh mtime. The Trigger id has no
      // timestamp in it (S31 — a timestamp-derived archive name once made one request produce two archived copies
      // and made the counts lie), so this is the SAME event: a duplicate, no second Ticket, and the archive is
      // overwritten with the same name instead of gaining a copy.
      drop(ops, 'alert.md', text)
      await source.poll()
      expect(context.tickets()).toHaveLength(1)
      expect(context.triggers()).toHaveLength(1)
      expect(readdirSync(join(ops, 'accepted'))).toEqual([`${id}-alert.md`])
      expect(source.status().counts).toMatchObject({ accepted: 1, duplicate: 1 })
    } finally { await source.stop() }
  })
})

describe('two channels', () => {
  it('keep their messages, identities and reply addresses apart', async () => {
    const ops = directory()
    const dev = directory()
    const context = harness(doc({ channels: [channel('ops', ops), channel('dev', dev)] }))
    const source = new ChatSource(context.host)
    await source.start()
    try {
      // The SAME platform message id in both channels: a channel is its own identity space and its id is part of
      // the Trigger id, so this is two events — neither a false duplicate nor a cross-talk.
      drop(ops, 'a.md', message({ from: 'U01ABCDEF', id: 'msg-1' }, 'Ops work.'))
      drop(dev, 'b.md', message({ from: 'U09XYZ', id: 'msg-1' }, 'Dev work.'))
      await source.poll()

      expect(context.tickets()).toHaveLength(2)
      const byChannel = Object.fromEntries(
        context.triggers().map(record => [record.trigger.replyTo!.channel, record.trigger]))
      expect(byChannel.ops!.actor).toEqual({ id: 'alice', kind: 'person' })
      expect(byChannel.dev!.actor).toEqual({ id: 'teammate-a', kind: 'person' })
      expect(byChannel.ops!.replyTo).toEqual({ kind: 'chat', channel: 'ops' })
      expect(byChannel.dev!.replyTo).toEqual({ kind: 'chat', channel: 'dev' })
      expect(byChannel.ops!.id).not.toBe(byChannel.dev!.id)
      // Each message is archived in its OWN channel's directory, which is where its replies will land too.
      expect(readdirSync(join(ops, 'accepted'))).toEqual([`${byChannel.ops!.id}-a.md`])
      expect(readdirSync(join(dev, 'accepted'))).toEqual([`${byChannel.dev!.id}-b.md`])
    } finally { await source.stop() }
  })
})

describe('deliver', () => {
  it('writes the reply as a file whose name is a pure function of what it carries, so a retry does not duplicate', async () => {
    const ops = directory()
    const context = harness(doc({ channels: [channel('ops', ops)] }))
    const source = new ChatSource(context.host)
    try {
      await source.deliver({ kind: 'chat', channel: 'ops' }, 'All sorted.')
      // The effects queue retries after a backoff, never in the same instant — so the retry is modeled a moment
      // later. A name that depended on WHEN the delivery was attempted would leave one file per attempt, and
      // without the gap two attempts inside one millisecond would hide exactly that.
      await new Promise(resolve => setTimeout(resolve, 5))
      // The retry must be the same file with the same bytes, not a second copy — the S31 lesson on the outbound
      // side.
      await source.deliver({ kind: 'chat', channel: 'ops' }, 'All sorted.')
      const out = join(ops, 'out')
      const files = readdirSync(out)
      expect(files).toHaveLength(1)
      expect(files[0]).toMatch(/^reply-[0-9a-f]{32}\.md$/)
      expect(readFileSync(join(out, files[0]!), 'utf8')).toBe('All sorted.')
      // A different answer is a different file...
      await source.deliver({ kind: 'chat', channel: 'ops' }, 'Mostly sorted.')
      expect(readdirSync(out)).toHaveLength(2)
      // ...and a thread travels on the file (front matter) and in its name, so a bridge can route the answer into
      // the right conversation and the same text to another thread is another delivery.
      await source.deliver({ kind: 'chat', channel: 'ops', thread: 't-9' }, 'All sorted.')
      const all = readdirSync(out)
      expect(all).toHaveLength(3)
      expect(all.filter(name => readFileSync(join(out, name), 'utf8') === '---\nthread: t-9\n---\nAll sorted.'))
        .toHaveLength(1)
      // A reply is written under `out/`, never beside the inbound files: this Source reads every top-level `*.md`
      // in the channel, so a reply dropped there would be re-read as a from-less message and wait forever.
      expect(readdirSync(ops).filter(name => name.endsWith('.md'))).toEqual([])
    } finally { await source.stop() }
  })

  it('refuses a reply whose channel is gone or switched off, with the code that names exactly that', async () => {
    const ops = directory()
    const context = harness(doc({ channels: [channel('ops', ops)] }))
    const source = new ChatSource(context.host)
    try {
      // A channel that vanished from the settings between the request and the answer: an address WAS written down
      // and nothing is there to receive it — the exact fact `reply_unroutable` was added for in task A, which had
      // zero callers until this Source.
      await expect(source.deliver({ kind: 'chat', channel: 'ghost' }, 'Anybody there?'))
        .rejects.toMatchObject({ name: 'UserError', code: 'reply_unroutable' })
      // A channel switched off is the same fact with a different remedy, and gets the same code rather than a
      // silent no-op: "I thought it sent" is worse than "it definitively did not".
      context.save(doc({ channels: [channel('ops', ops, false)] }))
      await expect(source.deliver({ kind: 'chat', channel: 'ops' }, 'Anybody there?'))
        .rejects.toMatchObject({ name: 'UserError', code: 'reply_unroutable' })
      expect(existsSync(join(ops, 'out'))).toBe(false)
    } finally { await source.stop() }
  })
})

describe('a channel directory anybody can write to', () => {
  // The identity map is a logical guard; the real boundary is who can put a message file into the directory
  // (contract §7.6). Whoever can write there can submit work as any mapped identity, and the Decision record would
  // show a sender that looks legitimate — the inbox's warning, more load-bearing here because the map makes the
  // setup feel authenticated when it is not.
  it('is reported with the mode and the remedy, and survives a pass that also takes a message', async () => {
    const ops = directory()
    chmodSync(ops, 0o777)
    const context = harness(doc({ channels: [channel('ops', ops)] }))
    const source = new ChatSource(context.host)
    await source.start()
    try {
      drop(ops, 'alert.md', message({ from: 'U01ABCDEF', id: 'msg-1' }, 'Work.'))
      await source.poll()
      // Taken, AND still complained about: the end-of-pass summary writes `ok: true`, so a Source that summarizes
      // after a successful take erases its own alarm — the bug cron and rule each shipped once (S19 / N5).
      expect(context.tickets()).toHaveLength(1)
      expect(problems(context)).toContain('writable by others')
      expect(problems(context)).toContain('777')
      expect(problems(context)).toContain('chmod go-w')
      expect(problems(context)).toContain('ops')
      await source.poll()
      expect(context.health.problems()).toHaveLength(1)
    } finally { await source.stop() }
  })

  it('says nothing when the directory is only the operator\'s', async () => {
    const ops = directory()
    chmodSync(ops, 0o700)
    const context = harness(doc({ channels: [channel('ops', ops)] }))
    const source = new ChatSource(context.host)
    await source.start()
    try {
      await source.poll()
      expect(context.health.problems()).toEqual([])
    } finally { await source.stop() }
  })
})

describe('the scan window and the switches', () => {
  it('leaves a message that is still being written for a later poll', async () => {
    const ops = directory()
    const context = harness(doc({ channels: [channel('ops', ops)] }))
    const source = new ChatSource(context.host)
    await source.start()
    try {
      const path = drop(ops, 'fresh.md', message({ from: 'U01ABCDEF', id: 'msg-1' }, 'Still landing.'), 0)
      await source.poll()
      // Read half-finished, a message could be taken with a truncated body — or with no `from` yet, which would put
      // a perfectly mapped sender on the unmapped board.
      expect(existsSync(path)).toBe(true)
      expect(context.tickets()).toHaveLength(0)
      expect(source.status().detail).toContain('settling')
    } finally { await source.stop() }
  })

  it('does nothing while the Source itself is switched off', async () => {
    const ops = directory()
    const context = harness(doc({ enabled: false, channels: [channel('ops', ops)] }))
    const source = new ChatSource(context.host)
    await source.start()
    try {
      const path = drop(ops, 'alert.md', message({ from: 'U01ABCDEF', id: 'msg-1' }, 'Work.'))
      await source.poll()
      expect(context.triggers()).toEqual([])
      expect(existsSync(path)).toBe(true)
      expect(source.status().detail).toBe('disabled')
      expect(context.health.problems()).toEqual([])
    } finally { await source.stop() }
  })
})
