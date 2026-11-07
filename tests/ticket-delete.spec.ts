/**
 * Deleting a Ticket (S4): two axes, and the one fact that must survive both.
 *
 * The axes are independent because they are two different losses — `assets` is the produced files, `record` is the
 * Ticket itself — and only one of them is recoverable. What must survive every combination is the intake record:
 * a Trigger id is a pure function of the request, so it is the only thing that stops the same message being accepted
 * again as new work, and "a request arrived and was dealt with" is the one fact an unattended system must not lose.
 */
import { existsSync, mkdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { describe, expect, it } from 'vitest'
import { api, deployment, type Deployment } from './helpers/deployment.ts'
import { wait } from './helpers/host.ts'
import { UserError } from '../src/core/errors.ts'

const workerId = (ticketId: string) => `worker-${ticketId}`
const signal = () => new AbortController().signal

async function settle(runtime: Deployment['runtime'], ms = 80): Promise<void> {
  await runtime.nudge()
  await wait(ms)
  runtime.passes.requestPass()
  await wait(ms)
}

/** One Ticket, accepted, with a worker that has its report tool. */
const started = async (context: Deployment, text = '写一份摘要'): Promise<string> => {
  const path = `${context.inbox}/task-${Math.random().toString(36).slice(2, 8)}.md`
  writeFileSync(path, text, 'utf8')
  const at = new Date(Date.now() - 5_000)
  utimesSync(path, at, at)
  await settle(context.runtime)
  return context.runtime.store.tickets.list()[0]!.id
}

const report = (context: Deployment, id: string, args: unknown) =>
  context.host.tool(workerId(id), 'myagent_report')!.definition.execute(args, { signal: signal() })

/** Put some real bytes in a Ticket's directory, so "how much was thrown away" is a measured number. */
function fill(directory: string): void {
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'digest.md'), 'x'.repeat(1200), 'utf8')
  mkdirSync(join(directory, 'sources'), { recursive: true })
  writeFileSync(join(directory, 'sources', 'one.txt'), 'y'.repeat(300), 'utf8')
}

