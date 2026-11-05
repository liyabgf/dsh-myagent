/**
 * The Effects queue: the guarantees that make unattended work safe.
 *
 * A launch, a delivery and a notification all pass through here, so this is where "it survives a restart" and "it does
 * not happen twice" are decided. A retry that never stops is a Ticket that burns a model budget forever; a retry that
 * gives up silently is work nobody will ever do. Both are tested here, with the numbers.
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Effects, Later, backoff } from '../src/app/effects.ts'
import { HealthBoard } from '../src/app/health.ts'
import { Store } from '../src/app/store.ts'
import { tempDir } from './helpers/temp.ts'

interface Harness {
  readonly store: Store
  readonly health: HealthBoard
  readonly effects: Effects
  readonly gave: { kind: string; key: string; payload: unknown; error: string }[]
}

function harness(options: { tries?: number; backoffMs?: number; retryIntervalMs?: number } = {}): Harness {
  const directory = tempDir('myagent-effects-')
  const store = new Store(join(directory, 'effects.sqlite3'))
  const health = new HealthBoard()
  const gave: Harness['gave'] = []
  const effects = new Effects(store, {
    tries: options.tries ?? 5,
    backoffMs: options.backoffMs ?? 60_000,
    retryIntervalMs: options.retryIntervalMs ?? 10,
    health: health.entry('effects'),
    onPermanentFailure: (kind, key, payload, error) => {
      gave.push({ kind, key, payload, error: error instanceof Error ? error.message : String(error) })
    },
  })
  return { store, health, effects, gave }
}

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

describe('the backoff', () => {
  it('grows exponentially and stops at the cap', () => {
    expect(backoff(1, 60_000)).toBe(15_000)
    expect(backoff(2, 60_000)).toBe(30_000)
    expect(backoff(3, 60_000)).toBe(60_000)
    expect(backoff(4, 60_000)).toBe(60_000)
    expect(backoff(20, 60_000)).toBe(60_000)
  })

  it('never answers zero or a negative wait, however it is called', () => {
    expect(backoff(0, 60_000)).toBe(15_000)
    expect(backoff(-3, 60_000)).toBe(15_000)
    expect(backoff(1, 0)).toBe(0)
  })
})

describe('one effect, one outcome', () => {
  it('settles an effect its handler got through, so it never runs again', async () => {
    const { store, effects } = harness()
    const seen: unknown[] = []
    effects.handle('launch', payload => { seen.push(payload) })
    effects.enqueue('launch', 'ticket-1', { ticketId: 'ticket-1' })
    await effects.runDue()
    expect(seen).toEqual([{ ticketId: 'ticket-1' }])
    expect(store.effectCounts()).toEqual({})
    // A second pass finds nothing to do.
    await effects.runDue()
    expect(seen).toHaveLength(1)
  })

  it('defers an effect that is not runnable yet, without counting it as a failure', async () => {
    const { store, effects, health } = harness()
    let attempts = 0
    effects.handle('launch', () => {
      attempts++
      // No free worker slot is not an error: the launch waits for one.
      return attempts < 3 ? new Later(5) : undefined
    })
    effects.enqueue('launch', 'ticket-1', {})
    await effects.runDue()
    expect(attempts).toBe(1)
    // Not due yet, so a pass right away does not hammer it.
    await effects.runDue()
    expect(attempts).toBe(1)
    await wait(10)
    await effects.runDue()
    await wait(10)
    await effects.runDue()
    expect(attempts).toBe(3)
    expect(store.effectCounts()).toEqual({})
    // Deferring is not failing: no retry was burned and nothing is recorded as a problem.
    expect(health.problems()).toEqual([])
  })

  it('counts a failure, defers the retry, and says so on the health board', async () => {
    const { store, effects, health } = harness()
    let attempts = 0
    effects.handle('launch', () => { attempts++; throw new Error('DSH did not hand over the Session') })
    effects.enqueue('launch', 'ticket-1', {})
    await effects.runDue()
    expect(attempts).toBe(1)
    // The row stays queued, and the backoff means a pass right away does not retry it: a failure must not hammer DSH.
    expect(store.effectCounts()).toEqual({ launch: 1 })
    await effects.runDue()
    await effects.runDue()
    expect(attempts).toBe(1)
    // Still a problem, and that is load-bearing: the two passes above claimed nothing at all, so a queue that
    // summarized on "nothing failed in this pass" and nothing else would already have cleared the line about work
    // that failed once and is queued to fail again. What keeps the line up is the row, not the pass.
    const snapshot = health.entry('effects').snapshot()
    expect(snapshot.ok).toBe(false)
    expect(snapshot.detail).toContain('launch failed 1 of 5 times')
    expect(snapshot.detail).toContain('DSH did not hand over the Session')
  })

  it('clears its own health line on the first pass after the failure is over', async () => {
    const { store, effects, health } = harness({ tries: 2, backoffMs: 0 })
    let attempts = 0
    effects.handle('launch', () => { attempts++; if (attempts < 2) throw new Error('DSH did not hand over the Session') })
    effects.enqueue('launch', 'ticket-1', {})
    // backoffMs 0 makes the retry due at once, so one pass holds both the failure and the success that follows it.
    await effects.runDue()
    expect(attempts).toBe(2)
    expect(store.effectCounts()).toEqual({})
    // The pass that found the failure does not also erase it, which is how the cron Source used to hide its own alarm.
    expect(health.entry('effects').snapshot()).toMatchObject({ ok: false })
    expect(health.entry('effects').snapshot().detail).toContain('launch failed 1 of 2 times')
    await effects.runDue()
    // Now the queue clears itself — the property whose absence left a notify that failed twice and then succeeded on
    // the board for the life of the process. The sentence carries no count because the port this queue is handed
    // answers "is this row still queued" and never "how many are", and widening it for one line would buy a
    // capability no other line in `effects.ts` needs.
    expect(health.problems()).toEqual([])
    expect(health.entry('effects').snapshot()).toMatchObject({ ok: true, detail: 'no effect failed in this pass' })
  })

  it('gives up after its budget and hands the failure to whoever can show it', async () => {
    const { store, effects, gave } = harness({ tries: 3, backoffMs: 0 })
    let attempts = 0
    effects.handle('launch', () => { attempts++; throw new Error('the directory could not be made') })
    effects.enqueue('launch', 'ticket-1', { ticketId: 'ticket-1' })
    // backoffMs 0 makes every retry due at once, so one pass walks the whole budget.
    await effects.runDue()
    expect(attempts).toBe(3)
    expect(gave).toEqual([{ kind: 'launch', key: 'ticket-1', payload: { ticketId: 'ticket-1' }, error: 'the directory could not be made' }])
    // A given-up effect leaves the queue: retrying it forever is what the budget exists to prevent.
    expect(store.effectCounts()).toEqual({})
  })

  it('survives a permanent-failure hook that throws, and records that instead', async () => {
    const { store, health, effects } = harness({ tries: 1, backoffMs: 0 })
    const board = new HealthBoard()
    const withBadHook = new Effects(store, {
      tries: 1, health: board.entry('effects'),
      onPermanentFailure: () => { throw new Error('the hook is broken') },
    })
    withBadHook.handle('launch', () => { throw new Error('nope') })
    withBadHook.enqueue('launch', 'ticket-1', {})
    await withBadHook.runDue()
    expect(board.entry('effects').snapshot().detail).toContain('the hook is broken')
    expect(health.problems()).toEqual([])
  })
})

describe('the queue itself', () => {
  it('replaces a pending effect of the same identity instead of queueing the work twice', async () => {
    const { store, effects } = harness()
    const seen: unknown[] = []
    effects.handle('notify', payload => { seen.push(payload) })
    effects.enqueue('notify', 'ticket-1', { n: 1 })
    effects.enqueue('notify', 'ticket-1', { n: 2 })
    await effects.runDue()
    expect(seen).toEqual([{ n: 2 }])
    expect(store.effectCounts()).toEqual({})
  })

  it('runs one pass at a time, so two callers cannot work the same row', async () => {
    const { effects } = harness()
    let inside = 0
    let concurrent = 0
    effects.handle('launch', async () => {
      inside++
      concurrent = Math.max(concurrent, inside)
      await new Promise(resolve => setTimeout(resolve, 15))
      inside--
    })
    for (const key of ['a', 'b', 'c']) effects.enqueue('launch', key, {})
    await Promise.all([effects.runDue(), effects.runDue(), effects.runDue()])
    expect(concurrent).toBe(1)
  })

  it('takes a retry that became due during a pass in the same pass', async () => {
    const { effects } = harness({ retryIntervalMs: 5 })
    let attempts = 0
    effects.handle('launch', () => {
      attempts++
      return attempts < 2 ? new Later(0) : undefined
    })
    effects.enqueue('launch', 'ticket-1', {})
    await effects.runDue()
    expect(attempts).toBe(2)
  })

  it('keeps queued rows for the next start once it is disposed', async () => {
    const { store, effects } = harness()
    const seen: unknown[] = []
    effects.handle('launch', payload => { seen.push(payload) })
    effects.enqueue('launch', 'ticket-1', {})
    effects.dispose()
    await effects.runDue()
    expect(seen).toEqual([])
    // The row is still there: a shutdown must not lose work.
    expect(store.effectCounts()).toEqual({ launch: 1 })
    // And a fresh queue over the same Store picks it up, which is what a restart does.
    const revived = new Effects(store, {})
    revived.handle('launch', payload => { seen.push(payload) })
    await revived.runDue()
    expect(seen).toEqual([{}])
  })

  it('runs a handler registered after the effect was queued', async () => {
    const { effects } = harness()
    const seen: unknown[] = []
    effects.enqueue('launch', 'ticket-1', { late: true })
    await effects.runDue()
    expect(seen).toEqual([])
    effects.handle('launch', payload => { seen.push(payload) })
    await effects.runDue()
    expect(seen).toEqual([{ late: true }])
  })

  it('reports what is pending, which is what the panel shows as a backlog', async () => {
    const { store, effects } = harness()
    effects.handle('launch', () => new Later(60_000))
    effects.enqueue('launch', 'a', {})
    effects.enqueue('launch', 'b', {})
    effects.enqueue('notify', 'c', {})
    await effects.runDue()
    expect(effects.pending('launch', 'a')).toBe(true)
    expect(effects.pending('launch', 'missing')).toBe(false)
    expect(store.effectCounts()).toEqual({ launch: 2, notify: 1 })
  })
})

describe('a deferral that is thrown rather than returned', () => {
  // `Later` extends Error and every real call site throws it, while `settle` used to honour only a returned one. So a
  // deferral was counted as a failure: a note added to a Ticket that waits for a person, a pause, or a launch queued
  // behind full worker slots each became a permanent failure once the backoff budget ran out.
  it('defers without spending the retry budget, and still settles when the work becomes runnable', async () => {
    const { store, effects } = harness()
    let attempts = 0
    effects.handle('launch', () => { attempts++; if (attempts < 4) throw new Later(0) })
    effects.enqueue('launch', 'thrown-later', {})
    for (let pass = 0; pass < 5; pass++) await effects.runDue()
    expect(attempts).toBe(4)
    expect(store.effectCounts()).toEqual({})
  })

  it('honours the wait the thrown Later asked for', async () => {
    const { store, effects } = harness()
    effects.handle('launch', () => { throw new Later(60_000) })
    effects.enqueue('launch', 'waiting', {})
    await effects.runDue()
    // Deferred, not failed: it is still queued, and one pass was not enough to spend five tries on it.
    expect(store.effectCounts()).toEqual({ launch: 1 })
    expect(effects.pending('launch', 'waiting')).toBe(true)
  })
})
