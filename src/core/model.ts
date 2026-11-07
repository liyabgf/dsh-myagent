/** The domain types of myagent, and the predicates that read a Ticket's state from its own facts. */

/** The kind of a Source: one reusable implementation. */
export type SourceKindName = 'cron' | 'inbox' | 'session' | 'rule' | 'chat'

/** Who or what produced a Trigger. A person is not an entity in this model, only an identifier a Source supplies. */
export interface Actor {
  /** Stable identifier in its Source's own identity space, such as `operator` or a chat user id. */
  readonly id: string
  /** `person` may originate work; `system` may not, unless the Policy allows it. */
  readonly kind: 'person' | 'system'
}

/**
 * Where an answer to a Trigger goes: the address the Source that produced it wrote down.
 *
 * The core stores this and never interprets it — `channel` and `thread` belong to the Source's own vocabulary, exactly
 * as `Trigger.meta` does. What the core does fix is that a reply is routed by `kind`, so a Ticket's report can only
 * reach the Source that produced its Trigger, and a Source that wrote no address has nothing delivered to it.
 */
export interface ReplyTo {
  /** The Source kind that can deliver here. A reply is dispatched to that kind's one running instance. */
  readonly kind: SourceKindName
  /**
   * The place inside that Source the request came from — a channel id, a conversation id, a directory name. Only the
   * Source that wrote it knows how to resolve it, which is why it is a string and not a shape.
   */
  readonly channel: string
  /** A conversation inside the channel, on a platform that has one. */
  readonly thread?: string
}

/** One immutable event a Source produced. Its id is derived from the facts that make it unique. */
export interface Trigger {
  readonly id: string
  /** The Source instance that produced it. */
  readonly source: string
  readonly kind: SourceKindName
  /** ISO timestamp of the event. */
  readonly at: string
  readonly actor: Actor
  /** The request text, as the Source read it. */
  readonly text: string
  /** Short title for the Ticket it may create. */
  readonly title: string
  /** Source-owned metadata the core never interprets, such as a schedule slot or a file path. */
  readonly meta?: Record<string, unknown>
  /**
   * Where a reply to this Trigger's Ticket goes, written by the Source that produced it.
   *
   * Optional, and its absence means something: a one-way Source (cron, inbox) has no way back, so it leaves this out and
   * `Delivery.send` does nothing at all rather than failing. The address lives here instead of being reconstructed from
   * `kind` and `actor` because an Actor id says who asked, not where to answer, and inferring the second from the first
   * would post a report to a platform that never asked for one.
   */
  readonly replyTo?: ReplyTo
}

/** What became of a Trigger: the unit of audit, and what makes intake idempotent. */
export type Disposition =
  | { readonly state: 'pending' }
  | { readonly state: 'accepted'; readonly ticketId: string; readonly decisionId: string }
  | { readonly state: 'ignored'; readonly decisionId: string }
  | { readonly state: 'observed'; readonly decisionId: string }
  /**
   * The queue gave up on the effect that carried this Trigger, so it was never received: the gate did not run to a
   * verdict, and no Ticket exists.
   *
   * It has no `decisionId`, and the absence is the fact rather than an omission — a Decision is a gate verdict, and
   * writing one here would put a verdict that never happened into the audit record (`pending` is the precedent for a
   * member without one). Nor can the verdict be recovered later: `receive` writes inside one transaction, so the throw
   * the queue kept retrying rolled back whatever the gate had written. `error` and `effectKey` are what survive
   * instead — the queue deletes its row when it gives up, which makes this row the only record that the request came
   * and was dropped. It is not a settled intake either: `receive` runs the gate again on a Trigger whose row says
   * `lost`, because "already handled" is the opposite of what the row says.
   */
  | { readonly state: 'lost'; readonly error: string; readonly effectKey: string }

/** How strong the basis of an authorization is. v1 admits only `explicit`; `inferred` waits for the assessment layer. */
export type Strength = 'explicit' | 'inferred'

/** A standing grouping of Works: the thing an operator thinks of as "this client" or "this product". */
export interface Project {
  readonly id: string
  readonly name: string
  readonly createdAt: string
  /** What this Project is for, in the operator's own words. */
  readonly note?: string
  /**
   * When this Project was archived, if it was (U21).
   *
   * Optional, so every record written before this field existed is still valid — and the sqlite store keeps the whole
   * record as JSON in one column, so adding it needs no migration. An archived Project leaves the default lists and the
   * "which Work does this belong to" choices while everything under it stays exactly as it was.
   */
  readonly archivedAt?: string
}