describe('deleting a Ticket', () => {
  /**
   * A live Ticket is not deletable: its worker holds an authorization still in force and its Session may be mid-turn,
   * so removing the record underneath it would leave a Session writing into a directory nobody is accountable for.
   * Stopping is the operator's verb, and the refusal has to name it.
   */
  it('refuses a Ticket that has not ended, and names stopping as the way', async () => {
    const context = await deployment('auto')
    try {
      const id = await started(context)
      expect(context.runtime.store.tickets.get(id)!.ended).toBeUndefined()
      await expect(context.runtime.deleteTicket(id, { assets: 'delete', record: 'tombstone' }))
        .rejects.toSatisfy((error: unknown) => error instanceof UserError
          && /stop it before deleting/.test((error as UserError).message))
      // Nothing was removed on the way to the refusal — the check has no side effects, which is the whole reason it
      // is a separate method: the alternative measures and deletes first and refuses afterwards.
      const directory = context.runtime.store.tickets.get(id)!.execution!.directory
      expect(existsSync(directory)).toBe(true)
      expect(context.runtime.store.tickets.get(id)!.deleted).toBeUndefined()
    } finally { await context.runtime.stop() }
  })

  it('keeps a tombstone that carries the numbers, because after the files are gone nothing else does', async () => {
    const context = await deployment('auto')
    try {
      const id = await started(context)
      const directory = context.runtime.store.tickets.get(id)!.execution!.directory
      fill(directory)
      await report(context, id, { state: 'ready', summary: '写好了', files: ['digest.md'] })
      await settle(context.runtime)

      // Measured independently, BEFORE the deletion, rather than hardcoded: the total includes the RESULT.md the
      // report wrote, and a number copied from one run would silently depend on that template's length.
      const titleBefore = context.runtime.store.tickets.get(id)!.title
      const resultSize = statSync(join(directory, 'RESULT.md')).size
      const expectedBytes = 1200 + 300 + resultSize

      const result = await context.runtime.deleteTicket(id, { assets: 'delete', record: 'tombstone' })
      expect(result).toMatchObject({ deleted: id, assets: 'delete', record: 'tombstone', files: 3, bytes: expectedBytes })
      // Three files: the two written above plus the RESULT.md the report produced.
      expect(existsSync(directory)).toBe(false)

      const tombstone = context.runtime.store.tickets.get(id)!
      expect(tombstone.deleted).toMatchObject({ assets: 'delete', directory, files: 3, bytes: expectedBytes })
      // The record keeps what it said before, whatever that was: this one is titled after the inbox file, which is
      // the fallback when a request carries no title of its own.
      expect(tombstone.title).toBe(titleBefore)
      expect(tombstone.mandate.sender.id).toBeDefined()
      // Hidden from every listing, resolvable by id: a note or an artifact in another Ticket that points here has to
      // read "deleted" rather than fail, and a list that still showed it would be a list of work that no longer exists.
      expect(context.runtime.store.tickets.list().some(ticket => ticket.id === id)).toBe(false)
      expect(context.runtime.store.tickets.deleted().some(ticket => ticket.id === id)).toBe(true)
      // The history says what was removed and by whom.
      const events = context.runtime.store.events.list(id)
      expect(events.some(event => event.type === 'deleted')).toBe(true)
      expect(events.find(event => event.type === 'deleted')!.detail).toMatchObject({ assets: 'delete', record: 'tombstone', files: 3, bytes: expectedBytes })
    } finally { await context.runtime.stop() }
  })

  it('leaves the produced files alone when asked to keep them, which is the default', async () => {
    const context = await deployment('auto')
    try {
      const id = await started(context)
      const directory = context.runtime.store.tickets.get(id)!.execution!.directory
      fill(directory)
      await report(context, id, { state: 'ready', summary: '写好了', files: ['digest.md'] })
      await settle(context.runtime)

      const result = await context.runtime.deleteTicket(id, { assets: 'keep', record: 'tombstone' })
      expect(result.assets).toBe('keep')
      expect(result.files).toBeUndefined()
      expect(existsSync(join(directory, 'digest.md'))).toBe(true)
      expect(context.runtime.store.tickets.get(id)!.deleted).toMatchObject({ assets: 'keep' })
      expect(context.runtime.store.tickets.get(id)!.deleted!.files).toBeUndefined()
    } finally { await context.runtime.stop() }
  })

  /**
   * The invariant that outlives both axes. `record: 'nothing'` removes the Ticket's row, and that is what the operator
   * asked for — but the Trigger and the Decision stay, whatever was chosen. Without the Trigger the same message
   * arriving again is new work rather than a duplicate, and without the Decision there is no answer to "did this ever
   * come in, and what did we decide".
   */
  it('removes the row when asked, and keeps the intake record either way', async () => {
    const context = await deployment('auto')
    try {
      const id = await started(context)
      const ticket = context.runtime.store.tickets.get(id)!
      const triggerId = ticket.origin.triggerId
      await report(context, id, { state: 'ready', summary: '写好了', files: [] })
      await settle(context.runtime)

      const decisionsBefore = context.runtime.store.decisions.list(50).length
      await context.runtime.deleteTicket(id, { assets: 'keep', record: 'nothing' })

      expect(context.runtime.store.tickets.get(id)).toBeUndefined()
      expect(context.runtime.store.tickets.deleted().some(item => item.id === id)).toBe(false)
      // Still there: the dedupe key and the audit of the decision.
      expect(context.runtime.store.triggers.get(triggerId)).toBeDefined()
      expect(context.runtime.store.decisions.list(50)).toHaveLength(decisionsBefore)
      expect(context.runtime.store.decisions.list(50).some(row => row.triggerId === triggerId)).toBe(true)
    } finally { await context.runtime.stop() }
  })

  /**
   * A stored path is not ours just because it is stored. `rm -r` unlinks a symlink instead of following it, so a link
   * inside the directory cannot escape; this guard is for the other direction — a Ticket whose recorded directory
   * points somewhere outside the work root must not be removed on the strength of the record.
   */
  it('refuses to remove a directory outside the work root, and says so where somebody will see it', async () => {
    const context = await deployment('auto')
    const outside = join(tmpdir(), `myagent-outside-${Math.random().toString(36).slice(2, 8)}`)
    try {
      const id = await started(context)
      await report(context, id, { state: 'ready', summary: '写好了', files: [] })
      await settle(context.runtime)
      mkdirSync(outside, { recursive: true })
      writeFileSync(join(outside, 'precious.txt'), 'not yours', 'utf8')
      const ticket = context.runtime.store.tickets.get(id)!
      context.runtime.store.tickets.save({ ...ticket, execution: { ...ticket.execution!, directory: outside } })

      await context.runtime.deleteTicket(id, { assets: 'delete', record: 'tombstone' })

      expect(existsSync(join(outside, 'precious.txt'))).toBe(true)
      const entry = context.runtime.health.entry('panel').snapshot()
      expect(entry.ok).toBe(false)
      expect(entry.detail).toContain('not inside the work root')
    } finally {
      rmSync(outside, { recursive: true, force: true })
      await context.runtime.stop()
    }
  })

  /**
   * The route, not just the method: a typed port that nothing wires still passes a typecheck, and the panel will call
   * this over HTTP. Both defaults are the reversible end, and an unrecognized option is refused rather than read as
   * the default — `asset: 'delete'` silently becoming "keep" is an operator who believes they deleted something.
   */
  it('is reachable over HTTP, defaults to the reversible end, and refuses an option it does not know', async () => {
    const context = await deployment('auto')
    try {
      const id = await started(context)
      await report(context, id, { state: 'ready', summary: '写好了', files: [] })
      await settle(context.runtime)
      const directory = context.runtime.store.tickets.get(id)!.execution!.directory

      const refused = await context.host.request(api(`tickets/${id}/delete`), { method: 'POST', body: { asset: 'delete' } })
      expect(refused.status).toBe(400)
      expect(context.runtime.store.tickets.get(id)!.deleted).toBeUndefined()
      expect(existsSync(directory)).toBe(true)

      const kept = await context.host.request(api(`tickets/${id}/delete`), { method: 'POST', body: {} })
      expect(kept.status).toBe(200)
      expect(kept.json).toMatchObject({ deleted: id, assets: 'keep', record: 'tombstone' })
      expect(existsSync(directory)).toBe(true)
      expect(context.runtime.store.tickets.get(id)!.deleted).toMatchObject({ assets: 'keep' })
    } finally { await context.runtime.stop() }
  })
})
