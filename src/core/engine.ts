/**
 * The Engine: the only writer of Triggers, Decisions, Tickets and Assignments.
 *
 * Every command changes its aggregates inside one transaction and registers its external work with `afterCommit`, so
 * a rolled-back command leaves no launched worker and no sent notification behind. All methods are synchronous: the
 * ports they call enqueue durable work rather than performing it.
 */
import { key } from './ids.ts'
import { UserError } from './errors.ts'
import {
  type Artifact, type Dependency, type Project, type TicketEvent, type TicketEventType, type Work,
  canRetry, latestAssignment, liveTicket, released, runningAssignment, type Assignment, type Attachment, type Decision,
  type Disposition,
  type Mandate, type Report, type Ticket, type TicketInput, type TicketOutcome, type Trigger,
} from './model.ts'
import { GATE_REASONS, policyEffects, type Policy, type PolicyEffect } from './policy.ts'
import type { Settings } from './policy.ts'

/** One stored Trigger with what became of it. */
export interface TriggerRecord {
  readonly trigger: Trigger
  readonly disposition: Disposition
}

/**
 * A request the queue gave up on, in the pieces a `triggers` row can honestly be made of.
 *
 * The four identity fields are the columns that table declares NOT NULL, and they come out of the payload rather than
 * being invented: a row that named its own source `'lost'` would add a Source called "lost" to `countBySource`, which
 * feeds the panel's intake counts, and that page's whole job is answering where work comes from. A payload that cannot
 * fill these four is not stored as a Trigger at all — see `lostTriggerOf`.
 */
export interface LostTrigger {
  readonly id: string
  readonly source: string
  readonly kind: string
  readonly at: string
  /** Why the queue gave up, as text. */
  readonly error: string
  /** The queue row this came from: after a give-up it is the only other name for the request that survives. */
  readonly effectKey: string
  /**
   * The payload exactly as it arrived. Not a re-serialized Trigger, because this row promises the four columns beside
   * it and nothing else — a reader must not dereference another field of it.
   */
  readonly raw: string
}

export interface TriggerRepository {
  get(id: string): TriggerRecord | undefined
  save(record: TriggerRecord): void
  list(): TriggerRecord[]
  /**
   * Store one Trigger the queue gave up on, and leave a row that is already there alone.
   *
   * Optional the way `Delivery.send` is: an implementation with nowhere to put one says so by not having it, and
   * `Engine.triggerLost` answers that to its caller instead of letting the caller believe a trace was written.
   * A conflict must not be an update — the row that is already there may be one `receive` wrote.
   */
  insertLost?(lost: LostTrigger): void
}

export interface TicketRepository {
  get(id: string): Ticket | undefined
  save(ticket: Ticket): void
  list(): Ticket[]
  /** Open Tickets, oldest first. */
  open(): Ticket[]
  /** The Tickets of one Work, in the order they joined it. */
  byWork(workId: string): Ticket[]
}

/** What the Engine can do with the edges between Tickets. */
export interface DependencyRepository {
  save(dependency: Dependency): void
  delete(upstream: string, downstream: string): void
  /** What a Ticket waits for. */
  upstreamOf(downstream: string): Dependency[]
  /** What waits for a Ticket. */
  downstreamOf(upstream: string): Dependency[]
  /** Every edge, for a cycle check. */
  list(): Dependency[]
}

/** What the Engine can do with the log of what happened to a Ticket. */
export interface EventRepository {
  /** Append one fact and answer it with the position it took in this Ticket's history. */
  append(event: Omit<TicketEvent, 'seq'>): TicketEvent
  /** A Ticket's history, oldest first. */
  list(ticketId: string): TicketEvent[]
}

/** What the Engine can do with the standing groups of Work. */
export interface ProjectRepository {
  save(project: Project): void
  get(id: string): Project | undefined
  list(): Project[]
}

/** What the Engine can do with the streams of tasks that Tickets belong to. */
export interface WorkRepository {
  save(work: Work): void
  get(id: string): Work | undefined
  list(): Work[]
  /** The Works of one Project, oldest first; an absent `projectId` asks for the Works in no Project. */
  byProject(projectId: string | undefined): Work[]
}

export interface DecisionRepository {
  get(id: string): DecisionRecord | undefined
  save(decision: DecisionRecord): void
  /** Decisions, newest first, at most `limit`. */
  list(limit?: number): DecisionRecord[]
}

/** A Decision as stored; the record type is the model's Decision. */
export type DecisionRecord = Decision

/** What the Engine can do with the artifacts a Ticket's work produced. */
export interface ArtifactRepository {
  /** Register or re-register one path; the newest report's claim about a path replaces the older one. */
  save(artifact: Artifact): void
  /** A Ticket's artifacts, in the order their registering reports arrived. */
  list(ticketId: string): Artifact[]
}

export interface Repositories {
  readonly triggers: TriggerRepository
  readonly tickets: TicketRepository
  readonly decisions: DecisionRepository
  readonly artifacts: ArtifactRepository
  readonly projects: ProjectRepository
  readonly works: WorkRepository
  readonly events: EventRepository
  readonly dependencies: DependencyRepository
}

/** The transaction boundary the Engine writes inside, and the hook that runs work only after it commits. */
export interface Transaction {
  atomic<T>(run: () => T): T
  /** Register work to run after the enclosing transaction commits; never after a rollback. */
  afterCommit(run: () => void): void
}

/** The Executor port: what the Engine asks of whatever runs Assignments. */
export interface Executor {
  /** Fill in a new Ticket's execution metadata (name and directory) before its first Assignment launches. */
  prepare(ticket: Ticket, mandate: Mandate): Ticket
  /** Launch a pending Assignment. */
  start(ticket: Ticket, assignment: Assignment): void
  /** Hand a running Assignment the Ticket's waiting Inputs. */
  deliver(ticket: Ticket, assignment: Assignment): void
  /** Stop a running Assignment's work. */
  stop(ticket: Ticket, assignment: Assignment, reason: string): void
}

/** The Delivery port: where a Report worth telling someone about goes. */
export interface Delivery {
  report(ticket: Ticket, report: Report): void
  /** A settings change that bears on a live Ticket. */
  policyChanged?(ticket: Ticket, effect: PolicyEffect): void
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
  send?(ticket: Ticket, text: string): void
}

export type DomainEvent =
  | { readonly type: 'trigger.received'; readonly triggerId: string; readonly disposition: Disposition }
  | { readonly type: 'ticket.created'; readonly ticket: Ticket }
  | { readonly type: 'ticket.resumed'; readonly ticket: Ticket }
  | { readonly type: 'ticket.ended'; readonly ticket: Ticket }
  | { readonly type: 'assignment.started'; readonly ticketId: string; readonly assignmentId: string }
  | { readonly type: 'assignment.ended'; readonly ticketId: string; readonly assignmentId: string }
  | { readonly type: 'report.recorded'; readonly ticket: Ticket; readonly report: Report }
  | { readonly type: 'policy.changed'; readonly effects: readonly PolicyEffect[] }

