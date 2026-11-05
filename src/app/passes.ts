/**
 * Passes: the pump that runs what is due, one pass at a time.
 *
 * A pass runs the due effects and then any extra work registered for it. A pass asked for while one is running does
 * not start a second — it is remembered and run once more after, so a command that queued work never waits a whole
 * interval, and two passes never race over the same row.
 */
import type { Effects } from './effects.ts'
import type { HealthEntry } from './health.ts'

export interface PassesOptions {
  readonly effects: Pick<Effects, 'runDue'>
  /** Extra work each pass runs after the effects, such as a Source's own due check. */
  readonly extra?: readonly (() => void | Promise<void>)[]
  readonly intervalMs?: number
  readonly health?: HealthEntry
  readonly lifetime?: AbortSignal
  readonly onPassError?: (error: unknown) => void
}

export class Passes {
  private timer?: ReturnType<typeof setInterval>
  private running = false
  private asked = false
  private stopped = false
  private readonly intervalMs: number
  private readonly extra: readonly (() => void | Promise<void>)[]
  /** Set while a pass runs, so a shutdown can wait for it. */
  private current?: Promise<void>

  constructor(private readonly options: PassesOptions) {
    this.intervalMs = options.intervalMs ?? 2000
    this.extra = options.extra ?? []
  }

  start(): void {
    if (this.stopped || this.timer !== undefined) return
    this.timer = setInterval(() => { void this.pass() }, this.intervalMs)
    // A timer must not hold the process open on its own.
    this.timer.unref?.()
  }

  /** Ask for a pass now; during one, it runs once more after it instead of starting a second. */
  requestPass(): void {
    if (this.stopped) return
    if (this.running) { this.asked = true; return }
    void this.pass()
  }

  private async pass(): Promise<void> {
    if (this.running || this.stopped) return
    this.running = true
    const pass = (async () => {
      do {
        this.asked = false
        try {
          await this.options.effects.runDue()
          for (const work of this.extra) await work()
          this.options.health?.record()
        } catch (error) {
          this.options.health?.problem(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
          this.options.onPassError?.(error)
        }
      } while (this.asked && !this.stopped)
    })()
    this.current = pass
    try { await pass } finally { this.running = false; this.current = undefined }
  }

  /** Stop the pump and wait for a pass in flight, at most `timeoutMs`. */
  async stop(timeoutMs = 10_000): Promise<void> {
    this.stopped = true
    if (this.timer !== undefined) { clearInterval(this.timer); this.timer = undefined }
    const current = this.current
    if (current === undefined) return
    await Promise.race([current, new Promise(resolve => setTimeout(resolve, timeoutMs))])
  }
}
