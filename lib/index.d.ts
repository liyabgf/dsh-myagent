import { z } from "zod";
import s from "@deepseek-ai/schemastery";
import { DatabaseSync } from "node:sqlite";
import { Context, Volatile } from "@deepseek-ai/cordis";
declare const Config: s<Schemastery.ObjectS<NoInfer<{
  stateDir: s<string, string, "plain">;
  workRoot: s<string, string, "plain">;
  inboxDir: s<string, string, "plain">;
  mainSessionId: s<string, string, "plain">;
  promptMaxChars: s<number, number, "volatile-defined">;
}>>, Schemastery.ObjectT<NoInfer<{
  stateDir: s<string, string, "plain">;
  workRoot: s<string, string, "plain">;
  inboxDir: s<string, string, "plain">;
  mainSessionId: s<string, string, "plain">;
  promptMaxChars: s<number, number, "volatile-defined">;
}>>, "plain">;
type DeploymentConfig = ReturnType<typeof Config>;
/** The resolved directories of this deployment, which every part of the system reads. */
interface Machine {
  readonly stateDir: string;
  readonly workRoot: string;
  readonly inboxDir: string;
  readonly mainSessionId: string;
  readonly promptMaxChars: Volatile<number>;
}
/** The domain types of myagent, and the predicates that read a Ticket's state from its own facts. */
/** The kind of a Source: one reusable implementation. */
type SourceKindName = 'cron' | 'inbox' | 'session' | 'rule' | 'chat';
/** Who or what produced a Trigger. A person is not an entity in this model, only an identifier a Source supplies. */
interface Actor {
  /** Stable identifier in its Source's own identity space, such as `operator` or a chat user id. */
  readonly id: string;
  /** `person` may originate work; `system` may not, unless the Policy allows it. */
  readonly kind: 'person' | 'system';
}
/**
 * Where an answer to a Trigger goes: the address the Source that produced it wrote down.
 *
 * The core stores this and never interprets it — `channel` and `thread` belong to the Source's own vocabulary, exactly
 * as `Trigger.meta` does. What the core does fix is that a reply is routed by `kind`, so a Ticket's report can only
 * reach the Source that produced its Trigger, and a Source that wrote no address has nothing delivered to it.
 */
interface ReplyTo {
  /** The Source kind that can deliver here. A reply is dispatched to that kind's one running instance. */
  readonly kind: SourceKindName;
  /**
   * The place inside that Source the request came from — a channel id, a conversation id, a directory name. Only the
   * Source that wrote it knows how to resolve it, which is why it is a string and not a shape.
   */
  readonly channel: string;
  /** A conversation inside the channel, on a platform that has one. */
  readonly thread?: string;
}
/** One immutable event a Source produced. Its id is derived from the facts that make it unique. */
interface Trigger {
  readonly id: string;
  /** The Source instance that produced it. */
  readonly source: string;
  readonly kind: SourceKindName;
  /** ISO timestamp of the event. */
  readonly at: string;
  readonly actor: Actor;
  /** The request text, as the Source read it. */
  readonly text: string;
  /** Short title for the Ticket it may create. */
  readonly title: string;
  /** Source-owned metadata the core never interprets, such as a schedule slot or a file path. */
  readonly meta?: Record<string, unknown>;
  /**
   * Where a reply to this Trigger's Ticket goes, written by the Source that produced it.
   *
   * Optional, and its absence means something: a one-way Source (cron, inbox) has no way back, so it leaves this out and
   * `Delivery.send` does nothing at all rather than failing. The address lives here instead of being reconstructed from
   * `kind` and `actor` because an Actor id says who asked, not where to answer, and inferring the second from the first
   * would post a report to a platform that never asked for one.
   */
  readonly replyTo?: ReplyTo;
}
/** What became of a Trigger: the unit of audit, and what makes intake idempotent. */
type Disposition = {
  readonly state: 'pending';
} | {
  readonly state: 'accepted';
  readonly ticketId: string;
  readonly decisionId: string;
} | {
  readonly state: 'ignored';
  readonly decisionId: string;
} | {
  readonly state: 'observed';
  readonly decisionId: string;
} |
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
{
  readonly state: 'lost';
  readonly error: string;
  readonly effectKey: string;
};
/** How strong the basis of an authorization is. v1 admits only `explicit`; `inferred` waits for the assessment layer. */
type Strength = 'explicit' | 'inferred';
/** A standing grouping of Works: the thing an operator thinks of as "this client" or "this product". */
interface Project {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
  /** What this Project is for, in the operator's own words. */
  readonly note?: string;
  /**
   * When this Project was archived, if it was (U21).
   *
   * Optional, so every record written before this field existed is still valid — and the sqlite store keeps the whole
   * record as JSON in one column, so adding it needs no migration. An archived Project leaves the default lists and the
   * "which Work does this belong to" choices while everything under it stays exactly as it was.
   */
  readonly archivedAt?: string;
}
/**
 * A recurring or ongoing stream of tasks, which many Tickets belong to over time.
 *
 * A Work is classified onto a Ticket AFTER the gate accepted it, never as an input to the gate. That keeps the gate a
 * pure function of the Trigger and the settings, so a Decision can always be recomputed for audit; a Work that could
 * admit or refuse work would make `policyVersion` mean something it does not.
 */
interface Work {
  readonly id: string;
  /** The Project this Work belongs to, when it belongs to one. */
  readonly projectId?: string;
  readonly name: string;
  readonly createdAt: string;
  /** What every Ticket in this Work is authorized to do, unless the Ticket's own scope narrows it. */
  readonly scope?: string;
  readonly note?: string;
  /** When this Work was archived, if it was (U21). Same shape and same reason as `Project.archivedAt`. */
  readonly archivedAt?: string;
}
/**
 * One edge in the graph of work: `downstream` must not run until `upstream` has finished.
 *
 * The id is a pure function of the two endpoints — no ordinal, no timestamp — so re-asserting an edge cannot create a
 * second one and two orders of writing the same pair mean the same fact. That is the property
 * `key('assignment', ticketId, ordinal)` lacks, and the reason it cannot express two concurrent attempts.
 */
interface Dependency {
  /** The Ticket that must finish first. */
  readonly upstream: string;
  /** The Ticket that waits. */
  readonly downstream: string;
  readonly createdAt: string;
  /**
   * What releases the wait. `done` needs the upstream to have succeeded; `ended` accepts any ending, which is how a
   * downstream that must run either way (a cleanup, a notification) is expressed.
   */
  readonly on: 'done' | 'ended';
}
/** Every kind of fact the log records about one Ticket's life. */
type TicketEventType = 'created' | 'launched' | 'delivered' | 'delivery_failed' | 'report' | 'turn_ended' | 'input' | 'retried' | 'interrupted' | 'resumed' | 'stopped' | 'failed' | 'ended' | 'classified' | 'session_bound' | 'dependency' |
/**
 * The front desk said something back to whoever asked for this Ticket (S3a).
 *
 * Its own type rather than a `delivered` reuse: `delivered` is about a worker's Report reaching its address, while
 * this is a person-facing message the front desk chose to send, and an operator reading the history has to be able
 * to tell "the worker answered" from "the front desk wrote to them". Adding a type is safe — nothing switches
 * exhaustively over these (see the note above).
 */
'replied' |
/**
 * The operator deleted this Ticket (S4). Recorded with what was removed and how much, because once the assets are
 * gone the tombstone is the only evidence they ever existed.
 */
'deleted' |
/**
 * One Ticket read or materialized a registered artifact of another Ticket (E1).
 * Recorded on BOTH Tickets in the same transaction: `{ fromTicketId, path }` on the reader, and `{ byTicketId, path }`
 * on the producer, so cross-Ticket data lineage is an engine fact rather than prose in a report summary.
 */
'artifact_read' |
/** A reusable tool/script produced by this Ticket was promoted into the shared skill library (E2). */
'skill_promoted' |
/** This Ticket used a shared skill promoted from another Ticket, or another Ticket used one promoted from this Ticket (E2). */
'skill_used' |
/**
 * A Ticket's Work assignment was taken away (U21: the Work was deleted). Its own type rather than a `classified`
 * event with a null in it, because the event log is the operator's audit trail and "classified: nothing" reads like
 * a bug. Nothing switches exhaustively over these types, so adding one cannot strand a case.
 */
'unclassified' | 'rescued' | 'rule_stopped' | 'escalated' | 'reply_lost' | 'notice_lost';
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
declare function released(edge: Dependency, upstream: Ticket | undefined): boolean;
interface TicketEvent {
  readonly ticketId: string;
  /** Position in this Ticket's own history, from 1. Per-Ticket, so two Tickets never compete for a number. */
  readonly seq: number;
  readonly at: string;
  readonly type: TicketEventType;
  /** Who caused it, when somebody did. A fact nobody caused says so by leaving this out. */
  readonly by?: {
    readonly kind: 'person' | 'agent' | 'system';
    readonly id?: string;
  };
  /** The facts worth keeping as plain data: a report state, a reason, an Assignment id. */
  readonly detail?: Record<string, unknown>;
}
/** One file a Ticket's work produced, registered from the report that claimed it. */
interface Artifact {
  readonly ticketId: string;
  /** Path inside the Ticket's own directory, normalized so two spellings cannot mean two files. */
  readonly path: string;
  /** ISO timestamp of the report that registered the file. */
  readonly at: string;
  /** What the worker said when it registered the file, clipped. Nothing measures the file here: the Engine does no I/O. */
  readonly note?: string;
}
/**
 * How a Trigger reached the gate, recorded on the Mandate it produced.
 *
 * `chat` is its own value rather than being folded into `session`: `via` is part of the audit record, and a Mandate that
 * says a request came through the main Session when it arrived from a chat platform is a false statement about who
 * authorized the work — the same class of lie as a refusal detail that names the wrong Source.
 */
type MandateVia = 'schedule' | 'inbox' | 'session' | 'rule' | 'chat';
/**
 * What an accept grants: why the work may be done, and how far it may go.
 * Immutable; a wider scope is a new Ticket. A Ticket's end does not end its Mandate: only a person's stop
 * withdraws it, and a Policy that no longer holds it revokes it.
 */
interface Mandate {
  /** The Policy version this Mandate relied on; a change that bears on a live Ticket is reported to it. */
  readonly policyVersion: string;
  /** Free text describing how far the work may go, as the gate read it from the Trigger and the settings. */
  readonly scope: string;
  readonly strength: Strength;
  readonly sender: Actor;
  readonly via: MandateVia;
  readonly at: string;
}
/** A worker's structured state. The classification is a field, never inferred from free text. */
type ReportState = 'progress' | 'waiting' | 'ready' | 'blocked' | 'failed' | 'dropped';
interface Report {
  readonly state: ReportState;
  readonly summary: string;
  readonly at: string;
  /** A concrete question for a person, present when the worker needs a decision. */
  readonly question?: string;
  /** Files the worker produced, relative to its Ticket directory, on a `ready` report. */
  readonly files?: readonly string[];
}
type AssignmentState = 'pending' | 'running' | 'ended';
/** The binding of a Ticket to one Executor instance. A Ticket has several over time. */
interface Assignment {
  readonly id: string;
  readonly state: AssignmentState;
  readonly createdAt: string;
  readonly startedAt?: string;
  readonly endedAt?: string;
  /** Why it ended: `reported`, `retried`, `stopped`, `interrupted`. */
  readonly endedReason?: string;
  /** The latest Report this Assignment made. */
  readonly report?: Report;
  /** When Inputs last reached the Executor Session. */
  readonly deliveredAt?: string;
  /** The error of a failed Input delivery, until a delivery succeeds or the Assignment ends. */
  readonly deliveryError?: string;
  /**
   * `triage` when this attempt decides what a request becomes instead of doing the work (S3b). Absent means a worker.
   *
   * On the Assignment rather than on the Ticket because it is a property of one attempt: a triage Ticket that is
   * retried after a crash is retried AS a triage attempt, and a Ticket is never both.
   */
  readonly role?: 'triage';
}
/** Where and under what name a Ticket executes. */
/**
 * A file the request brought with it.
 *
 * `source` is where it was when the request was made; the Executor copies it into the Ticket's own directory before
 * the worker starts, because a Ticket that depends on a file somewhere else is not self-contained — the operator may
 * move or clean it up while the work is queued, and the worker would then run without its input.
 */