export interface EngineOptions {
  readonly repos: Repositories
  readonly tx: Transaction
  /** The current Policy, read fresh on each command so a settings change takes effect at once. */
  readonly policy: () => Policy
  readonly executor: Executor
  readonly delivery: Delivery
  readonly now?: () => string
  readonly emit?: (event: DomainEvent) => void
}

/** What `receive` answers: whether the Trigger was new, and what became of it. */
export interface ReceiveResult {
  readonly stored: 'stored' | 'duplicate'
  readonly disposition: Disposition
  readonly ticketId?: string
}

/** Replace the last Assignment of `ticket`, or append when it has none. */
function withAssignment(ticket: Ticket, assignment: Assignment): Ticket {
  const assignments = ticket.assignments.slice()
  const index = assignments.findIndex(item => item.id === assignment.id)
  if (index === -1) assignments.push(assignment)
  else assignments[index] = assignment
  return { ...ticket, assignments }
}

const ended = (ticket: Ticket, at: string, by: 'person' | 'agent' | 'system', outcome: TicketOutcome, reason: string): Ticket =>
  ({ ...ticket, ended: { at, by, outcome, reason } })

/**
 * The domain's entry point. Sources call `receive`; the main Session calls `createTicket`, `answer`, `note` and
 * `stopTicket`; people call `stopTicket` and `retryTicket`; the Executor reports facts in the past tense.
 */
export class Engine {
  private readonly repos: Repositories
  private readonly tx: Transaction
  private readonly executor: Executor
  private readonly delivery: Delivery
  private readonly now: () => string
  private readonly emit: (event: DomainEvent) => void
  private readonly policyOf: () => Policy

  constructor(private readonly options: EngineOptions) {
    this.repos = options.repos
    this.tx = options.tx
    this.executor = options.executor
    this.delivery = options.delivery
    this.now = options.now ?? (() => new Date().toISOString())
    // Every event is published after its transaction commits, at every call site, by wrapping the listener here rather
    // than by moving twelve `emit` calls. The production listener starts a pass, and a pass claims effect rows and runs
    // their handlers: inside the transaction that means building directories and copying attachments for state that has
    // not been committed, and a rollback would leave that work behind — which is what the guarantee at the top of this
    // file promises cannot happen. Six of the eight event kinds used to be emitted inside their transaction.
    const publish = options.emit ?? ((): void => {})
    this.emit = event => this.tx.afterCommit(() => publish(event))
    this.policyOf = options.policy
  }

  // ---------------------------------------------------------------- Sources

  /**
   * Store a Source's Trigger once and answer what became of it.
   * The gate runs in the same transaction, so an accepted Trigger and its Ticket, Mandate, Decision and first
   * Assignment all exist together or not at all. A Trigger whose id is already stored is a duplicate: the same event
   * observed again after a restart, which creates no second Ticket. A row left by `triggerLost` is the one exception,
   * and the reason is below.
   */
  receive(trigger: Trigger): ReceiveResult {
    const existing = this.repos.triggers.get(trigger.id)
    // A row that says `lost` is not a duplicate, so the gate runs again and `save` below replaces it with the
    // disposition this attempt earns. Answering `duplicate` for it would tell the caller "already handled", which is
    // the opposite of the fact on the row, and every Source's catch-all branch reads "not accepted, not observed, not
    // ignored" as exactly that: the inbox would archive the file under `accepted/` with no Ticket behind it
    // (sources/inbox.ts:239-242), chat would file the message the same way (sources/chat.ts:385-386), and cron would
    // count it a duplicate and advance past the slot it came from (sources/cron.ts:194-196). Re-running is safe rather
    // than duplicative because a `lost` row can only exist where `receive` threw, and everything it writes is inside the
    // one transaction below: no Ticket and no Decision ever committed, so there is nothing to make a second of.
    if (existing !== undefined && existing.disposition.state !== 'lost') {
      return { stored: 'duplicate', disposition: existing.disposition, ticketId: ticketIdOf(existing.disposition) }
    }
    return this.tx.atomic(() => {
      const policy = this.policyOf()
      const at = this.now()
      const verdict = policy.gate(trigger)
      const decisionId = key('decision', trigger.id)
      if (!verdict.allow || verdict.observe) {
        const decision: Decision = {
          id: decisionId, triggerId: trigger.id, outcome: verdict.allow ? 'observe' : 'ignore', at,
          reason: verdict.reason, detail: verdict.detail, policyVersion: policy.version,
        }
        const disposition: Disposition = verdict.allow
          ? { state: 'observed', decisionId } : { state: 'ignored', decisionId }
        this.repos.decisions.save(decision)
        this.repos.triggers.save({ trigger, disposition })
        this.emit({ type: 'trigger.received', triggerId: trigger.id, disposition })
        return { stored: 'stored' as const, disposition }
      }
      const mandate: Mandate = {
        policyVersion: policy.version, scope: verdict.scope, strength: verdict.strength,
        sender: trigger.actor, via: verdict.via, at,
      }
      const ticketId = key('ticket', trigger.id)
      const assignment: Assignment = { id: key('assignment', ticketId, 1), state: 'pending', createdAt: at }
      // A Trigger may name the Work its Ticket belongs to — a rule's `then.workId`, or a schedule bound to one later.
      // Classified here rather than by a follow-up command so that it is part of the same fact as the Ticket's
      // creation: a rule-produced Ticket that belongs to no Work is invisible in every grouping the operator has.
      const wantedWork = typeof trigger.meta?.work === 'string' && trigger.meta.work !== '' ? trigger.meta.work : undefined
      const workMissing = wantedWork !== undefined && this.repos.works.get(wantedWork) === undefined
      const classification = wantedWork === undefined || workMissing
        ? {}
        : { workId: wantedWork, workSeq: this.repos.tickets.byWork(wantedWork).length + 1 }
      const prepared = this.executor.prepare(
        {
          id: ticketId, title: trigger.title.slice(0, 200) || 'Untitled task', createdAt: at, mandate,
          origin: {
          triggerId: trigger.id,
          // Carried onto the Ticket rather than left in `meta`, because the depth guard has to be answerable from the
          // Ticket alone: a rule reads the event, and the event carries the Ticket, not the Trigger that made it.
          ...(typeof trigger.meta?.depth === 'number' ? { depth: trigger.meta.depth } : {}),
        }, attachments: attachmentsOf(trigger),
          assignments: [assignment], notes: [], inputs: [], ...classification,
        }, mandate)
      this.repos.tickets.save(prepared)
      const decision: Decision = {
        id: decisionId, triggerId: trigger.id, outcome: 'accept', at, reason: verdict.reason,
        ticketId, policyVersion: policy.version,
      }
      this.repos.decisions.save(decision)
      const disposition: Disposition = { state: 'accepted', ticketId, decisionId }
      this.repos.triggers.save({ trigger, disposition })
      this.emit({ type: 'trigger.received', triggerId: trigger.id, disposition })
      this.record(prepared.id, 'created', { kind: trigger.actor.kind, id: trigger.actor.id },
        { triggerId: trigger.id, via: prepared.mandate.via, title: prepared.title })
      if (wantedWork !== undefined) {
        // A rule pointing at a Work that does not exist is a configuration mistake, and it is recorded rather than
        // dropped: the alternative is a Ticket that silently never shows up where it was supposed to.
        this.record(ticketId, 'classified', { kind: 'system' },
          workMissing ? { workId: wantedWork, missing: true } : classification)
      }
      this.emit({ type: 'ticket.created', ticket: prepared })
      const first = latestAssignment(prepared)
      if (first !== undefined) this.tx.afterCommit(() => this.executor.start(prepared, first))
      return { stored: 'stored' as const, disposition, ticketId }
    })
  }

