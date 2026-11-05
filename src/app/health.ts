/**
 * Health: one line per part that can go wrong, so the panel shows a problem where it happened instead of a stack
 * trace somewhere else. A healthy part takes no space.
 */

/** What one part reports about itself. */
export interface HealthState {
  readonly ok: boolean
  readonly detail?: string
  readonly at?: string
}

/** One part's health, written by that part and read by the panel. */
export class HealthEntry {
  private state: HealthState = { ok: true }
  /** Record that this part works, clearing any problem it reported. */
  record(detail?: string): void { this.state = { ok: true, detail, at: new Date().toISOString() } }
  /** Record what is wrong now; the problem stays until this part records success again. */
  problem(detail: string): void { this.state = { ok: false, detail, at: new Date().toISOString() } }
  snapshot(): HealthState { return this.state }
}

/** The health of every part that reports one, keyed by the name the panel shows. */
export class HealthBoard {
  private readonly entries = new Map<string, HealthEntry>()
  entry(name: string): HealthEntry {
    let entry = this.entries.get(name)
    if (entry === undefined) { entry = new HealthEntry(); this.entries.set(name, entry) }
    return entry
  }
  /** Every part that is not ok; an empty list is the healthy state the panel does not render. */
  problems(): { readonly name: string; readonly detail: string; readonly at?: string }[] {
    return [...this.entries]
      .map(([name, entry]) => ({ name, state: entry.snapshot() }))
      .filter(({ state }) => !state.ok)
      .map(({ name, state }) => ({ name, detail: state.detail ?? '', at: state.at }))
  }
  snapshot(): Record<string, HealthState> {
    return Object.fromEntries([...this.entries].map(([name, entry]) => [name, entry.snapshot()]))
  }
}
