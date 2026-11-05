// @vitest-environment jsdom
/**
 * The operator panel, running.
 *
 * Every other suite here tests the server the panel talks to. This one executes the page itself, because a panel that
 * renders nothing — or that eats what the operator typed every three seconds — passes all of them, and it is the only
 * surface a person touches while work runs unattended.
 *
 * jsdom runs no script that reaches it through `innerHTML`, so the page's own IIFE is evaluated by hand: the same text a
 * browser gets, against the DOM the browser would build, with no copy of its logic in this file. What is asserted is
 * what the operator sees and what the panel puts on the wire, never how the page is written inside.
 *
 * Nothing here is marked `it.fails`. This file has found defects and each one was written as the guarantee the operator
 * ought to have, so the marker came off when the page caught up rather than being left to rot.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'

const PAGE = readFileSync(join(import.meta.dirname, '..', 'panel', 'index.html'), 'utf8')
/** The page's one inline script, which is the whole application. */
const SCRIPT = /<script>([\s\S]*?)<\/script>/.exec(PAGE)![1]!
/** What a browser puts in `<body>`, minus the script this file runs itself. */
const MARKUP = PAGE.slice(PAGE.indexOf('<body>') + '<body>'.length, PAGE.indexOf('</body>'))
  .replace(/<script>[\s\S]*?<\/script>/, '')
/**
 * The script with its comments taken out. The comments name `prompt()` and `confirm()` to say the page avoids them, so
 * reading the page as served cannot tell a promise from a call.
 */
const CODE = SCRIPT.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/[^\n]*/g, '')

// --------------------------------------------------------------------- the API

/** One request the panel made, which is what "what did the panel send" is answered from. */
interface Call {
  readonly url: string
  readonly method: string
  /** The route without `/myagent/api/` and without a query string, which is how a test names it. */
  readonly path: string
  readonly query: URLSearchParams
  readonly headers: Record<string, string>
  readonly body?: unknown
}

/** A route that refuses: the only way this file can reach the panel's error paths. */
class Refusal {
  constructor(readonly status: number, readonly error: string) {}
}
const refuse = (status: number, error: string): Refusal => new Refusal(status, error)

/** Answers keyed by `METHOD path`; a value may also be a function of the call, for a route that has to change. */
type Routes = Record<string, unknown>

/**
 * Stand in for the server. A route nobody stubbed answers 404 the way the real table does, so a request the panel
 * invents shows up as a refusal in the test that made it instead of vanishing.
 */
const serve = (routes: Routes) => {
  const calls: Call[] = []
  const respond = (status: number, payload: unknown) =>
    ({ ok: status < 400, status, statusText: '', json: async () => payload })
  vi.stubGlobal('fetch', async (input: unknown, init: { method?: string; body?: string; headers?: Record<string, string> } = {}) => {
    const url = new URL(String(input), 'http://localhost:3000')
    const call: Call = {
      url: url.pathname,
      method: (init.method ?? 'GET').toUpperCase(),
      path: url.pathname.slice('/myagent/api/'.length),
      query: url.searchParams,
      headers: init.headers ?? {},
      ...(init.body === undefined ? {} : { body: JSON.parse(init.body) }),
    }
    calls.push(call)
    const route = routes[`${call.method} ${call.path}`]
    if (route === undefined) return respond(404, { error: `No route for ${call.method} ${call.path}` })
    const answer = typeof route === 'function' ? (route as (call: Call) => unknown)(call) : route
    return answer instanceof Refusal ? respond(answer.status, { error: answer.error }) : respond(200, answer)
  })
  const sent = (key: string): Call[] => calls.filter(call => `${call.method} ${call.path}` === key)
  const last = (key: string): Call | undefined => sent(key).at(-1)
  return { calls, sent, last }
}

// ------------------------------------------------------------------- fixtures

const AT = '2026-11-03T01:00:00.000Z'
const LATER = '2026-11-03T01:20:00.000Z'
const NEXT_DAY = '2026-11-04T01:00:00.000Z'

/** One Ticket as `GET tickets/:id` answers it: every field the detail view reads, worded as a person would read it. */
const ticket = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'ticket-1', title: '整理本周竞品动态', stage: 'waiting',
  createdAt: AT, updatedAt: LATER, via: 'schedule', sender: 'operator', waitsForPerson: true,
  directory: '/work/ticket-1', question: '两份报表的口径不一样，按哪一个算？',
  mandate: {
    scope: '只在这张 Ticket 自己的目录里工作', strength: 'explicit', via: 'schedule',
    sender: { id: 'operator', kind: 'person' }, policyVersion: 'pv-9f3c', at: AT,
  },
  origin: { triggerId: 'trigger-7' }, attachments: [],
  reports: [{ state: 'waiting', summary: '读完了三份文件，等你定一个口径', at: LATER, files: ['notes.md'] }],
  inputs: [], notes: [],
  ...over,
})

/** One line of the Ticket list, as `GET tickets` answers it. */
const listed = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'ticket-1', title: '整理本周竞品动态', stage: 'waiting', createdAt: AT, updatedAt: LATER,
  via: 'schedule', sender: 'operator', waitsForPerson: true, summary: '读完了三份文件',
  ...over,
})

/** What a worker is doing, as `GET tickets/:id/progress` answers it. */
const progress = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  sessionId: 'myagent-ticket-1', sessionTitle: 'myagent · 整理本周竞品动态', loaded: true, agentStatus: 'working',
  turn: 4, lastSaid: '我先把 attachments 里的三份文件读完了。', lastEventAt: LATER,
  // Newest first, which is the order the server walks its log in and the order the page has to keep.
  recentTools: [{ name: 'read', at: LATER }, { name: 'bash', at: AT }],
  assignment: { id: 'assignment-1', state: 'running' },
  ...over,
})

/** Text a worker wrote, as the file route hands it over: base64 of UTF-8 bytes. */
const REPORT_TEXT = '# 竞品动态\n本周三件事：涨价、换供应商、停止海外发货。\n'
const base64 = (content: string): string => Buffer.from(content, 'utf8').toString('base64')

/** A Ticket's directory, as `GET tickets/:id/files` answers it. */
const files = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  directory: '/work/ticket-1', truncated: false, count: 2,
  files: [
    { path: '报告.md', directory: false, size: 2048, text: true, mtime: LATER },
    { path: 'data', directory: true, size: 0, text: false },
    { path: 'chart.png', directory: false, size: 2_097_152, text: false, mtime: LATER },
  ],
  ...over,
})

/** One stored schedule: what the settings document holds, with nothing the view adds. */
const scheduleRecord = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'digest', name: '每日摘要', enabled: true, prompt: '产出今天的摘要，写到 report.md', scope: '只读 data/',
  timing: { kind: 'daily', time: '09:00' }, ...over,
})

/** The same schedule as `GET schedules` answers it, which is the record plus what only a view can know. */
const scheduleView = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...scheduleRecord(over), describe: '每天 09:00', zone: 'Asia/Shanghai', next: NEXT_DAY,
})

/** The settings document as the server keeps it: every default filled in, which is what `GET state` hands over. */
const settings = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  acceptMode: 'auto', allowedSenders: ['operator'], paused: false,
  executor: { maxWorkers: 2, prepare: '', model: '' },
  sources: {
    cron: { enabled: true, schedules: [scheduleRecord()] },
    inbox: { enabled: true, directory: '/inbox', pollMs: 5000 },
    session: { enabled: true },
  },
  notify: { enabled: false },
  ...over,
})

/** The whole system as `GET state` answers it. */
const state = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  settings: settings(), settingsRevision: 3,
  machine: { stateDir: '/state', workRoot: '/work', inboxDir: '/inbox', mainSessionId: 'myagent-main' },
  setupProblem: undefined,
  counts: {
    open: 2, ended: 5, attention: 1, triggers: 9, decisions: 9, effects: { notify: 1 },
    workerSlots: { used: 1, max: 2 },
  },
  health: { executor: { ok: true, detail: '2 个工作槽，1 个在用', at: LATER } },
  sources: {
    // `next` is an epoch, not a string: that is what a Source reports about itself.
    cron: { ok: true, detail: '1 条排期', next: Date.parse(NEXT_DAY), counts: { schedules: 1 }, lastTriggerAt: AT },
    inbox: { ok: true, detail: '看着 /inbox', counts: { pending: 0 } },
  },
  prompts: { revision: 2, maxChars: 20_000, roles: [{ role: 'worker', overridden: true, chars: 900 }] },
  paused: false,
  // The API reports existence and busyness; the id itself comes from `machine`.
  mainSession: { exists: true, running: true, busy: false },
  ...over,
})

/** The bytes of a file that is not text, which no decoder should be asked to make readable. */
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

/** One file as the file route hands it over: base64 of the bytes, and whether they are worth showing as text. */
const served = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  path: '报告.md', absolute: '/work/ticket-1/报告.md', text: true,
  base64: base64(REPORT_TEXT), size: Buffer.byteLength(REPORT_TEXT), mtime: LATER, ...over,
})

/** What `examples/` ships, as the recipes route hands it over: one request and one schedule a person can start from. */
const RECIPES = [
  { name: 'data-report.md', kind: 'request', title: '月度数据报表', text: '合成一份月度报表，写到 report.md。', scope: '只读 data/' },
  { name: 'daily-digest.json', kind: 'settings', schedule: scheduleRecord({ id: 'digest' }) },
]

/** One Project, as `GET projects` and `GET projects/:id` hand it over. */
const project = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'project-1', name: '竞品观察', createdAt: AT, note: '每季看一次同行', ...over,
})

/** One Work: a stream of Tickets, with the scope every Ticket in it inherits. */
const work = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id: 'work-1', projectId: 'project-1', name: '周报', createdAt: AT, scope: '只读 data/', note: '每周一产出', ...over,
})

/** One edge of the graph: `downstream` waits for `upstream`. */
const dep = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  upstream: 'ticket-2', downstream: 'ticket-1', createdAt: AT, on: 'done', ...over,
})

/** One fact of a Ticket's history, as `GET tickets/:id/events` hands it over. */
const event = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  ticketId: 'ticket-1', seq: 1, at: AT, type: 'created', ...over,
})

/**
 * What the page asks for on boot and on the Ticket page. A test replaces the one route it is about, and anything it
 * forgot to stub answers 404 where the test can see it.
 */
const routes = (over: Routes = {}): Routes => ({
  'GET state': state(),
  'GET recipes': RECIPES,
  'GET tickets': { offset: 0, limit: 80, count: 1, tickets: [listed()] },
  'GET tickets/ticket-1': ticket(),
  'GET tickets/ticket-1/progress': progress(),
  'GET tickets/ticket-1/files': files(),
  // The Work labels, the edges and the log a detail view always reads; empty by default, because a test about one of
  // them replaces it and a test about something else must not have to.
  'GET works': { works: [] },
  'GET tickets/ticket-1/dependencies': { waitsFor: [], waitedOnBy: [] },
  'GET tickets/ticket-1/events': { count: 0, returned: 0, events: [] },
  // The capability probe reads this one route on boot; an unstubbed route answers "No route for", which is exactly
  // the answer that tells the page its host is older than it is.
  'GET projects': { projects: [] },
  'GET effects': { counts: {} },
  ...over,
})

/** The schedule page's own routes, so a test about one behaviour does not have to arrange the other three. */
const scheduleRoutes = (over: Routes = {}): Routes => routes({
  'GET schedules': { zone: 'Asia/Shanghai', now: AT, lastTriggerAt: AT, schedules: [scheduleView()] },
  // The preview describes the draft it was sent, which is how a test knows the draft reached the server.
  'POST schedules/preview': (call: Call) => {
    const draft = call.body as { timing: { time?: string } }
    return {
      schedule: scheduleView(), zone: 'Asia/Shanghai', describe: `每天 ${draft.timing?.time ?? '?'}`,
      next: [NEXT_DAY, '2026-11-05T01:00:00.000Z', '2026-11-06T01:00:00.000Z'],
    }
  },
  'PUT settings': { settings: settings(), settingsRevision: 4 },
  ...over,
})

/** The whole settings document with its schedules replaced, which is what a schedule save has to send. */
const settingsWith = (schedules: Record<string, unknown>[]): Record<string, unknown> => {
  const sources = settings().sources as Record<string, unknown>
  return settings({ sources: { ...sources, cron: { enabled: true, schedules } } })
}

/** What a save put in the settings document, which is the only part of it the server keeps. */
const savedSchedules = (call: Call | undefined): Record<string, unknown>[] => {
  const body = call?.body as { sources?: { cron?: { schedules?: Record<string, unknown>[] } } } | undefined
  const list = body?.sources?.cron?.schedules
  if (list === undefined) throw new Error('the panel never saved a settings document')
  return list
}

/**
 * The chat part of `GET state`, as a plugin of this generation composes it: the policy the gate will apply, and what
 * the Source is holding. `waiting.ids` are IDENTITIES (the Source deduplicates them) while `waiting.count` is
 * MESSAGES, so one id can stand for several of them — the page has to word that difference rather than blur it.
 */
const chatView = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  policy: { enabled: true, paused: false, deny: false, acceptMode: 'auto', allowedSenders: ['operator', 'alice'] },
  waiting: { count: 0, ids: [] },
  ...over,
})

/** The Source's own report, as `state.sources.chat` carries it — the ok/detail the section's status line reads. */
const chatStatus = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  ok: true, detail: '1 channel(s)', counts: { accepted: 1, waiting: 0 }, lastTriggerAt: AT, ...over,
})

/** The settings block the section reads its channels and its map from: the page already has the whole document. */
const chatBlock = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  enabled: true, pollMs: 5000,
  identities: { U01ABCDEF: { actor: 'alice', note: '操作者本人' } },
  channels: [{ id: 'ops', directory: '/chat/ops', enabled: true }],
  ...over,
})

const chatDocument = (chat: Record<string, unknown> = {}): Record<string, unknown> => {
  const base = settings()
  return { ...base, sources: { ...(base.sources as Record<string, unknown>), chat: chatBlock(chat) } }
}

/**
 * A whole `GET state` of the generation that has the chat view. Everything the section reads arrives in this one
 * answer — the settings block, the Source's status, its health line and the reply tally — which is the point of
 * folding it into `state` instead of giving it a route an older host would refuse.
 */
const chatState = (over: Record<string, unknown> = {}): Record<string, unknown> => {
  const base = state()
  return state({
    settings: chatDocument(),
    mountedAt: AT,
    sources: { ...(base.sources as Record<string, unknown>), chat: chatStatus() },
    counts: {
      ...(base.counts as Record<string, unknown>),
      sends: { queued: 3, nowhere: 11 },
    },
    chat: chatView(),
    ...over,
  })
}

/** A Source that is switched off: the settings block and the server's composed policy have to agree about it. */
const offState = (chat: Record<string, unknown> = {}): Record<string, unknown> => chatState({
  settings: chatDocument({ enabled: false }),
  chat: chatView({
    ...chat,
    policy: { enabled: false, paused: false, deny: false, acceptMode: 'auto', allowedSenders: ['operator', 'alice'] },
  }),
  sources: { cron: {}, inbox: {}, chat: chatStatus({ detail: 'disabled', counts: { waiting: 0 } }) },
})

/** The identity map's row for one platform id, which is where its 删除 button lives. */
const identityRow = (platform: string): Element => {
  const row = all('#chat table tbody tr').find(node => read(node.children[0]) === platform)
  if (row === undefined) throw new Error(`the identity map has no row for ${platform}`)
  return row
}

// ------------------------------------------------------------------ the harness

/** A real event-loop turn. A fake clock cannot produce one, and the page's promise chain has to land before an assert. */
const settle = (): Promise<void> => new Promise(resolve => setImmediate(resolve))

/** Run the page's own timers, then let whatever they asked for arrive. */
const tick = async (ms: number): Promise<void> => {
  await vi.advanceTimersByTimeAsync(ms)
  await settle()
}

/**
 * Listeners this mount left on the window and the document. jsdom's window outlives a test, and a page from an earlier
 * test still watching the address bar would drive the DOM the next test is asserting about.
 */
let watched: [EventTarget, string, EventListenerOrEventListenerObject][] = []

/**
 * Put the page in the DOM and run it, the way a browser opening `/myagent/` does.
 * @param hash the address to open at, because a notification deep-links the panel rather than landing it on the list.
 */
const mount = async (answers: Routes, hash = '') => {
  // Faked before the page runs: its boot installs a 5-second interval, and a real one would fire in the next test.
  vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'Date'] })
  // The page's own stylesheet is not installed, so what a test can assert is the class the page hides things with —
  // which is also the class a browser hides them by.
  document.body.innerHTML = MARKUP
  // A native dialog blocks a browser and cannot be answered here; the page promises never to open one, so a broken
  // promise should fail at the point of use rather than hang the suite.
  for (const dialog of ['alert', 'confirm', 'prompt']) {
    vi.stubGlobal(dialog, () => { throw new Error(`the panel opened a native ${dialog}()`) })
  }
  if (hash !== '') window.history.replaceState(null, '', hash)
  const listeners = [window, document].map(target => [target, vi.spyOn(target, 'addEventListener')] as const)
  const log = serve(answers)
  new Function(SCRIPT)()
  for (const [target, spy] of listeners) {
    for (const [name, listener] of spy.mock.calls) watched.push([target, name, listener as EventListenerOrEventListenerObject])
    spy.mockRestore()
  }
  await settle()
  return log
}

afterEach(() => {
  for (const [target, name, listener] of watched) target.removeEventListener(name, listener)
  watched = []
  for (const restore of undo.reverse()) restore()
  undo = []
  vi.useRealTimers()
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
  window.history.replaceState(null, '', window.location.pathname)
})

// ------------------------------------------------------------------- small reads

const byId = (id: string): HTMLElement => {
  const node = document.getElementById(id)
  if (node === null) throw new Error(`the page has no #${id}`)
  return node
}
/** What the operator reads in one element. */
const text = (id: string): string => byId(id).textContent ?? ''
const input = (id: string): HTMLInputElement => byId(id) as HTMLInputElement
const area = (id: string): HTMLTextAreaElement => byId(id) as HTMLTextAreaElement

/** The one element a person would look at; a page that does not have it fails with the selector, not with a null. */
const one = (selector: string, within: ParentNode = document): Element => {
  const node = within.querySelector(selector)
  if (node === null) throw new Error(`the page has nothing at ${selector}`)
  return node
}
const all = (selector: string, within: ParentNode = document): Element[] => [...within.querySelectorAll(selector)]
const read = (node: Element | null | undefined): string => node?.textContent ?? ''

/** The one button a person would click, found by its label, because the page has no test handles. */
const button = (label: string, within: ParentNode = document): Element => {
  const found = all('button', within).filter(node => (node.textContent ?? '').trim() === label)
  if (found.length !== 1) throw new Error(`${found.length} buttons in this view read “${label}”`)
  return found[0]!
}

/** Read and fill one of the rows a person adds and takes away, which have no ids of their own. */
const valueOf = (node: Element): string => (node as HTMLInputElement).value
const fill = (node: Element, value: string): void => {
  (node as HTMLInputElement).value = value
}

/** What a person at the keyboard leaves behind: the value the page reads, and the event a listener would get. */
const type = (id: string, value: string): void => {
  input(id).value = value
  byId(id).dispatchEvent(new Event('input', { bubbles: true }))
}