  // ------------------------------------------------------- The main Session

  /**
   * Create a Ticket from a request the main Session received from a person, bypassing no rule: the Trigger it builds
   * goes through `receive`, so the gate, the accept mode and the allowed list apply exactly as they do to any Source.
   */
  createTicket(request: {
    title: string; text: string; sender?: string; scope?: string; attachments?: readonly string[]
  }): ReceiveResult {
    const at = this.now()
    const attachments = (request.attachments ?? []).filter(path => path.trim() !== '')
    const trigger: Trigger = {
      // The attachments are part of what is being asked for, so two requests that differ only in their files are
      // different requests and must not collapse into one Ticket.
      id: key('session', request.text, request.title, at, request.sender ?? 'operator', attachments),
      source: 'session', kind: 'session', at,
      actor: { id: request.sender ?? 'operator', kind: 'person' },
      text: request.text, title: request.title,
      meta: {
        ...(request.scope === undefined ? {} : { scope: request.scope }),
        ...(attachments.length === 0 ? {} : { attachments }),
      },
    }
    return this.receive(trigger)
  }

  /**
   * Give a Ticket's worker a fact from elsewhere as a text Input. It grants nothing: the Mandate is the only
   * authorization, and a note never widens it.
   */
  note(ticketId: string, text: string): Ticket {
    return this.addInput(ticketId, { kind: 'note', text })
  }

  /**
   * A person's answer to a Ticket that waits: it clears the question, delivers the text, and starts a new Assignment
   * when the previous one ended. The Mandate is unchanged, so the work stays within its scope.
   */
  answer(ticketId: string, text: string): Ticket {
    return this.tx.atomic(() => {
      const ticket = this.require(ticketId)
      if (!liveTicket(ticket)) throw new UserError('ticket_ended')
      const at = this.now()
      const input: TicketInput = { id: key('input', ticketId, text, at), kind: 'text', text, at }
      let next: Ticket = { ...ticket, attention: undefined, inputs: [...ticket.inputs, input] }
      const current = latestAssignment(next)
      if (current === undefined || current.state === 'ended') {
        const assignment: Assignment = { id: key('assignment', ticketId, next.assignments.length + 1), state: 'pending', createdAt: at }
        next = { ...next, assignments: [...next.assignments, assignment] }
      }
      this.repos.tickets.save(next)
      this.record(ticketId, 'input', { kind: 'person' }, { kind_of_input: 'answer' })
      this.emit({ type: 'ticket.resumed', ticket: next })
      const assignment = latestAssignment(next)
      if (assignment !== undefined) {
        this.tx.afterCommit(() => assignment.state === 'pending'
          ? this.executor.start(next, assignment) : this.executor.deliver(next, assignment))
      }
      return next
    })
  }

  /**
   * Let one Ticket's worker hand a fact to another Ticket, through the Engine and nothing else.
   *
   * Two rules make this safe to give a model. The boundary is the Work: two Tickets may talk only when they belong to
   * the same one, which is a stored fact rather than a sentence in a prompt, so a worker cannot widen it by arguing.
   * And the hand-off is an Input on the target, delivered by the same machinery a person's note uses — never a
   * message into the other Session and never a file in a shared directory, because both of those would leave the
   * Engine unable to say who told whom what.
   */
  noteFromWorker(sourceTicketId: string, targetTicketId: string, text: string): Ticket {
    return this.tx.atomic(() => {
      const source = this.require(sourceTicketId)
      const target = this.require(targetTicketId)
      if (sourceTicketId === targetTicketId) throw new UserError('collaboration_refused')
      if (source.workId === undefined || source.workId !== target.workId) throw new UserError('collaboration_refused')
      if (!liveTicket(source)) throw new UserError('ticket_ended')
      const body = text.trim()
      if (body === '') throw new UserError('empty_text')
      // Nested `atomic` is a savepoint inside this transaction, so the hand-off and the record of making it commit
      // or roll back together.
      const next = this.addInput(targetTicketId, { kind: 'note', text: body, by: { kind: 'agent', id: sourceTicketId } })
      this.record(sourceTicketId, 'input', { kind: 'agent', id: sourceTicketId }, { handed_to: targetTicketId })
      return next
    })
  }

  /** Add an Input to an open Ticket and hand it to the running Assignment, or hold it for the next launch. */
  private addInput(ticketId: string, input: { kind: 'note' | 'text'; text: string; by?: TicketInput['by'] }): Ticket {
    return this.tx.atomic(() => {
      const ticket = this.require(ticketId)
      if (!liveTicket(ticket)) throw new UserError('ticket_ended')
      const at = this.now()
      const record: TicketInput = {
        id: key('input', ticketId, input.kind, input.text, at), kind: input.kind, text: input.text, at,
        ...(input.by === undefined ? {} : { by: input.by }),
      }
      this.record(ticketId, 'input', input.by ?? { kind: 'person' }, { input: input.kind })
      const next: Ticket = { ...ticket, inputs: [...ticket.inputs, record] }
      this.repos.tickets.save(next)
      const assignment = runningAssignment(next)
      if (assignment !== undefined) this.tx.afterCommit(() => this.executor.deliver(next, assignment))
      return next
    })
  }

  // ---------------------------------------------------------------- People

  /**
   * A person's stop, which withdraws the Mandate: the Ticket ends `stopped`, its worker's turn is cancelled and its
   * background work stops. The stop message itself is never re-evaluated.
   */
  stopTicket(ticketId: string, reason = 'A person stopped this Ticket'): Ticket {
    return this.tx.atomic(() => {
      const ticket = this.require(ticketId)
      if (!liveTicket(ticket)) throw new UserError('stop_refused')
      const at = this.now()
      const assignment = runningAssignment(ticket)
      this.record(ticketId, 'stopped', { kind: 'person' }, { reason })
      let next = ended(ticket, at, 'person', 'stopped', reason)
      if (assignment !== undefined) {
        next = withAssignment(next, { ...assignment, state: 'ended', endedAt: at, endedReason: 'stopped' })
      }
      this.repos.tickets.save(next)
      if (assignment !== undefined) {
        this.tx.afterCommit(() => {
          this.executor.stop(next, assignment, reason)
          this.emit({ type: 'assignment.ended', ticketId, assignmentId: assignment.id })
        })
      }
      this.emit({ type: 'ticket.ended', ticket: next })
      return next
    })
  }

