/**
 * The Effects queue: every side effect that must survive a restart, and must not happen twice.
 *
 * A launch, an Input delivery and a notification all pass through here. Rows live in the Store, so a crash leaves the
 * work queued rather than lost, and the identity of `(kind, key)` makes a repeated enqueue replace the pending row
 * instead of adding a second one.
 */
import type { HealthEntry } from './health.ts'
import type { Store } from './store.ts'

/** Thrown by a handler whose work is not runnable yet; the effect is deferred without counting a failure. */
export class Later extends Error {
  constructor(readonly retryAfterMs: number = 5000) {
    super('deferred')
    this.name = 'Later'
  }
}

/** What a handler does with one payload: settle it, defer it with `Later`, or fail it by throwing. */
export type EffectHandler = (payload: unknown) => void | Promise<void> | Later

export interface EffectOutcome {
  readonly status: 'ok' | 'later' | 'failed' | 'permanent'
  readonly error?: Error
}

export interface EffectsOptions {
  /** How far a retry may be deferred; a failure backs off exponentially up to this. */
  readonly backoffMs?: number
  /** Attempts before a failure becomes permanent; a `Later` never counts against it. */
  readonly tries?: number
  /** The interval a `Later` without its own wait uses. */
  readonly retryIntervalMs?: number
  /** Called when an effect gives up, so the Ticket can show it instead of retrying forever. */
  readonly onPermanentFailure?: (kind: string, key: string, payload: unknown, error: unknown) => void
  /** The health entry failures are recorded on. */
  readonly health?: HealthEntry
  /** Ends every wait when the host stops. */
  readonly lifetime?: AbortSignal
}

const text = (error: unknown): string => error instanceof Error ? `${error.name}: ${error.message}` : String(error)

/** The identity of one queued row, which is what a complaint is remembered by until the row is gone. */
const rowId = (kind: string, key: string): string => `${kind}\u0000${key}`

/**
 * What the health entry says when a pass is evidence that the queue is fine.
 *
 * Count-free on purpose. This queue is handed a deliberately narrow slice of the Store, in which
 * `pendingEffects(kind, key)` answers "is this one row still queued" and nothing answers "how many are" — and that
 * slice is what the queue is allowed to touch, so widening it to put a number in one summary line would trade a
 * sentence for a capability no other line of this file needs. The sentence is strictly true in every state the queue
 * can be in, including a restart that left failing rows queued: nothing failed in *this* pass.
 */
const QUIET = 'no effect failed in this pass'

/** How long to wait before the next attempt after `failures` of them: 15 s, 30 s, 60 s, then the backoff cap. */
export function backoff(failures: number, capMs: number): number {
  return Math.min(capMs, 15_000 * 2 ** Math.max(0, failures - 1))
}

export class Effects {
  private readonly handlers = new Map<string, EffectHandler>()
  private running: Promise<void> | undefined
  private readonly backoffMs: number
  private readonly tries: number
  private readonly retryIntervalMs: number
  private readonly onPermanentFailure?: (kind: string, key: string, payload: unknown, error: unknown) => void
  private readonly health?: HealthEntry
  private readonly lifetime?: AbortSignal
  private disposed = false
  /** Set by a failure in the pass now running, so that pass cannot end by erasing what it just reported. */
  private complained = false
  /**
   * The rows this queue has reported a failure for, kept until the row behind each is gone.
   *
   * The pass flag alone is not enough, and the reason is measured rather than tasted: a failure defers its row into a
   * 15 s backoff, so the pass after it claims nothing and is "quiet" in the sense that flag measures. Summarizing from
   * such a pass would erase the line about work that has already failed once and is still queued to fail again — a
   * false all-clear in place of the false alarm this removes. A row that is still in the queue is a problem that is
   * not over, and `pendingEffects` is the port's own answer to "is it still there".
   */
  private readonly unresolved = new Set<string>()

  constructor(private readonly store: Pick<Store, 'enqueueEffect' | 'claimEffects' | 'settleEffect' | 'failEffect' | 'deferEffect' | 'pendingEffects'>, options: EffectsOptions = {}) {
    this.backoffMs = options.backoffMs ?? 15 * 60_000
    this.tries = options.tries ?? 5
    this.retryIntervalMs = options.retryIntervalMs ?? 15_000
    this.onPermanentFailure = options.onPermanentFailure
    this.health = options.health
    this.lifetime = options.lifetime
  }

  /** The handler of one kind of effect; registering twice replaces the handler. */
  handle(kind: string, handler: EffectHandler): void { this.handlers.set(kind, handler) }

