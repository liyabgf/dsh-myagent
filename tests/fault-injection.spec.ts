/**
 * Fault injection: what the system leaves behind when a side effect cannot be done at all.
 *
 * Every failure here is injected through a surface that already exists — the DSH agent call that carries a notice, the
 * tool restriction a worker Session needs, the payload a durable queue row carries — and never through a hook in
 * `src/`, so the queue's own retry, backoff and give-up run unmodified. A test that exercises a production fault hook
 * proves the hook works; these prove the system does. `tests/helpers/host.ts`'s `notify` knob is the piece that made
 * the notify half reachable at all, and `docs/v2/17-fault-injection.md` records what the trigger half was measured to
 * leave behind when it had nothing: no Trigger, no Decision, no Ticket, and one health line the next pass erased.
 * The `lost` disposition is what closed that, and the one fault still unreachable offline is a Store write failing —
 * §3.0 of that document says why, and the test that needs it says so where it seams around it.
 *
 * Retries are pulled forward rather than waited out: the real backoff is 15s, 30s, 60s, and the budget of 5 attempts
 * is the Runtime's own rather than one a test sets, so the wiring under test is the wiring that ships.
 */
import { readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Config } from '../src/deployment.ts'
import { createRuntime, type Runtime } from '../src/app/runtime.ts'
import { key, ticketIdOf, type LostTrigger, type Trigger } from '../src/core/index.ts'
import { deployment, type Deployment } from './helpers/deployment.ts'
import { stubHost, wait, type StubHost } from './helpers/host.ts'

const workerId = (ticketId: string) => `worker-${ticketId}`
const signal = () => new AbortController().signal

async function settle(runtime: Runtime, ms = 80): Promise<void> {
  await runtime.nudge()
  await wait(ms)
  runtime.passes.requestPass()
  await wait(ms)
}

/**
 * One more attempt at every pending row of a kind, now instead of after the real backoff.
 *
 * The keys are read the way the queue reads them — claimed with a `now` far enough ahead to reach a row that is
 * backing off — and `deferEffect` releases the claim it made, so the attempt that follows is the queue's own.
 */
async function retryNow(runtime: Runtime, kind: string): Promise<void> {
  for (const row of runtime.store.claimEffects(kind, 50, Date.now() + 60 * 60_000)) {
    runtime.store.deferEffect(kind, row.key, Date.now() - 1)
  }
  await runtime.effects.runDue()
}

/** Attempts 2 to 5 of one effect: the Runtime's whole budget, minus the attempt the pass above already made. */
async function exhaust(runtime: Runtime, kind: string): Promise<void> {
  for (let attempt = 2; attempt <= 5; attempt++) await retryNow(runtime, kind)
}

/** A fresh process over the same state directory, which is what a restart is. */
async function restart(stateDir: string, host: StubHost = stubHost()): Promise<{ host: StubHost; runtime: Runtime }> {
  const inbox = join(stateDir, 'inbox')
  const runtime = createRuntime(host.ctx, Config({ stateDir, inboxDir: inbox, workRoot: join(stateDir, 'work') }) as never)
  runtime.saveSettings({ acceptMode: 'auto', sources: { inbox: { directory: inbox, pollMs: 1000 } } })
  await runtime.start()
  return { host, runtime }
}

/** One Ticket, accepted, with a worker launched for it. */
async function started(context: Deployment, text = '写一份摘要'): Promise<string> {
  const path = `${context.inbox}/task-${Math.random().toString(36).slice(2, 8)}.md`
  writeFileSync(path, text, 'utf8')
  const at = new Date(Date.now() - 5_000)
  utimesSync(path, at, at)
  await settle(context.runtime)
  return context.runtime.store.tickets.list()[0]!.id
}

const report = (context: Deployment, id: string, args: unknown) =>
  context.host.tool(workerId(id), 'myagent_report')!.definition.execute(args, { signal: signal() })

/** Settings under which a rule's own Trigger passes the gate, so the queue's trigger handler has work it can do. */
const withRules = (context: Deployment): void => {
  context.runtime.saveSettings({
    acceptMode: 'auto', allowedSenders: ['operator', 'digest-done'],
    sources: { inbox: { directory: context.inbox, pollMs: 1000 }, rule: { enabled: true, allowSystemActors: true } },
  })
}

/** A Trigger of exactly the shape the rule Source enqueues (`sources/rule.ts:84-99`). */
const ruleTrigger = (upstream: string): Trigger => ({
  id: key('rule', 'digest-done', upstream, '2026-11-04T00:00:00.000Z'),
  source: 'rule', kind: 'rule', at: new Date().toISOString(),
  actor: { id: 'digest-done', kind: 'system' },
  text: '把摘要发到群里', title: '把摘要发到群里',
  meta: { depth: 1, originTicketId: upstream, rule: 'digest-done' },
})