  /**
   * End the stalled Assignment of a Ticket that waits for a person — after a `failed` or `blocked` Report, or a
   * failed Input delivery — and start a fresh one that continues from the same directory.
   */
  retryTicket(ticketId: string): Ticket {
    return this.tx.atomic(() => {
      const ticket = this.require(ticketId)
      if (!liveTicket(ticket)) throw new UserError('ticket_ended')
      if (!canRetry(ticket)) throw new UserError('retry_refused')
      const at = this.now()
      const stalled = latestAssignment(ticket)
      // An attempt that never started is pushed again as it is. Ending it and opening another would leave two
      // Assignments for one attempt, and the launch already queued for the first would only learn it was replaced.
      if (stalled !== undefined && stalled.state === 'pending') {
        const pushed: Ticket = { ...ticket, attention: undefined }
        this.record(ticketId, 'retried', { kind: 'person' }, { assignmentId: pushed.assignments.at(-1)!.id })
        this.repos.tickets.save(pushed)
        this.tx.afterCommit(() => this.executor.start(pushed, stalled))
        return pushed
      }
      let next: Ticket = { ...ticket, attention: undefined }
      if (stalled !== undefined && stalled.state !== 'ended') {
        next = withAssignment(next, { ...stalled, state: 'ended', endedAt: at, endedReason: 'retried' })
      }
      const assignment: Assignment = { id: key('assignment', ticketId, next.assignments.length + 1), state: 'pending', createdAt: at }
      next = { ...next, assignments: [...next.assignments, assignment] }
      // Both retry paths record, because both replace what a person is looking at: one pushes the same attempt again,
      // this one ends a stalled attempt and opens another.
      this.record(ticketId, 'retried', { kind: 'person' }, { assignmentId: assignment.id, replaced: stalled?.id })
      this.repos.tickets.save(next)
      this.tx.afterCommit(() => this.executor.start(next, assignment))
      return next
    })
  }

  /** Dismiss a Decision the panel shows as a problem, which the Decision records. */
  dismiss(decisionId: string): void {
    this.tx.atomic(() => {
      const decision = this.repos.decisions.get(decisionId)
      // Was `trigger_missing`, which named the wrong thing: this is a Decision nobody has heard of, and an error code
      // that points at a different entity sends whoever reads it looking in the wrong table.
      if (decision === undefined) throw new UserError('decision_missing', { decisionId })
      this.repos.decisions.save({ ...decision, detail: `${decision.detail ?? ''}\n[dismissed]`.trim() })
    })
  }

  // -------------------------------------------------------------- Executor

  /** An Assignment runs; its waiting Inputs go out. */
  assignmentStarted(ticketId: string, assignmentId: string): void {
    this.mutate(ticketId, ticket => {
      const assignment = ticket.assignments.find(item => item.id === assignmentId)
      if (assignment === undefined || assignment.state !== 'pending') return ticket
      const next = withAssignment(ticket, { ...assignment, state: 'running', startedAt: this.now(), deliveryError: undefined })
      this.record(ticketId, 'launched', { kind: 'system' }, { assignmentId })
      this.emit({ type: 'assignment.started', ticketId, assignmentId })
      return next
    })
  }

  /** Inputs reached the Executor Session, where each waits for a step to take it. */
  inputsDelivered(ticketId: string, assignmentId: string, inputIds: readonly string[]): void {
    this.mutate(ticketId, ticket => {
      const assignment = ticket.assignments.find(item => item.id === assignmentId)
      if (assignment === undefined || assignment.state !== 'running') return ticket
      const at = this.now()
      const ids = new Set(inputIds)
      return {
        ...withAssignment(ticket, { ...assignment, deliveredAt: at, deliveryError: undefined }),
        inputs: ticket.inputs.map(input => ids.has(input.id) ? { ...input, deliveredAt: at } : input),
      }
    })
  }

  /** Delivering Inputs failed; the Ticket shows it until a delivery succeeds, a new Assignment starts or it ends. */
  deliveryFailed(ticketId: string, assignmentId: string, error: string): void {
    this.mutate(ticketId, ticket => {
      const assignment = ticket.assignments.find(item => item.id === assignmentId)
      if (assignment === undefined || assignment.state !== 'running') return ticket
      return withAssignment(ticket, { ...assignment, deliveryError: error.slice(0, 2000) })
    })
  }

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
  turnEnded(ticketId: string, assignmentId: string, said?: string, cause?: { reason?: string; error?: string }): void {
    this.mutate(ticketId, ticket => {
      const assignment = ticket.assignments.find(item => item.id === assignmentId)
      if (assignment === undefined || assignment.state !== 'running') return ticket
      this.record(ticketId, 'turn_ended', { kind: 'agent' }, {
        assignmentId, said: said?.trim(),
        ...(cause?.reason === undefined ? {} : { reason: cause.reason }),
        // Bounded like every other error text stored on a Ticket (`deliveryFailed` above): one upstream failure's
        // message is evidence, and an unbounded one is a way to fill the log with a provider's HTML.
        ...(cause?.error === undefined ? {} : { error: cause.error.slice(0, 2000) }),
      })
      const report = assignment.report
      const stale = assignment.deliveredAt !== undefined && (report === undefined || assignment.deliveredAt >= report.at)
      if (!stale || (said === undefined || said.trim() === '') && report !== undefined) return ticket
      const next: Report = { state: 'waiting', summary: said?.trim() || report?.summary || 'The worker ended its turn without a report.', at: this.now() }
      const updated = withAssignment(ticket, { ...assignment, report: next })
      this.tx.afterCommit(() => this.delivery.report(updated, next))
      this.emit({ type: 'report.recorded', ticket: updated, report: next })
      return updated
    })
  }

  /**
   * Record a worker's Report, and end the Ticket when the Report ends it: `ready` completes it, `dropped` closes it
   * as needing nothing. A `blocked` or `failed` Report leaves the Ticket open, waiting for a person.
   */
  /** Name a standing group of Works: the thing an operator thinks of as "this client" or "this product". */
  createProject(request: { name: string; note?: string }): Project {
    return this.tx.atomic(() => {
      const name = request.name.trim()
      if (name === '') throw new UserError('empty_name')
      const at = this.now()
      const project: Project = {
        id: key('project', name, at), name, createdAt: at,
        ...(request.note === undefined ? {} : { note: request.note }),
      }
      this.repos.projects.save(project)
      return project
    })
  }

  /** Name a stream of tasks that many Tickets will belong to over time. */
  createWork(request: { name: string; projectId?: string; scope?: string; note?: string }): Work {
    return this.tx.atomic(() => {
      const name = request.name.trim()
      if (name === '') throw new UserError('empty_name')
      if (request.projectId !== undefined && this.repos.projects.get(request.projectId) === undefined) {
        throw new UserError('project_missing')
      }
      const at = this.now()
      const work: Work = {
        id: key('work', name, request.projectId ?? '', at), name, createdAt: at,
        ...(request.projectId === undefined ? {} : { projectId: request.projectId }),
        ...(request.scope === undefined ? {} : { scope: request.scope }),
        ...(request.note === undefined ? {} : { note: request.note }),
      }
      this.repos.works.save(work)
      return work
    })
  }

