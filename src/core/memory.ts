/**
 * The Engine's repositories and transaction in memory, for domain tests.
 * Records are immutable, so a shallow copy of each map is a complete snapshot: a rolled-back command restores them
 * and drops the work the command registered, exactly as a database rollback would.
 */
import type { Decision } from './model.ts'
import type { Artifact, Dependency, Project, Thread, Ticket, TicketEvent, Trigger, Work } from './model.ts'
import type { DecisionRecord, Repositories, TicketRepository, Transaction, TriggerRecord, TriggerRepository } from './engine.ts'
import type { ArtifactRepository, DecisionRepository, DependencyRepository, EventRepository, ProjectRepository, ThreadRepository, WorkRepository } from './engine.ts'

class TriggerStore implements TriggerRepository {
  readonly records = new Map<string, TriggerRecord>()
  get(id: string): TriggerRecord | undefined { return this.records.get(id) }
  save(record: TriggerRecord): void { this.records.set(record.trigger.id, record) }
  list(): TriggerRecord[] { return [...this.records.values()] }
  snapshot(): Map<string, TriggerRecord> { return new Map(this.records) }
  restore(snapshot: Map<string, TriggerRecord>): void { this.records.clear(); for (const [id, record] of snapshot) this.records.set(id, record) }
}

class DependencyStore implements DependencyRepository {
  readonly records = new Map<string, Dependency>()
  private keyOf(upstream: string, downstream: string): string { return `${upstream}\u0000${downstream}` }
  save(dependency: Dependency): void { this.records.set(this.keyOf(dependency.upstream, dependency.downstream), dependency) }
  delete(upstream: string, downstream: string): void { this.records.delete(this.keyOf(upstream, downstream)) }
  upstreamOf(downstream: string): Dependency[] { return this.list().filter(edge => edge.downstream === downstream) }
  downstreamOf(upstream: string): Dependency[] { return this.list().filter(edge => edge.upstream === upstream) }
  list(): Dependency[] { return [...this.records.values()] }
  snapshot(): Map<string, Dependency> { return new Map(this.records) }
  restore(snapshot: Map<string, Dependency>): void { this.records.clear(); for (const [key, value] of snapshot) this.records.set(key, value) }
}

class EventStore implements EventRepository {
  readonly records: TicketEvent[] = []
  append(event: Omit<TicketEvent, 'seq'>): TicketEvent {
    const seq = this.records.filter(record => record.ticketId === event.ticketId).length + 1
    const stored: TicketEvent = { ...event, seq }
    this.records.push(stored)
    return stored
  }
  list(ticketId: string): TicketEvent[] { return this.records.filter(record => record.ticketId === ticketId) }
  snapshot(): TicketEvent[] { return [...this.records] }
  restore(snapshot: TicketEvent[]): void { this.records.length = 0; this.records.push(...snapshot) }
}

class ProjectStore implements ProjectRepository {
  readonly records = new Map<string, Project>()
  save(project: Project): void { this.records.set(project.id, project) }
  get(id: string): Project | undefined { return this.records.get(id) }
  list(): Project[] { return [...this.records.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) }
  remove(id: string): void { this.records.delete(id) }
  snapshot(): Map<string, Project> { return new Map(this.records) }
  restore(snapshot: Map<string, Project>): void { this.records.clear(); for (const [id, record] of snapshot) this.records.set(id, record) }
}

class WorkStore implements WorkRepository {
  readonly records = new Map<string, Work>()
  save(work: Work): void { this.records.set(work.id, work) }
  get(id: string): Work | undefined { return this.records.get(id) }
  list(): Work[] { return [...this.records.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt)) }
  byProject(projectId: string | undefined): Work[] { return this.list().filter(work => work.projectId === projectId) }
  remove(id: string): void { this.records.delete(id) }
  snapshot(): Map<string, Work> { return new Map(this.records) }
  restore(snapshot: Map<string, Work>): void { this.records.clear(); for (const [id, record] of snapshot) this.records.set(id, record) }
}

class TicketStore implements TicketRepository {
  readonly records = new Map<string, Ticket>()
  get(id: string): Ticket | undefined { return this.records.get(id) }
  save(ticket: Ticket): void { this.records.set(ticket.id, ticket) }
  // Tombstones are hidden from every listing — the panel's, `myagent_list_tickets`, the Work's — while `get` still
  // resolves them, so a note or an artifact that points at a deleted Ticket reads "deleted" instead of failing.
  // A tombstone nobody can read is not an audit trail, so `deleted()` exists for the view that shows them.
  list(): Ticket[] { return [...this.records.values()].filter(ticket => ticket.deleted === undefined) }
  deleted(): Ticket[] { return [...this.records.values()].filter(ticket => ticket.deleted !== undefined) }
  remove(id: string): void { this.records.delete(id) }
  open(): Ticket[] {
    return this.list().filter(ticket => ticket.ended === undefined).sort((a, b) => a.createdAt.localeCompare(b.createdAt))
  }
  byWork(workId: string): Ticket[] {
    return this.list().filter(ticket => ticket.workId === workId).sort((a, b) => (a.workSeq ?? 0) - (b.workSeq ?? 0))
  }
  snapshot(): Map<string, Ticket> { return new Map(this.records) }
  restore(snapshot: Map<string, Ticket>): void { this.records.clear(); for (const [id, ticket] of snapshot) this.records.set(id, ticket) }
}

