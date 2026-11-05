/** The two Sources that produce Triggers on this machine: a directory of request files, and the operator's schedules. */
import { chmodSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { HealthBoard } from '../src/app/health.ts'
import type { Effects } from '../src/app/effects.ts'
import {
  Engine, Memory, parseSettings, settingsPolicy,
  type Assignment, type Delivery, type Executor, type Mandate, type Report, type Settings, type Ticket,
} from '../src/core/index.ts'
import type { DomainEvent } from '../src/core/engine.ts'
import type { Trigger } from '../src/core/model.ts'
import { CronSource } from '../src/sources/cron.ts'
import { SourceRegistry } from '../src/sources/registry.ts'
import type { Source, SourceStatus } from '../src/sources/kind.ts'
import { RuleSource } from '../src/sources/rule.ts'
import { InboxSource, frontMatter } from '../src/sources/inbox.ts'
import type { Cursor, SourceHost } from '../src/sources/kind.ts'
import { tempDir } from './helpers/temp.ts'

class RecordingExecutor implements Executor {
  /** Bound after construction, because the Engine is built with this Executor in its options. */
  engine?: Engine
  readonly started: string[] = []
  prepare(ticket: Ticket, _mandate: Mandate): Ticket {
    return { ...ticket, execution: { name: ticket.id, directory: `/tmp/work/${ticket.id}` } }
  }
  start(ticket: Ticket, assignment: Assignment): void { this.started.push(ticket.id); this.engine?.assignmentStarted(ticket.id, assignment.id) }
  deliver(): void { /* nothing runs here */ }
  stop(): void { /* nothing runs here */ }
}

class RecordingDelivery implements Delivery {
  readonly reports: Report[] = []
  report(_ticket: Ticket, report: Report): void { this.reports.push(report) }
}

/** A stand-in for the effect queue: a Source only asks it to remember work, and never waits on it here. */
/** Enqueued effects, recorded rather than run: what a Source asked for is the fact worth asserting. */
const enqueued: { kind: string; key: string; payload: unknown }[] = []
const effects = {
  enqueue: (kind: string, key: string, payload: unknown) => { enqueued.push({ kind, key, payload }) },
  handle() {}, pending: () => false, runDue: async () => {}, idle: async () => true, dispose() {},
} as unknown as Effects

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

function harness(value: unknown = {}) {
  const memory = new Memory()
  const executor = new RecordingExecutor()
  const delivery = new RecordingDelivery()
  const health = new HealthBoard()
  const cursors = new Map<string, unknown>()
  let current: Settings = parseSettings({ acceptMode: 'auto', allowedSenders: ['operator'], ...value as object })
  const engine = new Engine({
    repos: memory, tx: memory, policy: () => settingsPolicy(current), executor, delivery,
    now: () => new Date().toISOString(),
  })
  // The real Executor marks the Assignment running when a launch succeeds (executor.ts:156); a fake
  // that does not leaves every test reporting into a state production never reports from.
  executor.engine = engine
  const passes: number[] = []
  /** Listeners a Source registered through the host, so a test can deliver an event the way the Runtime would. */
  const listeners: ((event: DomainEvent) => void)[] = []
  const host: SourceHost = {
    engine, effects, health, lifetime: new AbortController().signal,
    settings: () => current,
    requestPass: () => { passes.push(Date.now()) },
    subscribe: (listener): (() => void) => {
      listeners.push(listener)
      return () => { const at = listeners.indexOf(listener); if (at >= 0) listeners.splice(at, 1) }
    },
    cursor: (id: string): Cursor => ({
      get: <T>(): T | undefined => cursors.get(id) as T | undefined,
      set: <T>(value: T): void => { cursors.set(id, value) },
    }),
  }
  return {
    memory, engine, executor, delivery, health, host, cursors, passes, listeners,
    settings: () => current,
    save: (next: unknown) => { current = parseSettings(next) },
    tickets: () => memory.tickets.list(),
    triggers: () => memory.triggers.list(),
    decisions: () => memory.decisions.list(50),
  }
}

/** Write a request file whose mtime is `ageMs` in the past, so the Source sees it as settled. */
function drop(directory: string, name: string, text: string, ageMs = 5_000): string {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, name)
  writeFileSync(path, text, 'utf8')
  const at = new Date(Date.now() - ageMs)
  utimesSync(path, at, at)
  return path
}

const taken = (directory: string, folder: string): string[] =>
  readdirSync(join(directory, folder)).sort()

describe('inbox front matter', () => {
  it('reads a title and a scope, and leaves the rest as the request', () => {
    const parsed = frontMatter('---\ntitle: Weekly digest\nscope: read the notes directory only\n---\nSummarize the week.\n', 'fallback')
    expect(parsed).toEqual({ title: 'Weekly digest', scope: 'read the notes directory only', body: 'Summarize the week.' })
  })

  it('takes a file with no front matter as it is, titled by its name', () => {
    expect(frontMatter('Just do the thing.\n', 'request')).toEqual({ title: 'request', body: 'Just do the thing.' })
  })

  it('quotes and case in the keys do not matter', () => {
    const parsed = frontMatter('---\nTitle: "Quoted"\nSCOPE: \'narrow\'\nunknown: kept out\n---\nBody\n', 'fallback')
    expect(parsed.title).toBe('Quoted')
    expect(parsed.scope).toBe('narrow')
    expect(parsed.body).toBe('Body')
  })

  it('treats a file whose front matter never closes as one request, rather than refusing it', () => {
    const parsed = frontMatter('---\ntitle: Broken\nSummarize this.\n', 'fallback')
    expect(parsed.title).toBe('fallback')
    expect(parsed.body).toContain('title: Broken')
  })

  it('falls back to the whole text when the front matter leaves no body', () => {
    expect(frontMatter('---\ntitle: Only a title\n---\n', 'fallback').body).toContain('Only a title')
  })
})

