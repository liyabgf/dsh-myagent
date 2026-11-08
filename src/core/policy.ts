/**
 * The Policy: what settings bear on authorization, the deterministic gate, and the version every Mandate records.
 *
 * v1 keeps one layer of Eval — the gate — because every Trigger it sees was written by the operator: a schedule they
 * configured, a file they dropped in the inbox, or a message they typed. Nothing needs a model's judgement yet, so
 * nothing gets one; the `Assessor` seam in the Engine is where a judgement layer would attach later.
 */
import { z } from 'zod'
import { key } from './ids.ts'
import type { Mandate, MandateVia, SourceKindName, Strength, Trigger } from './model.ts'
import { knownTimeZone, parseCron, parseTime, type Timing } from './timing.ts'

/** One schedule of the cron Source. `id` is stable across edits and names the Trigger's slot. */
export const ScheduleSchema = z.object({
  /**
   * This schedule's stable identity, and the key its next run is remembered under.
   *
   * Required rather than defaulted: two schedules that both omit it would share the empty id, so the cron cursor would
   * hold one next run for both and only one of them would ever fire. Renaming a schedule must not change it either, or
   * its next run is silently recomputed.
   */
  id: z.string().trim().regex(/^[a-z][a-z0-9-]{0,39}$/,
    'lowercase letters, digits and dashes, starting with a letter, at most 40 characters'),
  /** Cosmetic; a Trigger's title falls back to the first line of `prompt`. */
  name: z.string().max(120).default(''),
  enabled: z.boolean().default(true),
  /**
   * The request this schedule produces when it fires — the text a worker receives, so it has to say what to do.
   * Required rather than defaulted: an empty one passes validation and then is refused as an empty request on every
   * firing, which looks like a schedule that silently never runs.
   */
  prompt: z.string().trim().min(1, 'a schedule must say what work it asks for').max(20000),
  /** How far this work may go; empty means the default scope of the accept mode. */
  scope: z.string().max(2000).default(''),
  /**
   * Where this schedule's reports go, as a chat address: `{ channel, thread? }` of a configured chat channel.
   *
   * Without it a scheduled Ticket has no return address at all — its report lands in `RESULT.md` and in the main
   * Session, neither of which is where a chat-first operator looks. That made an unattended daily job invisible by
   * design: the work happened and nobody was told in the room they read. `kind` is fixed to `chat` because that is the
   * only Source kind that routes by channel id; a schedule that wants its answer somewhere else is a different feature.
   */
  deliverTo: z.object({
    channel: z.string().trim().min(1, 'a delivery address needs the channel it delivers to'),
    thread: z.string().trim().min(1).optional(),
  }).optional(),
  timing: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('every'), seconds: z.number().int().min(60).max(30 * 86400) }),
    z.object({ kind: z.literal('daily'), time: z.string(), timeZone: z.string().optional() }),
    z.object({ kind: z.literal('weekly'), time: z.string(), weekdays: z.array(z.number().int().min(1).max(7)).min(1), timeZone: z.string().optional() }),
    z.object({ kind: z.literal('cron'), expression: z.string(), timeZone: z.string().optional() }),
  ]).refine(value => {
    // The zone is checked here because everything downstream assumes it parses: `nextRun` throws on an unknown one,
    // so an unvalidated zone disabled all three Sources from a single settings typo — while the save itself answered
    // 200, because the fire-and-forget sync hid the failure until the panel showed no Sources at all.
    if ('timeZone' in value && value.timeZone !== undefined && !knownTimeZone(value.timeZone)) return false
    try {
      if (value.kind === 'cron') parseCron(value.expression)
      if (value.kind === 'daily' || value.kind === 'weekly') parseTime(value.time)
      return true
    } catch { return false }
  }, { message: 'Not a valid timing: a cron expression needs 5 fields, a time needs HH:mm or HH:mm:ss, a zone needs a name the platform knows' }),
}).strict()

/**
 * The three policy knobs a Source may set for itself. Every one is optional, so a settings document written before
 * they existed still parses — which matters because a document this build cannot parse stops the plugin from mounting
 * at all, and the operator's schedules live in that document.
 */
