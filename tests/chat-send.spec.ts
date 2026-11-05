/**
 * The way back: a Report returning to the platform that asked, and what is left when it cannot (P8 task C2).
 *
 * These are the contract's `send` rows (§6 of `docs/v2/15-p8-contract.md`), driven through a whole deployment rather
 * than through a hand-made Delivery wherever the wiring is what is under test: the point of C2 is that the chat Source
 * is mounted by the Runtime and that a reply rides the effects queue, and neither of those is visible from a harness
 * that constructs the parts itself. Two exceptions, both because a deployment cannot arrange them: the dispatch
 * narrowing needs a Source that cannot answer back (arranged at the deployment level by pointing a Trigger's address at
 * a kind that only ever produces), and the two refusal CODES need the thrown error object, which the queue hands only
 * to its own give-up hook.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { OutcomeDelivery, sendKey, UNDELIVERED_FILE } from '../src/app/delivery.ts'
import { Effects } from '../src/app/effects.ts'
import { HealthBoard } from '../src/app/health.ts'
import type { Runtime } from '../src/app/runtime.ts'
import type { Sessions } from '../src/app/sessions.ts'
import { Store } from '../src/app/store.ts'
import { key, parseSettings, UserError, type ReplyTo, type Ticket, type Trigger } from '../src/core/index.ts'
import { ChatSource } from '../src/sources/chat.ts'
import type { Source, SourceHost } from '../src/sources/kind.ts'
import { deployment, type Deployment } from './helpers/deployment.ts'
import { stubHost, wait } from './helpers/host.ts'
import { tempDir } from './helpers/temp.ts'

const workerId = (ticketId: string) => `worker-${ticketId}`
const signal = () => new AbortController().signal

/** Ask the system to look now and run what is due, then let the pump finish. */
async function settle(runtime: Runtime, ms = 80): Promise<void> {
  await runtime.nudge()
  await wait(ms)
  runtime.passes.requestPass()
  await wait(ms)
}

/** A message file in the shape the chat Source documents, whose mtime is old enough to be settled. */
const message = (fields: Record<string, string>, body: string): string =>
  `---\n${Object.entries(fields).map(([name, value]) => `${name}: ${value}`).join('\n')}\n---\n${body}\n`

function drop(directory: string, name: string, text: string): void {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, name)
  writeFileSync(path, text, 'utf8')
  const at = new Date(Date.now() - 5_000)
  utimesSync(path, at, at)
}

/**
 * The whole settings document, so a test can switch one thing without losing the rest.
 *
 * `alice` is on `allowedSenders` because that is the point of the map: the platform id is not what the gate compares,
 * the mapped actor name is.
 */
function chatSettings(context: Deployment, directory: string, over: Record<string, unknown> = {}): unknown {
  return {
    acceptMode: 'auto', allowedSenders: ['operator', 'alice'],
    sources: {
      inbox: { directory: context.inbox, pollMs: 1000 },
      chat: {
        enabled: true, identities: { U01ABCDEF: { actor: 'alice', note: 'the operator' } },
        channels: [{ id: 'ops', directory, enabled: true }], pollMs: 1000, ...over,
      },
    },
  }
}

/** A deployment whose chat Source reads one channel directory. */
async function chatDeployment(): Promise<Deployment & { readonly channel: string }> {
  const context = await deployment('auto')
  const channel = join(context.stateDir, 'chat-ops')
  mkdirSync(channel, { recursive: true })
  // Tightened so the Source's own permission check stays quiet: the tests below read the health board, and a line
  // about a world-writable directory in a temp dir would be noise in the way of the fact under test.
  chmodSync(channel, 0o700)
  context.runtime.saveSettings(chatSettings(context, channel))
  await settle(context.runtime)
  return { ...context, channel }
}

