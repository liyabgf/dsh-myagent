/**
 * The HTTP surface: the operator's only window into an unattended system.
 *
 * Tested through the registered route handler with a fake request and response, so no server is involved — but the same
 * code runs, including the same-origin fence, the body reader, and the mapping from a domain refusal to a status code
 * and a message a person can act on.
 */
import { describe, expect, it } from 'vitest'
import { chmodSync, mkdirSync, readdirSync, utimesSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { api, deployment, type Deployment } from './helpers/deployment.ts'
import { wait } from './helpers/host.ts'
import type { LostTrigger } from '../src/core/engine.ts'
// The bounds the Store enforces, read from it rather than copied: a test that repeated `20` would keep passing after
// the bound moved, and would then be pinning the route to a number nothing enforces.
import { LOST_TRIGGER_CHARS, LOST_TRIGGER_KEEP } from '../src/app/store.ts'

/** The panel's own headers, which is what makes a request same-origin. */
const PANEL_HEADERS = { host: '127.0.0.1:3080', 'x-myagent-request': '1' }

async function withDeployment(run: (context: Deployment) => Promise<void>, acceptMode: 'auto' | 'observe' = 'auto'): Promise<void> {
  const context = await deployment(acceptMode)
  try { await run(context) } finally { await context.runtime.stop() }
}

/** Create one Ticket through the API and return its id. */
async function createTicket(context: Deployment, title = '每日摘要'): Promise<string> {
  const response = await context.host.request(api('tickets'), { method: 'POST', body: { title, request: '写今天的摘要' } })
  expect(response.status).toBe(200)
  const id = response.json.ticketId as string | undefined
  expect(id).toBeTruthy()
  return id!
}

/**
 * Wait for a condition a pass produces, instead of assuming one `nudge` was enough.
 *
 * `Runtime.nudge` awaits the Sources' nudge and then calls `passes.requestPass()`, which SCHEDULES a pass without
 * awaiting it (`src/app/runtime.ts:667-674`) — and this spec already knew that: line 382's comment says so, and the
 * test there calls `nudge` twice to win the race. Usually winning a race is indistinguishable from not having one,
 * which is why `expected 'pending' to be 'running'` at the artifacts test looked like a mystery: it was measured
 * passing three times alone and once red under full-suite load, with no source change in between.
 *
 * Bounded, and it fails saying what it waited for rather than hanging — an intermittent red is worse than a
 * consistent one because it makes the exit code untrustworthy, and the exit code is the only authority this project
 * has (`docs/v2/04-execution-discipline.md` §0.1).
 */
async function untilPass(predicate: () => boolean, what: string, tries = 200): Promise<void> {
  for (let attempt = 0; attempt < tries; attempt++) {
    if (predicate()) return
    await new Promise(resolve => { setTimeout(resolve, 5) })
  }
  throw new Error(`${what} had not happened after ${tries} attempts to wait for it`)
}

describe('the fence', () => {
  it('serves the panel page to anybody who can reach the port', async () => {
    await withDeployment(async ({ host }) => {
      const response = await host.request('/myagent/', { headers: {} })
      expect(response.status).toBe(200)
      expect(response.text).toContain('<title>myagent</title>')
      expect(response.text).toContain('x-myagent-request')
      // Every tab the operator is promised is in the page that was served, and so is the code that fills it.
      for (const tab of ['tickets', 'new', 'decisions', 'sources', 'schedules', 'settings', 'prompts']) {
        expect(response.text, `tab-${tab}`).toContain(`id="tab-${tab}"`)
      }
      expect(response.text).toContain('loadSchedules')
      expect(response.text).toContain('schedules/preview')
    })
  })

  it('refuses the API without the marker header the panel sets', async () => {
    await withDeployment(async ({ host }) => {
      const response = await host.request(api('state'), { headers: { host: '127.0.0.1:3080' } })
      expect(response.status).toBe(403)
      expect(response.json.error).toContain('same-origin')
    })
  })

  it('refuses a request addressed to something that is not this machine', async () => {
    await withDeployment(async ({ host }) => {
      // A page from elsewhere can set the header, but it cannot make the browser address the loopback host.
      const foreign = await host.request(api('state'), { headers: { host: 'example.com', 'x-myagent-request': '1' } })
      expect(foreign.status).toBe(403)
      const otherPort = await host.request(api('state'), { headers: { host: '127.0.0.1:9999', 'x-myagent-request': '1' } })
      expect(otherPort.status).toBe(403)
      const crossOrigin = await host.request(api('state'), { headers: { ...PANEL_HEADERS, origin: 'http://example.com' } })
      expect(crossOrigin.status).toBe(403)
      // The panel's own origin is admitted.
      const own = await host.request(api('state'), { headers: { ...PANEL_HEADERS, origin: 'http://127.0.0.1:3080' } })
      expect(own.status).toBe(200)
    })
  })

  it('answers 404 for a path it does not serve, rather than the panel page', async () => {
    await withDeployment(async ({ host }) => {
      expect((await host.request('/myagent/api/nope')).status).toBe(404)
      expect((await host.request('/myagent/other')).status).toBe(404)
      expect((await host.request(api('tickets/missing-id'))).status).toBe(404)
      expect((await host.request(api('tickets/missing-id'))).json).toMatchObject({ code: 'ticket_missing' })
    })
  })
})

describe('what the panel reads', () => {
  it('answers with the whole state in one call, so the header takes one round trip', async () => {
    await withDeployment(async ({ host }) => {
      const { json } = await host.request(api('state'))
      expect(json.settings).toMatchObject({ acceptMode: 'auto', paused: false })
      expect(json.machine).toMatchObject({ mainSessionId: 'myagent-main' })
      expect(json.counts).toMatchObject({ open: 0, workerSlots: { used: 0, max: 2 } })
      expect(json.health).toHaveProperty('runtime')
      expect(json.sources).toHaveProperty('cron')
      expect(json.prompts).toMatchObject({ revision: 0 })
      expect(json.mainSession).toEqual({ exists: false, running: false, busy: false, id: 'myagent-main' })
      expect(json.setupProblem).toBeUndefined()
    })
  })

  it('lists Tickets by the state a person asks for', async () => {
    await withDeployment(async ({ host, runtime }) => {
      const id = await createTicket({ host, runtime } as Deployment)
      const all = await host.request(api('tickets?state=all'))
      expect(all.json.count).toBe(1)
      expect((all.json.tickets as { id: string }[])[0]!.id).toBe(id)
      const ended = await host.request(api('tickets?state=ended'))
      expect(ended.json.count).toBe(0)
      // A page bound is honoured, so a long-running deployment does not ship its whole history.
      const paged = await host.request(api('tickets?state=all&limit=0'))
      expect(paged.json.count).toBe(0)
    })
  })

  it('shows one Ticket in full, including what it waits for', async () => {
    await withDeployment(async ({ host, runtime }) => {
      const id = await createTicket({ host, runtime } as Deployment)
      const { json } = await host.request(api(`tickets/${id}`))
      expect(json.mandate).toMatchObject({ scope: expect.stringContaining('own directory'), via: 'session' })
      expect(json.execution).toMatchObject({ directory: expect.stringContaining(id.slice(0, 8)) })
      expect(json.assignment).toMatchObject({ state: expect.stringMatching(/pending|running/) })
    })
  })

  it('lists Decisions with the request each one judged', async () => {
    await withDeployment(async ({ host, runtime }) => {
      await createTicket({ host, runtime } as Deployment, '有标题的请求')
      const { json } = await host.request(api('decisions'))
      expect(json.count).toBe(1)
      expect((json.decisions as Record<string, unknown>[])[0]).toMatchObject({ outcome: 'accept', title: '有标题的请求' })
    })
  })

  it('dismisses a Decision, so the list stays a list of things to look at', async () => {
    await withDeployment(async ({ host, runtime }) => {
      await createTicket({ host, runtime } as Deployment)
      const decisions = await host.request(api('decisions'))
      const id = (decisions.json.decisions as { id: string }[])[0]!.id
      const dismissed = await host.request(api(`decisions/${id}/dismiss`), { method: 'POST', body: {} })
      expect(dismissed.status).toBe(200)
      expect(dismissed.json.dismissed).toBe(id)
      expect((dismissed.json.decision as { detail: string }).detail).toContain('[dismissed]')
    })
  })

  it('lists Triggers with what became of them', async () => {
    await withDeployment(async ({ host, runtime }) => {
      await createTicket({ host, runtime } as Deployment)
      const { json } = await host.request(api('triggers'))
      expect(json.count).toBe(1)
      expect((json.triggers as Record<string, unknown>[])[0]).toMatchObject({ kind: 'session', disposition: { state: 'accepted' } })
    })
  })
})

describe('what the panel writes', () => {
  it('opens a Ticket, and says plainly when the gate only recorded it', async () => {
    await withDeployment(async ({ host }) => {
      const created = await host.request(api('tickets'), { method: 'POST', body: { title: '调研', request: '调研三家竞品' } })
      expect(created.status).toBe(200)
      expect(created.json).toMatchObject({ disposition: 'accepted', acceptMode: 'auto' })
    }, 'auto')
    await withDeployment(async ({ host }) => {
      const observed = await host.request(api('tickets'), { method: 'POST', body: { title: '调研', request: '调研三家竞品' } })
      expect(observed.json).toMatchObject({ disposition: 'observed', acceptMode: 'observe' })
      expect(observed.json.note ?? observed.json.reason).toBeTruthy()
    }, 'observe')
  })

  it('refuses a request the panel did not fill in, naming the field', async () => {
    await withDeployment(async ({ host }) => {
      const response = await host.request(api('tickets'), { method: 'POST', body: { title: '只有标题' } })
      expect(response.status).toBe(400)
      expect((response.json.issues as { path: string }[]).map(issue => issue.path)).toContain('request')
    })
  })

  it('refuses a body that is not JSON, and one that is too large', async () => {
    await withDeployment(async ({ host }) => {
      const notJson = await host.request(api('tickets'), { method: 'POST', body: undefined, headers: PANEL_HEADERS })
      // An absent body reads as an empty object, which the schema then refuses by naming what is missing.
      expect(notJson.status).toBe(400)
      const huge = await host.request(api('tickets'), {
        method: 'POST', body: { title: 'x'.repeat(200_000), request: 'y' },
      })
      expect(huge.status).toBe(400)
    })
  })

  it('saves settings, and refuses a document with a key nobody reads', async () => {
    await withDeployment(async ({ host, runtime }) => {
      const bad = await host.request(api('settings'), { method: 'PUT', body: { acceptMod: 'auto' } })
      expect(bad.status).toBe(400)
      expect((bad.json.issues as { path: string }[]).map(issue => issue.path)).toContain('acceptMod')
      // Nothing was stored by the refused save.
      expect(runtime.settings().acceptMode).toBe('auto')

      const good = await host.request(api('settings'), {
        method: 'PUT',
        body: { acceptMode: 'observe', paused: true, sources: { cron: { schedules: [{ id: 'digest', prompt: '写摘要', timing: { kind: 'daily', time: '09:00' } }] } } },
      })
      expect(good.status).toBe(200)
      expect(good.json.settings).toMatchObject({ acceptMode: 'observe', paused: true })
      expect(runtime.settings().sources.cron.schedules[0]).toMatchObject({ id: 'digest', name: '' })
      expect((await host.request(api('state'))).json.settingsRevision).toBe(good.json.settingsRevision)
    })
  })

  it('saves a prompt override, and refuses one that is too long', async () => {
    await withDeployment(async ({ host }) => {
      const saved = await host.request(api('prompts'), { method: 'PUT', body: { worker: '你是一个 Ticket 的工作者。' } })
      expect(saved.status).toBe(200)
      expect(saved.json.revision).toBe(1)
      const read = await host.request(api('prompts'))
      const worker = (read.json.roles as { role: string; current: string; override?: string; pinsBase: boolean }[])
        .find(role => role.role === 'worker')!
      expect(worker.current).toBe('你是一个 Ticket 的工作者。')
      expect(worker.override).toBe('你是一个 Ticket 的工作者。')
      expect(worker.pinsBase).toBe(false)
      // Emptying it returns the role to the shipped text.
      await host.request(api('prompts'), { method: 'PUT', body: { worker: '' } })
      const after = await host.request(api('prompts'))
      expect((after.json.roles as { role: string; override?: string }[]).find(role => role.role === 'worker')!.override)
        .toBeUndefined()
    })
  })

  it('creates the main Session on demand, which mounting deliberately did not do', async () => {
    await withDeployment(async ({ host }) => {
      expect((await host.request(api('state'))).json.mainSession).toMatchObject({ exists: false })
      const created = await host.request(api('main-session'), { method: 'POST', body: {} })
      expect(created.status).toBe(200)
      expect(created.json.sessionId).toBe('myagent-main')
      expect((await host.request(api('state'))).json.mainSession).toMatchObject({ exists: true })
    })
  })

  it('asks for a pass, which is how the panel says "run what is due now"', async () => {
    await withDeployment(async ({ host }) => {
      const response = await host.request(api('pass'), { method: 'POST', body: {} })
      expect(response.status).toBe(200)
      expect(response.json.requested).toBe(true)
    })
  })
})

describe('commands on a live Ticket', () => {
  it('stops a Ticket, and then refuses to talk to it', async () => {
    await withDeployment(async ({ host, runtime }) => {
      const id = await createTicket({ host, runtime } as Deployment)
      const stopped = await host.request(api(`tickets/${id}/stop`), { method: 'POST', body: { reason: '不需要了' } })
      expect(stopped.status).toBe(200)
      expect((stopped.json as { ended?: { outcome: string } }).ended).toMatchObject({ outcome: 'stopped' })
      // The refusal carries the fixed code, so the panel can word it instead of showing a stack trace.
      const answered = await host.request(api(`tickets/${id}/answer`), { method: 'POST', body: { text: '还在吗' } })
      expect(answered.status).toBe(400)
      expect(answered.json).toMatchObject({ code: 'ticket_ended' })
      const retried = await host.request(api(`tickets/${id}/retry`), { method: 'POST', body: {} })
      expect(retried.status).toBe(400)
      expect(retried.json).toMatchObject({ code: 'ticket_ended' })
    })
  })

  it('takes a note for a working Ticket', async () => {
    await withDeployment(async ({ host, runtime }) => {
      const id = await createTicket({ host, runtime } as Deployment)
      const noted = await host.request(api(`tickets/${id}/note`), { method: 'POST', body: { text: '数据在 ~/notes' } })
      expect(noted.status).toBe(200)
      const inputs = (noted.json as { inputs: { kind: string; text: string; deliveredAt?: string }[] }).inputs
      expect(inputs.at(-1)).toMatchObject({ kind: 'note', text: '数据在 ~/notes' })
    })
  })

  it('refuses an empty answer, which would wake a worker with nothing to read', async () => {
    await withDeployment(async ({ host, runtime }) => {
      const id = await createTicket({ host, runtime } as Deployment)
      const response = await host.request(api(`tickets/${id}/answer`), { method: 'POST', body: { text: '   ' } })
      expect(response.status).toBe(400)
      expect((response.json.issues as { path: string }[]).map(issue => issue.path)).toContain('text')
    })
  })
})

describe('the schedule editor\'s two routes', () => {
  it('lists schedules with the next run of each, computed in the host\'s zone', async () => {
    await withDeployment(async ({ host }) => {
      expect((await host.request(api('schedules'))).json).toMatchObject({ schedules: [] })
      await host.request(api('settings'), {
        method: 'PUT',
        body: { sources: { cron: { schedules: [{ id: 'digest', prompt: '写今天的摘要', timing: { kind: 'daily', time: '09:00' } }] } } },
      })
      const { json } = await host.request(api('schedules'))
      const schedules = json.schedules as { id: string; next: string; describe: string; zone: string }[]
      expect(schedules).toHaveLength(1)
      expect(schedules[0]!.id).toBe('digest')
      expect(new Date(schedules[0]!.next).getTime()).toBeGreaterThan(Date.parse(json.now as string))
      expect(schedules[0]!.describe.length).toBeGreaterThan(3)
      expect(schedules[0]!.zone).toBe(json.zone)
    })
  })

  it('previews a schedule a person is writing, with its next few runs', async () => {
    await withDeployment(async ({ host }) => {
      const { json } = await host.request(api('schedules/preview'), {
        method: 'POST',
        body: { id: 'hourly', prompt: '看看有没有新东西', timing: { kind: 'every', seconds: 3600 } },
      })
      const next = json.next as string[]
      expect(next).toHaveLength(3)
      // An hourly schedule is an hour apart, which is the check a person cannot do in their head from a cron field.
      expect(Date.parse(next[1]!) - Date.parse(next[0]!)).toBe(3_600_000)
      expect(json.describe).toBeTruthy()
    })
  })

  it('refuses a schedule that cannot be used, naming the field', async () => {
    await withDeployment(async ({ host }) => {
      const response = await host.request(api('schedules/preview'), { method: 'POST', body: { id: 'digest' } })
      expect(response.status).toBe(400)
      expect((response.json.issues as { path: string }[]).map(issue => issue.path)).toContain('prompt')
      expect(response.json.error).toContain('cannot be used')
    })
  })

  it('says when a timing can never match, instead of showing an empty next run', async () => {
    await withDeployment(async ({ host }) => {
      const { json } = await host.request(api('schedules/preview'), {
        method: 'POST',
        body: { id: 'never', prompt: '做事', timing: { kind: 'cron', expression: '0 0 30 2 *' } },
      })
      expect(json.next).toEqual([])
      expect(json.warning).toContain('never matches')
    })
  })
})

describe('the intake counts the panel shows', () => {
  // Each Source kept its counters in instance memory, and an instance is thrown away by every settings save touching
  // its block, so the panel showed zeros that read as cumulative. The session Source had no counters at all.
  it('counts from the record, so they survive a settings save and a restart', async () => {
    await withDeployment(async context => {
      await createTicket(context)
      const first = await context.host.request(api('state'), { headers: PANEL_HEADERS })
      const state = first.json as { sources: Record<string, { counts?: Record<string, number> }>; settings: Record<string, unknown> }
      expect(state.sources.session!.counts).toEqual({ accepted: 1 })
      // Saving settings runs the Source sync; a per-process counter would read zero afterwards.
      const settings = { ...state.settings, notify: { enabled: !(state.settings.notify as { enabled: boolean }).enabled } }
      expect((await context.host.request(api('settings'), { method: 'PUT', headers: PANEL_HEADERS, body: settings })).status).toBe(200)
      const after = await context.host.request(api('state'), { headers: PANEL_HEADERS })
      expect((after.json as typeof state).sources.session!.counts).toEqual({ accepted: 1 })
    })
  })
})

describe('the artifacts a Ticket registered', () => {
  it('comes back on the detail route, one entry per normalized path', async () => {
    await withDeployment(async context => {
      const id = await createTicket(context)
      // The launch has to have happened first: a report may only land on an attempt that is running, which is what
      // makes a superseded turn unable to end a Ticket whose replacement has not started.
      await context.runtime.nudge()
      // Wait for the launch rather than assuming the pass `nudge` scheduled has already run; the assertion below is
      // unchanged, because the thing being asserted was never wrong — the wait was missing.
      await untilPass(() => context.runtime.engine.require(id).assignments.at(-1)!.state === 'running', 'the launch')
      expect(context.runtime.engine.require(id).assignments.at(-1)!.state).toBe('running')
      // `report.md` and `./report.md` are one file; a path outside the Ticket directory is not registered at all.
      context.runtime.engine.report(id, { state: 'ready', summary: '做完了', files: ['report.md', './report.md', '../elsewhere'] })
      const response = await context.host.request(api(`tickets/${id}`), { headers: PANEL_HEADERS })
      expect(response.json.artifacts).toEqual([
        { ticketId: id, path: 'report.md', at: expect.any(String), note: '做完了' },
      ])
      // The refusal is visible on the Ticket rather than silently dropped.
      expect(JSON.stringify(response.json.notes)).toContain('../elsewhere')
    })
  })
})

describe('a report with nowhere to go', () => {
  it('creates the main Session rather than losing the report quietly', async () => {
    // A deployment whose main Session does not exist lost every report to the front desk with a clean health board:
    // `notify` returned early, the notify effect looked settled, and nothing anywhere said so. The front desk is on
    // demand everywhere else, so a report creates it.
    await withDeployment(async context => {
      const id = await createTicket(context)
      await context.runtime.nudge()
      context.runtime.engine.report(id, { state: 'ready', summary: '做完了' })
      // `nudge` asks for a pass without awaiting it, so the notify effect runs a moment later.
      await context.runtime.nudge()
      await new Promise(resolve => setTimeout(resolve, 80))
      const state = await context.host.request(api('state'), { headers: PANEL_HEADERS })
      const view = state.json as { mainSession: { exists: boolean }; counts: { effects: Record<string, number> } }
      expect(view.mainSession.exists).toBe(true)
      // The report reached somewhere, and nothing is still queued to reach it.
      expect(view.counts.effects).toEqual({})
      expect(context.runtime.health.problems()).toEqual([])
    })
  })
})

describe('Projects, Works and the edges between Tickets', () => {
  // These were Engine commands with no caller at all. A capability nothing can reach is not a capability, so the
  // routes are what turns "tested" into "usable".
  const post = (context: Deployment, path: string, body: unknown) =>
    context.host.request(api(path), { method: 'POST', body: body as Record<string, unknown> })
  const get = (context: Deployment, path: string) => context.host.request(api(path))

  it('creates, lists and reads them back, with a Project’s Works and a Work’s Tickets', async () => {
    await withDeployment(async context => {
      const project = await post(context, 'projects', { name: '客户 A' })
      expect(project.status).toBe(200)
      const projectId = (project.json as { id: string }).id
      const work = await post(context, 'works', { name: '周报', projectId })
      const workId = (work.json as { id: string }).id

      const listed = await get(context, 'projects')
      expect((listed.json as { projects: { name: string }[] }).projects.map(item => item.name)).toEqual(['客户 A'])
      const read = await get(context, `projects/${projectId}`)
      expect((read.json as { works: { id: string }[] }).works.map(item => item.id)).toEqual([workId])

      const ticket = await createTicket(context)
      await post(context, `tickets/${ticket}/work`, { workId })
      const withTickets = await get(context, `works/${workId}`)
      const view = withTickets.json as { tickets: { id: string; workSeq?: number }[] }
      expect(view.tickets.map(item => item.id)).toEqual([ticket])
      expect(view.tickets[0]!.workSeq).toBe(1)
    })
  })

  it('records an edge, shows what is still unsatisfied, and undoes it', async () => {
    await withDeployment(async context => {
      // Distinct titles on purpose: the Ticket id is derived from the request, so two identical requests in the same
      // millisecond are one Ticket, and an edge between them would be a self-loop. That deduplication is deliberate
      // for a person who clicks twice, but a test that depends on it fails only under load.
      const first = await createTicket(context, '上游的一张')
      const second = await createTicket(context, '下游的一张')
      await post(context, `tickets/${second}/dependencies`, { upstream: first })
      const before = await get(context, `tickets/${second}/dependencies`)
      expect((before.json as { waitsFor: unknown[] }).waitsFor)
        .toEqual([{ upstream: first, downstream: second, createdAt: expect.any(String), on: 'done' }])

      await post(context, `tickets/${second}/dependencies/drop`, { upstream: first })
      const after = await get(context, `tickets/${second}/dependencies`)
      expect((after.json as { waitsFor: unknown[] }).waitsFor).toEqual([])
    })
  })

  it('answers 404 for a Project nobody made, and 400 for an edge that would be a cycle', async () => {
    await withDeployment(async context => {
      expect((await get(context, 'projects/no-such-project')).status).toBe(404)
      expect((await get(context, 'works/no-such-work')).status).toBe(404)

      const first = await createTicket(context, '上游的一张')
      const second = await createTicket(context, '下游的一张')
      await post(context, `tickets/${second}/dependencies`, { upstream: first })
      // Closing the loop the other way round, which a self-edge check on its own would miss.
      const cycle = await post(context, `tickets/${first}/dependencies`, { upstream: second })
      expect(cycle.status).toBe(400)
      expect(JSON.stringify(cycle.json)).toContain('wait for itself')
    })
  })
})

describe('the log of what happened to a Ticket', () => {
  it('comes back newest first, with the count of the whole history', async () => {
    await withDeployment(async context => {
      const id = await createTicket(context, '有历史的一张')
      await context.runtime.nudge()
      const response = await context.host.request(api(`tickets/${id}/events`))
      const view = response.json as { count: number; returned: number; events: { seq: number; type: string }[] }
      expect(view.count).toBe(view.returned)
      expect(view.events.map(event => event.type)).toEqual(['launched', 'created'])
      expect(view.events.map(event => event.seq)).toEqual([2, 1])
      // A limit clips to the newest, and still says how long the whole history is.
      const clipped = await context.host.request(api(`tickets/${id}/events?limit=1`))
      expect((clipped.json as { count: number; returned: number }).count).toBe(2)
      expect((clipped.json as { returned: number }).returned).toBe(1)
    })
  })
})

describe('the authorization version on the state route', () => {
  // It used to be observable only through a Ticket's Mandate, so checking that a settings change moved the
  // authorization version meant creating a probe Ticket and stopping it — which is how the acceptance run had to do it.
  it('is exposed, and moves when a Source’s authorization changes', async () => {
    await withDeployment(async context => {
      const before = await context.host.request(api('state'))
      const version = (before.json as { policyVersion: string }).policyVersion
      expect(version).toMatch(/^[0-9a-f]{16}$/)

      const current = context.runtime.settings()
      context.runtime.saveSettings({
        ...current,
        sources: { ...current.sources, rule: { ...current.sources.rule, allowSystemActors: true } },
      })
      const after = await context.host.request(api('state'))
      expect((after.json as { policyVersion: string }).policyVersion).not.toBe(version)
      // And the mount time, so "which mount am I talking to?" stops being an inference from a marker file's mtime.
      expect((after.json as { mountedAt: string }).mountedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    })
  })
})

/**
 * The chat Source's surface and the reply tally, both on the route the panel already reads (P8 task D).
 *
 * Driven through a whole deployment with real message files rather than a hand-made payload, because neither fact is
 * this file's to invent: the waiting line is a sentence the Source writes onto the health board, and the tally is
 * counted by the Delivery when a Report lands. A fixture would test the parser against the parser.
 */
const chatMessage = (from: string, body: string): string => `---\nfrom: ${from}\nid: msg-${from}\n---\n${body}\n`

/** A message file whose mtime is old enough to have settled, so the next scan takes it instead of waiting it out. */
function drop(directory: string, name: string, text: string): void {
  mkdirSync(directory, { recursive: true })
  const path = join(directory, name)
  writeFileSync(path, text, 'utf8')
  const at = new Date(Date.now() - 5_000)
  utimesSync(path, at, at)
}

/** Look now, and let the pump finish — what one poll interval does by itself. */
async function settle(context: Deployment): Promise<void> {
  await context.runtime.nudge()
  await wait(80)
  context.runtime.passes.requestPass()
  await wait(80)
}

/** The chat part of `GET state`, typed as the page reads it. */
interface ChatView {
  readonly policy: {
    readonly enabled: boolean; readonly paused: boolean; readonly deny: boolean
    readonly acceptMode: string; readonly allowedSenders: readonly string[]
  }
  readonly waiting: { readonly count?: number; readonly ids: readonly string[]; readonly more?: number }
}

const readState = async (context: Deployment): Promise<Record<string, unknown>> =>
  (await context.host.request(api('state'), { headers: PANEL_HEADERS })).json as Record<string, unknown>

/**
 * A deployment whose chat Source reads one channel directory, with `alice` on the allow-list so a mapped identity can
 * actually originate work — the point of the map is that the gate compares the NAME, not the platform id.
 */
async function chatDeployment(over: Record<string, unknown> = {}): Promise<Deployment & { readonly channel: string }> {
  const context = await deployment('auto')
  const channel = join(context.stateDir, 'chat-ops')
  mkdirSync(channel, { recursive: true })
  // Tightened so the Source's own permission check stays quiet: these tests read the health line back, and a warning
  // about a world-writable directory would be joined onto the very sentence the view is parsed from.
  chmodSync(channel, 0o700)
  context.runtime.saveSettings({
    acceptMode: 'auto', allowedSenders: ['operator', 'alice'],
    sources: {
      inbox: { directory: context.inbox, pollMs: 1000 },
      chat: {
        enabled: true, identities: { U01ABCDEF: { actor: 'alice', note: 'the operator' } },
        channels: [{ id: 'ops', directory: channel, enabled: true }], pollMs: 1000, ...over,
      },
    },
  })
  await settle(context)
  return { ...context, channel }
}

async function withChat(run: (context: Deployment & { channel: string }) => Promise<void>, over: Record<string, unknown> = {}): Promise<void> {
  const context = await chatDeployment(over)
  try { await run(context) } finally { await context.runtime.stop() }
}

describe('the chat Source on the state route', () => {
  it('names the identities whose messages are being held, and leaves the mapped one out', async () => {
    await withChat(async context => {
      // One mapped message among the unmapped ones: a waiting list that also named the identity the operator already
      // mapped would be a list they had to read to the end every time.
      drop(context.channel, 'operator.md', chatMessage('U01ABCDEF', '整理一下这周的告警'))
      drop(context.channel, 'stranger.md', chatMessage('U09XYZ', '帮我看一下这个'))
      drop(context.channel, 'other.md', chatMessage('U07OTHER', '还有这个'))
      await settle(context)

      const chat = (await readState(context)).chat as ChatView
      expect(chat.waiting.count).toBe(2)
      expect([...chat.waiting.ids].sort()).toEqual(['U07OTHER', 'U09XYZ'])
      // Held means still there: the count is a fact about the directory, not about a record that was written.
      expect(readdirSync(context.channel).filter(name => name.endsWith('.md')).sort())
        .toEqual(['other.md', 'stranger.md'])
      // And the mapped one became work under the mapped NAME, which is why it is not on the list.
      const tickets = (await context.host.request(api('tickets?state=all'), { headers: PANEL_HEADERS })).json as
        { tickets: { via: string; sender: string }[] }
      expect(tickets.tickets.map(ticket => [ticket.via, ticket.sender])).toContainEqual(['chat', 'alice'])
    })
  })

  it('says how many identities the health line did not name, rather than cutting them off silently', async () => {
    await withChat(async context => {
      // Seven distinct identities against a health line that names five: the two it does not name are still held, and
      // a view that dropped them would tell the operator the queue is smaller than it is.
      for (const index of [1, 2, 3, 4, 5, 6, 7]) {
        drop(context.channel, `s${index}.md`, chatMessage(`U0${index}STRANGER`, '看一下'))
      }
      // And one MAPPED message beside them, which is the state a working deployment is actually in. It matters to the
      // number below: accepting it stores a chat Trigger, and from then on `sourceStatus()` answers with the record's
      // disposition counts instead of the Source's own — so `waiting`, which the record never held, has to be read from
      // the Source. Without this message the assertion passes either way, which is how a fixture hides a design fact.
      drop(context.channel, 'operator.md', chatMessage('U01ABCDEF', '整理一下这周的告警'))
      await settle(context)

      const waiting = ((await readState(context)).chat as ChatView).waiting
      // Messages, not identities: the mapped one became a Ticket, so it is not in this count.
      expect(waiting.count).toBe(7)
      expect(waiting.ids).toHaveLength(5)
      expect(waiting.more).toBe(2)
    })
  })

  it('tells a Source that is not looking from a queue that is empty', async () => {
    // Both cases report the same zero, because a disabled Source stops counting what it is not reading. The key that
    // separates them has to be in the payload, or the page can only show "nothing to do" for both — and one of those
    // two has a directory full of messages nobody is looking at.
    await withChat(async context => {
      drop(context.channel, 'stranger.md', chatMessage('U09XYZ', '帮我看一下这个'))
      await settle(context)
      const looking = (await readState(context)).chat as ChatView
      expect(looking.policy.enabled).toBe(true)
      expect(looking.waiting.count).toBe(1)
    })
    await withChat(async context => {
      drop(context.channel, 'stranger.md', chatMessage('U09XYZ', '帮我看一下这个'))
      await settle(context)
      const blind = (await readState(context)).chat as ChatView
      expect(blind.policy.enabled).toBe(false)
      expect(blind.waiting.count).toBe(0)
      // The message is still there, which is what makes the zero a fact about the Source and not about the directory.
      expect(readdirSync(context.channel)).toContain('stranger.md')
    }, { enabled: false })
  })

  it('answers the policy the gate will apply, so the page never re-derives the fallback', async () => {
    // `paused`, `acceptMode` and `allowedSenders` each fall back to the global setting. A page that worked that out
    // itself would be a second opinion about who may originate work, and three fallthroughs of that shape are already
    // in this project's record (S33) — so the answer comes from the function the gate uses.
    await withChat(async context => {
      const inherited = (await readState(context)).chat as ChatView
      expect(inherited.policy).toMatchObject({ enabled: true, paused: false, deny: false, acceptMode: 'auto' })
      expect(inherited.policy.allowedSenders).toEqual(['operator', 'alice'])
    })
    await withChat(async context => {
      const own = (await readState(context)).chat as ChatView
      expect(own.policy.paused).toBe(true)
      expect(own.policy.allowedSenders).toEqual(['only-chat'])
    }, { paused: true, allowedSenders: ['only-chat'] })
  })
})

describe('the reply tally, which had no outlet at all', () => {
  it('counts a Report that had nowhere to go, and shows on the Ticket that it never had an address', async () => {
    await withDeployment(async context => {
      const id = await createTicket(context)
      await context.runtime.nudge()
      // A Ticket made through the panel has a Trigger with no `replyTo`, so `send` does nothing and says nothing
      // (contract §3.3). Doing nothing is allowed; doing nothing invisibly is not.
      context.runtime.engine.report(id, { state: 'ready', summary: '做完了' })
      await settle(context)

      const state = await readState(context)
      expect((state.counts as { sends: unknown }).sends).toEqual({ queued: 0, nowhere: 1 })
      // Not an error, and not on the health board as one: this is the normal case for every one-way Source.
      expect(context.runtime.health.problems()).toEqual([])
      // The same fact on the Ticket itself, which is where an operator asks "where did the answer go".
      const detail = await context.host.request(api(`tickets/${id}`), { headers: PANEL_HEADERS })
      expect(detail.json).not.toHaveProperty('replyTo')
    })
  })

  it('counts a reply on its way back to the platform that asked, and names the address it goes to', async () => {
    await withChat(async context => {
      drop(context.channel, 'operator.md', chatMessage('U01ABCDEF', '整理一下这周的告警'))
      await settle(context)
      const tickets = (await context.host.request(api('tickets?state=all'), { headers: PANEL_HEADERS })).json as
        { tickets: { id: string; via: string }[] }
      const id = tickets.tickets.find(ticket => ticket.via === 'chat')!.id

      const detail = await context.host.request(api(`tickets/${id}`), { headers: PANEL_HEADERS })
      expect(detail.json.replyTo).toEqual({ kind: 'chat', channel: 'ops' })

      await context.runtime.nudge()
      context.runtime.engine.report(id, { state: 'ready', summary: '三条告警都处理了' })
      const state = await readState(context)
      expect((state.counts as { sends: unknown }).sends).toEqual({ queued: 1, nowhere: 0 })

      // And the tally is not the only trace: the queue delivered it, so the answer is where the request came from.
      await settle(context)
      expect(readdirSync(join(context.channel, 'out')).filter(name => name.startsWith('reply-'))).toHaveLength(1)
    })
  })
})

/**
 * The requests the queue gave up on, which §4.45 stored and left with no outlet at all: a `lost` row no page ever
 * asked for, and a bounded `kv` entry that had no route.
 *
 * Seeded through the same two calls the Runtime makes when it gives up on a `trigger` effect (`runtime.ts:315-333`),
 * because what these routes have to do is expose what that path stored — a different writer here would test the test.
 */
describe('the requests the queue gave up on', () => {
  /** The instant the lost things happened; two of them, so an ordering assertion has something to order. */
  const SLOT = '2026-11-03T01:00:00.000Z'
  const EARLIER = '2026-11-01T01:00:00.000Z'
  /** The queue row a give-up deletes, which is the only other name for the request that survives. */
  const EFFECT_KEY = '6ce6093778b89681cb9170e23056e52f'

  /** One lost ROW: a payload that named its request, stored under its own identity by `Engine.triggerLost`. */
  const loseRow = (context: Deployment, over: Partial<LostTrigger> = {}): LostTrigger => {
    const identity = { id: 'trigger-lost-1', source: 'cron', kind: 'cron' as const, at: SLOT, ...over }
    const lost: LostTrigger = {
      error: 'Error: the store refused the write', effectKey: EFFECT_KEY,
      // `insertLost` puts this text in `record`, and the route reads the row back through it — so it carries the four
      // fields the columns came from, plus a title, exactly as `lostTriggerOf` leaves the payload it recognized.
      raw: JSON.stringify({ ...identity, title: '把摘要发到群里' }),
      ...identity,
    }
    // `true` is the fact under test as much as the row is: it says this deployment's repositories could store one,
    // which is what distinguishes "nothing was lost" from "there was nowhere to put it".
    expect(context.runtime.engine.triggerLost(lost)).toBe(true)
    return lost
  }

  /** One lost PAYLOAD: text that could not be read as a Trigger at all, which §4.42 keeps out of every table. */
  const losePayload = (context: Deployment, payload: string, at = SLOT, effectKey = EFFECT_KEY): void =>
    context.runtime.store.pushLostPayload({ at, effectKey, error: 'TypeError: Cannot read properties of null', payload })

  interface LostRow { id: string; source: string; kind: string; at: string; title?: string; error: string; effectKey: string }
  interface LostPayloadView { at: string; effectKey: string; error: string; chars: number; payload: string }
  interface LostView {
    total: number; shown: number; rows: LostRow[]; payloads: LostPayloadView[]
    bounds: { keep: number; chars: number }
  }

  const readLost = async (context: Deployment, query = ''): Promise<LostView> =>
    (await context.host.request(api(query === '' ? 'lost' : `lost?${query}`), { headers: PANEL_HEADERS })).json as unknown as LostView

  it('hands over a request that was understood and then dropped, with the error and the queue key that are all that is left of it', async () => {
    await withDeployment(async context => {
      loseRow(context)
      const view = await readLost(context)
      expect(view.total).toBe(1)
      expect(view.shown).toBe(1)
      // The row's own four columns and the disposition's two facts. No `decisionId` and no Ticket: the gate never ran
      // to a verdict, and inventing one here would be the false record §4.35 refused.
      expect(view.rows).toEqual([{
        id: 'trigger-lost-1', source: 'cron', kind: 'cron', at: SLOT, title: '把摘要发到群里',
        error: 'Error: the store refused the write', effectKey: EFFECT_KEY,
      }])
      // The other path arrives under its own key: merged into one list, the page could not say which of the two
      // happened, and "could not be understood" is the one that needs a human to read the text.
      expect(view.payloads).toEqual([])
    })
  })

  it('keeps a payload that could not be read out of every row and every count, and hands over its text instead', async () => {
    await withDeployment(async context => {
      // Cut in half, so it has no `kind` and no `at`: the four columns `triggers` declares NOT NULL cannot be filled.
      losePayload(context, '{"id": "trigger-9", "source": ')
      const view = await readLost(context)
      expect(view.rows).toEqual([])
      expect(view.payloads).toEqual([{
        at: SLOT, effectKey: EFFECT_KEY, error: 'TypeError: Cannot read properties of null',
        chars: 30, payload: '{"id": "trigger-9", "source": ',
      }])
      // Reported from the build that enforces them, so the page states the bound instead of implying a cut list is
      // the whole answer.
      expect(view.bounds).toEqual({ keep: LOST_TRIGGER_KEEP, chars: LOST_TRIGGER_CHARS })

      const state = await readState(context)
      expect((state.counts as { lost: unknown }).lost).toEqual({ rows: 0, payloads: 1 })
      // §4.42's hard rule, asserted where it would be visible if broken: a payload that could not be understood is in
      // no table, so it is in no Source's intake counts, and there is no Source named "lost" on the page whose job is
      // answering where work comes from.
      expect(Object.keys(state.sources as Record<string, unknown>)).not.toContain('lost')
      expect(JSON.stringify(state.sources)).not.toContain('"lost"')
    })
  })

  it('counts a loss whose Source is no longer registered, which the per-Source numbers on the same route cannot', async () => {
    await withDeployment(async context => {
      // A row names the source its own payload carried, and a settings edit can have removed that Source since.
      loseRow(context, { id: 'trigger-ghost', source: 'inbox-old', kind: 'inbox' })
      const state = await readState(context)
      expect((state.counts as { lost: unknown }).lost).toEqual({ rows: 1, payloads: 0 })
      // The reason the count is summed over the record's grouping rather than over `state.sources`: this loss has no
      // row there at all, so a count read from the Sources would report zero and look like a system that never lost
      // anything.
      expect((state.sources as Record<string, unknown>)['inbox-old']).toBeUndefined()
      // And it is counted as `lost` in the record's own grouping, which is where the number came from.
      expect(context.runtime.store.triggers.countBySource()['inbox-old']).toEqual({ lost: 1 })
    })
  })

  it('lists every lost row rather than the newest window, so a busy system cannot bury one', async () => {
    await withDeployment(async context => {
      // The loss is the OLDEST thing in the table, which is the shape a real one has: it happened, the system kept
      // working, and somebody looks a week later.
      loseRow(context, { at: EARLIER })
      // Then more accepted Triggers than the default limit, each newer. `triggers.since('', 50)` — the read `GET
      // triggers` uses — answers with none of them being the lost one, so this is the case that separates the two.
      for (let index = 0; index < 60; index += 1) {
        context.runtime.store.triggers.save({
          trigger: {
            id: `trigger-busy-${index}`, source: 'cron', kind: 'cron',
            at: new Date(Date.parse(EARLIER) + (index + 1) * 60_000).toISOString(),
            actor: { id: 'operator', kind: 'person' }, text: '做一件事', title: `第 ${index} 件`,
          },
          disposition: { state: 'ignored', decisionId: `decision-${index}` },
        })
      }
      const view = await readLost(context)
      expect(view.total).toBe(1)
      expect(view.shown).toBe(1)
      expect(view.rows.map(row => row.id)).toEqual(['trigger-lost-1'])
      // The number beside the list agrees with the list, which is the whole reason the read is not windowed: a count
      // of 1 next to an empty list is the quiet kind of wrong this page has been caught by.
      expect(((await readState(context)).counts as { lost: { rows: number } }).lost.rows).toBe(1)
    })
  })

  it('says how many there are when it shows fewer, newest first', async () => {
    await withDeployment(async context => {
      loseRow(context, { id: 'trigger-lost-a', at: EARLIER })
      loseRow(context, { id: 'trigger-lost-b', at: '2026-11-02T01:00:00.000Z' })
      loseRow(context, { id: 'trigger-lost-c', at: SLOT })
      const view = await readLost(context, 'limit=2')
      expect(view.total).toBe(3)
      expect(view.shown).toBe(2)
      // Newest first, because "what did I just lose" is the question; and `total` past the end of `rows`, so a
      // truncated answer is a stated one rather than a list that looks complete.
      expect(view.rows.map(row => row.id)).toEqual(['trigger-lost-c', 'trigger-lost-b'])
    })
  })

  it('hands over a payload byte for byte, including the markup and the bytes that are not text', async () => {
    await withDeployment(async context => {
      // The degenerate path is precisely the case where odd bytes are likely: a producer that wrote half a record, or
      // a file that was not UTF-8. This is untrusted text of unknown provenance, and the operator has to see IT.
      const payload = '{"text":"<img src=x onerror=\\"document.title=\'pwned\'\\"> & 一半\u0000\ufffd","source":'
      losePayload(context, payload, EARLIER)
      const view = await readLost(context)
      expect(view.payloads[0]!.payload).toBe(payload)
      expect(view.payloads[0]!.chars).toBe(payload.length)
    })
  })

  it('carries the length of a payload it had to cut, so the cut says it was cut', async () => {
    await withDeployment(async context => {
      losePayload(context, 'x'.repeat(LOST_TRIGGER_CHARS + 500), SLOT, 'a'.repeat(32))
      const view = await readLost(context)
      // Newest first, and the whole length beside the part that was kept: without `chars` a thousand characters of a
      // longer payload reads as the payload, and the interesting end of a broken record is usually the one missing.
      expect(view.payloads[0]!.payload).toHaveLength(LOST_TRIGGER_CHARS)
      expect(view.payloads[0]!.chars).toBe(LOST_TRIGGER_CHARS + 500)
    })
  })
})