class DecisionStore implements DecisionRepository {
  readonly records = new Map<string, DecisionRecord>()
  get(id: string): DecisionRecord | undefined { return this.records.get(id) }
  save(decision: Decision): void { this.records.set(decision.id, decision) }
  list(limit = 200): DecisionRecord[] {
    const all = [...this.records.values()].sort((a, b) => b.at.localeCompare(a.at))
    return all.slice(0, limit)
  }
  snapshot(): Map<string, DecisionRecord> { return new Map(this.records) }
  restore(snapshot: Map<string, DecisionRecord>): void { this.records.clear(); for (const [id, record] of snapshot) this.records.set(id, record) }
}

class ArtifactStore {
  private readonly records = new Map<string, Artifact>()
  save(artifact: Artifact): void { this.records.set(`${artifact.ticketId}\u0000${artifact.path}`, artifact) }
  list(ticketId: string): Artifact[] {
    return [...this.records.values()]
      .filter(artifact => artifact.ticketId === ticketId)
      .sort((left, right) => left.at.localeCompare(right.at))
  }
  snapshot(): Map<string, Artifact> { return new Map(this.records) }
  restore(snapshot: Map<string, Artifact>): void { this.records.clear(); for (const [key, value] of snapshot) this.records.set(key, value) }
}

/** In-memory Thread store for tests. */
class ThreadStore implements ThreadRepository {
  private readonly records = new Map<string, Thread>()
  get(key: string): Thread | undefined { return this.records.get(key) }
  save(thread: Thread): void { this.records.set(thread.key, thread) }
  list(): Thread[] { return [...this.records.values()] }
}

/** In-memory {@link Repositories} and {@link Transaction} with the same commit and rollback behaviour as the Store. */
export class Memory implements Repositories, Transaction {
  private readonly triggerStore = new TriggerStore()
  private readonly ticketStore = new TicketStore()
  private readonly decisionStore = new DecisionStore()
  private readonly artifactStore = new ArtifactStore()
  private readonly projectStore = new ProjectStore()
  private readonly workStore = new WorkStore()
  private readonly eventStore = new EventStore()
  private readonly dependencyStore = new DependencyStore()
  private queue: (() => void)[] = []
  private depth = 0
  /** Deferred actions that threw, newest last. The same field the Store keeps, so both are inspectable alike. */
  readonly deferredFailures: { at: string; message: string }[] = []
  onDeferredError?: (error: unknown) => void

  readonly triggers: TriggerRepository = this.triggerStore
  readonly tickets: TicketRepository = this.ticketStore
  readonly decisions: DecisionRepository = this.decisionStore
  readonly artifacts: ArtifactRepository = this.artifactStore
  readonly projects: ProjectRepository = this.projectStore
  readonly works: WorkRepository = this.workStore
  readonly events: EventRepository = this.eventStore
  private readonly threadStore = new ThreadStore()
  readonly dependencies: DependencyRepository = this.dependencyStore
  readonly threads: ThreadRepository = this.threadStore

  /**
   * Structurally identical to `Store.atomic`, on purpose: every domain test runs on this class, so a divergence here
   * is a suite that stays green while production behaves differently. `tests/transaction.spec.ts` runs the same
   * assertions against both, which is what keeps the two from drifting apart again.
   */
  atomic<T>(run: () => T): T {
    const outermost = this.depth === 0
    // Snapshotted at every depth, not only the outermost: `Store` answers a nested failure with `ROLLBACK TO`, which
    // undoes the inner writes. Snapshotting only at depth 0 kept them, so a nested rollback tested as a no-op.
    const snapshots = [
      this.triggerStore.snapshot(), this.ticketStore.snapshot(), this.decisionStore.snapshot(), this.artifactStore.snapshot(),
      this.projectStore.snapshot(), this.workStore.snapshot(), this.eventStore.snapshot(),
      this.dependencyStore.snapshot(),
    ] as const
    const mark = this.queue.length
    this.depth++
    let result: T
    try {
      result = run()
    } catch (error) {
      this.depth--
      this.queue.length = mark
      this.triggerStore.restore(snapshots[0])
      this.ticketStore.restore(snapshots[1])
      this.decisionStore.restore(snapshots[2])
      // Artifacts are registered inside the report's transaction, so a rolled-back report must leave none behind.
      this.artifactStore.restore(snapshots[3])
      this.projectStore.restore(snapshots[4])
      this.workStore.restore(snapshots[5])
      this.eventStore.restore(snapshots[6])
      this.dependencyStore.restore(snapshots[7])
      throw error
    }
    this.depth--
    if (!outermost) return result
    const deferred = this.queue.slice(mark)
    this.queue = []
    // Outside the try, as in `Store`: the transaction has committed, so a throwing deferred action is not a
    // transaction failure. Rolling the data back here — which is what this class used to do — made a test asserting
    // "a throwing afterCommit leaves nothing behind" pass while production had already committed it.
    for (const action of deferred) {
      try { action() } catch (error) { this.deferredFailed(error) }
    }
    return result
  }

  private deferredFailed(error: unknown): void {
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error)
    this.deferredFailures.push({ at: new Date().toISOString(), message })
    if (this.deferredFailures.length > 50) this.deferredFailures.shift()
    this.onDeferredError?.(error)
  }

  afterCommit(run: () => void): void {
    if (this.depth === 0) { run(); return }
    this.queue.push(run)
  }

  /** Every Trigger stored, in insertion order. */
  triggerList(): TriggerRecord[] { return this.triggerStore.list() }
  /** Every Ticket stored, in insertion order. */
  ticketList(): Ticket[] { return this.ticketStore.list() }
  /** Every Decision stored, newest first. */
  decisionList(limit?: number): DecisionRecord[] { return this.decisionStore.list(limit) }
  /** The Trigger stored under `id`, when there is one. */
  triggerOf(id: string): Trigger | undefined { return this.triggerStore.get(id)?.trigger }
}
