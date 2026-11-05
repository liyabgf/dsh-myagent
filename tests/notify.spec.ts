/**
 * Telling somebody: the record a finished Ticket leaves, and the notice that reaches the operator's front desk.
 *
 * An unattended system that finishes work silently is a system nobody can use, so each of these has to land — and a
 * courtesy that cannot be delivered (a desktop notification on a machine without one) must never take the record with it.
 */
import { readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { api, deployment, type Deployment } from './helpers/deployment.ts'
import { stubHost, wait } from './helpers/host.ts'

const workerId = (ticketId: string) => `worker-${ticketId}`
const signal = () => new AbortController().signal

async function settle(runtime: Deployment['runtime'], ms = 80): Promise<void> {
  await runtime.nudge()
  await wait(ms)
  runtime.passes.requestPass()
  await wait(ms)
}

/** One Ticket, accepted, with a worker that has its report tool. */
async function started(context: Deployment, text = '写一份摘要'): Promise<string> {
  const path = `${context.inbox}/task-${Math.random().toString(36).slice(2, 8)}.md`
  writeFileSync(path, text, 'utf8')
  const at = new Date(Date.now() - 5_000)
  utimesSync(path, at, at)
  await settle(context.runtime)
  const id = context.runtime.store.tickets.list()[0]!.id
  expect(context.host.tool(workerId(id), 'myagent_report')).toBeDefined()
  return id
}

const report = (context: Deployment, id: string, args: unknown) =>
  context.host.tool(workerId(id), 'myagent_report')!.definition.execute(args, { signal: signal() })

describe('the record a finished Ticket leaves', () => {
  it('writes RESULT.md in the Ticket\'s own directory, and leaves a notice rather than waking the front desk', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      await runtime.createMainSession()
      const id = await started(context)
      const directory = runtime.store.tickets.get(id)!.execution!.directory
      await report(context, id, { state: 'ready', summary: '写好了 digest.md', files: ['digest.md'] })
      await settle(runtime)
      const document = readFileSync(join(directory, 'RESULT.md'), 'utf8')
      expect(document).toContain('# ')
      expect(document).toContain('写好了 digest.md')
      expect(document).toContain('- digest.md')
      // An ending is a notice in the history: it must not cost the operator a model turn to read it.
      const main = host.agents.get('myagent-main')!
      expect(main.notices).toHaveLength(1)
      expect(main.followups).toEqual([])
      expect(main.notices[0]!.text).toContain('写好了 digest.md')
      expect(runtime.store.effectCounts()).toEqual({})
    } finally { await runtime.stop() }
  })

  it('wakes the front desk when the worker needs a decision', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      await runtime.createMainSession()
      const id = await started(context)
      await report(context, id, { state: 'blocked', summary: '需要决定', question: '按公司还是按产品？' })
      await settle(runtime)
      const main = host.agents.get('myagent-main')!
      // A question is a message the operator answers, so it is queued as a turn rather than injected.
      expect(main.followups).toHaveLength(1)
      expect(main.followups[0]!.text).toContain('按公司还是按产品？')
      expect(main.followups[0]!.text).toContain('myagent_answer_ticket')
      // No RESULT.md yet: the Ticket has not ended.
      expect(runtime.store.tickets.get(id)!.ended).toBeUndefined()
    } finally { await runtime.stop() }
  })

  it('still tells the front desk when the record could not be written', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      await runtime.createMainSession()
      const id = await started(context)
      const directory = runtime.store.tickets.get(id)!.execution!.directory
      rmSync(directory, { recursive: true, force: true })
      await report(context, id, { state: 'ready', summary: '写好了' })
      await settle(runtime)
      // The file is a courtesy the directory can refuse; the notice is the record that must survive.
      expect(runtime.health.problems().map(problem => problem.detail).join('\n')).toContain('RESULT.md')
      expect(host.agents.get('myagent-main')!.notices).toHaveLength(1)
      expect(runtime.store.effectCounts()).toEqual({})
    } finally { await runtime.stop() }
  })

  it('settles a notice for a Ticket that is gone, rather than retrying it forever', async () => {
    const context = await deployment('auto')
    const { runtime } = context
    try {
      runtime.store.enqueueEffect('notify', 'notify-gone', { kind: 'report', ticketId: 'no-such-ticket', state: 'ready', summary: 'x', at: '2026-11-03T03:00:00.000Z' })
      await settle(runtime)
      expect(runtime.store.effectCounts()).toEqual({})
      expect(runtime.health.problems()).toEqual([])
    } finally { await runtime.stop() }
  })
})

