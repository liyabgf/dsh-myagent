/**
 * Prompts: the built-in text of each role, the operator's overrides, and what a Session actually runs under.
 *
 * Prompts are how the operator tunes this system's behaviour, so they are editable and take effect on the next turn —
 * a behaviour described in words is prompt text, not a setting. A revision counter lets `Sessions` notice a change
 * and rebind the running Sessions instead of waiting for a restart.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { BUILTIN_SKILL_NAMES } from './skills.ts'
import { KV, type Store } from './store.ts'

/** The roles that have a prompt of their own. */
export type PromptRole = 'worker' | 'orchestrator' | 'triage'
export const PROMPT_ROLES: readonly PromptRole[] = ['worker', 'orchestrator', 'triage']

/** One role's file in the package, without its extension. */
const FILES: Record<PromptRole, string> = { worker: 'worker.md', orchestrator: 'orchestrator.md', triage: 'triage.md' }
/** The largest override the operator may store, in characters, per role. */
export const PROMPT_MAX_CHARS = 100_000

/**
 * Resolve a file this package ships, from wherever this module ended up.
 *
 * The build bundles everything into `lib/index.js`, while tests and a source checkout run `src/app/prompts.ts`, so the
 * distance to the package root is not one number: both are probed, and the first that holds the file wins.
 * @param relative a path relative to the package root, such as `prompts/worker.md`.
 * @throws when the installation does not ship it.
 */
export function packageFile(relative: string): string {
  for (const up of ['..', '../..', '.']) {
    const candidate = resolve(import.meta.dirname, up, relative)
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`${relative} is missing from this myagent installation`)
}

/** The path of a built-in prompt file. @throws when the installation does not ship it. */
export function promptFile(role: PromptRole): string {
  return packageFile(join('prompts', FILES[role]))
}

/** The operator's stored overrides, keyed by role. */
export const SKILL_SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

/**
 * A reusable tool/skill asset distilled from a Ticket's work and stored alongside the prompt configuration (E2,
 * modelled after `dsh-superagent-prototype`'s `PromptConfig.skills`).
 */
export interface SavedSkill {
  /** Kebab-case identifier, registered in DSH as `myagent-skill-<name>` (or `<name>` when already prefixed). */
  readonly name: string
  /** Plain-language title shown to non-engineer users on the panel. */
  readonly title: string
  /** One-sentence plain-language summary of what this craft does. */
  readonly description: string
  /** Full Markdown body (usage + self-contained script) registered as a virtual DSH skill. */
  readonly content: string
  /** The Ticket that created or last updated this skill, for provenance and backlinks. */
  readonly fromTicketId?: string
  readonly createdAt: string
  readonly updatedAt: string
  /**
   * Live for the next worker without anyone approving it.
   *
   * Deliberately `true` on save. The one thing this system must not do is hand its operator a daily approval queue:
   * a craft that waited for a click in the panel would be a craft the next Ticket re-derives, which is the exact cost
   * promotion exists to remove. Containment is done by WHERE a craft is registered — one worker agent's own scope
   * layer, never the host's global catalog (`registerDynamicSkills` in `skills.ts`) — and not by making a person the
   * gate. Pausing one from the panel stays available for a craft that turns out to be wrong.
   */
  readonly enabled: boolean
  /**
   * How many TICKETS have loaded this craft successfully — not how many times the `skill` tool was called.
   *
   * One Ticket counts once however often its worker loads the craft, and a load that failed counts not at all; the
   * per-Ticket dedupe and the "did it actually load" test live in `Sessions`, which is the only place that knows both
   * the Ticket and the tool's outcome. A number that rose on every call was a number a worker could raise by calling
   * in a loop, and the panel reads it as "this proved useful".
   */
  readonly useCount: number
}

export interface PromptConfig {
  worker?: string
  orchestrator?: string
  triage?: string
  skills?: Record<string, SavedSkill>
}

/** Thrown when an override cannot be stored, with the reason the panel shows. */
export class PromptConflict extends Error {}