interface Attachment {
  /** The file's name inside the Ticket's `attachments/` directory, unique within the Ticket. */
  readonly name: string;
  /** The absolute path it was taken from, kept so a person can see where it came from. */
  readonly source: string;
}
interface Execution {
  readonly name: string;
  readonly directory: string;
  /**
   * The worker Session's id, once DSH has created it. A requested id is what the Session is asked to be; DSH may reuse
   * a blank Session and answer with another identity, so the id this Ticket actually runs under is a recorded fact, not
   * something derived from the Ticket's own.
   */
  readonly sessionId?: string;
}
type TicketOutcome = 'done' | 'dropped' | 'stopped' | 'failed';
interface TicketEnded {
  readonly at: string;
  readonly by: 'person' | 'agent' | 'system';
  readonly reason: string;
  readonly outcome: TicketOutcome;
}
/** A question on a Ticket that waits for a person's answer. */
interface Attention {
  readonly question: string;
  readonly at: string;
}
/** What a finished Ticket gave back. */
interface TicketResult {
  readonly summary: string;
  readonly files: readonly string[];
  readonly at: string;
}
interface TicketNote {
  readonly at: string;
  readonly text: string;
}
/** A unit of authorized work. It defines its own state instead of following its Executor Session's. */
interface Ticket {
  readonly id: string;
  readonly title: string;
  readonly createdAt: string;
  readonly mandate: Mandate;
  /** The Trigger that gave this Ticket its authorization. */
  /**
   * Where this Ticket came from. `depth` is how many rule-produced Tickets came before it, so a chain of rules has a
   * length the domain can enforce; absent means zero, which is every Ticket a person asked for and everything stored
   * before V2.
   */
  readonly origin: {
    readonly triggerId: string;
    readonly depth?: number;
  };
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
    readonly at: string;
    /** What happened to the produced files: `keep` leaves the directory, `delete` removes it. */
    readonly assets: 'keep' | 'delete';
    readonly directory?: string;
    readonly files?: number;
    readonly bytes?: number;
  };
  /** The files this request brought with it, which the Executor copies into the Ticket's directory. */
  readonly attachments: readonly Attachment[];
  readonly execution?: Execution;
  readonly assignments: readonly Assignment[];
  /** Absent while the Ticket is open; its presence is what ends it. */
  readonly ended?: TicketEnded;
  readonly attention?: Attention;
  readonly result?: TicketResult;
  readonly notes: readonly TicketNote[];
  /** The Work this Ticket belongs to, assigned after the gate accepted it. Absent on every Ticket made before V2. */
  readonly workId?: string;
  /** Position in this Ticket's Work, starting at 1, in the order Tickets joined the Work. */
  readonly workSeq?: number;
  /** Text delivered to the worker as new input; each entry is delivered once. */
  readonly inputs: readonly TicketInput[];
}
/** Context delivered to a Ticket's worker. */
/**
 * Who wrote an Input, when it was not the operator: the worker of another Ticket in the same Work.
 *
 * Absent means a person, which is every Input written before V2 — so nothing stored has to be rewritten for this to
 * exist, and a hand-off between workers is distinguishable in the record from a note somebody typed.
 */
interface InputBy {
  readonly kind: 'person' | 'agent';
  /** The Ticket whose worker wrote it, when an agent did. */
  readonly id?: string;
}
type TicketInput = {
  readonly id: string;
  readonly kind: 'text';
  readonly text: string;
  readonly at: string;
  readonly deliveredAt?: string;
  readonly by?: InputBy;
} | {
  readonly id: string;
  readonly kind: 'note';
  readonly text: string;
  readonly at: string;
  readonly deliveredAt?: string;
  readonly by?: InputBy;
};
type DecisionOutcome = 'accept' | 'ignore' | 'observe' | 'unavailable';
/** The result of the gate on one Trigger. */
interface Decision {
  readonly id: string;
  readonly triggerId: string;
  readonly outcome: DecisionOutcome;
  readonly at: string;
  /** A fixed code the panel words, such as `source_disabled` or `sender_not_allowed`. */
  readonly reason: string;
  readonly detail?: string;
  readonly ticketId?: string;
  readonly policyVersion: string;
}
/** A Ticket is open while it has no `ended`. */
declare const liveTicket: (ticket: Ticket) => boolean;
declare const latestAssignment: (ticket: Ticket) => Assignment | undefined;
declare const runningAssignment: (ticket: Ticket) => Assignment | undefined;
declare const latestReport: (ticket: Ticket) => Report | undefined;
/** Inputs the worker has not received yet, oldest first. */
declare const undelivered: (ticket: Ticket) => readonly TicketInput[];
/**
 * Whether a Ticket waits for a person: its latest Assignment reported `blocked` or `failed`, or it holds a question,
 * and no human message has arrived since. Automatic inputs stay held while this is true.
 */
/**
 * Whether this Ticket is waiting for a person, which is the only thing that makes an unattended system safe to leave.
 * An ended Ticket waits for nobody, however it ended — including one a person stopped while it was asking.
 */
declare function waitsForPerson(ticket: Ticket): boolean;
/**
 * The stage a Ticket is in, for the panel and the tools: one closed set of values, computed from the Ticket's own
 * facts rather than stored, so it can never disagree with them.
 */
type TicketStage = 'pending' | 'running' | 'waiting' | 'failed' | 'blocked' | 'done' | 'dropped' | 'stopped';
declare function ticketStage(ticket: Ticket): TicketStage;
/** Whether a person may retry this Ticket: it waits for a person, or its launch or delivery failed. */
/**
 * Whether a person may push this Ticket again.
 *
 * Three things stall a live Ticket, and all three are a person's to restart: a launch that never got off the ground
 * (its effect may have exhausted its retries, which leaves nothing queued and nobody who will try again), a delivery
 * that failed, and a worker that asked a question or reported it cannot go on. A worker that is simply working is not
 * stalled — stopping it is the verb for that, not retrying.
 */
declare function canRetry(ticket: Ticket): boolean;
/**
 * Timing for the cron Source: five-field Vixie cron expressions, daily, weekly and fixed-rate schedules, and the
 * next instant each one fires. Pure and testable; it knows nothing about Triggers or the Store.
 *
 * Zone rules, matching DSH's own scheduler: a local time that does not exist in the zone (a spring-forward gap) is
 * skipped, and a local time that occurs twice (an autumn fallback) fires once, at the earlier instant.
 */
/** When a schedule fires. `time` is `HH:mm` or `HH:mm:ss`; `timeZone` is `UTC` or an IANA `Area/Location`. */
type Timing = {
  readonly kind: 'every';
  readonly seconds: number;
} | {
  readonly kind: 'daily';
  readonly time: string;
  readonly timeZone?: string;
} | {
  readonly kind: 'weekly';
  readonly time: string;
  readonly weekdays: readonly number[];
  readonly timeZone?: string;
} | {
  readonly kind: 'cron';
  readonly expression: string;
  readonly timeZone?: string;
};
/** A parsed cron expression: the value sets of its five fields, and which of the two day fields it restricted. */
interface CronSpec {
  readonly minutes: ReadonlySet<number>;
  readonly hours: ReadonlySet<number>;
  readonly daysOfMonth: ReadonlySet<number>;
  readonly months: ReadonlySet<number>;
  readonly daysOfWeek: ReadonlySet<number>;
  /** True when the day-of-month field named values rather than `*`. */
  readonly domRestricted: boolean;
  /** True when the day-of-week field named values rather than `*`. */
  readonly dowRestricted: boolean;
}
/** Local wall-clock parts of one instant in one zone. */
interface ZoneParts {
  readonly year: number;
  readonly month: number;
  readonly day: number;
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
}
/** The zone this process runs in, the default of a schedule that names none. */
declare function localZone(): string;
/** Read an instant's wall-clock parts in `zone`. An ICU midnight hour of `24` is folded to `0`. */
declare function zoneParts(zone: string, ms: number): ZoneParts;
/**
 * The instant at which `zone`'s wall clock reads `local`, or `undefined` when that local time does not exist there.
 * Refines the offset once across a DST boundary, and verifies by reading the result back.
 */
declare function localToUtc(zone: string, local: ZoneParts): number | undefined;
/** Parse `HH:mm` or `HH:mm:ss` into seconds since local midnight. @throws for any other shape. */
/** Whether a name names a time zone `Intl` accepts, which is what `nextRun` throws on when it does not. */
declare function knownTimeZone(zone: string): boolean;
declare function parseTime(text: string): number;
/**
 * Parse a five-field Vixie cron expression: minute, hour, day-of-month, month, day-of-week.
 * When both day fields are restricted, a day matches if either one does, as Vixie cron does.
 * @throws with the offending field named.
 */
declare function parseCron(expression: string): CronSpec;
/**
 * The next instant strictly after `from` at which `timing` fires, or `undefined` when it never fires again within
 * {@link HORIZON_DAYS}. A fixed rate counts from `from`, so its caller stores the instant it used as the base.
 */