const click = (node: Element): void => {
  node.dispatchEvent(new MouseEvent('click', { bubbles: true }))
}
const choose = (id: string, value: string): void => {
  input(id).value = value
  byId(id).dispatchEvent(new Event('change', { bubbles: true }))
}

/** One row of the detail's key/value list, which is how the page presents a Ticket's facts. */
const detailValue = (label: string): string => {
  const term = all('#detail .kv dt').find(node => node.textContent === label)
  if (term === undefined) throw new Error(`the detail has no row “${label}”`)
  return read(term.nextElementSibling)
}

const toastText = (): string => text('toast')

/** Open the Ticket the list already shows, which is what one click on it does. */
const openListed = async (): Promise<void> => {
  click(one('#tickets li'))
  await settle()
}

/** The schedule list is rebuilt by every click on it, so a test re-reads the row it means rather than holding a node. */
const scheduleRow = (id: string): Element => {
  const row = all('#schedules li').find(node => (node.textContent ?? '').includes(`标识 ${id}`))
  if (row === undefined) throw new Error(`the schedule list has no row for ${id}`)
  return row
}

/**
 * Put a property on for one test and put back whatever was there — for the browser APIs jsdom does not implement, that
 * is nothing, and a leftover stub would make the next test read a page that is not the one under test.
 */
const replace = (target: object, key: string, value: unknown): (() => void) => {
  const original = Object.getOwnPropertyDescriptor(target, key)
  Object.defineProperty(target, key, { configurable: true, writable: true, value })
  return () => {
    if (original === undefined) Reflect.deleteProperty(target, key)
    else Object.defineProperty(target, key, original)
  }
}
let undo: (() => void)[] = []

/** The clipboard a browser gives a page it trusts; without one, the page has to say so rather than fail quietly. */
const stubClipboard = (): ReturnType<typeof vi.fn> => {
  const writeText = vi.fn(async () => {})
  undo.push(replace(navigator, 'clipboard', { writeText }))
  return writeText
}

interface Download { readonly href: string; readonly blob: Blob; readonly link: HTMLAnchorElement }

/**
 * Object URLs and navigation, which jsdom has neither of, and the download path needs both: it makes a Blob URL, clicks
 * a temporary anchor, and revokes the URL afterwards. Recording the click is also the only way to see the file name the
 * operator would be handed, and a click on anything else is a navigation this page has no business attempting.
 */
const stubDownloads = (): { readonly clicks: Download[]; readonly alive: (href: string) => boolean } => {
  const blobs = new Map<string, Blob>()
  const clicks: Download[] = []
  undo.push(replace(URL, 'createObjectURL', (blob: Blob) => {
    const href = `blob:panel/${blobs.size + 1}`
    blobs.set(href, blob)
    return href
  }))
  undo.push(replace(URL, 'revokeObjectURL', (href: string) => { blobs.delete(href) }))
  undo.push(replace(HTMLAnchorElement.prototype, 'click', function (this: HTMLAnchorElement) {
    const href = this.getAttribute('href') ?? ''
    const blob = blobs.get(href)
    if (blob === undefined) throw new Error(`the panel clicked a link to ${href}, which is not a Blob URL it made`)
    clicks.push({ href, blob, link: this })
  }))
  return { clicks, alive: href => blobs.has(href) }
}

describe('the header', () => {
  it('tells the operator what the system accepts, what it is running, and whether it is healthy', async () => {
    await mount(routes())
    expect(text('mode')).toBe('受理模式 auto')
    expect(text('counts')).toBe('Ticket 2 进行中 · 1 等人 · 5 已结束')
    expect(text('slots')).toBe('工作槽 1/2 · 队列 1')
    expect(text('health')).toBe('状态 正常')
    // The id is not in the main-session report the API gives, so the header has to take it from the machine view.
    expect(text('main-session')).toBe('主 Session myagent-main')
    expect(text('paths')).toBe('状态 /state')
    expect(byId('paths').title).toBe('state: /state\nwork: /work\ninbox: /inbox\nmain session: myagent-main')
    expect(byId('create-main').classList.contains('hidden')).toBe(true)
  })

  it('counts the Tickets that wait for a person, whichever key the API names them under', async () => {
    // `state.counts` has `attention` and no `waiting`, so the number on screen comes from the page's own fallback.
    await mount(routes({
      'GET state': state({ counts: { open: 3, ended: 5, attention: 2, effects: {}, workerSlots: { used: 0, max: 2 } } }),
    }))
    expect(text('counts')).toContain('2 等人')
  })

  /**
   * A count of Tickets that need a person is the one number on this page that must not be skimmable, and the page
   * agrees: it writes `class="${state.counts.waiting > 0 ? 'warn' : ''}"` around that very number. It reads the key it
   * tests from the API's `attention`, so the test is always `undefined > 0` and the highlight never happens.
   */
  it('marks the waiting count as needing attention, so it cannot be read as just another number', async () => {
    await mount(routes({
      'GET state': state({ counts: { open: 3, ended: 5, attention: 2, effects: {}, workerSlots: { used: 0, max: 2 } } }),
    }))
    expect(byId('counts').querySelector('b.warn')?.textContent).toBe('2')
  })

  it('names what is wrong when a part reports a problem, instead of only counting it', async () => {
    await mount(routes({
      'GET state': state({ health: { executor: { ok: false, detail: '启动失败：没有可用模型', at: LATER } } }),
    }))
    expect(text('health')).toBe('状态 1 个问题')
    expect(byId('health').title).toContain('executor: 启动失败：没有可用模型')
  })

  it('offers to create the main Session while there is none, and hides the offer once it exists', async () => {
    await mount(routes({ 'GET state': state({ mainSession: { exists: false, running: false, busy: false } }) }))
    expect(text('main-session')).toBe('主 Session 未创建')
    expect(byId('create-main').classList.contains('hidden')).toBe(false)
  })

  it('says out loud that the deployment is not usable, rather than showing an empty panel', async () => {
    await mount(routes({ 'GET state': state({ setupProblem: '状态目录 /state 不可写' }) }))
    expect(toastText()).toBe('状态目录 /state 不可写')
    expect(byId('toast').classList.contains('show')).toBe(true)
  })

  it('marks every request as its own, which is what lets the API tell this page from a foreign one', async () => {
    const { calls } = await mount(routes())
    expect(calls.length).toBeGreaterThan(0)
    for (const call of calls) {
      expect(call.url.startsWith('/myagent/api/'), call.url).toBe(true)
      expect(call.headers['x-myagent-request']).toBe('1')
      expect(call.headers['content-type']).toBe('application/json')
    }
  })

  it('reads the system, the Ticket list and the recipes before the operator touches anything', async () => {
    const { sent } = await mount(routes())
    expect(sent('GET state')).toHaveLength(1)
    expect(sent('GET recipes')).toHaveLength(1)
    const [list] = sent('GET tickets')
    expect(list?.query.get('state')).toBe('open')
    expect(list?.query.get('limit')).toBe('80')
    // The default tab is drawn, and the six others are not merely present but hidden.
    expect(byId('tab-tickets').classList.contains('hidden')).toBe(false)
    expect(byId('tab-settings').classList.contains('hidden')).toBe(true)
    expect(text('ticket-hint')).toBe('1 条')
  })

  it('reads the whole system again every five seconds, so a page left open is not a page left behind', async () => {
    const { sent } = await mount(routes())
    await tick(4999)
    expect(sent('GET state')).toHaveLength(1)
    await tick(1)
    expect(sent('GET state')).toHaveLength(2)
  })
})

describe('the tabs', () => {
  it('shows one page at a time, and reads what that page needs when the operator asks for it', async () => {
    const { sent } = await mount(routes({ 'GET decisions': { count: 0, decisions: [] } }))
    expect([...byId('tabs').children].map(node => (node as HTMLElement).dataset.tab))
      .toEqual(['tickets', 'works', 'new', 'decisions', 'sources', 'schedules', 'settings', 'prompts'])

    click(button('门禁记录'))
    await settle()
    expect(sent('GET decisions')).toHaveLength(1)
    expect(byId('tab-decisions').classList.contains('hidden')).toBe(false)
    for (const other of ['tickets', 'works', 'new', 'sources', 'schedules', 'settings', 'prompts']) {
      expect(byId(`tab-${other}`).classList.contains('hidden'), other).toBe(true)
    }
    expect(byId('tabs').children[3]!.getAttribute('aria-selected')).toBe('true')
    expect(byId('tabs').children[0]!.getAttribute('aria-selected')).toBe('false')
  })

  it('stops watching a Ticket when the operator leaves the page it is on', async () => {
    const { sent } = await mount(routes())
    click(one('#tickets li'))
    await settle()
    await tick(3000)
    expect(sent('GET tickets/ticket-1')).toHaveLength(2)

    click(button('设置'))
    await settle()
    await tick(12_000)
    expect(sent('GET tickets/ticket-1')).toHaveLength(2)
  })
})

describe('one Ticket', () => {
  it('answers what this work is, who authorized it, and where it runs, without opening a terminal', async () => {
    await mount(routes())
    await openListed()
    expect(text('detail')).toContain('整理本周竞品动态')
    expect(read(one('#detail .stage'))).toBe('waiting')
    expect(one('#detail .stage').className).toContain('attention')
    expect(all('#detail .kv dt').map(node => node.textContent))
      .toEqual(['Ticket', '创建', '更新', '归属', '授权', '目录', '来源 Trigger'])
    expect(detailValue('Ticket')).toBe('ticket-1')
    expect(detailValue('授权')).toBe('operator（person）经 schedule，策略版本 pv-9f3c')
    expect(detailValue('目录')).toBe('/work/ticket-1')
    expect(detailValue('来源 Trigger')).toBe('trigger-7')
    expect(detailValue('创建')).toContain('2026')
    expect(detailValue('归属')).toBe('未归入')
    expect(text('detail')).toContain('只在这张 Ticket 自己的目录里工作')
  })

  it('shows the question, the report that came with it, and the result — the three things an answer needs', async () => {
    await mount(routes({
      'GET tickets/ticket-1': ticket({
        result: { summary: '做完了，报表在 report.md', files: ['report.md', 'data/raw.csv'], at: LATER },
        inputs: [
          { id: 'input-1', kind: 'text', text: '用第二个口径', at: LATER, deliveredAt: LATER },
          { id: 'input-2', kind: 'text', text: '别写别处', at: LATER },
        ],
      }),
    }))
    await openListed()
    expect(text('detail')).toContain('它在问')
    expect(read(one('#detail pre.warn'))).toBe('两份报表的口径不一样，按哪一个算？')
    // The stamp is rendered in the operator's own locale, so only its shape is assertable here.
    expect(text('detail')).toMatch(/\[[^\]]*\d[^\]]*\] waiting: 读完了三份文件，等你定一个口径\n文件: notes\.md/)
    expect(text('detail')).toContain('输入（2）')
    expect(text('detail')).toContain('已送达')
    expect(text('detail')).toContain('未送达')
    expect(text('detail')).toContain('结果')
    expect(text('detail')).toContain('做完了，报表在 report.md')
    expect(all('#detail .chip').map(node => node.textContent)).toContain('report.md')
  })

  it('lists what went in with the task, so a wrong attachment is visible before the run is judged', async () => {
    await mount(routes({
      'GET tickets/ticket-1': ticket({
        attachments: [
          { name: '需求.md', source: '/inbox/需求.md' },
          { name: 'data.csv', source: '/tmp/data.csv' },
        ],
      }),
    }))
    await openListed()
    expect(text('detail')).toContain('随任务带过去的文件（2）')
    expect(text('detail')).toContain('attachments/需求.md')
    expect(text('detail')).toContain('/inbox/需求.md')
  })

  it('puts the answer box above the buttons that send it, so a button never reads as the thing it acts on', async () => {
    await mount(routes())
    await openListed()
    const answer = byId('d-answer')
    const note = byId('d-note')
    const send = button('回答')
    const save = button('备注')
    /** Reading order is what "above" means here, and the DOM answers it with a bitmask rather than a comparison. */
    const above = (first: Element, second: Element): boolean =>
      (first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0
    expect(above(answer, send)).toBe(true)
    expect(above(note, save)).toBe(true)
    expect(above(answer, note)).toBe(true)
    // The stop reason sits below the buttons that opened it, and the confirmation below the reason.
    expect(above(save, byId('d-stop'))).toBe(true)
    expect(above(byId('d-stop-reason'), button('确认停止'))).toBe(true)
  })

  it('offers nothing to answer on work that has ended, and says how it ended', async () => {
    await mount(routes({
      'GET tickets/ticket-1': ticket({
        stage: 'stopped', ended: { at: LATER, by: 'person', outcome: 'stopped', reason: '数据源不可用' },
      }),
      'GET tickets': { offset: 0, limit: 80, count: 1, tickets: [listed({ stage: 'stopped' })] },
    }))
    await openListed()
    expect(detailValue('结束')).toMatch(/^stopped · \D*\d.* · 数据源不可用$/)
    expect(all('#d-answer')).toHaveLength(0)
    expect(all('#d-note')).toHaveLength(0)
    const actions = all('#detail button').map(node => (node.textContent ?? '').trim())
    // What is left are the file buttons of an ended run; nothing here can push work that has finished.
    for (const action of ['回答', '备注', '重试本轮', '停止', '确认停止']) expect(actions, action).not.toContain(action)
  })

  it('keeps the newest six reports on screen and lets the operator ask for the rest', async () => {
    const reports = Array.from({ length: 9 }, (_, index) => ({ state: 'progress', summary: `第 ${index + 1} 步`, at: LATER }))
    await mount(routes({ 'GET tickets/ticket-1': ticket({ reports }) }))
    await openListed()
    expect(text('detail')).toContain('报告（9）')
    expect(text('detail')).not.toContain('第 1 步')
    expect(text('detail')).toContain('第 9 步')

    click(button('展开全部 9 条'))
    await settle()
    expect(text('detail')).toContain('第 1 步')
    click(button('只看最近 6 条'))
    await settle()
    expect(text('detail')).not.toContain('第 1 步')
    expect(text('detail')).toContain('第 9 步')
  })

  it('keeps the newest six inputs and lets the operator ask for the rest, like reports', async () => {
    // Reports have always had this button; inputs are facts of the same kind, and a cut answer with no way to see
    // the rest is exactly the complaint this page was rebuilt over.
    const inputs = Array.from({ length: 9 }, (_, index) => ({
      id: `input-${index + 1}`, kind: 'text', text: `第 ${index + 1} 句回答`, at: LATER, deliveredAt: LATER,
    }))
    await mount(routes({ 'GET tickets/ticket-1': ticket({ inputs }) }))
    await openListed()
    expect(text('detail')).toContain('输入（9）')
    expect(text('detail')).not.toContain('第 1 句回答')
    expect(text('detail')).toContain('第 9 句回答')
    click(button('展开全部 9 条'))
    await settle()
    expect(text('detail')).toContain('第 1 句回答')
    expect(all('#detail button').map(node => node.textContent)).toContain('只看最近 6 条')
  })

  it('sends the answer the operator wrote, and refuses to send an empty one', async () => {
    const { sent, last } = await mount(routes({ 'POST tickets/ticket-1/answer': ticket() }))
    await openListed()
    click(button('回答'))
    await settle()
    expect(toastText()).toBe('先写回答内容')
    expect(sent('POST tickets/ticket-1/answer')).toHaveLength(0)

    type('d-answer', '用第二个口径，理由写在 report.md 里')
    click(button('回答'))
    await settle()
    expect(sent('POST tickets/ticket-1/answer')).toHaveLength(1)
    expect(last('POST tickets/ticket-1/answer')?.body).toEqual({ text: '用第二个口径，理由写在 report.md 里' })
    expect(toastText()).toBe('已提交')
  })

  it('adds a fact without widening the scope, and says so when there is nothing to add', async () => {
    const { sent, last } = await mount(routes({ 'POST tickets/ticket-1/note': ticket() }))
    await openListed()
    click(button('备注'))
    await settle()
    expect(toastText()).toBe('先写备注内容')

    type('d-note', '口径以财务那份为准')
    click(button('备注'))
    await settle()
    expect(last('POST tickets/ticket-1/note')?.body).toEqual({ text: '口径以财务那份为准' })
  })

  it('pushes a stalled Ticket again with one click', async () => {
    const { sent, last } = await mount(routes({ 'POST tickets/ticket-1/retry': ticket() }))
    await openListed()
    click(button('重试本轮'))
    await settle()
    expect(sent('POST tickets/ticket-1/retry')).toHaveLength(1)
    expect(last('POST tickets/ticket-1/retry')?.body).toEqual({})
  })

  it('reports a refusal from the server in the operator\'s own words, rather than losing it', async () => {
    await mount(routes({ 'POST tickets/ticket-1/answer': refuse(404, 'There is no Ticket ticket-1') }))
    await openListed()
    type('d-answer', '用第二个口径')
    click(button('回答'))
    await settle()
    expect(toastText()).toBe('There is no Ticket ticket-1')
  })
})

describe('what the worker is doing right now', () => {
  it('names the DSH Session doing the work, so the operator can go and watch it', async () => {
    await mount(routes())
    await openListed()
    const chips = all('#d-progress .chip').map(node => node.textContent ?? '')
    expect(chips[0]).toBe('worker Session myagent-ticket-1')
    expect(chips[1]).toBe('已载入 · working')
    expect(chips[2]).toBe('第 4 轮')
    expect(chips[3] ?? '').toContain('最后动静 ')
    expect(text('d-progress')).toContain('在 DSH 的会话列表里找「myagent · 整理本周竞品动态」')
    expect(read(one('#d-progress .said'))).toBe('我先把 attachments 里的三份文件读完了。')
  })

  it('keeps the recent tool calls newest first, because the top one is the answer to "what is it doing"', async () => {
    await mount(routes())
    await openListed()
    const chips = all('#d-progress .chip').map(node => node.textContent ?? '')
    // The server walks its log backwards, so the order it sends is the order a person reads as "now, then before".
    expect(chips.findIndex(chip => chip.startsWith('read'))).toBeLessThan(chips.findIndex(chip => chip.startsWith('bash')))
    expect(text('d-progress')).toContain('最近调用：')
  })

  it('says a worker has been unloaded rather than leaving an empty box to guess at', async () => {
    await mount(routes({
      'GET tickets/ticket-1/progress': progress({
        loaded: false, agentStatus: undefined, turn: undefined, lastEventAt: undefined,
        recentTools: [], lastSaid: undefined,
      }),
    }))
    await openListed()
    const chips = all('#d-progress .chip').map(node => node.textContent ?? '')
    expect(chips).toContain('未载入（跑完就卸载了）')
    expect(text('d-progress')).not.toContain('第 ')
    expect(text('d-progress')).not.toContain('最近调用')
    expect(all('#d-progress .said')).toHaveLength(0)
  })

  it('copies the Session id when the browser lets it', async () => {
    const writeText = stubClipboard()
    await mount(routes())
    await openListed()
    click(button('复制 id'))
    await settle()
    expect(writeText).toHaveBeenCalledWith('myagent-ticket-1')
    expect(toastText()).toBe('已复制')
  })

  it('says plainly that it could not copy, instead of leaving the operator guessing whether it did', async () => {
    // jsdom has no clipboard, which is also what a browser hands a page it will not let write one.
    await mount(routes())
    await openListed()
    click(button('复制 id'))
    await settle()
    expect(toastText()).toBe('复制不了，请手动选中')
  })

  it('says when the work never reached the worker, which otherwise looks like a worker ignoring it', async () => {
    await mount(routes({
      'GET tickets/ticket-1/progress': progress({ assignment: { id: 'assignment-1', state: 'pending', deliveryError: 'Session 未响应' } }),
    }))
    await openListed()
    expect(read(one('#d-progress pre.bad'))).toBe('投递失败：Session 未响应')
  })
})