/**
 * A recurring or ongoing stream of tasks, which many Tickets belong to over time.
 *
 * A Work is classified onto a Ticket AFTER the gate accepted it, never as an input to the gate. That keeps the gate a
 * pure function of the Trigger and the settings, so a Decision can always be recomputed for audit; a Work that could
 * admit or refuse work would make `policyVersion` mean something it does not.
 */
export interface Work {
  readonly id: string
  /** The Project this Work belongs to, when it belongs to one. */
  readonly projectId?: string
  readonly name: string
  readonly createdAt: string
  /** What every Ticket in this Work is authorized to do, unless the Ticket's own scope narrows it. */
  readonly scope?: string
  readonly note?: string
  /** When this Work was archived, if it was (U21). Same shape and same reason as `Project.archivedAt`. */
  readonly archivedAt?: string
}

/**
 * One edge in the graph of work: `downstream` must not run until `upstream` has finished.
 *
 * The id is a pure function of the two endpoints — no ordinal, no timestamp — so re-asserting an edge cannot create a
 * second one and two orders of writing the same pair mean the same fact. That is the property
 * `key('assignment', ticketId, ordinal)` lacks, and the reason it cannot express two concurrent attempts.
 */
export interface Dependency {
  /** The Ticket that must finish first. */
  readonly upstream: string
  /** The Ticket that waits. */
  readonly downstream: string
  readonly createdAt: string
  /**
   * What releases the wait. `done` needs the upstream to have succeeded; `ended` accepts any ending, which is how a
   * downstream that must run either way (a cleanup, a notification) is expressed.
   */
  readonly on: 'done' | 'ended'
}

/** Every kind of fact the log records about one Ticket's life. */
export type TicketEventType =
  | 'created' | 'launched' | 'delivered' | 'delivery_failed' | 'report' | 'turn_ended' | 'input'
  | 'retried' | 'interrupted' | 'resumed' | 'stopped' | 'failed' | 'ended' | 'classified' | 'session_bound' | 'dependency'
  /**
   * The front desk said something back to whoever asked for this Ticket (S3a).
   *
   * Its own type rather than a `delivered` reuse: `delivered` is about a worker's Report reaching its address, while
   * this is a person-facing message the front desk chose to send, and an operator reading the history has to be able
   * to tell "the worker answered" from "the front desk wrote to them". Adding a type is safe — nothing switches
   * exhaustively over these (see the note above).
   */
  | 'replied'
  /**
   * The operator deleted this Ticket (S4). Recorded with what was removed and how much, because once the assets are
   * gone the tombstone is the only evidence they ever existed.
   */
  | 'deleted'
  /**
   * One Ticket read or materialized a registered artifact of another Ticket (E1).
   * Recorded on BOTH Tickets in the same transaction: `{ fromTicketId, path }` on the reader, and `{ byTicketId, path }`
   * on the producer, so cross-Ticket data lineage is an engine fact rather than prose in a report summary.
   */
  | 'artifact_read'
  /** A reusable tool/script produced by this Ticket was promoted into the shared skill library (E2). */
  | 'skill_promoted'
  /** This Ticket used a shared skill promoted from another Ticket, or another Ticket used one promoted from this Ticket (E2). */
  | 'skill_used'
  /**
   * A Ticket's Work assignment was taken away (U21: the Work was deleted). Its own type rather than a `classified`
   * event with a null in it, because the event log is the operator's audit trail and "classified: nothing" reads like
   * a bug. Nothing switches exhaustively over these types, so adding one cannot strand a case.
   */
  | 'unclassified'
  | 'rescued' | 'rule_stopped' | 'escalated' | 'reply_lost' | 'notice_lost'

/**
 * One recorded fact about a Ticket's life, written inside the transaction that made it true.
 *
 * This is the answer to "everything that happened to this Ticket, in order". It exists as a log rather than as
 * reconstructed state because the state cannot answer it: `mutate` rewrites the whole Ticket row on every change, so
 * the row holds only the latest version of everything, and a fact that was later overwritten is gone.
 */