/** One message in, one Ticket with a worker running — the state a Report is recorded from. */
async function asked(context: Deployment & { readonly channel: string }): Promise<Ticket> {
  drop(context.channel, 'alert.md', message(
    { from: 'U01ABCDEF', id: 'msg-1', thread: 't-9', title: 'weekly alerts' }, 'Sort out this week\'s alerts.'))
  await settle(context.runtime)
  const ticket = context.runtime.store.tickets.list()[0]!
  // A precondition, not a filler: a Report may only land on a running Assignment, so a launch that did not happen
  // would fail these tests somewhere else and say nothing about the reply.
  expect(context.runtime.store.tickets.get(ticket.id)!.assignments.at(-1)).toMatchObject({ state: 'running' })
  return context.runtime.store.tickets.get(ticket.id)!
}

/** The address the Source wrote onto this Ticket's Trigger, read from the store rather than assumed. */
function replyToOf(runtime: Runtime, ticket: Ticket): ReplyTo {
  const replyTo = runtime.store.triggers.get(ticket.origin.triggerId)?.trigger.replyTo
  expect(replyTo).toBeDefined()
  return replyTo!
}

/** Switch the channel off, which is what makes `deliver` refuse: the address names something no longer there. */
function closeChannel(context: Deployment & { readonly channel: string }): void {
  context.runtime.saveSettings(chatSettings(context, context.channel, {
    channels: [{ id: 'ops', directory: context.channel, enabled: false }],
  }))
}

/** Switch it back on, which is what makes a later reply succeed — the cause of a cleared `delivery` line. */
function reopenChannel(context: Deployment & { readonly channel: string }): void {
  context.runtime.saveSettings(chatSettings(context, context.channel))
}

describe('the chat Source, mounted by the Runtime', () => {
  it('turns a mapped message file into a Ticket whose Mandate says where it came from', async () => {
    const context = await chatDeployment()
    try {
      // The registry is what mounts a kind. Nothing below constructs a ChatSource, so a kind missing from the
      // Runtime's list produces no Trigger at all and this is the test that goes red — the state C2 was for.
      expect(context.runtime.sources.source('chat')).toBeDefined()
      await asked(context)

      const ticket = context.runtime.store.tickets.list()[0]!
      expect(ticket.mandate.via).toBe('chat')
      expect(ticket.mandate.sender).toEqual({ id: 'alice', kind: 'person' })
      expect(ticket.title).toBe('weekly alerts')
      const trigger = context.runtime.store.triggers.get(ticket.origin.triggerId)!.trigger
      expect(trigger.actor).toEqual({ id: 'alice', kind: 'person' })
      expect(trigger.replyTo).toEqual({ kind: 'chat', channel: 'ops', thread: 't-9' })
      // Taken out of the channel's top level and archived once, under its Trigger id.
      expect(readdirSync(context.channel).filter(name => name.endsWith('.md'))).toEqual([])
      expect(readdirSync(join(context.channel, 'accepted'))).toEqual([`${trigger.id}-alert.md`])
    } finally { await context.runtime.stop() }
  })

  it('holds a message from an unmapped identity, and admits the same file once the map names it', async () => {
    const context = await chatDeployment()
    try {
      drop(context.channel, 'stranger.md', message({ from: 'U99NOBODY', id: 'msg-9' }, 'Let me in.'))
      await settle(context.runtime)
      expect(context.runtime.store.tickets.list()).toEqual([])
      expect(context.runtime.store.triggers.list()).toEqual([])
      // Held, not consumed: the file is still where the bridge put it, so the next scan can take it.
      expect(readdirSync(context.channel).filter(name => name.endsWith('.md'))).toEqual(['stranger.md'])
      // And the operator is told, on the board this deployment actually runs, who is waiting and what to do about it.
      const waiting = context.runtime.health.entry('source:chat').snapshot()
      expect(waiting.ok).toBe(false)
      expect(waiting.detail).toContain('1 message(s) from unmapped identities are waiting')
      expect(waiting.detail).toContain('U99NOBODY')

      context.runtime.saveSettings(chatSettings(context, context.channel, {
        identities: { U01ABCDEF: { actor: 'alice' }, U99NOBODY: { actor: 'alice' } },
      }))
      await settle(context.runtime)
      const tickets = context.runtime.store.tickets.list()
      expect(tickets).toHaveLength(1)
      expect(tickets[0]!.mandate.via).toBe('chat')
      expect(readdirSync(join(context.channel, 'accepted'))).toHaveLength(1)
      // Admitted once, and the waiting line is gone with the message that was waiting on it.
      expect(context.runtime.health.entry('source:chat').snapshot().ok).toBe(true)
      expect(context.runtime.store.triggers.list()).toHaveLength(1)
    } finally { await context.runtime.stop() }
  })
})

