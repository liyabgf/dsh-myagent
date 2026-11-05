/**
 * The two recipes an operator actually starts with, checked against the real schema and the real gate.
 *
 * A recipe that rots is worse than no recipe: it looks copy-pasteable and then quietly produces nothing, or produces
 * work under a scope nobody meant. So each one is parsed, scheduled, and run through the intake path here.
 */
import { readdirSync, readFileSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { gate, parseSettings, settingsPolicy } from '../src/core/index.ts'
import { nextRun } from '../src/core/timing.ts'
import { api, deployment, type Deployment } from './helpers/deployment.ts'
import { wait } from './helpers/host.ts'

const example = (name: string): string => readFileSync(join(import.meta.dirname, '..', 'examples', name), 'utf8')
const digestSettings = (): Record<string, unknown> => JSON.parse(example('daily-digest.json')) as Record<string, unknown>

const settle = async (runtime: Deployment['runtime'], ms = 80): Promise<void> => {
  await runtime.nudge()
  await wait(ms)
  runtime.passes.requestPass()
  await wait(ms)
}

describe('the daily digest recipe', () => {
  it('is a settings document the real schema accepts', () => {
    const settings = parseSettings(digestSettings())
    expect(settings.acceptMode).toBe('observe')
    expect(settings.notify.enabled).toBe(true)
    const schedule = settings.sources.cron.schedules[0]!
    expect(schedule).toMatchObject({ id: 'daily-digest', name: '每日竞品摘要', enabled: true })
    expect(schedule.timing).toMatchObject({ kind: 'daily', time: '09:00', timeZone: 'Asia/Shanghai' })
  })

  it('fires within the next day, and not never', () => {
    const schedule = parseSettings(digestSettings()).sources.cron.schedules[0]!
    const from = Date.now()
    const next = nextRun(schedule.timing, new Date(from))
    expect(next).toBeDefined()
    expect(next! - from).toBeLessThanOrEqual(24 * 3600 * 1000)
    expect(next! - from).toBeGreaterThan(0)
  })

  it('ships in observe mode, so the first day records rather than runs', () => {
    const settings = parseSettings(digestSettings())
    const trigger = {
      id: 'cron-1', source: 'cron' as const, kind: 'cron' as const, at: new Date().toISOString(),
      actor: { id: 'operator' as const, kind: 'person' as const }, text: settings.sources.cron.schedules[0]!.prompt,
      title: settings.sources.cron.schedules[0]!.name, meta: { schedule: 'daily-digest' },
    }
    const verdict = settingsPolicy(settings).gate(trigger)
    expect(verdict).toMatchObject({ allow: true, observe: true, reason: 'observed' })
    // And the scope the recipe wrote is the one the work would run under, not the default.
    expect(verdict.scope).toContain('digests')
    // Switching to auto is the only change needed to start running it.
    const running = settingsPolicy(parseSettings({ ...digestSettings(), acceptMode: 'auto' })).gate(trigger)
    expect(running).toMatchObject({ allow: true, observe: false, reason: 'accepted' })
  })

  it('tells the worker what done looks like, and what to do when it is not', () => {
    const prompt = parseSettings(digestSettings()).sources.cron.schedules[0]!.prompt
    // An unattended recipe has to name its own end, or the worker invents one.
    expect(prompt).toContain('myagent_report')
    expect(prompt).toContain('state=ready')
    expect(prompt).toContain('state=failed')
    expect(prompt).toContain('state=blocked')
    expect(prompt).toContain('latest.md')
    // A failure it must not hide: a source it could not reach.
    expect(prompt).toContain('点名')
    expect(prompt.length).toBeGreaterThan(400)
  })

  it('appears in the schedule list with a next run the panel can show', async () => {
    const context = await deployment('observe')
    const { runtime, host } = context
    try {
      await host.request(api('settings'), { method: 'PUT', body: digestSettings() })
      const { json } = await host.request(api('schedules'))
      const schedules = json.schedules as { id: string; next: string; describe: string; prompt: string }[]
      expect(schedules).toHaveLength(1)
      expect(schedules[0]!.id).toBe('daily-digest')
      // Against the route's own `now`, not a `Date.now()` read after the round trip. `http.ts:482` reads the clock
      // once and computes both `json.now` and every `next` from it, so that is the pair the guarantee is actually
      // about; comparing with a later reading made the expectation depend on how long the request took, which is the
      // shape §4.53 records — in a file the round-44 grep, scoped to `sources.spec.ts`, never reached.
      expect(new Date(schedules[0]!.next).getTime()).toBeGreaterThan(Date.parse(json.now as string))
      expect(schedules[0]!.describe).toBeTruthy()
      expect(runtime.settings().sources.cron.schedules[0]!.prompt).toContain('竞品')
    } finally { await runtime.stop() }
  })
})

describe('the data report recipe', () => {
  const request = example('data-report.md')

  it('becomes a Ticket whose title and scope come from its front matter', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      const path = join(context.inbox, 'data-report.md')
      writeFileSync(path, request, 'utf8')
      const at = new Date(Date.now() - 5_000)
      utimesSync(path, at, at)
      await settle(runtime)

      const tickets = runtime.store.tickets.list()
      expect(tickets, `tickets were ${tickets.map(t => `${t.id.slice(0, 8)}/${t.title}`).join(', ')}`).toHaveLength(1)
      const ticket = tickets[0]!
      expect(ticket.title).toBe('月度数据报表')
      expect(ticket.mandate.via).toBe('inbox')
      // The scope the operator wrote in the file is the authorization the work runs under.
      expect(ticket.mandate.scope).toContain('只读 ~/Documents/SA/data/')
      expect(ticket.mandate.scope).toContain('不修改、不移动、不删除')
      // The front matter is not part of the request the worker reads.
      expect(ticket.inputs).toEqual([])
      expect(ticket.assignments.at(-1)).toMatchObject({ state: 'running' })

      const agent = host.agents.get(`worker-${ticket.id}`)!
      const prompt = agent.followups[0]!.text
      expect(prompt).toContain('把 ~/Documents/SA/data/ 下的 *.csv 合成一份月度报表')
      expect(prompt).not.toContain('---\ntitle:')
      expect(prompt).toContain(ticket.mandate.scope)
      expect(prompt).toContain(ticket.execution!.directory)

      // The file left the inbox, so no later poll takes it again.
      const taken = readdirSync(join(context.inbox, 'accepted'))
      // The archived copies' own annotations say which branch wrote each one, which is what distinguishes "two scans
      // each took the file" from "one scan took it twice".
      const annotations = taken.map(name => readFileSync(join(context.inbox, 'accepted', name), 'utf8').split('\n')[0])
      expect(taken, `accepted/ held ${taken.join(', ')} annotated ${JSON.stringify(annotations)}; triggers were ${JSON.stringify(context.runtime.store.triggers.list().map(r => r.trigger.id.slice(0, 8)))}`).toHaveLength(1)
      expect(taken[0]).toContain('data-report.md')
      expect(readdirSync(context.inbox).filter(name => name.endsWith('.md'))).toEqual([])
    } finally { await runtime.stop() }
  })

  it('is refused rather than run while the deployment is still in observe', async () => {
    const context = await deployment('observe')
    const { runtime, host } = context
    try {
      const path = join(context.inbox, 'observed-report.md')
      writeFileSync(path, request, 'utf8')
      const at = new Date(Date.now() - 5_000)
      utimesSync(path, at, at)
      await settle(runtime)
      expect(runtime.store.tickets.list()).toEqual([])
      expect(runtime.store.decisions.list(5)[0]).toMatchObject({ outcome: 'observe' })
      expect(host.calls.sessions).toEqual([])
    } finally { await runtime.stop() }
  })

  it('asks for a decision in the shape the system can act on', () => {
    // A blocked report is the only way a worker reaches a person, so the recipe has to say when to use it.
    expect(request).toContain('state=blocked')
    expect(request).toContain('question')
    expect(request).toContain('state=dropped')
    expect(request).toContain('myagent_report')
  })
})

describe('the gate the recipes run through', () => {
  it('accepts the operator, and nobody the settings do not name', () => {
    const settings = parseSettings({ ...digestSettings(), acceptMode: 'auto' })
    const base = {
      id: 'x', source: 'inbox' as const, kind: 'inbox' as const, at: new Date().toISOString(),
      text: '做点事', title: '做点事',
    }
    expect(gate({ ...base, actor: { id: 'operator', kind: 'person' } }, settings).allow).toBe(true)
    expect(gate({ ...base, actor: { id: 'stranger', kind: 'person' } }, settings)).toMatchObject({
      allow: false, reason: 'sender_not_allowed',
    })
  })
})