declare function nextRun(timing: Timing, from: Date): number | undefined;
/** The next instant strictly after `from` at which a parsed cron expression fires in `zone`. */
declare function nextCron(spec: CronSpec, fromMs: number, zone: string): number | undefined;
/** A one-line English description of `timing`, for the panel and for a Ticket's origin note. */
declare function describeTiming(timing: Timing): string;
/** One schedule of the cron Source. `id` is stable across edits and names the Trigger's slot. */
declare const ScheduleSchema: z.ZodObject<{
  id: z.ZodString;
  name: z.ZodDefault<z.ZodString>;
  enabled: z.ZodDefault<z.ZodBoolean>;
  prompt: z.ZodString;
  scope: z.ZodDefault<z.ZodString>;
  deliverTo: z.ZodOptional<z.ZodObject<{
    channel: z.ZodString;
    thread: z.ZodOptional<z.ZodString>;
  }, z.core.$strip>>;
  maxRuntimeMs: z.ZodDefault<z.ZodNumber>;
  preset: z.ZodDefault<z.ZodEnum<{
    worker: "worker";
    researcher: "researcher";
  }>>;
  timing: z.ZodDiscriminatedUnion<[z.ZodObject<{
    kind: z.ZodLiteral<"every">;
    seconds: z.ZodNumber;
  }, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"daily">;
    time: z.ZodString;
    timeZone: z.ZodOptional<z.ZodString>;
  }, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"weekly">;
    time: z.ZodString;
    weekdays: z.ZodArray<z.ZodNumber>;
    timeZone: z.ZodOptional<z.ZodString>;
  }, z.core.$strip>, z.ZodObject<{
    kind: z.ZodLiteral<"cron">;
    expression: z.ZodString;
    timeZone: z.ZodOptional<z.ZodString>;
  }, z.core.$strip>], "kind">;
}, z.core.$strict>;
declare const SettingsSchema: z.ZodObject<{
  acceptMode: z.ZodDefault<z.ZodEnum<{
    auto: "auto";
    observe: "observe";
  }>>;
  allowedSenders: z.ZodDefault<z.ZodArray<z.ZodString>>;
  paused: z.ZodDefault<z.ZodBoolean>;
  executor: z.ZodPrefault<z.ZodObject<{
    maxWorkers: z.ZodDefault<z.ZodNumber>;
    prepare: z.ZodDefault<z.ZodString>;
    model: z.ZodDefault<z.ZodString>;
    sandbox: z.ZodDefault<z.ZodEnum<{
      local: "local";
      vm: "vm";
    }>>;
  }, z.core.$strict>>;
  sources: z.ZodPrefault<z.ZodObject<{
    cron: z.ZodPrefault<z.ZodObject<{
      schedules: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        name: z.ZodDefault<z.ZodString>;
        enabled: z.ZodDefault<z.ZodBoolean>;
        prompt: z.ZodString;
        scope: z.ZodDefault<z.ZodString>;
        deliverTo: z.ZodOptional<z.ZodObject<{
          channel: z.ZodString;
          thread: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>>;
        maxRuntimeMs: z.ZodDefault<z.ZodNumber>;
        preset: z.ZodDefault<z.ZodEnum<{
          worker: "worker";
          researcher: "researcher";
        }>>;
        timing: z.ZodDiscriminatedUnion<[z.ZodObject<{
          kind: z.ZodLiteral<"every">;
          seconds: z.ZodNumber;
        }, z.core.$strip>, z.ZodObject<{
          kind: z.ZodLiteral<"daily">;
          time: z.ZodString;
          timeZone: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
          kind: z.ZodLiteral<"weekly">;
          time: z.ZodString;
          weekdays: z.ZodArray<z.ZodNumber>;
          timeZone: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>, z.ZodObject<{
          kind: z.ZodLiteral<"cron">;
          expression: z.ZodString;
          timeZone: z.ZodOptional<z.ZodString>;
        }, z.core.$strip>], "kind">;
      }, z.core.$strict>>>;
      acceptMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        observe: "observe";
      }>>;
      paused: z.ZodOptional<z.ZodBoolean>;
      allowedSenders: z.ZodOptional<z.ZodArray<z.ZodString>>;
      deny: z.ZodOptional<z.ZodBoolean>;
      allowSystemActors: z.ZodOptional<z.ZodBoolean>;
      enabled: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>>;
    inbox: z.ZodPrefault<z.ZodObject<{
      directory: z.ZodDefault<z.ZodString>;
      pollMs: z.ZodDefault<z.ZodNumber>;
      acceptMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        observe: "observe";
      }>>;
      paused: z.ZodOptional<z.ZodBoolean>;
      allowedSenders: z.ZodOptional<z.ZodArray<z.ZodString>>;
      deny: z.ZodOptional<z.ZodBoolean>;
      allowSystemActors: z.ZodOptional<z.ZodBoolean>;
      enabled: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>>;
    session: z.ZodPrefault<z.ZodObject<{
      acceptMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        observe: "observe";
      }>>;
      paused: z.ZodOptional<z.ZodBoolean>;
      allowedSenders: z.ZodOptional<z.ZodArray<z.ZodString>>;
      deny: z.ZodOptional<z.ZodBoolean>;
      allowSystemActors: z.ZodOptional<z.ZodBoolean>;
      enabled: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>>;
    rule: z.ZodPrefault<z.ZodObject<{
      rules: z.ZodDefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        when: z.ZodObject<{
          outcome: z.ZodEnum<{
            done: "done";
            dropped: "dropped";
            stopped: "stopped";
            failed: "failed";
          }>;
          workId: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        then: z.ZodObject<{
          prompt: z.ZodString;
          scope: z.ZodOptional<z.ZodString>;
          workId: z.ZodOptional<z.ZodString>;
        }, z.core.$strict>;
        maxDepth: z.ZodDefault<z.ZodNumber>;
      }, z.core.$strict>>>;
      acceptMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        observe: "observe";
      }>>;
      paused: z.ZodOptional<z.ZodBoolean>;
      allowedSenders: z.ZodOptional<z.ZodArray<z.ZodString>>;
      deny: z.ZodOptional<z.ZodBoolean>;
      allowSystemActors: z.ZodOptional<z.ZodBoolean>;
      enabled: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>>;
    chat: z.ZodPrefault<z.ZodObject<{
      identities: z.ZodPrefault<z.ZodRecord<z.ZodString, z.ZodObject<{
        actor: z.ZodString;
        note: z.ZodOptional<z.ZodString>;
      }, z.core.$strict>>>;
      channels: z.ZodPrefault<z.ZodArray<z.ZodObject<{
        id: z.ZodString;
        directory: z.ZodString;
        enabled: z.ZodDefault<z.ZodBoolean>;
      }, z.core.$strict>>>;
      pollMs: z.ZodDefault<z.ZodNumber>;
      acceptMode: z.ZodOptional<z.ZodEnum<{
        auto: "auto";
        observe: "observe";
      }>>;
      paused: z.ZodOptional<z.ZodBoolean>;
      allowedSenders: z.ZodOptional<z.ZodArray<z.ZodString>>;
      deny: z.ZodOptional<z.ZodBoolean>;
      allowSystemActors: z.ZodOptional<z.ZodBoolean>;
      enabled: z.ZodDefault<z.ZodBoolean>;
    }, z.core.$strict>>;
  }, z.core.$strict>>;
  watchdog: z.ZodPrefault<z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    everyMs: z.ZodDefault<z.ZodNumber>;
    launchStuckMs: z.ZodDefault<z.ZodNumber>;
    silentMs: z.ZodDefault<z.ZodNumber>;
    maxRuntimeMs: z.ZodDefault<z.ZodNumber>;
    autoRetry: z.ZodDefault<z.ZodBoolean>;
    autoRetryMax: z.ZodDefault<z.ZodNumber>;
    maxActions: z.ZodDefault<z.ZodNumber>;
  }, z.core.$strict>>;
  notify: z.ZodPrefault<z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
  }, z.core.$strict>>;
  triage: z.ZodPrefault<z.ZodObject<{
    enabled: z.ZodDefault<z.ZodBoolean>;
    desk: z.ZodDefault<z.ZodEnum<{
      dedicated: "dedicated";
      main: "main";
    }>>;
  }, z.core.$strict>>;
}, z.core.$strict>;
type Settings = z.infer<typeof SettingsSchema>;
type Schedule = z.infer<typeof ScheduleSchema>;
/** Parse and fill defaults for a stored settings document. @throws a `z.ZodError` naming every offending path. */
declare const parseSettings: (value: unknown) => Settings;
/**
 * The identifier of one combination of authorization-bearing settings. Every Mandate records it, so a change that
 * bears on a live Ticket can be named and delivered to it.
 */
declare const policyVersion: (settings: Settings) => string;
/** The fixed codes the gate answers with; the panel words each of them. */
declare const GATE_REASONS: {
  readonly accepted: "The gate admitted this request.";
  readonly paused: "Processing is paused.";
  readonly source_disabled: "The Source that produced this request is not enabled.";
  readonly unknown_source: "No Source of this kind is configured.";
  readonly sender_not_allowed: "The sender may not originate work here.";
  readonly system_actor: "A system event may not originate work; only a person on the allowed list may.";
  readonly empty_request: "The request has no text, so there is nothing to authorize.";
  readonly observed: "The accept mode is observe: this records what would have been accepted, and executes nothing.";
};
type GateReason = keyof typeof GATE_REASONS;
/** The gate's verdict on one Trigger. */
interface GateVerdict {
  /** Whether the request may become a Ticket. */
  readonly allow: boolean;
  /** Whether the accept mode records it instead of executing it; true only with `allow`. */
  readonly observe: boolean;
  readonly strength: Strength;
  readonly via: MandateVia;
  /** How far the work may go, as the settings and the Trigger describe it. */
  readonly scope: string;
  readonly reason: GateReason;
  readonly detail?: string;
}
/** One Source's own policy, falling back to the global setting for anything it does not set. */
declare function sourcePolicy(kind: SourceKindName, settings: Settings): {
  paused: boolean;
  deny: boolean;
  allowSystemActors: boolean;
  acceptMode: 'auto' | 'observe';
  allowedSenders: readonly string[];
};
declare function gate(trigger: Trigger, settings: Settings): GateVerdict;
/** The Policy the Engine reads: a fresh, stateless object built from the current settings. */
interface Policy {
  readonly version: string;
  readonly paused: boolean;
  readonly acceptMode: Settings['acceptMode'];
  gate(trigger: Trigger): GateVerdict;
  /**
   * Whether this Trigger's Ticket is triaged — decided by a Session that may answer, dispatch, or ask — instead of
   * going straight to a worker.
   *
   * Three conditions, and each one is a decision the operator made:
   * - the switch is on;
   * - `depth` is 0, so a Ticket the desk opened is never triaged again (without this, dispatching would recurse until
   *   the depth guard invented for rule chains had to catch it, and every request would cost two turns forever);
   * - the Trigger came from a Source that carries a person's words: chat, inbox or cron. A `session` Trigger is the
   *   operator or the front desk speaking here, and a `rule` Trigger is a decision a rule already made — triaging
   *   either would spend a turn second-guessing somebody who was already in the room.
   */
  triage(trigger: Trigger): boolean;
  /** Whether an existing Mandate still holds under these settings, and why not when it does not. */
  revalidate(mandate: Mandate): {
    readonly holds: boolean;
    readonly reason?: GateReason;
    readonly detail?: string;
  };
}
declare function settingsPolicy(settings: Settings): Policy;
/** How a settings change bears on one open Ticket. */
/** A settings change that bears on one live Ticket, in the gate's own words. */
interface PolicyEffect {
  readonly ticketId: string;
  /** Why this Ticket's Mandate no longer holds, which is one of the gate's fixed reasons. */
  readonly reason: GateReason;
  readonly detail?: string;
}
/**
 * Which open Tickets a settings change bears on, and how. Only these are told: a change is delivered to the work in
 * flight rather than cancelling it, because a cancelled change leaves half-finished work behind.
 */
declare function policyEffects(tickets: readonly {
  readonly id: string;
  readonly mandate: Mandate;
  readonly ended?: unknown;
}[], before: Settings, after: Settings): PolicyEffect[];
/** One stored Trigger with what became of it. */
interface TriggerRecord {
  readonly trigger: Trigger;
  readonly disposition: Disposition;
}
/**
 * A request the queue gave up on, in the pieces a `triggers` row can honestly be made of.
 *
 * The four identity fields are the columns that table declares NOT NULL, and they come out of the payload rather than
 * being invented: a row that named its own source `'lost'` would add a Source called "lost" to `countBySource`, which
 * feeds the panel's intake counts, and that page's whole job is answering where work comes from. A payload that cannot
 * fill these four is not stored as a Trigger at all — see `lostTriggerOf`.
 */
