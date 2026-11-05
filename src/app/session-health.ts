/**
 * The `sessions` health entry, accounted per Ticket.
 *
 * The health board answers "how are things now", and one of its lines used to be written by whoever noticed a Session
 * problem last: a 429 recorded for one Ticket stayed `ok: false` on the panel for hours after that Ticket succeeded,
 * because nothing that happened later — the same Session completing a turn, the Ticket ending, an unrelated Ticket's
 * Session failing or recovering — ever called `record` on that line. Making the line self-clearing is not enough on its
 * own, and the reason is measured rather than tasted (§4.33's N9, and §4.43's own hole): one shared slot means Ticket
 * B's observation overwrites Ticket A's, with no acknowledgement, and a "quiet pass" that claims nothing can still
 * erase a problem that is live. So this entry is accounted: every problem belongs to one subject (a Ticket, or the
 * front desk), the line is composed from all of them, and a subject's problem is dropped only by the facts that end it.
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
   * Drop a subject's problem, because one of the facts that ends it happened: its Ticket ended, or its Session
   * completed a turn. Recomposes the line, so one subject clearing itself cannot leave another's problem in the
   * detail — and clearing the last problem is what writes the quiet line, at the moment the problem is over.
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