  /**
   * Classify a Ticket into a Work, which is the moment it takes its place in that Work's history.
   *
   * This happens after the gate accepted the Ticket and never as an input to it, so the gate stays a pure function of
   * the Trigger and the settings. An ended Ticket may still be classified: putting last month's work into the Work it
   * belonged to is bookkeeping, not new authorization.
   */
  attachWork(ticketId: string, workId: string): Ticket {
    return this.mutate(ticketId, ticket => {
      if (this.repos.works.get(workId) === undefined) throw new UserError('work_missing')
      if (ticket.workId === workId) return ticket
      // The position counts the Tickets already in the Work, so it is a fact about the Work's history rather than
      // about when this Ticket was created: one made last month and attached today is simply the next in line.
      const workSeq = this.repos.tickets.byWork(workId).length + 1
      this.record(ticketId, 'classified', { kind: 'person' }, { workId, workSeq })
      return { ...ticket, workId, workSeq }
    })
  }

  /** Every Project, oldest first. */
  projects(): Project[] { return this.repos.projects.list() }

  /** Every Work, or the Works of one Project when asked. */
  works(projectId?: string): Work[] {
    return projectId === undefined ? this.repos.works.list() : this.repos.works.byProject(projectId)
  }

  /** A Work's Projects, or every Project when asked for none. */
  project(id: string): Project | undefined { return this.repos.projects.get(id) }

  /** One Work, when it exists. */
  work(id: string): Work | undefined { return this.repos.works.get(id) }

  /** A Work's Tickets, in the order they joined it. */
  ticketsOfWork(workId: string): Ticket[] { return this.repos.tickets.byWork(workId) }

  /**
   * What the worker says about the attempt it was launched for.
   *
   * `assignmentId` is the attempt the calling turn belongs to, which the worker's own tool carries. Naming it is what
   * makes a turn that outlives its attempt harmless: without it, a report from an attempt that was already retried
   * lands on whichever attempt is running now, because "the running one" is exactly what a superseded turn looks like
   * from the outside.
   */
  report(ticketId: string, report: Omit<Report, 'at'>, assignmentId?: string): Ticket {
    return this.recordReport(ticketId, report, false, assignmentId)
  }

  /**
   * Record that the system gave up on an attempt it could not start, or could not hand the work to.
   *
   * This is not the worker's report and is kept separate on purpose: the attempt is usually still `pending`, because
   * nothing ever started it. A Ticket left pending with no word on it is indistinguishable from a launch that is
   * merely queued, so the giving-up has to be written down — but it must not open the door for a worker's report to be
   * attributed to an attempt that never ran.
   */
  reportGaveUp(ticketId: string, summary: string): Ticket {
    return this.recordReport(ticketId, { state: 'failed', summary }, true)
  }

  private recordReport(ticketId: string, report: Omit<Report, 'at'>, systemGaveUp: boolean, assignmentId?: string): Ticket {
    return this.tx.atomic(() => {
      const ticket = this.require(ticketId)
      // An ended Ticket takes no report, whatever its Assignments look like. A stop usually lands while the worker is
      // mid-turn, so its report arrives after the authorization is gone; recording it would rewrite how the Ticket
      // ended, write its result and tell the front desk about work that was withdrawn.
      if (!liveTicket(ticket)) throw new UserError('ticket_ended')
      // A report is the worker's word about the attempt it was launched for, so it may only land on an attempt that is
      // running. Attributing it to whatever attempt happens to be current let a superseded turn end a Ticket whose
      // replacement had not even started — and `ticketStage` renders any report on a pending attempt as `failed`, so
      // the panel said the wrong thing about it too. The system giving up is the one legitimate exception.
      const assignment = systemGaveUp
        ? runningAssignment(ticket) ?? latestAssignment(ticket)
        : assignmentId === undefined
          ? runningAssignment(ticket)
          : ticket.assignments.find(item => item.id === assignmentId && item.state === 'running')
      if (assignment === undefined || assignment.state === 'ended') {
        throw new UserError(latestAssignment(ticket) === undefined ? 'ticket_not_running' : 'assignment_stale')
      }
      const at = this.now()
      const recorded: Report = { ...report, at }
      let next = withAssignment(ticket, { ...assignment, report: recorded })
      const question = report.question?.trim()
      next = report.state === 'blocked' || report.state === 'failed' || (question !== undefined && question !== '')
        ? { ...next, attention: { question: question || report.summary, at } }
        : { ...next, attention: undefined }
      if (report.state === 'ready') {
        next = {
          ...next,
          result: { summary: report.summary, files: report.files ?? [], at },
          assignments: next.assignments.map(item => item.id === assignment.id
            ? { ...item, state: 'ended' as const, endedAt: at, endedReason: 'reported' } : item),
        }
        next = ended(next, at, 'agent', 'done', 'The worker reported ready')
      } else if (report.state === 'dropped') {
        next = {
          ...next,
          assignments: next.assignments.map(item => item.id === assignment.id
            ? { ...item, state: 'ended' as const, endedAt: at, endedReason: 'reported' } : item),
        }
        next = ended(next, at, 'agent', 'dropped', report.summary || 'The worker reported that nothing needed doing')
        this.cascadeFrom(ticketId, at, 'dropped', next.ended!.reason)
      }
      // Artifacts are registered here, inside the report's own transaction: an artifact whose registering report was
      // rolled back must not exist, and every artifact must point at a report that does. This is also why the registry
      // lives on the Engine rather than in the Delivery or Executor layer — the "only writer" guarantee is worth
      // nothing on the one aggregate V2 is built around.
      // A report that arrives after this attempt's turn had ended means the Session was woken again and work went on:
      // an interruption happened, and the log has to say so, because without it a run somebody had to rescue reads
      // exactly like a run that went smoothly (`created → launched → report → turn_ended → report → done`). It is a
      // fact and not an inference — a report can only be produced inside a turn, so a report after a turn end is a new
      // turn — and what is NOT known is who woke it, which is why the event names no cause: `by` is left out for a fact
      // nobody caused (`model.ts`), rather than attributed to a system that only observed it. Naming the person is the
      // deferred other half of this fix. Not to be confused with the `ticket.resumed` domain event, which is a
      // person's answer reaching a Ticket and is recorded as an `input`.
      const interruption = this.interruptedAt(ticketId, assignment.id)
      if (interruption !== undefined) {
        this.record(ticketId, 'resumed', undefined, { assignmentId: assignment.id, turnEndedAt: interruption })
      }
      this.record(ticketId, 'report', { kind: 'agent' }, { state: report.state, assignmentId: assignment.id })
      const refused: string[] = []
      for (const file of report.files ?? []) {
        const path = artifactPath(file)
        if (path === undefined) { refused.push(file); continue }
        this.repos.artifacts.save({ ticketId, path, at, note: report.summary.slice(0, 200) })
      }
      if (refused.length > 0) {
        // Recorded on the Ticket instead of dropped: a worker naming a path outside its own directory is either
        // confused or claiming a file it did not produce, and both are worth seeing rather than silently ignoring.
        next = {
          ...next,
          notes: [...next.notes, {
            at,
            text: `Not registered as this Ticket's artifact, because it is not a path inside the Ticket directory: ${refused.join(', ')}`,
          }],
        }
      }
      this.repos.tickets.save(next)
      this.tx.afterCommit(() => {
        this.delivery.report(next, recorded)
        if (next.ended !== undefined && ticket.ended === undefined) {
          this.emit({ type: 'assignment.ended', ticketId, assignmentId: assignment.id })
          this.emit({ type: 'ticket.ended', ticket: next })
        } else {
          this.emit({ type: 'report.recorded', ticket: next, report: recorded })
        }
      })
      return next
    })
  }