describe('a reply that goes out', () => {
  it('hands the Source the address from the Trigger and the worker\'s own words, and consumes the effect', async () => {
    const context = await chatDeployment()
    try {
      const ticket = await asked(context)
      await context.host.tool(workerId(ticket.id), 'myagent_report')!.definition.execute(
        { state: 'ready', summary: 'Three of the four were duplicates.', files: ['digest.md'] }, { signal: signal() })
      await settle(context.runtime)

      // The queue drained: one Report, one reply, nothing left pending.
      expect(context.runtime.store.effectCounts()).toEqual({})
      const out = readdirSync(join(context.channel, 'out'))
      expect(out).toHaveLength(1)
      const reply = readFileSync(join(context.channel, 'out', out[0]!), 'utf8')
      expect(reply).toContain('Three of the four were duplicates.')
      expect(reply).toContain('- digest.md')
      // The thread comes back in the front matter, which is the proof `deliver` was handed the Trigger's own address
      // and not one rebuilt from the actor: an actor id says who asked, and nothing about where to answer.
      expect(reply).toContain('thread: t-9')
      // One Report, one reply queued, and nothing counted as having nowhere to go: this Ticket has an address.
      expect(context.runtime.delivery.sends()).toEqual({ queued: 1, nowhere: 0 })
    } finally { await context.runtime.stop() }
  })

  it('brings a blocked question back to the channel, without instructions only myagent\'s own front desk could follow', async () => {
    const context = await chatDeployment()
    try {
      await context.runtime.createMainSession()
      const ticket = await asked(context)
      await context.host.tool(workerId(ticket.id), 'myagent_report')!.definition.execute(
        { state: 'blocked', summary: 'Two ways to sort this.', question: 'By company or by product?' }, { signal: signal() })
      await settle(context.runtime)

      const out = readdirSync(join(context.channel, 'out'))
      expect(out).toHaveLength(1)
      const reply = readFileSync(join(context.channel, 'out', out[0]!), 'utf8')
      expect(reply).toContain('By company or by product?')
      expect(reply).toContain('needs you')
      // Neither of these means anything to somebody on the platform: the directory is on this machine, and the tool is
      // registered in a Session they are not in. Telling them to use it would be a false instruction.
      expect(reply).not.toContain('myagent_answer_ticket')
      expect(reply).not.toContain(ticket.execution!.directory)
      // The front desk still hears about it, which is the other half of a blocked Report and is unchanged.
      expect(context.host.agents.get('myagent-main')!.followups.at(-1)!.text).toContain('By company or by product?')
    } finally { await context.runtime.stop() }
  })

  it('queues one reply when the same words are asked for twice, and a second when they differ', async () => {
    const context = await chatDeployment()
    try {
      const ticket = await asked(context)
      const replyTo = replyToOf(context.runtime, ticket)

      context.runtime.delivery.send(ticket, 'the same sentence')
      // Deliberately more than a millisecond apart. A key that carried the instant would still deduplicate two calls
      // made inside one, which is exactly how C1's mutation check stayed green: the gap has to be wider than the
      // resolution of whatever does not belong in the key.
      await wait(5)
      context.runtime.delivery.send(ticket, 'the same sentence')
      expect(context.runtime.store.effectCounts()).toEqual({ send: 1 })
      expect(context.runtime.store.pendingEffects('send', sendKey(ticket.id, replyTo, 'the same sentence'))).toBe(true)
      // Nothing went out while the two calls were being deduplicated.
      expect(existsSync(join(context.channel, 'out'))).toBe(false)

      context.runtime.delivery.send(ticket, 'a different sentence')
      expect(context.runtime.store.effectCounts()).toEqual({ send: 2 })
      expect(context.runtime.delivery.sends().queued).toBe(3)

      // One pass delivers both, each to its own file: the key is an identity, not a limit of one reply per Ticket.
      // The front matter is the Source's own — it carries the thread back so a bridge can route into it.
      await settle(context.runtime)
      expect(context.runtime.store.effectCounts()).toEqual({})
      const replies = readdirSync(join(context.channel, 'out')).map(name =>
        readFileSync(join(context.channel, 'out', name), 'utf8')).sort()
      expect(replies).toEqual([
        '---\nthread: t-9\n---\na different sentence',
        '---\nthread: t-9\n---\nthe same sentence',
      ])
    } finally { await context.runtime.stop() }
  })
})