/**
 * Whether an upstream Ticket has finished the way its dependant asked for.
 *
 * `ended` accepts any ending, which is how work that must happen either way is expressed — a cleanup, a notification.
 * `done` waits for success, and a `dropped`, `stopped` or `failed` upstream leaves the dependant waiting, which is a
 * decision for a person rather than one the graph should make silently.
 */
export function released(edge: Dependency, upstream: Ticket | undefined): boolean {
  if (upstream === undefined || upstream.ended === undefined) return false
  return edge.on === 'ended' || upstream.ended.outcome === 'done'
}

export interface TicketEvent {
  readonly ticketId: string
  /** Position in this Ticket's own history, from 1. Per-Ticket, so two Tickets never compete for a number. */
  readonly seq: number
  readonly at: string
  readonly type: TicketEventType
  /** Who caused it, when somebody did. A fact nobody caused says so by leaving this out. */
  readonly by?: { readonly kind: 'person' | 'agent' | 'system'; readonly id?: string }
  /** The facts worth keeping as plain data: a report state, a reason, an Assignment id. */
  readonly detail?: Record<string, unknown>
}

/** One file a Ticket's work produced, registered from the report that claimed it. */
export interface Artifact {
  readonly ticketId: string
  /** Path inside the Ticket's own directory, normalized so two spellings cannot mean two files. */
  readonly path: string
  /** ISO timestamp of the report that registered the file. */
  readonly at: string
  /** What the worker said when it registered the file, clipped. Nothing measures the file here: the Engine does no I/O. */
  readonly note?: string
}

/**
 * How a Trigger reached the gate, recorded on the Mandate it produced.
 *
 * `chat` is its own value rather than being folded into `session`: `via` is part of the audit record, and a Mandate that
 * says a request came through the main Session when it arrived from a chat platform is a false statement about who
 * authorized the work — the same class of lie as a refusal detail that names the wrong Source.
 */
export type MandateVia = 'schedule' | 'inbox' | 'session' | 'rule' | 'chat'

/**
 * What an accept grants: why the work may be done, and how far it may go.
 * Immutable; a wider scope is a new Ticket. A Ticket's end does not end its Mandate: only a person's stop
 * withdraws it, and a Policy that no longer holds it revokes it.
 */
export interface Mandate {
  /** The Policy version this Mandate relied on; a change that bears on a live Ticket is reported to it. */
  readonly policyVersion: string
  /** Free text describing how far the work may go, as the gate read it from the Trigger and the settings. */
  readonly scope: string
  readonly strength: Strength
  readonly sender: Actor
  readonly via: MandateVia
  readonly at: string
}

/** A worker's structured state. The classification is a field, never inferred from free text. */
export type ReportState = 'progress' | 'waiting' | 'ready' | 'blocked' | 'failed' | 'dropped'

export interface Report {
  readonly state: ReportState
  readonly summary: string
  readonly at: string
  /** A concrete question for a person, present when the worker needs a decision. */
  readonly question?: string
  /** Files the worker produced, relative to its Ticket directory, on a `ready` report. */
  readonly files?: readonly string[]
}

export type AssignmentState = 'pending' | 'running' | 'ended'

/** The binding of a Ticket to one Executor instance. A Ticket has several over time. */
export interface Assignment {
  readonly id: string
  readonly state: AssignmentState
  readonly createdAt: string
  readonly startedAt?: string
  readonly endedAt?: string
  /** Why it ended: `reported`, `retried`, `stopped`, `interrupted`. */
  readonly endedReason?: string
  /** The latest Report this Assignment made. */
  readonly report?: Report
  /** When Inputs last reached the Executor Session. */
  readonly deliveredAt?: string
  /** The error of a failed Input delivery, until a delivery succeeds or the Assignment ends. */
  readonly deliveryError?: string
  /**
   * `triage` when this attempt decides what a request becomes instead of doing the work (S3b). Absent means a worker.
   *
   * On the Assignment rather than on the Ticket because it is a property of one attempt: a triage Ticket that is
   * retried after a crash is retried AS a triage attempt, and a Ticket is never both.
   */
  readonly role?: 'triage'
}

/** Where and under what name a Ticket executes. */
/**
 * A file the request brought with it.
 *
 * `source` is where it was when the request was made; the Executor copies it into the Ticket's own directory before
 * the worker starts, because a Ticket that depends on a file somewhere else is not self-contained — the operator may
 * move or clean it up while the work is queued, and the worker would then run without its input.
 */