const SourcePolicyFields = {
  acceptMode: z.enum(['auto', 'observe']).optional(),
  paused: z.boolean().optional(),
  allowedSenders: z.array(z.string().min(1).max(120)).max(50).optional(),
  /**
   * Refuse everything this Source brings, while leaving the Source itself running.
   *
   * Not the same as `enabled: false`, and the difference is not cosmetic: turning a Source off stops it reading, and
   * for cron that used to mean every slot that passed while it was off was gone. A Deny keeps the read position where
   * it is, so lifting the Deny resumes exactly where it stopped.
   */
  deny: z.boolean().optional(),
  /**
   * Whether this Source may originate work nobody wrote.
   *
   * Off by default, and it has to be a setting rather than a rule in code: admitting a system actor is the moment the
   * system can authorize work that no person asked for, which is a decision about trust rather than a detail of
   * plumbing. A Source that earns it — a file watcher, a task-completion rule, a chat platform — turns it on for itself.
   */
  allowSystemActors: z.boolean().optional(),
}

/** The Sources whose requests are worth a judge: a person's words, arriving from outside this machine. */
const TRIAGED_SOURCES: readonly string[] = ['chat', 'inbox', 'cron']

export const SettingsSchema = z.object({
  /**
   * `auto` accepts what the gate admits; `observe` records what it would have accepted without executing it.
   * A new deployment starts in `observe`, and moves to `auto` once the records look right.
   */
  acceptMode: z.enum(['auto', 'observe']).default('observe'),
  /** Actor ids that may originate work, in each Source's own identity space. */
  allowedSenders: z.array(z.string().min(1).max(120)).max(50).default(['operator']),
  /** Processing holds every launch and delivery while paused; nothing expires meanwhile. */
  paused: z.boolean().default(false),
  executor: z.object({
    maxWorkers: z.number().int().min(1).max(8).default(2),
    /** Shell command run in a new Ticket directory's parent before its worker starts; empty only creates the directory. */
    prepare: z.string().max(4000).default(''),
    /** Model for worker Sessions as `provider/model`; empty uses the profile's default. */
    model: z.string().max(200).default(''),
    /** Execution environment boundary (`local` host workspace or isolated `vm` sandbox). */
    sandbox: z.enum(['local', 'vm']).default('local'),
  }).strict().prefault({}),
  sources: z.object({
    cron: z.object({
      enabled: z.boolean().default(true),
      ...SourcePolicyFields,
      schedules: z.array(ScheduleSchema).max(50).default([]).superRefine((schedules, ctx) => {
        const seen = new Set<string>()
        for (const [index, schedule] of schedules.entries()) {
          if (seen.has(schedule.id)) {
            ctx.addIssue({
              code: 'custom', path: [index, 'id'],
              message: `two schedules share the id ${schedule.id}, so they would share one next run`,
            })
          }
          seen.add(schedule.id)
        }
      }),
    }).strict().prefault({}),
    inbox: z.object({
      enabled: z.boolean().default(true),
      ...SourcePolicyFields,
      /** Directory to watch for `*.md` requests; empty uses the deployment's default. */
      directory: z.string().max(4096).default(''),
      pollMs: z.number().int().min(1000).max(600000).default(5000),
    }).strict().prefault({}),
    session: z.object({ enabled: z.boolean().default(true), ...SourcePolicyFields }).strict().prefault({}),
    /**
     * Rules that ask for work when a Ticket ends. This is the Source that originates work nobody wrote, so it needs
     * `allowSystemActors` and every rule's id on `allowedSenders` before anything it produces is accepted — two
     * deliberate gates rather than one, because one setting should not be worth any number of unidentified producers.
     */
    rule: z.object({
      enabled: z.boolean().default(true),
      ...SourcePolicyFields,
      rules: z.array(z.object({
        id: z.string().regex(/^[a-z][a-z0-9-]{0,39}$/, 'a rule id is lowercase letters, digits and hyphens'),
        when: z.object({
          outcome: z.enum(['done', 'dropped', 'stopped', 'failed']),
          /** Only Tickets in this Work, when set. A rule with no Work matches every Ticket, which is rarely wanted. */
          workId: z.string().min(1).max(64).optional(),
        }).strict(),
        then: z.object({
          prompt: z.string().min(1).max(20_000),
          scope: z.string().max(2_000).optional(),
          /** Put the work it asks for in this Work, when it should belong to one. */
          workId: z.string().min(1).max(64).optional(),
        }).strict(),
        /**
         * How deep a chain of rules may go. Without it one self-referential rule is a fork bomb: A ends, asks for B,
         * B ends the same way, asks for C, and nothing in the domain stops.
         */
        maxDepth: z.number().int().min(1).max(10).default(3),
      }).strict()).max(50).default([]),
    }).strict().prefault({}),
    /**
     * A chat platform, or anything else that both brings requests and can take an answer back.
     *
     * Off by default, unlike the four blocks before it: those read something the operator already set up — a schedule
     * list, a directory, the main Session, the rules — while this one reads a place somebody else writes into, so
     * nothing should be reading until a person has said where, and as whom.
     *
     * Every field is defaulted and the block itself prefaults, so a settings document stored before this block existed
     * still parses. That is not a convenience: a document this build cannot parse makes the Runtime constructor throw,
     * `apply` logs one line and returns, and the plugin then silently does nothing at all.
     *
     * `identities` is the security core of the block rather than a transport detail. A platform account becomes an Actor
     * only through that table, every entry produces `kind: 'person'` because the mapping is itself the operator's
     * assertion, and an account that is not in it produces no Trigger at all — its message stays where it is, so adding
     * the mapping admits it on the next pass. Refusing an unmapped account at the gate instead would store the Trigger
     * as `ignored`, and since a Trigger id is a pure function of the message, that message could never be re-evaluated
     * (S9 / N4). The table decides *who*; `allowedSenders` still decides *who may ask*, and one is not worth the other.
     */
    chat: z.object({
      enabled: z.boolean().default(false),
      ...SourcePolicyFields,
      /**
       * Platform account id → the Actor name it speaks as, which is the string `allowedSenders` is compared against.
       * Keyed by the platform's id rather than by the Actor name because one person may hold several accounts and two
       * platforms may reuse one name: the platform id is the fact, the Actor is what the operator makes of it.
       */
      identities: z.record(z.string().min(1).max(120), z.object({
        /** The Actor name this account speaks as. Required and non-empty: a mapping with no name maps nothing. */
        actor: z.string().trim().min(1, 'an identity must name the actor it speaks as').max(120),
        /** Why this account is on the table. Documentation for whoever edits it; it authorizes nothing and is not hashed. */
        note: z.string().max(500).optional(),
      }).strict()).prefault({}),
      /**
       * The places this one Source instance reads and answers. Several, because the standing decision is one instance
       * per kind (D3) while an operator may have more than one channel; multi-instance is a separate architecture change.
       */
      channels: z.array(z.object({
        /**
         * This channel's stable identity: the value a Trigger's `replyTo.channel` carries, and the key its read position
         * is stored under. Required and constrained exactly like a schedule id, for the same reason — two channels
         * sharing an id would share one read position and one reply address.
         */
        id: z.string().trim().regex(/^[a-z][a-z0-9-]{0,39}$/,
          'lowercase letters, digits and dashes, starting with a letter, at most 40 characters'),
        /**
         * Where this channel's messages are, and where its replies go. Required rather than defaulted: an empty one
         * would resolve to the deployment's default for every channel, so several channels would silently read the same
         * place — a channel that looks configured and never receives anything.
         */
        directory: z.string().trim().min(1, 'a channel must say where its messages are').max(4096),
        enabled: z.boolean().default(true),
      }).strict()).max(20).prefault([]).superRefine((channels, ctx) => {
        const seen = new Set<string>()
        for (const [index, channel] of channels.entries()) {
          if (seen.has(channel.id)) {
            ctx.addIssue({
              code: 'custom', path: [index, 'id'],
              message: `two channels share the id ${channel.id}, so they would share one read position and one reply address`,
            })
          }
          seen.add(channel.id)
        }
      }),
      /** How often to look, in milliseconds, with the inbox's bounds: a directory of messages is the shape this follows. */
      pollMs: z.number().int().min(1000).max(600000).default(5000),
    }).strict().prefault({}),
  }).strict().prefault({}),
  /**
   * What notices work that has stopped moving. Every field is defaulted and the block itself prefaults, so a settings
   * document written before it existed still parses — a document this build cannot parse stops the plugin mounting at
   * all, and the operator's schedules live in that document.
   */
  watchdog: z.object({
    enabled: z.boolean().default(true),
    /** How often to look, in milliseconds. */
    everyMs: z.number().int().min(10_000).max(3_600_000).default(60_000),
    /** A launch still "starting" after this long is not starting. Zero turns the detector off. */
    launchStuckMs: z.number().int().min(0).max(86_400_000).default(600_000),
    /**
     * A running attempt whose Session has produced nothing for this long is interrupted and continued by a fresh one.
     * Zero — the default — turns the detector off, because "nothing happened for an hour" is a judgement about the
     * operator's own work, and a Watchdog that starts interrupting long-running commands on the day it is installed
     * is worse than one that is off.
     */
    silentMs: z.number().int().min(0).max(604_800_000).default(0),
    /**
     * How many times a Ticket whose turn died in an upstream error is relaunched automatically before it goes to a
     * person. 0 means no cap: the operator's standing instruction is that work keeps moving until it is done, and a
     * flaky upstream is not a reason to stop — the failed turn's own duration is the backoff. The escape hatch exists
     * because an upstream that is down for a day would otherwise burn a day of retries.
     */
    autoRetry: z.boolean().default(true),
    autoRetryMax: z.number().int().min(0).max(1000).default(0),
    /** How many rescues one Ticket gets before the Watchdog stops and tells a person instead. */
    maxActions: z.number().int().min(1).max(10).default(2),
  }).strict().prefault({}),
  notify: z.object({
    /** Post a local notification when a Ticket needs a person or finishes. */
    enabled: z.boolean().default(false),
  }).strict().prefault({}),
  /**
   * Whether a request from a Source is triaged before it becomes work (S3b).
   *
   * Off by default: it costs one Session turn per request, and an operator who has not decided they want a judge in
   * front of their inbox should not pay for one. Turning it on or off does NOT move the policy version — routing a
   * future request differently does not invalidate an authorization already granted, and bumping the version would
   * notify every open Ticket about a change that bears on none of them.
   *
   * `desk` decides WHO triages:
   * - `dedicated` (default) — each triage Ticket gets its own Session, like a worker's. Intake is unattended and the
   *   operator's conversation is attended, so the default keeps them apart: a busy group would otherwise be queued
   *   behind whatever the operator is doing, and would spend their context.
   * - `main` — the operator's own Session is the desk. It has the context they have been building, and they can steer
   *   it mid-decision, which no dedicated Session can offer. The cost is the two things above.
   *
   * `main` needs one tool `dedicated` does not: the desk has to be able to CLOSE a triage Ticket, and the main Session
   * has no `myagent_report` (that is a worker's, bound to an attempt). Hence `myagent_close_ticket`, which is why this
   * knob could not ship before that tool existed — a setting whose other value silently behaves like the first is
   * worse than no setting at all.
   */
  triage: z.object({
    enabled: z.boolean().default(false),
    desk: z.enum(['dedicated', 'main']).default('dedicated'),
  }).strict().prefault({}),
}).strict()