interface LostTrigger {
  readonly id: string;
  readonly source: string;
  readonly kind: string;
  readonly at: string;
  /** Why the queue gave up, as text. */
  readonly error: string;
  /** The queue row this came from: after a give-up it is the only other name for the request that survives. */
  readonly effectKey: string;
  /**
   * The payload exactly as it arrived. Not a re-serialized Trigger, because this row promises the four columns beside
   * it and nothing else — a reader must not dereference another field of it.
   */
  readonly raw: string;
}
interface TriggerRepository {
  get(id: string): TriggerRecord | undefined;
  save(record: TriggerRecord): void;
  list(): TriggerRecord[];
  /**
   * Store one Trigger the queue gave up on, and leave a row that is already there alone.
   *
   * Optional the way `Delivery.send` is: an implementation with nowhere to put one says so by not having it, and
   * `Engine.triggerLost` answers that to its caller instead of letting the caller believe a trace was written.
   * A conflict must not be an update — the row that is already there may be one `receive` wrote.
   */
  insertLost?(lost: LostTrigger): void;
}
interface TicketRepository {
  get(id: string): Ticket | undefined;
  save(ticket: Ticket): void;
  list(): Ticket[];
  /** Open Tickets, oldest first. */
  open(): Ticket[];
  /** The Tickets of one Work, in the order they joined it. */
  byWork(workId: string): Ticket[];
  /** Take the row away entirely: the `record: 'nothing'` half of a deletion (S4). */
  remove(id: string): void;
  /**
   * The tombstones: Tickets deleted with their record kept.
   *
   * A separate read rather than a flag on `list`, because `list` hides them by design — every consumer of it (the
   * panel's lists, `myagent_list_tickets`, a Work's children) wants live work — and a tombstone nobody can read is
   * not an audit trail. This is the one view that shows what was deleted and how much went with it.
   */
  deleted(): Ticket[];
}
/** What the Engine can do with the edges between Tickets. */
interface DependencyRepository {
  save(dependency: Dependency): void;
  delete(upstream: string, downstream: string): void;
  /** What a Ticket waits for. */
  upstreamOf(downstream: string): Dependency[];
  /** What waits for a Ticket. */
  downstreamOf(upstream: string): Dependency[];
  /** Every edge, for a cycle check. */
  list(): Dependency[];
}
/** What the Engine can do with the log of what happened to a Ticket. */
interface EventRepository {
  /** Append one fact and answer it with the position it took in this Ticket's history. */
  append(event: Omit<TicketEvent, 'seq'>): TicketEvent;
  /** A Ticket's history, oldest first. */
  list(ticketId: string): TicketEvent[];
}
/** What the Engine can do with the standing groups of Work. */
interface ProjectRepository {
  save(project: Project): void;
  get(id: string): Project | undefined;
  list(): Project[];
  /** Take the record away for good (U21). Absent from the interface until deleting was a thing an operator could ask for. */
  remove(id: string): void;
}
/** What the Engine can do with the streams of tasks that Tickets belong to. */
interface WorkRepository {
  save(work: Work): void;
  get(id: string): Work | undefined;
  list(): Work[];
  /** The Works of one Project, oldest first; an absent `projectId` asks for the Works in no Project. */
  byProject(projectId: string | undefined): Work[];
  /** Take the record away for good (U21). */
  remove(id: string): void;
}
interface DecisionRepository {
  get(id: string): DecisionRecord | undefined;
  save(decision: DecisionRecord): void;
  /** Decisions, newest first, at most `limit`. */
  list(limit?: number): DecisionRecord[];
}
/** A Decision as stored; the record type is the model's Decision. */
type DecisionRecord = Decision;
/** What the Engine can do with the artifacts a Ticket's work produced. */
interface ArtifactRepository {
  /** Register or re-register one path; the newest report's claim about a path replaces the older one. */
  save(artifact: Artifact): void;
  /** A Ticket's artifacts, in the order their registering reports arrived. */
  list(ticketId: string): Artifact[];
}
interface Repositories {
  readonly triggers: TriggerRepository;
  readonly tickets: TicketRepository;
  readonly decisions: DecisionRepository;
  readonly artifacts: ArtifactRepository;
  readonly projects: ProjectRepository;
  readonly works: WorkRepository;
  readonly events: EventRepository;
  readonly dependencies: DependencyRepository;
}
/** The transaction boundary the Engine writes inside, and the hook that runs work only after it commits. */
interface Transaction {
  atomic<T>(run: () => T): T;
  /** Register work to run after the enclosing transaction commits; never after a rollback. */
  afterCommit(run: () => void): void;
}
/** The Executor port: what the Engine asks of whatever runs Assignments. */
interface Executor {
  /** Fill in a new Ticket's execution metadata (name and directory) before its first Assignment launches. */
  prepare(ticket: Ticket, mandate: Mandate): Ticket;
  /** Launch a pending Assignment. */
  start(ticket: Ticket, assignment: Assignment): void;
  /** Hand a running Assignment the Ticket's waiting Inputs. */
  deliver(ticket: Ticket, assignment: Assignment): void;
  /** Stop a running Assignment's work. */
  stop(ticket: Ticket, assignment: Assignment, reason: string): void;
}
/** The Delivery port: where a Report worth telling someone about goes. */
interface Delivery {
  report(ticket: Ticket, report: Report): void;
  /** A settings change that bears on a live Ticket. */
  policyChanged?(ticket: Ticket, effect: PolicyEffect): void;
  /**
   * Send a message back to wherever this Ticket's request came from.
   *
   * Optional, because a deployment whose Sources are all one-way (cron, inbox) has nowhere to send to, and demanding
   * the method there would be answered with empty ones — an empty method is the appearance of a capability without the
   * capability. Which Tickets an implementation can answer is a fact about their Triggers rather than about it: a
   * Ticket whose Trigger carries no `replyTo` gets nothing sent and no error, but the doing-nothing has to be
   * observable, since "I assumed it went out" is worse than "it definitely did not".
   *
   * An implementation must enqueue the send as a durable effect rather than performing it inline. Sending is I/O to a
   * platform, and inline means one hiccup loses the words permanently with no record that they were ever owed — while
   * "every side effect has a record of its execution and its failure" is a hard rule of this project.
   */
  send?(ticket: Ticket, text: string): void;
}
type DomainEvent = {
  readonly type: 'trigger.received';
  readonly triggerId: string;
  readonly disposition: Disposition;
} | {
  readonly type: 'ticket.created';
  readonly ticket: Ticket;
} | {
  readonly type: 'ticket.resumed';
  readonly ticket: Ticket;
} | {
  readonly type: 'ticket.ended';
  readonly ticket: Ticket;
} | {
  readonly type: 'assignment.started';
  readonly ticketId: string;
  readonly assignmentId: string;
} | {
  readonly type: 'assignment.ended';
  readonly ticketId: string;
  readonly assignmentId: string;
} | {
  readonly type: 'report.recorded';
  readonly ticket: Ticket;
  readonly report: Report;
} | {
  readonly type: 'policy.changed';
  readonly effects: readonly PolicyEffect[];
};
interface EngineOptions {
  readonly repos: Repositories;
  readonly tx: Transaction;
  /** The current Policy, read fresh on each command so a settings change takes effect at once. */
  readonly policy: () => Policy;
  readonly executor: Executor;
  readonly delivery: Delivery;
  readonly now?: () => string;
  readonly emit?: (event: DomainEvent) => void;
}
/** What `receive` answers: whether the Trigger was new, and what became of it. */
interface ReceiveResult {
  readonly stored: 'stored' | 'duplicate';
  readonly disposition: Disposition;
  readonly ticketId?: string;
}
/** Replace the last Assignment of `ticket`, or append when it has none. */
/**
 * Symmetric cross-Ticket collaboration predicate (D3 / F2), shared by `noteFromWorker`, `authorizeArtifactRead`, and
 * the runtime's artifact catalog.
 *
 * Rules:
 * 1. A Ticket never collaborates with itself (`source.id !== target.id`).
 * 2. A deleted tombstone (`target.deleted !== undefined`) is not an active collaboration partner.
 * 3. When either Ticket belongs to an explicit `Work`, both must belong to that SAME `Work` (`source.workId === target.workId`).
 *    When both are unclassified (`workId === undefined`), audited collaboration across them is allowed.
 */
declare function canCollaborate(source: Ticket, target: Ticket): boolean;
/**
 * The domain's entry point. Sources call `receive`; the main Session calls `createTicket`, `answer`, `note` and
 * `stopTicket`; people call `stopTicket` and `retryTicket`; the Executor reports facts in the past tense.
 */
