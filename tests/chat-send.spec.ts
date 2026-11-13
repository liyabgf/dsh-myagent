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
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, utimesSync, writeFileSync, symlinkSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
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

describe('chat durable reply file contract', () => {
  it('atomically replaces a reply and keeps distinct ticket/file metadata identities separate', async () => {
    const directory = tempDir('myagent-chat-out-')
    const settings = parseSettings({ sources: { chat: { channels: [{ id: 'ops', directory, enabled: true }] } } })
    const source = new ChatSource({ settings: () => settings } as SourceHost)
    const address: ReplyTo = { kind: 'chat', channel: 'ops', thread: 't-9' }
    await source.deliver(address, 'same text', { ticketId: 'ticket-a', files: ['/a.txt'] })
    await source.deliver(address, 'same text', { ticketId: 'ticket-b', files: ['/b.txt'] })
    const out = join(directory, 'out')
    expect(readdirSync(out).filter(name => name.endsWith('.md'))).toHaveLength(2)
    await source.deliver(address, 'same text', { ticketId: 'ticket-a', files: ['/a.txt'] })
    expect(readdirSync(out)).toHaveLength(2)
    const contents = readdirSync(out).map(name => readFileSync(join(out, name), 'utf8'))
    expect(contents.some(text => text.includes('ticket: ticket-a') && text.includes('/a.txt'))).toBe(true)
    expect(contents.some(text => text.includes('ticket: ticket-b') && text.includes('/b.txt'))).toBe(true)

    expect(readdirSync(out).some(name => name.startsWith('.tmp-'))).toBe(false)
  })
})

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
      // 【产品变更】旧断言：
      //   expect(replies).toEqual(['---\nthread: t-9\n---\na different sentence', '---\nthread: t-9\n---\nthe same sentence'])
      // 改动理由：出站信封新增 `ticket: <ticketId>` 头，供统一路由网关记录平台消息 ID 到 Ticket 的映射以实现引用回复续接。
      expect(replies).toEqual([
        `---\nthread: t-9\nticket: ${ticket.id}\n---\na different sentence`,
        `---\nthread: t-9\nticket: ${ticket.id}\n---\nthe same sentence`,
      ])
    } finally { await context.runtime.stop() }
  })
})

describe('a Ticket that stopped without an answer (S1)', () => {
  /**
   * `waiting` is the state a Ticket gets when its worker's turn ended with nothing to show — an abort, a crash, a turn
   * that ran out. It used to be grouped with `progress` as "for the panel alone", and the cost was concrete: the panel
   * filed the Ticket under "needs you" while the person who asked in a chat room heard nothing at all, because a chat
   * requester has never seen the panel. The work was stopped and only a person could restart it.
   *
   * The rule now is the two-condition one: tell somebody when silence makes it worse AND nobody else is going to look.
   * `progress` still fails the first condition and must keep sending nothing — a progress line per turn in a chat room
   * is how a bot gets muted.
   */
  const waiting = { state: 'waiting' as const, summary: 'The worker ended its turn without a report.', at: '2026-11-07T04:00:00.000Z' }

  it('reaches the requester, and says what became of the work rather than calling it dropped', async () => {
    const context = await chatDeployment()
    try {
      const ticket = await asked(context)
      context.runtime.delivery.report(ticket, waiting)
      await settle(context.runtime)
      const out = readdirSync(join(context.channel, 'out')).filter(name => name.endsWith('.md'))
      expect(out).toHaveLength(1)
      const reply = readFileSync(join(context.channel, 'out', out[0]!), 'utf8')
      expect(reply).toContain('stopped, needs a push')
      expect(reply).toContain('The worker ended its turn without a report.')
      // Not 'dropped': a dropped Ticket was judged to need no work, and this one has work that has stopped.
      expect(reply).not.toContain('dropped')
      // The requester is not told about myagent's own tools or directories — they cannot act on either.
      expect(reply).not.toContain('myagent_retry_ticket')
      expect(reply).not.toContain(ticket.execution!.directory)
    } finally { await context.runtime.stop() }
  })

  it('wakes the front desk with the way to act, because a notice in a history nobody reads is not an escalation', async () => {
    const context = await chatDeployment()
    try {
      const ticket = await asked(context)
      context.runtime.delivery.report(ticket, waiting)
      await settle(context.runtime)
      const told = context.host.agents.get('myagent-main')!.followups.at(-1)!.text
      expect(told).toContain('stopped, needs a push')
      // The front desk is the one place that can act without the operator, so it gets the tool name.
      expect(told).toContain('myagent_retry_ticket')
      expect(told).toContain('myagent_stop_ticket')
    } finally { await context.runtime.stop() }
  })

  it('still sends nothing for progress — the other half of the rule, and the one that keeps a chat room quiet', async () => {
    const context = await chatDeployment()
    try {
      const ticket = await asked(context)
      const before = context.runtime.delivery.sends().queued
      context.runtime.delivery.report(ticket, { state: 'progress', summary: '读了 12 个文件', at: '2026-11-07T04:00:00.000Z' })
      await settle(context.runtime)
      expect(context.runtime.delivery.sends().queued).toBe(before)
      expect(existsSync(join(context.channel, 'out'))).toBe(false)
    } finally { await context.runtime.stop() }
  })
})