describe('a reply that does not go out', () => {
  it('keeps the effect, counts the failure on its row and names it on the board when the Source refuses', async () => {
    const context = await chatDeployment()
    try {
      const ticket = await asked(context)
      const replyTo = replyToOf(context.runtime, ticket)
      closeChannel(context)

      context.runtime.delivery.send(ticket, 'the answer')
      await settle(context.runtime)

      // The row is still there, which is what makes the retry possible at all: an inline send would already have
      // lost these words, with nothing left to say they were ever owed.
      expect(context.runtime.store.effectCounts()).toEqual({ send: 1 })
      expect(context.runtime.store.pendingEffects('send', sendKey(ticket.id, replyTo, 'the answer'))).toBe(true)
      // `failures` on the row itself, read the way the queue reads it: `now` far enough ahead to claim a row that is
      // backing off, then released so the queue's own retry still owns it.
      const rows = context.runtime.store.claimEffects('send', 10, Date.now() + 60_000)
      expect(rows.map(row => [row.key, row.failures])).toEqual([[sendKey(ticket.id, replyTo, 'the answer'), 1]])
      context.runtime.store.releaseRunning()
      expect(context.runtime.health.entry('effects').snapshot()).toMatchObject({ ok: false })
      expect(context.runtime.health.entry('effects').snapshot().detail).toContain('send failed 1 of 5 times')
      expect(context.runtime.health.entry('effects').snapshot().detail).toContain('nowhere to go')
      expect(existsSync(join(context.channel, 'out'))).toBe(false)
      // Retried, not given up on: no trace of a give-up yet, because the queue has four attempts left.
      expect(existsSync(join(ticket.execution!.directory, UNDELIVERED_FILE))).toBe(false)
    } finally { await context.runtime.stop() }
  })

  it('records a give-up in the Ticket\'s log and its directory, and both outlive the health board', async () => {
    const context = await chatDeployment()
    const runtime = context.runtime
    try {
      const ticket = await asked(context)
      const replyTo = replyToOf(runtime, ticket)
      closeChannel(context)
      const owed = 'Three of the four were duplicates; the fourth needs your decision.'

      runtime.delivery.send(ticket, owed)
      await settle(runtime)
      // Attempts 2 to 5, each pulled forward instead of waited out: the real backoff is 15s, 30s, 60s…, and what is
      // under test is the give-up rather than the clock. The count is the Runtime's own budget, not one this test sets,
      // so the wiring under test is the one that ships.
      for (let attempt = 2; attempt <= 5; attempt++) {
        runtime.store.deferEffect('send', sendKey(ticket.id, replyTo, owed), Date.now() - 1)
        await runtime.effects.runDue()
      }

      // The queue settled the row when it gave up, so the queue itself now holds nothing: this is the hole.
      expect(runtime.store.effectCounts()).toEqual({})
      // First record: an event in the Ticket's own log, what its history renders, carrying the address, the error and
      // the words that were owed — read back through the Engine, not through whatever the writer returned.
      const lost = runtime.engine.history(ticket.id).filter(event => event.type === 'reply_lost')
      expect(lost).toHaveLength(1)
      expect(lost[0]!.by).toEqual({ kind: 'system', id: 'delivery' })
      expect(lost[0]!.detail).toMatchObject({ address: 'chat/ops (thread t-9)', text: owed })
      expect(String(lost[0]!.detail!.error)).toContain('nowhere to go')
      // Second record: the file, which carries the words verbatim so a person can send them by hand.
      const path = join(ticket.execution!.directory, UNDELIVERED_FILE)
      const trace = readFileSync(path, 'utf8')
      expect(trace).toContain(owed)
      expect(trace).toContain(ticket.id)
      expect(trace).toContain('chat/ops (thread t-9)')
      expect(trace).toContain('nowhere to go')
      // Named literally, and not only through the imported constant: this is a file a person opens in the Ticket's
      // directory, and a test that took the name from the code would stay green if the code renamed it.
      expect(readdirSync(ticket.execution!.directory)).toContain('REPLY-UNDELIVERED.md')

      // THE POINT OF THE TEST: an unrelated success clears the board — that is what `record` is for, and it is why a
      // health line is not a record — and both traces are still readable where they live: in the store, and on disk.
      //
      // Caused rather than simulated. The two `record` calls this used to make asserted a property the system did not
      // have, so the assertions under them passed on the test's own say-so; each entry is now cleared by its own part,
      // and the two are cleared by different things, which is the part worth stating: the queue ends a pass with a
      // summary once nothing it complained about is still queued, while Delivery has no pass of its own — its handlers
      // run inside the queue's — so the only thing it can speak for is one delivery that went through.
      reopenChannel(context)
      const later = 'a later sentence, which does get through'
      runtime.delivery.send(ticket, later)
      await settle(runtime)
      // The clearing was caused by a delivery that really happened, not by a handler that quietly did nothing.
      const out = readdirSync(join(context.channel, 'out'))
        .map(name => readFileSync(join(context.channel, 'out', name), 'utf8'))
      expect(out.join('\n')).toContain(later)
      expect(runtime.health.entry('effects').snapshot())
        .toMatchObject({ ok: true, detail: 'no effect failed in this pass' })
      expect(runtime.health.entry('delivery').snapshot())
        .toMatchObject({ ok: true, detail: 'the last delivery went through' })
      expect(readFileSync(path, 'utf8')).toBe(trace)
      expect(runtime.engine.history(ticket.id).filter(event => event.type === 'reply_lost')).toHaveLength(1)
    } finally { await runtime.stop() }
  })

  it('fails the effect rather than calling something that is not there when the address names a Source that only produces', async () => {
    const context = await chatDeployment()
    try {
      const ticket = await asked(context)
      const stored = context.runtime.store.triggers.get(ticket.origin.triggerId)!
      // The narrowing is the contract's own (`typeof source.deliver === 'function'`), and the only way to reach it in
      // a real deployment is an address that names a kind which cannot answer back: `rule` is mounted and produces
      // Triggers, and has no `deliver` at all.
      const produces = context.runtime.sources.source('rule') as { deliver?: unknown } | undefined
      expect(typeof produces?.deliver).not.toBe('function')
      context.runtime.store.triggers.save({
        ...stored,
        trigger: { ...stored.trigger, replyTo: { kind: 'rule', channel: 'nowhere' } },
      })

      const replyTo = replyToOf(context.runtime, ticket)
      context.runtime.delivery.send(ticket, 'the answer')
      await settle(context.runtime)

      // Rode the queue's machinery instead of being swallowed: a refusal here is a fact about the deployment that has
      // to be retried and, when it never succeeds, recorded — not an exception caught where nobody will see it.
      expect(context.runtime.store.effectCounts()).toEqual({ send: 1 })
      const detail = context.runtime.health.entry('effects').snapshot().detail!
      // Named for its own cause, by code: the other refusal — a two-way Source that WAS found, whose channel is gone or
      // disabled — keeps `reply_unroutable`, because the two have different remedies and one message for both sends
      // whoever reads it looking in the wrong place.
      expect(detail).toContain('No Source is running that can take this reply back')
      expect(detail).not.toContain('channel is gone')
      // The row is keyed by the address `send` read out of the store, which is the proof it resolved the Trigger
      // rather than assuming the kind this deployment happens to have configured.
      expect(context.runtime.store.pendingEffects('send', sendKey(ticket.id, replyTo, 'the answer'))).toBe(true)
      expect(context.runtime.delivery.sends()).toMatchObject({ queued: 1 })
    } finally { await context.runtime.stop() }
  })
})

