/**
 * What a Session is decorated with, and the one Session that must be decorated with nothing.
 *
 * S44 (`docs/v2/06-security-risk-register.md` §2.2): `ticketOfSession` answers by SHAPE — any id starting with
 * `worker-` is a worker's, including one myagent never created and no Ticket ever authorized. `decorate` reads
 * `ticket === undefined` as "this is the front desk", so passing that `undefined` on handed such a Session the
 * orchestrator's management tools — `myagent_create_ticket` among them, which opens work that then runs with full
 * access. The fix in `src/app/sessions.ts` `decorateAgent` refuses to decorate at all when the Ticket is missing.
 * This file is what makes reverting it red.
 *
 * Two earlier attempts went green with the defect live, which is why the shape below is not negotiable:
 *
 * 1. The first probed `host.guardOf`. A guard is registered only for a worker — the front desk gets management tools
 *    and no guard — so "no guard" was true of a correctly refused impostor and of one decorated as the orchestrator
 *    alike. An assertion that cannot fail reads as coverage, which is worse than none (discipline 0.8).
 * 2. The second probed `host.toolsOf`, the right probe, but announced a bare `{ id }` as the agent. `decorateAgent`
 *    reached for more of the agent and threw, and the `catch` on its own listener swallowed the throw, so nothing was
 *    registered in either version and the assertion could not tell them apart.
 *
 * Hence the two rules this file follows. The impostor is built by the stub's own factory (`fakeAgent`), so it carries
 * every surface `decorate` touches and records into the very arrays `toolsOf` reads. And the first assertion is a
 * positive control announced through the *identical* mechanism — same factory, same `agent/created` emit — for a
 * Session that IS the front desk, and so must be decorated. Without that control, "this harness records no
 * registration at all", "an announced agent throws before it is decorated" and "the impostor was refused" are one
 * observation, which is exactly how both earlier attempts passed.
 */
import { utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { deployment, type Deployment } from './helpers/deployment.ts'
import { fakeAgent, KNOWN_GLOBAL_TOOLS, wait, type RestrictPolicy } from './helpers/host.ts'

const workerId = (ticketId: string): string => `worker-${ticketId}`

/** A Ticket id no request ever produced: the shape `ticketOfSession` answers to, with nothing behind it. */
const UNBACKED_TICKET = '0'.repeat(32)

/**
 * The answer a plain stub host gives `restrict`, which `fakeAgent` requires and neither path here reaches: the
 * orchestrator is neither restricted nor guarded, and the impostor is refused before the worker path. Spelled out
 * rather than borrowed because the host keeps its own policy private — while the arrays handed in are the host's own,
 * which is the only thing that lets `toolsOf` see what this agent registers.
 */
const POLICY: RestrictPolicy = { knownTools: KNOWN_GLOBAL_TOOLS, fails: false }

/** Ask the system to look now and run what is due, then let the pump finish. */
async function settle(runtime: Deployment['runtime'], ms = 80): Promise<void> {
  await runtime.nudge()
  await wait(ms)
  runtime.passes.requestPass()
  await wait(ms)
}

/** Drop a request file whose mtime is old enough that the Source reads it as settled. */
function drop(inbox: string, name: string, text: string): void {
  const path = join(inbox, name)
  writeFileSync(path, text, 'utf8')
  const at = new Date(Date.now() - 5_000)
  utimesSync(path, at, at)
}

describe('what a Session is decorated with', () => {
  it('gives a Session named like a worker nothing at all when no Ticket is behind the name', async () => {
    const { host, runtime, inbox } = await deployment('auto')
    try {
      /** Announce a Session the way DSH does when one appears, built by the stub's own factory. */
      const announce = (id: string): void => {
        host.emit('agent/created', { agent: fakeAgent(id, host.tools, host.restrictions, host.guards, POLICY) })
      }

      // (1) The control: an announced Session whose id IS the front desk's is decorated as the orchestrator. Mounting
      // creates no Session (`tests/mount.spec.ts`), so nothing else can have registered under this id yet — whatever
      // `toolsOf` finds here, the announcement above put there. The id is read from the deployment rather than spelled
      // out, so a front desk that moved fails here instead of passing over an id nobody decorated.
      const frontDesk = runtime.machine.mainSessionId
      announce(frontDesk)
      await settle(runtime)
      expect(host.toolsOf(frontDesk)).toContain('myagent_create_ticket')

      // (2) The impostor, announced the same way and differing only in having no Ticket behind its name.
      const impostorId = workerId(UNBACKED_TICKET)
      announce(impostorId)
      await settle(runtime)
      // No myagent tool of any kind — not a worker's, and not the orchestrator's management tools either. This is the
      // assertion mutation M1 must redden: with the fix reverted it reads `[ 'myagent_create_ticket', …(6) ]`.
      expect(host.toolsOf(impostorId)).toEqual([])

      // (3) The contrast, which keeps (2) from being satisfied by a decoration path that stopped running for everyone:
      // a real Ticket's worker, made the ordinary way by dropping a request in the inbox, still gets the one tool it
      // reports with.
      drop(inbox, 'real.md', '做点事。')
      await settle(runtime)
      const ticket = runtime.store.tickets.list()[0]!
      expect(host.toolsOf(workerId(ticket.id))).toContain('myagent_report')
    } finally { await runtime.stop() }
  })
})