/** The prompt text of one revision, which is what a Session is bound to. */
export interface PromptVersion {
  readonly revision: number
  readonly role: PromptRole
  readonly text: string
  /** The built-in text of this role, for the panel's diff against the default. */
  readonly base: string
}

export class Prompts {
  private readonly cache = new Map<PromptRole, string>()
  // C05: include atomic() so config+revision can be written in a single SQLite transaction.
  private readonly store: Pick<Store, 'get' | 'set' | 'atomic'>

  constructor(store: Pick<Store, 'get' | 'set' | 'atomic'>) { this.store = store }

  /** The shipped text of a role, read once per process. */
  base(role: PromptRole): string {
    let text = this.cache.get(role)
    if (text === undefined) { text = readFileSync(promptFile(role), 'utf8'); this.cache.set(role, text) }
    return text
  }

  config(): PromptConfig { return this.store.get<PromptConfig>(KV.promptsConfig) ?? {} }

  /** The text a role runs under now: the operator's override, or the built-in text. */
  current(role: PromptRole): string {
    const override = this.config()[role]
    return override === undefined || override.trim() === '' ? this.base(role) : override
  }

  revision(): number { return this.store.get<number>(KV.promptsRevision) ?? 0 }

  version(role: PromptRole): PromptVersion {
    return { revision: this.revision(), role, text: this.current(role), base: this.base(role) }
  }

  /**
   * Store overrides for the roles named, leaving the others as they are.
   * An empty string removes an override, so the role returns to its built-in text.
   * @throws PromptConflict when an override is not a string or is too long.
   */
  private readonly listeners = new Set<() => void>()