describe('inbox source', () => {
  const directory = () => tempDir('myagent-inbox-')

  it('takes a settled request file into one Ticket and moves it out of the inbox', async () => {
    const inbox = directory()
    const { host, tickets, triggers, passes } = harness()
    drop(inbox, 'digest.md', '---\ntitle: Weekly digest\n---\nSummarize the week.')
    // The directory the deployment configured is the default the Source watches when the settings name none.
    const source = new InboxSource(host, inbox)
    source.start()
    await wait(40)
    source.stop()
    expect(readdirSync(inbox).filter(name => name.endsWith('.md'))).toEqual([])
    expect(taken(inbox, 'accepted')).toHaveLength(1)
    expect(readFileSync(join(inbox, 'accepted', taken(inbox, 'accepted')[0]!), 'utf8')).toContain('<!-- myagent: Ticket')
    expect(tickets()).toHaveLength(1)
    expect(tickets()[0]!.title).toBe('Weekly digest')
    expect(triggers()[0]!.trigger.source).toBe('inbox')
    expect(triggers()[0]!.trigger.meta?.file).toBe('digest.md')
    expect(passes.length).toBe(1)
    expect(source.status().counts).toMatchObject({ accepted: 1 })
  })

  it('takes one request once, however many polls ask for it at the same time', async () => {
    const inbox = directory()
    const { host, tickets } = harness()
    drop(inbox, 'race.md', 'Summarize the week.')
    const source = new InboxSource(host, inbox)
    source.start()
    // A request to look now can land while the timer-driven scan is still reading the directory. Two scans would both
    // take the same file: one Ticket comes out either way, but the request is annotated and moved twice, and the
    // counts say two things were accepted when one was.
    await Promise.all([source.poll(), source.poll(), source.poll()])
    source.stop()
    expect(taken(inbox, 'accepted')).toHaveLength(1)
    expect(tickets()).toHaveLength(1)
    expect(source.status().counts).toMatchObject({ accepted: 1, duplicate: 0 })
    expect(readdirSync(inbox).filter(name => name.endsWith('.md'))).toEqual([])
  })

  it('hands a scope from the front matter to the Mandate', async () => {
    const inbox = directory()
    const { host, tickets } = harness()
    drop(inbox, 'narrow.md', '---\nscope: read ~/notes and write nothing outside this directory\n---\nSummarize my notes.')
    const source = new InboxSource(host, inbox)
    source.start(); await wait(40); source.stop()
    expect(tickets()[0]!.mandate.scope).toBe('read ~/notes and write nothing outside this directory')
  })

  it('leaves a file that is still being written for a later poll', async () => {
    const inbox = directory()
    const { host, tickets } = harness()
    drop(inbox, 'fresh.md', 'Still landing.', 0)
    const source = new InboxSource(host, inbox)
    source.start(); await wait(40); source.stop()
    expect(readdirSync(inbox)).toContain('fresh.md')
    expect(tickets()).toHaveLength(0)
    expect(source.status().detail).toContain('settling')
  })

  it('reads only Markdown files, and no hidden ones', async () => {
    const inbox = directory()
    const { host, tickets } = harness()
    drop(inbox, 'notes.txt', 'Not a request.')
    drop(inbox, '.hidden.md', 'Not a request either.')
    mkdirSync(join(inbox, 'subdir.md'), { recursive: true })
    const source = new InboxSource(host, inbox)
    source.start(); await wait(40); source.stop()
    expect(tickets()).toHaveLength(0)
    expect(readdirSync(inbox).sort()).toEqual(['.hidden.md', 'notes.txt', 'subdir.md'])
  })

  it('records a request in observe mode and executes nothing', async () => {
    const inbox = directory()
    const { host, tickets, decisions } = harness({ acceptMode: 'observe' })
    drop(inbox, 'observed.md', 'Do the thing.')
    const source = new InboxSource(host, inbox)
    source.start(); await wait(40); source.stop()
    expect(tickets()).toHaveLength(0)
    expect(taken(inbox, 'observed')).toHaveLength(1)
    expect(decisions()[0]!.outcome).toBe('observe')
    expect(source.status().counts).toMatchObject({ observed: 1 })
  })

  it('moves a refused request aside with the reason it was refused', async () => {
    const inbox = directory()
    const { host, tickets, decisions } = harness({ allowedSenders: ['somebody-else'] })
    drop(inbox, 'refused.md', 'Do the thing.')
    const source = new InboxSource(host, inbox)
    source.start(); await wait(40); source.stop()
    expect(tickets()).toHaveLength(0)
    expect(taken(inbox, 'rejected')).toHaveLength(1)
    expect(readFileSync(join(inbox, 'rejected', taken(inbox, 'rejected')[0]!), 'utf8')).toContain('sender_not_allowed')
    expect(decisions()[0]!.outcome).toBe('ignore')
    expect(source.status().counts).toMatchObject({ ignored: 1 })
  })

  it('refuses a request larger than it reads, instead of loading it', async () => {
    const inbox = directory()
    const { host, tickets } = harness()
    drop(inbox, 'huge.md', `${'x'.repeat(513 * 1024)}`)
    const source = new InboxSource(host, inbox)
    source.start(); await wait(60); source.stop()
    expect(tickets()).toHaveLength(0)
    expect(taken(inbox, 'rejected')).toHaveLength(1)
    expect(readFileSync(join(inbox, 'rejected', taken(inbox, 'rejected')[0]!), 'utf8')).toContain('larger than')
  })

  it('takes a second file of the same name as a second request', async () => {
    const inbox = directory()
    const { host, tickets } = harness()
    drop(inbox, 'digest.md', 'The first one.', 9_000)
    const source = new InboxSource(host, inbox)
    source.start(); await wait(40)
    // A poll runs at once on start, and then every pollMs; starting again is how a test asks for the next one.
    drop(inbox, 'digest.md', 'The second one.', 9_000)
    source.start(); await wait(40)
    source.stop()
    expect(tickets()).toHaveLength(2)
    expect(taken(inbox, 'accepted')).toHaveLength(2)
  })

  it('does nothing while it is switched off', async () => {
    const inbox = directory()
    const { host, tickets } = harness({ sources: { inbox: { enabled: false, directory: inbox } } })
    drop(inbox, 'ignored.md', 'Do the thing.')
    const source = new InboxSource(host, inbox)
    source.start(); await wait(40); source.stop()
    expect(tickets()).toHaveLength(0)
    expect(readdirSync(inbox)).toContain('ignored.md')
    expect(source.status().detail).toBe('disabled')
  })
})