describe('a notice the front desk never takes', () => {
  it('records notice_lost on the Ticket with the words that were owed, and the event outlives the health line the next pass clears', async () => {
    const context = await deployment('auto', { notify: { fails: Infinity } })
    const { runtime, host } = context
    try {
      await runtime.createMainSession()
      const id = await started(context)
      const owed = '写好了 digest.md'
      await report(context, id, { state: 'ready', summary: owed, files: ['digest.md'] })
      await settle(runtime)
      await exhaust(runtime, 'notify')

      // The fault really fired, and on the front desk rather than on the worker whose launch this Ticket also needed.
      // Without this a knob that matched nothing would leave the test green for a reason of its own invention.
      expect(host.refusals).toEqual([
        { session: 'myagent-main', mode: 'notice' }, { session: 'myagent-main', mode: 'notice' },
        { session: 'myagent-main', mode: 'notice' }, { session: 'myagent-main', mode: 'notice' },
        { session: 'myagent-main', mode: 'notice' },
      ])
      expect(host.agents.get(workerId(id))!.followups).toHaveLength(1)
      // The queue settled the row when it gave up, so no pass will ever look at this notice again.
      expect(runtime.store.effectCounts()).toEqual({})

      // Read from the store, through the Engine, not from whatever the writer returned before its afterCommit ran.
      const lost = runtime.engine.history(id).filter(event => event.type === 'notice_lost')
      expect(lost).toHaveLength(1)
      expect(lost[0]!.by).toEqual({ kind: 'system', id: 'delivery' })
      // The text is the point: a lost message is only actionable if what was going to be said survived with it.
      expect(lost[0]!.detail).toMatchObject({ notice: 'report', state: 'ready', text: owed })
      expect(String(lost[0]!.detail!.error)).toContain('the front desk is not reachable')
      // And the loss is real rather than a duplicate: nothing reached the front desk at all.
      expect(host.agents.get('myagent-main')!.notices).toEqual([])
      // What was lost is the telling, not the record: `RESULT.md` is written before the notice is attempted
      // (delivery.ts:375-379), so the Ticket's own directory still says the work finished while nobody was told.
      const directory = runtime.store.tickets.get(id)!.execution!.directory
      expect(readFileSync(join(directory, 'RESULT.md'), 'utf8')).toContain(owed)

      // THE POINT OF THE TEST. A health line answers "how are things now", so it cannot be the record of a message
      // that was lost — and the clearing below is CAUSED, which is what makes the contrast a fact about the system
      // rather than about the test. This used to call `health.entry('effects').record(…)` by hand, asserting a
      // property the system did not have: nothing ever called `record` on that entry, so the give-up line stayed for
      // the life of the process and `refresh()` reported a problem forever.
      expect(runtime.health.problems().map(problem => problem.detail).join('\n')).toContain('gave up')
      // The pass that gave up complained, which is why the line is still up; this one has nothing to complain about
      // and no row left that an earlier complaint is waiting on, so the queue clears its own entry.
      await runtime.effects.runDue()
      expect(runtime.health.problems()).toEqual([])
      // Cleared by a summary rather than blanked: the line says exactly what one pass is evidence of, and no more.
      // No count of what is still queued, because the port the queue is handed has no counts in it.
      expect(runtime.health.entry('effects').snapshot()).toMatchObject({ ok: true, detail: 'no effect failed in this pass' })
      // And the record is untouched by it — which is the whole reason the line is allowed to be about "now".
      expect(runtime.engine.history(id).filter(event => event.type === 'notice_lost')).toHaveLength(1)
    } finally { await runtime.stop() }
  })

  it('keeps notice_lost across a restart, while the health line is erased by the next quiet pass and by the restart itself', async () => {
    const context = await deployment('auto', { notify: { fails: Infinity } })
    const { runtime } = context
    let id = ''
    try {
      await runtime.createMainSession()
      id = await started(context)
      await report(context, id, { state: 'ready', summary: '写好了 digest.md' })
      await settle(runtime)
      await exhaust(runtime, 'notify')
      expect(runtime.health.problems().map(problem => problem.detail).join('\n')).toContain('gave up')
      // Re-verified rather than trusted: the name this test used to have contrasted the event with a line that only a
      // RESTART could erase. That is no longer the interesting half — the pass after a give-up erases the line inside
      // the same process, because a give-up settles its row and leaves the next pass nothing to wait for — so the
      // contrast is now both, and the restart is not doing all the work.
      await runtime.effects.runDue()
      expect(runtime.health.problems()).toEqual([])
    } finally { await runtime.stop() }

    // A new process: the board is empty because it lives in the process, and the give-up line went with it.
    const second = await restart(context.stateDir)
    try {
      expect(second.runtime.health.problems()).toEqual([])
      // An empty board is not a silent one: the new process's own pass says what it is evidence of. Pinned because
      // "no problems" is also what a queue that never summarizes looks like, and those are different claims — one of
      // them is the fix, the other is the defect this file was written against.
      await second.runtime.effects.runDue()
      expect(second.runtime.health.entry('effects').snapshot())
        .toMatchObject({ ok: true, detail: 'no effect failed in this pass' })
      // The event is in the database, so the fact that the operator was never told is still readable — and so are the
      // words, which is what makes it something a person can act on rather than a symptom to notice.
      const lost = second.runtime.engine.history(id).filter(event => event.type === 'notice_lost')
      expect(lost).toHaveLength(1)
      expect(lost[0]!.detail).toMatchObject({ notice: 'report', state: 'ready', text: '写好了 digest.md' })
    } finally { await second.runtime.stop() }
  })

  it('delivers the notice and records no loss when the front desk comes back after two refusals', async () => {
    const context = await deployment('auto', { notify: { fails: 2 } })
    const { runtime, host } = context
    try {
      await runtime.createMainSession()
      const id = await started(context)
      const owed = '写好了 digest.md'
      await report(context, id, { state: 'ready', summary: owed })
      await settle(runtime)
      await retryNow(runtime, 'notify')
      await retryNow(runtime, 'notify')

      // Exactly the two refusals the knob was armed with, and then a delivery — not a fourth attempt, and not a
      // duplicate of the two that failed: `AgentDelivery` marks a request id seen only once the agent took it.
      expect(host.refusals).toHaveLength(2)
      const main = host.agents.get('myagent-main')!
      expect(main.notices).toHaveLength(1)
      expect(main.notices[0]!.text).toContain(owed)
      expect(runtime.store.effectCounts()).toEqual({})
      // The other half of the debt, and the assertion that keeps the test above honest: a transient failure must not
      // read as a lost message. Without it a system that recorded a loss on every failure would pass both tests.
      expect(runtime.engine.history(id).filter(event => event.type === 'notice_lost')).toEqual([])
      // A full pass and not only the queue, because `refresh()` is what turns the board into the line the operator
      // reads, and "`refresh()` reports 1 problem(s) forever" was the visible half of this defect.
      await settle(runtime)
      // The scenario the fix exists for: two refusals and then a delivery. The line about them used to stay on the
      // board for the life of the process, because nothing ever called `record` on the `effects` entry. The pass that
      // delivered the notice complained about nothing and its row is settled, so it cleared the entry itself — which
      // is why this asserts a CLEAN board and not merely one that does not happen to say "gave up".
      expect(runtime.health.problems()).toEqual([])
      expect(runtime.health.entry('effects').snapshot())
        .toMatchObject({ ok: true, detail: 'no effect failed in this pass' })
      expect(runtime.health.entry('runtime').snapshot().detail).toContain('open Ticket(s)')
    } finally { await runtime.stop() }
  })
})