describe('progress and giving up, routed (S2)', () => {
  it('progress reaches the front desk and never the requester — one line per turn in a room is how a bot gets muted', async () => {
    const context = await chatDeployment()
    try {
      const ticket = await asked(context)
      context.runtime.delivery.report(ticket, { state: 'progress', summary: '读完了 12 个文件，正在比对', at: '2026-11-07T05:00:00.000Z' })
      await settle(context.runtime)
      // Nothing went to the platform.
      expect(existsSync(join(context.channel, 'out'))).toBe(false)
      expect(context.runtime.store.effectCounts().send).toBeUndefined()
      // But the front desk has it, so "how is it going" can be answered from the room instead of reconstructed.
      const desk = context.host.agents.get('myagent-main')!
      expect(desk.notices.at(-1)!.text).toContain('读完了 12 个文件，正在比对')
      // Injected, NOT queued: a progress line is a fact to know, not a question to answer, and queueing it would cost
      // the front desk a turn per progress report. The stub keeps the two apart (`notices` vs `followups`), so the
      // distinction is asserted rather than assumed.
      expect(desk.followups).toEqual([])
    } finally { await context.runtime.stop() }
  })

  it('the Watchdog giving up reaches the requester, and wakes the front desk with the means to act', async () => {
    const context = await chatDeployment()
    try {
      const ticket = await asked(context)
      context.runtime.delivery.escalated(ticket, 'has not started after 2 attempts to rescue it; it needs a person')
      await settle(context.runtime)
      const out = readdirSync(join(context.channel, 'out')).filter(name => name.endsWith('.md'))
      expect(out).toHaveLength(1)
      const reply = readFileSync(join(context.channel, 'out', out[0]!), 'utf8')
      expect(reply).toContain('needs a person')
      expect(reply).toContain('has not started after 2 attempts to rescue it')
      expect(reply).not.toContain('myagent_retry_ticket')
      const told = context.host.agents.get('myagent-main')!.followups.at(-1)!.text
      expect(told).toContain('the Watchdog has given up')
      expect(told).toContain('myagent_retry_ticket')
    } finally { await context.runtime.stop() }
  })
})

  /**
   * The wiring, not the rule. `isFirstEscalation` has its own unit test, and it passed while this did not exist — so
   * removing the runtime's call to it left all 962 tests green. A mutation that only a freshness check notices is not
   * guarded: the Watchdog re-escalates on every pass, and without this the requester is messaged every `everyMs`.
   *
   * `watchdogHost()` is private, reached through a cast as this suite already does for a Source's optional methods.
   */
  it('records every escalation and tells the requester once, because the Watchdog gives up again on every pass', async () => {
    const context = await chatDeployment()
    try {
      const ticket = await asked(context)
      const host = (context.runtime as unknown as {
        watchdogHost(): { escalate(ticketId: string, why: string): void }
      }).watchdogHost()
      const why = 'has not started after 2 attempts to rescue it; it needs a person'
      host.escalate(ticket.id, why)
      await settle(context.runtime)
      host.escalate(ticket.id, why)
      host.escalate(ticket.id, why)
      await settle(context.runtime)

      // The history keeps all three: that is what answers "how many times did we give up on this".
      const escalations = context.runtime.store.events.list(ticket.id).filter(event => event.type === 'escalated')
      expect(escalations).toHaveLength(3)
      // The requester heard it once. One fact, one push — a repeated alarm trains a person to ignore it.
      const out = readdirSync(join(context.channel, 'out')).filter(name => name.endsWith('.md'))
      expect(out).toHaveLength(1)
      expect(context.runtime.delivery.sends().queued).toBe(1)
    } finally { await context.runtime.stop() }
  })