declare class Engine {
  private readonly options;
  private readonly repos;
  private readonly tx;
  private readonly executor;
  private readonly delivery;
  private readonly now;
  private readonly emit;
  private readonly policyOf;
  constructor(options: EngineOptions);
  /**
   * Store a Source's Trigger once and answer what became of it.
   * The gate runs in the same transaction, so an accepted Trigger and its Ticket, Mandate, Decision and first
   * Assignment all exist together or not at all. A Trigger whose id is already stored is a duplicate: the same event
   * observed again after a restart, which creates no second Ticket. A row left by `triggerLost` is the one exception,
   * and the reason is below.
   */
  receive(trigger: Trigger): ReceiveResult;
  /**
   * Create a Ticket from a request the main Session received from a person, bypassing no rule: the Trigger it builds
   * goes through `receive`, so the gate, the accept mode and the allowed list apply exactly as they do to any Source.
   */
  createTicket(request: {
    title: string;
    text: string;
    sender?: string;
    scope?: string;
    attachments?: readonly string[];
    replyTo?: ReplyTo;
    /** Explicit Work id or human Work name to group multi-stage Tickets together (E3). */
    workId?: string;
    workName?: string;
    /** Upstream Ticket ids this new Ticket waits for (`done`) before launching (E3). */
    dependsOn?: readonly string[];
  }): ReceiveResult & {
    workId?: string;
    dependsOn?: string[];
  };
  /**
   * Ensure an ended Ticket has a Work (creating one named after its title if needed) and return `{ workId, priorTicket }`
   * so a chat follow-up to a finished Ticket automatically joins the same Work cluster (E3).
   */
  ensureFollowupWork(priorTicketId: string): {
    workId: string;
    prior: Ticket;
  } | undefined;
  /** Record that the front desk wrote back to whoever asked for this Ticket. */
  replied(ticketId: string, detail: Record<string, unknown>): void;
  /**
   * Give a Ticket's worker a fact from elsewhere as a text Input. It grants nothing: the Mandate is the only
   * authorization, and a note never widens it.
   */
  note(ticketId: string, text: string): Ticket;
  /**
   * A person's answer to a Ticket that waits: it clears the question, delivers the text, and starts a new Assignment
   * when the previous one ended. The Mandate is unchanged, so the work stays within its scope.
   */
  answer(ticketId: string, text: string): Ticket;
  /**
   * Let one Ticket's worker hand a fact to another Ticket, through the Engine and nothing else.
   *
   * Two rules make this safe to give a model. The boundary is the Work: two Tickets may talk only when they belong to
   * the same one, which is a stored fact rather than a sentence in a prompt, so a worker cannot widen it by arguing.
   * And the hand-off is an Input on the target, delivered by the same machinery a person's note uses — never a
   * message into the other Session and never a file in a shared directory, because both of those would leave the
   * Engine unable to say who told whom what.
   */
  noteFromWorker(sourceTicketId: string, targetTicketId: string, text: string): Ticket;
  /** Add an Input to an open Ticket and hand it to the running Assignment, or hold it for the next launch. */
  private addInput;
  /**
   * Withdraw the Mandate: the Ticket ends `stopped`, its worker's turn is cancelled and its background work stops.
   * The stop message itself is never re-evaluated.
   *
   * `by` defaults to a person because that is the usual caller, and it is a parameter because it is not the only one:
   * a Ticket that ran past its wall-clock budget is stopped by the system, and recording that as a person's decision
   * would put a choice in the operator's history that the operator never made. Attribution is the one thing an audit
   * log cannot recover after the fact.
   */
  stopTicket(ticketId: string, reason?: string, by?: TicketEvent['by']): Ticket;
  /**
   * End the stalled Assignment of a Ticket that waits for a person — after a `failed` or `blocked` Report, or a
   * failed Input delivery — and start a fresh one that continues from the same directory.
   */
  retryTicket(ticketId: string): Ticket;
  /** Dismiss a Decision the panel shows as a problem, which the Decision records. */
  dismiss(decisionId: string): void;
  /** An Assignment runs; its waiting Inputs go out. */
  assignmentStarted(ticketId: string, assignmentId: string): void;
  /** Inputs reached the Executor Session, where each waits for a step to take it. */
  inputsDelivered(ticketId: string, assignmentId: string, inputIds: readonly string[]): void;
  /** Delivering Inputs failed; the Ticket shows it until a delivery succeeds, a new Assignment starts or it ends. */
  deliveryFailed(ticketId: string, assignmentId: string, error: string): void;
  /**
   * A turn of the Executor Session ended. What the worker said becomes a `waiting` Report when it reported nothing
   * since its last Input, so a Ticket never sits silently with unread work.
   *
   * `cause` is why the turn ended, as DSH itself said it: the reason kind of the Session's own `turn/end` event, and
   * the upstream error when that reason is one. It goes into the event's detail because this is the only place the
   * cause of a worker failure can live: the health line reports the same failure as "now" and is legitimately cleared
   * by the next observation, so a Ticket read three hours — or three months — later has to carry its own reason for
   * having stopped mid-run. Without it, a run that needed a person to rescue it and a run that went smoothly produce
   * the identical log. The same division of labour `rule_stopped`, `escalated`, `reply_lost` and `notice_lost` follow:
   * the board is the signal, the log is the record.
   */
  turnEnded(ticketId: string, assignmentId: string, said?: string, cause?: {
    reason?: string;
    error?: string;
  }): void;
  /**
   * Record a worker's Report, and end the Ticket when the Report ends it: `ready` completes it, `dropped` closes it
   * as needing nothing. A `blocked` or `failed` Report leaves the Ticket open, waiting for a person.
   */
  /** Name a standing group of Works: the thing an operator thinks of as "this client" or "this product". */
  createProject(request: {
    name: string;
    note?: string;
  }): Project;
  /** Name a stream of tasks that many Tickets will belong to over time. */
  createWork(request: {
    name: string;
    projectId?: string;
    scope?: string;
    note?: string;
  }): Work;
  /**
   * Classify a Ticket into a Work, which is the moment it takes its place in that Work's history.
   *
   * This happens after the gate accepted the Ticket and never as an input to it, so the gate stays a pure function of
   * the Trigger and the settings. An ended Ticket may still be classified: putting last month's work into the Work it
   * belonged to is bookkeeping, not new authorization.
   */
  attachWork(ticketId: string, workId: string, by?: TicketEvent['by']): Ticket;
  /**
   * A Work by exact name among the non-archived ones, or a new one.
   *
   * Every AUTOMATIC path goes through here — an explicit `workName`, inheriting from an upstream that has no Work, and
   * grouping a follow-up with the Ticket it follows. Without the lookup each of them mints a fresh Work per event, and
   * a chat-first deployment drowns the 工作 page in single-Ticket Works named after old titles: a mess the operator has
   * to clean up by hand, which is the opposite of what this system exists to do. Manual `createWork` keeps no dedupe,
   * because two Works an operator deliberately gave the same name are the operator's business, not the Engine's.
   */
  private workNamedOrCreate;
  /**
   * Every Project, oldest first. Archived ones are left out unless asked for (U21): they are still real records with
   * real history under them, they are just not part of what an operator is choosing from right now.
   */
  projects(includeArchived?: boolean): Project[];
  /** Every Work, or the Works of one Project when asked. Archived ones are left out unless asked for (U21). */
  works(projectId?: string, includeArchived?: boolean): Work[];
  /**
   * Archive and unarchive, and delete for good (U21).
   *
   * The two are different answers to different situations, which is why an operator gets both:
   *
   * - **Archive** is for a grouping that is finished or wrong-but-used. It leaves every list and every choice, keeps
   *   its Works and their Tickets and their history exactly as they are, and can be undone. Nothing is lost.
   * - **Delete** is for a grouping that should never have existed. The record goes away, and so does the link that
   *   pointed at it — a deleted Work's Tickets keep living with no Work, a deleted Project's Works keep living with no
   *   Project. **Deleting a grouping never reaches into the work itself**: a Ticket is a real thing that happened, and
   *   each one whose assignment is taken away gets an `unclassified` event saying so, with the Work's id in the detail.
   *   That is what keeps "delete it completely" and "nothing disappears silently" true at the same time.
   *
   * Both run inside one transaction, so a failure part-way through (a Ticket that will not save) leaves everything
   * exactly as it was rather than half-deleted.
   */
  archiveProject(id: string): Project;
  unarchiveProject(id: string): Project;
  /** Delete a Project; its Works survive with no Project. Returns how many were detached, so the UI can say it. */
  deleteProject(id: string): {
    deleted: string;
    detachedWorks: number;
  };
  archiveWork(id: string): Work;
  unarchiveWork(id: string): Work;
  /** Delete a Work; its Tickets survive with no Work, each with an `unclassified` event. */
  deleteWork(id: string): {
    deleted: string;
    detachedTickets: number;
  };
  private requireProject;
  /**
   * Whether this Ticket may be deleted, with no side effects (S4).
   *
   * Exists so the caller can ask BEFORE doing IO: the Runtime has to measure and remove a directory, and doing that
   * first would mean a refusal arrives after the files are already gone. The check is repeated inside `deleteTicket`,
   * which is the authority — this one is a preview, not a permission.
   * @throws a `UserError` naming why not.
   */
  assertDeletable(id: string): Ticket;
  /**
   * Delete a Ticket: its record, and — when asked — the assets it produced.
   *
   * Two axes, because they are two different losses and only one of them is recoverable:
   * - `assets`: `keep` leaves the directory (the work may be worth more than the request), `delete` removes it.
   * - `record`: `tombstone` keeps the row marked deleted, hidden from every list but resolvable by id; `nothing`
   *   removes the row.
   *
   * The Trigger and the Decision are NEVER removed, whichever option is chosen. The Trigger id is a pure function of
   * the request, so it is the only thing that stops the same message being accepted again as new work; and "a request
   * arrived and was dealt with" is the one fact an unattended system must not lose. Deleting a Ticket is not deleting
   * the record that it was ever asked for.
   *
   * The caller does the IO and passes in what it measured, so the tombstone can carry numbers that no longer exist
   * anywhere else.
   */
  deleteTicket(id: string, options: {
    assets: 'keep' | 'delete';
    record: 'tombstone' | 'nothing';
    files?: number;
    bytes?: number;
  }): {
    deleted: string;
    assets: 'keep' | 'delete';
    record: 'tombstone' | 'nothing';
    directory?: string;
  };
  private requireWork;
  /** A Work's Projects, or every Project when asked for none. */
  project(id: string): Project | undefined;
  /** One Work, when it exists. */
  work(id: string): Work | undefined;
  /** A Work's Tickets, in the order they joined it. */
  ticketsOfWork(workId: string): Ticket[];
  /**
   * What the worker says about the attempt it was launched for.
   *
   * `assignmentId` is the attempt the calling turn belongs to, which the worker's own tool carries. Naming it is what
   * makes a turn that outlives its attempt harmless: without it, a report from an attempt that was already retried
   * lands on whichever attempt is running now, because "the running one" is exactly what a superseded turn looks like
   * from the outside.
   */
  report(ticketId: string, report: Omit<Report, 'at'>, assignmentId?: string): Ticket;
  /**
   * Record that the system gave up on an attempt it could not start, or could not hand the work to.
   *
   * This is not the worker's report and is kept separate on purpose: the attempt is usually still `pending`, because
   * nothing ever started it. A Ticket left pending with no word on it is indistinguishable from a launch that is
   * merely queued, so the giving-up has to be written down — but it must not open the door for a worker's report to be
   * attributed to an attempt that never ran.
   */
  reportGaveUp(ticketId: string, summary: string): Ticket;
  private recordReport;
  /**
   * An Assignment was running when the host stopped. It ends as interrupted, and a fresh pending Assignment takes the
   * Ticket over with a recovery note, so a restart continues the work instead of losing it.
   */
  assignmentInterrupted(ticketId: string, assignmentId: string, why?: string, noteText?: string, byId?: string): void;
  /**
   * Tell each live Ticket the change bears on how, under the new Policy. A change is delivered, never enforced by
   * cancellation: cancelling would leave half-finished work with no one to explain it.
   */
  policyChanged(before: Settings, after: Settings): readonly PolicyEffect[];
  /** A Ticket by id. @throws `UserError('ticket_missing')` when absent. */
  require(ticketId: string): Ticket;
  /** Read a Trigger by id. @throws `UserError('trigger_missing')` when absent. */
  trigger(triggerId: string): Trigger;
  /**
   * End a Ticket as failed by the system itself, for a case where no work may run at all.
   *
   * This is not a worker's `failed` Report, which leaves the Ticket open for a person to answer or to retry in the same
   * directory. It is for a directory that cannot be trusted — a prepare command that failed may have left it half-made,
   * and running anything in it, or preparing it again, would only compound that. The work, if it is still wanted, gets
   * a new Ticket and with it a new directory.
   */
  failTicket(ticketId: string, reason: string): Ticket;
  /**
   * Record the worker Session id DSH actually gave this Ticket.
   *
   * A launch asks for `worker-<ticketId>` and DSH may answer with another identity, so the id is stored rather than
   * derived; everything that later addresses the worker — a delivery, a stop, a turn ending — reads it from here.
   */
  bindSession(ticketId: string, sessionId: string): void;
  /** Read a Decision by id, for the panel and for a Source that words its own refusal. */
  decisionOf(decisionId: string): Decision | undefined;
  /** Read what became of a Trigger, when it was stored. */
  dispositionOf(triggerId: string): Disposition | undefined;
  /** Change one Ticket in a transaction, saving and returning it; a mutation that returns it unchanged still saves. */
  /**
   * Record one fact about a Ticket's life. Called inside the transaction that made the fact true, so the log can never
   * hold an event for state that was rolled back — which is the property a reconstructed-from-state history cannot give.
   */
  private record;
  /**
   * When this attempt's turn last ended before the report now arriving, or `undefined` when it did not.
   *
   * Reads the log backwards and stops at the attempt's own previous report, because the question is whether the work
   * was interrupted between the word the worker last said and the one it is saying now. Events of other attempts are
   * skipped rather than ending the scan, so a retry — whose story `retried` and its own `launched` already tell — does
   * not read as a resumption, and an Input delivered in between keeps its place in the log without hiding the
   * interruption that came before it.
   */
  private interruptedAt;
  /**
   * Make one Ticket wait for another.
   *
   * The wait is enforced where the launch is decided and never by ending anything: a waiting Ticket keeps its
   * Assignment `pending` while its launch defers itself, which does not count against the retry budget. Expressing the
   * wait as failures instead would burn five tries and leave a spurious `failed` report on work that is merely early.
   */
  dependOn(downstreamId: string, upstreamId: string, on?: Dependency['on']): Dependency;
  /** Drop an edge, which is how a person undoes a wait that turned out to be wrong. */
  dropDependency(downstreamId: string, upstreamId: string): void;
  /** A Ticket's registered artifacts, in the order their registering reports arrived. */
  artifactsOf(ticketId: string): Artifact[];
  /**
   * Authorize one Ticket's worker to read one registered artifact of another, and answer where it is.
   *
   * Two narrowings, both deliberate. The boundary is the Work — the same machine-checkable rule the hand-off channel
   * uses, so a worker cannot widen it by arguing. And only a **registered** artifact is readable, never an arbitrary
   * file in the other Ticket's directory: the registry is the surface a report claimed and a person can audit, whereas
   * "whatever happens to be in that directory" is neither.
   *
   * This authorizes and locates; it does not read AND IT DOES NOT WRITE. Core does no IO, so the caller resolves the
   * path against the directory with the same traversal guard the panel uses, does the reading itself, and then calls
   * `recordArtifactRead` on the success path — a caller that only wants to pre-check may call this freely.
   */
  authorizeArtifactRead(sourceTicketId: string, targetTicketId: string, path: string): {
    directory: string;
    artifact: Artifact;
  };
  /**
   * Record that one Ticket actually GOT one registered artifact of another: one `artifact_read` event on each side.
   *
   * Deliberately a separate command rather than a side effect of `authorizeArtifactRead`. Authorization is answered
   * before the read happens, and three refusals live after it (the path is a symlink or escapes the directory, the file
   * is not text, the file is over the inline budget) — recording at authorization time wrote lineage for reads that
   * never happened, which made the panel's 关联引用 box and the audit log say "who asked for whose output" while both
   * claim to say "who used whose output". Callers record on the success paths only, so "a refusal leaves no trace" is a
   * structural property rather than a matter of calling things in the right order.
   *
   * Deduplicated per (source, target, path) for the lifetime of the Ticket, so a worker that re-reads the same artifact
   * on every retry does not bury the log; the count of reads is therefore NOT recoverable from these events.
   */
  recordArtifactRead(sourceTicketId: string, targetTicketId: string, path: string): void;
  /**
   * Bidirectional cross-Ticket lineage derived from the Engine's event log (`artifact_read` and worker `input` hand-offs).
   * - `citedBy`: other Tickets that read this Ticket's artifacts or received a note from it.
   * - `cites`: other Tickets whose artifacts this Ticket read or that handed a note to it.
   *
   * 【P-1 产品变更】`skill_used` 不再混进这里（旧行为：`event.type === 'artifact_read' || event.type === 'skill_used'`
   * 共用同一对 citedBy/cites）。理由：手艺传承与产物引用是两种事实，混进同一对数字后，面板把"用了谁的手艺"
   * 显示成"引用了谁的产物"，操作者要开 SQLite 才能分清——而"每个数字都必须可信"是这个面板的第一纪律。
   * 手艺传承见 {@link skillLineageOf}。
   */
  citationsOf(ticketId: string): {
    citedBy: string[];
    cites: string[];
  };
  /**
   * Skill-inheritance lineage, from `skill_used` events only (P-1: the other half of the split).
   * - `learnedFrom`: Tickets whose promoted crafts this Ticket used.
   * - `taughtTo`: Tickets that used a craft this Ticket promoted.
   *
   * Kept apart from {@link citationsOf} because "stood on somebody's data" and "somebody's technique got reused"
   * answer different questions: the first is about trust in this answer, the second about which work keeps paying off.
   */
  skillLineageOf(ticketId: string): {
    learnedFrom: string[];
    taughtTo: string[];
  };
  /** Record that a worker promoted a verified reusable script into the shared skill library (E2). */
  skillPromoted(ticketId: string, detail: {
    name: string;
    title: string;
    scriptPath: string;
  }): void;
  /** Record bidirectional lineage when a Ticket uses a skill that originated from another Ticket (E2). */
  skillUsed(consumerTicketId: string, originTicketId: string, skillName: string): void;
  /**
   * Record that the Watchdog gave up on a Ticket and handed it to a person.
   *
   * Written into the Ticket's own log rather than only onto the health board, because the board answers "how are
   * things now" and is legitimately overwritten by the next unrelated observation, while "we escalated this one" is a
   * fact about this Ticket's life. Keeping both is the same division of labour as `ruleChainStopped`: the board is the
   * signal, the log is the record.
   */
  watchdogEscalated(ticketId: string, why: string): void;
  /**
   * Record that a reply owed to whoever asked for this work was given up on.
   *
   * In the log rather than only on the health board or in a file in the Ticket's directory, for the reason this project
   * has now learned three times (N5's `rule_stopped`, N8's `escalated`, and this): the board answers "how are things
   * now" and the next unrelated success legitimately clears it, while "we owed someone a sentence and lost it" is a
   * fact about this Ticket's life. The project's hard rule is that every side effect has an execution and a failure
   * record — a lost reply is a failed side effect, and the log is where failures are recorded.
   */
  replyLost(ticketId: string, detail: Record<string, unknown>): void;
  /**
   * Record that a notice owed to the operator about this Ticket was given up on.
   *
   * Same reasoning as `replyLost`, and the same hole the acceptance run flagged for `notify` and `trigger`: the effect
   * row is deleted when the queue gives up, and the only other trace was a health line — one the queue overwrites with
   * its own end-of-pass summary, so it answers "how are things now" and can never answer "what was lost". (This
   * sentence used to give a reason that was false while its conclusion was right: nothing ever called `record` on that
   * entry, so the line was never overwritten at all and stuck for the life of the process. The clearing is real now,
   * which changes nothing about why the event belongs here.) A notice that will never arrive is a fact about this
   * Ticket's life — the operator asked something, or a policy changed under work already accepted, and the system
   * failed to say so.
   */
  noticeLost(ticketId: string, detail: Record<string, unknown>): void;
  /**
   * Record that a request the queue carried was given up on, and answer whether the record was stored.
   *
   * The third of the three traces §4.35 asked for, and the one that could not follow the other two: `replyLost` and
   * `noticeLost` hang their event on a Ticket, and a Trigger the queue dropped has no Ticket to hang anything on — the
   * gate never ran to a verdict, and every write `receive` makes is inside one transaction, so the throw the queue kept
   * retrying rolled the Decision back with the rest. What is left is the fact about the request itself, and the table
   * whose semantics are "every request, and what became of it" is where that fact belongs.
   *
   * No event is emitted: the log is per-Ticket, and `trigger.received` would say the opposite of what happened.
   * `false` means this deployment's repositories have nowhere to put one, which the caller needs to know — a trace
   * nobody stored and a trace nobody asked for look identical from the outside, and the caller has a fallback.
   */
  triggerLost(lost: LostTrigger): boolean;
  /** One Ticket when it exists, for a caller that must not make a missing one an error. */
  ticket(id: string): Ticket | undefined;
  /** Open Tickets, oldest first. */
  open(): Ticket[];
  /**
   * Record that the Watchdog rescued a Ticket, which is also how it counts its own rescues.
   *
   * Kept in the log rather than in a field of the Watchdog's own, so a restart cannot make it forget and rescue the
   * same Ticket forever, and so "why did this get re-queued three times" is answerable where the operator already reads.
   */
  watchdogActed(ticketId: string, why: string): void;
  /**
   * Record that a rule chain stopped here because it reached its depth limit.
   *
   * Recorded on the Ticket whose ending triggered it, because the Ticket that would have been created does not exist —
   * and without a record the chain leaves nothing at all: no Trigger, no Decision, no event. A health line is not
   * enough, since the health board answers "how are things now" and the next unrelated ending legitimately clears it;
   * "a rule stopped asking for work, on purpose, here" is a fact about what happened, so it belongs in the log.
   */
  ruleChainStopped(ticketId: string, detail: Record<string, unknown>): void;
  /** The edges that wait for one Ticket, which is what a release reads. */
  dependantsOf(upstreamId: string): Dependency[];
  /** The Tickets this one is still waiting for, which is the whole reason its worker has not been launched. */
  blockedBy(ticketId: string): Dependency[];
  /**
   * End what waited on a Ticket that failed, or that found nothing to do, so one broken link does not hang the graph.
   *
   * A stop is deliberately not cascaded: stopping is a person's explicit act, and what should happen to the work
   * downstream of it is that person's decision too. Failure and "nothing to do" keep their difference on the way down,
   * so the panel and the log say which of the two happened rather than flattening both into "cancelled".
   */
  private cascadeFrom;
  /**
   * Whether `upstream` already waits, directly or through others, on `downstream`.
   *
   * Walked in the direction the edges mean: an edge says "downstream waits for upstream", so from the new edge's
   * upstream we follow what IT waits for, and a cycle is arriving back at the new edge's downstream. Walking the other
   * way finds nothing, because "A waits for B" and "B waits for A" are stored as two different edges.
   */
  private createsCycle;
  /** Everything that happened to one Ticket, oldest first. */
  history(ticketId: string): TicketEvent[];
  private mutate;
}
/** The file name an attachment is copied to, unique within one Ticket. */
/**
 * Normalize a worker-reported path into the one spelling this Ticket's artifact is stored under, or refuse it.
 *
 * The paths come from a model, so two spellings can mean one file (`report.md`, `./report.md`, `out/../report.md`) and
 * one spelling can mean a file outside the Ticket's directory (`../other/secret`, an absolute path). Registering the
 * first would make the lineage claim two artifacts for one file; registering the second would claim a file this Ticket
 * never produced. This is pure string work on purpose: the Engine does no I/O, and measuring a file is somebody else's
 * job, done after the transaction that decided the file belongs to this Ticket.
 */
