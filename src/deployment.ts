/**
 * Plugin configuration: where this deployment keeps its state, its work and its inbox.
 *
 * Every path has a default under DSH's own home, so the bundle works with no profile edit; a `stateDir` change remounts
 * the plugin, because it is the directory the database and its lock live in. `promptMaxChars` is volatile: the panel
 * reads it on each save.
 */
import { mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { isAbsolute, join, resolve } from 'node:path'
import type { Volatile } from '@deepseek-ai/cordis'
import s from '@deepseek-ai/schemastery'

/** A path a person wrote, with `~` expanded and made absolute against the current directory. */
export function expandPath(value: string): string {
  const text = value.trim()
  if (text === '') return ''
  if (text === '~') return homedir()
  if (text.startsWith('~/')) return join(homedir(), text.slice(2))
  return isAbsolute(text) ? resolve(text) : resolve(process.cwd(), text)
}

/** DSH's home directory, which the harness sets and a bare shell may not. */
export function dshHome(): string {
  const value = process.env.DSH_HOME?.trim()
  return value === undefined || value === '' ? join(homedir(), '.dsh') : expandPath(value)
}

export const Config = s.object({
  stateDir: s.string().description('Directory for the database and its lock. Default: <DSH_HOME>/state/myagent. Changing it remounts the plugin.'),
  workRoot: s.string().description("Directory every Ticket's own directory is made under. Default: <stateDir>/work."),
  inboxDir: s.string().description('Directory where a dropped Markdown file becomes a request. Default: <stateDir>/inbox.'),
  mainSessionId: s.string().description("The operator's front-desk Session id. Default: myagent-main."),
  promptMaxChars: s.number().min(1_000).max(1_000_000).step(1).default(100_000)
    .description('Largest saved prompt override, in characters.').volatile(),
})

export type DeploymentConfig = ReturnType<typeof Config>

/** The resolved directories of this deployment, which every part of the system reads. */
export interface Machine {
  readonly stateDir: string
  readonly workRoot: string
  readonly inboxDir: string
  readonly mainSessionId: string
  readonly promptMaxChars: Volatile<number>
}

/** A configuration or directory problem the panel can show, with the setting it belongs to. */
export class SetupError extends Error {
  constructor(readonly problem: 'stateDir' | 'workRoot' | 'inboxDir' | 'mainSessionId' | 'database', message: string) {
    super(message)
    this.name = 'SetupError'
  }
}

const reason = (error: unknown): string => error instanceof Error ? error.message : String(error)

/** Make a directory this deployment owns, or say which setting is wrong. */
function ensure(directory: string, problem: SetupError['problem'], label: string): string {
  if (directory === '') throw new SetupError(problem, `${label} is empty`)
  try {
    mkdirSync(directory, { recursive: true })
    return directory
  } catch (error) {
    throw new SetupError(problem, `${label} ${directory} could not be made: ${reason(error)}`)
  }
}

/**
 * Resolve the configuration into the directories this deployment uses, making them.
 * @throws SetupError naming the setting that cannot be used.
 */
export function machineOf(config: DeploymentConfig): Machine {
  const known = Object.keys(Config.dict ?? {})
  const unknown = Object.keys(config).filter(key => !known.includes(key))
  if (unknown.length > 0) throw new SetupError('stateDir', `myagent configuration has keys it does not use: ${unknown.join(', ')}`)
  const stateDir = ensure(config.stateDir === undefined || config.stateDir.trim() === ''
    ? join(dshHome(), 'state', 'myagent')
    : expandPath(config.stateDir), 'stateDir', 'The state directory')
  const workRoot = ensure(config.workRoot === undefined || config.workRoot.trim() === ''
    ? join(stateDir, 'work') : expandPath(config.workRoot), 'workRoot', 'The work root')
  const inboxDir = ensure(config.inboxDir === undefined || config.inboxDir.trim() === ''
    ? join(stateDir, 'inbox') : expandPath(config.inboxDir), 'inboxDir', 'The inbox directory')
  const mainSessionId = config.mainSessionId === undefined || config.mainSessionId.trim() === ''
    ? 'myagent-main' : config.mainSessionId.trim()
  if (!/^[A-Za-z0-9_.:-]+$/.test(mainSessionId)) {
    throw new SetupError('mainSessionId', `The main Session id ${mainSessionId} may hold only letters, digits and _ . : -`)
  }
  return { stateDir, workRoot, inboxDir, mainSessionId, promptMaxChars: config.promptMaxChars }
}

/** The paths of this deployment, as the panel shows them. */
export function machineView(machine: Machine): Record<string, string> {
  return { stateDir: machine.stateDir, workRoot: machine.workRoot, inboxDir: machine.inboxDir, mainSessionId: machine.mainSessionId }
}
