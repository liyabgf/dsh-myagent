/**
 * Views: the JSON shape of the domain, for the tools' answers and the panel's lists.
 *
 * One shape per record, computed from the record's own facts, so the panel and a tool answer can never disagree about
 * what a Ticket is doing. Nothing here reads the Store or touches a Session.
 */
import { latestAssignment, latestReport, ticketStage, waitsForPerson, type Assignment, type Decision, type Ticket } from '../core/model.ts'
import { GATE_REASONS, type GateReason, type Schedule } from '../core/policy.ts'
import { describeTiming, localZone, nextRun } from '../core/timing.ts'

/** The last instant anything happened to a Ticket. */
export function updatedAt(ticket: Ticket): string {
  const times = [
    ticket.createdAt,
    ...ticket.assignments.flatMap((assignment: Assignment) => [assignment.createdAt, assignment.startedAt, assignment.endedAt, assignment.report?.at]),
    ticket.ended?.at, ticket.attention?.at, ticket.result?.at, ...ticket.notes.map(note => note.at), ...ticket.inputs.map(input => input.at),
  ].filter((time): time is string => time !== undefined)
  return times.sort().at(-1) ?? ticket.createdAt
}

/** One line per Ticket, which is what a list shows. */
export interface TicketSummary {
  readonly id: string
  readonly title: string
  readonly stage: string
  readonly createdAt: string
  readonly updatedAt: string
  readonly via: string
  readonly sender: string
  readonly directory?: string
  /** The Work this Ticket belongs to, and its place in that Work's history. Absent on Tickets made before V2. */
  readonly workId?: string
  readonly workSeq?: number
  readonly waitsForPerson: boolean
  readonly question?: string
  readonly summary?: string
  readonly endedReason?: string
  readonly outcome?: string
}

export function ticketSummary(ticket: Ticket): TicketSummary {
  const report = latestReport(ticket)
  return {
    id: ticket.id, title: ticket.title, stage: ticketStage(ticket),
    createdAt: ticket.createdAt, updatedAt: updatedAt(ticket),
    via: ticket.mandate.via, sender: ticket.mandate.sender.id,
    directory: ticket.execution?.directory,
    waitsForPerson: waitsForPerson(ticket),
    question: ticket.attention?.question,
    summary: report?.summary,
    endedReason: ticket.ended?.reason, outcome: ticket.ended?.outcome,
    // Which Work this Ticket belongs to, and its place in that Work's history. On the summary rather than only the
    // detail view, because a list of Tickets is exactly where an operator wants to see them grouped.
    workId: ticket.workId, workSeq: ticket.workSeq,
  }
}

/** Everything the panel's detail view and `myagent_ticket_status` show about one Ticket. */
export function ticketView(ticket: Ticket): Record<string, unknown> {
  const assignment = latestAssignment(ticket)
  return {
    ...ticketSummary(ticket),
    mandate: {
      scope: ticket.mandate.scope, strength: ticket.mandate.strength, via: ticket.mandate.via,
      sender: ticket.mandate.sender, policyVersion: ticket.mandate.policyVersion, at: ticket.mandate.at,
    },
    origin: ticket.origin,
    attachments: ticket.attachments,
    execution: ticket.execution,
    assignment: assignment === undefined ? undefined : {
      id: assignment.id, state: assignment.state, createdAt: assignment.createdAt, startedAt: assignment.startedAt,
      endedAt: assignment.endedAt, endedReason: assignment.endedReason,
      // Whether the work reached the worker, and what a hand-over that did not arrive said. Without the first, a
      // Ticket that never got its prompt is indistinguishable from one the worker is silently ignoring.
      deliveredAt: assignment.deliveredAt, deliveryError: assignment.deliveryError,
      report: assignment.report,
    },
    assignments: ticket.assignments.map(item => ({ id: item.id, state: item.state, report: item.report?.state, at: item.createdAt })),
    reports: ticket.assignments.flatMap(item => item.report === undefined ? [] : [item.report]),
    result: ticket.result,
    ended: ticket.ended,
    notes: ticket.notes,
    inputs: ticket.inputs.map(input => ({ id: input.id, kind: input.kind, at: input.at, deliveredAt: input.deliveredAt, text: input.text })),
  }
}

/**
 * One schedule as the panel shows it: what it asks for, in words, and when it fires next.
 *
 * The next run is computed here rather than in the browser, because the timing is interpreted in the host's zone — the
 * one place that knows it. The panel renders the instant in the operator's own zone and shows the host's zone beside it,
 * so a machine in another zone is visible rather than silently wrong.
 * @param from the instant to compute from, in epoch milliseconds.
 */
export function scheduleView(schedule: Schedule, from: number, zone = localZone()): Record<string, unknown> {
  const next = schedule.enabled ? nextRun(schedule.timing, new Date(from)) : undefined
  return {
    id: schedule.id, name: schedule.name, enabled: schedule.enabled,
    prompt: schedule.prompt, scope: schedule.scope, timing: schedule.timing,
    describe: describeTiming(schedule.timing), zone,
    next: next === undefined ? undefined : new Date(next).toISOString(),
  }
}

/** One Decision as the panel shows it, with the gate's reason worded. */
export function decisionView(decision: Decision, title?: string): Record<string, unknown> {
  return {
    id: decision.id, triggerId: decision.triggerId, outcome: decision.outcome, at: decision.at,
    reason: decision.reason, reasonText: GATE_REASONS[decision.reason as GateReason], detail: decision.detail,
    ticketId: decision.ticketId, policyVersion: decision.policyVersion, title,
  }
}