declare function artifactPath(candidate: string): string | undefined;
/**
 * The files a Trigger brought with it, from whichever Source produced it.
 * A Source writes absolute paths into `meta.attachments`; names are derived here so every Source means the same thing.
 */
declare function attachmentsOf(trigger: Trigger): readonly Attachment[];
/** The Ticket a disposition points at, when it does. */
declare function ticketIdOf(disposition: Disposition): string | undefined;
/**
 * The text of a queue payload, which the queue hands over already parsed.
 *
 * A re-serialization rather than the bytes that were in the row: `claimEffects` parses them (`store.ts:651`) and the
 * row is deleted when the queue gives up, so no copy of the original survives to hand on. Nothing is lost by it —
 * `JSON.parse` keeps the keys this build has no name for, which are exactly the interesting ones in a payload it
 * cannot read. `undefined` is answered as text rather than as nothing, because the columns this text goes into are
 * NOT NULL and binding `undefined` to one is itself a TypeError.
 */
declare function payloadText(payload: unknown): string;
/**
 * The Trigger inside a payload the queue gave up on, when the payload has one.
 *
 * `undefined` means it cannot fill the four columns the `triggers` table declares NOT NULL, and then there is no
 * Trigger to store: the caller's business is a bounded record of the text, not a row with invented columns. Only a
 * non-empty string counts for each — a row keyed by `id: ''` is a row that cannot be found again, and a row naming a
 * Source by a value that is not a string is a row the intake counts cannot be read against.
 *
 * Nothing beyond those four is asked for, and that is deliberate. The failures this exists for are the ones where the
 * payload is a Trigger in every way that matters and `receive` threw inside itself, so requiring the whole shape would
 * send the real case to the fallback and store the recognizable request as unrecognizable junk.
 */