describe('a Ticket with no way back', () => {
  it('sends nothing, throws nothing, and counts the nothing', async () => {
    const context = await deployment('auto')
    const runtime = context.runtime
    try {
      // The inbox's own shape: a request whose Trigger carries no `replyTo`, because a directory cannot receive an
      // answer. Every cron, inbox, session and rule Ticket in every existing deployment is this case.
      drop(context.inbox, 'digest.md', '---\ntitle: 写一份目录说明\n---\n创建 hello.md。')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      expect(runtime.store.triggers.get(ticket.origin.triggerId)!.trigger.replyTo).toBeUndefined()

      const before = runtime.delivery.sends()
      expect(() => runtime.delivery.send(ticket, 'an answer with nowhere to go')).not.toThrow()
      expect(runtime.store.effectCounts().send).toBeUndefined()
      expect(runtime.delivery.sends()).toEqual({ queued: before.queued, nowhere: before.nowhere + 1 })
      // Having nowhere to send is not a problem, and must not be written as one: `record` would erase a real problem
      // on the same entry, and a board that cries wolf about cron Tickets is a board nobody reads.
      expect(runtime.health.entry('delivery').snapshot()).toMatchObject({ ok: true })
    } finally { await runtime.stop() }
  })

  it('counts the ordinary Reports it could not send back, so the number is a fact about the deployment', async () => {
    const context = await deployment('auto')
    const runtime = context.runtime
    try {
      await runtime.createMainSession()
      drop(context.inbox, 'digest.md', '---\ntitle: 写一份目录说明\n---\n创建 hello.md。')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      // Nothing asked for a reply, so nothing was queued...
      expect(runtime.delivery.sends()).toEqual({ queued: 0, nowhere: 0 })
      await context.host.tool(workerId(ticket.id), 'myagent_report')!.definition.execute(
        { state: 'ready', summary: '写好了。' }, { signal: signal() })
      await settle(runtime)
      // ...and the Report that reached the front desk and `RESULT.md` is counted as having had nowhere else to go,
      // which is the observable half of §3.3: "it was not sent" is a fact this deployment can now answer.
      expect(runtime.delivery.sends()).toEqual({ queued: 0, nowhere: 1 })
      expect(runtime.store.effectCounts()).toEqual({})
      expect(existsSync(join(ticket.execution!.directory, 'RESULT.md'))).toBe(true)
    } finally { await runtime.stop() }
  })
})

