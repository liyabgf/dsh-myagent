/**
 * Prompts: the built-in text of each role, the operator's overrides, and what a Session actually runs under.
 *
 * Prompts are how the operator tunes this system's behaviour, so they are editable and take effect on the next turn —
 * a behaviour described in words is prompt text, not a setting. A revision counter lets `Sessions` notice a change
 * and rebind the running Sessions instead of waiting for a restart.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
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
export interface PromptConfig {
  worker?: string
  orchestrator?: string
  triage?: string
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
  private readonly store: Pick<Store, 'get' | 'set'>

  constructor(store: Pick<Store, 'get' | 'set'>) { this.store = store }

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
  save(config: PromptConfig): number {
    for (const [role, text] of Object.entries(config)) {
      if (!PROMPT_ROLES.includes(role as PromptRole)) throw new PromptConflict(`${role} is not a prompt role`)
      if (text !== undefined && typeof text !== 'string') throw new PromptConflict(`${role} must be a string`)
      if (typeof text === 'string' && text.length > PROMPT_MAX_CHARS) {
        throw new PromptConflict(`${role} is longer than ${PROMPT_MAX_CHARS} characters`)
      }
    }
    const next: PromptConfig = { ...this.config() }
    for (const [role, text] of Object.entries(config)) {
      if (text === undefined || text.trim() === '') delete next[role as PromptRole]
      else next[role as PromptRole] = text
    }
    const revision = this.revision() + 1
    this.store.set(KV.promptsConfig, next)
    this.store.set(KV.promptsRevision, revision)
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