declare function lostTriggerOf(payload: unknown, detail: {
  readonly error: string;
  readonly effectKey: string;
}): LostTrigger | undefined;
/**
 * One payload the queue gave up on that was not recognizable as a Trigger.
 *
 * `payload` is the beginning of the text and `chars` the length of all of it, so a reader can tell a payload that was
 * short from one that was cut.
 */
interface LostPayload {
  readonly at: string;
  readonly effectKey: string;
  readonly error: string;
  readonly chars: number;
  readonly payload: string;
}
declare class Dependencies implements DependencyRepository {
  private readonly db;
  constructor(db: DatabaseSync);
  save(dependency: Dependency): void;
  delete(upstream: string, downstream: string): void;
  /** What a Ticket is waiting for, in the order the edges were written. */
  upstreamOf(downstream: string): Dependency[];
  /** What waits for a Ticket, which is what releasing dependants reads. */
  downstreamOf(upstream: string): Dependency[];
  /** Every edge, which is what a cycle check has to walk. */
  list(): Dependency[];
}
declare class Events implements EventRepository {
  private readonly db;
  constructor(db: DatabaseSync);
  append(event: Omit<TicketEvent, 'seq'>): TicketEvent;
  list(ticketId: string): TicketEvent[];
}
declare class Artifacts {
  private readonly db;
  constructor(db: DatabaseSync);
  /** Upsert one artifact: re-registering a path replaces what an earlier report claimed about it. */
  save(artifact: Artifact): void;
  /** A Ticket's artifacts in the order their registering reports arrived. */
  list(ticketId: string): Artifact[];
}
declare class Triggers implements TriggerRepository {
  private readonly db;
  constructor(db: DatabaseSync);
  /**
   * How many of each source's Triggers ended in each disposition, counted from the record itself.
   *
   * A Source's own counters live in instance memory, and an instance is thrown away by every settings save that
   * touches its block, so they read as cumulative in the panel while being per-process. The record is the only thing
   * that survives a restart, so it is what these numbers mean.
   */
  countBySource(): Record<string, Record<string, number>>;
  get(id: string): TriggerRecord | undefined;
  save(record: TriggerRecord): void;
  /**
   * Store a Trigger the queue gave up on, with the payload verbatim in `record`.
   *
   * `DO NOTHING` on a conflict rather than the update `save` does, and the row it protects is a true one: the other way
   * a `trigger` effect fails permanently is the Store itself failing, so the read at the top of `receive` can throw over
   * a row that is already there saying `accepted`, with a Ticket behind it. Updating would replace work that exists
   * with a claim that it was dropped. The other row a conflict can find is the one an earlier give-up of the same
   * effect wrote — the same fact, with the error it had then — so a re-delivery of a failing effect adds no second row
   * and rewrites nothing.
   */
  insertLost(lost: LostTrigger): void;
  list(): TriggerRecord[];
  /** Triggers since `at`, newest first, for the panel's flow counts. */
  since(at: string, limit?: number): TriggerRecord[];
}
declare class Projects implements ProjectRepository {
  private readonly db;
  constructor(db: DatabaseSync);
  save(project: Project): void;
  get(id: string): Project | undefined;
  list(): Project[];
  remove(id: string): void;
}
declare class Works implements WorkRepository {
  private readonly db;
  constructor(db: DatabaseSync);
  save(work: Work): void;
  get(id: string): Work | undefined;
  list(): Work[];
  byProject(projectId: string | undefined): Work[];
  remove(id: string): void;
}
declare class Tickets implements TicketRepository {
  private readonly db;
  constructor(db: DatabaseSync);
  /** The Tickets of one Work, in the order they joined it — the ordering the generated column exists to make cheap. */
  byWork(workId: string): Ticket[];
  get(id: string): Ticket | undefined;
  save(ticket: Ticket): void;
  list(): Ticket[];
  open(): Ticket[];
  /** Tickets by state, newest first, for the panel's lists. */
  page(filter: 'open' | 'ended' | 'attention' | 'all' | 'deleted', offset: number, limit: number): Ticket[];
  count(): {
    open: number;
    ended: number;
    attention: number;
  };
  /** Take the row away entirely: the `record: 'nothing'` half of a deletion (S4). */
  remove(id: string): void;
  /** The tombstones, for the one view that shows what was deleted. `list` hides them by design. */
  deleted(): Ticket[];
}
declare class Decisions implements DecisionRepository {
  private readonly db;
  constructor(db: DatabaseSync);
  get(id: string): Decision | undefined;
  save(decision: Decision): void;
  list(limit?: number): Decision[];
  since(at: string, limit?: number): Decision[];
}
/** One queued side effect, as `Effects` reads and writes it. */
interface EffectRow {
  readonly kind: string;
  readonly key: string;
  readonly payload: unknown;
  readonly dueAt: number;
  readonly failures: number;
  readonly running: boolean;
}
/**
 * The database, its repositories and the transaction boundary.
 * The outermost `atomic` opens a transaction and flushes the work registered with `afterCommit` only once it commits;
 * a nested one uses a savepoint, so a command that spans parts rolls back as one.
 */
declare class Store implements Transaction {
  private readonly db;
  private depth;
  private queue;
  /** Deferred actions that threw, newest last, bounded. A Store must never be the only place that knows one failed. */
  readonly deferredFailures: {
    at: string;
    message: string;
  }[];
  /** Wired by the Runtime to the log and the health board, so a lost launch is visible instead of silent. */
  onDeferredError?: (error: unknown) => void;
  readonly triggers: Triggers;
  readonly tickets: Tickets;
  readonly decisions: Decisions;
  readonly artifacts: Artifacts;
  readonly projects: Projects;
  readonly works: Works;
  readonly events: Events;
  readonly dependencies: Dependencies;
  constructor(path: string);
  /** Pragma, schema and version stamp, in the order that keeps a failed upgrade from half-applying. */
  private open;
  /**
   * Bring the file to this build's schema, or refuse it.
   *
   * The version is stamped LAST and everything runs in one transaction, so a step that throws leaves the file at the
   * version it had and the previous build can still open it. That ordering is the whole rollback story: the version
   * number is the only thing that makes an older build refuse a file.
   */
  private migrate;
  atomic<T>(run: () => T): T;
  /**
   * Record a deferred action that threw. Kept even when nobody is listening, because "it was enqueued and then nothing
   * happened" is exactly the silence an unattended system cannot afford.
   */
  private deferredFailed;
  /** The version stamped in the file, or `undefined` when there is nothing readable to migrate from. */
  private readVersion;
  afterCommit(run: () => void): void;
  /** Insert or replace a queued effect; a replacement becomes due at once and keeps the queue's order. */
  enqueueEffect(kind: string, key: string, payload: unknown, dueAt?: number): void;
  /** Due effects of one kind, oldest first, marked running, at most `limit`. */
  claimEffects(kind: string, limit: number, now?: number): EffectRow[];
  /** Drop a settled effect's row. */
  settleEffect(kind: string, key: string): void;
  /** Record a failure and defer the effect to `dueAt`, releasing it for a later claim. */
  failEffect(kind: string, key: string, dueAt: number): void;
  /** Defer an effect without counting a failure, for work that is not runnable yet. */
  deferEffect(kind: string, key: string, dueAt: number): void;
  /** Release every effect this process marked running, which a crash or a shutdown left behind. */
  releaseRunning(): number;
  pendingEffects(kind: string, key: string): boolean;
  effectCounts(): Record<string, number>;
  /** The stored settings document, parsed and defaulted; the defaults when nothing is stored yet. */
  settings(): Settings;
  /** The current settings revision, 0 before the first save. */
  settingsRevision(): number;
  /** Store a settings document and raise its revision; returns the new revision. */
  saveSettings(value: Settings): number;
  get<T = unknown>(key: string): T | undefined;
  set(key: string, value: unknown): void;
  delete(key: string): void;
  /** Every key with a prefix, for a family's records. */
  keys(prefix: string): string[];
  /**
   * Keep one payload the queue gave up on that was not a Trigger this build could read, oldest dropped past the bound.
   *
   * Here rather than in `triggers` because that table's five columns are all NOT NULL and `countBySource` groups by
   * `source` and feeds the panel's intake counts: a row with an invented `source: 'lost'` would put a Source named
   * "lost" on the page whose job is answering where work comes from, and a false statement in an audit surface is worse
   * than a missing one. What is left to say is the text itself, so it is kept, bounded, and not pretending to be more.
   */
  pushLostPayload(entry: {
    at: string;
    effectKey: string;
    error: string;
    payload: string;
  }): void;
  /** The payloads `pushLostPayload` kept, oldest first. */
  lostPayloads(): LostPayload[];
  close(): void;
}
/** The roles that have a prompt of their own. */
type PromptRole = 'worker' | 'orchestrator' | 'triage';
/**
 * Resolve a file this package ships, from wherever this module ended up.
 *
 * The build bundles everything into `lib/index.js`, while tests and a source checkout run `src/app/prompts.ts`, so the
 * distance to the package root is not one number: both are probed, and the first that holds the file wins.
 * @param relative a path relative to the package root, such as `prompts/worker.md`.
 * @throws when the installation does not ship it.
 */
declare function packageFile(relative: string): string;
/** The path of a built-in prompt file. @throws when the installation does not ship it. */
declare function promptFile(role: PromptRole): string;
/**
 * Derive a stable id from its inputs.
 * A Source computes a Trigger's id from the facts that make the event unique (its schedule slot, or a file's
 * path, mtime and size), so a restart that observes the same event again cannot create a second Ticket.
 * @param parts - JSON-serializable inputs; their order matters.
 * @returns a 32-character hex digest.
 */
declare function key(...parts: unknown[]): string;
/** A short, filesystem-safe slug of `text`, at most `max` characters, for directory and file names. */
declare function slug(text: string, max?: number): string;
/** Fixed refusals: a refusal a person or an agent can cause, worded the same way everywhere it surfaces. */
/** Every code the Engine and the management API may refuse with. */
declare const USER_ERRORS: {
  readonly ticket_missing: "No Ticket has this id";
  readonly ticket_ended: "This Ticket has ended; new work needs a new Ticket";
  readonly ticket_not_running: "No Assignment of this Ticket is running";
  readonly assignment_stale: "Another Assignment took this Ticket over";
  readonly retry_refused: "This Ticket does not wait for a person, so there is nothing to retry";
  readonly stop_refused: "This Ticket has already ended";
  readonly trigger_missing: "No Trigger has this id";
  readonly input_missing: "No such input on this Ticket";
  readonly project_missing: "No Project has this id";
  readonly work_missing: "No Work has this id";
  readonly ticket_not_stopped: "That Ticket has not ended; stop it before deleting it";
  readonly empty_name: "A name cannot be empty";
  readonly collaboration_refused: "Only Tickets in the same Work — or two Tickets that belong to no Work at all — can hand something to each other";
  readonly empty_text: "There is nothing to hand over: the text is empty";
  readonly artifact_missing: "No artifact of that Ticket is registered under this path";
  readonly artifact_unreachable: "That Ticket has no directory to read the artifact from";
  readonly decision_missing: "No decision has that id";
  readonly dependency_cycle: "That would make a Ticket wait for itself, directly or through others";
  readonly dependency_upstream_ended: "That Ticket already ended without succeeding, so waiting for its success would never be released";
  readonly reply_unroutable: "That reply has nowhere to go: its channel is gone or disabled";
  readonly reply_unreceivable: "No Source is running that can take this reply back";
};
type UserErrorCode = keyof typeof USER_ERRORS;
/**
 * A refusal with a fixed code and the values its wording needs.
 * The management API answers it with 400, or 404 for `*_missing`, and the panel words the code in its own language.
 */
