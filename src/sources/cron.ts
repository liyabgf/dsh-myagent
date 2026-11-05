/**
 * The cron Source: the schedules the operator wrote become Triggers when they fire.
 *
 * A schedule is the written rule that authorizes its own work, so its Trigger names the operator as its actor and
 * still goes through the gate like any other. Each slot has a deterministic Trigger id, so a host that was down when
 * a slot passed creates one Ticket for it, not one per missed slot, and never twice.
 */
import { describeTiming, key, nextRun } from '../core/index.ts'
import { sourcePolicy, type Schedule } from '../core/policy.ts'
import type { Trigger } from '../core/model.ts'
import type { HealthEntry } from '../app/health.ts'
import type { Cursor, Source, SourceHost, SourceStatus } from './kind.ts'

/** What this Source remembers per schedule: the next slot, the last one fired, and how many it folded into it. */
type CursorState = Record<string, { next: number; last?: number; missed?: number; spec?: string }>

/**
 * The rule a remembered next run was computed from.
 *
 * Stored beside it because an edited schedule is a new rule: without this, editing a timing would leave the Source
 * waiting for a slot the operator no longer asked for, while the panel's preview — which computes the next run fresh —
 * showed the new one. The two would disagree, and the disagreement would only surface as work that never happens.
 */
const specOf = (schedule: Schedule): string => JSON.stringify(schedule.timing)

/** The longest one timer may sleep, so a clock jump or a missed wake-up costs at most this. */
const MAX_SLEEP_MS = 60_000
/** A slot this far behind is folded into one Trigger with a `missed` count instead of being replayed one by one. */
const FALL_BEHIND_MS = 5 * 60_000

export class CronSource implements Source {
  readonly id = 'cron'
  readonly kind = 'cron' as const
  private healthEntry?: HealthEntry
  private get health(): HealthEntry { return this.healthEntry ??= this.host.health.entry('source:cron') }
  private timer?: ReturnType<typeof setTimeout>
  private stopped = false
  private last: SourceStatus = { ok: true }
  private readonly counts = { accepted: 0, ignored: 0, observed: 0, duplicate: 0, unhandled: 0 }
  /**
   * How many slots the most recent firing dispositioned in a state this Source does not handle. Per firing, not
   * cumulative: a cumulative number on the board is a permanent alarm (S38/S41), whereas this one recurs on every
   * slot until the union and this Source agree again, and clears on the first firing that has none.
   */
  private unhandledNow = 0
  private lastTriggerAt?: string

  constructor(private readonly host: SourceHost) {}

  private get cursor(): Cursor { return this.host.cursor(this.id) }
  private state(): CursorState { return this.cursor.get<CursorState>() ?? {} }

  start(): void {
    this.reconcile()
    this.arm()
  }

  /** Look now: take an edited schedule into account, fire whatever is due, and re-arm. */
  poll(): void {
    this.reconcile()
    this.fire()
  }

  stop(): void {
    this.stopped = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
  }

  status(): SourceStatus { return this.last }