describe('what a run produced', () => {
  const rows = (): Element[] => all('#d-files .filelist li')

  it('lists what came out, with sizes a person can read and directories marked as directories', async () => {
    await mount(routes())
    await openListed()
    expect(text('d-files')).toContain('/work/ticket-1')
    const [report, directory, image] = rows()
    expect(read(one('button.linklike', report!))).toBe('报告.md')
    expect(read(one('.size', report!))).toBe('2.0 KB')
    // A directory is not a thing to open or to take away, so it gets neither button.
    expect(read(one('.muted', directory!))).toBe('data/')
    expect(all('button', directory!)).toHaveLength(0)
    expect(read(one('.size', image!))).toBe('2.0 MB · 二进制')
    expect(all('button', image!)).toHaveLength(2)
  })

  it('says the listing stopped early instead of implying it is the whole directory', async () => {
    await mount(routes({ 'GET tickets/ticket-1/files': files({ truncated: true, count: 500 }) }))
    await openListed()
    expect(text('d-files')).toContain('至少 500 个文件——列表到上限就停了，完整的在上面的目录里。')
  })

  it('says a Ticket has no directory yet, rather than showing an empty box', async () => {
    await mount(routes({ 'GET tickets/ticket-1/files': { directory: undefined, files: [], count: 0, truncated: false } }))
    await openListed()
    expect(text('d-files')).toBe('这张 Ticket 还没有目录。')
  })

  it('shows a text file as the UTF-8 text it is, Chinese and all', async () => {
    const { last } = await mount(routes({ 'GET tickets/ticket-1/file': served() }))
    await openListed()
    click(button('报告.md'))
    await settle()
    expect(last('GET tickets/ticket-1/file')?.query.get('path')).toBe('报告.md')
    // The route hands over base64, and `atob` alone yields Latin-1 code points: this is the assertion that would catch
    // a report coming back as mojibake, which is unreadable exactly when the operator needs to read it.
    expect(read(one('#d-fileview pre.view'))).toBe(REPORT_TEXT)
    expect(text('d-fileview')).toContain('报告.md')
  })

  it('says where a file it cannot show is, and offers the way to get it', async () => {
    const downloads = stubDownloads()
    await mount(routes({
      'GET tickets/ticket-1/file': served({ path: 'chart.png', absolute: '/work/ticket-1/chart.png', text: false, base64: PNG.toString('base64'), size: PNG.length }),
    }))
    await openListed()
    click(button('chart.png'))
    await settle()
    expect(text('d-fileview')).toContain('不是文本（/work/ticket-1/chart.png），用「下载」取。')
    // Nothing is decoded and shown as text: a binary guessed at is a screen full of noise.
    expect(all('#d-fileview pre.view')).toHaveLength(0)
    click(button('下载', byId('d-fileview')))
    await settle()
    expect(downloads.clicks.map(item => item.link.getAttribute('download'))).toEqual(['chart.png'])
  })

  it('hands a file over as a download under its own name, and gives the address back afterwards', async () => {
    const downloads = stubDownloads()
    await mount(routes({
      'GET tickets/ticket-1/file': served({ path: 'chart.png', absolute: '/work/ticket-1/chart.png', text: false, base64: PNG.toString('base64'), size: PNG.length }),
    }))
    await openListed()
    click(button('下载', rows()[2]!))
    await settle()
    expect(downloads.clicks).toHaveLength(1)
    const [download] = downloads.clicks
    expect(download!.link.getAttribute('download')).toBe('chart.png')
    // The bytes are the file's, not an empty placeholder: a download that opens as nothing is worse than no download.
    expect(Buffer.from(await download!.blob.arrayBuffer())).toEqual(PNG)
    expect(download!.link.isConnected).toBe(false)
    expect(downloads.alive(download!.href)).toBe(true)
    await tick(5000)
    expect(downloads.alive(download!.href)).toBe(false)
  })

  it('closes an open file when the operator asks, and only then', async () => {
    await mount(routes({ 'GET tickets/ticket-1/file': served() }))
    await openListed()
    click(button('报告.md'))
    await settle()
    expect(all('#d-fileview pre.view')).toHaveLength(1)
    click(button('收起'))
    await settle()
    expect(text('d-fileview')).toBe('')
  })

  it('says when a file cannot be read, next to the file it was asked for', async () => {
    await mount(routes({ 'GET tickets/ticket-1/file': refuse(400, '报告.md is 20.0 MB; the panel serves up to 16 MB.') }))
    await openListed()
    click(button('报告.md'))
    await settle()
    expect(read(one('#d-fileview pre.bad'))).toBe('报告.md is 20.0 MB; the panel serves up to 16 MB.')
  })
})

describe('a page left open', () => {
  it('re-reads a running Ticket every three seconds, which is the only reason to leave the page open', async () => {
    const { sent } = await mount(routes())
    await openListed()
    expect(sent('GET tickets/ticket-1')).toHaveLength(1)
    await tick(2999)
    expect(sent('GET tickets/ticket-1')).toHaveLength(1)
    await tick(1)
    expect(sent('GET tickets/ticket-1')).toHaveLength(2)
    await tick(3000)
    expect(sent('GET tickets/ticket-1')).toHaveLength(3)
    // Every read of the Ticket brings the two things that move with it.
    expect(sent('GET tickets/ticket-1/progress')).toHaveLength(3)
    expect(sent('GET tickets/ticket-1/files')).toHaveLength(3)
  })

  it('does not poll a Ticket that has already ended, because nothing about it can change', async () => {
    const { sent } = await mount(routes({
      'GET tickets/ticket-1': ticket({ stage: 'done', ended: { at: LATER, by: 'agent', outcome: 'done', reason: '做完了' } }),
      'GET tickets': { offset: 0, limit: 80, count: 1, tickets: [listed({ stage: 'done' })] },
    }))
    await openListed()
    await tick(9000)
    expect(sent('GET tickets/ticket-1')).toHaveLength(1)
  })

  it('stops polling the moment a Ticket ends under the operator\'s eyes', async () => {
    let asked = 0
    const { sent } = await mount(routes({
      'GET tickets/ticket-1': () => {
        asked += 1
        return asked === 1
          ? ticket()
          : ticket({ stage: 'stopped', ended: { at: LATER, by: 'person', outcome: 'stopped', reason: '操作者停止了它' } })
      },
    }))
    await openListed()
    await tick(3000)
    expect(sent('GET tickets/ticket-1')).toHaveLength(2)
    // The view moved to the ended Ticket: there is nothing left to answer.
    expect(all('#d-answer')).toHaveLength(0)
    await tick(9000)
    expect(sent('GET tickets/ticket-1')).toHaveLength(2)
    // The list is read again, so the row on the left shows the stage the detail now shows.
    expect(sent('GET tickets').length).toBeGreaterThan(1)
  })

  it('keeps what the operator is typing when a refresh lands in the middle of it', async () => {
    await mount(routes())
    await openListed()
    input('d-answer').focus()
    type('d-answer', '用第二个口径')
    type('d-note', '财务那一份是准的')
    await tick(3000)
    expect(input('d-answer').value).toBe('用第二个口径')
    expect(input('d-note').value).toBe('财务那一份是准的')
    // Losing the cursor every three seconds is losing the answer: the operator is looking at the keyboard, not the page.
    expect(document.activeElement?.id).toBe('d-answer')
  })

  it('keeps a file open across a refresh, because closing it is losing the operator\'s place', async () => {
    await mount(routes({ 'GET tickets/ticket-1/file': served() }))
    await openListed()
    click(button('报告.md'))
    await settle()
    await tick(6000)
    expect(read(one('#d-fileview pre.view'))).toBe(REPORT_TEXT)
  })

  it('keeps the whole report history open across a refresh', async () => {
    const reports = Array.from({ length: 9 }, (_, index) => ({ state: 'progress', summary: `第 ${index + 1} 步`, at: LATER }))
    await mount(routes({ 'GET tickets/ticket-1': ticket({ reports }) }))
    await openListed()
    click(button('展开全部 9 条'))
    await settle()
    await tick(3000)
    expect(text('detail')).toContain('第 1 步')
    expect(all('#detail button').map(node => node.textContent)).toContain('只看最近 6 条')
  })

  it('does not poll a Ticket nobody is looking at, and reads it again when they come back', async () => {
    const { sent } = await mount(routes())
    await openListed()
    // A background tab is the ordinary case for a panel left open all day: polling it is spending requests for nobody.
    const hide = replace(document, 'hidden', true)
    undo.push(hide)
    await tick(6000)
    expect(sent('GET tickets/ticket-1')).toHaveLength(1)
    hide()
    document.dispatchEvent(new Event('visibilitychange'))
    await settle()
    // Coming back reads at once, rather than showing what was on screen when the tab was left.
    expect(sent('GET tickets/ticket-1')).toHaveLength(2)
  })

  it('does not refresh over a settings document the operator is editing', async () => {
    const { sent } = await mount(routes())
    click(button('设置'))
    await settle()
    type('settings', '{"acceptMode":"observe"}')
    await tick(10_000)
    expect(area('settings').value).toBe('{"acceptMode":"observe"}')
    expect(sent('GET state')).toHaveLength(1)
  })
})

describe('stopping a Ticket', () => {
  it('asks for a reason on the page, because a native dialog is the one thing this page never opens', async () => {
    await mount(routes())
    await openListed()
    expect(byId('d-stop').classList.contains('hidden')).toBe(true)
    click(button('停止'))
    expect(byId('d-stop').classList.contains('hidden')).toBe(false)
    expect(input('d-stop-reason').value).toBe('操作者停止了它')
  })

  it('stops the Ticket for the reason the operator wrote down', async () => {
    const { sent, last } = await mount(routes({
      'POST tickets/ticket-1/stop': ticket({ stage: 'stopped', ended: { at: LATER, by: 'person', outcome: 'stopped', reason: '数据源今天不可用' } }),
    }))
    await openListed()
    click(button('停止'))
    type('d-stop-reason', '数据源今天不可用')
    click(button('确认停止'))
    await settle()
    expect(last('POST tickets/ticket-1/stop')?.body).toEqual({ reason: '数据源今天不可用' })
    expect(toastText()).toBe('已提交')
    // The row on the left is read again, so the list does not keep showing a stage that is no longer true.
    expect(sent('GET tickets').length).toBeGreaterThan(1)
    expect(byId('d-stop').classList.contains('hidden')).toBe(true)
  })

  it('takes a stop back before it is confirmed, without touching the Ticket', async () => {
    const { sent } = await mount(routes())
    await openListed()
    click(button('停止'))
    click(button('取消', byId('d-stop')))
    expect(byId('d-stop').classList.contains('hidden')).toBe(true)
    click(button('停止'))
    click(button('收回停止'))
    expect(byId('d-stop').classList.contains('hidden')).toBe(true)
    expect(sent('POST tickets/ticket-1/stop')).toHaveLength(0)
  })

  /**
   * The page keeps an unsent answer and an unsent note across a refresh and says why: "a refresh must never eat it".
   * A stop reason is the same thing — typed, unsent — and the Ticket being stopped is by definition still live, so the
   * three-second poll is running while the operator writes it and puts the default text back in the box.
   */
  it('keeps a stop reason the operator has not sent yet when a refresh lands', async () => {
    await mount(routes())
    await openListed()
    click(button('停止'))
    type('d-stop-reason', '数据源今天不可用，先停下来')
    await tick(3000)
    expect(input('d-stop-reason').value).toBe('数据源今天不可用，先停下来')
  })
})

describe('the address bar', () => {
  /** Two Tickets, so a deep link has somewhere to move to. */
  const twoTickets = (): Routes => routes({
    'GET tickets': {
      offset: 0, limit: 80, count: 2,
      tickets: [listed(), listed({ id: 'ticket-2', title: '月度数据报表', stage: 'running', waitsForPerson: false })],
    },
    'GET tickets/ticket-2': ticket({ id: 'ticket-2', title: '月度数据报表', stage: 'running', question: undefined, waitsForPerson: false }),
    'GET tickets/ticket-2/progress': progress({ sessionId: 'myagent-ticket-2' }),
    'GET tickets/ticket-2/files': files({ directory: '/work/ticket-2' }),
  })

  it('lands on the Ticket a notification pointed at, not on whatever the page defaults to', async () => {
    const { sent } = await mount(twoTickets(), '#ticket=ticket-2')
    expect(sent('GET tickets/ticket-2')).toHaveLength(1)
    expect(text('detail')).toContain('月度数据报表')
    expect(byId('tab-tickets').classList.contains('hidden')).toBe(false)
    expect(read(one('#tickets li[aria-current="true"]'))).toContain('月度数据报表')
  })

  it('follows the address bar to another Ticket', async () => {
    await mount(twoTickets(), '#ticket=ticket-1')
    expect(text('detail')).toContain('整理本周竞品动态')
    window.location.hash = '#ticket=ticket-2'
    window.dispatchEvent(new Event('hashchange'))
    await settle()
    expect(text('detail')).toContain('月度数据报表')
    expect(read(one('#tickets li[aria-current="true"]'))).toContain('月度数据报表')
  })

  it('ignores an address that names no Ticket and leaves the operator on the list', async () => {
    const { sent } = await mount(routes(), '#settings')
    expect(text('detail')).toBe('选择一个 Ticket。')
    expect(sent('GET tickets/ticket-1')).toHaveLength(0)
  })

  it('writes the Ticket the operator opened into the address, so a reload lands back on it', async () => {
    await mount(routes())
    await openListed()
    expect(one('#tickets li').getAttribute('aria-current')).toBe('true')
    expect(window.location.hash).toBe('#ticket=ticket-1')
  })
})

describe('the ticket list', () => {
  it('asks for the list the operator selected', async () => {
    const { last } = await mount(routes())
    choose('filter', 'ended')
    await settle()
    expect(last('GET tickets')?.query.get('state')).toBe('ended')
    expect(last('GET tickets')?.query.get('limit')).toBe('80')
  })

  it('says there is nothing in the list, in a sentence', async () => {
    await mount(routes({ 'GET tickets': { offset: 0, limit: 80, count: 0, tickets: [] } }))
    expect(text('tickets')).toBe('没有 Ticket。')
    expect(text('ticket-hint')).toBe('0 条')
    expect(all('#tickets li button')).toHaveLength(0)
  })

  it('shows on each row what it is, what stage it is at, and who it is waiting for', async () => {
    await mount(routes())
    const row = one('#tickets li')
    expect(read(one('.title', row))).toBe('整理本周竞品动态')
    expect(read(one('.stage', row))).toBe('waiting')
    expect(one('.stage', row).className).toContain('attention')
    expect(read(row)).toContain('schedule · operator')
    expect(read(row)).toContain('等人回答')
    expect(read(row)).toContain('读完了三份文件')
    expect(row.getAttribute('aria-current')).toBe('false')
  })

  it('re-reads everything when the operator asks for it', async () => {
    const { sent } = await mount(routes())
    click(button('刷新'))
    await settle()
    expect(sent('GET state')).toHaveLength(2)
    expect(sent('GET tickets')).toHaveLength(2)
  })
})

describe('the 工作 page', () => {
  const openWorks = async (): Promise<void> => {
    click(button('工作'))
    await settle()
  }
  const workRoutes = (over: Routes = {}): Routes => routes({
    'GET projects': { projects: [project()] },
    'GET works': { works: [work()] },
    ...over,
  })

  it('lists the Projects and Works the server has, and reads both on the way in', async () => {
    const { sent } = await mount(workRoutes())
    await openWorks()
    expect(byId('tab-works').classList.contains('hidden')).toBe(false)
    // One read on boot to find out whether this host has the routes at all, one for the page itself.
    expect(sent('GET projects')).toHaveLength(2)
    expect(read(one('#projects li .title'))).toBe('竞品观察')
    expect(read(one('#projects li'))).toContain('每季看一次同行')
    expect(read(one('#works li .title'))).toBe('周报')
    // A Work's row says which Project it belongs to, by name rather than by id.
    expect(read(one('#works li'))).toContain('竞品观察')
    expect(read(one('#works li'))).toContain('只读 data/')
  })

  it('says what to do when there is no Project and no Work, rather than a bare 无', async () => {
    await mount(routes({ 'GET projects': { projects: [] }, 'GET works': { works: [] } }))
    await openWorks()
    expect(text('projects')).toBe('还没有项目。在下面给它起个名字建一个，把同类的工作归到一起。')
    expect(text('works')).toBe('还没有工作。用下面的表单建一个，再把 Ticket 归进去：它们按归入的先后在这里排队。')
  })

  it('creates a Project from the name and note the operator wrote, and empties the form', async () => {
    const { sent, last } = await mount(workRoutes({ 'POST projects': project() }))
    await openWorks()
    click(button('新建项目'))
    await settle()
    expect(toastText()).toBe('先写项目名')
    expect(sent('POST projects')).toHaveLength(0)
    type('pj-name', '竞品观察')
    type('pj-note', '每季看一次同行')
    click(button('新建项目'))
    await settle()
    expect(last('POST projects')?.body).toEqual({ name: '竞品观察', note: '每季看一次同行' })
    expect(toastText()).toBe('项目已建：竞品观察')
    expect(input('pj-name').value).toBe('')
  })

  it('creates a Work carrying the Project, scope and note, and puts what it made on screen', async () => {
    const { last } = await mount(workRoutes({
      'POST works': work(),
      'GET works/work-1': { work: work(), tickets: [] },
    }))
    await openWorks()
    type('wk-name', '周报')
    choose('wk-project', 'project-1')
    type('wk-scope', '只读 data/')
    type('wk-note', '每周一产出')
    click(button('新建工作'))
    await settle()
    expect(last('POST works')?.body).toEqual({ name: '周报', projectId: 'project-1', scope: '只读 data/', note: '每周一产出' })
    expect(toastText()).toBe('工作已建：周报')
    expect(input('wk-name').value).toBe('')
    // What was just made is on screen, not only in a toast.
    expect(text('work-detail')).toContain('周报')
  })

  it('opens a Project to its Works, and steps back out with a second click', async () => {
    const { sent } = await mount(workRoutes({
      'GET projects/project-1': { project: project(), works: [work()] },
    }))
    await openWorks()
    click(one('#projects li'))
    await settle()
    expect(sent('GET projects/project-1')).toHaveLength(1)
    expect(text('work-detail')).toContain('竞品观察')
    expect(text('work-detail')).toContain('周报')
    click(one('#projects li'))
    await settle()
    expect(sent('GET projects/project-1')).toHaveLength(1)
    expect(text('work-detail')).toBe('选择左边一个项目或工作；里面的 Ticket 点一下就回到 Ticket 页打开。')
  })

  it('opens a Work and shows its scope, its note, and its Tickets in the order they joined', async () => {
    await mount(workRoutes({
      'GET works/work-1': {
        work: work(),
        tickets: [
          listed({ id: 'ticket-2', title: '上上周的周报', workSeq: 2, updatedAt: LATER }),
          listed({ id: 'ticket-1', title: '上周的周报', workSeq: 1 }),
        ],
      },
    }))
    await openWorks()
    click(one('#works li'))
    await settle()
    expect(text('work-detail')).toContain('只读 data/')
    expect(text('work-detail')).toContain('每周一产出')
    // workSeq is the queue: a Ticket made last month and filed today is the next in line, whatever its dates say.
    const rows = all('#work-detail .list li')
    expect(read(one('.title', rows[0]!))).toBe('第 1 位 · 上周的周报')
    expect(read(one('.title', rows[1]!))).toBe('第 2 位 · 上上周的周报')
  })

  it('says what an empty Work is missing, in a sentence', async () => {
    await mount(workRoutes({ 'GET works/work-1': { work: work(), tickets: [] } }))
    await openWorks()
    click(one('#works li'))
    await settle()
    expect(text('work-detail')).toContain('这个工作还没有 Ticket。去「派活」派一个，或在 Ticket 详情页把它「归入工作」。')
  })

  it('takes the operator from a Work to one of its Tickets', async () => {
    const { sent } = await mount(workRoutes({
      'GET works/work-1': { work: work(), tickets: [listed()] },
    }))
    await openWorks()
    click(one('#works li'))
    await settle()
    click(one('#work-detail .list li'))
    await settle()
    expect(byId('tab-tickets').classList.contains('hidden')).toBe(false)
    expect(sent('GET tickets/ticket-1')).toHaveLength(1)
    expect(text('detail')).toContain('整理本周竞品动态')
  })

  it('keeps the form the operator is filling when the five-second refresh lands', async () => {
    await mount(workRoutes())
    await openWorks()
    type('wk-name', '周报')
    choose('wk-project', 'project-1')
    await tick(5000)
    expect(input('wk-name').value).toBe('周报')
    // The Project choices are re-read with the list; the pick has to survive that.
    expect(input('wk-project').value).toBe('project-1')
  })
})

