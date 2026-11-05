/** A whole deployment against a stub host, which is what the flow, HTTP and panel tests all need. */
import { join } from 'node:path'
import { Config } from '../../src/deployment.ts'
import { createRuntime, type Runtime } from '../../src/app/runtime.ts'
import { stubHost, type StubHost, type StubOptions } from './host.ts'
import { discard, tempDir } from './temp.ts'

export interface Deployment {
  readonly host: StubHost
  readonly runtime: Runtime
  /** The inbox directory this deployment watches. */
  readonly inbox: string
  /** The directory every Ticket's own directory is made under. */
  readonly work: string
  readonly stateDir: string
  /**
   * Remove {@link stateDir}. Idempotent, and already arranged for the end of the test that asked for this deployment,
   * so a spec calls it only to release the directory sooner. It must not go into the
   * `finally { await runtime.stop() }` that every test has: that finally ends a Runtime, and the three restart cases in
   * `tests/fault-injection.spec.ts` build a second Runtime over the same directory after it. See `./temp.ts`.
   */
  cleanup(): void
}

/**
 * @param acceptMode `observe` records without executing, which is how a fresh deployment starts.
 * @param options passed to the stub host, for a deployment that has to survive a hostile one.
 */
/**
 * @param host an existing stub host, for a case that has to arrange something about the host before the deployment
 *   starts — a Session id DSH answers with, a preset that will not take a restriction, jobs a stop has to kill.
 */
export async function deployment(acceptMode: 'auto' | 'observe' = 'auto', options: StubOptions = {}, host: StubHost = stubHost(options)): Promise<Deployment> {
  const stateDir = tempDir('myagent-test-')
  const inbox = join(stateDir, 'inbox')
  const work = join(stateDir, 'work')
  const runtime = createRuntime(host.ctx, Config({ stateDir, inboxDir: inbox, workRoot: work }) as never)
  runtime.saveSettings({ acceptMode, sources: { inbox: { directory: inbox, pollMs: 1000 } } })
  await runtime.start()
  return { host, runtime, inbox, work, stateDir, cleanup: () => { discard(stateDir) } }
}

/** The path of the API, so a test reads like the panel's own fetch. */
export const api = (path: string): string => `/myagent/api/${path}`