  /** Give every enabled schedule a next slot, and forget the schedules that are gone. */
  private reconcile(): void {
    const settings = this.host.settings()
    // A disabled Source keeps its read positions. Erasing them made "turn this Source off for a week" destroy every
    // slot that passed meanwhile, with no Trigger, no Decision and no `missed` count to show for it.
    if (!settings.sources.cron.enabled) {
      this.health.record('disabled')
      return
    }
    const schedules = settings.sources.cron.schedules.filter(schedule => schedule.enabled)
    const state = this.state()
    let changed = false
    let broken = false
    for (const id of Object.keys(state)) {
      if (!schedules.some(schedule => schedule.id === id)) { delete state[id]; changed = true }
    }
    for (const schedule of schedules) {
      const entry = state[schedule.id]
      const spec = specOf(schedule)
      if (entry !== undefined && Number.isFinite(entry.next) && entry.spec === spec) continue
      // An entry written before the rule was remembered has no `spec`. Its run is trusted and the rule recorded beside
      // it: recomputing instead would quietly drop the slots a downtime owed, which is the one thing a restart must not
      // do. Only a rule that is *known* to have changed makes the remembered run stale.
      if (entry !== undefined && Number.isFinite(entry.next) && entry.spec === undefined) {
        state[schedule.id] = { ...entry, spec }
        changed = true
        continue
      }
      const next = nextRun(schedule.timing, new Date())
      if (next === undefined) {
        this.health.problem(`Schedule ${schedule.id} never fires again: ${describeTiming(schedule.timing)}`)
        broken = true
        continue
      }
      // When is history, and stays history: when the schedule last fired does not depend on when it fires next.
      state[schedule.id] = { next, missed: 0, spec, ...(entry?.last === undefined ? {} : { last: entry.last }) }
      changed = true
    }
    if (changed) this.cursor.set(state)
    // An unrecognized disposition joins the same one-decision-at-the-end structure rather than reporting itself where
    // it happens: `record` clears whatever this part reported, so a `problem()` raised during `fireDue` would be
    // erased by the `arm()` that immediately follows it. That is the inbox defect fixed in the same round, and the
    // comment below is the rule both now follow.
    if (this.unhandledNow > 0) {
      // "in its most recent firing" is load-bearing wording, not decoration: `unhandledNow` is per firing while
      // `counts.unhandled` is cumulative, so after two firings the board says 1 and the count says 2. Two numbers that
      // disagree without saying why read as a bug to the person who has to act on them.
      this.health.problem(`${this.unhandledNow} schedule slot(s) in the most recent firing were dispositioned in a `
        + 'state this Source does not handle; nothing was executed for them, and the count says how many in total')
      broken = true
    }
    // `record` clears whatever this part reported, so a summary written after the loop would erase the problem the
    // loop just found — the one thing an unattended system must not do to its own alarm.
    if (!broken) this.health.record(schedules.length === 0 ? 'no schedule' : `${schedules.length} schedule(s)`)
  }

  /** Sleep until the earliest slot, at most {@link MAX_SLEEP_MS}, then fire what is due. */
  private arm(): void {
    if (this.stopped) return
    if (this.timer !== undefined) { clearTimeout(this.timer); this.timer = undefined }
    const settings = this.host.settings()
    if (!settings.sources.cron.enabled) {
      this.last = { ok: true, detail: 'disabled', counts: { ...this.counts } }
      return
    }
    this.reconcile()
    const state = this.state()
    const enabled = settings.sources.cron.schedules.filter(schedule => schedule.enabled)
    const due = enabled.flatMap(schedule => {
      const entry = state[schedule.id]
      return entry === undefined ? [] : [entry.next]
    })
    if (due.length === 0) {
      this.last = { ok: true, detail: enabled.length === 0 ? 'no enabled schedule' : 'no slot computed', counts: { ...this.counts } }
      return
    }
    const earliest = Math.min(...due)
    this.last = {
      ok: true, next: earliest, detail: `${enabled.length} schedule(s)`, lastTriggerAt: this.lastTriggerAt,
      counts: { ...this.counts },
    }
    this.timer = setTimeout(() => { void this.fire() }, Math.min(MAX_SLEEP_MS, Math.max(0, earliest - Date.now())))
    this.timer.unref?.()
  }

  private fire(): void {
    this.timer = undefined
    if (this.stopped) return
    try {
      this.fireDue()
    } catch (error) {
      const detail = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
      this.health.problem(detail)
      this.last = { ok: false, detail, counts: { ...this.counts } }
    }
    this.arm()
  }