describe('cron source', () => {
  const everyMinute = {
    sources: { cron: { enabled: true, schedules: [{ id: 'digest', name: 'Daily digest', prompt: 'Write today\'s digest.', timing: { kind: 'cron', expression: '* * * * *' } }] } },
  }

  /**
   * One instant for the whole block, and the reason these cases use a fake clock at all.
   *
   * "How many slots passed during a downtime" is arithmetic on the wall clock, so a case that seeds its read position
   * from `Date.now()` has an expectation that changes with the minute the suite happens to run in. 30 s past the
   * minute puts one boundary 30 s behind and the next one 30 s ahead, which is the shape every case here needs. The
   * schedule carries no zone, so `nextRun` uses the machine's, and an every-minute rule lands on whole minutes in any
   * zone whose offset is a whole number of minutes.
   */
  const NOW = '2026-11-03T10:00:30Z'

  it('computes the next slot of a fresh schedule and fires nothing', () => {
    // The clock is set rather than read. Against the real one the strongest honest assertion was "greater than a
    // `Date.now()` taken before the pass" — the shape §4.53 records as round 44's fix, made after the suite went red
    // on `expected 1793806560000 to be greater than 1793806560207`, 207ms apart on one boundary. Naming the slot says
    // what that form could not, and the relational half is kept because "the cursor is in the future" is what makes
    // `arm` sleep instead of spin.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    const { host, triggers, cursors } = harness(everyMinute)
    const source = new CronSource(host)
    try {
      source.start()
      const state = cursors.get('cron') as Record<string, { next: number }>
      expect(state.digest!.next).toBe(Date.parse('2026-11-03T10:01:00Z'))
      expect(state.digest!.next).toBeGreaterThan(Date.now())
      expect(source.status().next).toBe(state.digest!.next)
      expect(triggers()).toHaveLength(0)
    } finally { source.stop(); vi.useRealTimers() }
  })

  it('fires one Trigger for a slot that passed while the host was down, folding the ones behind it', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    const { host, triggers, tickets, cursors } = harness(everyMinute)
    // Ten slots ago: the host was down, and one Ticket is what the operator wants, not ten.
    cursors.set('cron', { digest: { next: Date.parse('2026-11-03T09:50:00Z'), missed: 0 } })
    const source = new CronSource(host)
    try {
      source.start()
      // The fake-clock form of the real 60 ms this case used to wait: enough to drain the Source's own chain of
      // zero-delay re-arms, and nowhere near the 30 s to the next slot, so nothing but the downtime fires.
      await vi.advanceTimersByTimeAsync(60)
      expect(triggers()).toHaveLength(1)
      const trigger = triggers()[0]!.trigger
      expect(trigger.text).toBe('Write today\'s digest.')
      expect(trigger.title).toBe('Daily digest')
      expect(trigger.actor).toEqual({ id: 'operator', kind: 'person' })
      // Counted, not bounded: every whole-minute slot from 09:51 to 10:00 passed while the host was down, so ten of
      // them are folded into this one Trigger. `toBeGreaterThan(1)` was the loosest form an unaligned "ten minutes
      // ago" allowed, and the count is what the panel shows an operator, so it is worth pinning.
      expect(Number(trigger.meta?.missed)).toBe(10)
      expect(tickets()).toHaveLength(1)
      // The next slot moved into the future, so the same downtime is not replayed.
      const next = (cursors.get('cron') as Record<string, { next: number }>).digest!.next
      expect(next).toBe(Date.parse('2026-11-03T10:01:00Z'))
      expect(next).toBeGreaterThan(Date.now())
      expect(source.status().counts).toMatchObject({ accepted: 1 })
    } finally { source.stop(); vi.useRealTimers() }
  })

  it('catches up the slots a short downtime skipped, and a restart repeats none of them', async () => {
    // This is the case §4.53 names, and the fake clock is the fix rather than a convenience. Seeded 90 s behind, the
    // slots it owes are however many minute boundaries the real run happened to straddle — two or three — and the
    // second Source then arms a timer for the *next* boundary, which can be milliseconds away, so a real 60 ms wait
    // crossed it and the restart half failed with `expected [...] to have a length of 2 but got 3`.
    //
    // A tolerance range was sitting on the first half of that (`toBeGreaterThanOrEqual(1)` / `toBeLessThanOrEqual(3)`);
    // its author is not recoverable from this tree, and it is the fix §4.53 forbids, because "a restart repeats none of
    // them" is a precise property. It also did not work: the range bounded the catch-up count and left the restart
    // assertion comparing against it, so the case stayed flaky behind a green gate. Both halves are exact now.
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    try {
      const { host, triggers, cursors } = harness(everyMinute)
      // 90 s behind is under the fold-into-one threshold, so each slot that passed gets its own Trigger: 09:59 and
      // 10:00, and not 10:01, which has not come yet.
      cursorsSeed(host, 'digest', Date.parse('2026-11-03T09:59:00Z'))
      const first = new CronSource(host)
      try { first.start(); await vi.advanceTimersByTimeAsync(60) } finally { first.stop() }
      // Naming both slots is the whole property: it says which slots were owed, that neither was fired twice, and —
      // through the instants themselves — that no slot outside the downtime was invented.
      expect(triggers().map(record => record.trigger.at)).toEqual(['2026-11-03T09:59:00.000Z', '2026-11-03T10:00:00.000Z'])
      expect(triggers().map(record => record.trigger.id)).toEqual([...new Set(triggers().map(record => record.trigger.id))])
      const next = (cursors.get('cron') as Record<string, { next: number }>).digest!.next
      expect(next).toBe(Date.parse('2026-11-03T10:01:00Z'))
      expect(next).toBeGreaterThan(Date.now())
      // A restart reads the same position and finds nothing due, so no slot is fired twice. This is the half that was
      // flaky: it arms a timer for `next`, and against the real clock `next` could be milliseconds away, so the same
      // 60 ms that drained the catch-up also crossed the boundary. Against the fixed one it is 29.94 s away, and the
      // only thing this advance can run is the catch-up's own re-arms.
      const second = new CronSource(host)
      try { second.start(); await vi.advanceTimersByTimeAsync(60) } finally { second.stop() }
      expect(triggers()).toHaveLength(2)
      expect(second.status().counts ?? {}).toMatchObject({ accepted: 0 })
    } finally { vi.useRealTimers() }
  })

  it('honours the scope a schedule carries', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    const { host, tickets } = harness({
      sources: { cron: { enabled: true, schedules: [{ id: 'narrow', name: 'Narrow', prompt: 'Do it.', scope: 'Read only, write nothing.', timing: { kind: 'cron', expression: '* * * * *' } }] } },
    })
    cursorsSeed(host, 'narrow', Date.parse('2026-11-03T09:59:00Z'))
    const source = new CronSource(host)
    try {
      source.start(); await vi.advanceTimersByTimeAsync(60)
      expect(tickets()[0]!.mandate.scope).toBe('Read only, write nothing.')
    } finally { source.stop(); vi.useRealTimers() }
  })

  it('does nothing while the source is switched off', () => {
    const { host, triggers } = harness({ ...everyMinute, sources: { cron: { enabled: false, schedules: [] } } })
    const source = new CronSource(host)
    source.start()
    expect(source.status().detail).toBe('disabled')
    expect(triggers()).toHaveLength(0)
    source.stop()
  })

  it('forgets a schedule the operator removed', () => {
    const { host, cursors, save } = harness(everyMinute)
    const source = new CronSource(host)
    source.start()
    expect(Object.keys(cursors.get('cron') as object)).toEqual(['digest'])
    save({ acceptMode: 'auto', allowedSenders: ['operator'], sources: { cron: { enabled: true, schedules: [] } } })
    source.start()
    expect(cursors.get('cron')).toEqual({})
    source.stop()
  })
})

/** Seed a schedule's read position, as a restart after downtime leaves it. */
function cursorsSeed(host: SourceHost, scheduleId: string, next: number): void {
  host.cursor('cron').set({ [scheduleId]: { next, missed: 0 } })
}