describe('a request the queue gives up on', () => {
  it('stores the Trigger, its Decision and its Ticket when a queued trigger is receivable', async () => {
    const context = await deployment('auto')
    const { runtime } = context
    try {
      withRules(context)
      const trigger = ruleTrigger('upstream-1')
      runtime.effects.enqueue('trigger', key('trigger', trigger.id), trigger)
      await settle(runtime)
      // The control for the measurement below: the queue's trigger handler really does run `receive`, and a Trigger
      // that goes through it leaves all three rows. Without this, "nothing was stored" would prove nothing.
      expect(runtime.store.effectCounts()).toEqual({})
      const row = runtime.store.triggers.get(trigger.id)!
      expect(row.disposition.state).toBe('accepted')
      const decision = runtime.store.decisions.get(key('decision', trigger.id))!
      expect(decision.outcome).toBe('accept')
      expect(runtime.store.tickets.get(ticketIdOf(row.disposition)!)!.title).toBe('把摘要发到群里')
    } finally { await runtime.stop() }
  })

  it('stores a given-up trigger as a lost row with the error and the effect key, and no Decision, which a restart keeps and the next quiet pass does not touch', async () => {
    // THE HOLE THIS TEST PINNED IS CLOSED, and what closed it is a `lost` disposition on a row in `triggers`: the
    // request's own identity, plus the error and the effect key it was given up on under, written in the give-up pass
    // (§4.42 of `docs/v2/00-audit-and-plan.md`, which §4.35 had already ruled on and §4.40 measured). It used to assert
    // that nothing at all survived — no Trigger, no Decision, no Ticket, one health line that its own next pass erased
    // — and three of those four assertions changed meaning: the Trigger row now exists, the health line is no longer
    // the whole trace, and "no Ticket" now says the record did not start work. The fourth is unchanged and stays as
    // strict as it was: NO DECISION, because a Decision is a gate verdict and the gate never ran to one.
    const context = await deployment('auto')
    const { runtime } = context
    const triggerId = key('rule', 'digest-done', 'upstream-2', '2026-11-04T00:00:00.000Z')
    const effectKey = key('trigger', triggerId)
    try {
      withRules(context)
      // The payload is the only surface that can fail this handler, because `receive` performs no host I/O at all:
      // the gate has no throw in it (`core/policy.ts`), `executor.prepare` and `attachmentsOf` are pure, and its
      // events are published after commit where the Store contains whatever they throw (`store.ts:594-597`). What a
      // row the handler cannot read means in production is a Trigger written by another build surviving an upgrade —
      // the handler casts its payload without checking it (`runtime.ts:389`). This one names its request completely
      // and fails on the field the gate dereferences first, which is the shape §4.42 says the real case has: the
      // identity survives, `receive` throws inside itself. The cause that stays unreachable offline is a Store write
      // failing, and that is a documented boundary rather than something to work around
      // (`docs/v2/17-fault-injection.md` §3.0).
      runtime.effects.enqueue('trigger', effectKey, {
        id: triggerId, source: 'rule', kind: 'rule', at: '2026-11-04T00:00:00.000Z',
        text: '把摘要发到群里', title: '把摘要发到群里',
      })
      await settle(runtime)
      await exhaust(runtime, 'trigger')

      // The row is gone, so nothing will look at this request again: not a pass, not a restart, not an operator.
      expect(runtime.store.pendingEffects('trigger', effectKey)).toBe(false)
      expect(runtime.store.effectCounts()).toEqual({})
      // The board still says the one thing it is evidence of, and it is still only about now.
      const problems = runtime.health.problems().map(problem => [problem.name, problem.detail])
      expect(problems).toHaveLength(1)
      expect(problems[0]).toEqual(['effects', expect.stringContaining(`trigger ${effectKey} gave up:`)])

      // THE RECORD. Read from the store, and as a whole object: pinning the three fields exactly is what pins the
      // absence of a fourth, since a `decisionId` here would point at a verdict that never happened.
      const row = runtime.store.triggers.get(triggerId)!
      expect(row.disposition).toEqual({ state: 'lost', effectKey, error: expect.stringContaining('TypeError') })
      // `record` is the payload as it arrived rather than a Trigger this build assembled — the row promises the four
      // columns beside it and nothing more — and the request text is the part a person can act on.
      expect(row.trigger).toMatchObject({ id: triggerId, source: 'rule', kind: 'rule', text: '把摘要发到群里' })
      expect((row.trigger as { actor?: unknown }).actor).toBeUndefined()

      // No Decision and no Ticket: the row is a fact about a request, not the start of work.
      expect(runtime.store.decisions.get(key('decision', triggerId))).toBeUndefined()
      expect(runtime.store.decisions.list()).toEqual([])
      expect(runtime.store.tickets.list()).toEqual([])
      // And the intake counts put it under the Source that really asked. That is the difference between this row and
      // the one §4.42 refuses to write: `lost` is what became of a rule request, not a Source called "lost".
      expect(runtime.store.triggers.countBySource()).toEqual({ rule: { lost: 1 } })

      // The health line still clears on the next quiet pass — that behaviour just landed (§4.43) and must not regress.
      // What changed is that clearing it no longer clears the fact: a give-up settles its row, so this pass has nothing
      // to complain about and nothing left to wait for, and writes its own summary over the line.
      await runtime.effects.runDue()
      expect(runtime.health.problems()).toEqual([])
      expect(runtime.health.entry('effects').snapshot())
        .toMatchObject({ ok: true, detail: 'no effect failed in this pass' })
      // The record is untouched by it, which is the whole reason the line is allowed to be about "now".
      expect(runtime.store.triggers.get(triggerId)!.disposition.state).toBe('lost')
    } finally { await runtime.stop() }

    const second = await restart(context.stateDir)
    try {
      // A restart finds the record, and still finds no Decision, no Ticket and no effect row to retry. This is the
      // half the health line could never do: it lives in the process, and the board it is on dies with it.
      expect(second.runtime.store.effectCounts()).toEqual({})
      const row = second.runtime.store.triggers.get(triggerId)!
      expect(row.disposition).toEqual({ state: 'lost', effectKey, error: expect.stringContaining('TypeError') })
      expect(row.trigger.text).toBe('把摘要发到群里')
      expect(second.runtime.store.decisions.list()).toEqual([])
      expect(second.runtime.store.tickets.list()).toEqual([])
      expect(second.runtime.health.problems()).toEqual([])
    } finally { await second.runtime.stop() }
  })

  it('keeps a payload it cannot read as bounded text, and puts no invented Source in the triggers table', async () => {
    const context = await deployment('auto')
    const { runtime } = context
    const effectKey = key('trigger', 'unrecognizable')
    try {
      withRules(context)
      // No `id`, so there is no request to name — the degenerate path of §4.42, and the payload the test above used to
      // carry. Every column of `triggers` is NOT NULL and `countBySource` groups by `source`, so storing this would
      // have meant inventing a Source called "lost" on the panel's answer to "where does work come from".
      const payload = { source: 'rule', kind: 'rule', at: '2026-11-04T00:00:00.000Z', text: '把摘要发到群里' }
      runtime.effects.enqueue('trigger', effectKey, payload)
      await settle(runtime)
      await exhaust(runtime, 'trigger')

      expect(runtime.store.effectCounts()).toEqual({})
      // The assertion the whole degenerate path exists to keep true: the table that says where work comes from is
      // untouched, so it has no row and no count for a failure dressed as a Source.
      expect(runtime.store.triggers.list()).toEqual([])
      expect(runtime.store.triggers.countBySource()).toEqual({})
      expect(runtime.store.decisions.list()).toEqual([])

      const kept = runtime.store.lostPayloads()
      expect(kept).toHaveLength(1)
      // The text is the record: what was dropped, why, which queue row it came from, and how long it was — the last so
      // a payload that was cut says it was cut instead of looking complete.
      expect(JSON.parse(kept[0]!.payload)).toEqual(payload)
      expect(kept[0]).toMatchObject({ effectKey, chars: JSON.stringify(payload).length })
      expect(kept[0]!.error).toContain('TypeError')
      // An entry with no instant cannot be ordered, and "keep the most recent N" is an ordering claim.
      expect(kept[0]!.at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/)
    } finally { await runtime.stop() }

    const second = await restart(context.stateDir)
    try {
      // In the database, so a restart keeps it — which the health line does not, and which is the only thing this
      // entry has going for it over the line it replaces.
      expect(second.runtime.store.lostPayloads()).toHaveLength(1)
      expect(second.runtime.store.triggers.list()).toEqual([])
      expect(second.runtime.health.problems()).toEqual([])
    } finally { await second.runtime.stop() }
  })

  it('writes one lost row when the same failing effect is given up on twice', async () => {
    const context = await deployment('auto')
    const { runtime } = context
    const triggerId = key('rule', 'digest-done', 'upstream-3', '2026-11-04T00:00:00.000Z')
    const effectKey = key('trigger', triggerId)
    const at = '2026-11-04T00:00:00.000Z'
    try {
      withRules(context)
      runtime.effects.enqueue('trigger', effectKey, {
        id: triggerId, source: 'rule', kind: 'rule', at, text: '把摘要发到群里', title: '把摘要发到群里',
      })
      await settle(runtime)
      await exhaust(runtime, 'trigger')
      const first = runtime.store.triggers.get(triggerId)!

      // Queued again under the same identity, which is what the rule Source does when it fires again for the same slot
      // (`sources/rule.ts:99` keys the row by the Trigger id), with the text the operator has since edited: same
      // request, so same id, and a payload that differs — the pair that tells a conflict left alone from one rewritten.
      runtime.effects.enqueue('trigger', effectKey, {
        id: triggerId, source: 'rule', kind: 'rule', at, text: '把摘要发到频道里', title: '把摘要发到频道里',
      })
      await settle(runtime)
      await exhaust(runtime, 'trigger')

      // `triggers.id` is the primary key, so the second give-up had nowhere to put a second row — and it must not find
      // another identity to put one under either.
      expect(runtime.store.triggers.list()).toHaveLength(1)
      expect(runtime.store.triggers.countBySource()).toEqual({ rule: { lost: 1 } })
      // The first record stands, payload included: a row already written is a fact already recorded, and the second
      // give-up adds nothing to it. The row that has to be protected by the same rule is a truer one — an `accepted`
      // row with a Ticket behind it, which is what `store.spec.ts` pins at the writer.
      expect(runtime.store.triggers.get(triggerId)).toEqual(first)
      expect(runtime.store.triggers.get(triggerId)!.trigger.text).toBe('把摘要发到群里')
      // One path or the other, never both: the payload named its request, so it did not also land in `kv`.
      expect(runtime.store.lostPayloads()).toEqual([])
      expect(runtime.store.decisions.list()).toEqual([])
    } finally { await runtime.stop() }
  })

  it('receives a lost Trigger again instead of answering that it was already handled', async () => {
    const context = await deployment('auto')
    const { runtime } = context
    const trigger = ruleTrigger('upstream-6')
    const effectKey = key('trigger', trigger.id)
    try {
      withRules(context)
      // The same request without the field the gate dereferences first, given up on: a `lost` row and nothing else.
      runtime.effects.enqueue('trigger', effectKey, {
        id: trigger.id, source: trigger.source, kind: trigger.kind, at: trigger.at,
        text: trigger.text, title: trigger.title,
      })
      await settle(runtime)
      await exhaust(runtime, 'trigger')
      expect(runtime.store.triggers.get(trigger.id)!.disposition.state).toBe('lost')

      // Then the request arrives in a form this build can honour — a rule firing again for the same slot, or a person
      // re-enqueueing the row by hand. It must not be answered as a duplicate: that answer means "already handled",
      // and every Source files a disposition it does not name as exactly that (sources/inbox.ts:239-242 would archive
      // the file under `accepted/` with no Ticket behind it, sources/chat.ts:385-386 the same, sources/cron.ts:194-196
      // would count it a duplicate and advance past the slot). Re-running is safe rather than duplicative because a
      // `lost` row only exists where `receive` threw inside its one transaction: nothing was ever stored.
      runtime.effects.enqueue('trigger', effectKey, trigger)
      await settle(runtime)
      const row = runtime.store.triggers.get(trigger.id)!
      expect(row.disposition.state).toBe('accepted')
      expect(runtime.store.tickets.get(ticketIdOf(row.disposition)!)!.title).toBe('把摘要发到群里')
      // One row, one Ticket, one Decision: the lost record is replaced by the disposition this attempt earned.
      expect(runtime.store.triggers.list()).toHaveLength(1)
      expect(runtime.store.tickets.list()).toHaveLength(1)
      expect(runtime.store.decisions.list()).toHaveLength(1)
      expect(runtime.store.effectCounts()).toEqual({})
    } finally { await runtime.stop() }
  })

  it('keeps the pass when writing the lost record fails, which is what a failing Store does to it', async () => {
    const context = await deployment('auto')
    const { runtime } = context
    const triggerId = key('rule', 'digest-done', 'upstream-4', '2026-11-04T00:00:00.000Z')
    const effectKey = key('trigger', triggerId)
    try {
      withRules(context)
      // The one fault this harness cannot inject through a real surface. Making SQLite fail offline means making the
      // state directory unwritable, which fails `failEffect` and `settleEffect` too, so what would be measured is a
      // dead queue rather than a lost Trigger — `docs/v2/17-fault-injection.md` §3.0 records that as a boundary
      // instead of working around it. So the writer is replaced for the length of this test and put back after: no
      // hook was added to `src/` for it, and the queue's own retries, backoff and give-up run unmodified.
      const triggers: { insertLost?: (lost: LostTrigger) => void } = runtime.store.triggers
      let refusals = 0
      triggers.insertLost = (): void => { refusals++; throw new Error('attempt to write a readonly database') }
      try {
        runtime.effects.enqueue('trigger', effectKey, {
          id: triggerId, source: 'rule', kind: 'rule', at: '2026-11-04T00:00:00.000Z',
          text: '把摘要发到群里', title: '把摘要发到群里',
        })
        await settle(runtime)
        await exhaust(runtime, 'trigger')

        // The fault really fired and the trace really is gone. Without these two, a writer that was never called
        // would satisfy every assertion below in a run where nothing failed — the shape §4.40's M3 caught.
        expect(refusals).toBe(1)
        expect(runtime.store.triggers.get(triggerId)).toBeUndefined()
        // `kv` is in the same file as `triggers`, so a Store that cannot write one cannot write the other and the
        // fallback is not attempted either. What is left to require is that the pass survived, which is the try/catch.
        expect(runtime.store.lostPayloads()).toEqual([])
      } finally { delete triggers.insertLost }

      // The pass was not taken down with it: the row is settled, and the board carries the one line that is true — the
      // give-up, not a report that the permanent-failure hook itself broke, which is what the queue writes when a throw
      // escapes it (`effects.ts:188-189`) and reads like a second defect on top of the first.
      expect(runtime.store.effectCounts()).toEqual({})
      const problems = runtime.health.problems().map(problem => problem.detail)
      expect(problems).toHaveLength(1)
      expect(problems[0]).toContain(`trigger ${effectKey} gave up:`)
      expect(problems[0]).not.toContain('permanent-failure hook')

      // And the system is still usable rather than merely quiet: a receivable Trigger queued afterwards is stored.
      const receivable = ruleTrigger('upstream-5')
      runtime.effects.enqueue('trigger', key('trigger', receivable.id), receivable)
      await settle(runtime)
      expect(runtime.store.triggers.get(receivable.id)!.disposition.state).toBe('accepted')
    } finally { await runtime.stop() }
  })
})