  /** Produce a Trigger for every slot that has passed, folding the slots a downtime skipped into one. */
  private fireDue(): void {
    // Per firing, so the board line clears on the first firing that has none instead of accumulating into a permanent
    // alarm (S38/S41).
    this.unhandledNow = 0
    const settings = this.host.settings()
    const state = this.state()
    const now = Date.now()
    let changed = false
    // Paused or denied means "produce nothing", not "produce and be refused". A slot the gate refuses is consumed and
    // gone: that is what the global pause did to every schedule that fired while it was on, and it is the reason both
    // of these live here rather than in the gate. Denied differs from paused one level up — a pause also defers the
    // launch of work already accepted, a denial does not.
    const own = sourcePolicy('cron', settings)
    if (own.paused || own.deny) return
    for (const schedule of settings.sources.cron.schedules) {
      if (!settings.sources.cron.enabled || !schedule.enabled) continue
      const entry = state[schedule.id]
      if (entry === undefined || entry.next > now) continue
      const scheduledAt = entry.next
      // How many slots passed between the one that is due and now; they become one Trigger with a count.
      let missed = 0
      if (now - scheduledAt > FALL_BEHIND_MS) {
        let cursor = scheduledAt
        for (; missed < 10_000; missed++) {
          const following = nextRun(schedule.timing, new Date(cursor))
          if (following === undefined || following > now) break
          cursor = following
        }
      }
      const at = new Date(scheduledAt).toISOString()
      const trigger: Trigger = {
        id: key('cron', schedule.id, at),
        source: this.id, kind: 'cron', at,
        // The operator wrote this schedule, so the operator is who asks for the work.
        actor: { id: 'operator', kind: 'person' },
        text: schedule.prompt,
        title: schedule.name === '' ? schedule.prompt.slice(0, 80) : schedule.name,
        meta: {
          schedule: schedule.id, scheduledAt: at,
          ...(missed > 0 ? { missed } : {}),
          ...(schedule.scope === '' ? {} : { scope: schedule.scope }),
        },
      }
      const result = this.host.engine.receive(trigger)
      // Exhaustive, with the unknown state counted as itself. Precedence is unchanged: `accepted` and `observed` are
      // decided BEFORE `stored === 'duplicate'`, so a duplicate of an accepted slot still counts `accepted` — a slot
      // that fired twice is two accepted slots, and `sources.spec.ts` pins that. What changes is the tail: a state
      // this Source does not know used to be counted as `ignored`, which says "the gate refused this" when in fact
      // the gate's answer was not recognized. Neither `pending` (no producer in src/) nor `lost` (`Engine.receive`
      // re-runs the gate for a stored `lost` row, so it can never return one) reaches here today; the union is closed
      // only by its declaration, so a future member would, and it would have been counted as a refusal.
      // Not named `state`: `fireDue` already has a `const state = this.state()` and shadowing it in the loop body is
      // a typecheck error, not a style choice.
      const answered = result.disposition.state
      const bucket = answered === 'accepted' ? 'accepted'
        : answered === 'observed' ? 'observed'
          : result.stored === 'duplicate' ? 'duplicate'
            : answered === 'ignored' ? 'ignored'
              : 'unhandled'
      this.counts[bucket]++
      if (bucket === 'unhandled') this.unhandledNow++
      this.lastTriggerAt = at
      const following = missed > 0
        ? nextRun(schedule.timing, new Date(now))
        : nextRun(schedule.timing, new Date(scheduledAt))
      entry.last = scheduledAt
      entry.missed = missed
      if (following === undefined) {
        // The next occurrence is beyond the horizon `nextRun` searches (a Feb-29 rule gaps 1461 days). Synthesizing a
        // slot a minute out would give it a fresh `at`, hence a fresh Trigger id, hence a new accepted Ticket every
        // minute forever — with a health board that reads clean, because the entry still looks finite. Dropping the
        // entry is what makes reconcile's "never fires again" branch reachable and arms no timer.
        delete state[schedule.id]
      } else {
        entry.next = following
        state[schedule.id] = entry
      }
      changed = true
      this.host.requestPass()
    }
    if (changed) this.cursor.set(state)
  }
}

export const cronKind = { name: 'cron' as const, create: (host: SourceHost): Source => new CronSource(host) }