describe('the front desk writing back to whoever asked (S3a)', () => {
  /**
   * Until now the front desk could act on a Ticket — answer its worker, retry it, stop it — but had no way to say
   * anything to the person who asked. `myagent_answer_ticket` hands text to the WORKER, so a front desk that knew the
   * answer still had to route it through a worker it did not need. This is the capability "pull beats push" depends on:
   * the operator asks in a chat room, and the answer has to be able to go back to that room.
   *
   * The address is resolved from the Ticket's Trigger and never passed in, so the tool cannot be talked into posting
   * somewhere else.
   */
  const runtime = (context: { runtime: unknown }): { replyToRequester(id: string, text: string): { sent: boolean; address?: string; reason?: string } } =>
    context.runtime as { replyToRequester(id: string, text: string): { sent: boolean; address?: string; reason?: string } }

  it('puts the words in out/, and records on the Ticket that the requester was told', async () => {
    const context = await chatDeployment()
    try {
      const ticket = await asked(context)
      const outcome = runtime(context).replyToRequester(ticket.id, '我看过了：三张在跑，一张卡在等人回答。')
      expect(outcome.sent).toBe(true)
      expect(outcome.address).toContain('chat/')
      await settle(context.runtime)

      const out = readdirSync(join(context.channel, 'out')).filter(name => name.endsWith('.md'))
      expect(out).toHaveLength(1)
      expect(readFileSync(join(context.channel, 'out', out[0]!), 'utf8')).toContain('三张在跑')

      // The history says a person-facing message went out, and who sent it — without this an operator reading the
      // Ticket cannot tell whether the requester was ever told anything.
      const replied = context.runtime.store.events.list(ticket.id).filter(event => event.type === 'replied')
      expect(replied).toHaveLength(1)
      expect(replied[0]!.by).toEqual({ kind: 'agent', id: 'front-desk' })
      expect(replied[0]!.detail).toMatchObject({ chars: '我看过了：三张在跑，一张卡在等人回答。'.length })
    } finally { await context.runtime.stop() }
  })

  it('says why it cannot write back for a Ticket with no address, rather than reporting a reply that went nowhere', async () => {
    const context = await chatDeployment()
    try {
      const made = context.runtime.engine.createTicket({ title: '自己开的活', text: '整理一下' })
      const outcome = runtime(context).replyToRequester(made.ticketId!, '有人吗')
      expect(outcome.sent).toBe(false)
      // The reason names the shape, so the front desk tells the operator here instead of inventing another route.
      expect(outcome.reason).toContain('nowhere to write back to')
      expect(outcome.reason).toContain('panel, the inbox or a schedule')
      expect(existsSync(join(context.channel, 'out'))).toBe(false)
      expect(context.runtime.store.events.list(made.ticketId!).filter(event => event.type === 'replied')).toEqual([])
    } finally { await context.runtime.stop() }
  })

  /**
   * The capability end to end: a Ticket the front desk opens on somebody's behalf reports back to that somebody.
   *
   * This is the guard that survives deleting any one of the tests above, because it observes the whole path — address
   * copied from an existing Trigger, carried on the synthesized one, resolved by `Delivery.send` — rather than one
   * function's return value.
   */
  it('a Ticket the front desk opens with a copied address reports back into the same chat', async () => {
    const context = await chatDeployment()
    try {
      const asked_ = await asked(context)
      const runtime = context.runtime as unknown as { returnAddressOf(id: string): unknown }
      const address = runtime.returnAddressOf(asked_.id) as { kind: 'chat'; channel: string; thread?: string }
      expect(address, '被问的那张任务应当有回程地址').toBeDefined()

      const made = context.runtime.engine.createTicket({ title: '巡视一遍', text: '看看现在有几张在跑', replyTo: address })
      const survey = context.runtime.store.tickets.get(made.ticketId!)!
      context.runtime.delivery.report(survey, { state: 'ready', summary: '三张在跑，没有卡住的。', at: '2026-11-07T06:00:00.000Z' })
      await settle(context.runtime)

      const out = readdirSync(join(context.channel, 'out')).filter(name => name.endsWith('.md'))
      expect(out.length).toBeGreaterThan(0)
      const bodies = out.map(name => readFileSync(join(context.channel, 'out', name), 'utf8'))
      // The survey's answer reached the room the original question came from.
      expect(bodies.some(body => body.includes('三张在跑，没有卡住的。'))).toBe(true)

      // And the front desk writing back directly is queued too, observed through Delivery's own tally rather than
      // through the filesystem: a second observation point in a second test, so removing the assertions in the test
      // above does not leave "replyToRequester claims success without sending" unguarded (0.8 measured exactly that).
      const before = context.runtime.delivery.sends().queued
      const outcome = (context.runtime as unknown as {
        replyToRequester(id: string, text: string): { sent: boolean; address?: string }
      }).replyToRequester(survey.id, '还有一张在等人回答。')
      expect(outcome.sent).toBe(true)
      expect(context.runtime.delivery.sends().queued).toBe(before + 1)
    } finally { await context.runtime.stop() }
  })

  it('refuses a Ticket that does not exist, with the id it was given', async () => {
    const context = await chatDeployment()
    try {
      const outcome = runtime(context).replyToRequester('nosuchticket', '有人吗')
      expect(outcome).toEqual({ sent: false, reason: 'There is no Ticket nosuchticket.' })
    } finally { await context.runtime.stop() }
  })
})