  /**
   * An Assignment was running when the host stopped. It ends as interrupted, and a fresh pending Assignment takes the
   * Ticket over with a recovery note, so a restart continues the work instead of losing it.
   */
  assignmentInterrupted(ticketId: string, assignmentId: string, why?: string): void {
    this.mutate(ticketId, ticket => {
      const assignment = ticket.assignments.find(item => item.id === assignmentId)
      if (assignment === undefined || assignment.state !== 'running') return ticket
      const at = this.now()
      // `why` is present when something decided to interrupt this attempt rather than a restart finding it already
      // dead. Naming the decider is what lets the Watchdog count its own actions in the log, and what lets the
      // operator tell "the host restarted" from "myagent gave up waiting for you" apart afterwards.
      this.record(ticketId, 'interrupted', why === undefined ? { kind: 'system' } : { kind: 'system', id: 'watchdog' },
        why === undefined ? { assignmentId } : { assignmentId, why })
      const note: TicketInput = {
        id: key('input', ticketId, 'interrupted', assignmentId), kind: 'note', at,
        text: 'myagent restarted while you were working. Read the current state of your directory, then continue the assignment from where it stopped; do not repeat completed work.',
      }
      const fresh: Assignment = { id: key('assignment', ticketId, ticket.assignments.length + 1), state: 'pending', createdAt: at }
      const withEnded = withAssignment(ticket, { ...assignment, state: 'ended', endedAt: at, endedReason: 'interrupted' })
      const withFresh: Ticket = { ...withEnded, inputs: [...ticket.inputs, note], assignments: [...withEnded.assignments, fresh] }
      this.tx.afterCommit(() => this.executor.start(withFresh, fresh))
      return withFresh
    })
  }

  // --------------------------------------------------------------- Settings

  /**
   * Tell each live Ticket the change bears on how, under the new Policy. A change is delivered, never enforced by
   * cancellation: cancelling would leave half-finished work with no one to explain it.
   */
  policyChanged(before: Settings, after: Settings): readonly PolicyEffect[] {
    return this.tx.atomic(() => {
      const effects = policyEffects(this.repos.tickets.open(), before, after)
      for (const effect of effects) {
        const ticket = this.repos.tickets.get(effect.ticketId)
        if (ticket === undefined) continue
        const at = this.now()
        const text = [
          'Policy change:',
          `${GATE_REASONS[effect.reason]}${effect.detail === undefined ? '' : ` (${effect.detail})`}`,
          'Finish what is in progress within this Ticket\'s scope, and take on nothing new that this change rules out.',
        ].join('\n')
        const input: TicketInput = { id: key('input', ticket.id, 'policy', at), kind: 'note', text, at }
        const next: Ticket = { ...ticket, inputs: [...ticket.inputs, input] }
        this.repos.tickets.save(next)
        const assignment = runningAssignment(next)
        this.tx.afterCommit(() => {
          this.delivery.policyChanged?.(next, effect)
          if (assignment !== undefined) this.executor.deliver(next, assignment)
        })
      }
      if (effects.length > 0) this.emit({ type: 'policy.changed', effects })
      return effects
    })
  }

  // ------------------------------------------------------------------ Reads

  /** A Ticket by id. @throws `UserError('ticket_missing')` when absent. */
  require(ticketId: string): Ticket {
    const ticket = this.repos.tickets.get(ticketId)
    if (ticket === undefined) throw new UserError('ticket_missing', { ticketId })
    return ticket
  }

  /** Read a Trigger by id. @throws `UserError('trigger_missing')` when absent. */
  trigger(triggerId: string): Trigger {
    const record = this.repos.triggers.get(triggerId)
    if (record === undefined) throw new UserError('trigger_missing', { triggerId })
    return record.trigger
  }

  /**
   * End a Ticket as failed by the system itself, for a case where no work may run at all.
   *
   * This is not a worker's `failed` Report, which leaves the Ticket open for a person to answer or to retry in the same
   * directory. It is for a directory that cannot be trusted — a prepare command that failed may have left it half-made,
   * and running anything in it, or preparing it again, would only compound that. The work, if it is still wanted, gets
   * a new Ticket and with it a new directory.
   */
  failTicket(ticketId: string, reason: string): Ticket {
    return this.tx.atomic(() => {
      const ticket = this.require(ticketId)
      if (!liveTicket(ticket)) return ticket
      const at = this.now()
      const assignment = latestAssignment(ticket)
      this.record(ticketId, 'failed', { kind: 'system' }, { reason })
      let next = ended(ticket, at, 'system', 'failed', reason)
      this.cascadeFrom(ticketId, at, 'failed', reason)
      if (assignment !== undefined && assignment.state !== 'ended') {
        next = withAssignment(next, { ...assignment, state: 'ended', endedAt: at, endedReason: 'failed' })
      }
      this.repos.tickets.save(next)
      this.tx.afterCommit(() => {
        if (assignment !== undefined) this.emit({ type: 'assignment.ended', ticketId, assignmentId: assignment.id })
        this.emit({ type: 'ticket.ended', ticket: next })
      })
      return next
    })
  }

  /**
   * Record the worker Session id DSH actually gave this Ticket.
   *
   * A launch asks for `worker-<ticketId>` and DSH may answer with another identity, so the id is stored rather than
   * derived; everything that later addresses the worker — a delivery, a stop, a turn ending — reads it from here.
   */
  bindSession(ticketId: string, sessionId: string): void {
    this.mutate(ticketId, ticket => ticket.execution === undefined || ticket.execution.sessionId === sessionId
      ? ticket : { ...ticket, execution: { ...ticket.execution, sessionId } })
  }

  /** Read a Decision by id, for the panel and for a Source that words its own refusal. */
  decisionOf(decisionId: string): Decision | undefined {
    return this.repos.decisions.get(decisionId)
  }

  /** Read what became of a Trigger, when it was stored. */
  dispositionOf(triggerId: string): Disposition | undefined {
    return this.repos.triggers.get(triggerId)?.disposition
  }

  /** Change one Ticket in a transaction, saving and returning it; a mutation that returns it unchanged still saves. */
  /**
   * Record one fact about a Ticket's life. Called inside the transaction that made the fact true, so the log can never
   * hold an event for state that was rolled back — which is the property a reconstructed-from-state history cannot give.
   */
  private record(ticketId: string, type: TicketEventType, by?: TicketEvent['by'], detail?: Record<string, unknown>): void {
    this.repos.events.append({
      ticketId, at: this.now(), type,
      ...(by === undefined ? {} : { by }), ...(detail === undefined ? {} : { detail }),
    })
  }