declare class UserError extends Error {
  readonly code: UserErrorCode;
  readonly values: Record<string, unknown>;
  constructor(code: UserErrorCode, values?: Record<string, unknown>);
  /** Whether this code names something that is absent, which the API answers with 404. */
  get missing(): boolean;
}
/** In-memory {@link Repositories} and {@link Transaction} with the same commit and rollback behaviour as the Store. */
declare class Memory implements Repositories, Transaction {
  private readonly triggerStore;
  private readonly ticketStore;
  private readonly decisionStore;
  private readonly artifactStore;
  private readonly projectStore;
  private readonly workStore;
  private readonly eventStore;
  private readonly dependencyStore;
  private queue;
  private depth;
  /** Deferred actions that threw, newest last. The same field the Store keeps, so both are inspectable alike. */
  readonly deferredFailures: {
    at: string;
    message: string;
  }[];
  onDeferredError?: (error: unknown) => void;
  readonly triggers: TriggerRepository;
  readonly tickets: TicketRepository;
  readonly decisions: DecisionRepository;
  readonly artifacts: ArtifactRepository;
  readonly projects: ProjectRepository;
  readonly works: WorkRepository;
  readonly events: EventRepository;
  readonly dependencies: DependencyRepository;
  /**
   * Structurally identical to `Store.atomic`, on purpose: every domain test runs on this class, so a divergence here
   * is a suite that stays green while production behaves differently. `tests/transaction.spec.ts` runs the same
   * assertions against both, which is what keeps the two from drifting apart again.
   */
  atomic<T>(run: () => T): T;
  private deferredFailed;
  afterCommit(run: () => void): void;
  /** Every Trigger stored, in insertion order. */
  triggerList(): TriggerRecord[];
  /** Every Ticket stored, in insertion order. */
  ticketList(): Ticket[];
  /** Every Decision stored, newest first. */
  decisionList(limit?: number): DecisionRecord[];
  /** The Trigger stored under `id`, when there is one. */
  triggerOf(id: string): Trigger | undefined;
}
/**
 * Health: one line per part that can go wrong, so the panel shows a problem where it happened instead of a stack
 * trace somewhere else. A healthy part takes no space.
 */
/** What one part reports about itself. */
interface HealthState {
  readonly ok: boolean;
  readonly detail?: string;
  readonly at?: string;
}
/** One part's health, written by that part and read by the panel. */
declare class HealthEntry {
  private state;
  /** Record that this part works, clearing any problem it reported. */
  record(detail?: string): void;
  /** Record what is wrong now; the problem stays until this part records success again. */
  problem(detail: string): void;
  snapshot(): HealthState;
}
/** The health of every part that reports one, keyed by the name the panel shows. */
declare class HealthBoard {
  private readonly entries;
  entry(name: string): HealthEntry;
  /** Every part that is not ok; an empty list is the healthy state the panel does not render. */
  problems(): {
    readonly name: string;
    readonly detail: string;
    readonly at?: string;
  }[];
  snapshot(): Record<string, HealthState>;
}
/** Thrown by a handler whose work is not runnable yet; the effect is deferred without counting a failure. */
declare class Later extends Error {
  readonly retryAfterMs: number;
  constructor(retryAfterMs?: number);
}
/** What a handler does with one payload: settle it, defer it with `Later`, or fail it by throwing. */
type EffectHandler = (payload: unknown) => void | Promise<void> | Later;
interface EffectsOptions {
  /** How far a retry may be deferred; a failure backs off exponentially up to this. */
  readonly backoffMs?: number;
  /** Attempts before a failure becomes permanent; a `Later` never counts against it. */
  readonly tries?: number;
  /** The interval a `Later` without its own wait uses. */
  readonly retryIntervalMs?: number;
  /** Called when an effect gives up, so the Ticket can show it instead of retrying forever. */
  readonly onPermanentFailure?: (kind: string, key: string, payload: unknown, error: unknown) => void;
  /** The health entry failures are recorded on. */
  readonly health?: HealthEntry;
  /** Ends every wait when the host stops. */
  readonly lifetime?: AbortSignal;
}
declare class Effects {
  private readonly store;
  private readonly handlers;
  private running;
  private readonly backoffMs;
  private readonly tries;
  private readonly retryIntervalMs;
  private readonly onPermanentFailure?;
  private readonly health?;
  private readonly lifetime?;
  private disposed;
  /** Set by a failure in the pass now running, so that pass cannot end by erasing what it just reported. */
  private complained;
  /**
   * The rows this queue has reported a failure for, kept until the row behind each is gone.
   *
   * The pass flag alone is not enough, and the reason is measured rather than tasted: a failure defers its row into a
   * 15 s backoff, so the pass after it claims nothing and is "quiet" in the sense that flag measures. Summarizing from
   * such a pass would erase the line about work that has already failed once and is still queued to fail again — a
   * false all-clear in place of the false alarm this removes. A row that is still in the queue is a problem that is
   * not over, and `pendingEffects` is the port's own answer to "is it still there".
   */
  private readonly unresolved;
  constructor(store: Pick<Store, 'enqueueEffect' | 'claimEffects' | 'settleEffect' | 'failEffect' | 'deferEffect' | 'pendingEffects'>, options?: EffectsOptions);
  /** The handler of one kind of effect; registering twice replaces the handler. */
  handle(kind: string, handler: EffectHandler): void;
  /** Queue one effect, or replace the pending one of the same identity. */
  enqueue(kind: string, key: string, payload: unknown, runAt?: Date): void;
  pending(kind: string, key: string): boolean;
  /**
   * Run what is due, one pass at a time: a pass already running owns the queue, and a pass asked for during it runs
   * once more after it, so a caller never waits behind an unrelated pass.
   */
  runDue(): Promise<void>;
  /**
   * One problem on this queue's own health entry, remembered as unresolved.
   *
   * Every `problem` call in this file goes through here: a summary written at the end of a pass that did not know what
   * failed in it erases the failure in the same pass that found it, which is how the cron Source used to hide its own
   * alarm (`sources/rule.ts:101-103` states the same rule for the same reason).
   */
  private complain;
  /**
   * Say that the queue is fine, when this pass is evidence of it: nothing failed in it, and nothing it reported a
   * failure for earlier is still queued. The second half is what keeps the line honest in both directions — a
   * give-up settles its row, so the pass after it clears the board by itself and no permanent alarm survives, while a
   * row still backing off keeps its line until the attempt that resolves it.
   */
  private summarize;
  private settle;
  /** Stop the pump; queued rows stay in the Store for the next start. */
  dispose(): void;
}
/** What a Source reports about itself, for the panel; a healthy Source takes no space. */
interface SourceStatus {
  readonly ok: boolean;
  readonly detail?: string;
  /** The instant this Source next produces a Trigger, when it knows one. */
  readonly next?: number;
  readonly lastTriggerAt?: string;
  readonly counts?: Record<string, number>;
}
/** A Source's own read position, which only that Source writes and a restart must not replay. */
interface Cursor {
  get<T>(): T | undefined;
  set<T>(value: T): void;
}
/** Everything a Source may touch. It cannot reach the Store, the Sessions or the Executor. */
interface SourceHost {
  readonly engine: Engine;
  readonly effects: Effects;
  readonly health: HealthBoard;
  readonly lifetime: AbortSignal;
  /** The settings as they are now; a Source reads its own part on each pass. */
  settings(): Settings;
  /** Ask for a pass now, after queueing work. */
  requestPass(): void;
  /** The read position of the Source this host was built for. */
  cursor(id: string): Cursor;
  /**
   * Watch what the Engine does, and stop watching.
   *
   * A Source that produces from events rather than from a timer or a directory needs a subscription, and it needs it
   * here rather than by reaching for the Runtime: everything a Source can touch comes through this interface, which is
   * what keeps "one Source cannot do what another can" a fact about the code rather than about discipline.
   */
  subscribe(listener: (event: DomainEvent) => void): () => void;
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
interface Source {
  readonly id: string;
  readonly kind: SourceKindName;
  start(): void | Promise<void>;
  stop(): void | Promise<void>;
  /**
   * Look now, rather than at the next scheduled moment. Optional: a Source with nothing to look at omits it.
   *
   * This is what the panel's "run a pass" asks of a Source, and what makes dropping a file into the inbox take effect
   * at once instead of up to one poll interval later.
   */
  poll?(): void | Promise<void>;
  status(): SourceStatus;
}
/** A reusable Source implementation. */
interface SourceKind {
  readonly name: SourceKindName;
  create(host: SourceHost): Source;
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
interface DeliverOptions {
  readonly ticketId?: string;
  readonly files?: readonly string[];
}
interface TwoWaySource extends Source {
  /** Deliver a message back to the platform. Called by the effects queue, so it may be retried. */
  deliver(replyTo: ReplyTo, text: string, options?: DeliverOptions): Promise<void>;
}
declare const name = "myagent";
/** The services this plugin reads: agents and their Sessions, the tools and prompt registries, the web server, subprocesses. */
declare const inject: string[];
/**
 * Mount myagent. This function never rejects and never touches a Session.
 *
 * A bundle that cannot start is a bundle that does nothing: it logs, marks itself unhealthy and leaves the host alone.
 * Mounting is also the wrong moment to create a Session — an agent born during activation is torn down with it if the
 * host's startup fails, which puts a plugin's mistake into the host's own shutdown path. The main Session is created
 * on demand instead, from the panel or from the first Ticket somebody opens in it.
 */
declare function apply(ctx: Context, config: DeploymentConfig): Promise<void>;
export { Actor, Artifact, ArtifactRepository, Assignment, AssignmentState, Attachment, Attention, Config, CronSpec, Cursor, Decision, DecisionOutcome, DecisionRecord, DecisionRepository, DeliverOptions, Delivery, Dependency, DependencyRepository, type DeploymentConfig, Disposition, DomainEvent, Engine, EngineOptions, EventRepository, Execution, Executor, GATE_REASONS, GateReason, GateVerdict, InputBy, LostTrigger, type Machine, Mandate, MandateVia, Memory, Policy, PolicyEffect, Project, ProjectRepository, ReceiveResult, ReplyTo, Report, ReportState, Repositories, Schedule, ScheduleSchema, Settings, SettingsSchema, Source, SourceHost, SourceKind, SourceKindName, SourceStatus, Strength, Ticket, TicketEnded, TicketEvent, TicketEventType, TicketInput, TicketNote, TicketOutcome, TicketRepository, TicketResult, TicketStage, Timing, Transaction, Trigger, TriggerRecord, TriggerRepository, TwoWaySource, USER_ERRORS, UserError, UserErrorCode, Work, WorkRepository, ZoneParts, apply, artifactPath, attachmentsOf, canCollaborate, canRetry, describeTiming, gate, inject, key, knownTimeZone, latestAssignment, latestReport, liveTicket, localToUtc, localZone, lostTriggerOf, name, nextCron, nextRun, packageFile, parseCron, parseSettings, parseTime, payloadText, policyEffects, policyVersion, promptFile, released, runningAssignment, settingsPolicy, slug, sourcePolicy, ticketIdOf, ticketStage, undelivered, waitsForPerson, zoneParts };