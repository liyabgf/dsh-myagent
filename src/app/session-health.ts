/**
 * The `sessions` health entry, accounted per Ticket.
 *
 * The health board answers "how are things now", and one of its lines used to be written by whoever noticed a Session
 * problem last: a 429 recorded for one Ticket stayed `ok: false` on the panel for hours after that Ticket succeeded,
 * because nothing that happened later — the same Session completing a turn, the Ticket ending, an unrelated Ticket's
 * Session failing or recovering — ever called `record` on that line. Making the line self-clearing is not enough on its
 * own, and the reason is measured rather than tasted (§4.33's N9, and §4.43's own hole): one shared slot means Ticket
 * B's observation overwrites Ticket A's, with no acknowledgement, and a "quiet pass" that claims nothing can still
 * erase a problem that is live. So this entry is accounted: every problem belongs to one subject (a Ticket, the front
 * desk, or a Session named after a Ticket that does not exist), the line is composed from all of them, and a subject's
 * problem is dropped only by the facts that end it.
 */
import type { HealthEntry } from './health.ts'

/**
 * The front desk's own problem, which is not a Ticket's.
 *
 * A key rather than an `undefined` ticketId so the same account holds both kinds without one kind being able to
 * overwrite the other: "the main Session could not be created" must not be erased by a worker's 429, and the reverse.
 */
export const MAIN_SESSION = 'main-session'

/**
 * The subject key of a Session that is named after a Ticket which does not exist, and so was decorated with nothing.
 *
 * Its own key, and one per Session id, for the reasons the two keys that already exist are separate:
 * - not a Ticket's, because there is no Ticket — that absence is the fact being reported;
 * - not `MAIN_SESSION`'s, because an impostor at the door is not the front desk's own problem, and one slot shared by
 *   them is N9 again: `Runtime.createMainSession` clears `MAIN_SESSION` when it succeeds, so the front desk's good
 *   news would erase a live security refusal, with no acknowledgement from either subject;
 * - not one shared impostor key either, because two Sessions named after two missing Tickets are two subjects. A
 *   single `IMPOSTOR_SESSION` would let the second one's detail overwrite the first's, and disposing one would retire
 *   the other's line — the same defect this class exists to remove, one level down.
 *
 * What retires it: the Session leaving the registry, which is `agent/disposed` in `runtime.ts`. Deliberately neither
 * of the two facts that retire a Ticket's problem. Its Ticket ending is unavailable — there is no Ticket. And a
 * non-error turn end is recovery evidence for a 429 because the fact there is "this Session cannot reach the model",
 * while the fact here is "this Session has no authorization and was given nothing": a turn it completes successfully
 * changes neither, so clearing on it would retire a live line on evidence that says nothing about it. Only the Session
 * going away ends the condition, and the quiet pass after that says so — round 43's semantics, an ended problem must go
 * and a live one must not.
 *
 * Two boundaries of this line, stated rather than left to be discovered: the refusal is reported when DSH announces
 * the Session (`agent/created`), so a restart that does not re-announce a leftover Session does not re-report it; and
 * a Ticket with that exact id appearing later and adopting the Session does not retire the line until the Session is
 * disposed, because retiring it there needs a second port member on `SessionsHost` — a clear — and W2 adds one
 * member for one fact.
 */
export const impostorSubject = (sessionId: string): string => `impostor-session:${sessionId}`

/**
 * What the entry says about a refused impostor: both ids.
 *
 * "A Session was refused" is not actionable — an operator reading it cannot tell which Session to close or which
 * Ticket it claimed, and a line nobody can act on is read once and then ignored. The pair names both, and the
 * consequence, so the line answers what happened and what was done about it.
 */
export const impostorDetail = (sessionId: string, ticketId: string): string =>
  `Session ${sessionId} claims Ticket ${ticketId}, which does not exist, and was given no myagent tool`

/**
 * What the entry says when the account is empty.
 *
 * A claim about now, in the present tense, with the one number the account is honest about: how much work is running.
 * `open` is counted by the caller, because this class sees the health entry and the map, and nothing else.
 */
const quiet = (open: number): string => `${open} open Ticket(s), no Session problem is live`

/** One health line, composed from every live session problem instead of written by whoever complained last. */
export class SessionHealth {
  /** The problems this process knows are live, keyed by what each one belongs to. */
  private readonly problems = new Map<string, string>()

  constructor(
    private readonly entry: HealthEntry,
    /** How many Tickets are open, which is the number the quiet line can state without claiming anything else. */
    private readonly openTickets: () => number,
  ) {}

  /** Record a problem as belonging to one subject. A repeated subject is an update, not a second problem. */
  problem(subject: string, detail: string): void {
    this.problems.set(subject, detail)
    this.compose()
  }

  /**
   * Drop a subject's problem, because one of the facts that ends it happened: its Ticket ended, its Session completed
   * a turn, or — for a subject that has no Ticket, like {@link impostorSubject} — its Session was disposed. Recomposes
   * the line, so one subject clearing itself cannot leave another's problem in the detail — and clearing the last
   * problem is what writes the quiet line, at the moment the problem is over. Dropping a subject that is not in the
   * account writes nothing, so a clear aimed at one subject cannot touch another's.
   */
  clear(subject: string): void {
    if (this.problems.delete(subject)) this.compose()
  }

  /**
   * Say the entry is fine, when the account is empty.
   *
   * Guarded on the map and not on "this pass was quiet", for the reason §4.43 learned the hard way: a pass that
   * complains nothing is not evidence that nothing is wrong — it can be a failure whose row is still queued, or here,
   * a problem whose Ticket has not ended and whose Session has not completed a turn since. A summary written from
   * such a pass would be a false all-clear in place of the false alarm it removes. Called from every pass, so the
   * board is never silent about Sessions either: an empty board and a silent board are two different claims.
   */
  summarize(): void {
    if (this.problems.size > 0) return
    this.entry.record(quiet(this.openTickets()))
  }

  /**
   * Write the line from the whole map. One problem keeps today's wording exactly (the operator reads that detail to
   * find the Ticket), several problems say how many and list them — a count the operator can trust, because it comes
   * from the account rather than from whoever wrote the line last.
   */
  private compose(): void {
    const details = [...this.problems.values()]
    if (details.length === 0) {
      this.entry.record(quiet(this.openTickets()))
      return
    }
    this.entry.problem(details.length === 1
      ? details[0]!
      : `${details.length} Session problems: ${details.join(' | ')}`)
  }
}