export interface Attachment {
  /** The file's name inside the Ticket's `attachments/` directory, unique within the Ticket. */
  readonly name: string
  /** The absolute path it was taken from, kept so a person can see where it came from. */
  readonly source: string
}

export interface Execution {
  readonly name: string
  readonly directory: string
  /**
   * The worker Session's id, once DSH has created it. A requested id is what the Session is asked to be; DSH may reuse
   * a blank Session and answer with another identity, so the id this Ticket actually runs under is a recorded fact, not
   * something derived from the Ticket's own.
   */
  readonly sessionId?: string
}

export type TicketOutcome = 'done' | 'dropped' | 'stopped' | 'failed'

export interface TicketEnded {
  readonly at: string
  readonly by: 'person' | 'agent' | 'system'
  readonly reason: string
  readonly outcome: TicketOutcome
}

/** A question on a Ticket that waits for a person's answer. */
export interface Attention {
  readonly question: string
  readonly at: string
}

/** What a finished Ticket gave back. */
export interface TicketResult {
  readonly summary: string
  readonly files: readonly string[]
  readonly at: string
}

export interface TicketNote {
  readonly at: string
  readonly text: string
}

/** A unit of authorized work. It defines its own state instead of following its Executor Session's. */
export interface Ticket {
  readonly id: string
  readonly title: string
  readonly createdAt: string
  readonly mandate: Mandate
  /** The Trigger that gave this Ticket its authorization. */
  /**
   * Where this Ticket came from. `depth` is how many rule-produced Tickets came before it, so a chain of rules has a
   * length the domain can enforce; absent means zero, which is every Ticket a person asked for and everything stored
   * before V2.
   */
  readonly origin: { readonly triggerId: string; readonly depth?: number }
  /**
   * Set when the operator deleted this Ticket and chose to keep the record as a tombstone (S4).
   *
   * The numbers travel with it: after the directory is gone, "17 files, 2.4 MB" exists nowhere else, and a tombstone
   * that only says "deleted" cannot answer the one question asked afterwards — how much was thrown away.
   *
   * Absent means the Ticket is alive. A Ticket deleted with `record: 'nothing'` has no row at all, so this field only
   * ever describes a tombstone.
   */
  readonly deleted?: {
    readonly at: string
    /** What happened to the produced files: `keep` leaves the directory, `delete` removes it. */
    readonly assets: 'keep' | 'delete'
    readonly directory?: string
    readonly files?: number
    readonly bytes?: number
  }
  /** The files this request brought with it, which the Executor copies into the Ticket's directory. */
  readonly attachments: readonly Attachment[]
  readonly execution?: Execution
  readonly assignments: readonly Assignment[]
  /** Absent while the Ticket is open; its presence is what ends it. */
  readonly ended?: TicketEnded
  readonly attention?: Attention
  readonly result?: TicketResult
  readonly notes: readonly TicketNote[]
  /** The Work this Ticket belongs to, assigned after the gate accepted it. Absent on every Ticket made before V2. */
  readonly workId?: string
  /** Position in this Ticket's Work, starting at 1, in the order Tickets joined the Work. */
  readonly workSeq?: number
  /** Text delivered to the worker as new input; each entry is delivered once. */
  readonly inputs: readonly TicketInput[]
}

/** Context delivered to a Ticket's worker. */
/**
 * Who wrote an Input, when it was not the operator: the worker of another Ticket in the same Work.
 *
 * Absent means a person, which is every Input written before V2 — so nothing stored has to be rewritten for this to
 * exist, and a hand-off between workers is distinguishable in the record from a note somebody typed.
 */
export interface InputBy {
  readonly kind: 'person' | 'agent'
  /** The Ticket whose worker wrote it, when an agent did. */
  readonly id?: string
}

export type TicketInput =
  | { readonly id: string; readonly kind: 'text'; readonly text: string; readonly at: string; readonly deliveredAt?: string; readonly by?: InputBy }
  | { readonly id: string; readonly kind: 'note'; readonly text: string; readonly at: string; readonly deliveredAt?: string; readonly by?: InputBy }

export type DecisionOutcome = 'accept' | 'ignore' | 'observe' | 'unavailable'