describe('a deployment that never configured chat', () => {
  it('still runs every Source it had, with chat mounted and saying it is disabled', async () => {
    const context = await deployment('auto')
    try {
      // Mounting a kind is not enabling it: `sources.chat.enabled` defaults to false, and a Source that reads a place
      // nobody named must not start reading one. The four kinds that were already there are unaffected by the
      // addition, which is the fact worth pinning — the registry isolates a kind that throws while starting, and a
      // chat Source that is off throws nothing, so nothing here may go missing or go red.
      expect(Object.keys(context.runtime.sources.status()).sort()).toEqual(['chat', 'cron', 'inbox', 'rule', 'session'])
      expect(context.runtime.sources.status().chat).toMatchObject({ ok: true, detail: 'disabled' })
      expect(context.runtime.health.problems().some(problem => problem.name === 'source:chat')).toBe(false)
      expect(context.runtime.setupProblem()).toBeUndefined()
    } finally { await context.runtime.stop() }
  })
})

/**
 * The two refusals a reply can meet, told apart BY CODE.
 *
 * A deployment cannot show the error object: the queue turns it into a health line and a trace, both of which carry the
 * sentence. So this harness keeps the queue's own give-up hook, which is handed the thrown error itself, and runs the
 * dispatcher against the two causes — nothing running that could carry the reply, and a real ChatSource whose channel
 * is not in its settings. Asserting the sentences would pass even if the two codes collapsed back into one, which is
 * the whole reason `reply_unreceivable` exists next to `reply_unroutable`.
 */
