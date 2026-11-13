/**
 * The part that notices work has stopped moving.
 *
 * Everything the Watchdog does is an action that already existed and was already tested — interrupting an attempt,
 * which opens a fresh one with a recovery note — so this file adds judgement, not new ways to change state. That is
 * deliberate: an unattended system whose recovery path is also unattended needs every step of it to be something a
 * person has already seen work.
 *
 * Its memory of what it has already done to a Ticket is the Ticket's own event log, not a field of its own. A restart
 * therefore cannot make it forget and act twice, and "why did this Ticket get interrupted three times" is answerable
 * from the same place the operator already reads.
 */
import type { HealthEntry } from './health.ts'

/** What one look found and did. Returned so a test can assert the judgement rather than only its side effects. */
export interface WatchdogAction {
  readonly ticketId: string
  readonly assignmentId: string
  readonly why: string
  readonly acted: boolean
}

/** Everything the Watchdog may touch. It cannot reach the Store, the Sessions or the Sources. */
export interface WatchdogHost {
  settings(): { enabled: boolean; everyMs: number; launchStuckMs: number; silentMs: number; maxActions: number }
  /** Launches that began this long ago or earlier and never produced a Session, as Ticket and attempt. */
  stuckLaunches(olderThanMs: number, now: number): { ticketId: string; assignmentId: string }[]
  /**
   * Rescue a launch that never produced a Session: forget it and queue it again.
   *
   * Not `assignmentInterrupted`, which only acts on a *running* attempt and would be a silent no-op here — the attempt
   * this rescues has never started, which is the whole problem.
   */
  rescue(ticketId: string, assignmentId: string, why: string): void
  /** Attempts that are running but whose Session has produced nothing for at least this long. */
  silentAttempts(olderThanMs: number, now: number): { ticketId: string; assignmentId: string; silentForMs: number }[]
  /**
   * 【操作者决定 G-5】Make a silent attempt VISIBLE: a decision in the operator's queue plus a health line.
   *
   * Interrupting is deliberately NOT offered here — the operator's own words were "打不打断是操作者的事": a worker
   * that has been quiet for ten minutes might be stuck, or might be doing exactly the long quiet compute it was asked
   * to do, and those two shapes cannot be told apart by a timer. The report says "this one has been silent for N
   * minutes"; what to do about it (the task's stop button, or nothing) stays a person's call.
   */
  reportSilent(ticketId: string, assignmentId: string, silentForMinutes: number): void
  /** How many times the Watchdog has already acted on this Ticket, read from its own log. */
  actionsTaken(ticketId: string): number
  /**
   * Record durably that this Ticket has been escalated to a person.
   *
   * The health line is not enough and a live run proved it: the escalation appeared, was silently overwritten by an
   * unrelated Ticket's rescue (one shared slot for all Tickets), went stale for 14.5 minutes while `look()` kept
   * firing, and left nothing behind — the Ticket's own event log read `created → rescued → rescued → launched → report`
   * with no trace of "we gave up and called for a person". A safety mechanism that cannot be audited after the fact is
   * a safety mechanism nobody can trust, and "needs a person" is the one thing here that most needs to be findable.
   */
  escalate(ticketId: string, why: string): void
  health: HealthEntry
  /** Ask for a pass, so whatever the interruption queued is picked up now rather than up to one interval later. */
  requestPass(): void
}

export class Watchdog {
  private timer: NodeJS.Timeout | undefined
  private stopped = false
  /** The interval the running timer was armed with, so a settings change can tell "different" from "same". */
  private armedEveryMs = 0
  /** Attempts already reported silent, so the operator's queue hears it once, not every pass. */
  private reportedSilence = new Set<string>()

  /**
   * The interval the running timer is actually on.
   *
   * Exposed because "did the settings change take effect?" is otherwise unanswerable from outside: the timer is
   * private, and a live run had to infer the answer from a rescue landing on the old grid to within 23ms. An
   * introspection read is cheaper than that inference, and it is what a test can assert on directly.
   */
  armedInterval(): number { return this.armedEveryMs }

  constructor(private readonly host: WatchdogHost) {}