describe('a settings change that bears on live work', () => {
  it('tells the front desk in the gate\'s own words', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      await runtime.createMainSession()
      const id = await started(context)
      runtime.saveSettings({ acceptMode: 'auto', allowedSenders: ['someone-else'], sources: { inbox: { directory: context.inbox, pollMs: 1000 } } })
      await settle(runtime)
      const main = host.agents.get('myagent-main')!
      expect(main.notices.at(-1)!.text).toContain(id.slice(0, 8))
      expect(main.notices.at(-1)!.text).toContain('may not originate work')
      // The Ticket keeps working: a change is delivered, never enforced by cancellation.
      expect(runtime.store.tickets.get(id)!.ended).toBeUndefined()
    } finally { await runtime.stop() }
  })
})

describe('the machine notification', () => {
  it('asks the desktop when the operator turned it on, with the summary quoted into it', async () => {
    if (process.platform !== 'darwin') return
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      runtime.saveSettings({ acceptMode: 'auto', notify: { enabled: true }, sources: { inbox: { directory: context.inbox, pollMs: 1000 } } })
      const id = await started(context)
      await report(context, id, { state: 'ready', summary: '写好了 "digest.md"' })
      await settle(runtime)
      const notification = host.calls.spawns.find(spawn => spawn.argv[0] === 'osascript')
      expect(notification).toBeDefined()
      expect(notification!.argv.join(' ')).toContain('display notification')
      // A quote in the summary must not break out of the AppleScript string.
      expect(notification!.argv.join(' ')).toContain('\\"digest.md\\"')
    } finally { await runtime.stop() }
  })

  it('does not ask the desktop when the operator did not turn it on', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      const id = await started(context)
      await report(context, id, { state: 'ready', summary: '写好了' })
      await settle(runtime)
      expect(host.calls.spawns.filter(spawn => spawn.argv[0] === 'osascript')).toEqual([])
    } finally { await runtime.stop() }
  })

  it('carries on when the desktop will not take it, because the notice is the record', async () => {
    if (process.platform !== 'darwin') return
    const context = await deployment('auto', { spawn: { throws: 'osascript: command not found' } })
    const { runtime, host } = context
    try {
      runtime.saveSettings({ acceptMode: 'auto', notify: { enabled: true }, sources: { inbox: { directory: context.inbox, pollMs: 1000 } } })
      const id = await started(context)
      await report(context, id, { state: 'ready', summary: '写好了' })
      await settle(runtime)
      expect(host.agents.size).toBeGreaterThan(0)
      // Settled rather than retried: a courtesy that failed is not work that is owed.
      expect(runtime.store.effectCounts()).toEqual({})
      expect(runtime.store.tickets.get(id)!.ended).toMatchObject({ outcome: 'done' })
    } finally { await runtime.stop() }
  })
})

describe('the panel\'s own view of a finished Ticket', () => {
  it('shows the result and the files, so the operator does not have to open the directory', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      const id = await started(context)
      await report(context, id, { state: 'ready', summary: '写好了', files: ['digest.md', 'notes/x.md'] })
      await settle(runtime)
      const { json } = await host.request(api(`tickets/${id}`))
      expect(json.result).toMatchObject({ summary: '写好了', files: ['digest.md', 'notes/x.md'] })
      expect(json.ended).toMatchObject({ outcome: 'done', by: 'agent' })
      expect(json.stage).toBe('done')
    } finally { await runtime.stop() }
  })

})