describe('an edited schedule', () => {
  const schedule = (timing: unknown) => ({ id: 'digest', name: '摘要', prompt: '写摘要', timing })

  it('fires by the new timing, not by the run it remembered for the old one', async () => {
    const { host, save, triggers, cursors } = harness({
      sources: { cron: { enabled: true, schedules: [schedule({ kind: 'daily', time: '09:00', timeZone: 'UTC' })] } },
    })
    const source = new CronSource(host)
    source.start()
    const before = (cursors.get('cron') as Record<string, { next: number }>)['digest']!.next
    expect(before).toBe(Date.parse(new Date(before).toISOString()))

    // The operator edits the time. The remembered run was computed from a rule that no longer exists, so waiting for
    // it would fire at a time nobody asked for — and the panel's preview, which computes fresh, would disagree.
    save({
      acceptMode: 'auto', allowedSenders: ['operator'],
      sources: { cron: { enabled: true, schedules: [schedule({ kind: 'daily', time: '23:30', timeZone: 'UTC' })] } },
    })
    source.poll()
    source.stop()
    const after = (cursors.get('cron') as Record<string, { next: number; spec: string }>)['digest']!
    expect(after.next).not.toBe(before)
    expect(new Date(after.next).getUTCHours()).toBe(23)
    expect(new Date(after.next).getUTCMinutes()).toBe(30)
    // The rule the run was computed from is remembered with it.
    expect(after.spec).toContain('23:30')
    expect(triggers()).toEqual([])
  })

  it('leaves a remembered run alone while the rule is unchanged', async () => {
    const { host, save, cursors } = harness({
      sources: { cron: { enabled: true, schedules: [schedule({ kind: 'daily', time: '09:00', timeZone: 'UTC' })] } },
    })
    const source = new CronSource(host)
    source.start()
    const before = (cursors.get('cron') as Record<string, { next: number }>)['digest']!.next
    // A cosmetic edit — the name is not part of the rule — must not move when the schedule fires.
    save({
      acceptMode: 'auto', allowedSenders: ['operator'],
      sources: { cron: { enabled: true, schedules: [{ ...schedule({ kind: 'daily', time: '09:00', timeZone: 'UTC' }), name: '换了个名字' }] } },
    })
    source.poll()
    source.stop()
    expect((cursors.get('cron') as Record<string, { next: number }>)['digest']!.next).toBe(before)
  })
})

describe('a schedule whose next run is beyond the horizon', () => {
  // `nextRun` searches 400 days ahead. A Feb-29 rule gaps 1461 days, so once its slot has fired there is no next slot
  // to compute. Inventing one a minute out gave it a fresh `at`, hence a fresh Trigger id, hence a new accepted Ticket
  // every minute forever — with a clean health board, because the cursor entry still looked finite.
  const leap = {
    id: 'leap', name: '闰日', enabled: true, prompt: '四年做一次',
    timing: { kind: 'cron' as const, expression: '0 0 29 2 *', timeZone: 'UTC' },
  }

  it('fires the real slot once and then stops, instead of minting a Ticket a minute', async () => {
    vi.useFakeTimers()
    // 2028-02-29 is 81 days out from here: inside the horizon, so the first slot is genuine.
    vi.setSystemTime(new Date('2027-12-10T00:00:00Z'))
    const context = harness({ sources: { cron: { enabled: true, schedules: [leap] } } })
    const source = new CronSource(context.host)
    await source.start()
    try {
      vi.setSystemTime(new Date('2028-02-29T00:00:00Z'))
      await source.poll?.()
      expect(context.tickets().length).toBe(1)
      // The next Feb 29 is in 2032. Two more minutes must not produce two more Tickets.
      vi.setSystemTime(new Date('2028-02-29T00:01:01Z'))
      await source.poll?.()
      vi.setSystemTime(new Date('2028-02-29T00:02:02Z'))
      await source.poll?.()
      expect(context.tickets().length).toBe(1)
      expect(context.health.problems().map(problem => problem.detail).join('\n')).toContain('never fires again')
    } finally { await source.stop(); vi.useRealTimers() }
  })

  it('keeps the alarm it raised, instead of clearing it with its own summary line', async () => {
    vi.useFakeTimers()
    // From this date the next Feb 29 is 483 days out, so the very first pass already has nothing to compute — and the
    // summary written at the end of that pass used to erase the problem the pass had just recorded.
    vi.setSystemTime(new Date('2026-11-03T00:00:00Z'))
    const context = harness({ sources: { cron: { enabled: true, schedules: [leap] } } })
    const source = new CronSource(context.host)
    await source.start()
    try {
      expect(context.health.problems().map(problem => problem.detail).join('\n')).toContain('never fires again')
      expect(context.tickets().length).toBe(0)
      // A second pass must not silently heal it either.
      await source.poll?.()
      expect(context.health.problems().length).toBe(1)
    } finally { await source.stop(); vi.useRealTimers() }
  })
})

describe('one broken Source must not take the others down', () => {
  // A schedule with a zone `Intl` does not know makes `nextRun` throw, and `reconcile` throws out of `start()`.
  // The registry used to abort its loop there, so a single typo in the settings document unmounted inbox and session
  // too — while `PUT /api/settings` had already answered 200, because the sync is fire-and-forget.
  const failing = { name: 'cron' as const, create: () => ({ id: 'cron', kind: 'cron' as const, start() { throw new Error('RangeError: Invalid time zone') }, stop() {}, status: () => ({ ok: true }) }) }
  const healthy = { name: 'inbox' as const, create: () => ({ id: 'inbox', kind: 'inbox' as const, start() { started.push('inbox') }, stop() {}, status: () => ({ ok: true }) }) }
  const started: string[] = []

  it('starts the Sources after the one that failed, and names the failure', async () => {
    started.length = 0
    const context = harness()
    const registry = new SourceRegistry(context.host, [failing, healthy])
    await registry.sync()
    expect(started).toEqual(['inbox'])
    expect(context.health.problems()).toContainEqual({
      name: 'source:cron', detail: 'Error: RangeError: Invalid time zone', at: expect.any(String),
    })
    expect(Object.keys(registry.status())).toEqual(['inbox'])
  })

  it('retries a Source whose start failed, instead of remembering it as running', async () => {
    started.length = 0
    const context = harness()
    let attempts = 0
    const flaky = { name: 'cron' as const, create: () => ({ id: 'cron', kind: 'cron' as const, start() { attempts++; if (attempts === 1) throw new Error('first start fails') }, stop() {}, status: () => ({ ok: true }) }) }
    const registry = new SourceRegistry(context.host, [flaky, healthy])
    await registry.sync()
    expect(Object.keys(registry.status())).toEqual(['inbox'])
    // The signature is recorded only after a successful start, so the next sync tries again rather than skipping it.
    await registry.sync()
    expect(attempts).toBe(2)
    expect(Object.keys(registry.status()).sort()).toEqual(['cron', 'inbox'])
  })
})