  /**
   * When this attempt's turn last ended before the report now arriving, or `undefined` when it did not.
   *
   * Reads the log backwards and stops at the attempt's own previous report, because the question is whether the work
   * was interrupted between the word the worker last said and the one it is saying now. Events of other attempts are
   * skipped rather than ending the scan, so a retry — whose story `retried` and its own `launched` already tell — does
   * not read as a resumption, and an Input delivered in between keeps its place in the log without hiding the
   * interruption that came before it.
   */
  private interruptedAt(ticketId: string, assignmentId: string): string | undefined {
    const events = this.repos.events.list(ticketId)
    for (let index = events.length - 1; index >= 0; index--) {
      const event = events[index]!
      if (event.detail?.assignmentId !== assignmentId) continue
      if (event.type === 'report') return undefined
      if (event.type === 'turn_ended') return event.at
    }
    return undefined
  }

  /**
   * Make one Ticket wait for another.
   *
   * The wait is enforced where the launch is decided and never by ending anything: a waiting Ticket keeps its
   * Assignment `pending` while its launch defers itself, which does not count against the retry budget. Expressing the
   * wait as failures instead would burn five tries and leave a spurious `failed` report on work that is merely early.
   */
  dependOn(downstreamId: string, upstreamId: string, on: Dependency['on'] = 'done'): Dependency {
    return this.tx.atomic(() => {
      if (downstreamId === upstreamId) throw new UserError('dependency_cycle')
      this.require(downstreamId)
      this.require(upstreamId)
      // Checked inside the same transaction as the write: a cycle check that read outside it could pass on a graph
      // another command was halfway through changing.
      if (this.createsCycle(downstreamId, upstreamId)) throw new UserError('dependency_cycle')
      const dependency: Dependency = { upstream: upstreamId, downstream: downstreamId, createdAt: this.now(), on }
      this.repos.dependencies.save(dependency)
      this.record(downstreamId, 'dependency', { kind: 'person' }, { upstream: upstreamId, on })
      return dependency
    })
  }

  /** Drop an edge, which is how a person undoes a wait that turned out to be wrong. */
  dropDependency(downstreamId: string, upstreamId: string): void {
    this.tx.atomic(() => {
      this.require(downstreamId)
      this.repos.dependencies.delete(upstreamId, downstreamId)
      this.record(downstreamId, 'dependency', { kind: 'person' }, { upstream: upstreamId, dropped: true })
    })
  }

  /** A Ticket's registered artifacts, in the order their registering reports arrived. */
  artifactsOf(ticketId: string): Artifact[] {
    this.require(ticketId)
    return this.repos.artifacts.list(ticketId)
  }

