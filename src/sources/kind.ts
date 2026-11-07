/**
 * The Source protocol: what a Trigger producer must be, and the narrow host it may use.
 *
 * A Source kind is a reusable implementation; a Source instance is one configuration of a kind. Adding Telegram or
 * Feishu later means adding one kind here and one `send` to the Delivery port — no new domain concept.
 */
import type { DomainEvent, Engine, Settings, Trigger } from '../core/index.ts'
import type { Effects } from '../app/effects.ts'
import type { HealthBoard } from '../app/health.ts'
import type { ReplyTo, SourceKindName } from '../core/model.ts'

/** What a Source reports about itself, for the panel; a healthy Source takes no space. */
export interface SourceStatus {
  readonly ok: boolean
  readonly detail?: string
  /** The instant this Source next produces a Trigger, when it knows one. */
  readonly next?: number
  readonly lastTriggerAt?: string
  readonly counts?: Record<string, number>
}

/** A Source's own read position, which only that Source writes and a restart must not replay. */
export interface Cursor {
  get<T>(): T | undefined
  set<T>(value: T): void
}

/** Everything a Source may touch. It cannot reach the Store, the Sessions or the Executor. */
export interface SourceHost {
  readonly engine: Engine
  readonly effects: Effects
  readonly health: HealthBoard
  readonly lifetime: AbortSignal
  /** The settings as they are now; a Source reads its own part on each pass. */
  settings(): Settings
  /** Ask for a pass now, after queueing work. */
  requestPass(): void
  /** The read position of the Source this host was built for. */
  cursor(id: string): Cursor
  /**
   * Watch what the Engine does, and stop watching.
   *
   * A Source that produces from events rather than from a timer or a directory needs a subscription, and it needs it
   * here rather than by reaching for the Runtime: everything a Source can touch comes through this interface, which is
   * what keeps "one Source cannot do what another can" a fact about the code rather than about discipline.
   */
  subscribe(listener: (event: DomainEvent) => void): () => void
}

/**
 * One running Source instance.
 *
 * What myagent guarantees an implementation — the half of this interface that is not a type, written down because a
 * third party cannot depend on what is only true by accident:
 * 1. `start()` and `stop()` are each called once, and nothing calls back after `stop()` returns.
 * 2. `status()` is read periodically. A summary it returns must not erase a problem the Source just recorded: the board
 *    is the only place a Source's own trouble is visible, and both cron and rule have shipped a `status()` that cleared
 *    what it was supposed to be reporting (S19 / N5).
 * 3. A `settings` change moves `signatureOf(kind, settings)`, which is what makes the registry recreate the instance. A
 *    knob that does not move it is a knob the running Source never sees (`rule` once read the session block, so editing
 *    a rule recreated nothing — the third of the three S33 fallthroughs).
 * 4. `deny` and `paused` take effect on the produce side: a Source that is denied or paused produces nothing at all,
 *    rather than producing Triggers for the gate to refuse. A refusal at the gate is irreversible — the Trigger is
 *    stored as `ignored`, and when its id is a pure function of the event, lifting the deny can never re-evaluate it
 *    (S9 / N4).
 * 5. An exception thrown inside a Source is that Source's own: the registry creates and polls them one at a time and
 *    records a failure as a health line, so one broken Source cannot unmount the others.
 *
 * What an implementation guarantees myagent:
 * 1. An identity does not become an `Actor` unless the settings mapped it (contract §2). Inferring one from the event
 *    is how the inbox ended up trusting a name the request file asserted about itself.
 * 2. A Trigger's id is a pure function of what it identifies — the message id, not the instant it was read (S31) — so
 *    observing the same event twice cannot produce a second Ticket.
 * 3. Every side effect is enqueued, never performed inline (§3.2 of the contract).
 * 4. Delivering the same event twice is idempotent.
 */
export interface Source {
  readonly id: string
  readonly kind: SourceKindName
  start(): void | Promise<void>
  stop(): void | Promise<void>
  /**
   * Look now, rather than at the next scheduled moment. Optional: a Source with nothing to look at omits it.
   *
   * This is what the panel's "run a pass" asks of a Source, and what makes dropping a file into the inbox take effect
   * at once instead of up to one poll interval later.
   */
  poll?(): void | Promise<void>
  status(): SourceStatus
}

/** A reusable Source implementation. */
export interface SourceKind {
  readonly name: SourceKindName
  create(host: SourceHost): Source
}

/**
 * A Source that can answer back: what a third party implements so a report returns to the platform the request came
 * from, instead of only ever reaching myagent's own front desk.
 *
 * It extends `Source` and changes nothing about it, so the registry, the health board and every guarantee listed on
 * `Source` apply to a two-way Source unchanged — adding one is an addition to the set of Sources, not a new kind of
 * thing for the host to know about.
 *
 * Additionally, myagent guarantees an implementation:
 * 1. `deliver` is called from the effects queue, never inline inside a transaction. So it may be retried after a
 *    failure, and the same reply may reach it more than once: delivering has to be idempotent.
 * 2. `deliver` is only ever called with a `ReplyTo` this Source itself wrote onto a Trigger — the dispatch is by
 *    `replyTo.kind` — so an address belonging to another Source never arrives here, and neither does a reply to a
 *    Ticket whose Trigger had no address at all.
 * 3. A throw from `deliver` is recorded against that effect, retried with backoff, and reported on the health board; it
 *    does not touch the Ticket's own state and does not take another Source down with it.
 */
export interface DeliverOptions {
  readonly ticketId?: string
  readonly files?: readonly string[]
}

export interface TwoWaySource extends Source {
  /** Deliver a message back to the platform. Called by the effects queue, so it may be retried. */
  deliver(replyTo: ReplyTo, text: string, options?: DeliverOptions): Promise<void>
}

/** Build one Trigger's id from the facts that make the event unique, so a restart cannot duplicate it. */
export { key } from '../core/ids.ts'
/**
 * Re-exported here rather than defined here: `ReplyTo` is the type of `Trigger.replyTo`, so it belongs to the domain
 * model, and the core must not depend on the Sources layer for one of its own field types. This file is the surface a
 * Source implementation reads, so it is the place where the type is handed to one.
 */
export type { ReplyTo, Trigger }