describe('the name a taken request is archived under', () => {
  // The name is the Trigger's identity, not the instant it was taken. That is what makes archiving idempotent: two
  // scans that both take one file write the same destination, so the second overwrites the same bytes instead of
  // leaving the operator two copies of one request and intake counts that lie.
  it('is the Trigger id, so taking the same request twice cannot make two copies', async () => {
    const inbox = tempDir('myagent-inbox-')
    const { host, triggers } = harness()
    drop(inbox, 'named.md', '做点事。')
    const source = new InboxSource(host, inbox)
    await source.start()
    try {
      await source.poll?.()
      const taken = readdirSync(join(inbox, 'accepted'))
      expect(taken).toHaveLength(1)
      // The whole mechanism in one line: the archived name is a pure function of the event's identity.
      expect(taken[0]).toBe(`${triggers()[0]!.trigger.id}-named.md`)
      // A second file with the same name is a different event (a different mtime), so it is a second Trigger and a
      // second archive; what must not happen is one event archiving twice.
      expect(readdirSync(inbox).filter(name => name.endsWith('.md'))).toEqual([])
    } finally { await source.stop() }
  })
})

describe('a Source paused or disabled by its own setting', () => {
  const daily = {
    id: 'daily', name: '每日', enabled: true, prompt: '做点事',
    timing: { kind: 'daily' as const, time: '09:00', timeZone: 'UTC' },
  }

  it('consumes no slot while paused, and fires the remembered slot when the pause lifts', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-03T08:00:00Z'))
    const context = harness({ sources: { cron: { enabled: true, paused: true, schedules: [daily] } } })
    const source = new CronSource(context.host)
    await source.start()
    try {
      vi.setSystemTime(new Date('2026-11-03T09:00:01Z'))
      await source.poll?.()
      // Nothing produced, so nothing refused: a gate refusal would have stored an ignored Decision and moved the
      // remembered slot past 09:00, which is the loss the global pause used to cause.
      expect(context.tickets().length).toBe(0)
      expect(context.decisions().length).toBe(0)
      context.save({ acceptMode: 'auto', allowedSenders: ['operator'], sources: { cron: { enabled: true, paused: false, schedules: [daily] } } })
      await source.poll?.()
      expect(context.tickets().length).toBe(1)
      expect(context.triggers()[0]!.trigger.at).toBe('2026-11-03T09:00:00.000Z')
    } finally { await source.stop(); vi.useRealTimers() }
  })

  it('keeps its read positions while disabled, so turning it back on owes nothing', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-03T08:00:00Z'))
    const context = harness({ sources: { cron: { enabled: true, schedules: [daily] } } })
    const source = new CronSource(context.host)
    await source.start()
    try {
      const before = context.cursors.get('source:cron')
      context.save({ acceptMode: 'auto', allowedSenders: ['operator'], sources: { cron: { enabled: false, schedules: [daily] } } })
      await source.poll?.()
      // Erasing them made "turn this Source off for a week" destroy every slot that passed meanwhile.
      expect(context.cursors.get('source:cron')).toEqual(before)
      vi.setSystemTime(new Date('2026-11-03T09:00:01Z'))
      context.save({ acceptMode: 'auto', allowedSenders: ['operator'], sources: { cron: { enabled: true, schedules: [daily] } } })
      await source.poll?.()
      expect(context.tickets().length).toBe(1)
    } finally { await source.stop(); vi.useRealTimers() }
  })

  it('leaves an inbox file where the operator put it while its own pause is on', async () => {
    const context = harness({ sources: { inbox: { enabled: true, paused: true } } })
    const inbox = tempDir('myagent-paused-')
    const path = drop(inbox, 'held.md', '做点事。')
    const source = new InboxSource(context.host, inbox)
    await source.start()
    try {
      await source.poll?.()
      expect(context.tickets().length).toBe(0)
      expect(context.decisions().length).toBe(0)
      expect(existsSync(path)).toBe(true)
      // And nothing was filed anywhere: a refusal would have moved it to rejected/ with a reason it cannot take back.
      expect(readdirSync(inbox).filter(name => !name.startsWith('.'))).toEqual(['held.md'])
      context.save({ acceptMode: 'auto', allowedSenders: ['operator'], sources: { inbox: { enabled: true, paused: false } } })
      await source.poll?.()
      expect(context.tickets().length).toBe(1)
    } finally { await source.stop() }
  })
})

describe('a Source that is denied rather than switched off', () => {
  const daily = {
    id: 'daily', name: '每日', enabled: true, prompt: '做点事',
    timing: { kind: 'daily' as const, time: '09:00', timeZone: 'UTC' },
  }

  it('produces nothing while denied, so the remembered slot survives until the denial lifts', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-11-03T08:00:00Z'))
    const context = harness({ sources: { cron: { enabled: true, deny: true, schedules: [daily] } } })
    const source = new CronSource(context.host)
    await source.start()
    try {
      vi.setSystemTime(new Date('2026-11-03T09:00:01Z'))
      await source.poll?.()
      // Nothing produced, so nothing refused and nothing consumed. A gate-level Deny would have stored an ignored
      // Decision and moved the remembered slot past 09:00 — which is the loss `enabled: false` also causes.
      expect(context.tickets().length).toBe(0)
      expect(context.decisions().length).toBe(0)
      context.save({ acceptMode: 'auto', allowedSenders: ['operator'], sources: { cron: { enabled: true, deny: false, schedules: [daily] } } })
      await source.poll?.()
      expect(context.tickets().length).toBe(1)
      expect(context.triggers()[0]!.trigger.at).toBe('2026-11-03T09:00:00.000Z')
    } finally { await source.stop(); vi.useRealTimers() }
  })
})