describe('a reply nothing can take', () => {
  const AT = '2026-11-04T03:00:00.000Z'

  /** A Source that produces and cannot answer back: mounted, running, no `deliver` at all. */
  const oneWay: Source = {
    id: 'rule', kind: 'rule', start: (): void => {}, stop: (): void => {}, status: () => ({ ok: true }),
  }

  /**
   * A real ChatSource whose settings name no channels, so its own `deliver` refuses the address.
   *
   * `deliver` reads `settings()` and nothing else, so the rest of the host is a stub this path never reaches — the
   * throw under test is chat.ts's own, not a fake standing in for it.
   */
  function channellessChat(): ChatSource {
    const settings = parseSettings({ sources: { chat: { enabled: true, channels: [] } } })
    return new ChatSource({ settings: () => settings } as unknown as SourceHost)
  }

  /** A Delivery over a queue with one attempt, so the first refusal is also the give-up the hook is handed. */
  function refusal(source: (kind: string) => Source | undefined): { threw: unknown[]; send: (text: string) => Promise<void> } {
    const directory = tempDir('myagent-send-')
    const store = new Store(join(directory, 'refusal.sqlite3'))
    const health = new HealthBoard()
    const threw: unknown[] = []
    const effects = new Effects(store, {
      tries: 1, retryIntervalMs: 1, health: health.entry('effects'),
      onPermanentFailure: (_kind, _key, _payload, error) => { threw.push(error) },
    })
    const host = stubHost()
    const delivery = new OutcomeDelivery({
      context: host.ctx, store, effects, health, lifetime: signal(), subprocess: host.ctx.subprocess,
      settings: () => store.settings(), panelPath: () => '', source: kind => source(kind),
      // Nothing is told anything here: a reply is refused before it reaches a Session, and the log event is the
      // deployment test's business. What is under test is which error the dispatcher threw.
      sessions: {} as unknown as Sessions, replyLost: () => {},
    }, null)
    const triggerId = key('chat', 'ops', 'msg-1')
    store.triggers.save({
      trigger: {
        id: triggerId, source: 'chat', kind: 'chat', at: AT, actor: { id: 'alice', kind: 'person' },
        text: 'Sort this out.', title: 'alerts', replyTo: { kind: 'chat', channel: 'ops' },
      },
      disposition: { state: 'accepted', ticketId: 'ticket-1', decisionId: 'decision-1' },
    })
    const ticket: Ticket = {
      id: 'ticket-1', title: 'alerts', createdAt: AT, origin: { triggerId }, attachments: [], assignments: [],
      notes: [], inputs: [],
      mandate: {
        policyVersion: 'abc123', scope: 'Work in this Ticket\'s own directory.', strength: 'explicit',
        sender: { id: 'alice', kind: 'person' }, via: 'chat', at: AT,
      },
    }
    return { threw, send: async text => { delivery.send(ticket, text); await effects.runDue() } }
  }

  it('says "nothing can carry this" and "the channel is gone" in two different codes', async () => {
    const noCarrier = refusal(() => oneWay)
    await noCarrier.send('the answer')
    const unreceivable = noCarrier.threw[0]
    expect(unreceivable).toBeInstanceOf(UserError)
    expect((unreceivable as UserError).code).toBe('reply_unreceivable')

    const noChannel = refusal(kind => kind === 'chat' ? channellessChat() : undefined)
    await noChannel.send('the answer')
    const unroutable = noChannel.threw[0]
    expect(unroutable).toBeInstanceOf(UserError)
    expect((unroutable as UserError).code).toBe('reply_unroutable')

    // The point of the pair: one says "install or enable a Source that can answer back", the other says "put the
    // channel back". Same symptom from the outside, different remedy, so they may not share a code.
    expect((unreceivable as UserError).code).not.toBe((unroutable as UserError).code)
  })
})