  /** Subscribe to skill/prompt changes so runtime DSH virtual skills re-sync immediately. */
  onChange(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  private notifyChange(): void {
    for (const listener of [...this.listeners]) {
      try { listener() } catch { /* listener errors must not break persistence */ }
    }
  }

  /** All saved team skills, newest first. */
  skills(): SavedSkill[] {
    const map = this.config().skills ?? {}
    return Object.values(map).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
  }

  /** Save or update a promoted skill in `PromptConfig.skills` and bump revision. */
  saveSkill(input: {
    name: string; title: string; description: string; content: string; fromTicketId?: string; enabled?: boolean
  }): SavedSkill {
    const rawName = input.name.trim().toLowerCase().replace(/^myagent-/, '')
    if (!SKILL_SLUG.test(rawName)) {
      throw new PromptConflict(`Skill name "${input.name}" must be lower-case kebab-case (letters, digits, hyphens)`)
    }
    const fullName = `myagent-${rawName}`
    // Derived from `SKILLS` rather than spelled out here: this used to be a literal list of three names, which is a
    // second copy of a fact `skills.ts` owns — and a copy is what drifts. Adding a fourth built-in there left this
    // refusal behind, so a worker could have promoted a craft under a built-in's name; the host resolves a duplicate
    // name in one layer by IGNORING the second registration and returning a disposer that does nothing, so the craft
    // would have looked saved on the panel and been unreachable in every worker.
    if (BUILTIN_SKILL_NAMES.includes(fullName)) {
      throw new PromptConflict(`Skill name "${fullName}" is reserved for a built-in myagent skill`)
    }
    const title = input.title.trim()
    const description = input.description.trim()
    const content = input.content.trim()
    if (!title || !description || !content) {
      throw new PromptConflict('Skill title, description and content are required')
    }
    if (content.length > PROMPT_MAX_CHARS) {
      throw new PromptConflict(`Skill content is longer than ${PROMPT_MAX_CHARS} characters`)
    }
    const now = new Date().toISOString()
    const current = this.config()
    const existing = current.skills?.[fullName]
    const saved: SavedSkill = {
      name: fullName,
      title,
      description,
      content,
      ...(input.fromTicketId !== undefined ? { fromTicketId: input.fromTicketId } : existing?.fromTicketId !== undefined ? { fromTicketId: existing.fromTicketId } : {}),
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      enabled: input.enabled ?? existing?.enabled ?? true,
      useCount: existing?.useCount ?? 0,
    }
    const nextSkills = { ...(current.skills ?? {}), [fullName]: saved }
    const next: PromptConfig = { ...current, skills: nextSkills }
    // C05: write config and revision atomically so a crash between the two
    // cannot leave config updated but revision unchanged.
    this.store.atomic(() => {
      this.store.set(KV.promptsConfig, next)
      this.store.set(KV.promptsRevision, this.revision() + 1)
    })
    this.notifyChange()
    return saved
  }

  /** Enable or pause a saved skill from the panel. */
  setSkillEnabled(name: string, enabled: boolean): SavedSkill {
    const current = this.config()
    const existing = current.skills?.[name]
    if (existing === undefined) throw new PromptConflict(`No saved skill named ${name}`)
    const updated: SavedSkill = { ...existing, enabled, updatedAt: new Date().toISOString() }
    this.store.atomic(() => {
      this.store.set(KV.promptsConfig, { ...current, skills: { ...current.skills, [name]: updated } })
      this.store.set(KV.promptsRevision, this.revision() + 1)
    })
    this.notifyChange()
    return updated
  }

  /** Remove a saved skill from the library. */
  removeSkill(name: string): void {
    const current = this.config()
    if (current.skills?.[name] === undefined) throw new PromptConflict(`No saved skill named ${name}`)
    const nextSkills = { ...current.skills }
    delete nextSkills[name]
    const next: PromptConfig = { ...current }
    if (Object.keys(nextSkills).length === 0) delete next.skills
    else next.skills = nextSkills
    this.store.atomic(() => {
      this.store.set(KV.promptsConfig, next)
      this.store.set(KV.promptsRevision, this.revision() + 1)
    })
    this.notifyChange()
  }

  /**
   * Increment the use counter of a saved skill and return its record when it is a saved skill.
   *
   * The counter primitive, and nothing more: it answers `undefined` for a name that is not in the library, so a
   * skill a worker invented or misspelled is not counted, but it does NOT know which Ticket asked. The rule that
   * makes `useCount` mean "tickets that used this" rather than "calls" — one Ticket counts once, and only for a load
   * the host actually completed — is enforced by the single caller, `Sessions`, which is where both facts are.
   *
   * @returns the updated record, or `undefined` when no saved skill has this name.
   */
  recordSkillUse(name: string): SavedSkill | undefined {
    const current = this.config()
    const existing = current.skills?.[name]
    if (existing === undefined) return undefined
    const updated: SavedSkill = { ...existing, useCount: existing.useCount + 1 }
    this.store.set(KV.promptsConfig, { ...current, skills: { ...current.skills, [name]: updated } })
    return updated
  }

  save(config: PromptConfig): number {
    for (const [role, text] of Object.entries(config)) {
      if (role === 'skills') continue
      if (!PROMPT_ROLES.includes(role as PromptRole)) throw new PromptConflict(`${role} is not a prompt role`)
      if (text !== undefined && typeof text !== 'string') throw new PromptConflict(`${role} must be a string`)
      if (typeof text === 'string' && text.length > PROMPT_MAX_CHARS) {
        throw new PromptConflict(`${role} is longer than ${PROMPT_MAX_CHARS} characters`)
      }
    }
    const next: PromptConfig = { ...this.config() }
    for (const [role, text] of Object.entries(config)) {
      if (role === 'skills') continue
      if (text === undefined || (typeof text === 'string' && text.trim() === '')) delete next[role as PromptRole]
      else next[role as PromptRole] = text as string
    }
    const revision = this.revision() + 1
    this.store.atomic(() => {
      this.store.set(KV.promptsConfig, next)
      this.store.set(KV.promptsRevision, revision)
    })
    this.notifyChange()
    return revision
  }

  /**
   * Whether a role carries an override that says exactly what the shipped text says, and so does nothing. The panel
   * marks it, because such an override silently pins the role to text a later release would otherwise update.
   */
  overrideIsBase(role: PromptRole): boolean {
    return this.config()[role] !== undefined && this.current(role) === this.base(role)
  }
}