  start(): void {
    this.stopped = false
    this.arm()
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  /** One look. Called by the timer, and directly by a test that does not want to wait for one. */
  look(now = Date.now()): WatchdogAction[] {
    const settings = this.host.settings()
    if (!settings.enabled) return []
    const actions: WatchdogAction[] = []
    if (settings.launchStuckMs > 0) actions.push(...this.rescueStuck(settings, now))
    if (settings.silentMs > 0) actions.push(...this.reportSilent(settings, now))
    if (actions.some(action => action.acted)) this.host.requestPass()
    return actions
  }

  /** Launches that never produced a Session: forget them and queue them again. */
  private rescueStuck(settings: { launchStuckMs: number; maxActions: number }, now: number): WatchdogAction[] {
    const actions: WatchdogAction[] = []
    for (const stuck of this.host.stuckLaunches(settings.launchStuckMs, now)) {
      const taken = this.host.actionsTaken(stuck.ticketId)
      // A Ticket the Watchdog has already tried to rescue this many times is not stuck in launch: something about it
      // does not work, and interrupting it again would just produce another attempt that fails the same way. From here
      // it is a person's, which is what the health line is for.
      if (taken >= settings.maxActions) {
        // The same words go to the log and to the board, so the durable record and the transient signal cannot drift
        // apart — and the board's wording stays exactly as it was, because an acceptance report quotes it verbatim.
        const escalated = `has not started after ${taken} attempts to rescue it; it needs a person`
        this.host.escalate(stuck.ticketId, escalated)
        this.host.health.problem(`Ticket ${stuck.ticketId.slice(0, 8)} ${escalated}`)
        actions.push({ ...stuck, why: `already acted ${taken} time(s)`, acted: false })
        continue
      }
      const why = `its worker never came up within ${Math.round(settings.launchStuckMs / 1000)}s`
      try {
        this.host.rescue(stuck.ticketId, stuck.assignmentId, why)
        this.host.health.record(`${actions.length + 1} stuck launch(es) rescued`)
        actions.push({ ...stuck, why, acted: true })
      } catch (error) {
        // The rescue failed, which is worth more than the stuck launch was: say both.
        this.host.health.problem(
          `Could not rescue Ticket ${stuck.ticketId.slice(0, 8)}: ${error instanceof Error ? error.message : String(error)}`)
        actions.push({ ...stuck, why, acted: false })
      }
    }
    return actions
  }

  /**
   * Attempts that are running but have said nothing for `silentMs`: report them, do not touch them.
   * 【操作者决定 G-5】Ten minutes of silence makes it visible; interruption belongs to the operator.
   */
  private reportSilent(settings: { silentMs: number }, now: number): WatchdogAction[] {
    const actions: WatchdogAction[] = []
    for (const silent of this.host.silentAttempts(settings.silentMs, now)) {
      const minutes = Math.round(silent.silentForMs / 60_000)
      // Reported ONCE per attempt: the queue is where the operator decides, and the same decision every
      // `everyMs` is an alarm that trains its reader to ignore it. The in-memory set covers the common case;
      // a restart re-reports once, and the runtime's queue check keeps the repeat from landing while the first
      // still sits undismissed.
      if (this.reportedSilence.has(silent.assignmentId)) continue
      // C03: add to dedupe set only AFTER a successful report, not before. If reportSilent()
      // throws (e.g. the decision queue is unavailable), the assignment would be permanently
      // skipped on subsequent looks even though the operator was never actually told.
      this.host.reportSilent(silent.ticketId, silent.assignmentId, minutes)
      this.reportedSilence.add(silent.assignmentId)
      actions.push({ ...silent, why: `its worker said nothing for ${minutes} minute(s)`, acted: false })
    }
    return actions
  }

  /**
   * Take a settings change into account.
   *
   * Re-arming on every refresh would be worse than never re-arming: refresh runs on every event and every pass, so the
   * clock would reset continuously and the Watchdog would never look at anything. Hence the comparison — only a
   * genuinely different interval moves the timer.
   */
  settingsChanged(): void {
    if (this.stopped) return
    if (this.host.settings().everyMs === this.armedEveryMs) return
    this.arm()
  }

  private arm(): void {
    if (this.stopped) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    const { everyMs } = this.host.settings()
    this.armedEveryMs = everyMs
    this.timer = setTimeout(() => {
      try { this.look() } catch (error) {
        this.host.health.problem(`The watchdog could not look: ${error instanceof Error ? error.message : String(error)}`)
      }
      this.arm()
    }, everyMs)
    // A timer must not hold the process open on its own.
    this.timer.unref?.()
  }
}
