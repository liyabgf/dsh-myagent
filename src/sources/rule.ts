/**
 * The Source that asks for work nobody wrote: a rule about how a Ticket ended.
 *
 * Two things about it are load-bearing and neither is obvious from the code.
 *
 * The Trigger it produces is **enqueued, not handed to the Engine**. Events are published after their transaction
 * commits, so nesting a command inside another's commit is not the reason — the reason is that a queued request
 * survives a crash between the ending and the asking, is deduplicated by key, and gets the retry and backoff the
 * queue already provides. Calling `receive` inline would have none of those, and losing the request is the one
 * outcome a rule exists to prevent. (This paragraph used to give the nesting reason, which stopped being true when
 * `emit` moved to after-commit; a load-bearing comment that is wrong is worse than none.)
 *
 * Its actor is a **system** actor named after the rule, so the gate refuses it until that Source is allowed to
 * originate work at all and that rule's id is on the list of who may ask. Two gates rather than one, because one
 * setting should not be worth any number of unidentified producers.
 */
import { key } from '../core/index.ts'
import type { Ticket, Trigger } from '../core/model.ts'
import { sourcePolicy } from '../core/policy.ts'
import type { HealthEntry } from '../app/health.ts'
import type { Source, SourceHost, SourceKind, SourceStatus } from './kind.ts'

export class RuleSource implements Source {
  readonly id = 'rule'
  readonly kind = 'rule' as const

  private unsubscribe: (() => void) | undefined
  private last: SourceStatus = { ok: true, detail: 'no rules' }
  private readonly health: HealthEntry

  constructor(private readonly host: SourceHost) {
    this.health = host.health.entry(`source:${this.id}`)
  }

  start(): void {
    this.unsubscribe = this.host.subscribe(event => {
      if (event.type === 'ticket.ended') this.onEnded(event.ticket)
    })
    this.summarize()
  }

  stop(): void {
    this.unsubscribe?.()
    this.unsubscribe = undefined
  }

  status(): SourceStatus { return this.last }

  /**
   * One ending, checked against every rule.
   *
   * Runs after the ending's transaction has committed, not inside it — events are published on commit, so a rule never
   * sees state that might still roll back. The file header used to say the opposite, and so did this line; fixing one
   * and not the other is how a corrected comment leaves a lie behind in the same file.
   */
  private onEnded(ticket: Ticket): void {
    const ended = ticket.ended
    if (ended === undefined) return
    const source = this.host.settings().sources.rule
    if (!source.enabled) return
    // Denied or paused means produce nothing, exactly as it does for cron and inbox. Going through the gate instead is
    // lossy in a way that cannot be undone here: the gate stores the Trigger as ignored, and because a rule's Trigger id
    // is a pure function of the ending it answers, that ending can never be re-evaluated — lifting the denial does not
    // resurrect the chain, it just stops refusing new ones.
    const own = sourcePolicy('rule', this.host.settings())
    if (own.paused || own.deny) return
    let complained = false
    for (const rule of source.rules) {
      if (rule.when.outcome !== ended.outcome) continue
      if (rule.when.workId !== undefined && rule.when.workId !== ticket.workId) continue
      const depth = (ticket.origin.depth ?? 0) + 1
      if (depth > rule.maxDepth) {
        // Named rather than quietly skipped: a rule that stops firing because of its own depth limit looks exactly
        // like a rule that stopped matching, and only one of those is a decision somebody made.
        const why = `rule ${rule.id} reached depth ${depth} of at most ${rule.maxDepth}; the chain stops here`
        this.health.problem(`${why} (after Ticket ${ticket.id.slice(0, 8)})`)
        // The health line is the "right now" signal and the next unrelated ending legitimately clears it, so the
        // durable copy goes into the log of the Ticket whose ending stopped the chain. Without this the chain left
        // no trace anywhere: no Trigger, no Decision, no event.
        this.host.engine.ruleChainStopped(ticket.id, { rule: rule.id, depth, maxDepth: rule.maxDepth })
        complained = true
        continue
      }
      const trigger: Trigger = {
        // A pure function of the rule and the ending it answers, so a re-delivered event cannot ask twice — the same
        // property `key('ticket', trigger.id)` has and `key('assignment', ticketId, ordinal)` does not.
        id: key('rule', rule.id, ticket.id, ended.at),
        source: this.id, kind: this.kind, at: new Date().toISOString(),
        actor: { id: rule.id, kind: 'system' },
        text: `${rule.then.prompt}\n\n起因：Ticket ${ticket.id.slice(0, 8)}（${ticket.title}）以 ${ended.outcome} 结束`
          + (ended.reason === undefined ? '' : `，原因：${ended.reason}`),
        title: rule.then.prompt.slice(0, 60),
        meta: {
          depth, originTicketId: ticket.id, rule: rule.id,
          ...(rule.then.scope === undefined ? {} : { scope: rule.then.scope }),
          ...(rule.then.workId === undefined ? {} : { work: rule.then.workId }),
        },
      }
      this.host.effects.enqueue('trigger', key('trigger', trigger.id), trigger)
    }
    // Only summarize when nothing was complained about: `record` writes `ok: true`, so calling it after a problem
    // erases the problem in the same pass that found it — the way the cron Source used to hide its own alarm.
    if (!complained) this.summarize()
  }

  private summarize(): void {
    const source = this.host.settings().sources.rule
    const rules = source.rules.length
    this.last = !source.enabled
      ? { ok: true, detail: 'disabled', counts: { ...this.last.counts } }
      : { ok: true, detail: rules === 0 ? 'no rules' : `${rules} rule(s) watching how Tickets end` }
    this.health.record(this.last.detail)
  }
}

export const ruleKind: SourceKind = { name: 'rule', create: (host: SourceHost): Source => new RuleSource(host) }