describe('the Work a Ticket belongs to', () => {
  it('shows on the row and in the detail which Work a Ticket is in, and its place in it', async () => {
    await mount(routes({
      'GET tickets': { offset: 0, limit: 80, count: 1, tickets: [listed({ workId: 'work-1', workSeq: 3 })] },
      'GET tickets/ticket-1': ticket({ workId: 'work-1', workSeq: 3 }),
      'GET works': { works: [work()] },
    }))
    expect(read(one('#tickets li'))).toContain('周报 · 第 3 位')
    await openListed()
    // The detail names the Work and its id, because the name is what a person reads and the id what a log quotes.
    expect(detailValue('归属')).toBe('周报（work-1）· 第 3 位')
  })

  it('says a Ticket is not in a Work yet, and refuses to file it into nothing', async () => {
    const { sent } = await mount(routes())
    await openListed()
    expect(detailValue('归属')).toBe('未归入')
    click(button('归入'))
    await settle()
    expect(toastText()).toBe('先选一个工作')
    expect(sent('POST tickets/ticket-1/work')).toHaveLength(0)
  })

  it('files a Ticket into the Work the operator picked', async () => {
    const filed = ticket({ workId: 'work-1', workSeq: 1 })
    const { sent, last } = await mount(routes({
      'GET tickets/ticket-1': filed,
      'GET works': { works: [work()] },
      'POST tickets/ticket-1/work': filed,
    }))
    await openListed()
    choose('d-work', 'work-1')
    click(button('归入'))
    await settle()
    expect(last('POST tickets/ticket-1/work')?.body).toEqual({ workId: 'work-1' })
    expect(toastText()).toBe('已提交')
    // The answer comes back through the same read, so the detail says what was just done.
    expect(detailValue('归属')).toBe('周报（work-1）· 第 1 位')
    expect(sent('GET works').length).toBeGreaterThan(1)
  })

  it('offers to file a Ticket that has already ended, because filing is bookkeeping, not new work', async () => {
    await mount(routes({
      'GET tickets/ticket-1': ticket({ stage: 'done', ended: { at: LATER, by: 'agent', outcome: 'done', reason: '做完了' } }),
    }))
    await openListed()
    expect(all('#d-work')).toHaveLength(1)
    expect(all('#detail button').map(node => node.textContent)).toContain('归入')
  })
})

describe('产物，what the worker said it made', () => {
  it('lists the artifacts a Ticket registered, with when and what the report claimed', async () => {
    await mount(routes({
      'GET tickets/ticket-1': ticket({
        artifacts: [
          { ticketId: 'ticket-1', path: 'report.md', at: LATER, note: '报表写好了' },
          { ticketId: 'ticket-1', path: 'data/summary.md', at: LATER },
        ],
      }),
    }))
    await openListed()
    expect(text('detail')).toContain('产物（2）')
    const [report, summary] = all('#d-artifacts li')
    expect(read(one('button.linklike', report!))).toBe('report.md')
    expect(read(report!)).toContain('报表写好了')
    expect(read(report!)).toContain('2026')
    expect(read(one('button.linklike', summary!))).toBe('data/summary.md')
  })

  it('says what an empty artifact list means, rather than leaving a blank box', async () => {
    await mount(routes())
    await openListed()
    expect(text('detail')).toContain('还没有登记的产物')
  })

  it('opens an artifact through the same file route any output opens through', async () => {
    const { last } = await mount(routes({
      'GET tickets/ticket-1': ticket({
        artifacts: [{ ticketId: 'ticket-1', path: 'report.md', at: LATER, note: '报表写好了' }],
      }),
      'GET tickets/ticket-1/file': served(),
    }))
    await openListed()
    click(button('report.md', one('#d-artifacts li')))
    await settle()
    expect(last('GET tickets/ticket-1/file')?.query.get('path')).toBe('report.md')
    expect(read(one('#d-fileview pre.view'))).toBe(REPORT_TEXT)
  })

  it('hands an artifact over as a download under its own name', async () => {
    const downloads = stubDownloads()
    await mount(routes({
      'GET tickets/ticket-1': ticket({
        artifacts: [{ ticketId: 'ticket-1', path: 'chart.png', at: LATER }],
      }),
      'GET tickets/ticket-1/file': served({ path: 'chart.png', absolute: '/work/ticket-1/chart.png', text: false, base64: PNG.toString('base64'), size: PNG.length }),
    }))
    await openListed()
    click(button('下载', one('#d-artifacts li')))
    await settle()
    expect(downloads.clicks.map(item => item.link.getAttribute('download'))).toEqual(['chart.png'])
  })
})

describe('依赖，why it has not started', () => {
  it('separates what it waits for from what waits for it, labelled by direction', async () => {
    await mount(routes({
      'GET tickets/ticket-1/dependencies': {
        waitsFor: [dep()],
        waitedOnBy: [dep({ upstream: 'ticket-1', downstream: 'ticket-3', on: 'ended' })],
      },
    }))
    await openListed()
    // The waiting direction is the answer to "why hasn't this started", so it is the one that reads as a warning.
    expect(read(one('#d-dep-lists p.warn'))).toBe('它等这些（它们没完成，这张就不会启动）')
    expect(all('#d-dep-lists > p')[1]!.textContent).toBe('这些在等它')
    const [waiting, waited] = all('#d-dep-lists li')
    expect(read(waiting!)).toContain('ticket-2')
    expect(read(waiting!)).toContain('等它做成')
    expect(read(waited!)).toContain('ticket-3')
    expect(read(waited!)).toContain('等它结束')
  })

  it('says when nothing is waiting, which is the answer to "why hasn\'t it run"', async () => {
    await mount(routes())
    await openListed()
    expect(text('d-dep-lists')).toContain('不等任何 Ticket。')
    expect(text('d-dep-lists')).toContain('没有 Ticket 在等它。')
  })

  it('adds the edge the operator drew, saying what releases the wait', async () => {
    const { sent, last } = await mount(routes({
      'POST tickets/ticket-1/dependencies': dep({ on: 'ended' }),
      'GET tickets/ticket-1/dependencies': { waitsFor: [dep({ on: 'ended' })], waitedOnBy: [] },
    }))
    await openListed()
    click(button('添加依赖'))
    await settle()
    expect(toastText()).toBe('先选一个上游 Ticket，或直接填它的 id')
    expect(sent('POST tickets/ticket-1/dependencies')).toHaveLength(0)
    type('d-dep-id', 'ticket-2')
    choose('d-dep-on', 'ended')
    click(button('添加依赖'))
    await settle()
    expect(last('POST tickets/ticket-1/dependencies')?.body).toEqual({ upstream: 'ticket-2', on: 'ended' })
    expect(toastText()).toBe('已提交')
  })

  it('surfaces the cycle refusal in the server\'s own words, not a generic failure', async () => {
    await mount(routes({
      'POST tickets/ticket-1/dependencies': refuse(400, 'That would make a Ticket wait for itself, directly or through others'),
    }))
    await openListed()
    type('d-dep-id', 'ticket-1')
    click(button('添加依赖'))
    await settle()
    expect(toastText()).toBe('That would make a Ticket wait for itself, directly or through others')
  })

  it('drops an edge on a second click, and can take it back before it is gone', async () => {
    const { sent, last } = await mount(routes({
      'GET tickets/ticket-1/dependencies': { waitsFor: [dep()], waitedOnBy: [] },
      'POST tickets/ticket-1/dependencies/drop': { dropped: 'ticket-2', waitsFor: [] },
    }))
    await openListed()
    const row = (): Element => one('#d-dep-lists li')
    click(button('删除', row()))
    expect(sent('POST tickets/ticket-1/dependencies/drop')).toHaveLength(0)
    expect(read(row())).toContain('不再等它？')
    click(button('取消', row()))
    expect(read(row())).not.toContain('不再等它？')
    click(button('删除', row()))
    click(button('确认删除', row()))
    await settle()
    expect(last('POST tickets/ticket-1/dependencies/drop')?.body).toEqual({ upstream: 'ticket-2' })
    expect(toastText()).toBe('已提交')
  })

  it('keeps a half-drawn edge when the three-second refresh lands', async () => {
    await mount(routes())
    await openListed()
    type('d-dep-id', 'ticket-2')
    choose('d-dep-on', 'ended')
    await tick(3000)
    expect(input('d-dep-id').value).toBe('ticket-2')
    expect(input('d-dep-on').value).toBe('ended')
  })
})

describe('历史，everything that happened to it', () => {
  it('lists the facts newest first, with who caused each and what they said', async () => {
    await mount(routes({
      'GET tickets/ticket-1/events': {
        count: 3, returned: 3,
        events: [
          event({ seq: 3, at: LATER, type: 'rescued', by: { kind: 'system', id: 'watchdog' }, detail: { why: 'worker 卡住了' } }),
          event({ seq: 2, at: LATER, type: 'input', by: { kind: 'person', id: 'operator' }, detail: { text: '用第二个口径' } }),
          event({ seq: 1, type: 'created' }),
        ],
      },
    }))
    await openListed()
    const rows = all('#d-events .view > div')
    expect(rows).toHaveLength(3)
    // Newest first: the rescue is the top line, not the creation.
    expect(read(rows[0]!)).toContain('#3')
    expect(read(rows[0]!)).toContain('rescued')
    // `watchdog` and a rule's id are how you tell "the host restarted" from "myagent gave up waiting".
    expect(read(rows[0]!)).toContain('系统 · watchdog')
    expect(read(rows[0]!)).toContain('why: worker 卡住了')
    expect(read(rows[1]!)).toContain('人 · operator')
    expect(read(rows[1]!)).toContain('text: 用第二个口径')
    expect(read(rows[2]!)).toContain('#1')
    expect(read(rows[2]!)).toContain('created')
    expect(text('d-events')).toContain('共 3 条 · 已显示 3 条 · 最新在前')
  })

  it('reads more history when the operator asks, rather than cutting it off silently', async () => {
    const { last } = await mount(routes({
      'GET tickets/ticket-1/events': (call: Call) => ({
        count: 30, returned: Math.min(30, Number(call.query.get('limit'))), events: [],
      }),
    }))
    await openListed()
    expect(last('GET tickets/ticket-1/events')?.query.get('limit')).toBe('20')
    expect(text('d-events')).toContain('共 30 条 · 已显示 20 条')
    click(button('再读 20 条'))
    await settle()
    expect(last('GET tickets/ticket-1/events')?.query.get('limit')).toBe('40')
    expect(text('d-events')).toContain('已显示 30 条')
  })

  it('keeps the whole history the operator has read when a refresh lands', async () => {
    await mount(routes({
      'GET tickets/ticket-1/events': (call: Call) => ({
        count: 30, returned: Math.min(30, Number(call.query.get('limit'))), events: [event({ seq: 30 })],
      }),
    }))
    await openListed()
    expect(text('d-events')).toContain('已显示 20 条')
    click(button('再读 20 条'))
    await settle()
    expect(text('d-events')).toContain('已显示 30 条')
    // The widened limit survives the poll: the log does not snap back to twenty lines under the operator.
    await tick(3000)
    expect(text('d-events')).toContain('已显示 30 条')
    expect(all('#d-events button')).toHaveLength(0)
  })
})

describe('the header buttons', () => {
  it('pauses by sending the whole settings document, so nothing else about it changes', async () => {
    const { last } = await mount(routes({ 'PUT settings': { settings: settings({ paused: true }), settingsRevision: 4 } }))
    click(button('暂停 / 继续'))
    await settle()
    expect(last('PUT settings')?.body).toEqual(settings({ paused: true }))
    expect(toastText()).toBe('已暂停：不再启动新的工作')
  })

  it('resumes with the same click, and says which of the two it did', async () => {
    const { last } = await mount(routes({
      'GET state': state({ paused: true, settings: settings({ paused: true }) }),
      'PUT settings': { settings: settings(), settingsRevision: 4 },
    }))
    expect(text('mode')).toContain('已暂停')
    click(button('暂停 / 继续'))
    await settle()
    expect(last('PUT settings')?.body).toEqual(settings({ paused: false }))
    expect(toastText()).toBe('已继续')
  })

  it('runs a pass now, which is how the operator says "look again"', async () => {
    const { sent, last } = await mount(routes({ 'POST pass': { requested: true, effects: {} } }))
    click(button('立即执行一轮'))
    await settle()
    expect(sent('POST pass')).toHaveLength(1)
    expect(last('POST pass')?.body).toEqual({})
    expect(toastText()).toBe('已看过来源并跑了一轮')
  })

  it('creates the main Session on request and says what it is called', async () => {
    await mount(routes({
      'GET state': state({ mainSession: { exists: false, running: false, busy: false } }),
      'POST main-session': { sessionId: 'myagent-main' },
    }))
    click(button('创建主 Session'))
    await settle()
    expect(toastText()).toBe('主 Session 已创建：myagent-main')
  })

  it('says a header action failed instead of leaving the button looking as if it worked', async () => {
    await mount(routes({ 'POST pass': refuse(400, 'Processing is paused.') }))
    click(button('立即执行一轮'))
    await settle()
    expect(toastText()).toBe('Processing is paused.')
  })
})

describe('handing out work', () => {
  const openNew = async (): Promise<void> => {
    click(button('派活'))
    await settle()
  }

  it('offers what the installation ships, so a request is edited rather than written from nothing', async () => {
    await mount(routes())
    expect(all('#n-recipe option').map(node => node.textContent))
      .toEqual(['空白开始', '请求：月度数据报表', '排期：daily-digest.json'])
  })

  it('fills the form from the recipe the operator picked, and says which one it filled', async () => {
    await mount(routes())
    choose('n-recipe', '0')
    expect(input('n-title').value).toBe('月度数据报表')
    expect(area('n-request').value).toBe('合成一份月度报表，写到 report.md。')
    expect(area('n-scope').value).toBe('只读 data/')
    expect(text('n-recipe-hint')).toBe('已填入 data-report.md，改完再创建。')
  })

  it('carries a schedule recipe to the schedule editor, because that is the page it belongs on', async () => {
    await mount(scheduleRoutes())
    choose('n-recipe', '1')
    await settle()
    expect(byId('tab-schedules').classList.contains('hidden')).toBe(false)
    expect(byId('tab-new').classList.contains('hidden')).toBe(true)
    expect(text('sched-editor-title')).toBe('编辑排期：digest-copy')
    expect(input('s-id').value).toBe('digest-copy')
    expect(area('s-prompt').value).toBe('产出今天的摘要，写到 report.md')
    expect(text('n-recipe-hint')).toContain('标识加了 -copy')
  })

  it('refuses to hand out work with nothing in it', async () => {
    const { sent } = await mount(routes())
    await openNew()
    click(button('创建 Ticket'))
    expect(toastText()).toBe('标题和要做的事都得填')
    expect(sent('POST tickets')).toHaveLength(0)
  })

  it('sends the request the operator wrote, and no attachments key when they added none', async () => {
    const { last } = await mount(routes({ 'POST tickets': { stored: false, disposition: 'ignored', reason: 'sender_not_allowed', acceptMode: 'auto' } }))
    await openNew()
    type('n-title', '整理本周竞品动态')
    type('n-request', '产出 report.md，写清涨价、换供应商、停止海外发货三件事')
    type('n-scope', '只读 data/')
    click(button('创建 Ticket'))
    await settle()
    // The body went through JSON, so a key sent with no value would still be a key: this is the whole body.
    expect(Object.keys(last('POST tickets')!.body as object)).toEqual(['title', 'request', 'scope'])
    expect(last('POST tickets')?.body).toEqual({
      title: '整理本周竞品动态', request: '产出 report.md，写清涨价、换供应商、停止海外发货三件事', scope: '只读 data/',
    })
  })

  it('sends the paths the operator typed, trimmed, and drops the rows they left empty', async () => {
    const { last } = await mount(routes({ 'POST tickets': { stored: false, disposition: 'ignored', reason: 'sender_not_allowed' } }))
    await openNew()
    type('n-title', '整理本周竞品动态')
    type('n-request', '产出 report.md')
    click(button('加一个文件'))
    click(button('加一个文件'))
    click(button('加一个文件'))
    const paths = all('#n-attachments input')
    expect(paths).toHaveLength(3)
    fill(paths[0]!, '  /inbox/需求.md  ')
    fill(paths[2]!, '/tmp/data.csv')
    click(button('创建 Ticket'))
    await settle()
    expect((last('POST tickets')?.body as { attachments: string[] }).attachments).toEqual(['/inbox/需求.md', '/tmp/data.csv'])
  })

  it('takes an attachment row back out when the operator changes their mind', async () => {
    const { last } = await mount(routes({ 'POST tickets': { stored: false, disposition: 'ignored', reason: 'sender_not_allowed' } }))
    await openNew()
    type('n-title', '整理本周竞品动态')
    type('n-request', '产出 report.md')
    click(button('加一个文件'))
    click(button('加一个文件'))
    const rows = all('#n-attachments .row')
    fill(one('input', rows[0]!), '/inbox/需求.md')
    fill(one('input', rows[1]!), '/tmp/data.csv')
    click(button('去掉', rows[0]!))
    expect(all('#n-attachments input')).toHaveLength(1)
    expect(valueOf(one('#n-attachments input'))).toBe('/tmp/data.csv')
    click(button('创建 Ticket'))
    await settle()
    expect((last('POST tickets')?.body as { attachments: string[] }).attachments).toEqual(['/tmp/data.csv'])
  })

  it('takes the operator to the Ticket they just handed out, with the form ready for the next one', async () => {
    const { sent } = await mount(routes({
      'POST tickets': { stored: true, disposition: 'accepted', ticketId: 'ticket-9', acceptMode: 'auto' },
      'GET tickets/ticket-9': ticket({ id: 'ticket-9', title: '整理本周竞品动态' }),
      'GET tickets/ticket-9/progress': progress({ sessionId: 'myagent-ticket-9' }),
      'GET tickets/ticket-9/files': files({ directory: '/work/ticket-9' }),
    }))
    await openNew()
    type('n-title', '整理本周竞品动态')
    type('n-request', '产出 report.md')
    click(button('加一个文件'))
    click(button('创建 Ticket'))
    await settle()
    expect(toastText()).toBe('已开 Ticket ticket-9')
    expect(byId('tab-tickets').classList.contains('hidden')).toBe(false)
    expect(sent('GET tickets/ticket-9')).toHaveLength(1)
    expect(text('detail')).toContain('整理本周竞品动态')
    expect(input('n-title').value).toBe('')
    expect(all('#n-attachments input')).toHaveLength(0)
  })

  it('says what the gate decided when it opened no Ticket, so observe mode is not mistaken for a run', async () => {
    await mount(routes({ 'POST tickets': { stored: true, disposition: 'observed', reason: 'observed', detail: '受理模式是 observe', acceptMode: 'observe' } }))
    await openNew()
    type('n-title', '整理本周竞品动态')
    type('n-request', '产出 report.md')
    click(button('创建 Ticket'))
    await settle()
    expect(toastText()).toBe('已记录：observed（observed）')
    expect(text('new-result')).toContain('"disposition": "observed"')
    // The operator stays on the form: there is no Ticket to look at.
    expect(byId('tab-new').classList.contains('hidden')).toBe(false)
  })

  it('shows the server refusing a request in the form the operator is looking at', async () => {
    await mount(routes({ 'POST tickets': refuse(400, 'Invalid request: title') }))
    await openNew()
    type('n-title', '整理本周竞品动态')
    type('n-request', '产出 report.md')
    click(button('创建 Ticket'))
    await settle()
    expect(text('new-result')).toBe('Invalid request: title')
  })
})