describe('rule source', () => {
  const rule = {
    id: 'digest-done',
    when: { outcome: 'done' as const },
    then: { prompt: '把摘要发到群里' },
    maxDepth: 2,
  }
  const settingsWith = (rules: unknown[], extra: Record<string, unknown> = {}) => ({
    acceptMode: 'auto', allowedSenders: ['operator', 'digest-done'],
    sources: { rule: { enabled: true, allowSystemActors: true, rules, ...extra } },
  })

  /** Deliver the ending of a Ticket the way the Runtime would, and answer what the Source asked for. */
  const ended = (context: ReturnType<typeof harness>, ticket: Ticket): void => {
    for (const listener of [...context.listeners]) listener({ type: 'ticket.ended', ticket })
  }

  it('asks for work when a matching Ticket ends, as a system actor named after the rule', async () => {
    enqueued.length = 0
    const context = harness(settingsWith([rule]))
    const source = new RuleSource(context.host)
    source.start()
    try {
      const made = context.engine.createTicket({ title: '每日摘要', text: '做点事' })
      const id = made.ticketId!
      context.engine.assignmentStarted(id, context.memory.tickets.get(id)!.assignments[0]!.id)
      context.engine.report(id, { state: 'ready', summary: '写好了' })
      ended(context, context.memory.tickets.get(id)!)

      expect(enqueued).toHaveLength(1)
      const trigger = enqueued[0]!.payload as Trigger
      expect(enqueued[0]!.kind).toBe('trigger')
      // Two gates, and this Trigger satisfies both: a system actor, named after the rule that produced it.
      expect(trigger.actor).toEqual({ id: 'digest-done', kind: 'system' })
      expect(trigger.kind).toBe('rule')
      expect(trigger.meta).toMatchObject({ depth: 1, originTicketId: id, rule: 'digest-done' })
      // A rule can also say which Work the work it asks for belongs to; `receive` classifies the Ticket from this, so
      // proactive work is not the one kind of work nobody can find in a grouping.
      const withWork = harness(settingsWith([{ ...rule, then: { prompt: '做点事', workId: 'work-9' } }]))
      const other = new RuleSource(withWork.host)
      other.start()
      ended(withWork, context.memory.tickets.get(id)!)
      other.stop()
      expect((enqueued.at(-1)!.payload as Trigger).meta).toMatchObject({ work: 'work-9' })
      expect(trigger.text).toContain('把摘要发到群里')
      // And the gate takes it, which is the whole point of the two settings from the last round.
      expect(context.engine.receive(trigger).disposition.state).toBe('accepted')
    } finally { source.stop() }
  })

  it('asks once however many times the same ending is delivered', async () => {
    enqueued.length = 0
    const context = harness(settingsWith([rule]))
    const source = new RuleSource(context.host)
    source.start()
    try {
      const made = context.engine.createTicket({ title: '每日摘要', text: '做点事' })
      const id = made.ticketId!
      context.engine.assignmentStarted(id, context.memory.tickets.get(id)!.assignments[0]!.id)
      context.engine.report(id, { state: 'ready', summary: '写好了' })
      const ticket = context.memory.tickets.get(id)!
      ended(context, ticket)
      ended(context, ticket)
      // The queue dedupes by key, and the key is a pure function of the rule and the ending, so both asks are one.
      expect(enqueued).toHaveLength(2)
      expect(enqueued[0]!.key).toBe(enqueued[1]!.key)
      expect((enqueued[0]!.payload as Trigger).id).toBe((enqueued[1]!.payload as Trigger).id)
    } finally { source.stop() }
  })

  it('stops a chain at the depth the rule allows, and says so instead of going quiet', async () => {
    enqueued.length = 0
    const context = harness(settingsWith([rule]))
    const source = new RuleSource(context.host)
    source.start()
    try {
      const made = context.engine.createTicket({ title: '链上的第三环', text: '做点事' })
      const id = made.ticketId!
      context.engine.assignmentStarted(id, context.memory.tickets.get(id)!.assignments[0]!.id)
      context.engine.report(id, { state: 'ready', summary: '写好了' })
      // Depth 2 already, and the rule allows at most 2, so the next link would be the third.
      const deep: Ticket = { ...context.memory.tickets.get(id)!, origin: { triggerId: 'tr', depth: 2 } }
      ended(context, deep)
      expect(enqueued).toEqual([])
      expect(context.health.problems().map(problem => problem.detail).join('\n')).toContain('reached depth 3 of at most 2')
    } finally { source.stop() }
  })

  it('matches only the outcome and the Work the rule names', async () => {
    enqueued.length = 0
    const context = harness(settingsWith([{ ...rule, id: 'only-this-work', when: { outcome: 'done', workId: 'work-1' } }]))
    const source = new RuleSource(context.host)
    source.start()
    try {
      const made = context.engine.createTicket({ title: '别的工作流里的一张', text: '做点事' })
      const id = made.ticketId!
      context.engine.assignmentStarted(id, context.memory.tickets.get(id)!.assignments[0]!.id)
      context.engine.report(id, { state: 'ready', summary: '写好了' })
      ended(context, context.memory.tickets.get(id)!)
      expect(enqueued).toEqual([])
      // The same Ticket, in the Work the rule names, does match.
      const inWork: Ticket = { ...context.memory.tickets.get(id)!, workId: 'work-1' }
      ended(context, inWork)
      expect(enqueued).toHaveLength(1)
    } finally { source.stop() }
  })
})

describe('two syncs that overlap', () => {
  // A Source that is started but unreachable from `stop()` keeps polling after the deployment is gone: in the suite it
  // produced 40 unhandled `database is not open` errors, and in production it would keep reading settings from a
  // closed database. The overlap is made deterministic here by holding the first Source's `start()` open.
  class Counted implements Source {
    static created: Counted[] = []
    readonly id = 'inbox'
    readonly kind = 'inbox' as const
    stopped = false
    private release: (() => void) | undefined
    constructor(block: boolean) { this.block = block; Counted.created.push(this) }
    private readonly block: boolean
    async start(): Promise<void> {
      if (!this.block) return
      await new Promise<void>(resolve => { this.release = resolve })
    }
    async stop(): Promise<void> { this.stopped = true; this.release?.() }
    open(): void { this.release?.() }
    status(): SourceStatus { return { ok: true } }
  }

  it('orphans nothing: every Source it started is one it can stop', async () => {
    Counted.created = []
    // A real kind, so the signature is a real one: `signatureOf` reads `settings.sources[kind]`, and a made-up kind
    // would have no block there and therefore a signature that could never change.
    const context = harness({ sources: { inbox: { enabled: true, directory: '/tmp/one' } } })
    const registry = new SourceRegistry(context.host, [{
      name: 'inbox',
      // The first instance blocks in start(), so a second sync can overlap it.
      create: () => new Counted(Counted.created.length === 0),
    }])

    const first = registry.sync()
    // Change the inbox directory: that changes the signature, so the second sync has a reason to replace the Source.
    context.save({ acceptMode: 'auto', allowedSenders: ['operator'], sources: { inbox: { enabled: true, directory: '/tmp/two' } } })
    const second = registry.sync()
    Counted.created[0]!.open()
    await Promise.all([first, second])
    await registry.stop()

    // Without a latch both syncs create a replacement and the second `running.set` overwrites the first, orphaning a
    // started Source that `stop()` can no longer reach.
    expect(Counted.created.length).toBeGreaterThan(1)
    expect(Counted.created.filter(source => !source.stopped)).toEqual([])
  })
})

