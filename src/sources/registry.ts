/**
 * The Source registry: one running instance per kind, recreated when the settings it reads change.
 *
 * A Source's read position lives in the Store, so recreating an instance costs nothing but a timer, and an edited
 * schedule takes effect without a restart of the plugin.
 */
import type { Settings } from '../core/policy.ts'
import type { SourceKindName } from '../core/model.ts'
import type { Source, SourceHost, SourceKind, SourceStatus } from './kind.ts'

/** The part of the settings each kind reads; a change to it recreates that Source. */
function signatureOf(kind: SourceKindName, settings: Settings): string {
  // Indexed, not a chain with a fallthrough. The chain sent `rule` to the session block, which meant the two Sources
  // shared one signature: changing either recreated both, and changing a rule recreated nothing. This is the third
  // place the same three-kind enumeration went wrong when a fourth kind arrived.
  return JSON.stringify(settings.sources[kind])
}

export class SourceRegistry {
  private readonly running = new Map<string, Source>()
  private readonly signatures = new Map<string, string>()
  private syncing: Promise<void> | undefined

  constructor(private readonly host: SourceHost, private readonly kinds: readonly SourceKind[]) {}

  /** Start what is not running, and replace what reads different settings than it was started with. */
  async sync(): Promise<void> {
    // One sync at a time. Two overlapping syncs both see the same running Source for a kind whose signature changed,
    // both stop it, and both create a replacement; the second `running.set` then overwrites the first, which orphans a
    // Source that has already started — timer armed, unreachable from `stop()`, polling a Store that has been closed.
    // That orphan is what produced 40 unhandled `database is not open` errors across the suite, and it would keep
    // reading settings from a closed database in production too.
    while (this.syncing !== undefined) await this.syncing
    const run = this.syncNow()
    this.syncing = run
    try {
      await run
    } finally {
      if (this.syncing === run) this.syncing = undefined
    }
  }

  private async syncNow(): Promise<void> {
    const settings = this.host.settings()
    for (const kind of this.kinds) {
      const signature = signatureOf(kind.name, settings)
      const existing = this.running.get(kind.name)
      if (existing !== undefined && this.signatures.get(kind.name) === signature) continue
      if (existing !== undefined) {
        await existing.stop()
        this.running.delete(kind.name)
        this.signatures.delete(kind.name)
      }
      try {
        const source = kind.create(this.host)
        // Recorded only once `start()` has resolved: a Source that threw while starting must be retried by the next
        // sync, not remembered as running. And one broken Source must not stop the rest from being created — the loop
        // used to abort, so a bad schedule in cron left inbox and session unmounted with a 200 from the settings save.
        await source.start()
        this.running.set(kind.name, source)
        this.signatures.set(kind.name, signature)
      } catch (error) {
        this.host.health.entry(`source:${kind.name}`)
          .problem(error instanceof Error ? `${error.name}: ${error.message}` : String(error))
      }
    }
  }

  /** Stop every Source; their read positions stay stored. */
  /** Ask every running Source to look now, and wait for the ones that do. */
  async nudge(): Promise<void> {
    for (const source of this.running.values()) await source.poll?.()
  }

  async stop(): Promise<void> {
    for (const source of this.running.values()) {
      try { await source.stop() } catch { /* a Source that will not stop must not hold the shutdown */ }
    }
    this.running.clear()
    this.signatures.clear()
  }

  source(id: string): Source | undefined { return this.running.get(id) }

  /** Every Source's own report of itself, for the panel. */
  status(): Record<string, SourceStatus> {
    return Object.fromEntries([...this.running].map(([id, source]) => [id, source.status()]))
  }
}