  /**
   * Authorize one Ticket's worker to read one registered artifact of another, and answer where it is.
   *
   * Two narrowings, both deliberate. The boundary is the Work — the same machine-checkable rule the hand-off channel
   * uses, so a worker cannot widen it by arguing. And only a **registered** artifact is readable, never an arbitrary
   * file in the other Ticket's directory: the registry is the surface a report claimed and a person can audit, whereas
   * "whatever happens to be in that directory" is neither.
   *
   * This authorizes and locates; it does not read. Core does no IO, so the caller resolves the path against the
   * directory with the same traversal guard the panel uses and does the reading itself.
   */
  authorizeArtifactRead(sourceTicketId: string, targetTicketId: string, path: string): { directory: string; artifact: Artifact } {
    const source = this.require(sourceTicketId)
    const target = this.require(targetTicketId)
    if (sourceTicketId === targetTicketId) throw new UserError('artifact_missing')
    if (source.workId === undefined || source.workId !== target.workId) throw new UserError('collaboration_refused')
    const wanted = path.trim().replace(/^\.\//, '')
    const artifact = this.repos.artifacts.list(targetTicketId).find(item => item.path === wanted)
    if (artifact === undefined) throw new UserError('artifact_missing')
    const directory = target.execution?.directory
    if (directory === undefined) throw new UserError('artifact_unreachable')
    return { directory, artifact }
  }

  /**
   * Record that the Watchdog gave up on a Ticket and handed it to a person.
   *
   * Written into the Ticket's own log rather than only onto the health board, because the board answers "how are
   * things now" and is legitimately overwritten by the next unrelated observation, while "we escalated this one" is a
   * fact about this Ticket's life. Keeping both is the same division of labour as `ruleChainStopped`: the board is the
   * signal, the log is the record.
   */
  watchdogEscalated(ticketId: string, why: string): void {
    this.tx.atomic(() => {
      this.require(ticketId)
      this.record(ticketId, 'escalated', { kind: 'system', id: 'watchdog' }, { why })
    })
  }

  /**
   * Record that a reply owed to whoever asked for this work was given up on.
   *
   * In the log rather than only on the health board or in a file in the Ticket's directory, for the reason this project
   * has now learned three times (N5's `rule_stopped`, N8's `escalated`, and this): the board answers "how are things
   * now" and the next unrelated success legitimately clears it, while "we owed someone a sentence and lost it" is a
   * fact about this Ticket's life. The project's hard rule is that every side effect has an execution and a failure
   * record — a lost reply is a failed side effect, and the log is where failures are recorded.
   */
  replyLost(ticketId: string, detail: Record<string, unknown>): void {
    this.tx.atomic(() => {
      this.require(ticketId)
      this.record(ticketId, 'reply_lost', { kind: 'system', id: 'delivery' }, detail)
    })
  }

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
  noticeLost(ticketId: string, detail: Record<string, unknown>): void {
    this.tx.atomic(() => {
      this.require(ticketId)
      this.record(ticketId, 'notice_lost', { kind: 'system', id: 'delivery' }, detail)
    })
  }

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
  triggerLost(lost: LostTrigger): boolean {
    const triggers = this.repos.triggers
    // Held in a local and called with its receiver: the narrowing that answers `false` does not survive into the
    // transaction's callback, and an optional member invoked without its `this` is a call on nothing.
    const insert = triggers.insertLost
    if (insert === undefined) return false
    this.tx.atomic(() => { insert.call(triggers, lost) })
    return true
  }

  /** One Ticket when it exists, for a caller that must not make a missing one an error. */
  ticket(id: string): Ticket | undefined { return this.repos.tickets.get(id) }

  /**
   * Record that the Watchdog rescued a Ticket, which is also how it counts its own rescues.
   *
   * Kept in the log rather than in a field of the Watchdog's own, so a restart cannot make it forget and rescue the
   * same Ticket forever, and so "why did this get re-queued three times" is answerable where the operator already reads.
   */
  watchdogActed(ticketId: string, why: string): void {
    this.tx.atomic(() => {
      this.require(ticketId)
      this.record(ticketId, 'rescued', { kind: 'system', id: 'watchdog' }, { why })
    })
  }

  /**
   * Record that a rule chain stopped here because it reached its depth limit.
   *
   * Recorded on the Ticket whose ending triggered it, because the Ticket that would have been created does not exist —
   * and without a record the chain leaves nothing at all: no Trigger, no Decision, no event. A health line is not
   * enough, since the health board answers "how are things now" and the next unrelated ending legitimately clears it;
   * "a rule stopped asking for work, on purpose, here" is a fact about what happened, so it belongs in the log.
   */
  ruleChainStopped(ticketId: string, detail: Record<string, unknown>): void {
    this.tx.atomic(() => {
      this.require(ticketId)
      this.record(ticketId, 'rule_stopped', { kind: 'system', id: 'rule' }, detail)
    })
  }

  /** The edges that wait for one Ticket, which is what a release reads. */
  dependantsOf(upstreamId: string): Dependency[] { return this.repos.dependencies.downstreamOf(upstreamId) }

  /** The Tickets this one is still waiting for, which is the whole reason its worker has not been launched. */
  blockedBy(ticketId: string): Dependency[] {
    return this.repos.dependencies.upstreamOf(ticketId)
      .filter(edge => !released(edge, this.repos.tickets.get(edge.upstream)))
  }

  /**
   * End what waited on a Ticket that failed, or that found nothing to do, so one broken link does not hang the graph.
   *
   * A stop is deliberately not cascaded: stopping is a person's explicit act, and what should happen to the work
   * downstream of it is that person's decision too. Failure and "nothing to do" keep their difference on the way down,
   * so the panel and the log say which of the two happened rather than flattening both into "cancelled".
   */
  private cascadeFrom(upstreamId: string, at: string, outcome: 'failed' | 'dropped', reason: string): void {
    for (const edge of this.repos.dependencies.downstreamOf(upstreamId)) {
      // A dependant that only needed the upstream to finish is unaffected by how it finished.
      if (edge.on !== 'done') continue
      const ticket = this.repos.tickets.get(edge.downstream)
      if (ticket === undefined || !liveTicket(ticket)) continue
      const why = `${reason} — 这张在等 Ticket ${upstreamId.slice(0, 8)}，所以它无法进行`
      const next = ended(ticket, at, 'system', outcome, why)
      this.repos.tickets.save(next)
      this.record(edge.downstream, outcome === 'failed' ? 'failed' : 'ended', { kind: 'system' },
        { cascaded: true, upstream: upstreamId, outcome })
      this.emit({ type: 'ticket.ended', ticket: next })
      // The graph is acyclic by construction — `dependOn` refuses a cycle — so this walk terminates.
      this.cascadeFrom(edge.downstream, at, outcome, why)
    }
  }

  /**
   * Whether `upstream` already waits, directly or through others, on `downstream`.
   *
   * Walked in the direction the edges mean: an edge says "downstream waits for upstream", so from the new edge's
   * upstream we follow what IT waits for, and a cycle is arriving back at the new edge's downstream. Walking the other
   * way finds nothing, because "A waits for B" and "B waits for A" are stored as two different edges.
   */
  private createsCycle(downstreamId: string, upstreamId: string): boolean {
    const edges = this.repos.dependencies.list()
    const seen = new Set<string>()
    const walk = (from: string): boolean => {
      if (from === downstreamId) return true
      if (seen.has(from)) return false
      seen.add(from)
      return edges.some(edge => edge.downstream === from && walk(edge.upstream))
    }
    return walk(upstreamId)
  }

  /** Everything that happened to one Ticket, oldest first. */
  history(ticketId: string): TicketEvent[] {
    this.require(ticketId)
    return this.repos.events.list(ticketId)
  }

  private mutate(ticketId: string, change: (ticket: Ticket) => Ticket): Ticket {
    return this.tx.atomic(() => {
      const ticket = this.require(ticketId)
      const next = change(ticket)
      this.repos.tickets.save(next)
      return next
    })
  }
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
export function artifactPath(candidate: string): string | undefined {
  const trimmed = candidate.trim()
  if (trimmed === '') return undefined
  // An absolute path names a file by where it happens to live, not by what this Ticket produced.
  if (trimmed.startsWith('/') || /^[A-Za-z]:[\\/]/.test(trimmed)) return undefined
  const parts: string[] = []
  for (const part of trimmed.split(/[\\/]+/)) {
    if (part === '' || part === '.') continue
    if (part === '..') {
      // Escaping the Ticket directory is the one thing the registry must never record.
      if (parts.length === 0) return undefined
      parts.pop()
      continue
    }
    parts.push(part)
  }
  return parts.length === 0 ? undefined : parts.join('/')
}

function attachmentName(source: string, taken: Set<string>): string {
  const base = source.split('/').filter(part => part !== '').pop() ?? source
  // Split at the last dot, unless that dot opens the name: `.env` has no extension to keep, and treating it as one
  // would produce `-2.env`.
  const dot = base.lastIndexOf('.')
  const stem = dot > 0 ? base.slice(0, dot) : base
  const extension = dot > 0 ? base.slice(dot) : ''
  for (let index = 1; ; index++) {
    const candidate = index === 1 ? base : `${stem}-${index}${extension}`
    if (!taken.has(candidate)) { taken.add(candidate); return candidate }
  }
}

/**
 * The files a Trigger brought with it, from whichever Source produced it.
 * A Source writes absolute paths into `meta.attachments`; names are derived here so every Source means the same thing.
 */
export function attachmentsOf(trigger: Trigger): readonly Attachment[] {
  const raw = trigger.meta?.attachments
  const paths = Array.isArray(raw) ? raw.filter((item): item is string => typeof item === 'string' && item.trim() !== '') : []
  const taken = new Set<string>()
  return paths.map(source => ({ name: attachmentName(source.trim(), taken), source: source.trim() }))
}

/** The Ticket a disposition points at, when it does. */
export function ticketIdOf(disposition: Disposition): string | undefined {
  return disposition.state === 'accepted' ? disposition.ticketId : undefined
}

/**
 * The text of a queue payload, which the queue hands over already parsed.
 *
 * A re-serialization rather than the bytes that were in the row: `claimEffects` parses them (`store.ts:651`) and the
 * row is deleted when the queue gives up, so no copy of the original survives to hand on. Nothing is lost by it —
 * `JSON.parse` keeps the keys this build has no name for, which are exactly the interesting ones in a payload it
 * cannot read. `undefined` is answered as text rather than as nothing, because the columns this text goes into are
 * NOT NULL and binding `undefined` to one is itself a TypeError.
 */
export function payloadText(payload: unknown): string {
  return JSON.stringify(payload) ?? String(payload)
}

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
export function lostTriggerOf(
  payload: unknown, detail: { readonly error: string; readonly effectKey: string },
): LostTrigger | undefined {
  if (typeof payload !== 'object' || payload === null) return undefined
  const candidate = payload as Record<string, unknown>
  const field = (name: string): string | undefined => {
    const value = candidate[name]
    return typeof value === 'string' && value.trim() !== '' ? value : undefined
  }
  const id = field('id')
  const source = field('source')
  const kind = field('kind')
  const at = field('at')
  if (id === undefined || source === undefined || kind === undefined || at === undefined) return undefined
  return { id, source, kind, at, ...detail, raw: payloadText(payload) }
}