describe('schedules', () => {
  const openSchedules = async (): Promise<void> => {
    click(button('排期'))
    await settle()
  }

  it('lists every schedule in words, with the next run beside it', async () => {
    await mount(scheduleRoutes({
      'GET schedules': {
        zone: 'Asia/Shanghai', now: AT, lastTriggerAt: AT,
        schedules: [
          scheduleView(),
          scheduleView({
            id: 'weekly-report', name: '每周报表', enabled: false, next: undefined, describe: '每周一 09:00',
            timing: { kind: 'weekly', time: '09:00', weekdays: [1] },
          }),
        ],
      },
    }))
    await openSchedules()
    expect(text('sched-zone')).toBe('Asia/Shanghai')
    expect(text('sched-last')).toContain('2026')
    const [enabled, disabled] = all('#schedules li')
    expect(read(one('.stage', enabled!))).toBe('启用')
    expect(read(enabled!)).toContain('每天 09:00')
    expect(read(enabled!)).toContain('标识 digest')
    expect(read(enabled!)).toMatch(/下次 \D*\d/)
    expect(read(one('.stage', disabled!))).toBe('停用')
    expect(read(disabled!)).toContain('不会触发')
    expect(read(disabled!)).not.toContain('下次 ')
  })

  it('says there are no schedules yet, in a sentence', async () => {
    await mount(scheduleRoutes({ 'GET schedules': { zone: 'Asia/Shanghai', now: AT, schedules: [] } }))
    await openSchedules()
    expect(text('schedules')).toBe('还没有排期。')
    expect(text('sched-last')).toBe('还没有')
  })

  it('saves a schedule the server will accept, with nothing on it that only a view needs', async () => {
    const untouched = scheduleView({
      id: 'weekly-report', name: '每周报表', prompt: '每周一产出上一周的报表', scope: '',
      describe: '每周一 09:00', timing: { kind: 'weekly', time: '09:00', weekdays: [1] },
    })
    const { sent, last } = await mount(scheduleRoutes({
      'GET schedules': { zone: 'Asia/Shanghai', now: AT, lastTriggerAt: AT, schedules: [scheduleView(), untouched] },
    }))
    await openSchedules()
    click(button('编辑', scheduleRow('digest')))
    await settle()
    type('s-prompt', '产出今天的摘要，写到 report.md，并列出用到的来源')
    click(button('保存', byId('sched-editor')))
    await settle()
    // The server is asked what the draft would do before anything is stored.
    expect(sent('POST schedules/preview')).toHaveLength(1)
    expect(sent('PUT settings')).toHaveLength(1)
    const saved = savedSchedules(last('PUT settings'))
    // `describe`, `next` and `zone` are computed for a reader, and the schema is strict enough to refuse a document
    // carrying them — including on the schedule nobody touched, which is written again because the whole document is.
    for (const entry of saved) {
      expect(Object.keys(entry).sort()).toEqual(['enabled', 'id', 'name', 'prompt', 'scope', 'timing'])
    }
    expect(saved).toEqual([
      { ...scheduleRecord(), prompt: '产出今天的摘要，写到 report.md，并列出用到的来源' },
      { id: 'weekly-report', name: '每周报表', enabled: true, prompt: '每周一产出上一周的报表', scope: '', timing: { kind: 'weekly', time: '09:00', weekdays: [1] } },
    ])
    expect(last('PUT settings')?.body).toEqual(settingsWith(saved))
    expect(toastText()).toBe('排期已保存')
    expect(byId('sched-editor').classList.contains('hidden')).toBe(true)
  })

  it('will not let the operator rename a schedule, because the id is where its next run is remembered', async () => {
    await mount(scheduleRoutes())
    await openSchedules()
    click(button('编辑', scheduleRow('digest')))
    await settle()
    expect(input('s-id').readOnly).toBe(true)
    expect(text('s-id-hint')).toContain('编辑时不可改')
  })

  it('builds a new schedule from the fields the operator fills in, id included', async () => {
    const { last } = await mount(scheduleRoutes())
    await openSchedules()
    click(button('新建排期'))
    await settle()
    expect(input('s-id').readOnly).toBe(false)
    expect(input('s-id').value).toBe('sched-2')
    expect(text('s-id-hint')).toContain('小写字母开头')
    type('s-id', 'weekly-report')
    type('s-name', '每周报表')
    type('s-prompt', '每周一产出上一周的报表')
    click(button('保存', byId('sched-editor')))
    await settle()
    expect(savedSchedules(last('PUT settings'))).toEqual([
      scheduleRecord(),
      { id: 'weekly-report', name: '每周报表', enabled: true, prompt: '每周一产出上一周的报表', scope: '', timing: { kind: 'daily', time: '09:00' } },
    ])
    expect(toastText()).toBe('排期已新建')
  })

  it('sends the days the operator ticked for a weekly schedule, and no others', async () => {
    const { last } = await mount(scheduleRoutes())
    await openSchedules()
    click(button('新建排期'))
    await settle()
    choose('s-kind', 'weekly')
    const days = all('.s-day').map(node => node as HTMLInputElement)
    expect(days.map(day => day.value)).toEqual(['1', '2', '3', '4', '5', '6', '7'])
    expect(days.map(day => day.checked)).toEqual([true, true, true, true, true, false, false])
    click(days[4]!)
    click(days[5]!)
    type('s-id', 'weekly-report')
    type('s-prompt', '每周一产出上一周的报表')
    click(button('保存', byId('sched-editor')))
    await settle()
    expect(savedSchedules(last('PUT settings'))[1]!.timing).toEqual({ kind: 'weekly', time: '09:00', weekdays: [1, 2, 3, 4, 6] })
  })

  it('sends a cron expression and the zone the operator gave, and no zone when they gave none', async () => {
    const { last } = await mount(scheduleRoutes())
    await openSchedules()
    click(button('新建排期'))
    await settle()
    choose('s-kind', 'cron')
    expect(input('s-expr').value).toBe('0 9 * * 1-5')
    expect(input('s-zone-c').placeholder).toBe('Asia/Shanghai')
    type('s-expr', ' */15 9-17 * * 1-5 ')
    type('s-zone-c', ' UTC ')
    type('s-id', 'office-hours')
    type('s-prompt', '工作时间内每十五分钟看一眼收件目录')
    click(button('保存', byId('sched-editor')))
    await settle()
    expect(savedSchedules(last('PUT settings'))[1]!.timing).toEqual({ kind: 'cron', expression: '*/15 9-17 * * 1-5', timeZone: 'UTC' })

    // The stored schedule this page was given has no zone, and an empty one must not be invented for it.
    click(button('编辑', scheduleRow('digest')))
    await settle()
    expect(input('s-zone').value).toBe('')
    click(button('保存', byId('sched-editor')))
    await settle()
    expect(Object.keys(savedSchedules(last('PUT settings'))[0]!.timing as object)).toEqual(['kind', 'time'])
  })

  it('sends the interval the operator typed, in the seconds the schema asks for', async () => {
    const { last } = await mount(scheduleRoutes())
    await openSchedules()
    click(button('新建排期'))
    await settle()
    choose('s-kind', 'every')
    expect(input('s-seconds').value).toBe('3600')
    expect(input('s-seconds').min).toBe('60')
    expect(input('s-seconds').max).toBe(String(30 * 86_400))
    type('s-seconds', '900')
    type('s-id', 'poll-inbox')
    type('s-prompt', '看一眼收件目录')
    click(button('保存', byId('sched-editor')))
    await settle()
    expect(savedSchedules(last('PUT settings'))[1]!.timing).toEqual({ kind: 'every', seconds: 900 })
  })

  it('shows what the server makes of a draft, before anything is stored', async () => {
    const { sent } = await mount(scheduleRoutes())
    await openSchedules()
    click(button('新建排期'))
    await settle()
    click(button('预览下次触发', byId('sched-editor')))
    await settle()
    // The description comes back from the server, computed from the draft the panel sent it.
    expect(text('sched-preview-out')).toContain('每天 09:00')
    expect(text('sched-preview-out').split('\n')).toHaveLength(5)
    expect(sent('PUT settings')).toHaveLength(0)
  })

  it('shows the server refusing a schedule and stores nothing', async () => {
    const { sent } = await mount(scheduleRoutes({
      'POST schedules/preview': refuse(400, 'That schedule cannot be used: a time needs HH:mm or HH:mm:ss'),
    }))
    await openSchedules()
    click(button('新建排期'))
    await settle()
    click(button('保存', byId('sched-editor')))
    await settle()
    expect(text('sched-error')).toBe('That schedule cannot be used: a time needs HH:mm or HH:mm:ss')
    expect(sent('PUT settings')).toHaveLength(0)
    expect(byId('sched-editor').classList.contains('hidden')).toBe(false)
  })

  it('deletes a schedule on a second click, and says first what deleting costs', async () => {
    const { sent, last } = await mount(scheduleRoutes())
    await openSchedules()
    click(button('删除', scheduleRow('digest')))
    expect(sent('PUT settings')).toHaveLength(0)
    expect(read(scheduleRow('digest'))).toContain('删除 digest？它已记的下次触发会一起丢掉。')
    click(button('取消', scheduleRow('digest')))
    expect(sent('PUT settings')).toHaveLength(0)
    expect(read(scheduleRow('digest'))).not.toContain('确认删除')
    click(button('删除', scheduleRow('digest')))
    click(button('确认删除', scheduleRow('digest')))
    await settle()
    expect(savedSchedules(last('PUT settings'))).toEqual([])
    expect(toastText()).toBe('已删除')
  })

  it('turns a schedule off in place, changing nothing else about it', async () => {
    const { last } = await mount(scheduleRoutes())
    await openSchedules()
    click(button('停用', scheduleRow('digest')))
    await settle()
    expect(savedSchedules(last('PUT settings'))).toEqual([{ ...scheduleRecord(), enabled: false }])
    expect(toastText()).toBe('已停用')
  })

  it('shows a settings document the server refused, and keeps the list it had', async () => {
    await mount(scheduleRoutes({ 'PUT settings': refuse(400, 'Invalid settings: sources.cron.schedules') }))
    await openSchedules()
    click(button('停用', scheduleRow('digest')))
    await settle()
    expect(toastText()).toBe('Invalid settings: sources.cron.schedules')
    expect(read(one('.stage', scheduleRow('digest')))).toBe('启用')
  })
})