export type Settings = z.infer<typeof SettingsSchema>
export type Schedule = z.infer<typeof ScheduleSchema>
export type { Timing }

/** Parse and fill defaults for a stored settings document. @throws a `z.ZodError` naming every offending path. */
export const parseSettings = (value: unknown): Settings => SettingsSchema.parse(value)

/** The settings that bear on authorization, in a stable shape for hashing. */
function authorizationShape(settings: Settings): unknown {
  return {
    acceptMode: settings.acceptMode,
    allowedSenders: [...settings.allowedSenders].sort(),
    cron: settings.sources.cron.enabled
      ? settings.sources.cron.schedules.map(schedule => ({
        id: schedule.id, enabled: schedule.enabled, prompt: schedule.prompt, scope: schedule.scope, timing: schedule.timing,
      })).sort((a, b) => a.id.localeCompare(b.id))
      : false,
    inbox: settings.sources.inbox.enabled ? { directory: settings.sources.inbox.directory } : false,
    session: settings.sources.session.enabled,
    // Per-Source mode and sender list are authorization: tightening one has to reach the Tickets it already accepted.
    // `paused` is deliberately absent, exactly as the global one is — pausing holds work, it does not withdraw the
    // authorization to do it, and stamping a policy-change note onto every live Ticket of a paused Source would say
    // the opposite of what happened.
    perSource: sourceKinds(settings).map(kind => {
      const own = sourcePolicy(kind, settings)
      return {
        kind, acceptMode: own.acceptMode, deny: own.deny, allowSystemActors: own.allowSystemActors,
        // Whether the Source may originate work at all is authorization, so it belongs in this derived entry rather
        // than in a per-kind clause above. cron/inbox/session each hard-coded their own `enabled` handling, and the
        // kinds added later appeared only here — so disabling the rule Source (and then chat) never moved
        // `policyVersion`, while the comment below claimed every disabled Source was covered. Deriving it fixes both
        // at once and makes the next kind correct by construction, which is the same lesson as S33's three
        // fallthroughs: a list of kinds is a list of things to forget.
        enabled: settings.sources[kind].enabled,
        allowedSenders: [...own.allowedSenders].sort(),
        // Who this Source asserts its events came from is part of who may originate work, so it is hashed with the rest
        // of that Source's authorization: tightening an identity map has to reach the Tickets it already accepted,
        // exactly as narrowing a sender list does. `false` for a kind with no map, so every entry keeps one shape.
        identities: identityShape(kind, settings),
      }
    }),
    // A Source that is not running at all is a fact about authorization too, and it is already covered above by the
    // `false` this shape records for a disabled Source.
    globalPaused: false,
  }
}

