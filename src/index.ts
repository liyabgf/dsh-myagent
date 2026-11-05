/**
 * Main plugin entry: mount the Runtime, and stop it when this plugin is disposed or remounted.
 *
 * The configuration is all optional — `machineOf` resolves every path under DSH's own home — so the bundle works the
 * moment it is installed, and a profile that wants its state elsewhere says so in this entry's config. DSH's own
 * settings page stays enabled, because it is where `stateDir`, `workRoot` and `inboxDir` are edited; the panel at
 * `/myagent/` covers everything that changes while the system runs.
 */
import type { Context } from '@deepseek-ai/cordis'
import { createRuntime, type Runtime } from './app/runtime.ts'
import { Config, type DeploymentConfig } from './deployment.ts'

export const name = 'myagent'

/** The services this plugin reads: agents and their Sessions, the tools and prompt registries, the web server, subprocesses. */
export const inject = [
  'agents', 'sessionController', 'sessionPersistence', 'workspaceRegistry', 'permissionPresets',
  'tools', 'systemPrompt', 'webServer', 'subprocess',
]

export { Config }

/**
 * Mount myagent. This function never rejects and never touches a Session.
 *
 * A bundle that cannot start is a bundle that does nothing: it logs, marks itself unhealthy and leaves the host alone.
 * Mounting is also the wrong moment to create a Session — an agent born during activation is torn down with it if the
 * host's startup fails, which puts a plugin's mistake into the host's own shutdown path. The main Session is created
 * on demand instead, from the panel or from the first Ticket somebody opens in it.
 */
export async function apply(ctx: Context, config: DeploymentConfig): Promise<void> {
  let runtime: Runtime
  try {
    runtime = createRuntime(ctx, config)
  } catch (error) {
    ctx.logger.error('myagent did not start, and the host carries on without it: %s', errorChain(error))
    return
  }
  // Stopping releases the state lock, the routes, the pump and the Store, in that order.
  ctx.effect(() => async () => { await runtime.stop() })
  try {
    await runtime.start()
  } catch (error) {
    runtime.markProblem(`myagent could not finish starting: ${errorChain(error)}`)
    ctx.logger.error('myagent started incompletely: %s', errorChain(error))
    return
  }
  const problem = runtime.setupProblem()
  ctx.logger.info(problem === undefined
    ? `myagent runs; the panel is at /myagent/ and its state is in ${runtime.machine.stateDir}`
    : `myagent runs with a problem: ${problem}`)
}

/** One line per cause, so a mount failure says what actually happened. */
function errorChain(error: unknown): string {
  const parts: string[] = []
  for (let current: unknown = error; current !== undefined && parts.length < 5;) {
    parts.push(current instanceof Error ? `${current.name}: ${current.message}` : String(current))
    current = current instanceof Error ? current.cause : undefined
  }
  return parts.join(' ← ')
}

export { packageFile, promptFile } from './app/prompts.ts'
export type { DeploymentConfig, Machine } from './deployment.ts'
export * from './core/index.ts'
// The Source protocol is part of the package's public contract: `docs/v2/15-p8-contract.md` §4 is written as "what a
// third party implements", and without this line `import type { TwoWaySource } from 'myagent'` does not resolve — the
// interface would exist in the source tree and not in the shipped types, which is the same gap as an Engine command
// with no caller, one layer out.
export * from './sources/kind.ts'
