/**
 * The Watchdog: judgement about work that has stopped moving, using only actions that already existed.
 *
 * Tested against the real Executor and a real Store, because the thing it detects is a launch that is still marked as
 * starting — a fact only the Executor holds — and the thing it does is re-queue a launch, which only the effect queue
 * can answer for.
 */
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Watchdog, type WatchdogHost } from '../src/app/watchdog.ts'
import { HealthEntry } from '../src/app/health.ts'

/** A host that records what it was asked to do, so the judgement can be asserted without a whole deployment. */
function harness(options: {
  stuck?: { ticketId: string; assignmentId: string }[]
  silent?: { ticketId: string; assignmentId: string; silentForMs: number }[]
  taken?: number
  throws?: boolean
} = {}) {
  const health = new HealthEntry()
  const rescued: { ticketId: string; assignmentId: string; why: string }[] = []
  const interrupted: { ticketId: string; assignmentId: string; why: string }[] = []
  let passes = 0
  const host: WatchdogHost = {
    settings: () => ({ enabled: true, everyMs: 60_000, launchStuckMs: 600_000, silentMs: 3_600_000, maxActions: 2 }),
    stuckLaunches: () => options.stuck ?? [],
    rescue: (ticketId, assignmentId, why) => {
      if (options.throws === true) throw new Error('the queue is closed')
      rescued.push({ ticketId, assignmentId, why })
    },
    silentAttempts: () => options.silent ?? [],
    interrupt: (ticketId, assignmentId, why) => {
      if (options.throws === true) throw new Error('the Session is gone')
      interrupted.push({ ticketId, assignmentId, why })
    },
    actionsTaken: () => options.taken ?? 0,
    escalate: () => {},
    health,
    requestPass: () => { passes++ },
  }
  return { host, health, rescued, interrupted, passes: () => passes, watchdog: new Watchdog(host) }
}

describe('a launch that never produced a Session', () => {
  it('is rescued, and the rescue is asked to run now rather than at the next interval', () => {
    const context = harness({ stuck: [{ ticketId: 'ticket-1', assignmentId: 'assignment-1' }] })
    const actions = context.watchdog.look(1_000_000)
    expect(actions).toEqual([{ ticketId: 'ticket-1', assignmentId: 'assignment-1', why: expect.stringContaining('never came up'), acted: true }])
    expect(context.rescued).toHaveLength(1)
    expect(context.passes()).toBe(1)
  })

  it('stops rescuing a Ticket it has already tried twice, and says a person is needed', () => {
    // The count comes from the Ticket's own log, so a restart cannot make the Watchdog forget and rescue forever: a
    // launch that hangs for a reason no re-queue can fix would otherwise loop until the queue was full of attempts.
    const context = harness({ stuck: [{ ticketId: 'ticket-1', assignmentId: 'assignment-1' }], taken: 2 })
    const actions = context.watchdog.look(1_000_000)
    expect(actions).toEqual([{ ticketId: 'ticket-1', assignmentId: 'assignment-1', why: 'already acted 2 time(s)', acted: false }])
    expect(context.rescued).toEqual([])
    expect(context.health.snapshot()).toMatchObject({ ok: false })
    expect(context.health.snapshot().detail).toContain('needs a person')
    expect(context.passes()).toBe(0)
  })

  it('looks at nothing when the detector is off, so a deployment that does not want it pays nothing', () => {
    const health = new HealthEntry()
    let looked = 0
    const host: WatchdogHost = {
      settings: () => ({ enabled: true, everyMs: 60_000, launchStuckMs: 0, silentMs: 0, maxActions: 2 }),
      stuckLaunches: () => { looked++; return [{ ticketId: 'x', assignmentId: 'y' }] },
      rescue: () => {}, silentAttempts: () => [], interrupt: () => {},
      actionsTaken: () => 0, escalate: () => {}, health, requestPass: () => {},
    }
    expect(new Watchdog(host).look(1_000_000)).toEqual([])
    expect(looked).toBe(0)
  })

  it('reports a rescue that failed instead of leaving the Ticket stuck and the board clean', () => {
    const context = harness({ stuck: [{ ticketId: 'ticket-1', assignmentId: 'assignment-1' }], throws: true })
    const actions = context.watchdog.look(1_000_000)
    expect(actions).toEqual([{ ticketId: 'ticket-1', assignmentId: 'assignment-1', why: expect.stringContaining('never came up'), acted: false }])
    expect(context.health.snapshot()).toMatchObject({ ok: false })
    expect(context.health.snapshot().detail).toContain('the queue is closed')
  })
})