/**
 * The identifier of one combination of authorization-bearing settings. Every Mandate records it, so a change that
 * bears on a live Ticket can be named and delivered to it.
 */
export const policyVersion = (settings: Settings): string => key('policy', authorizationShape(settings)).slice(0, 16)

/** The fixed codes the gate answers with; the panel words each of them. */
export const GATE_REASONS = {
  accepted: 'The gate admitted this request.',
  paused: 'Processing is paused.',
  source_disabled: 'The Source that produced this request is not enabled.',
  unknown_source: 'No Source of this kind is configured.',
  sender_not_allowed: 'The sender may not originate work here.',
  system_actor: 'A system event may not originate work; only a person on the allowed list may.',
  empty_request: 'The request has no text, so there is nothing to authorize.',
  observed: 'The accept mode is observe: this records what would have been accepted, and executes nothing.',
} as const satisfies Record<string, string>

export type GateReason = keyof typeof GATE_REASONS

/** The gate's verdict on one Trigger. */
export interface GateVerdict {
  /** Whether the request may become a Ticket. */
  readonly allow: boolean
  /** Whether the accept mode records it instead of executing it; true only with `allow`. */
  readonly observe: boolean
  readonly strength: Strength
  readonly via: MandateVia
  /** How far the work may go, as the settings and the Trigger describe it. */
  readonly scope: string
  readonly reason: GateReason
  readonly detail?: string
}