describe('outbound file delivery on a ready report (Pkg 2)', () => {
  it('attaches verified files inside the Ticket directory to the outbound envelope, and refuses symbolic links', async () => {
    const context = await chatDeployment()
    try {
      const ticket = await asked(context)
      const dir = ticket.execution!.directory
      mkdirSync(dir, { recursive: true })
      const validFile = join(dir, 'summary.csv')
      writeFileSync(validFile, 'company,round\nDeepSeek,A\n', 'utf8')
      const outside = join(context.stateDir, 'secret-outside.txt')
      writeFileSync(outside, 'do-not-leak', 'utf8')
      symlinkSync(outside, join(dir, 'leaked.txt'))

      context.runtime.delivery.report(ticket, {
        state: 'ready',
        summary: '研究完成，数据见附件。',
        files: ['summary.csv', 'leaked.txt', '../secret-outside.txt'],
        at: '2026-11-07T10:00:00.000Z',
      })
      await settle(context.runtime)

      const out = readdirSync(join(context.channel, 'out')).filter(name => name.endsWith('.md'))
      expect(out).toHaveLength(1)
      const envelope = readFileSync(join(context.channel, 'out', out[0]!), 'utf8')
      const head = envelope.slice(0, envelope.indexOf('\n---\n', 4))
      expect(head).toContain(`ticket: ${ticket.id}`)
      expect(head).toContain(`files: ${validFile}`)
      expect(head).not.toContain('leaked.txt')
      expect(head).not.toContain('secret-outside.txt')
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

  it('a stopped Ticket with nowhere to write still wakes the front desk, and counts the place it could not reach', async () => {
    // The inbox's shape, as in the test above: a Trigger with no `replyTo`, because a directory cannot receive an
    // answer. This is the half of the new rule that must NOT change — "no address" means the requester cannot be
    // told, not that nobody can act, and not that a problem should be written down either.
    const context = await deployment('auto')
    const runtime = context.runtime
    try {
      await runtime.createMainSession()
      drop(context.inbox, 'stalled.md', '---\ntitle: 会停下来的活\n---\n创建 hello.md。')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      expect(runtime.store.triggers.get(ticket.origin.triggerId)!.trigger.replyTo).toBeUndefined()

      const before = runtime.delivery.sends()
      runtime.delivery.report(ticket, {
        state: 'waiting', summary: 'The worker ended its turn without a report.', at: '2026-11-07T04:00:00.000Z',
      })
      await settle(runtime)
      // Nothing was sent, and the fact that there was nowhere to send it is counted rather than swallowed.
      expect(runtime.delivery.sends()).toEqual({ queued: before.queued, nowhere: before.nowhere + 1 })
      expect(runtime.store.effectCounts().send).toBeUndefined()
      // Still not a problem on the board: a cron or inbox Ticket with nowhere to write is the normal shape here.
      expect(runtime.health.entry('delivery').snapshot()).toMatchObject({ ok: true })
      // But the front desk hears it, because it is the one place that can act without an address.
      expect(context.host.agents.get('myagent-main')!.followups.at(-1)!.text).toContain('myagent_retry_ticket')
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
      // 【G-3 站点 2】同生产路径的真写（这个桩的 notify 也会走到结束文档）。
      writeResultFile: async (directory: string, name: string, text: string) => {
        await writeFile(join(directory, name), text, 'utf8')
      },
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

/**
 * The borrowed-work line reaching the room (减负).
 *
 * The wording has its own unit tests in `delivery.spec.ts`, against a queue that records instead of delivering. What
 * only a whole deployment can show is the wiring: the sentence is read out of the real event log at report time,
 * survives the effects queue's payload, and lands in the file a bridge picks up. Every other test in this suite has one
 * Ticket in it, so until now there was nowhere for this line to come from.
 */
describe('a reply that says what it was built on', () => {
  it('names the earlier job in the room, and in RESULT.md, with no id and no path in either', async () => {
    const context = await chatDeployment()
    try {
      const first = await asked(context)
      // Registered by a report, which is the only thing that makes a file another Ticket's artifact at all.
      await context.runtime.engine.report(first.id, { state: 'ready', summary: '数据抓完了', files: ['data/table.csv'] })
      await settle(context.runtime)

      // A second question in the same room, so the second Ticket has its own way back.
      drop(context.channel, 'second.md', message(
        { from: 'U01ABCDEF', id: 'msg-2', thread: 't-9', title: 'write it up' }, 'Write it up.'))
      await settle(context.runtime)
      const second = context.runtime.store.tickets.list().find(row => row.title === 'write it up')!
      expect(second, '第二张任务应当已经起来').toBeDefined()
      expect(second.execution).toBeDefined()

      // The real door, and the only thing this test arranges by hand: `authorizeArtifactRead` answers whether the read
      // may happen and `recordArtifactRead` is what writes the lineage into both Tickets' logs — the same two calls the
      // Runtime makes on a worker's success path (`runtime.ts:742`, `runtime.ts:771`). So the sentence below is caused
      // by the system's own recording, not simulated into the log.
      const authorized = context.runtime.engine.authorizeArtifactRead(second.id, first.id, 'data/table.csv')
      context.runtime.engine.recordArtifactRead(second.id, first.id, authorized.artifact.path)
      expect(context.runtime.store.events.list(second.id).filter(event => event.type === 'artifact_read')).toHaveLength(1)

      context.runtime.delivery.report(second, {
        state: 'ready', summary: '写好了，结论在正文里。', at: '2026-11-08T03:00:00.000Z',
      })
      await settle(context.runtime)

      const envelopes = readdirSync(join(context.channel, 'out'))
        .map(name => readFileSync(join(context.channel, 'out', name), 'utf8'))
      const envelope = envelopes.find(candidate => candidate.includes('写好了，结论在正文里。'))
      expect(envelope, '第二张任务的回复应当已经落到 out/').toBeDefined()
      const cut = envelope!.indexOf('\n---\n', 4)
      const head = envelope!.slice(0, cut)
      const body = envelope!.slice(cut + 5)
      // The envelope's own routing header is the bridge's business and still carries the id, as it always has.
      expect(head).toContain(`ticket: ${second.id}`)
      // The prose a person reads carries the earlier job's TITLE — how the operator remembers it — and nothing else.
      expect(body).toContain('（这份用上了「weekly alerts」的成果）')
      expect(body).toBe('写好了，结论在正文里。\n\n（这份用上了「weekly alerts」的成果）')
      expect(body).not.toContain(first.id)
      expect(body).not.toContain(second.id)
      expect(body).not.toContain(first.execution!.directory)
      expect(body).not.toContain('data/table.csv')
      expect(body).not.toContain('myagent_')

      // The same sentence, unwrapped, in the file that outlives the message: two texts about one fact, agreeing.
      const document = readFileSync(join(second.execution!.directory, 'RESULT.md'), 'utf8')
      expect(document).toContain('## Borrowed work')
      expect(document).toContain('这份用上了「weekly alerts」的成果')
      expect(document).not.toContain('（这份用上了')
    } finally { await context.runtime.stop() }
  })

  /**
   * The two halves of the craft line live in different files: `Engine.skillUsed` WRITES `detail.fromTicketId` and
   * `detail.skill`, and `delivery.borrowedFrom` READS those keys. Nothing else owns that comparison — the unit tests on
   * each side hand-write the shape they expect, so renaming either key would silently drop the line from every reply
   * and fail nothing. This test goes through the real engine door and the real outbound envelope.
   */
  it('counts a craft the engine itself recorded, so the shape one file writes is the shape the other reads', async () => {
    const context = await chatDeployment()
    try {
      const first = await asked(context)
      await context.runtime.engine.report(first.id, { state: 'ready', summary: '写好了一个通用脚本', files: ['dedup.py'] })
      await settle(context.runtime)

      drop(context.channel, 'third.md', message(
        { from: 'U01ABCDEF', id: 'msg-3', thread: 't-9', title: 'reuse it' }, 'Reuse it.'))
      await settle(context.runtime)
      const second = context.runtime.store.tickets.list().find(row => row.title === 'reuse it')!
      expect(second, '第二张任务应当已经起来').toBeDefined()

      // The real door, not a hand-written event: this is what `Runtime.skillLoaded` calls after a worker's load of a
      // promoted craft completes.
      context.runtime.engine.skillUsed(second.id, first.id, 'myagent-dedup-merger')
      const events = context.runtime.store.events.list(second.id).filter(event => event.type === 'skill_used')
      expect(events).toHaveLength(1)
      expect(events[0]!.detail).toMatchObject({ fromTicketId: first.id, skill: 'myagent-dedup-merger' })

      context.runtime.delivery.report(second, {
        state: 'ready', summary: '跑完了。', at: '2026-11-08T04:00:00.000Z',
      })
      await settle(context.runtime)

      const envelope = readdirSync(join(context.channel, 'out'))
        .map(name => readFileSync(join(context.channel, 'out', name), 'utf8'))
        .find(candidate => candidate.includes('跑完了。'))
      expect(envelope, '回复应当已经落到 out/').toBeDefined()
      const body = envelope!.slice(envelope!.indexOf('\n---\n', 4) + 5)
      // The craft is counted, never named: `myagent-dedup-merger` is a plugin identifier that means nothing on a phone.
      expect(body).toBe('跑完了。\n\n（这份用上了 1 门已沉淀的手艺）')
      expect(body).not.toContain('myagent-dedup-merger')
      expect(body).not.toContain(first.id)
      expect(body).not.toContain(second.id)
    } finally { await context.runtime.stop() }
  })
})