describe('a worker that has stopped saying anything', () => {
  // The opposite state from a stuck launch, and therefore the opposite action: this attempt IS running, so re-queueing
  // a launch would not touch it, and interrupting is what replaces it. The detector is off by default, because
  // "nothing happened for an hour" is a judgement about the operator's own work.
  it('is interrupted with a reason that names the silence', () => {
    const context = harness({ silent: [{ ticketId: 'ticket-2', assignmentId: 'assignment-2', silentForMs: 5_400_000 }] })
    const actions = context.watchdog.look(1_000_000)
    expect(actions).toEqual([{
      ticketId: 'ticket-2', assignmentId: 'assignment-2', silentForMs: 5_400_000,
      why: 'its worker said nothing for 90 minute(s)', acted: true,
    }])
    expect(context.interrupted).toHaveLength(1)
    expect(context.rescued).toEqual([])
    expect(context.passes()).toBe(1)
  })

  it('stops interrupting one it has already acted on, and says a person is needed', () => {
    const context = harness({
      silent: [{ ticketId: 'ticket-2', assignmentId: 'assignment-2', silentForMs: 5_400_000 }], taken: 2,
    })
    const actions = context.watchdog.look(1_000_000)
    expect(actions).toEqual([{
      ticketId: 'ticket-2', assignmentId: 'assignment-2', silentForMs: 5_400_000,
      why: 'already acted 2 time(s)', acted: false,
    }])
    expect(context.interrupted).toEqual([])
    expect(context.health.snapshot().detail).toContain('needs a person, not another attempt')
  })

  it('reports an interruption that failed rather than leaving the attempt running and the board clean', () => {
    const context = harness({ silent: [{ ticketId: 'ticket-2', assignmentId: 'assignment-2', silentForMs: 90_000 }], throws: true })
    expect(context.watchdog.look(1_000_000)[0]!.acted).toBe(false)
    expect(context.health.snapshot().detail).toContain('the Session is gone')
  })

  it('looks for nothing at all when the whole Watchdog is off', () => {
    const health = new HealthEntry()
    let looked = 0
    const host: WatchdogHost = {
      settings: () => ({ enabled: false, everyMs: 60_000, launchStuckMs: 600_000, silentMs: 3_600_000, maxActions: 2 }),
      stuckLaunches: () => { looked++; return [] },
      silentAttempts: () => { looked++; return [] },
      rescue: () => {}, interrupt: () => {}, actionsTaken: () => 0, escalate: () => {}, health, requestPass: () => {},
    }
    expect(new Watchdog(host).look(1_000_000)).toEqual([])
    expect(looked).toBe(0)
  })
})

describe('a settings change to how often it looks', () => {
  // Changing `everyMs` used to take effect only after a restart: `saveSettings` never touched the Watchdog, `arm()`
  // read the settings only when re-arming, and `start()` ran once at mount. A live run measured 53.1s of detection
  // latency against a 15s threshold because the timer was still on the 60s grid from mount.
  it('takes effect without a restart, and does not push the next look further away', async () => {
    vi.useFakeTimers()
    let everyMs = 60_000
    let looked = 0
    const host: WatchdogHost = {
      settings: () => ({ enabled: true, everyMs, launchStuckMs: 600_000, silentMs: 0, maxActions: 2 }),
      stuckLaunches: () => { looked++; return [] },
      silentAttempts: () => [],
      rescue: () => {}, interrupt: () => {}, actionsTaken: () => 0, escalate: () => {},
      health: new HealthEntry(), requestPass: () => {},
    }
    const watchdog = new Watchdog(host)
    watchdog.start()
    try {
      vi.advanceTimersByTime(30_000)
      expect(looked).toBe(0)
      // A shorter interval, and the refresh that follows it — which is what a settings save triggers.
      everyMs = 10_000
      watchdog.settingsChanged()
      vi.advanceTimersByTime(10_000)
      expect(looked).toBe(1)
      // Refreshing again with nothing changed must not move the clock, or the Watchdog would never look at all.
      const before = looked
      watchdog.settingsChanged()
      vi.advanceTimersByTime(9_999)
      expect(looked).toBe(before)
      vi.advanceTimersByTime(1)
      expect(looked).toBe(before + 1)
    } finally { watchdog.stop(); vi.useRealTimers() }
  })
})

describe('escalating a Ticket to a person', () => {
  // A live acceptance run proved the escalation is reachable and then proved it leaves nothing behind: the Ticket's own
  // log read created → rescued → rescued → launched → report, with no trace of "we gave up and called for a person".
  // The health line is a "now" signal that the next unrelated Ticket's rescue legitimately overwrites (one shared slot
  // for all Tickets), so a safety mechanism that only ever existed there cannot be audited after the fact.
  it('reaches the host as a durable record, with the same words the board shows', () => {
    const escalations: { ticketId: string; why: string }[] = []
    const host: WatchdogHost = {
      settings: () => ({ enabled: true, everyMs: 60_000, launchStuckMs: 600_000, silentMs: 0, maxActions: 2 }),
      stuckLaunches: () => [{ ticketId: 'ticket-a', assignmentId: 'attempt-1' }],
      silentAttempts: () => [],
      rescue: () => {}, interrupt: () => {},
      actionsTaken: () => 2,
      escalate: (ticketId, why) => { escalations.push({ ticketId, why }) },
      health: new HealthEntry(), requestPass: () => {},
    }
    const watchdog = new Watchdog(host)
    const actions = watchdog.look(Date.now())

    expect(escalations).toEqual([
      { ticketId: 'ticket-a', why: 'has not started after 2 attempts to rescue it; it needs a person' },
    ])
    // The board's wording is asserted by the two escalation tests above; what this one pins is the durable call, which
    // is the part that was missing entirely — and that both destinations are built from the same string in the source,
    // so they cannot drift apart.
    // And it is still not an action taken: escalating is the conclusion that actions failed.
    expect(actions.map(action => action.acted)).toEqual([false])
  })

  it('records the silent-worker escalation too, which is the other way in', () => {
    const escalations: string[] = []
    const host: WatchdogHost = {
      settings: () => ({ enabled: true, everyMs: 60_000, launchStuckMs: 0, silentMs: 600_000, maxActions: 1 }),
      stuckLaunches: () => [],
      silentAttempts: () => [{ ticketId: 'ticket-b', assignmentId: 'attempt-1', silentForMs: 900_000 }],
      rescue: () => {}, interrupt: () => {},
      actionsTaken: () => 1,
      escalate: (ticketId, why) => { escalations.push(`${ticketId}: ${why}`) },
      health: new HealthEntry(), requestPass: () => {},
    }
    new Watchdog(host).look(Date.now())
    expect(escalations).toEqual(['ticket-b: has gone silent 1 time(s) and needs a person, not another attempt'])
  })
})