const viaOf: Record<Trigger['kind'], GateVerdict['via']> = { cron: 'schedule', inbox: 'inbox', session: 'session', rule: 'rule', chat: 'chat' }

/** The default scope of an accepted request when nothing narrower is written. */
const DEFAULT_SCOPE = 'Work in this Ticket\'s own directory. Produce files there and report what they are; do not change anything outside it.'

/**
 * The deterministic first layer of Eval: who may originate work, and with what strength.
 * A pure function of the Trigger and the current settings, so the same input always gives the same verdict and the
 * verdict can be recomputed for audit.
 */
/**
 * Every Source kind the settings document has a block for, sorted so the shape does not depend on key order.
 *
 * Derived rather than written out, because the written-out version is how the fourth kind ended up invisible to the
 * policy version while being visible to the gate: two call sites each enumerated three kinds, and adding a Source
 * means finding both. A kind that has a settings block is a kind every call site sees.
 */
const sourceKinds = (settings: Settings): SourceKindName[] =>
  (Object.keys(settings.sources) as SourceKindName[]).sort((a, b) => a.localeCompare(b))

/** One Source's own policy, falling back to the global setting for anything it does not set. */
export function sourcePolicy(kind: SourceKindName, settings: Settings): {
  paused: boolean; deny: boolean; allowSystemActors: boolean
  acceptMode: 'auto' | 'observe'; allowedSenders: readonly string[]
} {
  // Every kind named, not a chain with a fallthrough: the fallthrough sent `rule` to the session block, so a rule
  // Source's own `allowSystemActors` was never read and every Trigger it produced was refused as a system actor.
  const own = settings.sources[kind]
  return {
    paused: own.paused ?? settings.paused,
    deny: own.deny ?? false,
    allowSystemActors: own.allowSystemActors ?? false,
    acceptMode: own.acceptMode ?? settings.acceptMode,
    allowedSenders: own.allowedSenders ?? settings.allowedSenders,
  }
}

