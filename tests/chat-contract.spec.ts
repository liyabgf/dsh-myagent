/**
 * The P8 contract's shape: the `chat` Source kind, the reply address on a Trigger, the optional `Delivery.send`, the
 * two-way Source interface, and the settings block that holds the identity map.
 *
 * Everything here is what task C (`src/sources/chat.ts`, the `send` effect handler, the Runtime wiring) implements
 * against, so it is asserted at the layer that owns it — the settings schema, the policy, the Engine's intake and the
 * Source registry — and never through a Source that does not exist yet. Deliberately absent, because they need C:
 * an unmapped message held instead of refused, a mapped one producing a Trigger whose id is the message id, and a
 * `send` reaching `TwoWaySource.deliver`.
 */
import { describe, expect, it } from 'vitest'
import { HealthBoard } from '../src/app/health.ts'
import type { Effects } from '../src/app/effects.ts'
import {
  Engine, Memory, SettingsSchema, gate, parseSettings, policyVersion, settingsPolicy, sourcePolicy,
  type Assignment, type Delivery, type Executor, type Mandate, type Report, type ReplyTo, type Settings, type Ticket,
  type Trigger,
} from '../src/core/index.ts'
import { SourceRegistry } from '../src/sources/registry.ts'
import type { Cursor, SourceHost, SourceKind, TwoWaySource } from '../src/sources/kind.ts'

const AT = '2026-11-04T05:00:00.000Z'

const settings = (value: unknown = {}): Settings =>
  parseSettings({ acceptMode: 'auto', allowedSenders: ['operator'], ...value as object })

/** The chat Source switched on, with `chat` as the block under test and any other block passed beside it. */
const chatOn = (chat: Record<string, unknown> = {}, otherSources: Record<string, unknown> = {}) => settings({
  allowedSenders: ['operator', 'alice'],
  sources: { chat: { enabled: true, ...chat }, ...otherSources },
})

/** A Trigger as the chat Source would produce one: the actor is the mapped name, never the platform id (§2.1). */
const chatTrigger = (over: Partial<Trigger> = {}): Trigger => ({
  id: 'chat-msg-1', source: 'chat', kind: 'chat', at: AT,
  actor: { id: 'alice', kind: 'person' }, text: '整理这周的告警', title: '告警整理', ...over,
})

const channel = (id: string, directory: string) => ({ id, directory })