describe('a rule chain that stops at its depth limit', () => {
  const rule = {
    id: 'digest-done',
    when: { outcome: 'done' as const },
    then: { prompt: '把摘要发到群里' },
    maxDepth: 2,
  }
  const settingsWith = (rules: unknown[]) => ({
    acceptMode: 'auto', allowedSenders: ['operator', 'digest-done'],
    sources: { rule: { enabled: true, allowSystemActors: true, rules } },
  })
  const ended = (context: ReturnType<typeof harness>, ticket: Ticket): void => {
    for (const listener of [...context.listeners]) listener({ type: 'ticket.ended', ticket })
  }

  // The health line is the "right now" signal, and the next unrelated ending legitimately clears it. What must survive
  // is the fact that a rule stopped asking for work on purpose — otherwise a depth-limited chain leaves no trace
  // anywhere: no Trigger, no Decision, no event.
  it('leaves a durable record on the Ticket whose ending stopped it', async () => {
    enqueued.length = 0
    const context = harness(settingsWith([{ ...rule, maxDepth: 1 }]))
    const source = new RuleSource(context.host)
    source.start()
    try {
      const made = context.engine.createTicket({ title: '链的末端', text: '做点事' })
      const id = made.ticketId!
      context.engine.assignmentStarted(id, context.memory.tickets.get(id)!.assignments[0]!.id)
      context.engine.report(id, { state: 'ready', summary: '写好了' })
      const deep: Ticket = { ...context.memory.tickets.get(id)!, origin: { triggerId: 'tr', depth: 1 } }
      ended(context, deep)

      expect(enqueued).toEqual([])
      const stopped = context.engine.history(id).filter(event => event.type === 'rule_stopped')
      expect(stopped).toHaveLength(1)
      expect(stopped[0]!.by).toMatchObject({ kind: 'system', id: 'rule' })
      expect(stopped[0]!.detail).toMatchObject({ rule: 'digest-done', depth: 2, maxDepth: 1 })

      // An unrelated ending clears the health line, which is what a "now" signal is for — and the log still has it.
      const other = context.engine.createTicket({ title: '无关的一张', text: '做点事' })
      const otherId = other.ticketId!
      context.engine.assignmentStarted(otherId, context.memory.tickets.get(otherId)!.assignments[0]!.id)
      context.engine.report(otherId, { state: 'ready', summary: '写好了' })
      ended(context, context.memory.tickets.get(otherId)!)
      expect(context.engine.history(id).filter(event => event.type === 'rule_stopped')).toHaveLength(1)
    } finally { source.stop() }
  })
})

describe('a rule source that is denied or paused', () => {
  const rule = { id: 'digest-done', when: { outcome: 'done' as const }, then: { prompt: '做点事' }, maxDepth: 2 }
  const settingsWith = (source: Record<string, unknown>) => ({
    acceptMode: 'auto', allowedSenders: ['operator', 'digest-done'],
    sources: { rule: { enabled: true, allowSystemActors: true, rules: [rule], ...source } },
  })
  const ended = (context: ReturnType<typeof harness>, ticket: Ticket): void => {
    for (const listener of [...context.listeners]) listener({ type: 'ticket.ended', ticket })
  }
  const doneTicket = (context: ReturnType<typeof harness>, title: string): Ticket => {
    const made = context.engine.createTicket({ title, text: '做点事' })
    const id = made.ticketId!
    context.engine.assignmentStarted(id, context.memory.tickets.get(id)!.assignments[0]!.id)
    context.engine.report(id, { state: 'ready', summary: '写好了' })
    return context.memory.tickets.get(id)!
  }

  // Deny and pause happen where the work is produced, exactly as for cron and inbox. Going through the gate instead
  // would be lossy in a way that cannot be undone here: the gate stores the Trigger as ignored, and because a rule's
  // Trigger id is a pure function of the ending it answers, that ending can never be re-evaluated — lifting the denial
  // would not resurrect the chain, it would only stop refusing new ones.
  it('produces nothing while denied, and nothing is stored against the ending', () => {
    enqueued.length = 0
    const context = harness(settingsWith({ deny: true }))
    const source = new RuleSource(context.host)
    source.start()
    try {
      const ticket = doneTicket(context, '被拒绝期间结束的一张')
      // Creating that Ticket already stored one Trigger and one Decision of its own — the operator's request. What
      // must not appear is a second pair belonging to the ending.
      const triggersBefore = context.triggers().length
      const decisionsBefore = context.decisions().length
      ended(context, ticket)
      expect(enqueued).toEqual([])
      expect(context.triggers().length).toBe(triggersBefore)
      expect(context.decisions().length).toBe(decisionsBefore)
      expect(context.triggers().filter(record => record.trigger.kind === 'rule')).toEqual([])
    } finally { source.stop() }
  })

  it('produces nothing while paused either, and asks once the pause lifts', () => {
    enqueued.length = 0
    const context = harness(settingsWith({ paused: true }))
    const source = new RuleSource(context.host)
    source.start()
    try {
      const ticket = doneTicket(context, '暂停期间结束的一张')
      ended(context, ticket)
      expect(enqueued).toEqual([])
      // Lifting the pause does not resurrect that ending — the event is over, and pretending otherwise would mean
      // replaying history. What it does is stop swallowing the next one.
      context.save(settingsWith({}))
      const next = doneTicket(context, '解除之后结束的一张')
      ended(context, next)
      expect(enqueued).toHaveLength(1)
      expect((enqueued[0]!.payload as Trigger).actor).toEqual({ id: 'digest-done', kind: 'system' })
    } finally { source.stop() }
  })
})

describe('an inbox directory anybody can write to', () => {
  // The gate decides who may originate work by sender name, and an inbox request carries its sender in the file
  // itself. So the real boundary is the directory's permissions, and a world-writable inbox is a bypass of the whole
  // gate that used to fail silently — the Decision record would show a sender that looks legitimate.
  it('is reported on the health board, with the mode and what to do about it', async () => {
    const inbox = tempDir('myagent-loose-')
    chmodSync(inbox, 0o777)
    const { host, health } = harness()
    const source = new InboxSource(host, inbox)
    await source.start()
    try {
      const detail = health.problems().map(problem => problem.detail).join('\n')
      expect(detail).toContain('writable by others')
      expect(detail).toContain('777')
      expect(detail).toContain('chmod go-w')
    } finally { await source.stop() }
  })

  it('says nothing when the directory is only the operator’s', async () => {
    const inbox = tempDir('myagent-tight-')
    chmodSync(inbox, 0o700)
    const { host, health } = harness()
    const source = new InboxSource(host, inbox)
    await source.start()
    try {
      expect(health.problems().map(problem => problem.detail).join('\n')).not.toContain('writable by others')
    } finally { await source.stop() }
  })
})