  /** Queue one effect, or replace the pending one of the same identity. */
  enqueue(kind: string, key: string, payload: unknown, runAt?: Date): void {
    this.store.enqueueEffect(kind, key, payload, runAt?.getTime() ?? Date.now())
  }

  pending(kind: string, key: string): boolean { return this.store.pendingEffects(kind, key) }

  /**
   * Run what is due, one pass at a time: a pass already running owns the queue, and a pass asked for during it runs
   * once more after it, so a caller never waits behind an unrelated pass.
   */
  async runDue(): Promise<void> {
    if (this.disposed || this.running !== undefined) return
    const pass = (async () => {
      this.complained = false
      do {
        let again = false
        for (const kind of [...this.handlers.keys()]) {
          if (this.disposed) return
          for (const row of this.store.claimEffects(kind, 50)) {
            // The loop runs over the registered kinds, so a handler exists by construction.
            const outcome = await this.settle(kind, row.key, row.payload, row.failures, this.handlers.get(kind)!)
            if (outcome.status !== 'ok') again = true
          }
        }
        // A retry that became due during this pass is taken in the same one, so no work waits a whole interval.
        if (!again) break
      } while (!this.disposed)
      // A pass is the unit this queue can speak for, so the summary belongs at its end and nowhere else: `record`
      // is the only thing that clears a problem (`health.ts:16-19`), and until this line existed nothing ever called
      // it on this entry — so a notify that failed twice and then succeeded kept `notify failed 2 of 5 times` on the
      // board, and `refresh()` kept reporting a problem, for the rest of the process's life. Guarded on `disposed`
      // because a shutdown is not evidence that anything works.
      if (!this.disposed) this.summarize()
    })()
    this.running = pass
    try { await pass } finally { if (this.running === pass) this.running = undefined }
  }

  /**
   * One problem on this queue's own health entry, remembered as unresolved.
   *
   * Every `problem` call in this file goes through here: a summary written at the end of a pass that did not know what
   * failed in it erases the failure in the same pass that found it, which is how the cron Source used to hide its own
   * alarm (`sources/rule.ts:101-103` states the same rule for the same reason).
   */
  private complain(kind: string, key: string, detail: string): void {
    this.complained = true
    this.unresolved.add(rowId(kind, key))
    this.health?.problem(detail)
  }

  /**
   * Say that the queue is fine, when this pass is evidence of it: nothing failed in it, and nothing it reported a
   * failure for earlier is still queued. The second half is what keeps the line honest in both directions — a
   * give-up settles its row, so the pass after it clears the board by itself and no permanent alarm survives, while a
   * row still backing off keeps its line until the attempt that resolves it.
   */
  private summarize(): void {
    if (this.complained) return
    for (const id of [...this.unresolved]) {
      const cut = id.indexOf('\u0000')
      if (this.store.pendingEffects(id.slice(0, cut), id.slice(cut + 1))) return
      this.unresolved.delete(id)
    }
    this.health?.record(QUIET)
  }

  private async settle(kind: string, key: string, payload: unknown, failures: number, handler: EffectHandler): Promise<EffectOutcome> {
    try {
      const result = await handler(payload)
      if (result instanceof Later) {
        this.store.deferEffect(kind, key, Date.now() + result.retryAfterMs)
        return { status: 'later' }
      }
      this.store.settleEffect(kind, key)
      return { status: 'ok' }
    } catch (error) {
      // `Later` is thrown, not returned — its own doc says "deferred without counting a failure", and every call site
      // throws it. Counting a deferral as a failure killed Tickets that were merely waiting: a note added to a Ticket
      // that waits for a person, a pause, or a launch queued behind full worker slots for longer than the backoff
      // budget, each ended up as a permanent failure four minutes later.
      if (error instanceof Later) {
        this.store.deferEffect(kind, key, Date.now() + error.retryAfterMs)
        return { status: 'later' }
      }
      const next = failures + 1
      if (next >= this.tries) {
        this.store.settleEffect(kind, key)
        this.complain(kind, key, text(error))
        try { this.onPermanentFailure?.(kind, key, payload, error) }
        catch (hookError) { this.complain(kind, key, `The permanent-failure hook of ${kind} failed: ${text(hookError)}`) }
        return { status: 'permanent', error: error instanceof Error ? error : new Error(text(error)) }
      }
      this.store.failEffect(kind, key, Date.now() + backoff(next, this.backoffMs))
      this.complain(kind, key, `${kind} failed ${next} of ${this.tries} times: ${text(error)}`)
      return { status: 'failed', error: error instanceof Error ? error : new Error(text(error)) }
    }
  }

  /** Stop the pump; queued rows stay in the Store for the next start. */
  dispose(): void { this.disposed = true }
}