/** The issues a settings document produces, empty when it parses; the message is what makes a red test readable. */
const issuesOf = (value: unknown): string[] => {
  const result = SettingsSchema.safeParse(value)
  return result.success ? [] : result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`)
}

describe('a fifth Source kind is visible to every call site', () => {
  // The fourth kind arrived twice over: two call sites each enumerated three kinds, so the gate read the SESSION block
  // for a rule Trigger and the policy version moved for no rule knob at all. `chat` must not be the fifth to arrive that
  // way, which is why every assertion below compares chat against another kind rather than reading chat alone.

  it('routes a chat Trigger through the gate as its own origin, not as one of the four kinds before it', () => {
    const verdict = gate(chatTrigger(), chatOn())
    expect(verdict).toMatchObject({ allow: true, observe: false, reason: 'accepted', via: 'chat', strength: 'explicit' })
    // `via` lands on the Mandate, so folding chat into an existing value would record that a request came through the
    // main Session when it arrived from a chat platform — a false statement in the audit record, not a cosmetic one.
    expect(verdict.via).not.toBe('session')
  })

  it('refuses a chat Trigger while the chat block is switched off, and names the chat Source in the refusal', () => {
    const refused = gate(chatTrigger(), settings({ allowedSenders: ['operator', 'alice'], sources: { chat: { enabled: false } } }))
    expect(refused).toMatchObject({ allow: false, reason: 'source_disabled' })
    expect(refused.detail).toContain('chat')
    expect(refused.detail).not.toContain('session')
  })

  it('reads the chat block\'s own enabled flag rather than the session one', () => {
    // The exact S33 symptom, mirrored: disabling the session Source used to disable the rule Source and to say so in
    // the refusal detail. A chat Trigger survives a switched-off session Source...
    expect(gate(chatTrigger(), chatOn({}, { session: { enabled: false } })))
      .toMatchObject({ allow: true, reason: 'accepted', via: 'chat' })
    // ...and a switched-off chat Source does not touch the session one.
    const sessionTrigger: Trigger = { ...chatTrigger(), id: 'session-1', source: 'session', kind: 'session' }
    expect(gate(sessionTrigger, settings({
      allowedSenders: ['operator', 'alice'], sources: { chat: { enabled: false }, session: { enabled: true } },
    }))).toMatchObject({ allow: true, reason: 'accepted', via: 'session' })
  })

  it('refuses a chat Trigger on the chat block\'s own pause and deny, and not on another Source\'s', () => {
    expect(gate(chatTrigger(), chatOn({ paused: true }))).toMatchObject({ allow: false, reason: 'paused' })
    const denied = gate(chatTrigger(), chatOn({ deny: true }))
    expect(denied).toMatchObject({ allow: false, reason: 'source_disabled' })
    expect(denied.detail).toContain('denied')
    // A pause on the session block reaches the session Source and nobody else.
    expect(gate(chatTrigger(), chatOn({}, { session: { enabled: true, paused: true } })))
      .toMatchObject({ allow: true, reason: 'accepted' })
  })

  it('moves the policy version for every chat knob, exactly as it does for the other Sources', () => {
    const base = policyVersion(chatOn())
    for (const knob of [{ deny: true }, { allowSystemActors: true }, { acceptMode: 'observe' }, { allowedSenders: ['nobody'] }]) {
      expect(policyVersion(chatOn(knob)), `${JSON.stringify(knob)} did not move the version`).not.toBe(base)
    }
  })

  it('answers the chat block\'s own policy to whoever produces from it, so the produce side can honour a pause', () => {
    // `paused` and `deny` have to be readable before anything is produced: a Trigger the gate refuses is stored as
    // `ignored`, and when its id is a pure function of the message that message can never be re-evaluated (S9 / N4).
    // A paused chat Source that kept producing would therefore burn every message it looked at.
    const elsewhere = settings({ sources: { chat: { enabled: true }, session: { enabled: true, paused: true, deny: true } } })
    expect(sourcePolicy('chat', elsewhere)).toEqual({
      paused: false, deny: false, allowSystemActors: false, acceptMode: 'auto', allowedSenders: ['operator'],
    })
    expect(sourcePolicy('session', elsewhere)).toMatchObject({ paused: true, deny: true })

    const own = chatOn({ paused: true, deny: true, acceptMode: 'observe', allowedSenders: ['alice'] })
    expect(sourcePolicy('chat', own)).toMatchObject({
      paused: true, deny: true, acceptMode: 'observe', allowedSenders: ['alice'],
    })
    // The chat block sets no pause of its own here, so the global one reaches it — a fallback, not another Source's block.
    expect(sourcePolicy('chat', settings({ paused: true })).paused).toBe(true)
    expect(sourcePolicy('session', own).deny).toBe(false)
  })
})

describe('the identity map is authorization', () => {
  const mapped = (identities: Record<string, unknown>, extra: Record<string, unknown> = {}) => settings({
    allowedSenders: ['operator', 'alice', 'teammate-a'],
    sources: { chat: { enabled: true, identities, ...extra } },
  })

  it('moves the policy version when a platform id starts speaking as another actor', () => {
    const none = policyVersion(mapped({}))
    const one = mapped({ U01ABCDEF: { actor: 'alice' } })
    expect(policyVersion(one)).not.toBe(none)
    // Retargeting an account is the change that matters most: work already authorized under the old name has to hear
    // about it, which is the whole reason `identities` is hashed rather than treated as plumbing.
    expect(policyVersion(mapped({ U01ABCDEF: { actor: 'teammate-a' } }))).not.toBe(policyVersion(one))
    // So does dropping a mapping, and so does adding a second one.
    expect(policyVersion(mapped({ U01ABCDEF: { actor: 'alice' }, U09XYZ: { actor: 'teammate-a' } }))).not.toBe(policyVersion(one))
    expect(none).not.toBe(policyVersion(one))
  })

  it('does not move the policy version for a note, which documents the map and authorizes nothing', () => {
    expect(policyVersion(mapped({ U01ABCDEF: { actor: 'alice', note: '操作者本人' } })))
      .toBe(policyVersion(mapped({ U01ABCDEF: { actor: 'alice', note: '同事，只允许提交摘要类工作' } })))
  })

  it('does not care what order the identities were written in', () => {
    // A panel save rewrites the whole block, so key order is not under the operator's control; a version that moved on
    // a reorder would tell every live Ticket that its authorization had changed because a document was re-saved.
    expect(policyVersion(mapped({ U01ABCDEF: { actor: 'alice' }, U09XYZ: { actor: 'teammate-a' } })))
      .toBe(policyVersion(mapped({ U09XYZ: { actor: 'teammate-a' }, U01ABCDEF: { actor: 'alice' } })))
  })

  it('admits the mapped actor name and refuses the platform id it came from', () => {
    const current = mapped({ U09XYZ: { actor: 'teammate-a' } })
    expect(gate(chatTrigger({ actor: { id: 'teammate-a', kind: 'person' } }), current))
      .toMatchObject({ allow: true, reason: 'accepted', via: 'chat' })
    // The operator writes actor names onto `allowedSenders`, so a Source that skipped the mapping and emitted the
    // platform id is refused rather than trusted: the failure mode of forgetting §2.1 is closed, not open.
    expect(gate(chatTrigger({ actor: { id: 'U09XYZ', kind: 'person' } }), current))
      .toMatchObject({ allow: false, reason: 'sender_not_allowed' })
  })

  it('still refuses a mapped actor that is not on the allowed list, because the map says who and the list says who may ask', () => {
    // Two gates rather than one, exactly as the rule Source has them: mapping an account is an assertion about who it
    // is, and one setting should not be worth any number of unidentified producers.
    const current = settings({
      allowedSenders: ['operator'],
      sources: { chat: { enabled: true, identities: { U09XYZ: { actor: 'teammate-a' } } } },
    })
    const refused = gate(chatTrigger({ actor: { id: 'teammate-a', kind: 'person' } }), current)
    expect(refused).toMatchObject({ allow: false, reason: 'sender_not_allowed' })
    expect(refused.detail).toContain('teammate-a')
  })

  it('refuses an identity that names no actor, because a mapping with no name maps nothing', () => {
    for (const actor of ['', '   ', 42]) {
      const issues = issuesOf({ sources: { chat: { identities: { U01ABCDEF: { actor } } } } }).join('\n')
      expect(issues, `actor ${JSON.stringify(actor)}`).toContain('sources.chat.identities.U01ABCDEF.actor')
    }
    // An unknown field inside a mapping is refused too: `{ actors: 'alice' }` would otherwise leave the entry with no
    // name, and the account would be held as unmapped forever with nothing on the board saying why.
    expect(issuesOf({ sources: { chat: { identities: { U01ABCDEF: { actors: 'alice' } } } } }).join('\n'))
      .toContain('sources.chat.identities.U01ABCDEF')
  })
})

describe('a settings document stored before the chat Source existed', () => {
  // The failure this guards is the worst one observed here: a stored document this build cannot parse makes the Runtime
  // constructor throw, `apply` logs one line and returns, and the plugin then silently does nothing at all — no Sources,
  // no panel, no error anybody sees. `.prefault({})` on the block and a default on every field is the whole defence.
  const storedBeforeChat = {
    acceptMode: 'auto', allowedSenders: ['operator'], paused: false,
    sources: {
      cron: { enabled: true, schedules: [{ id: 'digest', prompt: '写今天的摘要', timing: { kind: 'daily', time: '09:00' } }] },
      inbox: { enabled: true, directory: '/tmp/myagent-inbox', pollMs: 5000 },
      session: { enabled: true },
      rule: { enabled: true, rules: [] },
    },
    watchdog: { enabled: true }, notify: { enabled: false },
  }

  it('parses with no sources.chat key at all, and gets a chat block that is off with nothing mapped', () => {
    const result = SettingsSchema.safeParse(storedBeforeChat)
    expect(result.success, result.success ? '' : result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n')).toBe(true)
    if (!result.success) return
    expect(result.data.sources.chat).toEqual({ enabled: false, identities: {}, channels: [], pollMs: 5000 })
    // Off, not on: the four Sources before it read something the operator already set up, while this one reads a place
    // somebody else writes into, so nothing may start reading until a person says where and as whom.
    expect(result.data.sources.cron.enabled).toBe(true)
  })

  it('parses an empty document, which is how a deployment with no settings at all starts', () => {
    expect(parseSettings({}).sources.chat).toEqual({ enabled: false, identities: {}, channels: [], pollMs: 5000 })
  })

  it('refuses a chat field nobody reads, so a typo cannot pass for a configuration', () => {
    // `identites` under a lenient block would parse, the Source would see an empty identity map, and every message
    // would be held as unmapped — which looks exactly like a chat Source that receives nothing.
    const issues = issuesOf({ sources: { chat: { enabled: true, identites: { U01ABCDEF: { actor: 'alice' } } } } }).join('\n')
    expect(issues).toContain('sources.chat')
    expect(issues).toContain('identites')
  })

  it('refuses a channel with no place to read, and two channels that share an id', () => {
    // An empty `directory` would resolve to the deployment default for every channel, so several channels would read the
    // same place: a channel that looks configured and never receives anything.
    expect(issuesOf({ sources: { chat: { channels: [{ id: 'ops', directory: '' }] } } }).join('\n'))
      .toContain('sources.chat.channels.0.directory')
    // A shared id means one read position and one reply address for two channels, which is why a schedule id is
    // required and constrained for the same reason.
    const collided = SettingsSchema.safeParse({ sources: { chat: { channels: [channel('ops', '/tmp/a'), channel('ops', '/tmp/b')] } } })
    expect(collided.success).toBe(false)
    if (collided.success) return
    expect(collided.error.issues[0]!.message).toContain('ops')
    expect(collided.error.issues[0]!.path.join('.')).toBe('sources.chat.channels.1.id')
  })

  it('accepts a channel id that can be a cursor key and a reply address', () => {
    expect(issuesOf({ sources: { chat: { channels: [channel('ops-alerts', '/tmp/chat/ops')] } } })).toEqual([])
    expect(issuesOf({ sources: { chat: { channels: [channel('Ops', '/tmp/chat/ops')] } } }).join('\n'))
      .toContain('sources.chat.channels.0.id')
  })
})

/** The chat Source switched on and the mapped name allowed to ask for work: the settings intake accepts under. */
const CHAT_RUNNING = { allowedSenders: ['operator', 'alice'], sources: { chat: { enabled: true } } }

/** An Engine over in-memory repositories, with the Delivery under test as its only outlet. */
function engineWith(delivery: Delivery, value: unknown = {}) {
  const memory = new Memory()
  const executor: Executor = {
    prepare: (ticket: Ticket, _mandate: Mandate): Ticket =>
      ({ ...ticket, execution: { name: ticket.id, directory: `/tmp/work/${ticket.id}` } }),
    // The real Executor marks the attempt running when a launch succeeds; a fake that does not leaves every report
    // landing on a pending Assignment, which the Engine refuses.
    start: (ticket: Ticket, assignment: Assignment): void => { engine.assignmentStarted(ticket.id, assignment.id) },
    deliver: (): void => { /* nothing runs here */ },
    stop: (): void => { /* nothing runs here */ },
  }
  const engine = new Engine({
    repos: memory, tx: memory, policy: () => settingsPolicy(settings(value)), executor, delivery, now: () => AT,
  })
  return { engine, memory }
}

describe('the reply address a Trigger carries', () => {
  it('survives intake, so the Ticket a chat request made can still be answered', () => {
    const { engine, memory } = engineWith({ report: (): void => {} }, CHAT_RUNNING)
    const replyTo: ReplyTo = { kind: 'chat', channel: 'ops-alerts', thread: 't-7' }
    const accepted = engine.receive(chatTrigger({ replyTo }))
    expect(accepted.disposition.state).toBe('accepted')
    // Intake stores the Trigger as its Source produced it: the address is the only route from a report back to the
    // platform, and a Trigger stored without it leaves a Ticket that can never be answered.
    expect(memory.triggers.get('chat-msg-1')!.trigger.replyTo).toEqual(replyTo)
    // The Ticket points at that Trigger, which is how a `send` finds the address without the Ticket holding a copy.
    expect(memory.tickets.get(accepted.ticketId!)!.origin.triggerId).toBe('chat-msg-1')
  })

  it('leaves the address off a Trigger whose Source has no way back, rather than inferring one from the actor', () => {
    const { engine, memory } = engineWith({ report: (): void => {} }, CHAT_RUNNING)
    engine.receive({ ...chatTrigger(), id: 'inbox-1', source: 'inbox', kind: 'inbox', replyTo: undefined })
    // The Trigger has a kind and an actor id, so there is material to guess a destination from — and guessing is what
    // must not happen: an actor id says who asked, not where to answer, and an invented address would post a report to
    // a platform that never asked for one.
    expect(memory.triggers.get('inbox-1')!.trigger.replyTo).toBeUndefined()
  })
})

describe('Delivery.send is part of the port without being a demand on every implementation', () => {
  it('accepts a Delivery that has no send, and completes a whole report cycle through it', () => {
    // cron and inbox have no way back. Making `send` part of the port would be answered with empty methods, and an
    // empty method is the appearance of a capability without the capability — so an implementation that simply does not
    // have one must satisfy the port, which is a compile-time fact this test also exercises at runtime.
    const reports: Report[] = []
    const oneWay: Delivery = { report: (_ticket: Ticket, report: Report): void => { reports.push(report) } }
    const { engine, memory } = engineWith(oneWay, CHAT_RUNNING)
    const accepted = engine.receive(chatTrigger())
    engine.report(accepted.ticketId!, { state: 'ready', summary: '整理完了' })
    expect(reports.map(report => report.state)).toEqual(['ready'])
    expect(memory.tickets.get(accepted.ticketId!)!.ended).toMatchObject({ outcome: 'done' })
  })

  it('admits a Delivery that does have somewhere to send, and the core never decides to use it', () => {
    const sent: { ticketId: string; text: string }[] = []
    const twoWay: Delivery = {
      report: (): void => { /* a real implementation relays here, and answers from there */ },
      send: (ticket: Ticket, text: string): void => { sent.push({ ticketId: ticket.id, text }) },
    }
    const { engine, memory } = engineWith(twoWay, CHAT_RUNNING)
    const accepted = engine.receive(chatTrigger())
    engine.report(accepted.ticketId!, { state: 'ready', summary: '整理完了' })
    expect(memory.tickets.get(accepted.ticketId!)!.ended).toMatchObject({ outcome: 'done' })
    // Which Tickets get answered, and when, is the Delivery implementation's decision: the core records the report and
    // hands it over. Nothing in `src/core` calls `send`, so nothing there can send a reply nobody asked for.
    expect(sent).toEqual([])
  })
})

/** A Source host that only has to exist: nothing below produces a Trigger through it. */
function hostFor(read: () => Settings): SourceHost {
  const memory = new Memory()
  const health = new HealthBoard()
  const cursors = new Map<string, unknown>()
  const engine = new Engine({
    repos: memory, tx: memory, policy: () => settingsPolicy(read()),
    executor: {
      prepare: (ticket: Ticket): Ticket => ticket, start: (): void => {}, deliver: (): void => {}, stop: (): void => {},
    },
    delivery: { report: (): void => {} },
    now: () => AT,
  })
  return {
    engine, health, lifetime: new AbortController().signal, settings: read, requestPass: (): void => {},
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
}

describe('a Source that can answer back', () => {
  // `TwoWaySource` extends `Source` and changes nothing about it, so the registry that runs the four existing Sources
  // has to run this one too — no new host concept, no second registry. These tests use the real `SourceRegistry`.
  const delivered: { replyTo: ReplyTo; text: string }[] = []
  let created = 0

  const chatKind: SourceKind = {
    name: 'chat',
    create: (): TwoWaySource => {
      created++
      return {
        id: 'chat', kind: 'chat',
        start: (): void => {}, stop: (): void => {},
        status: () => ({ ok: true }),
        deliver: async (replyTo: ReplyTo, text: string): Promise<void> => { delivered.push({ replyTo, text }) },
      }
    },
  }

  it('registers, starts and reports status like any other Source, and is still two-way afterwards', async () => {
    delivered.length = 0
    created = 0
    const current = settings({ sources: { chat: { enabled: true, channels: [channel('ops', '/tmp/chat/ops')] } } })
    const registry = new SourceRegistry(hostFor(() => current), [chatKind])
    await registry.sync()
    expect(created).toBe(1)
    expect(registry.status()).toEqual({ chat: { ok: true } })
    // The registry holds `Source`, so the two-way half is reachable only by narrowing it — which is the dispatcher's
    // job (task C). What has to be true here is that `deliver` survived being stored as a plain Source.
    const running = registry.source('chat') as TwoWaySource | undefined
    expect(typeof running?.deliver).toBe('function')
    await running!.deliver({ kind: 'chat', channel: 'ops' }, '整理完了')
    expect(delivered).toEqual([{ replyTo: { kind: 'chat', channel: 'ops' }, text: '整理完了' }])
  })

  it('is recreated when a chat setting changes, and left running when another Source\'s does', async () => {
    delivered.length = 0
    created = 0
    let current = settings({ sources: { chat: { enabled: true, channels: [channel('ops', '/tmp/chat/ops')] } } })
    const registry = new SourceRegistry(hostFor(() => current), [chatKind])
    await registry.sync()
    expect(created).toBe(1)
    // An identity edit is a settings change the running Source must see, and `signatureOf` derives it from
    // `settings.sources[kind]` — the third of the three S33 fallthroughs was a signature that read the wrong block, so
    // editing a rule recreated nothing.
    current = settings({
      sources: { chat: { enabled: true, channels: [channel('ops', '/tmp/chat/ops')], identities: { U01ABCDEF: { actor: 'alice' } } } },
    })
    await registry.sync()
    expect(created).toBe(2)
    // Another Source's block is not this Source's signature: a chat Source recreated because somebody switched the
    // session one off would throw away whatever it held in memory mid-scan and re-arm its timer for no reason.
    current = settings({
      sources: {
        chat: { enabled: true, channels: [channel('ops', '/tmp/chat/ops')], identities: { U01ABCDEF: { actor: 'alice' } } },
        session: { enabled: false },
      },
    })
    await registry.sync()
    expect(created).toBe(2)
    // And switching the chat Source off is a change it sees too.
    current = settings({ sources: { chat: { enabled: false } } })
    await registry.sync()
    expect(created).toBe(3)
  })
})

describe('disabling a Source is an authorization change, for every kind', () => {
  // cron/inbox/session each hard-coded their own `enabled` clause in `authorizationShape`, and the kinds added later
  // appeared only in the derived `perSource` entry — which did not carry `enabled`. So disabling the rule Source, and
  // then chat, never moved `policyVersion`: tightening authorization would not reach the Tickets already accepted,
  // while the comment right beside it claimed every disabled Source was covered.
  // Flipped rather than hard-set to false: `chat` defaults to disabled, so "disable chat" is a no-op and the test
  // would have passed for the wrong reason — or, as written first, failed and looked like a defect in the fix.
  it.each(['rule', 'chat', 'session', 'inbox', 'cron'] as const)('moves policyVersion when %s is toggled', kind => {
    const base = settings()
    const current = (base.sources[kind] as { enabled: boolean }).enabled
    const after = policyVersion({
      ...base,
      sources: { ...base.sources, [kind]: { ...base.sources[kind], enabled: !current } },
    })
    expect(after, `${kind} enabled ${current} → ${!current} did not move the version`).not.toBe(policyVersion(base))
  })
})