/**
 * The identity assertions one Source's own block carries, as a stable shape for hashing; `false` when it carries none.
 *
 * Read from that kind's own block and nothing else, for the reason `sourcePolicy` gives: a fallthrough here would hash
 * one Source's identity map into another's digest, with the S33 symptom — a version that moves when an unrelated Source
 * is edited, or that does not move when the map which authorized a live Ticket is narrowed.
 *
 * `note` is left out on purpose. It documents the map for whoever edits it; hashing it would tell every live Ticket that
 * its authorization had changed because somebody reworded a comment.
 */
function identityShape(kind: SourceKindName, settings: Settings): unknown {
  const own = settings.sources[kind]
  // Asked of the block at runtime rather than enumerated per kind: only `chat` has a map today, and writing out which
  // kinds have one is the same enumeration that went wrong three times when the fourth kind arrived. The shape read here
  // is the one `sources.chat.identities` declares — a block that grows a differently shaped map has to change this too.
  if (!('identities' in own)) return false
  const identities = own.identities as Readonly<Record<string, { readonly actor: string }>>
  return Object.keys(identities).sort().map(id => ({ id, actor: identities[id]!.actor }))
}

export function gate(trigger: Trigger, settings: Settings): GateVerdict {
  const via = viaOf[trigger.kind]
  const refuse = (reason: GateReason, detail?: string): GateVerdict =>
    ({ allow: false, observe: false, strength: 'explicit', via, scope: '', reason, detail })
  // A kind this build has no rules for is refused rather than treated as one of the known ones: a Source added later
  // must earn its way through the gate, not slip in by falling through a chain of ternaries.
  if (via === undefined) return refuse('unknown_source', `No gate rule for a ${trigger.kind} Trigger`)
  const own = sourcePolicy(trigger.kind, settings)
  if (own.paused) return refuse('paused')
  if (!settings.sources[trigger.kind].enabled) {
    return refuse('source_disabled', `The ${trigger.kind} Source is not enabled`)
  }
  if (own.deny) return refuse('source_disabled', `The ${trigger.kind} Source is denied`)
  if (trigger.text.trim() === '') return refuse('empty_request')
  if (trigger.actor.kind === 'system' && !own.allowSystemActors) {
    return refuse('system_actor', `Actor ${trigger.actor.id} is a system actor and the ${trigger.kind} Source may not originate work`)
  }
  if (!own.allowedSenders.includes(trigger.actor.id)) {
    return refuse('sender_not_allowed', `${trigger.actor.id} is not on the allowed list`)
  }
  const scope = requestedScope(trigger, settings) ?? DEFAULT_SCOPE
  if (own.acceptMode === 'observe') return { allow: true, observe: true, strength: 'explicit', via, scope, reason: 'observed' }
  return { allow: true, observe: false, strength: 'explicit', via, scope, reason: 'accepted' }
}

