/**
 * The chat Source (P8 task C1): the identity map as the security boundary, holding unmapped and paused messages on
 * the produce side instead of consuming them, message identity as a pure function, and the outbound half of a
 * `TwoWaySource`.
 *
 * The shape rows come from contract §6 (`docs/v2/15-p8-contract.md`); the contract-layer rows — settings parsing,
 * the gate's `via: 'chat'`, `policyVersion` moving for `identities` — are asserted in `chat-contract.spec.ts` at
 * the layer that owns them and are not repeated here. What lives here needs a running Source, which is what C1 adds.
 */
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
// @ts-expect-error -- 桥是零依赖 .mjs，没有类型声明；复制一份形状到 .d.ts 就是第二份会漂移的副本。
import { writeMessage } from '../bridges/lib/inbound.mjs'
// @ts-expect-error -- 同上
import { drainOut } from '../bridges/lib/outbound.mjs'
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
  start(ticket: Ticket, assignment: Assignment): void {
    this.engine?.assignmentStarted(ticket.id, assignment.id)
    this.engine?.inputsDelivered(ticket.id, assignment.id, [])
  }
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

  it('titles a message without a title field after the mapped actor and the request summary, not the raw file name', async () => {
    const ops = directory()
    const context = harness(doc({ channels: [channel('ops', ops)] }))
    const source = new ChatSource(context.host)
    await source.start()
    try {
      drop(ops, 'msg--100200300-73.md', message({ from: 'U01ABCDEF', id: '-100200300-73' }, '# 项目启动\n请完成拓扑分析。'))
      await source.poll()
      const trigger = context.triggers()[0]!.trigger
      expect(trigger.title).toBe('alice：项目启动')
      expect(trigger.title).not.toContain('msg--100200300-73')
    } finally { await source.stop() }
  })

  it('routes a follow-up in a waiting conversation as an answer and coalesces rapid double-replies as a note instead of opening orphan Tickets', async () => {
    const ops = directory()
    const context = harness(doc({ channels: [channel('ops', ops)] }))
    const source = new ChatSource(context.host)
    await source.start()
    try {
      // 1. Original task arrives from group:-100200
      drop(ops, 'msg-1.md', message({ from: 'U01ABCDEF', id: 'm-1', thread: 'group:-100200', title: 'Group：研究中国 AI 资本布局' }, '请研究资本网络。'))
      await source.poll()
      expect(context.tickets()).toHaveLength(1)
      const original = context.tickets()[0]!
      expect(original.title).toBe('alice：研究中国 AI 资本布局')

      // 2. Worker turn ends waiting for a push
      // Need to call inputsDelivered first so turnEnded can create waiting report
      // (turnEnded only creates waiting when deliveredAt is set - indicates proper assignment lifecycle)
      const liveTicket = context.host.engine.ticket(original.id)!
      const assignmentId = liveTicket.assignments[0]!.id
      context.host.engine.inputsDelivered(original.id, assignmentId, [])
      context.host.engine.turnEnded(original.id, assignmentId, '已完成抓取，等待下一步指令')

      // 3. Operator sends a follow-up message from DM thread (DM→group answer)
      drop(ops, 'msg-2.md', message({ from: 'U01ABCDEF', id: 'm-2', thread: 'dm:<telegram-user-id>' }, '按照你的理解继续推进，直到完成'))
      await source.poll()
      // 4. Second message on the same DM thread (now subscribed via W12 auto-subscribe on continuation)
      drop(ops, 'msg-3.md', message({ from: 'U01ABCDEF', id: 'm-3', thread: 'dm:<telegram-user-id>' }, '补充一句：重点看中间层'))
      await source.poll()

      // Still ONLY ONE Ticket — neither follow-up spawned a duplicate orphan Ticket!
      expect(context.tickets()).toHaveLength(1)
      const updated = context.host.engine.ticket(original.id)!
      expect(updated.inputs.map(i => ({ kind: i.kind, text: i.text }))).toEqual([
        { kind: 'text', text: '按照你的理解继续推进，直到完成' },
        { kind: 'note', text: '补充一句：重点看中间层' },
      ])
    } finally { await source.stop() }
  })

  /**
   * The invariant the whole intake design rests on: the gate is a pure function of the Trigger and the settings, so a
   * request it refuses leaves NOTHING behind. Grouping a follow-up is a write (it can create a Work and reclassify a
   * historical Ticket), which is why it happens inside `receive`'s accepted branch rather than in this Source.
   *
   * `observe` is the case that matters most: it is the factory default, and its whole promise is "recorded, executed
   * nothing" — while the grouping used to run before the verdict, so a brand-new deployment rewrote history on every
   * reply to a finished task and still reported that it had executed nothing.
   */
  it('writes nothing at all when the gate refuses a follow-up: no Work, and the replied-to Ticket keeps its classification', async () => {
    const ops = directory()
    const base = doc({ channels: [channel('ops', ops)] }) as Record<string, unknown>
    const context = harness(base)
    const source = new ChatSource(context.host)
    await source.start()
    try {
      drop(ops, 'f-1.md', message({ from: 'U01ABCDEF', id: 'm-30', thread: 'group:-100200', title: '李杨：第一期' }, '完成第一期。'))
      await source.poll()
      const first = context.tickets()[0]!
      context.host.engine.report(first.id, { state: 'ready', summary: '第一期已完成' })
      expect(context.host.engine.works()).toEqual([])
      const ticketsBefore = context.tickets().length

      // 1. observe mode: recorded, and nothing else — no Work, no reclassification, no new Ticket.
      context.save({ ...base, acceptMode: 'observe' })
      drop(ops, 'f-2.md', message({ from: 'U01ABCDEF', id: 'm-31', thread: 'group:-100200', 'reply-to-ticket': first.id }, '继续深挖算力折股。'))
      await source.poll()
      const decisionOf = (messageId: string) => context.decisions()
        .find(decision => decision.triggerId === key('chat', 'ops', messageId))
      expect(decisionOf('m-31')?.outcome).toBe('observe')
      expect(context.host.engine.works()).toEqual([])
      expect(context.host.engine.ticket(first.id)!.workId).toBeUndefined()
      expect(context.host.engine.history(first.id).filter(event => event.type === 'classified')).toEqual([])
      expect(context.tickets()).toHaveLength(ticketsBefore)

      // 2. A sender nobody authorized: same answer, and the refusal reason is the sender rather than the mode.
      context.save({ ...base, allowedSenders: ['somebody-else'] })
      drop(ops, 'f-3.md', message({ from: 'U01ABCDEF', id: 'm-32', thread: 'group:-100200', 'reply-to-ticket': first.id }, '换个身份再问一次。'))
      await source.poll()
      expect(decisionOf('m-32')?.reason).toBe('sender_not_allowed')
      expect(context.host.engine.works()).toEqual([])
      expect(context.host.engine.ticket(first.id)!.workId).toBeUndefined()
      expect(context.tickets()).toHaveLength(ticketsBefore)

      // 3. And once the gate does accept, the grouping happens — so the two cases above are refusals, not a dead feature.
      context.save(base)
      drop(ops, 'f-4.md', message({ from: 'U01ABCDEF', id: 'm-33', thread: 'group:-100200', 'reply-to-ticket': first.id }, '这次放行。'))
      await source.poll()
      expect(context.host.engine.works()).toHaveLength(1)
      expect(context.host.engine.ticket(first.id)!.workId).toBe(context.host.engine.works()[0]!.id)
    } finally { await source.stop() }
  })

  it('automatically groups a reply to a completed (done) Ticket into a shared Work cluster (E3)', async () => {
    const ops = directory()
    const context = harness(doc({ channels: [channel('ops', ops)] }))
    const source = new ChatSource(context.host)
    await source.start()
    try {
      drop(ops, 'done-1.md', message({ from: 'U01ABCDEF', id: 'm-10', thread: 'group:-100200', title: '李杨：AI 资本第一期' }, '完成第一期调研。'))
      await source.poll()
      const first = context.tickets()[0]!
      context.host.engine.report(first.id, { state: 'ready', summary: '第一期已完成', files: ['report1.md'] })
      expect(context.host.engine.ticket(first.id)!.ended?.outcome).toBe('done')

      // Follow-up replying to the completed Ticket
      drop(ops, 'done-2.md', message({
        from: 'U01ABCDEF', id: 'm-11', thread: 'group:-100200', 'reply-to-ticket': first.id,
      }, '在第一期基础上深入分析算力折股。'))
      await source.poll()
      expect(context.tickets()).toHaveLength(2)
      const t1 = context.host.engine.ticket(first.id)!
      const t2 = context.tickets().find(t => t.id !== first.id)!
      expect(t1.workId).toBeDefined()
      expect(t2.workId).toBe(t1.workId)
      expect(t2.workSeq).toBe(2)
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

      // 【W9 Subscription fan-out】With Thread+Subscription, msg-2 arrives on the same Thread as msg-1.
      // msg-1 created a Ticket (accepted) and subscribed to the Thread.
      // msg-2 is delivered as a note to that Ticket via subscription fan-out — no new Ticket is created.
      expect(context.tickets()).toHaveLength(1) // msg-2 went to existing Ticket as a note
      expect(readdirSync(ops).filter(name => name.endsWith('.md'))).toEqual([])
      expect(readdirSync(join(ops, 'accepted'))).toHaveLength(2) // both messages archived as accepted
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


describe('a disposition state this Source does not handle', () => {
  it('parks the message where the folder name claims no verdict, records why inside it, and reports the backlog rather than the event', async () => {
    const ops = directory()
    const context = harness(doc({ channels: [channel('ops', ops)] }))
    const source = new ChatSource(context.host)
    // `pending` has no producer anywhere in src/ and `Engine.receive` re-runs the gate for a stored `lost` row, so it
    // can never return `lost`: neither state reaches the fallback today. Fabricating one is the only way in, and that
    // is the point — the union is closed only by its declaration, so a future member arrives exactly here.
    const real = context.engine.receive.bind(context.engine)
    ;(context.engine as { receive: unknown }).receive = (trigger: never) => ({
      ...real(trigger), disposition: { state: 'summoned' },
    })
    await source.start()
    try {
      drop(ops, 'alert.md', message({ from: 'U01ABCDEF', id: 'msg-1', title: 'weekly alerts' }, 'Sort this out.'))
      await source.poll()

      // Counted as what it is, and not as an acceptance.
      expect(source.status().counts).toMatchObject({ unhandled: 1, accepted: 0, duplicate: 0 })

      // Parked where the folder name claims no verdict. `accepted/` must not exist at all: before this, the file
      // stayed in the channel directory, so the NEXT scan saw a duplicate and filed it there — one pass of silence,
      // then a directory whose name claims an acceptance that never happened, with `duplicate` taking the blame.
      expect(existsSync(join(ops, 'accepted'))).toBe(false)
      const parked = readdirSync(join(ops, 'unhandled'))
      expect(parked).toHaveLength(1)

      // The event is recorded durably, inside the archived file — which is where `take` already puts every note. This
      // is the assertion that replaces the health line the first attempt wrongly asked for: a past event on a board
      // that means "right now" either stays forever or is erased by the next quiet pass, and neither is usable.
      const body = readFileSync(join(ops, 'unhandled', parked[0]!), 'utf8')
      expect(body.split('\n')[0]).toContain('summoned')
      expect(body.split('\n')[0]).toContain('nothing was executed')
      // And the operator's own words survive under the annotation, so the message is not lost by being parked.
      expect(body).toContain('Sort this out.')

      // The board reports the BACKLOG: a current condition, recomputed every pass.
      const first = context.health.problems()
      expect(first).toHaveLength(1)
      expect(first[0]!.name).toBe('source:chat')
      expect(first[0]!.detail).toContain('1 message(s) are parked in unhandled/')

      // The pair that makes the design verifiable rather than merely plausible. A one-pass event line would be gone
      // here, overwritten by the quiet pass's `record(detail)` — that is exactly what the first attempt observed and
      // spent three rounds trying to explain. A backlog is still true, so it is still reported.
      await source.poll()
      expect(context.health.problems()).toHaveLength(1)
      expect(source.status().counts).toMatchObject({ unhandled: 1, accepted: 0, duplicate: 0 })

      // And it retires on its own once a person deals with the files: no lingering alarm to clear by hand.
      rmSync(join(ops, 'unhandled', parked[0]!))
      await source.poll()
      expect(context.health.problems()).toEqual([])
    } finally { await source.stop() }
  })
})

describe('a platform bridge on the other end of this contract', () => {
  /**
   * The two halves of the file contract, each exercised by the OTHER implementation.
   *
   * Everything else in this file writes message files with this file's own `drop`/`message` helpers and reads replies
   * by looking at the bytes. That can only prove the Source agrees with itself. Here the inbound file is written by
   * the bridge kit that ships to operators, and the outbound file the Source writes is consumed by that same kit — so
   * a change to either side that the other does not understand fails here, and only here.
   */
  it('accepts what the bridge kit writes, and the kit delivers what the Source owes back', async () => {
    const ops = directory()
    const context = harness(doc({ channels: [channel('ops', ops)] }))
    const source = new ChatSource(context.host)
    await source.start()
    try {
      // Inbound: the real kit, with a Telegram-shaped identity (`<chatId>-<messageId>`) and a forum topic as thread.
      const written = await writeMessage({
        directory: ops, from: 'U01ABCDEF', id: '-100200-12', thread: '9', title: '周报群',
        body: '整理本周的周报',
      })
      // The Source skips a file younger than SETTLE_MS (`src/sources/chat.ts:66,331`) so it never reads one that is
      // still being written. A bridge's file is always brand new, so backdate it here exactly as this file's own
      // `drop` helper does — and note the operator-visible consequence: a message is read up to one second plus one
      // poll interval after it arrives, which belongs in the bridge's README rather than in a bug report.
      const settled = new Date(Date.now() - 5_000)
      utimesSync(written, settled, settled)
      await source.poll()

      const triggers = context.triggers()
      expect(triggers).toHaveLength(1)
      const trigger = triggers[0]!.trigger
      // The identity the bridge asserted is the one the operator mapped: the Source never infers a person.
      expect(trigger.actor).toEqual({ id: 'alice', kind: 'person' })
      expect(trigger.text).toBe('整理本周的周报')
      expect(trigger.replyTo).toMatchObject({ kind: 'chat', channel: 'ops' })
      expect(trigger.title).toBe('周报群')
      // The Source claimed it, so the file the bridge wrote is now under `accepted/` — not read twice.
      expect(readdirSync(join(ops, 'accepted')).filter(name => name.endsWith('-12.md'))).toHaveLength(1)
      expect(readdirSync(ops).filter(name => name.endsWith('.md'))).toEqual([])

      // Outbound: what the Source owes, read back by the kit that has to post it to a chat room.
      await source.deliver({ kind: 'chat', channel: 'ops', thread: '9' }, '已经整理好了，放在 report.md。')
      const sent: { thread?: string; text: string; name: string }[] = []
      const tally = await drainOut({
        directory: ops,
        send: async (reply: { thread?: string; text: string; name: string }) => { sent.push(reply) },
      })
      expect(tally).toMatchObject({ sent: 1, failed: 0 })
      expect(sent).toHaveLength(1)
      // The thread survived the round trip, which is what routes the answer back into the same forum topic.
      expect(sent[0]!.thread).toBe('9')
      expect(sent[0]!.text).toBe('已经整理好了，放在 report.md。')
      // And it is out of `out/`, so the next drain cannot post it to the room a second time.
      expect(readdirSync(join(ops, 'out'))).toEqual(['sent'])
    } finally { await source.stop() }
  })

  it('holds what the bridge wrote for an identity nobody has mapped yet — the bridge must not guess one', async () => {
    const ops = directory()
    const context = harness(doc({ channels: [channel('ops', ops)] }))
    const source = new ChatSource(context.host)
    await source.start()
    try {
      const held = await writeMessage({ directory: ops, from: 'U99NOBODY', id: '-100200-13', body: '陌生人的一句话' })
      const settledAt = new Date(Date.now() - 5_000)
      utimesSync(held, settledAt, settledAt)
      await source.poll()
      // No Trigger and no Decision: the file stays exactly where the bridge put it, and mapping it later is enough.
      expect(context.triggers()).toHaveLength(0)
      expect(context.tickets()).toHaveLength(0)
      expect(readdirSync(ops).filter(name => name.endsWith('.md'))).toEqual(['msg--100200-13.md'])
    } finally { await source.stop() }
  })
})

describe('per-channel health (N5)', () => {
  /**
   * Three numbers, and the reason each exists: `waiting` is the operator's to answer, `pendingReplies` is how you can
   * tell a bridge stopped running (myagent did its part and the room heard nothing), and `lastAcceptedAt` separates
   * "connected but quiet" from "nothing has arrived in days".
   */
  it('reports each channel separately, and lists a disabled one instead of dropping it', async () => {
    const ops = directory()
    const dev = directory()
    const off = directory()
    const context = harness(doc({ channels: [channel('ops', ops), channel('dev', dev), channel('off', off, false)] }))
    const source = new ChatSource(context.host)
    await source.start()
    try {
      // One held message in `ops` (an identity nobody has mapped), nothing anywhere else.
      drop(ops, 'a.md', message({ from: 'U99NOBODY', id: 'msg-1' }, '陌生人的话'))
      await source.poll()
      const facts = source.channels()
      expect(facts.map(item => item.id)).toEqual(['ops', 'dev', 'off'])
      const byId = Object.fromEntries(facts.map(item => [item.id, item]))
      expect(byId.ops).toMatchObject({ enabled: true, waiting: 1, pendingReplies: 0 })
      expect(byId.dev).toMatchObject({ enabled: true, waiting: 0, pendingReplies: 0 })
      // A disabled channel is listed as off. Dropping it would make "off" and "never configured" look the same,
      // and the panel would have no way to offer turning it back on.
      expect(byId.off).toMatchObject({ enabled: false })
      // The global waiting number and the per-channel one come from the same pass, so they cannot disagree.
      expect(source.waiting().count).toBe(1)
    } finally { await source.stop() }
  })

  it('counts answers a bridge has not collected, and ignores the bridge’s own history and temporaries', async () => {
    const ops = directory()
    const context = harness(doc({ channels: [channel('ops', ops)] }))
    const source = new ChatSource(context.host)
    await source.start()
    try {
      await source.deliver({ kind: 'chat', channel: 'ops' }, '已经查完了。')
      await source.poll()
      expect(source.channels()[0]!.pendingReplies).toBe(1)
      // A bridge that has delivered it moves it under `out/sent/`; that must not read as an undelivered answer,
      // or a bridge that keeps its history would look permanently broken.
      mkdirSync(join(ops, 'out', 'sent'), { recursive: true })
      const pending = readdirSync(join(ops, 'out')).find(name => name.endsWith('.md'))!
      writeFileSync(join(ops, 'out', 'sent', pending), readFileSync(join(ops, 'out', pending), 'utf8'), 'utf8')
      rmSync(join(ops, 'out', pending))
      writeFileSync(join(ops, 'out', '.tmp-half'), 'a bridge mid-write', 'utf8')
      await source.poll()
      expect(source.channels()[0]!.pendingReplies).toBe(0)
    } finally { await source.stop() }
  })

  it('says when something last came in, and stays silent rather than guessing when nothing ever has', async () => {
    const ops = directory()
    const context = harness(doc({ channels: [channel('ops', ops)] }))
    const source = new ChatSource(context.host)
    await source.start()
    try {
      await source.poll()
      expect(source.channels()[0]!.lastAcceptedAt).toBeUndefined()
      drop(ops, 'a.md', message({ from: 'U01ABCDEF', id: 'msg-1' }, '整理周报'))
      await source.poll()
      expect(source.channels()[0]!.lastAcceptedAt).toEqual(expect.any(String))
      expect(new Date(source.channels()[0]!.lastAcceptedAt!).getTime()).not.toBeNaN()
    } finally { await source.stop() }
  })

  it('reports a channel it could not read as an error, never as a row of zeros', async () => {
    const ops = directory()
    const broken = join(ops, 'not-a-dir')
    const context = harness(doc({ channels: [channel('ops', ops), channel('broken', broken)] }))
    const source = new ChatSource(context.host)
    await source.start()
    try {
      // A file where a directory was promised: reading it throws.
      writeFileSync(broken, 'x', 'utf8')
      await source.poll()
      const row = source.channels().find(item => item.id === 'broken')!
      expect(row.error).toEqual(expect.any(String))
      // And the healthy channel next to it is unaffected — one broken directory must not blank the whole page.
      expect(source.channels().find(item => item.id === 'ops')!.error).toBeUndefined()
    } finally { await source.stop() }
  })
})

describe('the bridge heartbeat the chat source watches (G-2)', () => {
  /** One enabled channel with a settled message, so a scan actually runs over it. */
  const beatChannel = (dir: string) => ({
    acceptMode: 'auto' as const, allowedSenders: ['operator', 'alice'],
    sources: { chat: { enabled: true, identities: IDS, channels: [channel('ops', dir)] } },
  })

  it('says on the health board that a bridge went silent, with its age in minutes', async () => {
    const ops = directory()
    drop(ops, 'ping.md', message({ from: 'U01ABCDEF', id: 'm-90', title: 'ping' }, 'ping'))
    const context = harness(beatChannel(ops))
    const source = new ChatSource(context.host)
    await source.start()
    try {
      // 心跳停在 12 分钟前：5 分钟阈值之上。
      const beat = join(ops, '.heartbeat')
      // 本文件其余处的工具都是同步的（writeFileSync/utimesSync）——跟随而不是另引一套异步依赖。
      writeFileSync(beat, 'bridge heartbeat: mtime says alive\n', 'utf8')
      const stale = new Date(Date.now() - 12 * 60_000)
      utimesSync(beat, stale, stale)
      await source.poll()
      expect(problems(context)).toContain('has not written a heartbeat for 12')
      expect(problems(context)).toContain('piling up unseen')
    } finally { await source.stop() }
  })

  it('a fresh heartbeat and an absent one both stay quiet — silence only claims what it can back', async () => {
    const fresh = directory()
    drop(fresh, 'ok.md', message({ from: 'U01ABCDEF', id: 'm-91', title: 'ok' }, 'ok'))
    const context = harness(beatChannel(fresh))
    const source = new ChatSource(context.host)
    await source.start()
    try {
      const beat = join(fresh, '.heartbeat')
      writeFileSync(beat, 'bridge heartbeat: mtime says alive\n', 'utf8')
      await source.poll()
      // 新鲜心跳：无心跳问题。
      expect(problems(context)).not.toContain('heartbeat')
      // 【B-6】fact 同时带上心跳时刻——面板的「心跳」列读它画相对年龄；键在，值是个合法 ISO 时刻。
      const fact = source.channels()[0]!
      expect(fact.heartbeatAt).toEqual(expect.any(String))
      expect(new Date(fact.heartbeatAt!).getTime()).not.toBeNaN()
    } finally { await source.stop() }

    // 文件不存在：旧版桥没写过心跳——不能把"没人承诺过说话"读成"它死了"。
    const bare = directory()
    drop(bare, 'ok2.md', message({ from: 'U01ABCDEF', id: 'm-92', title: 'ok2' }, 'ok2'))
    const context2 = harness(beatChannel(bare))
    const source2 = new ChatSource(context2.host)
    await source2.start()
    try {
      await source2.poll()
      expect(problems(context2)).not.toContain('heartbeat')
      // 键缺席（而不是空串、不是 0）：旧版桥没承诺过写心跳，面板据此画「无」而不是画一个假年龄。
      expect(source2.channels()[0]!.heartbeatAt).toBeUndefined()
    } finally { await source2.stop() }
  })
})