describe('the inbox board and the state it does not handle', () => {
  const directory = () => tempDir('myagent-inbox-')

  // The erasure defect, which is the one that could happen today: `record(detail)` overwrites the entry wholesale
  // (`health.ts:17`), so a `problem()` raised mid-pass was gone before the pass ended. Collecting the pass's issues
  // and deciding once, at the end, is what makes a complaint the operator can actually see. This is the S19/N5 shape
  // that chat's spec says cron and rule each shipped once.
  it('keeps a complaint raised mid-pass, instead of overwriting it with the end-of-pass summary', async () => {
    const inbox = directory()
    const { host } = harness()
    drop(inbox, 'stuck.md', '---\ntitle: Unreadable\n---\nBody.')
    chmodSync(join(inbox, 'stuck.md'), 0o000)
    const source = new InboxSource(host, inbox)
    source.start()
    try {
      await source.poll()
      const problems = host.health.problems()
      expect(problems.map(problem => problem.detail).join('\n')).toContain('Could not read stuck.md')
      // And the file was left where it is: a request that could not be read was not taken, so it must not be filed
      // anywhere that claims it was.
      expect(existsSync(join(inbox, 'accepted'))).toBe(false)  // 更强的断言：那个目录根本不该存在
    } finally { chmodSync(join(inbox, 'stuck.md'), 0o644); source.stop() }
  })

  it('parks an unhandled disposition where the folder claims no verdict, and reports the backlog rather than the event', async () => {
    const inbox = directory()
    const { host, tickets } = harness()
    // `pending` has no producer in src/ and `Engine.receive` re-runs the gate for a stored `lost` row, so neither
    // reaches this branch today; fabricating a state is the only way in, and the point is that a future union member
    // arrives exactly here.
    const real = host.engine.receive.bind(host.engine)
    ;(host.engine as { receive: unknown }).receive = (trigger: never) => ({
      ...real(trigger), disposition: { state: 'summoned' },
    })
    drop(inbox, 'odd.md', '---\ntitle: Odd\n---\nDo the thing.')
    const source = new InboxSource(host, inbox)
    source.start()
    try {
      await source.poll()
      expect(source.status().counts).toMatchObject({ unhandled: 1, accepted: 0 })
      expect(existsSync(join(inbox, 'accepted'))).toBe(false)  // 更强的断言：那个目录根本不该存在
      const parked = taken(inbox, 'unhandled')
      expect(parked).toHaveLength(1)
      // The event is recorded durably, inside the archived file — where `take` already puts every note.
      const first = readFileSync(join(inbox, 'unhandled', parked[0]!), 'utf8').split('\n')[0]!
      expect(first).toContain('summoned')
      expect(first).toContain('nothing was executed')
      // Not asserted: `tickets()` is NOT empty here, and that is an artifact of the fabrication rather than a defect.
      // Overriding the RETURNED disposition cannot un-do what the real `receive` already did — it stored the Trigger
      // and created the Ticket, because the real gate accepted it. So this harness can prove where an unhandled state
      // is filed and what the board says, but not that nothing ran. For a real unhandled state nothing does run,
      // because a disposition other than `accepted` is what "no Ticket" means; asserting that needs a Source whose
      // engine returns the state without having acted on it, which is a different (and larger) piece of harness.

      // The board reports the BACKLOG, and an explicit SECOND pass does not erase it — the assertion that
      // distinguishes a current condition from a past event, which is why the event itself is not on the board at all.
      // `poll()` rather than `wait(ms)`: `start()` already ran one pass, and waiting on the timer made this assertion
      // pass vacuously (no second pass happened), which is the hollow-guard shape discipline 0.8 exists to catch.
      expect(host.health.problems().map(p => p.detail).join('\n')).toContain('1 request(s) are parked in unhandled/')
      await source.poll()
      expect(host.health.problems().map(p => p.detail).join('\n')).toContain('1 request(s) are parked in unhandled/')

      // And it retires on its own once a person deals with the file.
      rmSync(join(inbox, 'unhandled', parked[0]!))
      await source.poll()
      expect(host.health.problems()).toEqual([])
    } finally { source.stop() }
  })
})

describe('a cron slot whose disposition this Source does not handle', () => {
  const NOW = '2026-11-03T10:00:30Z'

  // Two assertions carry this, and they carry different things. `ignored: 0` pins the COUNTING fix: the tail of the
  // ternary used to be `'ignored'`, which says "the gate refused this" when the truth is that the gate's answer was
  // not recognized. The cleared board pins the SHAPE of the report: `unhandledNow` is per firing, not cumulative, so
  // the line recurs while slots keep arriving unrecognized and retires on the first ordinary firing. A cumulative
  // number on the board would be a permanent alarm (S38/S41); a momentary one would never have been visible at all,
  // which is the inbox defect fixed the same round.
  //
  // The exact numbers come from a diagnostic run rather than from reasoning: at NOW two slots are already due (09:59
  // and 10:00), so the first pass fires TWICE — `unhandled: 2` cumulative while the board names the most recent
  // firing's 1. Asserting 1 because "one seed means one firing" was the previous attempt's mistake, and the lesson is
  // the one §4.61 states: prove what the apparatus did before asserting what it should have done.
  it('counts it as itself rather than as a refusal, and the board line retires on the next ordinary firing', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(NOW))
    const { host, triggers, cursors } = harness({
      sources: { cron: { enabled: true, schedules: [{ id: 'digest', name: 'Daily digest', prompt: 'Write today\'s digest.', timing: { kind: 'cron', expression: '* * * * *' } }] } },
    })
    cursors.set('cron', { digest: { next: Date.parse('2026-11-03T09:59:00Z'), missed: 0 } })
    const real = host.engine.receive.bind(host.engine)
    const source = new CronSource(host)
    try {
      // `pending` has no producer in src/ and `Engine.receive` re-runs the gate for a stored `lost` row, so neither
      // reaches the tail today; fabricating a state is the only way in, and the point is that a future union member
      // arrives exactly there.
      ;(host.engine as { receive: unknown }).receive = (trigger: never) => ({
        ...real(trigger), disposition: { state: 'summoned' },
      })
      source.start()
      await vi.advanceTimersByTimeAsync(60)

      // The apparatus ran, and this is asserted before anything about the counting: two slots were due, both fired.
      expect(triggers()).toHaveLength(2)
      expect(source.status().counts).toMatchObject({ unhandled: 2, ignored: 0, accepted: 0, observed: 0, duplicate: 0 })
      expect(host.health.problems().map(problem => problem.detail).join('\n'))
        .toContain('1 schedule slot(s) in the most recent firing were dispositioned in a state this Source does not handle')

      // The load-bearing half: with the real gate restored, the NEXT firing is ordinary, so the line must go away on
      // its own — no hand clearing, and nothing left behind to be mistaken for a current problem. The cumulative
      // count stays at 2, because it is a count of what happened, not of what is wrong now.
      ;(host.engine as { receive: unknown }).receive = real
      await vi.advanceTimersByTimeAsync(60_000)
      expect(host.health.problems()).toEqual([])
      expect(source.status().counts).toMatchObject({ unhandled: 2, ignored: 0 })
      expect(source.status().counts!.accepted).toBeGreaterThan(0)
    } finally { vi.useRealTimers(); source.stop() }
  })
})
