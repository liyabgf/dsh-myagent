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
  /**
   * The tombstone, when this Ticket was deleted with its record kept (S4).
   *
   * On the summary rather than only the detail view, because the one place an operator has to be able to tell a
   * deleted Ticket from a live one at a glance is the list — and the numbers travel with it, since after the assets
   * are gone nothing else records how much was thrown away.
   */
  readonly deleted?: Ticket['deleted']
  /**
   * Whether the attempt behind this Ticket is a triage one: it decides what a request becomes instead of doing the
   * work (S3b).
   *
   * On the summary rather than only the detail view, because the panel is where an operator works out why a Ticket
   * looks like it is doing nothing — a triage Ticket that answers in one turn and closes is correct behaviour, and
   * without the marker it is indistinguishable from a worker that gave up.
   */
  readonly triage?: boolean
  readonly waitsForPerson: boolean
  /** A failed preparation is not a worker question: it needs repair/retry, while the Input stays queued. */
  readonly preparationFailed: boolean
  readonly waitingForAnswer: boolean
  readonly inputDelivery: { readonly state: 'none' | 'pending' | 'failed' | 'delivered' | 'ended'; readonly total: number; readonly pending: number; readonly delivered: number; readonly error?: string }
  readonly question?: string
  readonly summary?: string
  readonly endedReason?: string
  readonly outcome?: string
}

export function ticketSummary(ticket: Ticket): TicketSummary {
  const assignment = latestAssignment(ticket)
  // Historical reports remain visible in the detail/history; an open replacement attempt must describe itself.
  const report = ticket.ended === undefined ? assignment?.report : latestReport(ticket)
  const preparationFailed = ticket.ended === undefined && assignment?.state === 'pending' && report?.state === 'failed'
  const pending = ticket.inputs.filter(input => input.deliveredAt === undefined).length
  const total = ticket.inputs.length
  const error = pending === 0 ? undefined : preparationFailed ? report?.summary : assignment?.deliveryError
  const state = total === 0 ? 'none' : pending === 0 ? 'delivered' : ticket.ended !== undefined ? 'ended'
    : error !== undefined ? 'failed' : 'pending'
  return {
    id: ticket.id, title: ticket.title, stage: ticketStage(ticket),
    createdAt: ticket.createdAt, updatedAt: updatedAt(ticket),
    via: ticket.mandate.via, sender: ticket.mandate.sender.id,
    directory: ticket.execution?.directory,
    ...(ticket.deleted === undefined ? {} : { deleted: ticket.deleted }),
    ...(latestAssignment(ticket)?.role === 'triage' ? { triage: true } : {}),
    waitsForPerson: waitsForPerson(ticket),
    preparationFailed,
    waitingForAnswer: waitsForPerson(ticket) && !preparationFailed,
    inputDelivery: { state, total, pending, delivered: total - pending, ...(error === undefined ? {} : { error }) },
    question: preparationFailed ? undefined : ticket.attention?.question,
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
    // Where this schedule's reports go, in the operator's own words. Omitting it would leave the panel showing a
    // schedule whose output silently lands nowhere the operator looks — the exact failure `deliverTo` exists to fix,
    // so the absence is stated as a fact rather than left blank.
    // The budget, in words, next to the address: both are facts about where this schedule's work goes and how long
    // it may take, and a cap nobody can see is a cap nobody can rely on. The panel copies this sentence verbatim, so
    // this view is its only owner — which is why `tests/views.spec.ts` pins both of its wordings.
    // Which surface the worker gets. Shown because "the prompt tells it not to run anything" and "it cannot run
    // anything" are different guarantees, and the operator is entitled to see which one this schedule has.
    // P1-5 fix: return the original preset and maxRuntimeMs values so the panel can
    // round-trip them when saving/toggling/deleting schedules. Without this the panel
    // only has the human-readable *Text fields and silently zeroes the budget and
    // resets researcher preset back to worker on every save.
    preset: schedule.preset,
    maxRuntimeMs: schedule.maxRuntimeMs,
    presetText: schedule.preset === 'researcher'
      ? '研究型 worker（无 shell：不能执行、安装或运行任何东西）'
      : '标准 worker（含 shell）',
    budgetText: schedule.maxRuntimeMs > 0
      ? `墙钟预算 ${Math.round(schedule.maxRuntimeMs / 60000)} 分钟（到点先提醒收尾，再过 10 分钟仍未结束就停下并交给人）`
      : '无墙钟预算（跑多久都行）',
    ...(schedule.deliverTo === undefined
      ? { deliverToText: '只落 RESULT.md 与主会话通知（不进聊天室）' }
      : {
        deliverTo: schedule.deliverTo,
        deliverToText: `送到聊天频道 ${schedule.deliverTo.channel}`
          + (schedule.deliverTo.thread === undefined ? '（该频道的默认会话）' : ` 的会话 ${schedule.deliverTo.thread}`),
      }),
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