describe('a launch that never starts', () => {
  it('leaves a failed report on the Ticket, and the front desk hears about it', async () => {
    // No injected fault and no new knob: a profile that knows none of the worker tools makes DSH refuse the
    // restriction, and `sessions.ts:375` fails the launch rather than run a worker unrestricted. That is the host
    // refusing, which is the shape a real launch failure has.
    const context = await deployment('auto', { knownTools: [] })
    const { runtime, host } = context
    try {
      await runtime.createMainSession()
      const id = await started(context)
      await settle(runtime)
      await exhaust(runtime, 'launch')

      const ticket = runtime.store.tickets.get(id)!
      // Verified rather than assumed: the give-up lands as a Report on the Assignment, read back from the store.
      const gaveUp = ticket.assignments.at(-1)!.report!
      expect(gaveUp.state).toBe('failed')
      expect(gaveUp.summary).toContain("Starting this Ticket's worker gave up after repeated attempts")
      expect(gaveUp.summary).toContain('DSH accepts no work tool')
      // Waiting for a person rather than ended: the Ticket stays retryable, which is what makes the trace actionable.
      expect(ticket.ended).toBeUndefined()
      expect(ticket.attention?.question).toContain('gave up')
      expect(runtime.store.effectCounts()).toEqual({})

      // A failed Report is one of the states Delivery tells about, so the give-up also reaches the operator through
      // the very notify path this file's first tests break — the trace is not only on the Ticket.
      await settle(runtime)
      expect(host.agents.get('myagent-main')!.notices.at(-1)!.text).toContain('failed')
    } finally { await runtime.stop() }
  })
})