/**
 * The scope written on the request itself: a cron schedule's `scope`, an inbox file's front matter, or the main
 * Session's tool argument. All three come from the operator, so all three may narrow or widen the default — and none
 * of them may grant work the gate refused.
 */
function requestedScope(trigger: Trigger, settings: Settings): string | undefined {
  const own = trigger.meta?.scope
  if (typeof own === 'string' && own.trim() !== '') return own.trim()
  if (trigger.kind !== 'cron') return undefined
  const scheduleId = trigger.meta?.schedule
  if (typeof scheduleId !== 'string') return undefined
  const scope = settings.sources.cron.schedules.find(schedule => schedule.id === scheduleId)?.scope
  return scope === undefined || scope.trim() === '' ? undefined : scope.trim()
}

/** The Policy the Engine reads: a fresh, stateless object built from the current settings. */
export interface Policy {
  readonly version: string
  readonly paused: boolean
  readonly acceptMode: Settings['acceptMode']
  gate(trigger: Trigger): GateVerdict
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
  triage(trigger: Trigger): boolean
  /** Whether an existing Mandate still holds under these settings, and why not when it does not. */
  revalidate(mandate: Mandate): { readonly holds: boolean; readonly reason?: GateReason; readonly detail?: string }
}

export function settingsPolicy(settings: Settings): Policy {
  const version = policyVersion(settings)
  return {
    version,
    paused: settings.paused,
    acceptMode: settings.acceptMode,
    gate: trigger => gate(trigger, settings),
    triage: trigger => settings.triage.enabled
      && (typeof trigger.meta?.depth === 'number' ? trigger.meta.depth : 0) === 0
      && TRIAGED_SOURCES.includes(trigger.source),
    revalidate(mandate) {
      // Pausing is deliberately not here: it holds execution rather than withdrawing an authorization, so a paused
      // Ticket keeps its Mandate and resumes under it. That is also why `paused` is not part of the policy version.
      if (mandate.sender.kind === 'person' && !settings.allowedSenders.includes(mandate.sender.id)) {
        return { holds: false, reason: 'sender_not_allowed' as const, detail: `${mandate.sender.id} may no longer start work here` }
      }
      // `inferred` strength does not occur in v1 — every Source is something the operator wrote — so there is no
      // accept-mode rule to apply here. It arrives with a chat Source, and this is where its rule goes.
      return { holds: true }
    },
  }
}

/** How a settings change bears on one open Ticket. */
/** A settings change that bears on one live Ticket, in the gate's own words. */
export interface PolicyEffect {
  readonly ticketId: string
  /** Why this Ticket's Mandate no longer holds, which is one of the gate's fixed reasons. */
  readonly reason: GateReason
  readonly detail?: string
}

/**
 * Which open Tickets a settings change bears on, and how. Only these are told: a change is delivered to the work in
 * flight rather than cancelling it, because a cancelled change leaves half-finished work behind.
 */
export function policyEffects(
  tickets: readonly { readonly id: string; readonly mandate: Mandate; readonly ended?: unknown }[],
  before: Settings,
  after: Settings,
): PolicyEffect[] {
  if (policyVersion(before) === policyVersion(after)) return []
  // The same question the gate answers for a new request, asked of an authorization that already exists — so one rule
  // set decides both, and an effect can never disagree with the gate that produced the Mandate.
  const policy = settingsPolicy(after)
  const effects: PolicyEffect[] = []
  for (const ticket of tickets) {
    if (ticket.ended !== undefined) continue
    const verdict = policy.revalidate(ticket.mandate)
    if (verdict.holds || verdict.reason === undefined) continue
    effects.push({ ticketId: ticket.id, reason: verdict.reason, detail: verdict.detail })
  }
  return effects
}