/** The result of the gate on one Trigger. */
export interface Decision {
  readonly id: string
  readonly triggerId: string
  readonly outcome: DecisionOutcome
  readonly at: string
  /** A fixed code the panel words, such as `source_disabled` or `sender_not_allowed`. */
  readonly reason: string
  readonly detail?: string
  readonly ticketId?: string
  readonly policyVersion: string
}

/** A Ticket is open while it has no `ended`. */
export const liveTicket = (ticket: Ticket): boolean => ticket.ended === undefined

export const latestAssignment = (ticket: Ticket): Assignment | undefined => ticket.assignments.at(-1)

export const runningAssignment = (ticket: Ticket): Assignment | undefined =>
  latestAssignment(ticket)?.state === 'running' ? latestAssignment(ticket) : undefined

export const latestReport = (ticket: Ticket): Report | undefined => {
  for (let index = ticket.assignments.length - 1; index >= 0; index--) {
    const report = ticket.assignments[index]?.report
    if (report !== undefined) return report
  }
  return undefined
}

/** Inputs the worker has not received yet, oldest first. */
export const undelivered = (ticket: Ticket): readonly TicketInput[] =>
  ticket.inputs.filter(input => input.deliveredAt === undefined)

/**
 * Whether a Ticket waits for a person: its latest Assignment reported `blocked` or `failed`, or it holds a question,
 * and no human message has arrived since. Automatic inputs stay held while this is true.
 */
/**
 * Whether this Ticket is waiting for a person, which is the only thing that makes an unattended system safe to leave.
 * An ended Ticket waits for nobody, however it ended — including one a person stopped while it was asking.
 */
export function waitsForPerson(ticket: Ticket): boolean {
  if (ticket.ended !== undefined) return false
  if (ticket.attention !== undefined) return true
  const assignment = latestAssignment(ticket)
  return assignment?.report?.state === 'blocked' || assignment?.report?.state === 'failed' || assignment?.report?.state === 'waiting'
}

/**
 * The stage a Ticket is in, for the panel and the tools: one closed set of values, computed from the Ticket's own
 * facts rather than stored, so it can never disagree with them.
 */
export type TicketStage =
  | 'pending' | 'running' | 'waiting' | 'failed' | 'blocked' | 'done' | 'dropped' | 'stopped'

export function ticketStage(ticket: Ticket): TicketStage {
  if (ticket.ended !== undefined) {
    return ticket.ended.outcome === 'done' ? 'done' : ticket.ended.outcome === 'dropped' ? 'dropped'
      : ticket.ended.outcome === 'stopped' ? 'stopped' : 'failed'
  }
  const assignment = latestAssignment(ticket)
  if (assignment === undefined) return 'pending'
  // The report says why a Ticket needs a person, which is more use than knowing that it does; `attention` is the
  // filter over such Tickets, not a stage of its own.
  const report = assignment.report
  if (assignment.state === 'pending') return report === undefined ? 'pending' : 'failed'
  if (report?.state === 'ready') return 'done'
  if (report?.state === 'blocked') return 'blocked'
  if (report?.state === 'failed') return 'failed'
  if (report?.state === 'waiting') return 'waiting'
  return assignment.state === 'running' ? 'running' : 'pending'
}

/** Whether a person may retry this Ticket: it waits for a person, or its launch or delivery failed. */
/**
 * Whether a person may push this Ticket again.
 *
 * Three things stall a live Ticket, and all three are a person's to restart: a launch that never got off the ground
 * (its effect may have exhausted its retries, which leaves nothing queued and nobody who will try again), a delivery
 * that failed, and a worker that asked a question or reported it cannot go on. A worker that is simply working is not
 * stalled — stopping it is the verb for that, not retrying.
 */
export function canRetry(ticket: Ticket): boolean {
  if (ticket.ended !== undefined) return false
  const assignment = latestAssignment(ticket)
  if (assignment === undefined) return false
  if (assignment.state === 'pending' || assignment.deliveryError !== undefined) return true
  // A worker whose turn ended with nothing to show is not working: its `waiting` report is the record of that, and
  // pushing it again is the only way it ever continues. Read the CURRENT attempt's own report, not the newest report
  // anywhere on the Ticket: `latestReport` scans every Assignment backwards, so a `waiting` left behind by an attempt
  // that was already retried kept authorizing retries of the attempt now running — and a retry ends the running
  // Assignment without stopping its turn, then launches a second task into the same Session.
  if (assignment.report?.state === 'waiting') return true
  return waitsForPerson(ticket)
}