/**
 * The unsmooth run: a worker that fails on an upstream error, and what the system's records say about it afterwards.
 *
 * This is the shape the first production run had and every offline test until now lacked (`19-production-findings.md`
 * F1/F2/F3): a 429 at 06:47:44.097Z reached the health board and a warn log, reached the Ticket not at all, and was
 * still on the board at 15:52 — three hours after that Ticket had ended successfully, because a person had rebuilt the
 * worker by hand. Its closing note is the reason this block exists: the probe requests every earlier acceptance run
 * made all took the smooth path, and all three of these defects only exist on the unsmooth one.
 */
describe('a worker that fails on an upstream error', () => {
  /**
   * One upstream failure, arriving the way DSH delivers it: an `agent/error` for the Session, then that turn ending
   * with the reason DSH wrote into the Session's own log (`agent.ts` sets `turnEnds = {kind:'error', error}` before it
   * appends `turn/end`, and `throwError` emits `agent/error` first). Injected through the host's event surface and
   * never through a hook in `src/`, so the listeners under test are the ones that ship.
   */
  function failUpstream(host: StubHost, sessionId: string, message: string): void {
    const agent = host.agents.get(sessionId)!
    const error = new Error(message)
    error.name = 'LlmError'
    host.emit('agent/error', { agent, error })
    agent.session.events.push({
      seq: agent.session.events.length + 1, type: 'turn/end',
      data: { turn: 1, reason: { kind: 'error', error: { message, code: 'RATE_LIMIT', status: 429 } } },
    })
    agent.status = 'idle'
    host.emit('agent/status', { agent, status: 'idle' })
  }

  /** One more Ticket of its own in a deployment that may already have others, accepted and with its worker running. */
  async function startAnother(context: Deployment, text: string): Promise<string> {
    const known = new Set(context.runtime.store.tickets.list().map(ticket => ticket.id))
    const path = `${context.inbox}/task-${Math.random().toString(36).slice(2, 8)}.md`
    writeFileSync(path, text, 'utf8')
    const at = new Date(Date.now() - 5_000)
    utimesSync(path, at, at)
    await settle(context.runtime)
    const fresh = context.runtime.store.tickets.list().filter(ticket => !known.has(ticket.id))
    // The premise of everything below, asserted rather than assumed: a failure is only recorded for an attempt that is
    // running, so a Ticket that never launched would leave the rest of the test asserting on nothing at all.
    expect(fresh).toHaveLength(1)
    expect(fresh[0]!.assignments.at(-1)!.state).toBe('running')
    return fresh[0]!.id
  }

  /** The health line the panel's header and its health table both read. */
  const board = (runtime: Runtime) => runtime.health.entry('sessions').snapshot()
  /** Whether the operator's board shows a Sessions problem at all, which is the claim the page makes. */
  const onBoard = (runtime: Runtime) => runtime.health.problems().some(problem => problem.name === 'sessions')

  it('puts the cause on the Ticket, which is what a health line answering "now" cannot be', async () => {
    const context = await deployment()
    const { runtime, host } = context
    try {
      const id = await startAnother(context, '信息比对')
      failUpstream(host, workerId(id), '429: Rate limit: 60 requests per minute per account. Retry after 28 seconds.')
      await settle(runtime)

      // The record, read back from the log rather than from what the call returned: this is the half that survives the
      // board being cleared, the process ending, and three months of not looking.
      const ended = runtime.engine.history(id).find(event => event.type === 'turn_ended')
      expect(ended?.detail).toMatchObject({ reason: 'error' })
      // The upstream error's own text, and the same sentence the board shows — one fact, two places, no drift.
      expect(ended!.detail!.error).toContain('LlmError: 429: Rate limit')
      // The signal stays as well: the board and the log are a division of labour, not a choice between the two.
      expect(board(runtime)).toMatchObject({ ok: false })
      expect(board(runtime).detail).toContain('429')
      // Unchanged behaviour, asserted so the cause cannot have been bought with it: the turn that ended without a
      // report still leaves a `waiting` report on the attempt, which is what makes the Ticket visible as stalled.
      expect(runtime.store.tickets.get(id)!.assignments.at(-1)!.report).toMatchObject({ state: 'waiting' })
    } finally { await runtime.stop() }
  })

  it('takes a problem off the board when its Ticket ends, and leaves an unrelated Ticket’s problem on it', async () => {
    const context = await deployment()
    const { runtime, host } = context
    try {
      const first = await startAnother(context, '搜集信息')
      const second = await startAnother(context, '信息比对')
      failUpstream(host, workerId(first), '429: Rate limit: 60 requests per minute per account.')
      failUpstream(host, workerId(second), 'ECONNREFUSED: the provider closed the connection')
      await settle(runtime)

      // Both live at once, and both named: one slot shared by every Ticket is what let an unrelated observation
      // overwrite the one a person was reading (N9), so the detail is composed from the account.
      expect(board(runtime)).toMatchObject({ ok: false })
      expect(board(runtime).detail).toContain(first)
      expect(board(runtime).detail).toContain(second)

      await report(context, first, { state: 'ready', summary: '搜集完了。' })
      await settle(runtime)
      // Read the store: the ending is what retires the problem, so the ending has to be a stored fact first.
      expect(runtime.store.tickets.get(first)!.ended?.outcome).toBe('done')
      expect(board(runtime)).toMatchObject({ ok: false })
      expect(board(runtime).detail).toContain(second)
      expect(board(runtime).detail!).not.toContain(first)

      await report(context, second, { state: 'ready', summary: '比对完了。' })
      await settle(runtime)
      expect(runtime.store.tickets.get(second)!.ended?.outcome).toBe('done')
      // Nothing is live, and the board says so in the present tense instead of going silent or staying red for hours.
      expect(onBoard(runtime)).toBe(false)
      expect(board(runtime).detail).toContain('no Session problem is live')
    } finally { await runtime.stop() }
  })

  it('retires the problem when that Session completes a turn, and not when the turn that failed ends', async () => {
    const context = await deployment()
    const { runtime, host } = context
    try {
      const id = await startAnother(context, '写一份摘要')
      failUpstream(host, workerId(id), '429: Rate limit: 60 requests per minute per account.')
      await settle(runtime)
      // The failing turn ends too — nine milliseconds after the error, in the production run — and that ending is not
      // recovery: clearing on it would erase the line in the same instant it was written. Asserted twice, on the entry
      // and on the list the panel's header counts, because a mutation check measured that the first of the two was this
      // test's only guard against exactly that over-clearing (discipline 0.8's strong form).
      expect(board(runtime)).toMatchObject({ ok: false })
      expect(onBoard(runtime)).toBe(true)
      expect(runtime.store.tickets.get(id)!.ended).toBeUndefined()

      // The Session running a turn to a real ending is its own evidence that it works again.
      const agent = host.agents.get(workerId(id))!
      agent.session.events.push({
        seq: agent.session.events.length + 1, type: 'turn/end', data: { turn: 2, reason: { kind: 'completed' } },
      })
      agent.status = 'idle'
      host.emit('agent/status', { agent, status: 'idle' })
      await settle(runtime)

      expect(onBoard(runtime)).toBe(false)
      expect(board(runtime).detail).toContain('no Session problem is live')
      // Every turn end carries its reason, not only the failing one: the production log had a reason available for the
      // turn that ended with something to say and none for the turn that ended because of a 429, and taking it
      // inconsistently is what left the one that mattered without a cause.
      expect(runtime.engine.history(id).filter(event => event.type === 'turn_ended').map(event => event.detail?.reason))
        .toEqual(['error', 'completed'])
    } finally { await runtime.stop() }
  })

  it('keeps saying what is wrong through every pass that follows, because a quiet pass is not evidence', async () => {
    const context = await deployment()
    const { runtime, host } = context
    try {
      const id = await startAnother(context, '写一份摘要')
      failUpstream(host, workerId(id), '429: Rate limit: 60 requests per minute per account.')
      // Passes keep running while this Ticket stays open and its Session stays unproven. The summary a pass writes is
      // guarded on the account being empty for exactly this reason: "nothing complained in this pass" and "nothing is
      // wrong" are different claims, and the second one here would be false (§4.43's own hole, one layer over).
      await settle(runtime)
      await settle(runtime)
      runtime.passes.requestPass()
      await wait(80)

      expect(runtime.store.tickets.get(id)!.ended).toBeUndefined()
      expect(board(runtime)).toMatchObject({ ok: false })
      expect(board(runtime).detail).toContain('429')
      // And the header the operator reads first still counts it, rather than reporting a system that is fine.
      expect(runtime.health.entry('runtime').snapshot().detail).toContain('problem(s)')
      expect(onBoard(runtime)).toBe(true)
    } finally { await runtime.stop() }
  })

  it('records that work resumed after an interruption, so a rescued run cannot be read as a smooth one', async () => {
    const context = await deployment()
    const { runtime, host } = context
    try {
      const id = await startAnother(context, '信息比对')
      failUpstream(host, workerId(id), '429: Rate limit: 60 requests per minute per account.')
      await settle(runtime)
      const interrupted = runtime.engine.history(id).filter(event => event.type === 'turn_ended')
      expect(interrupted).toHaveLength(1)

      // In production a person woke this Session by hand, and nothing myagent can see did it. What it can see is that
      // a report arrived after the turn had ended — and a report can only be produced inside a turn, so the sequence
      // is a fact about this attempt rather than a guess about who helped.
      await report(context, id, { state: 'progress', summary: '继续比对。' })
      await settle(runtime)

      const history = runtime.engine.history(id)
      expect(history.map(event => event.type).slice(-3)).toEqual(['turn_ended', 'resumed', 'report'])
      const resumed = history.find(event => event.type === 'resumed')!
      // Who woke it is the one thing this event cannot know, so it claims no cause: `by` absent is the model's own way
      // of saying nobody caused a fact (`model.ts`), and naming the person is the deferred other half of F1.
      expect(resumed.by).toBeUndefined()
      expect(resumed.detail).toMatchObject({
        assignmentId: interrupted[0]!.detail!.assignmentId, turnEndedAt: interrupted[0]!.at,
      })
    } finally { await runtime.stop() }
  })

  it('calls neither an ordinary report nor a retry a resumption, so the event stays worth reading', async () => {
    const context = await deployment()
    const { runtime, host } = context
    try {
      const ordinary = await startAnother(context, '写一份摘要')
      // A worker reporting inside the turn it was launched in has not resumed anything: nothing interrupted it.
      await report(context, ordinary, { state: 'progress', summary: '还在做。' })
      await settle(runtime)
      expect(runtime.engine.history(ordinary).map(event => event.type)).not.toContain('resumed')

      const pushed = await startAnother(context, '整理竞品动态')
      failUpstream(host, workerId(pushed), '429: Rate limit: 60 requests per minute per account.')
      await settle(runtime)
      // The turn that ended without a report leaves a `waiting` report, which is what makes this Ticket one a person
      // may push again — and pushing it is the other way work continues after an interruption.
      expect(runtime.store.tickets.get(pushed)!.assignments.at(-1)!.report).toMatchObject({ state: 'waiting' })

      // A retry ends the stalled attempt and opens another, and `retried` plus the second `launched` already tell that
      // story: the new attempt's first report is not a resumption of the attempt whose turn ended, which is why the
      // search matches the attempt and not merely the Ticket.
      runtime.engine.retryTicket(pushed)
      await settle(runtime)
      await report(context, pushed, { state: 'progress', summary: '重试之后继续。' })
      await settle(runtime)

      const types = runtime.engine.history(pushed).map(event => event.type)
      expect(types).not.toContain('resumed')
      expect(types.slice(-3)).toEqual(['retried', 'launched', 'report'])
    } finally { await runtime.stop() }
  })
})

// A test for the policy-notice case was attempted and removed rather than left red or faked: the precedence fix in
// `runtime.ts` is verified for report notices by the mutation check above (M2, the `text:` spread is load-bearing), but
// reproducing a LOST POLICY notice in a deployment test needs one more fact I did not establish — how `saveSettings`'
// policy effects reach `delivery.policyChanged` under the stub, since `exhaust(runtime, 'notify')` after a
// `allowedSenders` change produced no `notice_lost` event at all. Recorded as debt in docs/v2/00-audit-and-plan.md
// §4.40 rather than papered over with an assertion about the report case only.