describe('where work comes from', () => {
  const openSources = async (): Promise<void> => {
    click(button('来源'))
    await settle()
  }

  it('draws the sources, the health and the queue as tables, not as JSON', async () => {
    await mount(routes({ 'GET effects': { counts: { notify: 2, launch: 1 } } }))
    await openSources()
    for (const id of ['sources', 'health-detail', 'effects']) {
      expect(all(`#${id} table.plain`), id).toHaveLength(1)
      expect(text(id), id).not.toMatch(/[[{}"]/)
    }
    expect(all('#sources th').map(node => node.textContent)).toEqual(['来源', '状态', '详情', '下次', '最近触发', '计数'])
    const cron = all('#sources tbody tr')[0]!
    expect(read(one('.ok', cron))).toBe('正常')
    expect(read(cron)).toContain('1 条排期')
    expect(read(cron)).toContain('schedules 1')
    // A Source reports its next run as an instant, and a person reads it as a date in their own zone.
    expect(read(cron)).toContain('2026')
    const inbox = all('#sources tbody tr')[1]!
    expect(read(inbox)).toContain('看着 /inbox')
    // A Source that has never fired says so, instead of leaving a cell the operator has to interpret.
    expect(read(inbox)).toContain('还没有')
    expect(all('#health-detail th').map(node => node.textContent)).toEqual(['部件', '状态', '详情', '时间'])
    expect(all('#effects tbody tr').map(node => node.textContent)).toEqual(['notify2', 'launch1'])
    expect(text('effects-note')).toContain('退避重试')
  })

  it('says the queue is empty in a sentence, because an empty queue is the good case', async () => {
    await mount(routes())
    await openSources()
    expect(text('effects')).toBe('队列是空的：没有等着做的事。')
    expect(text('effects-note')).toBe('')
    expect(all('#effects table')).toHaveLength(0)
  })

  it('marks a Source that is not working, and the part that reported a problem', async () => {
    await mount(routes({
      'GET state': state({
        sources: { cron: { ok: false, detail: '排期解析失败：digest', counts: {} } },
        health: { cron: { ok: false, detail: '排期解析失败：digest', at: LATER }, executor: { ok: true, detail: '正常', at: LATER } },
      }),
    }))
    await openSources()
    expect(read(one('#sources .bad'))).toBe('异常')
    expect(text('sources')).toContain('排期解析失败：digest')
    expect(read(one('#health-detail .bad'))).toBe('有问题')
    expect(text('health')).toBe('状态 1 个问题')
  })

  it('says the queue could not be read, where the queue would have been', async () => {
    await mount(routes({ 'GET effects': refuse(500, '数据库锁住了') }))
    await openSources()
    expect(read(one('#effects pre.bad'))).toBe('数据库锁住了')
  })
})

describe('what the gate decided', () => {
  const DECISIONS = {
    count: 2,
    decisions: [
      {
        id: 'decision-1', triggerId: 'trigger-7', outcome: 'accept', at: LATER, reason: 'accepted',
        reasonText: 'The gate admitted this request.', ticketId: 'ticket-1', policyVersion: 'pv-9f3c',
        title: '整理本周竞品动态',
      },
      {
        id: 'decision-2', triggerId: 'trigger-8', outcome: 'ignore', at: LATER, reason: 'sender_not_allowed',
        reasonText: 'The sender may not originate work here.', detail: 'sender "stranger" is not on the list',
        ticketId: 'ticket-2', policyVersion: 'pv-9f3c', title: '陌生人的请求',
      },
    ],
  }
  const refused = DECISIONS.decisions[1]!
  const openDecisions = async (): Promise<void> => {
    click(button('门禁记录'))
    await settle()
  }
  const decisionRow = (title: string): Element => {
    const row = all('#decisions li').find(node => (node.textContent ?? '').includes(title))
    if (row === undefined) throw new Error(`the decision list has no row for ${title}`)
    return row
  }

  it('lists what the gate decided, with a way to put a refusal away', async () => {
    await mount(routes({ 'GET decisions': DECISIONS }))
    await openDecisions()
    expect(all('#decisions li')).toHaveLength(2)
    const accepted = decisionRow('整理本周竞品动态')
    expect(read(one('.done', accepted))).toBe('accept')
    expect(read(accepted)).toContain('2026')
    // An accepted request is not a refusal, so there is nothing to put away.
    expect(all('button', accepted)).toHaveLength(0)
    const ignored = decisionRow('陌生人的请求')
    expect(read(one('.bad', ignored))).toBe('ignore')
    expect(read(ignored)).toContain('sender "stranger" is not on the list')
    expect(all('button', ignored).map(node => node.textContent)).toEqual(['忽略'])
  })

  /**
   * The server computes `reasonText` for exactly this list — `decisionView` feeds no other caller — and `GATE_REASONS`
   * is documented as "the fixed codes the gate answers with; the panel words each of them". The list prints the code
   * instead, so an operator reads `sender_not_allowed` where the sentence the system already wrote would go.
   */
  it('words why the gate refused, instead of showing its internal code', async () => {
    await mount(routes({ 'GET decisions': DECISIONS }))
    await openDecisions()
    const ignored = decisionRow('陌生人的请求')
    expect(read(ignored)).toContain('The sender may not originate work here.')
    expect(read(ignored)).not.toContain('sender_not_allowed')
  })

  it('says there are no decisions yet, in a sentence', async () => {
    await mount(routes({ 'GET decisions': { count: 0, decisions: [] } }))
    await openDecisions()
    expect(text('decisions')).toBe('还没有判定。')
  })

  it('lets the operator put away a refusal they have looked at, without opening the Ticket behind it', async () => {
    const { sent, last } = await mount(routes({
      'GET decisions': DECISIONS,
      'POST decisions/decision-2/dismiss': { dismissed: 'decision-2', decision: { ...refused, detail: `${refused.detail}\n[dismissed]` } },
    }))
    await openDecisions()
    click(button('忽略', decisionRow('陌生人的请求')))
    await settle()
    expect(last('POST decisions/decision-2/dismiss')?.body).toEqual({})
    expect(toastText()).toBe('已忽略')
    // The row is also a way into its Ticket, so a click on 忽略 must not be read as a click on the row.
    expect(sent('GET tickets/ticket-2')).toHaveLength(0)
    // The list is read again, which is how the row learns it has been put away.
    expect(sent('GET decisions')).toHaveLength(2)
  })

  it('marks a refusal that has been put away, and does not ask the server again', async () => {
    const { sent } = await mount(routes({ 'GET decisions': { count: 1, decisions: [{ ...refused, detail: `${refused.detail}\n[dismissed]` }] } }))
    await openDecisions()
    click(button('已忽略', decisionRow('陌生人的请求')))
    await settle()
    expect(toastText()).toBe('这条已经忽略过了')
    expect(sent('POST decisions/decision-2/dismiss')).toHaveLength(0)
  })

  /**
   * A decision row is clickable for one reason: to get to the Ticket it opened. The page renders that Ticket into
   * `#detail`, which lives on the Ticket page — and it never shows that page, unlike a deep link and a newly created
   * Ticket, which both do. So the operator clicks and the screen does not change.
   */
  it('takes the operator to the Ticket a decision opened', async () => {
    await mount(routes({ 'GET decisions': DECISIONS }))
    await openDecisions()
    click(decisionRow('整理本周竞品动态'))
    await settle()
    expect(byId('tab-tickets').classList.contains('hidden')).toBe(false)
    expect(text('detail')).toContain('整理本周竞品动态')
  })
})

describe('settings and prompts', () => {
  const PROMPTS = {
    revision: 2, maxChars: 20_000,
    roles: [
      { role: 'worker', current: '自定义的 worker 文本', base: '内置的 worker 文本', override: '自定义的 worker 文本', pinsBase: false },
      { role: 'orchestrator', current: '内置的 orchestrator 文本', base: '内置的 orchestrator 文本', override: undefined, pinsBase: false },
    ],
  }
  const openSettings = async (): Promise<void> => {
    click(button('设置'))
    await settle()
  }
  const openPrompts = async (): Promise<void> => {
    click(button('提示词'))
    await settle()
  }

  it('shows the settings document the server has, at the revision it came from', async () => {
    await mount(routes())
    await openSettings()
    expect(JSON.parse(area('settings').value)).toEqual(settings())
    expect(text('settings-revision')).toBe('修订 3')
    expect(text('settings-error')).toBe('')
  })

  it('refuses to send settings that are not JSON, and says so instead of guessing', async () => {
    const { sent } = await mount(routes())
    await openSettings()
    type('settings', '{"acceptMode": ')
    click(button('保存', byId('tab-settings')))
    await settle()
    expect(text('settings-error')).toContain('不是合法 JSON')
    expect(sent('PUT settings')).toHaveLength(0)
  })

  it('sends the whole document the operator edited, and reads the system again after', async () => {
    const { sent, last } = await mount(routes({ 'PUT settings': { settings: settings({ paused: true }), settingsRevision: 4 } }))
    await openSettings()
    type('settings', JSON.stringify(settings({ paused: true }), null, 2))
    click(button('保存', byId('tab-settings')))
    await settle()
    expect(last('PUT settings')?.body).toEqual(settings({ paused: true }))
    expect(toastText()).toBe('设置已保存并生效')
    // The header reads the same settings, so it has to be told about the ones that were just stored.
    expect(sent('GET state')).toHaveLength(2)
  })

  it('shows the server refusing a settings document, naming what it refused', async () => {
    const { sent } = await mount(routes({ 'PUT settings': refuse(400, 'Invalid settings: executor.maxWorkers') }))
    await openSettings()
    type('settings', JSON.stringify(settings({ executor: { maxWorkers: 99, prepare: '', model: '' } })))
    click(button('保存', byId('tab-settings')))
    await settle()
    expect(text('settings-error')).toBe('Invalid settings: executor.maxWorkers')
    expect(sent('GET state')).toHaveLength(1)
  })

  it('puts the server\'s settings back in the box when the operator starts over', async () => {
    await mount(routes())
    await openSettings()
    type('settings', '{}')
    click(button('重新读取'))
    expect(JSON.parse(area('settings').value)).toEqual(settings())
    expect(text('settings-revision')).toBe('修订 3')
  })

  it('shows what each role runs now, with the built-in text as the placeholder', async () => {
    await mount(routes({ 'GET prompts': PROMPTS }))
    await openPrompts()
    expect(area('p-worker').value).toBe('自定义的 worker 文本')
    expect(area('p-worker').placeholder).toBe('内置的 worker 文本')
    // An empty box means "use the built-in text", and the placeholder is where the operator reads what that is.
    expect(area('p-orchestrator').value).toBe('')
    expect(area('p-orchestrator').placeholder).toBe('内置的 orchestrator 文本')
    expect(text('prompt-revision')).toContain('修订 2 · 上限 20000 字符 · 留空即用内置文本')
    expect(text('prompt-error')).toBe('')
  })

  it('warns when an override only repeats the built-in text, because that pins the role to it', async () => {
    await mount(routes({ 'GET prompts': { ...PROMPTS, roles: [{ ...PROMPTS.roles[0]!, pinsBase: true }, PROMPTS.roles[1]!] } }))
    await openPrompts()
    expect(text('prompt-revision')).toContain('注意：worker 的覆盖与内置文本相同，会把该角色钉在当前版本上')
  })

  it('saves both prompts, and can put the built-in text back', async () => {
    const { sent, last } = await mount(routes({ 'GET prompts': PROMPTS, 'PUT prompts': { revision: 3 } }))
    await openPrompts()
    type('p-worker', '别写别处')
    click(button('保存', byId('tab-prompts')))
    await settle()
    expect(last('PUT prompts')?.body).toEqual({ worker: '别写别处', orchestrator: '' })
    expect(toastText()).toBe('提示词已保存（修订 3）')
    click(button('恢复内置'))
    await settle()
    expect(last('PUT prompts')?.body).toEqual({ worker: '', orchestrator: '' })
    expect(toastText()).toBe('已恢复内置提示词')
    // Both boxes are read back from the server, so what is on screen is what is stored.
    expect(sent('GET prompts')).toHaveLength(3)
  })

  it('shows a prompt conflict rather than pretending the save worked', async () => {
    await mount(routes({ 'GET prompts': PROMPTS, 'PUT prompts': refuse(409, 'Another change landed first; reload and try again') }))
    await openPrompts()
    type('p-worker', '别写别处')
    click(button('保存', byId('tab-prompts')))
    await settle()
    expect(text('prompt-error')).toBe('Another change landed first; reload and try again')
  })
})

describe('when the server refuses', () => {
  it('says the system could not be read at all, instead of leaving a panel of dashes', async () => {
    await mount(routes({ 'GET state': refuse(500, '状态目录不可读') }))
    expect(toastText()).toBe('状态目录不可读')
    expect(text('mode')).toBe('受理模式 —')
    expect(text('counts')).toBe('Ticket —')
  })

  it('says the Ticket list could not be read', async () => {
    await mount(routes({ 'GET tickets': refuse(500, '数据库锁住了') }))
    expect(toastText()).toBe('数据库锁住了')
  })

  it('says the Ticket it was asked for is gone, where the detail would have been', async () => {
    await mount(routes({ 'GET tickets/ticket-1': refuse(404, 'There is no Ticket ticket-1') }))
    await openListed()
    expect(read(one('#detail pre.bad'))).toBe('There is no Ticket ticket-1')
  })

  it('says the live view could not be read, next to the part that failed', async () => {
    await mount(routes({
      'GET tickets/ticket-1/progress': refuse(500, 'Session 日志读不出来'),
      'GET tickets/ticket-1/files': refuse(500, '目录读不出来'),
    }))
    await openListed()
    expect(read(one('#d-progress pre.bad'))).toBe('Session 日志读不出来')
    expect(read(one('#d-files pre.bad'))).toBe('目录读不出来')
  })

  it('leaves the last good detail on screen when one poll fails, rather than blanking it', async () => {
    let asked = 0
    await mount(routes({
      'GET tickets/ticket-1': () => {
        asked += 1
        return asked === 1 ? ticket() : refuse(500, '一次超时')
      },
    }))
    await openListed()
    expect(text('detail')).toContain('整理本周竞品动态')
    await tick(3000)
    expect(text('detail')).toContain('整理本周竞品动态')
    expect(all('#detail pre.bad')).toHaveLength(0)
    // The next poll is tried anyway, so a failure that was transient heals without the operator doing anything.
    await tick(3000)
    expect(asked).toBe(3)
  })
})

describe('the page itself', () => {
  it('opens no native dialog: every question it asks is on the page', () => {
    // The page's own comments name prompt() and confirm() to say it avoids them, so this reads its code, not those.
    expect(CODE).not.toMatch(/(?:alert|confirm|prompt)\s*\(/)
  })
})

describe('a host whose plugin is older than the page', () => {
  /**
   * The page is read from disk on every request and the plugin is not, so an operator who saves this file without
   * reloading the bundle gets exactly this: a page asking for routes the host has never heard of. Every answer below is
   * the route table's own wording, which is the only thing that distinguishes "older plugin" from "broken host".
   */
  const noRoute = (path: string): Refusal => refuse(404, `No route for GET /myagent/api/${path}`)
  const OLD = (over: Routes = {}): Routes => routes({
    'GET projects': noRoute('projects'),
    'GET works': noRoute('works'),
    'GET tickets/ticket-1/dependencies': noRoute('tickets/ticket-1/dependencies'),
    'GET tickets/ticket-1/events': noRoute('tickets/ticket-1/events'),
    ...over,
  })

  it('says once, at the top, that the plugin has to be reloaded', async () => {
    await mount(OLD())
    expect(byId('v2-banner').classList.contains('hidden')).toBe(false)
    expect(text('v2-banner')).toContain('宿主机上的 myagent 插件比这个页面旧')
    expect(text('v2-banner')).toContain('重新载入插件')
  })

  it('asks nothing further of the routes it now knows are missing', async () => {
    const { sent } = await mount(OLD())
    expect(sent('GET projects')).toHaveLength(1)
    await tick(10_000)
    // One probe, then silence: repeating a question the host cannot answer is the harm, not the missing feature.
    expect(sent('GET projects')).toHaveLength(1)
    expect(sent('GET works')).toHaveLength(0)
    await openListed()
    expect(sent('GET tickets/ticket-1/dependencies')).toHaveLength(0)
    expect(sent('GET tickets/ticket-1/events')).toHaveLength(0)
    await tick(6000)
    expect(sent('GET tickets/ticket-1/dependencies')).toHaveLength(0)
    expect(sent('GET tickets/ticket-1/events')).toHaveLength(0)
    expect(sent('GET works')).toHaveLength(0)
  })

  it('keeps every section in place with one line, rather than a blank box or an error of its own', async () => {
    await mount(OLD())
    await openListed()
    expect(detailValue('归属')).toBe('读不到：插件比这个页面旧')
    // A control that can only fail is worse than no control, and the banner already says why.
    expect(all('#d-work')).toHaveLength(0)
    expect(all('#d-dep-id')).toHaveLength(0)
    expect(text('detail')).toContain('产物（—）')
    expect(text('d-dep-lists')).toContain('宿主的插件比这个页面旧')
    expect(text('d-events')).toContain('宿主的插件比这个页面旧')
    expect(all('#detail pre.bad')).toHaveLength(0)
    click(button('工作'))
    await settle()
    expect(text('projects')).toContain('宿主的插件比这个页面旧')
    expect(text('works')).toContain('宿主的插件比这个页面旧')
    expect(text('work-detail')).toContain('宿主的插件比这个页面旧')
    expect(all('#tab-works pre.bad')).toHaveLength(0)
  })

  it('keeps the rest of the panel working, and refreshing, because only the new routes are missing', async () => {
    const { sent } = await mount(OLD())
    expect(text('counts')).toBe('Ticket 2 进行中 · 1 等人 · 5 已结束')
    expect(text('tickets')).toContain('整理本周竞品动态')
    await tick(5000)
    expect(sent('GET state')).toHaveLength(2)
    expect(sent('GET tickets')).toHaveLength(2)
    await openListed()
    expect(text('detail')).toContain('整理本周竞品动态')
    expect(read(one('#d-progress .chip'))).toBe('worker Session myagent-ticket-1')
    expect(text('d-files')).toContain('/work/ticket-1')
  })

  it('does not toast about a missing route on every refresh', async () => {
    await mount(OLD())
    await tick(15_000)
    expect(toastText()).not.toContain('No route for')
    expect(byId('toast').classList.contains('show')).toBe(false)
  })

  it('reads the new routes again when the operator says the plugin has been reloaded', async () => {
    let asked = 0
    await mount(routes({
      'GET projects': () => {
        asked += 1
        return asked === 1 ? noRoute('projects') : { projects: [project()] }
      },
      'GET works': { works: [work()] },
    }))
    expect(byId('v2-banner').classList.contains('hidden')).toBe(false)
    click(button('重试', byId('v2-banner')))
    await settle()
    expect(asked).toBe(2)
    expect(byId('v2-banner').classList.contains('hidden')).toBe(true)
    click(button('工作'))
    await settle()
    expect(read(one('#projects li .title'))).toBe('竞品观察')
  })

  it('concludes nothing from a failure that is not about routes, and keeps working as before', async () => {
    // A locked database or a fence refusal says nothing about versions; reading "older" into it would hide sections on
    // a host that has them, which is the opposite failure and just as quiet.
    const { sent } = await mount(routes({ 'GET projects': refuse(500, '数据库锁住了') }))
    expect(byId('v2-banner').classList.contains('hidden')).toBe(true)
    await openListed()
    expect(sent('GET tickets/ticket-1/dependencies')).toHaveLength(1)
    expect(sent('GET tickets/ticket-1/events')).toHaveLength(1)
    expect(all('#d-work')).toHaveLength(1)
  })

  it('shows no banner and polls the new sections when the host does have the routes', async () => {
    const { sent } = await mount(routes({
      'GET projects': { projects: [project()] },
      'GET tickets/ticket-1/events': { count: 1, returned: 1, events: [event()] },
    }))
    expect(byId('v2-banner').classList.contains('hidden')).toBe(true)
    await openListed()
    expect(sent('GET tickets/ticket-1/dependencies')).toHaveLength(1)
    expect(sent('GET tickets/ticket-1/events')).toHaveLength(1)
    await tick(3000)
    expect(sent('GET tickets/ticket-1/dependencies')).toHaveLength(2)
    expect(sent('GET tickets/ticket-1/events')).toHaveLength(2)
  })
})

describe('the contract with the API', () => {
  /**
   * The route table of `src/app/http.ts`, which is the whole API this page may use. One of them, `GET triggers`, the
   * page never asks for: nothing on it renders a Trigger.
   */
  const SERVED = [
    'GET state', 'GET tickets', 'GET tickets/:id', 'POST tickets', 'POST tickets/:id/answer',
    'POST tickets/:id/note', 'POST tickets/:id/stop', 'POST tickets/:id/retry', 'POST decisions/:id/dismiss',
    'GET recipes', 'GET tickets/:id/progress', 'GET tickets/:id/files', 'GET tickets/:id/file', 'GET schedules',
    'POST schedules/preview', 'GET decisions', 'GET triggers', 'GET lost', 'PUT settings', 'GET prompts', 'PUT prompts',
    'POST pass', 'POST main-session', 'GET effects',
    'GET projects', 'POST projects', 'GET projects/:id', 'GET works', 'POST works', 'GET works/:id',
    'POST tickets/:id/work', 'GET tickets/:id/events', 'GET tickets/:id/dependencies',
    'POST tickets/:id/dependencies', 'POST tickets/:id/dependencies/drop',
  ]
  /** One call as a route of that table, with the record ids it carried turned back into parameters. */
  const routeOf = (call: Call): string => `${call.method} ${call.path
    .split('/')
    .map(part => /^(ticket|decision|trigger|assignment|policy|project|work)-/.test(part) ? ':id' : part)
    .join('/')}`

  it('asks only for routes the server has, so nothing it does can fail as a 404 nobody explains', async () => {
    const { calls } = await mount(scheduleRoutes({
      // With the lost view present, so the walkthrough reaches `GET lost`: a route in the table that the page never
      // asks for is the "quietly lost a feature" half of this test's own guarantee. The page gates that request on
      // `counts.lost` being there, which is also exactly how it degrades against a bundle that has neither.
      'GET state': state({
        mainSession: { exists: false, running: false, busy: false },
        counts: { ...(state().counts as Record<string, unknown>), lost: { rows: 1, payloads: 1 } },
      }),
      'GET lost': {
        total: 1, shown: 1, bounds: { keep: 20, chars: 1000 },
        rows: [{ id: 'trigger-lost-1', source: 'cron', kind: 'cron', at: AT, title: '把摘要发到群里', error: 'Error: gave up', effectKey: '6ce6093778b89681cb9170e23056e52f' }],
        payloads: [{ at: LATER, effectKey: '6ce6093778b89681cb9170e23056e52f', error: 'TypeError: null', chars: 30, payload: '{"id": "trigger-9", "source": ' }],
      },
      'GET decisions': { count: 1, decisions: [{ id: 'decision-1', triggerId: 'trigger-7', outcome: 'ignore', at: LATER, reason: 'sender_not_allowed', ticketId: 'ticket-1' }] },
      'POST decisions/decision-1/dismiss': { dismissed: 'decision-1' },
      'GET prompts': { revision: 1, maxChars: 20_000, roles: [{ role: 'worker', base: '内置', current: '内置' }] },
      'PUT prompts': { revision: 2 },
      'POST tickets': { stored: false, disposition: 'ignored', reason: 'sender_not_allowed' },
      'POST tickets/ticket-1/answer': ticket(),
      'POST tickets/ticket-1/note': ticket(),
      'POST tickets/ticket-1/retry': ticket(),
      'POST tickets/ticket-1/stop': ticket(),
      'GET tickets/ticket-1/file': served(),
      'POST pass': { requested: true, effects: {} },
      'POST main-session': { sessionId: 'myagent-main' },
      'GET projects': { projects: [project()] },
      'POST projects': project(),
      'GET projects/project-1': { project: project(), works: [work()] },
      'GET works': { works: [work()] },
      'POST works': work(),
      'GET works/work-1': { work: work(), tickets: [listed({ workId: 'work-1', workSeq: 1 })] },
      'POST tickets/ticket-1/work': ticket({ workId: 'work-1', workSeq: 1 }),
      'GET tickets/ticket-1/events': { count: 1, returned: 1, events: [event()] },
      'GET tickets/ticket-1/dependencies': { waitsFor: [dep()], waitedOnBy: [] },
      'POST tickets/ticket-1/dependencies': dep(),
      'POST tickets/ticket-1/dependencies/drop': { dropped: 'ticket-2', waitsFor: [] },
    }))
    // Every page, and the writes on them: the routes a person can reach by clicking around.
    for (const tab of ['工作', '派活', '门禁记录', '来源', '排期', '设置', '提示词']) {
      click(button(tab))
      await settle()
    }
    // The 工作 page: drill into a Project, make both records, then follow a Work down to one of its Tickets.
    click(one('#projects li'))
    await settle()
    type('pj-name', '竞品观察')
    click(button('新建项目'))
    await settle()
    type('wk-name', '周报')
    click(button('新建工作'))
    await settle()
    click(one('#work-detail .list li'))
    await settle()
    click(button('忽略', one('#decisions li')))
    await settle()
    click(button('门禁记录'))
    click(button('Ticket'))
    await settle()
    await openListed()
    click(button('报告.md'))
    await settle()
    choose('d-work', 'work-1')
    click(button('归入'))
    await settle()
    type('d-dep-id', 'ticket-2')
    choose('d-dep-on', 'ended')
    click(button('添加依赖'))
    await settle()
    click(button('删除', one('#d-dep-lists li')))
    click(button('确认删除', one('#d-dep-lists li')))
    await settle()
    type('d-answer', '用第二个口径')
    click(button('回答'))
    await settle()
    type('d-note', '财务那份是准的')
    click(button('备注'))
    await settle()
    click(button('重试本轮'))
    await settle()
    click(button('停止'))
    click(button('确认停止'))
    await settle()
    click(button('派活'))
    await settle()
    type('n-title', '整理本周竞品动态')
    type('n-request', '产出 report.md')
    click(button('创建 Ticket'))
    await settle()
    click(button('排期'))
    await settle()
    click(button('新建排期'))
    await settle()
    click(button('预览下次触发', byId('sched-editor')))
    type('s-id', 'poll-inbox')
    type('s-prompt', '看一眼收件目录')
    click(button('保存', byId('sched-editor')))
    await settle()
    click(button('停用', scheduleRow('digest')))
    await settle()
    click(button('删除', scheduleRow('digest')))
    click(button('确认删除', scheduleRow('digest')))
    await settle()
    click(button('设置'))
    await settle()
    click(button('保存', byId('tab-settings')))
    await settle()
    click(button('提示词'))
    await settle()
    click(button('保存', byId('tab-prompts')))
    click(button('恢复内置'))
    await settle()
    click(button('立即执行一轮'))
    click(button('创建主 Session'))
    await settle()

    const asked = [...new Set(calls.map(routeOf))].sort()
    // Exactly the table minus `GET triggers`: a route the page invented would answer 404 and read as a broken panel,
    // and a route it stopped asking for would be a page that quietly lost a feature.
    expect(asked).toEqual(SERVED.filter(route => route !== 'GET triggers').sort())
  })
})

describe('markup in a value the operator can edit', () => {
  // `escapeText` used to be `String(text ?? '')`: it did not escape at all while its name said it did, and the header
  // fed it straight into `innerHTML` from the settings document and the machine paths. Same-origin and self-inflicted,
  // so low severity — but the panel is the one surface an operator stares at all day, and a helper that promises a
  // guarantee it does not deliver is how the next person gets hurt.
  it('shows a state directory as text rather than as an element', async () => {
    await mount(routes({
      'GET state': state({
        machine: {
          stateDir: '/state/<img src=x onerror="document.title=\'pwned\'">',
          workRoot: '/work', inboxDir: '/inbox', mainSessionId: 'myagent-main',
        },
      }),
    }))
    // Not an element, and the handler never ran.
    expect(byId('paths').querySelector('img')).toBe(null)
    expect(document.title).not.toBe('pwned')
    // Shown as what it is, so the operator can see the value that is wrong rather than a hole where it was.
    expect(text('paths')).toContain('<img src=x')
  })

  it('leaves an ampersand alone where the text node already does the escaping', async () => {
    // The other half of the fix: six call sites build text nodes through `el()`, which is inert by construction.
    // Escaping there would show the operator `&amp;` where they wrote `&` — and slicing an escaped string can cut an
    // entity in half, so truncation happens on the raw text now.
    await mount(routes({
      'GET tickets': { offset: 0, limit: 80, count: 1, tickets: [listed({ summary: 'A & B < C' })] },
    }))
    expect(document.body.textContent).toContain('A & B < C')
    expect(document.body.textContent).not.toContain('&amp;')
  })
})

describe('the chat Source', () => {
  const openChat = async (): Promise<void> => {
    click(button('来源'))
    await settle()
  }

  /** What the operator's save put on the wire: the whole document, of which only the map may have changed. */
  const savedBody = (log: { last: (key: string) => Call | undefined }): Record<string, unknown> => {
    const body = log.last('PUT settings')?.body as Record<string, unknown> | undefined
    if (body === undefined) throw new Error('the panel never saved a settings document')
    return body
  }
  const savedChat = (body: Record<string, unknown>): Record<string, unknown> =>
    ((body.sources as Record<string, unknown>).chat) as Record<string, unknown>

  const chatRoutes = (over: Routes = {}): Routes => routes({
    'GET state': chatState(),
    'PUT settings': { settings: chatDocument(), settingsRevision: 4 },
    'POST pass': { requested: true, effects: {} },
    ...over,
  })

  it('shows what the Source is doing, which directories it reads, and who it accepts', async () => {
    await mount(chatRoutes({
      'GET state': chatState({
        settings: chatDocument({
          channels: [
            { id: 'ops', directory: '/chat/ops', enabled: true },
            { id: 'archive', directory: '/chat/archive', enabled: false },
          ],
        }),
        sources: { chat: chatStatus({ detail: '2 channel(s), 1 waiting (unmapped)' }) },
      }),
    }))
    await openChat()
    expect(text('chat')).toContain('已启用')
    expect(text('chat')).toContain('受理模式 auto')
    // The allow-list is on this surface because it, not the map, decides whether a mapped identity may ask at all.
    expect(text('chat')).toContain('allowedSenders operator、alice')
    expect(text('chat')).toContain('2 channel(s), 1 waiting (unmapped)')
    expect(text('chat')).toContain('最近触发')

    const tables = all('#chat table.plain')
    expect(tables).toHaveLength(2)
    // Tables rather than JSON, which is the standing complaint these three sections were rebuilt for.
    for (const node of tables) expect(read(node), read(node)).not.toMatch(/[[{}"]/)
    expect(all('th', tables[0]!).map(node => node.textContent)).toEqual(['频道', '目录', '状态'])
    expect(read(all('tbody tr', tables[0]!)[0]!)).toContain('/chat/ops')
    // A channel that is switched off is neither read nor answered, and that is worth more than a missing row.
    expect(read(all('tbody tr', tables[0]!)[1]!)).toContain('停用（不读，也不回）')
    expect(all('th', tables[1]!).map(node => node.textContent)).toEqual(['平台 id', '发起者', '备注', '门禁', ''])
    expect(read(identityRow('U01ABCDEF'))).toContain('alice')
    expect(read(identityRow('U01ABCDEF'))).toContain('操作者本人')
    expect(read(one('.ok', identityRow('U01ABCDEF')))).toBe('会受理')
  })

  it('lists the messages it is holding, with the ids that need a mapping and the one that needs a file edited', async () => {
    await mount(chatRoutes({
      'GET state': chatState({
        chat: chatView({ waiting: { count: 3, ids: ['U09XYZ', 'ops/odd.md (no from)'] } }),
        sources: { chat: chatStatus({ detail: '1 channel(s), 3 waiting (unmapped)' }) },
      }),
    }))
    await openChat()
    expect(text('chat')).toContain('3 条消息在等')
    const held = all('#chat ul.list li')
    expect(held).toHaveLength(2)
    // The id is what the operator has to type into the map, so it is the row's headline.
    expect(read(one('.title', held[0]!))).toBe('U09XYZ')
    expect(all('button', held[0]!).map(node => node.textContent)).toEqual(['映射它'])
    // A message that asserted no identity at all has a different remedy, and a 映射它 button for it would be a control
    // that cannot work: the file has no `from` to map, so the fix is the file.
    expect(read(held[1]!)).toContain('ops/odd.md (no from)')
    expect(all('button', held[1]!)).toHaveLength(0)
    expect(read(held[1]!)).toContain('改法是编辑那个文件')
    // Why holding beats refusing, on the surface where the operator decides: it is the reason this queue exists.
    expect(text('chat')).toContain('永远不会被重新评估')
  })

  it('says how many identities were not named, and where the rest of the queue is', async () => {
    // The health line names five ids and a count of the rest. A page that showed only the five would understate a
    // queue the operator is supposed to empty — and cutting anything without a way to see the rest is a standing
    // complaint here, so the rest is named and located rather than dropped.
    await mount(chatRoutes({
      'GET state': chatState({
        chat: chatView({ waiting: { count: 9, ids: ['U1', 'U2', 'U3', 'U4', 'U5'], more: 4 } }),
      }),
    }))
    await openChat()
    expect(text('chat')).toContain('还有 4 个身份没有列出来')
    expect(text('chat')).toContain('频道目录')
    expect(all('#chat ul.list li')).toHaveLength(5)
  })

  it('does not let a Source that is switched off read as an empty queue', async () => {
    // Both this and a genuinely empty queue report zero, because a Source that is not looking is not counting. Showing
    // 「没有等着的消息」 here would be the quiet kind of wrong: the directory can be full.
    await mount(chatRoutes({ 'GET state': offState() }))
    await openChat()
    expect(text('chat')).toContain('已停用')
    expect(text('chat')).toContain('不会被读取')
    expect(text('chat')).toContain('不表示「没有消息」')
    expect(text('chat')).not.toContain('没有等着的消息')
  })

  it('does not let a Source with no channels read as an empty queue', async () => {
    await mount(chatRoutes({ 'GET state': chatState({ settings: chatDocument({ channels: [] }) }) }))
    await openChat()
    expect(text('chat')).toContain('还没有频道')
    // The empty state names the next action instead of stopping at "nothing": this is a configuration gap, not a lull.
    expect(text('chat')).toContain('sources.chat.channels')
    expect(text('chat')).not.toContain('没有等着的消息')
  })

  it('says a paused Source is holding what it already found, and is not reading any more', async () => {
    await mount(chatRoutes({
      'GET state': chatState({
        chat: chatView({
          policy: { enabled: true, paused: true, deny: false, acceptMode: 'auto', allowedSenders: ['operator', 'alice'] },
          waiting: { count: 2, ids: [] },
        }),
      }),
    }))
    await openChat()
    expect(text('chat')).toContain('已暂停')
    expect(text('chat')).toContain('解除之后')
    // The number is from the last scan, and saying so is what keeps it from being read as a live count.
    expect(text('chat')).toContain('最后一次扫描留住了 2 条')
    expect(text('chat')).toContain('不会自己更新')
  })

  it('says an empty queue is empty only when the Source is actually looking', async () => {
    await mount(chatRoutes())
    await openChat()
    expect(text('chat')).toContain('没有等着的消息：目录里每条消息的发送者都在下面的映射表里')
    // Coloured as the good case, which is what separates it from the four warnings this section can show instead.
    expect(read(one('#chat p.ok'))).toContain('没有等着的消息')
  })

  it('puts the held messages in the header, where every page shows them', async () => {
    // A held message produces no Decision, no Ticket and no toast, so without this nothing on the panel mentions it
    // again — on any page. The remedy is a settings edit the operator has to know to make.
    await mount(chatRoutes({
      'GET state': chatState({ chat: chatView({ waiting: { count: 2, ids: ['U09XYZ'] } }) }),
    }))
    expect(byId('chat-waiting').classList.contains('hidden')).toBe(false)
    expect(text('chat-waiting')).toBe('聊天等待 2')
    expect(one('#chat-waiting b').className).toContain('warn')
  })

  it('keeps the header quiet when nothing is held, so the pill stays worth noticing', async () => {
    await mount(chatRoutes())
    expect(byId('chat-waiting').classList.contains('hidden')).toBe(true)
  })

  it('prefills the mapping form from a held id, which is the action the queue exists for', async () => {
    await mount(chatRoutes({
      'GET state': chatState({ chat: chatView({ waiting: { count: 1, ids: ['U09XYZ'] } }) }),
    }))
    await openChat()
    click(button('映射它', one('#chat ul.list li')))
    await settle()
    expect(input('c-platform').value).toBe('U09XYZ')
    // Landed on the field that still needs an answer, not on the one just filled in for them.
    expect(document.activeElement?.id).toBe('c-actor')
  })

  it('warns while the operator types a name the gate would refuse, because that refusal cannot be undone', async () => {
    await mount(chatRoutes())
    await openChat()
    type('c-actor', 'teammate-b')
    expect(text('c-actor-check')).toContain('「teammate-b」不在 allowedSenders')
    expect(text('c-actor-check')).toContain('不可逆')
    type('c-actor', 'alice')
    expect(text('c-actor-check')).toContain('「alice」在 allowedSenders 里')
  })

  it('asks twice before saving a mapping that would burn the message it was meant to admit', async () => {
    const log = await mount(chatRoutes())
    await openChat()
    type('c-platform', 'U09XYZ')
    type('c-actor', 'teammate-b')
    click(button('加入映射表', byId('chat')))
    await settle()
    // Nothing was stored by the first click: this is the one act on this page whose mistake cannot be reversed.
    expect(log.sent('PUT settings')).toHaveLength(0)
    expect(text('chat')).toContain('仍要保存吗')
    click(button('确认加入', byId('chat')))
    await settle()
    const body = savedBody(log)
    expect(savedChat(body).identities).toEqual({
      U01ABCDEF: { actor: 'alice', note: '操作者本人' },
      U09XYZ: { actor: 'teammate-b' },
    })
    expect(log.sent('PUT settings')).toHaveLength(1)
  })

  it('saves the mapping the operator wrote through the whole document, and asks the Source to look again', async () => {
    const log = await mount(chatRoutes())
    await openChat()
    type('c-platform', 'U09XYZ')
    type('c-actor', 'alice')
    type('c-note', '同事，只提交摘要类工作')
    click(button('加入映射表', byId('chat')))
    await settle()
    const body = savedBody(log)
    const chat = savedChat(body)
    expect(chat.identities).toEqual({
      U01ABCDEF: { actor: 'alice', note: '操作者本人' },
      U09XYZ: { actor: 'alice', note: '同事，只提交摘要类工作' },
    })
    // Nothing else about the document moved: the map is one key of it, and the schema is strict enough that a save
    // which dropped the channels or the schedules would either refuse or silently reconfigure the deployment.
    expect(chat.channels).toEqual([{ id: 'ops', directory: '/chat/ops', enabled: true }])
    expect(chat.enabled).toBe(true)
    expect((body.sources as Record<string, unknown>).cron).toEqual({ enabled: true, schedules: [scheduleRecord()] })
    expect(body.notify).toEqual({ enabled: false })
    expect(body.acceptMode).toBe('auto')
    // Holding is admitted by the NEXT scan, so the save asks for one: otherwise the page keeps showing the message as
    // waiting and the operator cannot tell whether holding works at all.
    expect(log.sent('POST pass')).toHaveLength(1)
    expect(toastText()).toContain('已加入映射：U09XYZ → alice')
    expect(input('c-platform').value).toBe('')
    expect(input('c-note').value).toBe('')
  })

  it('asks before replacing a mapping, and says what replacing costs', async () => {
    const log = await mount(chatRoutes())
    await openChat()
    type('c-platform', 'U01ABCDEF')
    type('c-actor', 'alice')
    click(button('加入映射表', byId('chat')))
    await settle()
    expect(log.sent('PUT settings')).toHaveLength(0)
    expect(text('chat')).toContain('U01ABCDEF 已经映射到 alice')
    expect(text('chat')).toContain('移动授权版本')
    click(button('确认改这条', byId('chat')))
    await settle()
    // An empty note is left out rather than stored empty, so the row reads "no note" and not a blank one.
    expect(savedChat(savedBody(log)).identities).toEqual({ U01ABCDEF: { actor: 'alice' } })
    expect(toastText()).toContain('已改映射')
  })

  it('takes a mapping away on a second click, and leaves every other key alone', async () => {
    const log = await mount(chatRoutes({
      'GET state': chatState({
        settings: chatDocument({
          identities: {
            U01ABCDEF: { actor: 'alice', note: '操作者本人' },
            U09XYZ: { actor: 'teammate-b', note: '同事' },
          },
        }),
      }),
    }))
    await openChat()
    expect(text('chat')).toContain('身份映射（2）')
    click(button('删除', identityRow('U09XYZ')))
    await settle()
    // Narrowing who may originate work is not a one-click act either, and there is no native confirm() on this page.
    expect(log.sent('PUT settings')).toHaveLength(0)
    expect(all('button', identityRow('U09XYZ')).map(node => node.textContent)).toEqual(['确认删除', '取消'])
    click(button('确认删除', identityRow('U09XYZ')))
    await settle()
    expect(savedChat(savedBody(log)).identities).toEqual({ U01ABCDEF: { actor: 'alice', note: '操作者本人' } })
    expect(savedChat(savedBody(log)).channels).toEqual([{ id: 'ops', directory: '/chat/ops', enabled: true }])
    expect(toastText()).toContain('已删除映射：U09XYZ')
  })

  it('says what an empty map means, rather than showing an empty table', async () => {
    await mount(chatRoutes({ 'GET state': chatState({ settings: chatDocument({ identities: {} }) }) }))
    await openChat()
    expect(text('chat')).toContain('身份映射（0）')
    expect(text('chat')).toContain('映射表是空的：任何平台 id 的消息都会被留住，一条也不会被受理')
  })

  it('keeps a half-written mapping when the five-second refresh lands', async () => {
    await mount(chatRoutes())
    await openChat()
    type('c-platform', 'U09XYZ')
    type('c-actor', 'teammate-b')
    type('c-note', '同事')
    await tick(5000)
    expect(input('c-platform').value).toBe('U09XYZ')
    expect(input('c-actor').value).toBe('teammate-b')
    expect(input('c-note').value).toBe('同事')
  })

  it('explains the reply tally, including the number that is not an error', async () => {
    // `nowhere` counts Reports worth telling someone about whose Trigger carried no address — the normal case for cron
    // and inbox work. A number an operator cannot interpret is not observability, so the explanation sits beside it.
    await mount(chatRoutes())
    await openChat()
    expect(text('chat')).toContain('已排队 3')
    expect(text('chat')).toContain('无处可发 11')
    expect(text('chat')).toContain('「无处可发」不是错误')
    expect(text('chat')).toContain('没有带回复地址')
    // Both counters are per-process, and a zero that reads as "never happened" is worse than no number at all.
    expect(text('chat')).toContain('本次挂载以来')
    expect(text('chat')).toMatch(/挂载于 [^）]*2026/)
    expect(text('chat')).toContain('REPLY-UNDELIVERED.md')
  })

  it('shows the health line the Source wrote, verbatim, when it has a problem', async () => {
    // The world-writable-directory warning is the real boundary of this whole feature — whoever can write there can
    // submit work as any mapped identity — and it is the server's sentence, not this page's paraphrase of it.
    await mount(chatRoutes({
      'GET state': chatState({
        health: {
          'source:chat': {
            ok: false,
            detail: 'channel ops: directory /chat/ops is writable by others (mode 755), so anyone who can write '
              + 'there can submit work as any mapped identity; tighten it with chmod go-w',
            at: LATER,
          },
        },
      }),
    }))
    await openChat()
    expect(read(one('#chat pre.bad'))).toContain('writable by others (mode 755)')
    expect(read(one('#chat pre.bad'))).toContain('chmod go-w')
  })

  it('shows where a chat Ticket’s answer went, on the Ticket itself', async () => {
    await mount(chatRoutes({
      'GET tickets/ticket-1': ticket({ via: 'chat', replyTo: { kind: 'chat', channel: 'ops', thread: 't-9' } }),
    }))
    await openListed()
    expect(detailValue('回复地址')).toBe('chat/ops（thread t-9） — 报告会被送回这里')
  })

  it('leaves the reply address off a Ticket whose request never carried one', async () => {
    // The absent case is the one the tally counts, and a row reading "nowhere" on every cron Ticket would be noise
    // where the operator is trying to read one Ticket. The tally in 来源 · 聊天 explains that case instead.
    await mount(chatRoutes())
    await openListed()
    expect(all('#detail .kv dt').map(node => node.textContent)).not.toContain('回复地址')
    expect(text('detail')).not.toContain('回复地址')
  })
})

describe('a host whose plugin has no chat view yet', () => {
  /**
   * The page is served from disk and the plugin is not, so the host on the other end can be a generation behind: it
   * answers `GET state` like any bundle, minus the `chat` key. That is the whole probe — no route is asked for, so
   * there is nothing to refuse and nothing to toast about on every five-second refresh.
   */
  it('says so once, in its own banner, and asks no route of its own', async () => {
    const { calls, sent } = await mount(routes())
    click(button('来源'))
    await settle()
    expect(text('chat')).toContain('宿主的插件比这个页面旧')
    expect(byId('chat-banner').classList.contains('hidden')).toBe(false)
    expect(byId('chat-banner').textContent).toContain('还没有聊天这一块')
    // Exactly one banner: this generation of "the plugin is old" is not the one the other banner explains, and two
    // banners saying the same thing is one too many.
    expect(byId('v2-banner').classList.contains('hidden')).toBe(true)
    expect(calls.map(call => call.path).filter(path => /chat/.test(path))).toEqual([])
    await tick(10_000)
    expect(toastText()).not.toContain('No route')
    expect(byId('toast').classList.contains('show')).toBe(false)
    // The heartbeat goes on reading the system; only the section that needs the missing key stays put.
    expect(sent('GET state')).toHaveLength(3)
    expect(text('chat')).toContain('宿主的插件比这个页面旧')
  })

  it('leaves the older banner to speak when the host is older than both', async () => {
    await mount(routes({ 'GET projects': refuse(404, 'No route for GET /myagent/api/projects') }))
    expect(byId('v2-banner').classList.contains('hidden')).toBe(false)
    expect(byId('chat-banner').classList.contains('hidden')).toBe(true)
  })

  it('reads the chat view again when the operator says the plugin has been reloaded', async () => {
    let reads = 0
    const current = chatState()
    await mount(routes({
      'GET state': () => {
        reads += 1
        return reads === 1 ? state() : current
      },
      'PUT settings': { settings: chatDocument(), settingsRevision: 4 },
      'POST pass': { requested: true, effects: {} },
    }))
    click(button('来源'))
    await settle()
    expect(text('chat')).toContain('宿主的插件比这个页面旧')
    click(button('重试', byId('chat-banner')))
    await settle()
    expect(byId('chat-banner').classList.contains('hidden')).toBe(true)
    expect(text('chat')).toContain('已启用')
    expect(text('chat')).toContain('身份映射（1）')
  })
})

describe('markup in a value a chat platform wrote', () => {
  const chatStateWith = (chat: Record<string, unknown>): Record<string, unknown> => {
    const base = state()
    const document = settings()
    return state({
      settings: {
        ...document,
        sources: {
          ...(document.sources as Record<string, unknown>),
          chat: {
            enabled: true, pollMs: 5000,
            identities: { 'U&A': { actor: 'li & yang', note: 'A & B < C' } },
            channels: [{ id: 'ops', directory: '/chat/ops', enabled: true }],
          },
        },
      },
      sources: { ...(base.sources as Record<string, unknown>), chat: { ok: true, detail: '1 channel(s)' } },
      chat: {
        policy: { enabled: true, paused: false, deny: false, acceptMode: 'auto', allowedSenders: ['li & yang'] },
        waiting: chat,
      },
    })
  }

  it('shows a held platform id as text, because a channel directory is not the operator’s own input', async () => {
    // This is the one string on the page that somebody else controls: with no `from` field the Source names a held
    // message by its FILE NAME, and whoever can write to the channel directory chose that name.
    await mount(routes({ 'GET state': chatStateWith({ count: 1, ids: ['<img src=x onerror="document.title=\'pwned\'">'] }) }))
    click(button('来源'))
    await settle()
    expect(document.querySelector('#chat img')).toBe(null)
    expect(document.title).not.toBe('pwned')
    // Shown as what it is, so the operator can see the value that is strange rather than a hole where it was.
    expect(read(one('#chat ul.list li .title'))).toBe('<img src=x onerror="document.title=\'pwned\'">')
  })

  it('leaves an ampersand alone in a name and a note the operator wrote', async () => {
    // The other half of S36: these are text nodes, which are inert by construction. Running them through `escapeText`
    // would show the operator `&amp;` where they wrote `&` — in the map that says who may originate work.
    await mount(routes({ 'GET state': chatStateWith({ count: 0, ids: [] }) }))
    click(button('来源'))
    await settle()
    expect(read(identityRow('U&A'))).toContain('li & yang')
    expect(read(identityRow('U&A'))).toContain('A & B < C')
    expect(document.body.textContent).not.toContain('&amp;')
  })

})

describe('the requests the queue gave up on', () => {
  /** The queue row a give-up deletes, which is the only other name for a lost request that survives. */
  const KEY = '6ce6093778b89681cb9170e23056e52f'
  /** The bounds the Store keeps these under, which the route reports so the page states them instead of copying them. */
  const BOUNDS = { keep: 20, chars: 1000 }
  /** A payload that could not be read as a Trigger: cut in half, so it has no kind and no at. */
  const BROKEN = '{"id": "trigger-9", "source": '

  /** One lost ROW: understood, then dropped inside `receive`. It has a real source and kind, and it is counted. */
  const lostRow = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'trigger-lost-1', source: 'cron', kind: 'cron', at: AT, title: '把摘要发到群里',
    error: 'Error: the store refused the write', effectKey: KEY, ...over,
  })

  /** One lost PAYLOAD: not understood at all, so it is in no table and in no Source's counts. */
  const lostPayload = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    at: LATER, effectKey: KEY, error: 'TypeError: Cannot read properties of null',
    chars: BROKEN.length, payload: BROKEN, ...over,
  })

  const lostBody = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    total: 1, shown: 1, rows: [lostRow()], payloads: [lostPayload()], bounds: BOUNDS, ...over,
  })

  /** `GET state` of a bundle that has this view: the two counts, and nothing else added to it. */
  const lostState = (lost: Record<string, unknown> = { rows: 1, payloads: 1 }): Record<string, unknown> => {
    const base = state()
    return state({ counts: { ...(base.counts as Record<string, unknown>), lost } })
  }

  const lostRoutes = (over: Routes = {}): Routes => routes({ 'GET state': lostState(), 'GET lost': lostBody(), ...over })

  it('shows both paths, and keeps them apart because they are two different facts', async () => {
    await mount(lostRoutes())
    click(button('来源'))
    await settle()
    // How many, on the two paths, from the count that rides the poll the page already makes.
    expect(text('lost')).toContain('被认出然后丢掉的行 1')
    expect(text('lost')).toContain('读不出的载荷 1')
    // Which: the row's own identity, the reason it was given up on, and the queue key that is its other name. Read
    // cell by cell rather than as one string, and with no copy of the page's date format here: what a test may pin is
    // that the time arrived, not how this machine spells it.
    const cells = [...one('#lost table tbody tr').children].map(node => read(node))
    expect(cells).toHaveLength(7)
    expect(cells[0]).not.toBe('—')
    expect(cells.slice(1)).toEqual(['把摘要发到群里', 'cron', 'cron', 'trigger-lost-1',
      'Error: the store refused the write', KEY])
    expect(text('lost')).toContain('把摘要发到群里')
    // And the sentence that says what the difference MEANS, because the two look alike in a list and are not:
    // one is counted in its Source's intake, the other is deliberately in no table at all.
    expect(text('lost')).toContain('也算进那个来源的进气计数')
    expect(text('lost')).toContain('不在 triggers 表里，也不在任何来源的进气计数里')
    expect(text('lost')).toContain(`原文 ${BROKEN.length} 字，完整`)
  })

  it('watches the number on the five-second refresh without re-reading twenty payloads of raw text', async () => {
    const { sent } = await mount(lostRoutes())
    click(button('来源'))
    await settle()
    expect(sent('GET lost')).toHaveLength(1)
    await tick(10_000)
    // The count is polled, because "is that number growing" is a question about now. The detail is not, because it is
    // up to twenty payloads of a thousand untrusted characters each and nobody is re-reading it every five seconds.
    expect(sent('GET state')).toHaveLength(3)
    expect(sent('GET lost')).toHaveLength(1)
    expect(text('lost')).toContain('被认出然后丢掉的行 1')
  })

  it('says the number is growing, which is what separates a broken producer from one bad payload', async () => {
    let reads = 0
    await mount(routes({
      'GET state': () => {
        reads += 1
        return reads === 1 ? lostState({ rows: 1, payloads: 0 }) : lostState({ rows: 4, payloads: 0 })
      },
      'GET lost': lostBody({ total: 1, shown: 1, rows: [lostRow()], payloads: [] }),
    }))
    click(button('来源'))
    await settle()
    expect(text('lost')).toContain('自这个页面打开以来这个数字没有增加（一直是 1 条）')
    await tick(5_000)
    expect(text('lost')).toContain('这个数字在涨')
    expect(text('lost')).toContain('多了 3 条')
    // The reading it has to support: one bad payload adds one, a producer broken on every firing adds one per firing.
    expect(text('lost')).toContain('有个生产者在持续失败')
    // And the detail says it is behind, rather than showing a table of one under a count of four.
    expect(text('lost')).toContain('又丢了 3 条')
  })

  it('says nothing was lost, and says it only where the read succeeded', async () => {
    await mount(lostRoutes({
      'GET state': lostState({ rows: 0, payloads: 0 }),
      'GET lost': lostBody({ total: 0, shown: 0, rows: [], payloads: [] }),
    }))
    click(button('来源'))
    await settle()
    expect(text('lost')).toContain('没有丢失的请求：队列没有彻底放弃过任何一条')
    // The header pill is hidden at zero rather than showing a zero: a pill that is always there is one the eye skips.
    expect(byId('lost-count').classList.contains('hidden')).toBe(true)
  })

  it('counts a loss in the header from every page, because nothing else on this panel will ever mention it', async () => {
    await mount(lostRoutes())
    // Still on the Ticket page: a given-up request has no Decision, no Ticket and no toast, so the pill is the only
    // thing that follows the operator around — the same reason the held-message pill beside it exists.
    expect(byId('lost-count').classList.contains('hidden')).toBe(false)
    expect(text('lost-count')).toBe('丢失 2')
    expect(one('#lost-count b').className).toContain('bad')
  })

  it('does not let a bundle that cannot answer read as “nothing was lost”, and never asks it for the route', async () => {
    // `state()` has no `counts.lost`: this is a plugin older than the page, which is the case the capability probe
    // exists for. The page is served from disk and the plugin is not, so the two disagree in production.
    const { calls } = await mount(routes())
    click(button('来源'))
    await settle()
    expect(text('lost')).toContain('宿主的插件比这个页面旧')
    // The distinction the whole section hangs on: "I could not read it" must never be drawn in the same words as
    // "nothing was lost", and must never be drawn in the reassuring green the empty state uses.
    expect(text('lost')).toContain('这不代表「没有丢失的请求」，它代表「读不到」')
    expect(all('#lost p.ok')).toHaveLength(0)
    expect(all('#lost p.warn')).toHaveLength(1)
    expect(byId('lost-count').classList.contains('hidden')).toBe(true)
    // The state key IS the probe: no request of its own, so there is nothing to be refused and nothing to toast about.
    expect(calls.map(call => call.path)).not.toContain('lost')
    await tick(10_000)
    expect(toastText()).not.toContain('No route')
    expect(byId('toast').classList.contains('show')).toBe(false)
  })

  it('reads the lost detail once the operator says the plugin has been reloaded', async () => {
    let reads = 0
    await mount(routes({
      'GET state': () => {
        reads += 1
        return reads === 1 ? state() : lostState()
      },
      'GET lost': lostBody(),
    }))
    click(button('来源'))
    await settle()
    expect(text('lost')).toContain('宿主的插件比这个页面旧')
    click(button('重试', byId('lost')))
    await settle()
    expect(text('lost')).toContain('把摘要发到群里')
    expect(all('#lost p.warn')).toHaveLength(0)
  })

  it('shows why the detail is missing instead of an empty list, and keeps the counts it does have', async () => {
    const { sent } = await mount(lostRoutes({
      'GET state': lostState({ rows: 2, payloads: 0 }),
      'GET lost': refuse(500, 'the database is locked'),
    }))
    click(button('来源'))
    await settle()
    // The counts came from `state` and are still true, so they stay on screen; the reason there is no list under them
    // is a sentence. An empty list here would read as "nothing was lost" while two were.
    expect(text('lost')).toContain('被认出然后丢掉的行 2')
    expect(text('lost')).toContain('明细这一次没读到')
    expect(read(one('#lost pre.bad'))).toBe('the database is locked')
    expect(all('#lost ul.list')).toHaveLength(0)
    expect(all('#lost table')).toHaveLength(0)
    // A real failure is said out loud: this is not the one failure the page has already explained.
    expect(toastText()).toBe('the database is locked')
    click(button('重新读取', byId('lost')))
    await settle()
    expect(sent('GET lost')).toHaveLength(2)
  })

  it('offers more rows when it showed fewer than there are, because a truncation nobody can undo is a hole', async () => {
    const limits: string[] = []
    await mount(lostRoutes({
      'GET state': lostState({ rows: 3, payloads: 0 }),
      'GET lost': (call: Call) => {
        limits.push(call.query.get('limit') ?? '')
        // Answering with fewer than `total` whatever it was asked for, which is the case under test: the page has to
        // say the list is short AND give the operator the way to see the rest.
        return lostBody({ total: 3, shown: 2, rows: [lostRow({ id: 'trigger-lost-c' }), lostRow({ id: 'trigger-lost-b' })], payloads: [] })
      },
    }))
    click(button('来源'))
    await settle()
    expect(text('lost')).toContain('一共 3 条，这里显示最新的 2 条')
    click(button('再读 50 条（现在读到 50 条为止）', byId('lost')))
    await settle()
    expect(limits).toEqual(['50', '100'])
  })

  it('says a payload was cut, and does not offer a way to see a remainder nobody stored', async () => {
    await mount(lostRoutes({
      'GET lost': lostBody({ total: 0, shown: 0, rows: [], payloads: [lostPayload({ payload: 'x'.repeat(1000), chars: 1500 })] }),
    }))
    click(button('来源'))
    await settle()
    expect(text('lost')).toContain('原文 1500 字，只存下前 1000 字')
    // Honest about the limit of the remedy rather than offering a control that cannot succeed: the Store kept a
    // thousand characters and nothing anywhere has the rest.
    expect(text('lost')).toContain('剩下的没有存下来，任何地方都读不到')
    // The bound is the Store's own, reported by the route, so it cannot drift from the build that enforces it.
    expect(text('lost')).toContain('最多 20 条、每条最多 1000 字')
  })

  it('offers no way to replay a lost request, and says so instead of leaving the operator to guess', async () => {
    await mount(lostRoutes())
    click(button('来源'))
    await settle()
    // There is no route that could re-drive one — the queue deleted its row when it gave up — and a button that can
    // only fail is worse than no button, which is why this page has removed one before. So the remedy is a sentence.
    expect(text('tab-sources')).toContain('这里没有「重放」按钮，因为它做不到')
    expect(text('tab-sources')).toContain('系统也不会自动重放它')
    // The part that is easy to get wrong and that §4.45 fixed: `lost` is not a duplicate, so the gate really does run
    // again on the same request. Without this the honest remedy reads as a dead end.
    expect(text('tab-sources')).toContain('lost 行不算重复')
    // The one control offered is one that can succeed: read the detail again.
    expect(all('#lost button').map(node => node.textContent)).toEqual(['重新读取'])
  })
})

describe('markup in a payload the page could not parse', () => {
  /**
   * The most untrusted string on this panel: bytes of unknown provenance, from a producer that could not even write a
   * record this build could read. That is exactly the case where markup, a control byte and half a multi-byte character
   * are likely — and the operator came here to read THOSE bytes, so escaping them into `&amp;` would cost the evidence.
   */
  const HOSTILE = '<img src=x onerror="document.title=\'pwned\'">&<b>half</b>\u0000\ufffd'
  const KEY = '6ce6093778b89681cb9170e23056e52f'

  const hostileRoutes = (over: Record<string, unknown> = {}): Routes => {
    const base = state()
    return routes({
      'GET state': state({ counts: { ...(base.counts as Record<string, unknown>), lost: { rows: 1, payloads: 1 } } }),
      'GET lost': {
        total: 1, shown: 1,
        // Both halves: the row's fields come from a payload a stranger's message could have written, and the degenerate
        // payload is text nobody vouched for at all.
        rows: [{
          id: 'trigger-lost-1', source: 'chat', kind: 'chat', at: AT,
          title: '<script>document.title="row"</script> & 标题', error: 'Error: bad <json> & worse', effectKey: KEY,
        }],
        payloads: [{ at: LATER, effectKey: KEY, error: 'Error: bad <json> & worse', chars: HOSTILE.length, payload: HOSTILE }],
        bounds: { keep: 20, chars: 1000 },
        ...over,
      },
    })
  }

  it('renders the raw text as text, because a text node is inert and escaping it would cost the evidence', async () => {
    await mount(hostileRoutes())
    click(button('来源'))
    await settle()
    // Nothing was built out of it: the img and the script are strings on screen, not elements in the page.
    expect(document.querySelector('#lost img')).toBe(null)
    expect(document.querySelector('#lost script')).toBe(null)
    expect(document.title).not.toBe('pwned')
    // Byte for byte, including the ampersand, the NUL and the replacement character — and NOT `&amp;`, which is what
    // running a text node through `escapeText` shows the operator where the producer wrote `&` (S36).
    const shown = all('#lost ul.list li pre')
    expect(shown.map(node => node.textContent)).toEqual(['Error: bad <json> & worse', HOSTILE])
    expect(document.body.textContent).not.toContain('&amp;')
  })

  it('renders a row’s title and error as text too, since a chat Trigger carries what a stranger wrote', async () => {
    await mount(hostileRoutes())
    click(button('来源'))
    await settle()
    const row = one('#lost table tbody tr')
    // The title is the request's own, and for a chat Trigger that is a line somebody else sent to a channel directory.
    expect(read(row.children[1])).toBe('<script>document.title="row"</script> & 标题')
    expect(read(row.children[5])).toBe('Error: bad <json> & worse')
    expect(document.title).not.toBe('row')
    expect(document.querySelector('#lost table script')).toBe(null)
  })
})

describe('the utility class that hides things', () => {
  // A real browser showed both capability banners at once, permanently, with a clean console and no effect from the
  // 重试 button. Cause: `#v2-banner, #chat-banner { display: flex }` beats `.hidden { display: none }` on specificity
  // (an ID outranks a class, whatever the source order), so the class was applied correctly and ignored. jsdom cannot
  // catch this — it does not evaluate cascade specificity — and every panel test asserts on `classList`, so all 172
  // passed while the page was visibly wrong. This assertion is therefore deliberately at the CSS-source level: it is
  // the only thing a jsdom suite can pin about a bug that only a browser can show.
  it('outranks any ID rule that sets display, because hiding is the only thing it does', () => {
    expect(PAGE).toMatch(/\.hidden\s*\{\s*display:\s*none\s*!important\s*\}/)
  })
})
