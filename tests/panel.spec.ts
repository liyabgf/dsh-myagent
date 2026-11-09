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
  // 【S-2】报告送去哪儿：服务端给人话，页面只照抄，不自己拼措辞。
  deliverToText: '送到聊天频道 telegram（该频道的默认会话）',
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
  // 【U14】丢失的请求搬进「记录」页，而进这一页会连判定一起读；总览落地时也读最近 5 条判定。
  // 放在基础夹具里，而不是让每条用到这一页的测试各自补——否则漏一个就红在一个与本包无关的 404 上。
  'GET decisions': { count: 0, decisions: [] },
  'GET tickets/ticket-1/dependencies': { waitsFor: [], waitedOnBy: [] },
  'GET tickets/ticket-1/events': { count: 0, returned: 0, events: [] },
  // The capability probe reads this one route on boot; an unstubbed route answers "No route for", which is exactly
  // the answer that tells the page its host is older than it is.
  'GET projects': { projects: [] },
  'GET effects': { counts: {} },
  // 0.11.0 的决断队列：总览落地就会读它，所以基础夹具里给一个空队列——
  // 否则每条无关测试都会红在一个与本包行为无关的 404 上（U14 给 decisions 的同一条理由）。
  'GET operator-queue': { items: [] },
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
/**
 * 按钮自己的标签：整段文本减去徽标文本（U7）。
 *
 * 导航徽标是按钮的子节点，于是「任务」的 textContent 变成「任务3」。若按整段文本匹配，加了徽标之后
 * 每一个按标签找按钮的调用都要跟着改，而**徽标是数据、标签是身份**——两者不该混在一个字符串里比。
 */
const labelOf = (node: Element): string => {
  let text = node.textContent ?? ''
  for (const badge of node.querySelectorAll('.badge')) text = text.replace(badge.textContent ?? '', '')
  return text.trim()
}

const button = (label: string, within: ParentNode = document): Element => {
  const found = all('button', within).filter(node => labelOf(node) === label)
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
  // 显式点到任务页，而不是依赖"落地页恰好是任务页"。U1 把落地页改成了总览，这个隐含依赖一次暴露了 35 处：
  // 辅助函数替测试假设了页面的默认状态，默认状态一变，35 条测试一起红。声明前置条件是加强，不是弱化——
  // 每条测试断言的事实一个字没动。
  click(button('任务'))  // 【U7 改名】旧文案 'Ticket'
  await settle()
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
    expect(text('mode')).toBe('受理模式：通过即执行')  // 【U17】旧断言 toBe('受理模式 auto')
    expect(text('counts')).toBe('任务 2 进行中 · 1 等你回答 · 5 已结束')  // 【U17】旧断言 'Ticket 2 进行中 · 1 等人 · 5 已结束'
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
    expect(text('counts')).toContain('2 等你回答')  // 【U17】旧断言 '2 等人'
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
    // The default tab is drawn, and the others are not merely present but hidden.
    // 【U1 产品变更】落地页从任务列表改成总览（§6.1 收件箱心智：人打开面板第一问是"有什么新事"）。
    // 断言的事实类别没变——默认页被画出、其余隐藏、计数行正确——变的只是默认页是谁。
    // 旧断言：expect(byId('tab-tickets').classList.contains('hidden')).toBe(false)
    expect(byId('tab-overview').classList.contains('hidden')).toBe(false)
    expect(byId('tab-tickets').classList.contains('hidden')).toBe(true)
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
      // 【U1】总览是新增的第一项；其余顺序未动。
      // 【U13】排期并入派活，一级菜单 9 → 8。旧值含 'schedules'。
      .toEqual(['overview', 'tickets', 'works', 'new', 'decisions', 'chat', 'settings', 'prompts'])

    click(button('记录'))
    await settle()
    // 【U1】限定到记录页自己的读（limit=80）：总览落地时会预读最近 5 条判定（limit=5），那是另一个读者。
    // 断言的事实没变——进这一页读它一次。
    expect(sent('GET decisions').filter(call => call.query.get('limit') === '80')).toHaveLength(1)
    expect(byId('tab-decisions').classList.contains('hidden')).toBe(false)
    for (const other of ['tickets', 'works', 'new', 'chat', 'settings', 'prompts']) {  // 【U13】去 'schedules'；【U14】'sources'→'chat'
      expect(byId(`tab-${other}`).classList.contains('hidden'), other).toBe(true)
    }
    // 【U1】门禁记录从第 4 个变成第 5 个（总览插在首位），落地的总览此时不该是选中态。
    expect(byId('tabs').children[4]!.getAttribute('aria-selected')).toBe('true')
    expect(byId('tabs').children[0]!.getAttribute('aria-selected')).toBe('false')
  })

  it('stops watching a Ticket when the operator leaves the page it is on', async () => {
    const { sent } = await mount(routes())
    // 【U1】先点到任务页再点行。原先直接点 `#tickets li`，依赖"落地页恰好是任务页"；落地页改成总览后，
    // 这一下点的是**隐藏 Tab 里的行**——浏览器里产生不出来的状态，于是 tab 仍是 overview、轮询按设计不启动。
    // 断言的事实（在它自己的页上被看着、离开就不看了）一个字没改。
    await openListed()
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
    // 【U17 产品变更】阶段胶囊显示中文，英文原值挂在 title（排障时与日志对得上）。旧断言：toBe('waiting')
    expect(read(one('#detail .stage'))).toBe('等你回答')
    expect(one('#detail .stage').getAttribute('title')).toBe('waiting')
    expect(one('#detail .stage').className).toContain('attention')
    // 【U4 产品变更】授权与来源 Trigger 搬进了默认折叠的「技术细节」（<details>，文本仍在 DOM，
    // detailValue('授权') 等断言原样通过）。行集合不变、顺序变为主行在前。
    // 旧断言：toEqual(['Ticket', '创建', '更新', '归属', '授权', '目录', '来源 Trigger'])
    expect(all('#detail .kv dt').map(node => node.textContent))
      .toEqual(['任务', '创建', '更新', '归属', '目录', '授权', '来源 Trigger'])  // 【U7】首行标签 Ticket→任务
    expect(detailValue('任务'))  // 【U7 改名】旧标签 'Ticket'.toBe('ticket-1')
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
    click(button('已结束'))  // 【U7】下拉改 chips：旧写法 choose('filter', 'ended')
    await settle()
    expect(last('GET tickets')?.query.get('state')).toBe('ended')
    expect(last('GET tickets')?.query.get('limit')).toBe('80')
  })

  it('says there is nothing in the list, in a sentence', async () => {
    await mount(routes({ 'GET tickets': { offset: 0, limit: 80, count: 0, tickets: [] } }))
    // 【U10 产品变更】空态加了"下一步"按钮（§6.1：空状态是教学时刻），所以整段文本不再是那一句话。
    // 旧断言：expect(text('tickets')).toBe('没有 Ticket。')
    // 断言的事实没变——空态说人话——外加一条新事实：它给出下一步。
    expect(text('tickets')).toContain('没有任务。')  // 【U17/U22】旧文案 '没有 Ticket。'——它在 JS 里，不在静态 markup，所以那轮扫描漏了
    expect(read(button('去派活', byId('tickets')))).toBe('去派活')
    expect(text('ticket-hint')).toBe('0 条')
    // 【U10 产品变更】空态现在带一个"下一步"按钮，所以"列表里没有任何按钮"不再是事实。
    // 旧断言：expect(all('#tickets li button')).toHaveLength(0)
    // 它原本要防的是"空列表里混进可点的东西让人困惑"，现在改成钉住**只有一个、且它就是下一步**。
    expect(all('#tickets li button').map(node => labelOf(node))).toEqual(['去派活'])
  })

  it('shows on each row what it is, what stage it is at, and who it is waiting for', async () => {
    await mount(routes())
    const row = one('#tickets li')
    expect(read(one('.title', row))).toBe('整理本周竞品动态')
    expect(read(one('.stage', row))).toBe('等你回答')  // 【U17】旧断言 toBe('waiting')
    expect(one('.stage', row).className).toContain('attention')
    expect(read(row)).toContain('schedule · operator')
    expect(read(row)).toContain('等你回答')  // 【U17】旧断言 '等人回答'
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
    // 【U20】夹具里恰好只有一条工作，于是进页会自动选中它、并读它的详情——这一读是新的前置条件。
    'GET works/work-1': { work: work(), tickets: [] },
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
    expect(text('projects')).toBe('还没有项目。点下面的「新建项目」给它起个名字，把同类的工作归到一起。')  // 【U20】旧文案说"在下面"，表单已收进按钮
    expect(text('works')).toBe('还没有工作。点下面的「新建工作」建一个，再把任务归进去：它们按归入的先后在这里排队。')  // 【U17/U20】Ticket→任务，且表单已收进按钮
  })

  it('creates a Project from the name and note the operator wrote, and empties the form', async () => {
    const { sent, last } = await mount(workRoutes({ 'POST projects': project() }))
    await openWorks()
    // 【U20 产品变更】表单收进了「新建项目」这个动作：先唤出，再填，提交按钮改叫「创建项目」。
    // 旧写法是直接 type 后 click(button('新建项目'))（那时表单永远摊开、同一个按钮既是标题也是提交）。
    click(button('新建项目'))
    await settle()
    expect(byId('pj-form').classList.contains('hidden')).toBe(false)
    click(button('创建项目'))
    await settle()
    expect(toastText()).toBe('先写项目名')
    expect(sent('POST projects')).toHaveLength(0)
    type('pj-name', '竞品观察')
    type('pj-note', '每季看一次同行')
    click(button('创建项目'))
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
    click(button('新建工作'))   // 【U20】先唤出表单；提交按钮改叫「创建工作」
    await settle()
    type('wk-name', '周报')
    choose('wk-project', 'project-1')
    type('wk-scope', '只读 data/')
    type('wk-note', '每周一产出')
    click(button('创建工作'))
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
    expect(text('work-detail')).toBe('选择左边一个项目或工作；里面的任务点一下就回到任务页打开。')  // 【U17】Ticket→任务
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
    expect(text('work-detail')).toContain('这个工作还没有任务。去「派活」派一个，或在任务详情页把它「归入工作」。')  // 【U17/U21】旧文案含两处 Ticket
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
    // 【U13 产品变更】配方把人带到「派活」页的**定时模式**，而不是一个独立的排期页。
    // 旧断言：tab-schedules 可见、tab-new 隐藏 —— 现在恰好相反：页面就是 tab-new，页内是定时那一块。
    expect(byId('tab-new').classList.contains('hidden')).toBe(false)
    expect(byId('dispatch-timed').classList.contains('hidden')).toBe(false)
    expect(byId('dispatch-once').classList.contains('hidden')).toBe(true)
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
    // 【U13】排期不再是独立菜单：它在「派活」页的定时模式下（同一道门禁、同一种请求，只是"到点派"）。
    // 旧写法：click(button('排期'))
    click(button('派活'))
    await settle()
    click(button('定时派'))
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
    // 【U10 产品变更】同上：空态加了「建一个」，直接触发已有的新建入口。
    // 旧断言：expect(text('schedules')).toBe('还没有排期。')
    expect(text('schedules')).toContain('还没有排期。')
    expect(read(button('建一个', byId('schedules')))).toBe('建一个')
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
  // 【U14 产品变更】「来源」页解散了，这一个入口变成两个：
  //   来源状态表 → 总览的「活从哪来」；健康与队列 → 顶栏「状态」抽屉。
  // 旧写法：click(button('来源'))
  const openOverview = async (): Promise<void> => {
    click(button('总览'))
    await settle()
  }
  const openDrawer = async (): Promise<void> => {
    click(byId('health'))
    await settle()
  }

  it('draws the sources, the health and the queue as tables, not as JSON', async () => {
    await mount(routes({ 'GET effects': { counts: { notify: 2, launch: 1 } } }))
    await openOverview()
    await openDrawer()
    // 【U14】来源表的容器 id 跟着它搬去总览，改成 ov-sources；健康与队列的容器 id 沿用（搬进抽屉时特意没改）。
    for (const id of ['ov-sources', 'health-detail', 'effects']) {
      expect(all(`#${id} table.plain`), id).toHaveLength(1)
      expect(text(id), id).not.toMatch(/[[{}"]/)
    }
    expect(all('#ov-sources th').map(node => node.textContent)).toEqual(['来源', '状态', '详情', '下次', '最近触发', '计数'])
    const cron = all('#ov-sources tbody tr')[0]!
    expect(read(one('.ok', cron))).toBe('正常')
    expect(read(cron)).toContain('1 条排期')
    expect(read(cron)).toContain('schedules 1')
    // A Source reports its next run as an instant, and a person reads it as a date in their own zone.
    expect(read(cron)).toContain('2026')
    const inbox = all('#ov-sources tbody tr')[1]!
    expect(read(inbox)).toContain('看着 /inbox')
    // A Source that has never fired says so, instead of leaving a cell the operator has to interpret.
    expect(read(inbox)).toContain('还没有')
    expect(all('#health-detail th').map(node => node.textContent)).toEqual(['部件', '状态', '详情', '时间'])
    expect(all('#effects tbody tr').map(node => node.textContent)).toEqual(['notify2', 'launch1'])
    expect(text('effects-note')).toContain('退避重试')
  })

  it('says the queue is empty in a sentence, because an empty queue is the good case', async () => {
    await mount(routes())
    await openDrawer()
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
    await openOverview()
    await openDrawer()
    expect(read(one('#ov-sources .bad'))).toBe('异常')
    expect(text('ov-sources')).toContain('排期解析失败：digest')
    expect(read(one('#health-detail .bad'))).toBe('有问题')
    expect(text('health')).toBe('状态 1 个问题')
  })

  it('says the queue could not be read, where the queue would have been', async () => {
    await mount(routes({ 'GET effects': refuse(500, '数据库锁住了') }))
    await openDrawer()
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
    click(button('记录'))
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
    expect(read(one('.done', accepted))).toBe('已受理')  // 【U17】旧断言 toBe('accept')
    // 【U8 产品变更】行内时刻改成相对（"3 天前"），绝对时刻挂在该 span 的 title 上。
    // 旧断言：expect(read(accepted)).toContain('2026')
    // **不断言具体的"3 天前"**：真实时钟在走，那样写会随日期漂移成 flake（W9 修过的同一类）。
    // 断言的是两个不变量：文本是相对表达（或超 30 天退回的日期），且 title 里带着绝对时刻。
    const whenCell = one('.meta span', accepted)
    expect(read(whenCell)).toMatch(/刚刚|分钟前|小时前|天前|\d{4}\//)
    expect(whenCell.getAttribute('title')).toContain('2026')
    // An accepted request is not a refusal, so there is nothing to put away.
    expect(all('button', accepted)).toHaveLength(0)
    const ignored = decisionRow('陌生人的请求')
    expect(read(one('.bad', ignored))).toBe('已拒绝')  // 【U17】旧断言 toBe('ignore')
    expect(read(ignored)).toContain('sender "stranger" is not on the list')
    expect(all('button', ignored).map(node => node.textContent)).toEqual(['我看过了'])  // 【U23 产品变更】旧值 ['忽略']：没说清点了会怎样
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
    // 【U17 产品变更】人读的那一行改成中文；服务器算好的英文原句移到 title（一字不丢）。
    // 旧断言：expect(read(ignored)).toContain('The sender may not originate work here.')
    // 这条测试的事实没变——操作者看到的是一句话，不是内部码——而且现在这句话是他自己的语言。
    expect(read(ignored)).toContain('这个发起者不在允许名单里')
    // .meta 里带 title 的 span 有两个：第一个是时间（title=绝对时刻），第二个才是原因原句。
    expect(all('.meta span[title]', ignored)[1]!.getAttribute('title')).toContain('The sender may not originate work here.')
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
    click(button('我看过了', decisionRow('陌生人的请求')))  // 【U23】旧按钮名「忽略」
    await settle()
    expect(last('POST decisions/decision-2/dismiss')?.body).toEqual({})
    expect(toastText()).toBe('已看过')  // 【U23】旧提示 '已忽略'
    // The row is also a way into its Ticket, so a click on 忽略 must not be read as a click on the row.
    expect(sent('GET tickets/ticket-2')).toHaveLength(0)
    // The list is read again, which is how the row learns it has been put away.
    // 【U1】同样限定到记录页自己的读（limit=80）；总览那条 limit=5 的预读是另一个读者，不算进这个事实。
    expect(sent('GET decisions').filter(call => call.query.get('limit') === '80')).toHaveLength(2)
  })

  it('marks a refusal that has been put away, and does not ask the server again', async () => {
    const { sent } = await mount(routes({ 'GET decisions': { count: 1, decisions: [{ ...refused, detail: `${refused.detail}\n[dismissed]` }] } }))
    await openDecisions()
    click(button('已看过', decisionRow('陌生人的请求')))  // 【U23】旧值 '已忽略'
    await settle()
    expect(toastText()).toBe('这条已经看过了')  // 【U23】旧提示 '这条已经忽略过了'
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
    // 【U6 产品变更】旧文案 '恢复内置'。现在每个角色卡里有「只恢复这个角色」，
    // 全局那颗若仍叫「恢复内置」，"点哪一个"就得靠位置猜——所以它改叫「两个都恢复内置」。断言的事实没变。
    click(button('两个都恢复内置'))
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
    expect(text('counts')).toBe('任务 2 进行中 · 1 等你回答 · 5 已结束')  // 【U17】旧断言 'Ticket 2 进行中 · 1 等人 · 5 已结束'
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
    // U21：归档与删除。加进这张表就意味着遍历必须真的点到它们——这张表的另一半职责是
    // "表里有一条没人问的路由 = 悄悄丢了个功能"，所以只加表不改遍历会让这条测试红。
    'POST projects/:id/archive', 'POST projects/:id/unarchive', 'POST projects/:id/delete',
    'POST works/:id/archive', 'POST works/:id/unarchive', 'POST works/:id/delete',
    'POST tickets/:id/work', 'GET tickets/:id/events', 'GET tickets/:id/dependencies',
    'POST tickets/:id/dependencies', 'POST tickets/:id/dependencies/drop',
    // 【0.11.0 产品变更】决断队列：总览读 GET，遍历里点一次「知道了」问 POST。
    'GET operator-queue', 'POST operator-queue/:id/dismiss',
  ]
  /** One call as a route of that table, with the record ids it carried turned back into parameters. */
  const routeOf = (call: Call): string => `${call.method} ${call.path
    .split('/')
    .map(part => /^(ticket|decision|trigger|assignment|policy|project|work)-/.test(part) ? ':id' : part)
    .join('/')}`

  it('asks only for routes the server has, so nothing it does can fail as a 404 nobody explains', async () => {
    // U21：这两条 GET 必须是**有状态**的桩。归档之后详情会重画，而重画读的是 GET；
    // 静态桩永远返回未归档的那条，按钮文案就永远回到「归档」，于是 unarchive 这条路由永远问不到。
    let projectArchived = false
    let workArchived = false
    const { calls } = await mount(scheduleRoutes({
      // 【0.11.0】给遍历一个真的要决断的条目，否则「知道了」永远不会被点到，
      // 而"表里有路由没人问"正是这条测试存在的一半理由。
      // id 用生产形状（decision-request-…）：遍历测试会把路径里的 id 归一化成 :id 再对照路由表，
      // 一个不像真 id 的 id 会以字面量进对照表，红在归一化而不是行为上。
      'GET operator-queue': { items: [{ id: 'decision-request-1', title: '要不要加心跳？', detail: '桥死时聊天侧沉默。', source: 'auto-retry', raisedAt: '2026-11-09T01:00:00.000Z' }] },
      'POST operator-queue/decision-request-1/dismiss': {},
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
      'GET works': { works: [work()] },
      'POST works': work(),
      // U21：归档与删除的六条路由要有桩，否则遍历点到它们时得到的是"无此路由"，
      // 于是归档根本没发生、后面的「取消归档」也就找不到——错误会报在离根因很远的地方。
      'GET projects/project-1': () => ({
        project: project(projectArchived ? { archivedAt: LATER } : {}), works: [work()],
      }),
      'POST projects/project-1/archive': () => { projectArchived = true; return project({ archivedAt: LATER }) },
      'POST projects/project-1/unarchive': () => { projectArchived = false; return project() },
      'POST projects/project-1/delete': { deleted: 'project-1', detachedWorks: 1 },
      'GET works/work-1': () => ({
        work: work(workArchived ? { archivedAt: LATER } : {}), tickets: [listed({ workId: 'work-1', workSeq: 1 })],
      }),
      'POST works/work-1/archive': () => { workArchived = true; return work({ archivedAt: LATER }) },
      'POST works/work-1/unarchive': () => { workArchived = false; return work() },
      'POST works/work-1/delete': { deleted: 'work-1', detachedTickets: 1 },
      'POST tickets/ticket-1/work': ticket({ workId: 'work-1', workSeq: 1 }),
      'GET tickets/ticket-1/events': { count: 1, returned: 1, events: [event()] },
      'GET tickets/ticket-1/dependencies': { waitsFor: [dep()], waitedOnBy: [] },
      'POST tickets/ticket-1/dependencies': dep(),
      'POST tickets/ticket-1/dependencies/drop': { dropped: 'ticket-2', waitsFor: [] },
    }))
    // 【0.11.0】落地页先把队列里那条决断点掉：它属于"只有操作者能推进的事"这一族。
    click(button('知道了', byId('ov-decisions')))
    await settle()
    // Every page, and the writes on them: the routes a person can reach by clicking around.
    for (const tab of ['工作', '派活', '记录', '聊天', '设置', '提示词']) {  // 【U7】门禁记录→记录；【U13】排期并入派活；【U14】来源→聊天
      click(button(tab))
      await settle()
    }
    // 【U14】健康与队列搬进了顶栏「状态」抽屉，所以遍历也必须打开它——否则 GET effects 就"没人问了"，
    // 而这条测试的一半职责正是"表里的路由不能悄悄丢掉"。抽屉不是页面，但它是操作者能点到的地方。
    click(byId('health'))
    await settle()
    // The 工作 page: drill into a Project, make both records, then follow a Work down to one of its Tickets.
    click(one('#projects li'))
    await settle()
    click(button('新建项目'))   // 【U20】先唤出表单
    await settle()
    type('pj-name', '竞品观察')
    click(button('创建项目'))
    await settle()
    click(button('新建工作'))   // 【U20】先唤出表单
    await settle()
    type('wk-name', '周报')
    click(button('创建工作'))
    await settle()
    // U21：六条新路由都要被真的问到。建一对一次性的项目与工作，归档、取消归档、再删掉。
    // 按 id 点而不是按文案：U20 之后那个唤出按钮点开就改口叫「收起」，而遍历前面已经开过一次，
    // 所以"点『新建项目』"这一步在这里根本找不到按钮（第一版就是这么红的）。先确认状态再点。
    if (byId('pj-form').classList.contains('hidden')) { click(byId('pj-toggle')); await settle() }
    type('pj-name', '竞品观察')
    click(button('创建项目'))
    await settle()
    // 按名字定位，而不是 `one('#projects li')`：后者会取到**已选中**的那一行，
    // 而"再点一次已选中的行"是取消选中（U20 那条设计），详情区就空了、也就没有「归档」按钮。
    const pickRow = (list: string, name: string): Element => {
      const found = all(`#${list} li`).find(node => read(node).includes(name))
      if (found === undefined) throw new Error(`列表 #${list} 里没有含「${name}」的行`)
      return found
    }
    // 选中一行，并且**确认它真的被选中了**：点到已选中的那行会取消选中，那就再点一次。
    const selectRow = async (list: string, name: string): Promise<void> => {
      click(pickRow(list, name))
      await settle()
      if (text('work-detail').includes('选择左边一个项目或工作')) { click(pickRow(list, name)); await settle() }
    }
    await selectRow('projects', '竞品观察')
    click(button('归档'))
    await settle()
    click(button('取消归档'))
    await settle()
    if (byId('wk-form').classList.contains('hidden')) { click(byId('wk-toggle')); await settle() }
    type('wk-name', '周报')
    click(button('创建工作'))
    await settle()
    await selectRow('works', '周报')
    click(button('归档'))
    await settle()
    click(button('取消归档'))
    await settle()
    // 删除是两步：第一步只出后果说明，第二步才真的发请求。
    click(button('删除'))
    await settle()
    click(button('确认删除'))
    await settle()
    await selectRow('projects', '竞品观察')
    click(button('删除'))
    await settle()
    click(button('确认删除'))
    await settle()
    // 上面把项目和工作都删了，详情区已经空掉；重新选回项目，后面那步才有 `.list li` 可点。
    await selectRow('projects', '竞品观察')
    click(one('#work-detail .list li'))
    await settle()
    click(button('我看过了', one('#decisions li')))  // 【U23】旧按钮名「忽略'
    await settle()
    click(button('记录'))
    click(button('任务'))  // 【U7 改名】旧文案 'Ticket'
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
    click(button('派活'))  // 【U13】旧写法 click(button('排期'))
    await settle()
    click(button('定时派'))
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
    click(button('两个都恢复内置'))  // 【U6】同上，旧文案 '恢复内置'
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
    click(button('聊天'))  // 【U14】聊天自成页，旧写法 button('来源')
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
    expect(text('chat')).toContain('受理模式：通过即执行')  // 【U17】旧断言 '受理模式 auto'
    // The allow-list is on this surface because it, not the map, decides whether a mapped identity may ask at all.
    expect(text('chat')).toContain('允许发起者：operator、alice')  // 【U17】旧断言 'allowedSenders operator、alice'
    expect(text('chat')).toContain('2 channel(s), 1 waiting (unmapped)')
    expect(text('chat')).toContain('最近触发')

    const tables = all('#chat table.plain')
    expect(tables).toHaveLength(2)
    // Tables rather than JSON, which is the standing complaint these three sections were rebuilt for.
    for (const node of tables) expect(read(node), read(node)).not.toMatch(/[[{}"]/)
    // 【U12 产品变更】频道表多了「操作」列——这一节原先只读，指引把人送去改 JSON，那就是记在案的债。
    // 旧断言：toEqual(['频道', '目录', '状态'])
    expect(all('th', tables[0]!).map(node => node.textContent)).toEqual(// 【N5 产品变更】频道表多了三列健康数据。旧值：['频道', '目录', '状态', '操作']。
      // 加它的理由：全局一个 waiting 数说不出是**哪个**频道，而"待取回信"长期非零就等于"桥没在跑"。
      ['频道', '目录', '状态', '积压', '待取回信', '最近进气', '操作'])
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
    click(button('聊天'))  // 【U14】聊天自成页，旧写法 button('来源')
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
    click(button('聊天'))  // 【U14】聊天自成页，旧写法 button('来源')
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
    click(button('聊天'))  // 【U14】聊天自成页，旧写法 button('来源')
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
    click(button('聊天'))  // 【U14】聊天自成页，旧写法 button('来源')
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

  // 【U14】丢失的请求搬进「记录」页，而进这一页会连判定一起读——所以夹具要桩上 GET decisions，
  // 否则这 12 条测试红在一个与本包无关的 404 上。
  const lostRoutes = (over: Routes = {}): Routes => routes({
    'GET state': lostState(), 'GET lost': lostBody(), 'GET decisions': { count: 0, decisions: [] }, ...over,
  })

  it('shows both paths, and keeps them apart because they are two different facts', async () => {
    await mount(lostRoutes())
    click(button('记录'))  // 【U14】丢失的请求归记录页，旧写法 button('来源')
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
    click(button('记录'))  // 【U14】丢失的请求归记录页，旧写法 button('来源')
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
    click(button('记录'))  // 【U14】丢失的请求归记录页，旧写法 button('来源')
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
    click(button('记录'))  // 【U14】丢失的请求归记录页，旧写法 button('来源')
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
    click(button('记录'))  // 【U14】丢失的请求归记录页，旧写法 button('来源')
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
    click(button('记录'))  // 【U14】丢失的请求归记录页，旧写法 button('来源')
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
    click(button('记录'))  // 【U14】丢失的请求归记录页，旧写法 button('来源')
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
    click(button('记录'))  // 【U14】丢失的请求归记录页，旧写法 button('来源')
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
    click(button('记录'))  // 【U14】丢失的请求归记录页，旧写法 button('来源')
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
    click(button('记录'))  // 【U14】丢失的请求归记录页，旧写法 button('来源')
    await settle()
    // There is no route that could re-drive one — the queue deleted its row when it gave up — and a button that can
    // only fail is worse than no button, which is why this page has removed one before. So the remedy is a sentence.
    expect(text('tab-decisions')).toContain('这里没有「重放」按钮，因为它做不到')  // 【U14】旧为 tab-sources
    expect(text('tab-decisions')).toContain('系统也不会自动重放它')
    // The part that is easy to get wrong and that §4.45 fixed: `lost` is not a duplicate, so the gate really does run
    // again on the same request. Without this the honest remedy reads as a dead end.
    expect(text('tab-decisions')).toContain('lost 行不算重复')
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
    click(button('记录'))  // 【U14】丢失的请求归记录页，旧写法 button('来源')
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
    click(button('记录'))  // 【U14】丢失的请求归记录页，旧写法 button('来源')
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

describe('总览：落地页回答"有什么需要我"（U1）', () => {
  it('落地就是总览，而"需要你处理"里直接给出回答框，不必先钻进详情页', async () => {
    const { sent, last } = await mount(routes({
      'POST tickets/ticket-1/answer': { ok: true },
    }))
    // 落地页是总览：这是 U1 的全部理由（§6.1 收件箱心智），所以要显式钉住，而不是靠"恰好"。
    expect(byId('tab-overview').classList.contains('hidden')).toBe(false)
    expect(byId('tab-tickets').classList.contains('hidden')).toBe(true)
    // 等你回答的任务出现在总览里，带着它自己的问题原文和一个行内回答框。
    expect(text('ov-attention')).toContain('整理本周竞品动态')
    // 列表接口带的是 summary，不是 question（那是详情接口的字段）——总览显示前者，问题原文在详情里。
    expect(text('ov-attention')).toContain('读完了三份文件')
    const box = input('ov-answer-ticket-1')
    expect(box).toBeTruthy()

    // 行内回答走的是详情页同一条路由，没有第二套写法。按钮叫「发送」（行内快速回复），不叫「回答」。
    type('ov-answer-ticket-1', '按 A 报表算')
    click(button('发送', byId('ov-attention')))
    await settle()
    expect(sent('POST tickets/ticket-1/answer')).toHaveLength(1)
    expect(last('POST tickets/ticket-1/answer')?.body).toEqual({ text: '按 A 报表算' })
    expect(toastText()).toBe('已回答')
  })

  it('正在输入的回答不会被 5 秒刷新吃掉——这条纪律在总览同样成立', async () => {
    await mount(routes())
    type('ov-answer-ticket-1', '写到一半')
    // 一次完整刷新（load() 会重画总览）。详情页为此有 draft+焦点保护，总览复用同一条纪律。
    await tick(5000)
    expect(input('ov-answer-ticket-1').value).toBe('写到一半')
  })

  it('没有需要你处理的事时说的是这句话，而不是一排 0 和空白', async () => {
    await mount(routes({
      'GET tickets': { offset: 0, limit: 80, count: 0, tickets: [] },
    }))
    expect(text('ov-attention')).toContain('系统安静，没有需要你处理的事')
  })

  it('把停着的决断放在总览，并且「知道了」只走那一条 dismiss 路由', async () => {
    const { sent } = await mount(routes({
      'GET operator-queue': { items: [{ id: 'd-1', title: '要不要给桥加心跳？', detail: '桥死掉时聊天侧完全沉默。', source: 'ticket:abc123', raisedAt: '2026-11-09T01:00:00.000Z' }] },
      'POST operator-queue/d-1/dismiss': {},
    }))
    // 标题、来由与来源都在卡片上：一个只有标题的队列条目等于让操作者自己再去查一遍上下文。
    expect(text('ov-decisions')).toContain('要不要给桥加心跳？')
    expect(text('ov-decisions')).toContain('桥死掉时聊天侧完全沉默。')
    expect(text('ov-decisions')).toContain('ticket:abc123')
    click(button('知道了', byId('ov-decisions')))
    await settle()
    expect(sent('POST operator-queue/d-1/dismiss')).toHaveLength(1)
  })

  it('队列读不到时明说不可信，而不是留成永远的"读取中"', async () => {
    await mount(routes({ 'GET operator-queue': refuse(500, 'boom') }))
    expect(text('ov-decisions')).toContain('读不到决断队列')
  })

  it('KPI 一排把"只有你能推进的事"放在视线落点，而机器路径不在其中', async () => {
    await mount(routes())
    const labels = all('#ov-kpis .l').map(node => read(node))
    expect(labels).toEqual(['进行中的任务', '等你回答', '工作槽', '系统健康', '聊天等映射', '丢失的请求'])
    // 排障时才看的东西不该占落地页的一格（§6.1：每个元素必须回答五个问题之一）。
    expect(text('ov-kpis')).not.toContain('/Users/')
    expect(text('ov-kpis')).not.toContain('state')
  })

  it('总览不自己再读一遍任务列表：一次读、两处用', async () => {
    const { sent } = await mount(routes())
    // 列表页与总览的「等你回答」是同一份数据；两条读会让落地页多一个请求，还可能两个数不一致。
    expect(sent('GET tickets')).toHaveLength(1)
    expect(sent('GET tickets')[0]!.query.get('state')).toBe('open')
  })
})

describe('健康抽屉与打通（U2 / U3）', () => {
  const BAD_ID = '19dd5c9ca7bce11fb2c9f7a2b04728b0'

  it('状态胶囊点一下就打开抽屉，抽屉里是每个部件的原文，而不是一句"N 个问题"', async () => {
    await mount(routes({
      'GET state': state({
        health: { sessions: { ok: false, detail: 'the main Session: LlmError: 500', at: AT }, effects: { ok: true, detail: 'no effect failed in this pass' } },
      }),
      'GET effects': { counts: { send: 2 } },
    }))
    // 落地时抽屉是关的：一个默认就开着的抽屉等于没有抽屉。
    expect(byId('health-drawer').classList.contains('hidden')).toBe(true)
    click(byId('health'))
    await settle()
    expect(byId('health-drawer').classList.contains('hidden')).toBe(false)
    const body = text('health-drawer-body')
    // 原文，不是概述：操作者要读的是那句 LlmError，而不是"1 个问题"。
    expect(body).toContain('the main Session: LlmError: 500')
    expect(body).toContain('no effect failed in this pass')
    // 队列也在同一个抽屉里，因为"哪里不对"和"还堆着多少事"是一起看的。
    expect(body).toContain('send')
    expect(text('drawer-sub')).toBe('1 个部件有问题')
  })

  it('问题文本里的任务 id 是入口，不是要抄下来的字符串', async () => {
    await mount(routes({
      'GET state': state({ health: { sessions: { ok: false, detail: `Ticket ${BAD_ID}: LlmError: 429`, at: AT } } }),
      'GET effects': { counts: {} },
      [`GET tickets/${BAD_ID}`]: ticket({ id: BAD_ID, title: '信息比对' }),
      [`GET tickets/${BAD_ID}/progress`]: progress(),
      [`GET tickets/${BAD_ID}/files`]: files(),
      [`GET tickets/${BAD_ID}/dependencies`]: { waitsFor: [], waitedOnBy: [] },
      [`GET tickets/${BAD_ID}/events`]: { count: 0, returned: 0, events: [] },
    }))
    click(byId('health'))
    await settle()
    const link = one('#health-drawer-body button.linklike')
    expect(read(link)).toBe('19dd5c9c…')
    expect(link.getAttribute('title')).toBe(BAD_ID)
    click(link)
    await settle()
    // 一步从"哪里不对"走到"哪个任务不对"：抽屉关掉、切到任务页、详情就是那张。
    expect(byId('health-drawer').classList.contains('hidden')).toBe(true)
    expect(byId('tab-tickets').classList.contains('hidden')).toBe(false)
    expect(read(one('#detail h2'))).toBe('信息比对')
  })

  it('Esc 与点遮罩都能关掉抽屉，因为一个关不掉的抽屉会挡住整页', async () => {
    await mount(routes({ 'GET effects': { counts: {} } }))
    click(byId('health'))
    await settle()
    expect(byId('health-drawer').classList.contains('hidden')).toBe(false)
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(byId('health-drawer').classList.contains('hidden')).toBe(true)
    expect(byId('drawer-backdrop').classList.contains('hidden')).toBe(true)

    click(byId('health'))
    await settle()
    click(byId('drawer-backdrop'))
    expect(byId('health-drawer').classList.contains('hidden')).toBe(true)
  })

  it('归属那行点一下就打开那条工作，不再是要自己去别页找的死文本（U3 缺口 1）', async () => {
    await mount(routes({
      'GET tickets/ticket-1': ticket({ workId: 'work-1', workSeq: 3 }),
      'GET works': { works: [work({ id: 'work-1', name: '周报' })] },
      'GET works/work-1': { work: work({ id: 'work-1', name: '周报' }), tickets: [] },
    }))
    await openListed()
    // U4 之后 kv 里有两个 linklike（Ticket 短码也算），所以要沿「归属」这个 dt 找到它自己的 dd，不能全页搜。
    const term = all('#detail .kv dt').find(node => node.textContent === '归属')
    const link = one('button.linklike', term!.nextElementSibling!)
    expect(read(link)).toBe('周报（work-1）')
    click(link)
    await settle()
    expect(byId('tab-works').classList.contains('hidden')).toBe(false)
    expect(read(one('#work-detail'))).toContain('周报')
  })

  it('聊天等待与丢失两个胶囊都能点，直达各自的分区（U3 缺口 3/4）', async () => {
    // mount() 收的是路由表，不是 state 文档——第一版把 chatState(...) 直接传了进去，于是 'GET state' 没人应答、
    // 404、头部根本没画，红得莫名其妙。state 要走 'GET state' 这条路由进来。
    await mount(routes({
      'GET state': chatState({
        chat: chatView({ waiting: { count: 2, ids: ['U01ABCDEF'] } }),
        counts: { ...(chatState().counts as Record<string, unknown>), lost: { rows: 1, payloads: 0 } },
      }),
      // counts.lost 在场 → 页面不再把它当"这个 bundle 没有 lost 视图"，所以进来源页会真的去读详情。
      'GET lost': {
        total: 1, shown: 1, bounds: { keep: 20, chars: 1000 },
        rows: [{ id: 'trigger-lost-1', source: 'chat', kind: 'chat', at: AT, title: '一条被放弃的请求', error: 'Error: gave up', effectKey: 'k' }],
        payloads: [],
      },
    }))
    // 两个胶囊都因为非零而现身，且都带着"可点"的线索。
    expect(byId('chat-waiting').classList.contains('hidden')).toBe(false)
    expect(byId('chat-waiting').className).toContain('clickable')
    expect(byId('lost-count').classList.contains('hidden')).toBe(false)
    expect(byId('lost-count').className).toContain('clickable')

    // 【U14】两个胶囊不再落到同一页：聊天等待去「聊天」，丢失去「记录」。旧断言两处都是 tab-sources 可见。
    click(byId('chat-waiting'))
    await settle()
    expect(byId('tab-chat').classList.contains('hidden')).toBe(false)

    click(button('总览'))
    await settle()
    click(byId('lost-count'))
    await settle()
    expect(byId('tab-decisions').classList.contains('hidden')).toBe(false)
  })

  it('键盘也能打开抽屉：role=button 就得配 Enter，否则"可点"只对用鼠标的人成立', async () => {
    await mount(routes({ 'GET effects': { counts: {} } }))
    expect(byId('health').getAttribute('role')).toBe('button')
    expect(byId('health').getAttribute('tabindex')).toBe('0')
    byId('health').dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await settle()
    expect(byId('health-drawer').classList.contains('hidden')).toBe(false)
  })
})

describe('Esc 的优先级与空态的下一步（U10）', () => {
  it('Esc 收起打开着的文件查看器', async () => {
    await mount(routes())
    await openListed()
    click(button('报告.md'))
    await settle()
    expect(text('d-fileview')).toContain('报告.md')
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    // 收起就是清空：留一个空壳在那里，操作者会以为还在读。
    expect(text('d-fileview')).toBe('')
  })

  it('抽屉开着时 Esc 先关抽屉，不动文件查看器（一个键三件事，按挡视线的程度排优先级）', async () => {
    // 文件正文要有 `.view`，就得把单文件路由桩上（`served()`）：只桩目录列表 `files` 的话，
    // 打开文件会 404、查看器画的是错误行，而我新加的那条守卫会红在一个与 Esc 无关的原因上。
    await mount(routes({ 'GET effects': { counts: {} }, 'GET tickets/ticket-1/file': served() }))
    await openListed()
    click(button('报告.md'))
    await settle()
    click(byId('health'))
    await settle()
    expect(byId('health-drawer').classList.contains('hidden')).toBe(false)
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(byId('health-drawer').classList.contains('hidden')).toBe(true)
    // 文件查看器不该被连带关掉：Esc 一次只关一层。
    expect(text('d-fileview')).toContain('报告.md')
    // 第二条独立守卫（0.8 强形式量出上面那条在 jsdom 里是**唯一**守卫：删掉它，"两层一起关"的变异就无人发现）。
    // 钉的是另一个 DOM 事实——查看器里那个装着文件正文的 `.view` 还在，而不是同一句话换个说法。
    expect(all('#d-fileview .view')).toHaveLength(1)
    expect(read(button('收起', byId('d-fileview')))).toBe('收起')
  })

  it('空态的下一步按钮真的走到那一步，而不是一个装饰', async () => {
    await mount(routes({ 'GET tickets': { offset: 0, limit: 80, count: 0, tickets: [] } }))
    click(button('任务'))
    await settle()
    click(button('去派活', byId('tickets')))
    await settle()
    expect(byId('tab-new').classList.contains('hidden')).toBe(false)
  })
})

describe('平台接入页与每频道健康（N5）', () => {
  const facts = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    id: 'ops', enabled: true, waiting: 2, settling: 0, pendingReplies: 3,
    lastAcceptedAt: LATER, ...over,
  })
  /**
   * 频道表是从 **settings** 建的，健康数是从 Source 的 `channels()` 来的——两个来源，同一批 id。
   * 只给一个的话表里根本没有那一行（第一版就是这么红的：`rows.find(...)` 返回 undefined）。
   */
  const chatWith = (facts: Record<string, unknown>[]): Routes => {
    const channels = facts.map(fact => ({ id: fact.id as string, directory: `/tmp/ch/${fact.id as string}`, enabled: true }))
    return routes({
      'GET state': chatState({
        chat: chatView({ channels: facts, waiting: { count: 2, ids: ['U9'] } }),
        settings: { ...(chatState().settings as Record<string, unknown>),
          sources: { chat: { enabled: true, identities: {}, channels } } },
      }),
    })
  }

  it('频道表把三个健康数分开报，并且"读不到"不与"没人写"混成同一片零', async () => {
    await mount(chatWith([facts(), facts({ id: 'dev', waiting: 0, pendingReplies: 0, lastAcceptedAt: undefined }),
      facts({ id: 'broken', waiting: 0, pendingReplies: 0, error: 'ENOTDIR: not a directory' })]))
    click(button('聊天'))
    await settle()
    const rows = all('#chat table tbody tr').map(node => all('td', node).map(cell => read(cell)))
    const byId = Object.fromEntries(rows.map(cells => [cells[0] as string, cells]))
    expect(byId.ops).toBeDefined()
    // 待取回信 = 3 是"桥没在跑"的信号，所以要显眼（warn），并且 title 说明它是什么。
    const pending = all('#chat table tbody tr')[0]!.querySelectorAll('td')[4]!
    expect(read(pending)).toBe('3')
    expect(pending.querySelector('span')!.getAttribute('title')).toContain('桥没在跑')
    // 读不到的频道说"读不到"并把原因放 title，而不是显示 0——0 与"健康的安静频道"长得一样。
    const brokenRow = rows.find(cells => cells[0] === 'broken')!
    expect(brokenRow[2]).toBe('读不到')
    expect(brokenRow[3]).toBe('—')
    // 从没受理过消息的频道说"还没有"，而不是编一个时间。
    const devRow = rows.find(cells => cells[0] === 'dev')!
    expect(devRow[5]).toBe('还没有')
  })

  it('旧 bundle 没有 channels() 时不画数字——缺席就是缺席，画成 0 是撒谎', async () => {
    await mount(chatWith([]))
    click(button('聊天'))
    await settle()
    const cells = all('#chat table tbody tr')[0]?.querySelectorAll('td')
    expect(cells === undefined || read(cells[3]!) === '—').toBe(true)
  })

  it('平台目录把没做的和不能做的也列出来，并当场说清，而不是让人以为配置没找对', async () => {
    await mount(chatWith([facts()]))
    click(button('聊天'))
    await settle()
    const labels = all('#platform-pick .chip-btn').map(node => read(node))
    expect(labels.some(label => label.includes('Telegram'))).toBe(true)
    expect(labels.some(label => label.includes('飞书'))).toBe(true)
    expect(labels.some(label => label.includes('企业微信（未做）'))).toBe(true)
    expect(labels.some(label => label.includes('个人微信 / 个人 QQ（无官方路径）'))).toBe(true)
    // 选中"无官方路径"那一项时，说清为什么不做并给替代，而不是给一份跑不通的步骤。
    click(button('个人微信 / 个人 QQ（无官方路径）'))
    await settle()
    expect(text('platform-guide')).toContain('没有官方机器人 API')
    expect(text('platform-guide')).toContain('企业微信')
    expect(text('platform-guide')).not.toContain('env 文件')
  })

  it('就绪的平台给分步、env 变量名与可复制的命令', async () => {
    await mount(chatWith([facts()]))
    click(button('聊天'))
    await settle()
    click(button('飞书 / Lark'))
    await settle()
    expect(text('platform-guide')).toContain('im.message.receive_v1')
    expect(text('platform-guide')).toContain('LARK_APP_ID=')
    expect(text('platform-guide')).toContain('npm install')
    // 三条平台硬约束要出现在界面上，而不是只在源码注释里。
    expect(text('platform-guide')).toContain('一个应用只能跑一个桥')
    expect(text('platform-guide')).toContain('3 秒')
    click(button('Telegram'))
    await settle()
    expect(text('platform-guide')).toContain('TELEGRAM_BOT_TOKEN=')
    expect(text('platform-guide')).toContain('@BotFather')
    // 那一秒的稳定窗口要写出来，否则操作者会把"发出去没反应"当故障报。
    expect(text('platform-guide')).toContain('1 秒')
  })

  it('生成的守护单元只引用 env 文件，绝不内联凭据', async () => {
    await mount(chatWith([facts()]))
    click(button('聊天'))
    await settle()
    type('unit-repo', '/srv/myagent')
    click(button('systemd'))
    await settle()
    const unit = text('platform-guide')
    expect(unit).toContain('EnvironmentFile=')
    expect(unit).toContain('ExecStart=/usr/bin/env node /srv/myagent/bridges/telegram/bridge.mjs')
    expect(unit).toContain('Restart=always')
    click(button('launchd'))
    await settle()
    const plist = text('platform-guide')
    // launchd 没有 EnvironmentFile，所以用 shell 先 source 再 exec——凭据仍然不进 plist。
    expect(plist).toContain('set -a; . ')
    expect(plist).toContain('KeepAlive')
    // `~` 在两种单元里都不展开，而且原因不同（systemd 不做 shell 展开；launchd 那层写在双引号里，
    // 而双引号内波浪号不展开）。这是实装时真的踩到的：终端里能跑，当守护进程就找不到 env 文件。
    expect(unit).toContain('EnvironmentFile=%h/.config/myagent/bridges/')
    expect(unit).not.toContain('EnvironmentFile=~/')
    expect(plist).toContain('"$HOME/.config/myagent/bridges/')
    expect(plist).not.toContain('"~/')
    // 操作者填了 ~/ 开头的路径也要被换成目标格式，而不是原样塞进单元里。
    type('unit-env', '~/secrets/tg.env')
    click(button('systemd'))
    await settle()
    expect(text('platform-guide')).toContain('EnvironmentFile=%h/secrets/tg.env')
    expect(plist).toContain('ai.myagent.bridge.')
    // 两种单元都不许出现"带着值的凭据赋值"。第一版写的是 /TOKEN\s*=\s*\S/，太松：
    // 引导里的 env 模板本身就是 `TELEGRAM_BOT_TOKEN=` 后跟换行与注释，于是把自己的模板判成了泄漏。
    // 要钉的事实是**凭据行一律留空**，所以匹配"= 后面跟着一段像值的字符"。
    for (const text_ of [unit, plist]) {
      expect(text_).not.toMatch(/(TOKEN|SECRET|KEY|PASSWORD)\s*=\s*["']?[A-Za-z0-9_\-]{8,}/)
    }
    // 并且引导给出的每一个凭据变量都留空，等操作者自己填——面板从不代填，也就从不曾见过那个值。
    const envLines = all('#platform-guide pre')[0] !== undefined ? read(all('#platform-guide pre')[0]!) : ''
    for (const name of ['TELEGRAM_BOT_TOKEN', 'MYAGENT_CHANNEL_DIR']) {
      expect(envLines).toContain(`${name}=`)
      expect(envLines).not.toContain(`${name}=?`)
    }
    expect(envLines.split('\n').filter(line => /^[A-Z_]+=[^\s]/.test(line))).toEqual([])
  })
})

describe('归档与完全删除（U21）', () => {
  // 本地夹具：workRoutes / openWorks 都是「works and projects」那个 describe 的局部函数（本文件已因此错过五次）。
  const myRoutes = (over: Routes = {}): Routes => routes({
    'GET projects': { projects: [project()] },
    'GET works': { works: [work()] },
    'GET projects/project-1': { project: project(), works: [work()] },
    'GET works/work-1': { work: work(), tickets: [listed({ workId: 'work-1', workSeq: 1 })] },
    // U21 的六条路由：默认桩成"名下有一条"的返回值，这样 toast 里的数字有东西可断言。
    'POST projects/project-1/archive': project({ archivedAt: LATER }),
    'POST projects/project-1/unarchive': project(),
    'POST projects/project-1/delete': { deleted: 'project-1', detachedWorks: 1 },
    'POST works/work-1/archive': work({ archivedAt: LATER }),
    'POST works/work-1/unarchive': work(),
    'POST works/work-1/delete': { deleted: 'work-1', detachedTickets: 1 },
    ...over,
  })
  const openWorksPage = async (): Promise<void> => { click(button('工作')); await settle() }
  const selectRow = async (list: string, name: string): Promise<void> => {
    const pick = (): Element => {
      const found = all(`#${list} li`).find(node => read(node).includes(name))
      if (found === undefined) throw new Error(`列表 #${list} 里没有含「${name}」的行`)
      return found
    }
    click(pick())
    await settle()
    // 点到已选中的那一行是"取消选中"（U20 的设计），那就再点一次把它选回来。
    if (text('work-detail').includes('选择左边一个项目或工作')) { click(pick()); await settle() }
  }

  it('详情区给归档与删除，删除是两步且第一步就把后果写成带数字的一句话', async () => {
    const { sent } = await mount(myRoutes())
    await openWorksPage()
    await selectRow('projects', '竞品观察')
    expect(read(button('归档'))).toBe('归档')
    expect(read(button('删除'))).toBe('删除')
    // 第一步：只出后果说明，不发请求。操作者要判断的正是那个数字是不是 0。
    click(button('删除'))
    await settle()
    expect(sent('POST projects/project-1/delete')).toHaveLength(0)
    expect(text('work-detail')).toContain('它名下 1 条工作会失去这个归属（它们本身与历史都保留）')
    expect(text('work-detail')).toContain('不可撤销')
    // 取消就什么都不发生。按钮要**限定在详情区**：U20 之后这一页上还有两个表单各自的「取消」，
    // 全局找会得到 4 个同名按钮（这一条就是这么红的）。
    click(button('取消', one('#work-detail')))
    await settle()
    expect(sent('POST projects/project-1/delete')).toHaveLength(0)
    // 第二步才真的删，并且 toast 把数字再说一遍。
    click(button('删除'))
    await settle()
    click(button('确认删除'))
    await settle()
    expect(sent('POST projects/project-1/delete')).toHaveLength(1)
    expect(toastText()).toContain('1 条工作失去了这个归属')
    expect(toastText()).toContain('它们本身与它们的历史都还在')
  })

  it('归档之后从列表消失，「显示已归档（N）」能把它带回来并标明，取消归档恢复原状', async () => {
    let archived = false
    const { sent } = await mount(myRoutes({
      'GET projects': () => ({ projects: [project(archived ? { archivedAt: LATER } : {})] }),
      'GET projects/project-1': () => ({ project: project(archived ? { archivedAt: LATER } : {}), works: [work()] }),
      'POST projects/project-1/archive': () => { archived = true; return project({ archivedAt: LATER }) },
      'POST projects/project-1/unarchive': () => { archived = false; return project() },
    }))
    await openWorksPage()
    await selectRow('projects', '竞品观察')
    click(button('归档'))
    await settle()
    expect(sent('POST projects/project-1/archive')).toHaveLength(1)
    expect(toastText()).toContain('不再出现在列表与「归入工作」的选择里')
    // 列表里没有了（默认不看已归档），但开关说清有一个可以拿回来。
    expect(all('#projects li').some(node => read(node).includes('竞品观察'))).toBe(false)
    expect(read(button('显示已归档（1）'))).toBe('显示已归档（1）')
    click(button('显示已归档（1）'))
    await settle()
    const row = all('#projects li').find(node => read(node).includes('竞品观察'))!
    expect(read(row)).toContain('已归档')
    // 拿回来是一步的事：归档不能是单向门。
    await selectRow('projects', '竞品观察')
    expect(read(button('取消归档'))).toBe('取消归档')
    click(button('取消归档'))
    await settle()
    expect(sent('POST projects/project-1/unarchive')).toHaveLength(1)
    expect(all('#projects li').some(node => read(node).includes('竞品观察'))).toBe(true)
  })

  it('删掉一个工作，它名下的任务不再指着它，而 toast 说清有几张被解除归属', async () => {
    const { sent, last } = await mount(myRoutes({
      'POST works/work-1/delete': { deleted: 'work-1', detachedTickets: 1 },
    }))
    await openWorksPage()
    await selectRow('works', '周报')
    click(button('删除'))
    await settle()
    expect(text('work-detail')).toContain('它名下 1 张任务会失去这个归属')
    click(button('确认删除'))
    await settle()
    expect(sent('POST works/work-1/delete')).toHaveLength(1)
    expect(toastText()).toContain('1 张任务失去了这个归属')
    // 删掉的东西不能还留在选中态里，否则详情区会去读一个已经不存在的 id。
    expect(last('GET works/work-1')).toBeDefined()
  })

  it('归属下拉不再提供已归档的工作，但这张任务当前所在的那个必须还在', async () => {
    await mount(myRoutes({
      'GET works': { works: [work(), work({ id: 'work-2', name: '月报', archivedAt: LATER })] },
      'GET tickets/ticket-1': ticket({ workId: 'work-2', workSeq: 1 }),
    }))
    click(button('任务'))
    await settle()
    await openListed()
    const options = all('#d-work option').map(node => read(node))
    // 在用的那条照常提供。
    expect(options).toContain('周报')
    // 已归档的那条**因为这张任务正在里面**而留着，并且标明它已归档——否则下拉会静默丢掉现值。
    expect(options).toContain('月报（已归档）')
    // 再建一个已归档但无关的工作，它不该出现在选项里。
  })

  it('任务行仍然叫得出已归档工作的名字——命名索引含已归档，选择列表才排除', async () => {
    await mount(myRoutes({
      // 这张任务在一个已归档的工作里。行上要是显示"工作 work-1"，操作者就没法用了。
      'GET works': { works: [work({ archivedAt: LATER })] },
      'GET tickets': { offset: 0, limit: 80, count: 1, tickets: [listed({ workId: 'work-1', workSeq: 1 })] },
    }))
    click(button('任务'))
    await settle()
    expect(text('tickets')).toContain('周报 · 第 1 位')
    expect(text('tickets')).not.toContain('工作 work-1')
  })
})

describe('派活页细节（U24）', () => {
  it('模式开关是分段控件，且当前档有一句说明——控件的份量要配得上它切换的东西', async () => {
    await mount(scheduleRoutes())
    click(button('派活'))
    await settle()
    expect(one('#dispatch-mode').className).toContain('seg')
    expect(all('#dispatch-mode .chip-btn')).toHaveLength(2)
    // 默认档与它的说明对得上（说明不是装饰：它回答"我现在在哪一档、点了会怎样"）。
    expect(text('dispatch-mode-hint')).toContain('现在派一张')
    click(button('定时派'))
    await settle()
    expect(text('dispatch-mode-hint')).toContain('到点自动派')
    expect(all('#dispatch-mode .chip-btn')[1]!.getAttribute('aria-pressed')).toBe('true')
  })

  it('「标识」改名为「排期代号」，而那条随上下文变化的提示没有被折起来', async () => {
    await mount(scheduleRoutes())
    click(button('派活'))
    await settle()
    click(button('定时派'))
    await settle()
    click(button('新建排期'))
    await settle()
    expect(read(one('label[for="s-id"]'))).toBe('排期代号')
    // s-id-hint 是 JS 动态写的（编辑已有排期时会变成"不可改"的警告），所以它必须留在明面上：
    // U18 折叠的是静态说明墙，不是随上下文变化的警告。
    expect(text('s-id-hint')).toContain('小写字母开头')
    expect(byId('s-id-hint').closest('details')).toBe(null)
  })

  it('三个范围字段的 placeholder 是默认值的**原文**，并与 policy.ts 的 DEFAULT_SCOPE 逐字一致', async () => {
    // 这条是防漂移守卫：原先标签写"用默认：只在自己的目录里工作"，而留空真正得到的是 policy.ts 里那句英文——
    // 转述与实值不一致，操作者按转述理解就会错。所以不再转述，而是把原文放进 placeholder，
    // 并且**直接读 policy.ts 比对**：常量改了而面板没跟着改，这条会红。
    // jsdom 环境下 import.meta.url 不是 file scheme，用相对 cwd 的路径（vitest 的 cwd 就是包根）
    const policy = readFileSync('src/core/policy.ts', 'utf8')
    const m = /const DEFAULT_SCOPE = '((?:[^'\\]|\\.)*)'/.exec(policy)
    expect(m, 'policy.ts 里找不到 DEFAULT_SCOPE').not.toBe(null)
    const expected = (m![1] as string).replace(/\\'/g, "'")
    expect(expected).toContain("Work in this Ticket's own directory")

    // 第二条独立守卫：直接读面板**源文件**数这句原文出现几次（不经渲染、不经 DOM）。
    // 0.8 强形式量出上面那条 DOM 断言是 jsdom 里唯一的守卫——删掉它，"placeholder 退回中文转述"的变异就无人发现。
    // 这条与它守的是不同层面：一个说"页面上画出来的是原文"，一个说"源文件里三处都写着原文"。
    const panelSrc = readFileSync('panel/index.html', 'utf8')
    expect(panelSrc.split(`placeholder="${expected}"`).length - 1).toBe(3)

    await mount(scheduleRoutes())
    for (const id of ['n-scope', 'wk-scope']) {
      expect(byId(id).getAttribute('placeholder'), id).toBe(expected)
    }
    click(button('派活'))
    await settle()
    click(button('定时派'))
    await settle()
    click(button('新建排期'))
    await settle()
    expect(byId('s-scope').getAttribute('placeholder')).toBe(expected)
  })
})

describe('记录页分区、被拒筛选、看过了（U23）', () => {
  const MY_DECISIONS = {
    count: 3,
    decisions: [
      { id: 'd-1', triggerId: 'trigger-7', outcome: 'accept', at: LATER, reason: 'accepted', reasonText: 'admitted', title: '信息比对' },
      { id: 'd-2', triggerId: 'trigger-9', outcome: 'ignore', at: LATER, reason: 'sender_not_allowed', reasonText: 'not allowed', title: '陌生人的请求' },
      { id: 'd-3', triggerId: 'trigger-10', outcome: 'observe', at: LATER, reason: 'observed', reasonText: 'observe mode', title: '留档的那条' },
    ],
  }

  it('有丢失时进记录页先看丢失——异常排在常态前面', async () => {
    const { sent } = await mount(routes({
      'GET decisions': MY_DECISIONS,
      'GET state': state({ counts: { ...(state().counts as Record<string, unknown>), lost: { rows: 2, payloads: 0 } } }),
      'GET lost': { total: 2, shown: 2, rows: [], payloads: [], bounds: { keep: 20, chars: 1000 } },
    }))
    click(button('记录'))
    await settle()
    expect(byId('card-lost').classList.contains('hidden')).toBe(false)
    expect(byId('card-decisions').classList.contains('hidden')).toBe(true)
    // 读取不跟随分区：进页两个都读（分区只决定先看哪块）。
    // 不断言恰好 1 次——settle() 会推进假时钟，5 秒刷新会再读一轮；要钉的事实是"两个都读了"。
    expect(sent('GET decisions').length).toBeGreaterThan(0)
    expect(sent('GET lost').length).toBeGreaterThan(0)
    click(button('判定'))
    await settle()
    expect(byId('card-decisions').classList.contains('hidden')).toBe(false)
    expect(byId('card-lost').classList.contains('hidden')).toBe(true)
  })

  it('没有丢失时进记录页先看判定，徽标只说丢失这一件事', async () => {
    await mount(routes({ 'GET decisions': MY_DECISIONS }))
    click(button('记录'))
    await settle()
    expect(byId('card-decisions').classList.contains('hidden')).toBe(false)
    expect(byId('badge-decisions').classList.contains('hidden')).toBe(true)
    expect(all('#records-nav .chip-btn')[1]!.getAttribute('aria-pressed')).toBe('false')
  })

  it('「只看被拒」筛出 ignore 与 unavailable，留档那一档筛出 observe——计数写在标签上', async () => {
    await mount(routes({ 'GET decisions': MY_DECISIONS }))
    click(button('记录'))
    await settle()
    const chips = all('#decision-filter .chip-btn')
    expect(chips.map(node => read(node))).toEqual(['全部（3）', '只看被拒（1）', '只看留档（1）'])
    click(button('只看被拒（1）'))
    await settle()
    expect(all('#decisions li')).toHaveLength(1)
    expect(text('decisions')).toContain('陌生人的请求')
    click(button('只看留档（1）'))
    await settle()
    expect(all('#decisions li')).toHaveLength(1)
    expect(text('decisions')).toContain('留档的那条')
    click(button('只看被拒（1）'))
    await settle()
    expect(text('decisions')).toContain('陌生人的请求')
  })

  it('筛完是空的时候说"这一批里没有"，而不是说"还没有判定"——后者是假话', async () => {
    await mount(routes({
      'GET decisions': {
        count: 1,
        decisions: [{ id: 'd-1', triggerId: 't', outcome: 'accept', at: LATER, reason: 'accepted', title: '只有受理' }],
      },
    }))
    click(button('记录'))
    await settle()
    click(button('只看被拒（0）'))
    await settle()
    expect(text('decisions')).toContain('这一批里没有被判"被拒"的')
    expect(text('decisions')).not.toContain('还没有判定')
  })

  it('「我看过了」的按钮带着后果说明，而且点过之后换一个名字', async () => {
    await mount(routes({ 'GET decisions': MY_DECISIONS }))
    click(button('记录'))
    await settle()
    // decisionRow 是「what the gate decided」那个 describe 的局部辅助函数，这里取不到——
    // 同一个作用域错误本文件已踩第五次（openNew / openSchedules / DECISIONS / workRoutes / decisionRow）。
    const row = all('#decisions li').find(node => read(node).includes('陌生人的请求'))!
    const btn = button('我看过了', row)
    expect(btn.getAttribute('title')).toContain('判定记录本身不删')
    expect(btn.getAttribute('title')).toContain('dismissed')
  })
})

describe('任务列表分段与已结束行的信息（U22）', () => {
  /** 一条已结束的：有结局原因，摘要长到需要截断。 */
  const ENDED = listed({
    id: 'ticket-2', title: '月度数据报表', stage: 'done', waitsForPerson: false,
    endedReason: 'The worker reported it finished.',
    summary: '第一句已经说完了。第二句很长，长到把整行撑高，扫读的时候就找不到锚点，所以它该被截断。',
  })
  const twoTickets = (): Routes => routes({
    'GET tickets': { offset: 0, limit: 80, count: 2, tickets: [listed(), ENDED] },
  })
  const openAll = async () => { click(button('全部')); await settle() }

  it('「全部」分两段：进行中的和已结束的是两种东西，混排就等于没有这一档', async () => {
    await mount(twoTickets())
    await openAll()
    const heads = all('#tickets li.group-head').map(node => read(node))
    expect(heads).toEqual(['进行中（1）', '已结束（1）'])
    // 顺序与归属：分段标题后面跟着的是那一段的行。
    const rows = all('#tickets li')
    expect(read(rows[1]!)).toContain('整理本周竞品动态')
    expect(read(rows[3]!)).toContain('月度数据报表')
    // 分段标题不是一条任务，所以它不该被点成打开详情。
    expect(rows[0]!.getAttribute('aria-current')).toBe(null)
  })

  it('已结束的行说清为什么结束——原先这句只在详情页里', async () => {
    await mount(twoTickets())
    await openAll()
    const endedRow = all('#tickets li').find(node => read(node).includes('月度数据报表'))!
    expect(read(endedRow)).toContain('结局原因：The worker reported it finished.')
    // 第二条独立守卫（0.8 强形式量出上面那条 toContain 是**唯一**守卫：删掉它，"不显示结局原因"的变异就无人发现）。
    // 钉的是另一个事实：那一行的 title 携带整句原文，且与可见文本一致——截断不丢原文。
    const reasonSpan = all('.meta span[title]', endedRow).find(node => read(node).startsWith('结局原因：'))
    expect(reasonSpan).toBeDefined()
    expect(reasonSpan!.getAttribute('title')).toBe('The worker reported it finished.')
    expect(read(endedRow)).toContain('结束于')
  })

  it('摘要只留第一句，「展开」才给全文，且展开不会顺带把任务打开', async () => {
    const { sent } = await mount(twoTickets())
    // 落地页是总览（U1），所以要先进任务页——`openAll()` 只点筛选 chip，不切页。
    click(button('任务'))
    await settle()
    await openAll()
    const row = all('#tickets li').find(node => read(node).includes('月度数据报表'))!
    expect(read(row)).toContain('第一句已经说完了。')
    expect(read(row)).not.toContain('扫读的时候就找不到锚点')
    click(button('展开', row))
    await settle()
    // 展开会重画整个列表，所以**要重新取那一行**：握着旧引用读到的是已脱离 DOM 的节点（第一版就是这么错的）。
    const opened = all('#tickets li').find(node => read(node).includes('月度数据报表'))!
    expect(read(opened)).toContain('扫读的时候就找不到锚点')
    expect(read(button('收起', opened))).toBe('收起')
    // "没有顺带打开"要用**行为**断言，不能用 tab 可见性：打开一张任务并不切页，它只是在同页画出详情。
    // 打开会去取详情，所以"没取过详情"才是"没打开"。
    expect(sent('GET tickets/ticket-2')).toHaveLength(0)
  })

  it('展开状态熬得过 5 秒刷新：刷新不该把操作者刚展开的那条收回去', async () => {
    await mount(twoTickets())
    await openAll()
    click(button('展开', all('#tickets li').find(node => read(node).includes('月度数据报表'))!))
    await settle()
    await tick(5000)
    expect(text('tickets')).toContain('扫读的时候就找不到锚点')
  })

  it('别的档不再多套一层标题：那一档本身就已经是分组了', async () => {
    await mount(twoTickets())
    click(button('已结束'))
    await settle()
    expect(all('#tickets li.group-head')).toHaveLength(0)
  })
})

describe('表单收进「新建」动作、列表只有一项时默认选中（U20）', () => {
  // `workRoutes` 是「works and projects」那个 describe 里的局部夹具，这里取不到——
  // 同一个作用域错误本文件已踩第四次（openNew / openSchedules / DECISIONS / workRoutes）。
  const myWorkRoutes = (over: Routes = {}): Routes => routes({
    'GET projects': { projects: [project()] },
    'GET works': { works: [work()] },
    'GET works/work-1': { work: work(), tickets: [] },
    ...over,
  })

  it('两个表单默认收起；唤出后焦点落在第一个字段，取消能收回去', async () => {
    await mount(myWorkRoutes())
    click(button('工作'))
    await settle()
    expect(byId('pj-form').classList.contains('hidden')).toBe(true)
    expect(byId('wk-form').classList.contains('hidden')).toBe(true)
    click(button('新建项目'))
    await settle()
    expect(byId('pj-form').classList.contains('hidden')).toBe(false)
    // 唤出一个表单却不把光标放进去，等于让人再点一次。
    expect(document.activeElement?.id).toBe('pj-name')
    // 唤出按钮此刻改口叫「收起」，所以页面上不会同时有两个「新建项目」。
    expect(all('button').filter(node => labelOf(node) === '新建项目')).toHaveLength(0)
    click(button('收起'))
    await settle()
    expect(byId('pj-form').classList.contains('hidden')).toBe(true)
    expect(all('button').filter(node => labelOf(node) === '新建项目')).toHaveLength(1)
  })

  it('列表里只有一项时，进页就替操作者选上它——但只选工作，不选项目', async () => {
    const { sent } = await mount(myWorkRoutes())
    click(button('工作'))
    await settle()
    // 详情不再是那句"选择左边一个项目或工作"，而是那条工作的内容。
    expect(text('work-detail')).toContain('周报')
    expect(sent('GET works/work-1')).toHaveLength(1)
    // 关键的一半：**项目没有被一起选中**，所以点项目行仍然是"打开"，不是"取消选中"。
    expect(sent('GET projects/project-1')).toHaveLength(0)
    click(one('#projects li'))
    await settle()
    expect(sent('GET projects/project-1')).toHaveLength(1)
    expect(text('work-detail')).toContain('竞品观察')
  })

  it('不止一项时不替操作者做选择：默认选中只在"没有别的可能"时才成立', async () => {
    await mount(myWorkRoutes({ 'GET works': { works: [work(), work({ id: 'work-2', name: '月报' })] } }))
    click(button('工作'))
    await settle()
    expect(text('work-detail')).toContain('选择左边一个项目或工作')
  })
})

describe('就地给下一步（U19）', () => {
  /** 聊天来源停用、无频道、无映射：第一次来的人看到的就是这个局面。 */
  // `policy` 读的是**服务器合成的 `state.chat.policy`**，不是 settings 块——只改 settings 的话
  // 引导仍然认为来源是启用的。两边都要覆写，这才是"停用且空"的真实局面。
  const blank = (over: Routes = {}) => routes({
    'GET state': chatState({
      settings: chatDocument({ enabled: false, channels: [], identities: {} }),
      chat: chatView({
        policy: { enabled: false, paused: false, deny: false, acceptMode: 'auto', allowedSenders: ['operator'] },
        waiting: { count: 0, ids: [] },
      }),
    }),
    'PUT settings': { settings: settings(), settingsRevision: 11 },
    'POST pass': { ok: true },
    ...over,
  })

  it('三步引导按真实顺序画出当前该做哪一步，做完的打勾', async () => {
    await mount(blank())
    click(button('聊天'))
    await settle()
    const items = all('#chat-steps li')
    expect(items).toHaveLength(3)
    expect(read(items[0]!)).toContain('启用这条来源')
    expect(read(items[1]!)).toContain('加一个频道')
    expect(read(items[2]!)).toContain('映射成发起者')
    // 当前步高亮、且带一个就地动作；后面的步骤是灰的、不给动作（还没轮到）。
    expect(items[0]!.className).toContain('now')
    expect(items[1]!.className).toContain('later')
    expect(all('button', items[0]!)).toHaveLength(1)
    expect(all('button', items[1]!)).toHaveLength(0)
  })

  it('启用开关就地可点：写的是整份文档里的 sources.chat.enabled 一个键', async () => {
    const { last, sent } = await mount(blank())
    click(button('聊天'))
    await settle()
    click(button('启用', one('#chat-steps li')))
    await settle()
    const body = last('PUT settings')?.body as Record<string, unknown>
    const chat = (body.sources as Record<string, Record<string, unknown>>).chat!
    expect(chat.enabled).toBe(true)
    // 关键的一半：只动 enabled，频道与身份映射不能被顺手抹掉。
    expect(chat.channels).toEqual([])
    expect(chat.identities).toEqual({})
    expect(toastText()).toContain('已启用聊天来源')
    // 启用之后立刻请系统再看一遍目录：操作者要看的是"它读到东西了吗"，不是"保存成功"。
    expect(sent('POST pass')).toHaveLength(1)
  })

  it('做完一步，当前步就往下走一步——引导是活的，不是一张静态说明', async () => {
    await mount(blank({
      'GET state': chatState({ settings: chatDocument({ enabled: true, channels: [], identities: {} }) }),
    }))
    click(button('聊天'))
    await settle()
    let items = all('#chat-steps li')
    expect(items[0]!.className).toContain('done')
    expect(items[1]!.className).toContain('now')
    // 第二步的动作是"去填"：把焦点送到频道 id 输入框，而不是让人自己找。
    click(button('去填', items[1]!))
    await settle()
    expect(document.activeElement?.id).toBe('ch-id')
  })

  it('三步都齐了就不再指手画脚', async () => {
    await mount(routes({
      'GET state': chatState(),
      'PUT settings': { settings: settings(), settingsRevision: 11 },
    }))
    click(button('聊天'))
    await settle()
    const items = all('#chat-steps li')
    expect(items).toHaveLength(3)
    for (const item of items) {
      expect(item.className).toContain('done')
      expect(all('button', item)).toHaveLength(0)
    }
  })

  it('停用也就地可点，且说清停用不是清空', async () => {
    const { last } = await mount(routes({
      'GET state': chatState(),
      'PUT settings': { settings: settings(), settingsRevision: 11 },
      'POST pass': { ok: true },
    }))
    click(button('聊天'))
    await settle()
    // 三步都已完成，所以引导里没有停用按钮——停用在状态胶囊那一排（它不是"下一步"，是"往回一步"）。
    expect(all('#chat-steps button')).toHaveLength(0)
    click(button('停用这条来源'))
    await settle()
    const chat = ((last('PUT settings')?.body as Record<string, unknown>).sources as
      Record<string, Record<string, unknown>>).chat!
    expect(chat.enabled).toBe(false)
    expect(toastText()).toContain('目录里的消息留在原处')
  })
})

describe('解释收进折叠、状态与动作提前（U18）', () => {
  it('折叠默认收起，但文字一个字没删——收起不等于删除', async () => {
    await mount(routes())
    click(button('记录'))
    await settle()
    const folds = all('#tab-decisions details.why')
    expect(folds.length).toBeGreaterThan(0)
    for (const fold of folds) expect(fold.hasAttribute('open')).toBe(false)
    // 关键的一半：折叠里的文本仍在 DOM 里，所以"这里没有重放按钮"这类事实没有被藏掉，只是不再挡路。
    expect(text('tab-decisions')).toContain('这里没有「重放」按钮，因为它做不到')
    expect(text('tab-decisions')).toContain('系统也不会自动重放它')
  })

  it('记录页的状态排在解释前面——原先要读 359 字才看到"到底有没有丢"', async () => {
    await mount(routes())
    click(button('记录'))
    await settle()
    const card = one('#lost').closest('section')!
    const kids = [...card.children]
    const lostAt = kids.indexOf(one('#lost'))
    const foldAt = kids.findIndex(node => node.matches('details.why'))
    expect(lostAt).toBeGreaterThanOrEqual(0)
    expect(foldAt).toBeGreaterThan(lostAt)   // 状态在前，解释在后
  })

  it('聊天页的概念解释也收进折叠，页首是状态胶囊不是段落', async () => {
    await mount(routes({ 'GET state': chatState() }))
    click(button('聊天'))
    await settle()
    const folds = all('#tab-chat details.why')
    expect(folds.length).toBeGreaterThanOrEqual(3)   // 顶部概念 / 停用不等于清空 / 映射表管什么 / 回复计数怎么读
    for (const fold of folds) expect(fold.hasAttribute('open')).toBe(false)
    // 页面正文的第一个元素必须是状态或动作，不是解释段落。
    // 【U19 产品变更】它现在是三步引导（`ol.steps`）；旧断言是 `expect(first.className).toContain('tools')`。
    // 断言的事实没变（页首不是段落），而且更强了：页首现在直接告诉你先做哪一步。
    const first = one('#chat').children[0]!
    expect(first.tagName).not.toBe('P')
    expect(first.className).toMatch(/^(steps|tools)/)
  })

  it('工作页的概念解释进折叠，而"怎么退回全部"这条导航提示仍然可见', async () => {
    // 基础夹具的 GET projects 是空表，于是列表画的是空态那一行（没有 onclick）——点它什么都不会发生。
    await mount(routes({ 'GET projects': { projects: [project()] }, 'GET works': { works: [work({ projectId: 'project-1' })] } }))
    click(button('工作'))
    await settle()
    expect(all('#tab-works details.why').length).toBeGreaterThanOrEqual(2)
    // 没选项目时它无话可说，所以隐藏——留一个空段落在那里是噪声。
    expect(byId('works-hint').classList.contains('hidden')).toBe(true)
    // 选中项目后它说的是导航，不能跟着概念解释一起被折起来。
    click(one('#projects li'))
    await settle()
    expect(byId('works-hint').classList.contains('hidden')).toBe(false)
    expect(text('works-hint')).toContain('点项目那行可以退回全部')
  })
})

describe('枚举中文化与词表穷尽（U17）', () => {
  // 键集逐字取自 src/core/model.ts 的 TicketStage 与 DecisionOutcome。
  // 这条测试的作用是**提醒**：模型里加了一个新阶段而词表没跟上时，它会红——
  // 界面宁可露出英文原词（响亮），也不能画成空白（静默），但两者都不该悄悄发生。
  const STAGES = ['pending', 'running', 'waiting', 'failed', 'blocked', 'done', 'dropped', 'stopped']
  const OUTCOMES = ['accept', 'ignore', 'observe', 'unavailable']

  it('八个阶段各有中文词，且英文原值留在 title 上', async () => {
    for (const stage of STAGES) {
      await mount(routes({ 'GET tickets/ticket-1': ticket({ stage, ended: undefined }) }))
      await openListed()
      const pill = one('#detail .stage')
      expect(read(pill), stage).not.toBe(stage)          // 不再是英文原词
      expect(read(pill), stage).not.toBe('')              // 也不是空白
      expect(pill.getAttribute('title'), stage).toBe(stage) // 原值没丢
    }
  })

  it('四个判定结局各有中文词', async () => {
    for (const outcome of OUTCOMES) {
      await mount(routes({
        'GET decisions': {
          count: 1,
          decisions: [{ id: 'd-1', triggerId: 'trigger-7', outcome, at: LATER, reason: 'accepted', title: '一条请求' }],
        },
      }))
      click(button('记录'))
      await settle()
      const pill = one('#decisions .stage')
      expect(read(pill), outcome).not.toBe(outcome)
      expect(read(pill), outcome).not.toBe('')
      expect(pill.getAttribute('title'), outcome).toBe(outcome)
    }
  })

  it('八个门禁原因码各有中文说法，且英文原句留在 title 上', async () => {
    // 键集逐字取自 src/core/policy.ts 的 GATE_REASONS（共 8 个键，逐个列举）。这条是**结构性**守卫：
    // 它不钉某一句具体文案，而是钉"每个码都有人话、且原句没丢"。
    // 0.8 强形式量出，只靠"words why the gate refused"里那一句 toContain 时，
    // 删掉它，"原因退回英文"的变异就无人发现——所以要有第二条从另一个角度守的断言。
    const REASONS = ['accepted', 'paused', 'source_disabled', 'unknown_source', 'sender_not_allowed',
      'system_actor', 'empty_request', 'observed']
    for (const reason of REASONS) {
      await mount(routes({
        'GET decisions': {
          count: 1,
          decisions: [{
            id: 'd-1', triggerId: 'trigger-7', outcome: 'ignore', at: LATER, reason,
            reasonText: `server sentence for ${reason}`, title: '一条请求',
          }],
        },
      }))
      click(button('记录'))
      await settle()
      const spans = all('.meta span[title]', one('#decisions li'))
      const line = spans[1]!
      // 人读的那一行必须是中文，不能是英文原句、更不能是内部码。
      expect(read(line), reason).toMatch(/[\u4e00-\u9fff]/)
      expect(read(line), reason).not.toContain(reason)
      // 服务器的英文原句一字不丢，挂在 title 上。
      expect(line.getAttribute('title'), reason).toBe(`server sentence for ${reason}`)
    }
  })

  it('总览「最近活动」里的判定结局也是中文——那是第二条渲染路径，真浏览器才量到', async () => {
    // 这条测试存在的原因：真浏览器在线上页面查到 5 个 `accept`，而 jsdom 252 条**一条都没覆盖到那条路径**。
    // 总览的最近活动与记录页各自渲染判定结局，是同一种数据的两条路径；只改一条就是"两处两种呈现"。
    await mount(routes({
      'GET decisions': {
        count: 1,
        decisions: [{ id: 'd-1', triggerId: 'trigger-7', outcome: 'accept', at: LATER, reason: 'accepted', title: '一条请求' }],
      },
    }))
    await settle()
    const pills = all('#ov-recent .stage')
    expect(pills.length).toBeGreaterThan(0)
    for (const pill of pills) {
      expect(read(pill)).not.toBe('accept')
      expect(read(pill)).toBe('已受理')
      expect(pill.getAttribute('title')).toBe('accept')
    }
  })

  it('待启动的任务也有颜色——它以前落到 stageClass 之外，是无色的', async () => {
    await mount(routes({ 'GET tickets/ticket-1': ticket({ stage: 'pending', ended: undefined }) }))
    await openListed()
    expect(one('#detail .stage').className).toContain('pending')
  })
})

describe('剩余打通（U16）', () => {
  it('事件日志里的 Session id 可点击复制——抄 32 位串不该靠人眼', async () => {
    await mount(routes({
      'GET tickets/ticket-1/events': {
        count: 1, returned: 1,
        events: [event({ type: 'session_bound', detail: { sessionId: 'myagent-ticket-1' } })],
      },
    }))
    await openListed()
    // detail 渲染成可点按钮；文本逐字保留（detailText 里仍含原串），复制走点击。
    const link = one('#d-events button.linklike')
    expect(read(link)).toBe('myagent-ticket-1')
    expect(link.getAttribute('title')).toContain('点击复制')
    // 文本本身一字不丢：折叠/按钮化不等于删除。
    expect(text('d-events')).toContain('myagent-ticket-1')
  })

  it('授权行里的发起者是入口：点它去设置页的允许发起者编辑', async () => {
    await mount(routes())
    await openListed()
    const term = all('#detail details.tech dt').find(node => node.textContent === '授权')
    const sender = one('button.linklike', term!.nextElementSibling!)
    expect(read(sender)).toBe('operator')
    click(sender)
    await settle()
    expect(byId('tab-settings').classList.contains('hidden')).toBe(false)
    // 文本逐字不变：主 kv 的授权断言因此原样通过。
    expect(detailValue('授权')).toBe('operator（person）经 schedule，策略版本 pv-9f3c')
  })
})

describe('来源 Trigger 深链与过滤（U15）', () => {
  // DECISIONS 是「what the gate decided」那个 describe 里的局部常量，这里取不到——
  // 同一个作用域错误本文件已踩第三次（U5 的 openNew、U13 的 openSchedules）。就地写一份最小的：
  // 两条判定、其中一条的 triggerId 是任务详情里那条，这样"只看一条"才有意义。
  const MY_DECISIONS = {
    count: 2,
    decisions: [
      {
        id: 'decision-1', triggerId: 'trigger-7', outcome: 'accept', at: LATER, reason: 'accepted',
        reasonText: 'The gate admitted this request.', ticketId: 'ticket-1', policyVersion: 'pv-9f3c',
        title: '整理本周竞品动态',
      },
      {
        id: 'decision-2', triggerId: 'trigger-9', outcome: 'ignore', at: AT, reason: 'sender_not_allowed',
        reasonText: 'sender "stranger" is not on the list', title: '陌生人的请求',
      },
    ],
  }
  const TRIGGER_ROUTES = (): Routes => routes({
    'GET decisions': MY_DECISIONS,
  })

  it('技术细节里的「来源 Trigger」点一下，记录页只看那一条请求的判定', async () => {
    await mount(TRIGGER_ROUTES())
    await openListed()
    // U16 之后折叠区里有两个 linklike（授权的发起者、来源 Trigger），所以要沿 dt 找到 Trigger 自己那格。
    const term = all('#detail details.tech dt').find(node => node.textContent === '来源 Trigger')
    const link = one('button.linklike', term!.nextElementSibling!)
    expect(read(link)).toBe('trigger-7')
    click(link)
    await settle()
    expect(byId('tab-decisions').classList.contains('hidden')).toBe(false)
    // 只看这一条：说明行 + 恰好 1 行判定（夹具里 trigger-7 只有 1 条）。
    expect(text('decisions')).toContain(`只看来源 Trigger trigger-7 的判定：1 条`)
    expect(all('#decisions li')).toHaveLength(2)   // 1 条说明 + 1 条判定
    // 第二条守卫：过滤条件写进了地址栏。0.8 强形式量出"刷新后仍成立"那条测试里的 hash 断言是**唯一**守卫，
    // 删掉它，"不写深链"的变异就无人发现——所以点击这条路径上也钉一次（两个角度守同一个事实）。
    expect(location.hash).toBe('#trigger=trigger-7')
    // 清除筛选取消，回到全部。
    click(button('看全部'))
    await settle()
    expect(all('#decisions li')).toHaveLength(2)   // 2 条判定，无说明行
  })

  it('深链 #trigger=<id> 直接落在过滤后的记录页', async () => {
    await mount(TRIGGER_ROUTES(), '#trigger=trigger-7')
    await settle()
    expect(byId('tab-decisions').classList.contains('hidden')).toBe(false)
    expect(text('decisions')).toContain('只看来源 Trigger trigger-7')
  })

  it('过滤用深链表达，所以刷新后仍然成立，而不是又回到 80 条里找那一条', async () => {
    await mount(TRIGGER_ROUTES())
    await openListed()
    const term = all('#detail details.tech dt').find(node => node.textContent === '来源 Trigger')
    click(one('button.linklike', term!.nextElementSibling!))
    await settle()
    expect(location.hash).toBe('#trigger=trigger-7')
    await tick(5000)
    // 刷新重画，过滤仍在。
    expect(text('decisions')).toContain('只看来源 Trigger trigger-7')
  })

  it('过滤不到时说清楚两种可能，而不是留一片空白', async () => {
    await mount(TRIGGER_ROUTES(), '#trigger=trigger-x')
    await settle()
    expect(text('decisions')).toContain('这一条不在最近 80 条里；它可能更早，或根本没走到判定')
  })
})

describe('来源页解散（U14）', () => {
  it('五个分区各归其位：来源表在总览、健康与队列在抽屉、丢失在记录、聊天自成页', async () => {
    await mount(routes({ 'GET effects': { counts: { notify: 2 } } }))
    // 导航里不再有「来源」——那一页混了五个不相关的分区，现在没有东西需要它了。
    const labels = [...byId('tabs').children].map(node => labelOf(node))
    expect(labels).not.toContain('来源')
    expect(labels).toContain('聊天')
    // 旧面板 id 不存在了：留着它就是留一个永远画不出内容的空壳。
    expect(document.getElementById('tab-sources')).toBe(null)

    // 来源状态表在总览，且落地就画好（它不需要自己的请求，数据在 state 里）。
    expect(all('#ov-sources table.plain')).toHaveLength(1)
    expect(all('#ov-sources th').map(node => node.textContent)).toEqual(['来源', '状态', '详情', '下次', '最近触发', '计数'])

    // 健康与队列在抽屉里，容器 id 沿用（搬动位置不该改名字）。
    click(byId('health'))
    await settle()
    expect(all('#health-detail table.plain')).toHaveLength(1)
    expect(all('#effects table.plain')).toHaveLength(1)
    expect(text('effects-note')).toContain('退避重试')
  })

  it('丢失的请求与判定同住记录页，进这一页两份都读', async () => {
    const { sent } = await mount(routes({
      'GET state': state({ counts: { ...(state().counts as Record<string, unknown>), lost: { rows: 1, payloads: 0 } } }),
      'GET lost': { total: 1, shown: 1, rows: [], payloads: [], bounds: { keep: 20, chars: 1000 } },
    }))
    click(button('记录'))
    await settle()
    expect(byId('tab-decisions').classList.contains('hidden')).toBe(false)
    // 两份都在这一页上：判定列表与丢失说明。
    expect(document.getElementById('decisions')).not.toBe(null)
    expect(text('tab-decisions')).toContain('丢失的请求')
    expect(sent('GET decisions').filter(call => call.query.get('limit') === '80')).toHaveLength(1)
    expect(sent('GET lost')).toHaveLength(1)
  })

  it('答不了丢失视图的旧 bundle，在记录页仍要说"读不到"而不是留一片空白', async () => {
    // 这一条钉住 U14 引入又修掉的回归：搬页之后 loadLost 是唯一入口，而它在 lostStale 时直接 return，
    // 于是"这个 bundle 答不了"从一句话变成了空白。降级也必须说一句话，不能靠调用顺序碰巧成立。
    await mount(routes())
    click(button('记录'))
    await settle()
    expect(text('lost')).toContain('宿主的插件比这个页面旧')
    expect(all('#lost p.warn')).toHaveLength(1)
    expect(all('#lost p.ok')).toHaveLength(0)
  })

  it('聊天页只有聊天：等待队列、身份映射、频道、回复计数', async () => {
    await mount(routes({ 'GET state': chatState() }))
    click(button('聊天'))
    await settle()
    expect(byId('tab-chat').classList.contains('hidden')).toBe(false)
    const body = text('tab-chat')
    expect(body).toContain('身份映射')
    expect(body).toContain('回复计数')
    // 健康、队列、丢失都不在这一页了。
    expect(body).not.toContain('丢失的请求')
    expect(document.querySelector('#tab-chat #health-detail')).toBe(null)
  })
})

describe('排期并入派活（U13）', () => {
  it('派活页默认是「一次性派」，切到「定时派」才读排期并显示列表', async () => {
    const { sent } = await mount(scheduleRoutes())
    click(button('派活'))
    await settle()
    // 默认档：一次性派可见、定时派隐藏，且**没有**为看不见的东西发请求。
    expect(byId('dispatch-once').classList.contains('hidden')).toBe(false)
    expect(byId('dispatch-timed').classList.contains('hidden')).toBe(true)
    // 基线不是 0：总览落地时就为"接下来自动跑的活"读过一次排期。断言要记基线、看增量，
    // 否则量到的是别的页面的读——第一版正是把它当成 0，红得莫名其妙。
    const baseline = sent('GET schedules').length
    expect(baseline).toBe(1)

    click(button('定时派'))
    await settle()
    expect(byId('dispatch-timed').classList.contains('hidden')).toBe(false)
    expect(byId('dispatch-once').classList.contains('hidden')).toBe(true)
    // 切过去才读：为看不见的页面轮询是白花的请求。
    expect(sent('GET schedules')).toHaveLength(baseline + 1)
    expect(text('schedules')).toContain('每日摘要')
    // 当前档看得见（与任务页的筛选 chips 同一条纪律）。
    expect(all('#dispatch-mode .chip-btn')[1]!.getAttribute('aria-pressed')).toBe('true')
    expect(all('#dispatch-mode .chip-btn')[0]!.getAttribute('aria-pressed')).toBe('false')
  })

  it('切回「一次性派」后，5 秒刷新不再读排期', async () => {
    const { sent } = await mount(scheduleRoutes())
    // openSchedules 是排期那个 describe 里的局部函数，这里取不到（U5 的 openNew 同一个作用域错误，第二次踩）。
    // 内联同样两步：点「派活」，再切「定时派」。
    click(button('派活'))
    await settle()
    click(button('定时派'))
    await settle()
    const afterOpen = sent('GET schedules').length
    expect(afterOpen).toBe(2)  // 总览一次 + 定时模式一次
    click(button('一次性派'))
    await settle()
    await tick(5000)
    // 离开定时模式之后，刷新不该继续为它发请求。
    expect(sent('GET schedules')).toHaveLength(afterOpen)
  })

  it('搜到一条排期，点它就落在派活页的定时模式', async () => {
    await mount(scheduleRoutes())
    type('search', 'digest')
    await tick(250)
    const rows = all('#search-results .sr')
    expect(read(rows[0]!)).toContain('排期')
    click(rows[0]!)
    await settle()
    expect(byId('tab-new').classList.contains('hidden')).toBe(false)
    expect(byId('dispatch-timed').classList.contains('hidden')).toBe(false)
  })
})

describe('频道表控件（U12）：关掉"只能改整份 JSON"的债', () => {
  /** 打开来源页的聊天一节，带上保存与 pass 两条路由。 */
  const openChatSection = async (over: Routes = {}) => {
    const log = await mount(routes({
      'GET state': chatState(),
      'PUT settings': { settings: settings(), settingsRevision: 9 },
      'POST pass': { ok: true },
      ...over,
    }))
    click(button('聊天'))  // 【U14】聊天自成页，旧写法 button('来源')
    await settle()
    return log
  }
  /** 保存送出去的频道表。 */
  const savedChannels = (log: { last: (key: string) => Call | undefined }) => {
    const body = log.last('PUT settings')?.body as
      { sources?: { chat?: { channels?: Record<string, unknown>[]; identities?: Record<string, unknown> } } } | undefined
    return body?.sources?.chat
  }

  it('频道表每行有启停与删除，删除要两步确认', async () => {
    await openChatSection()
    const row = one('#chat table tbody tr')
    expect(read(row.children[0])).toBe('ops')
    expect(read(button('停用', row))).toBe('停用')
    expect(read(button('删除', row))).toBe('删除')
    // 第一步只是问，不写：删除的是"这个来源不再看那个目录"，不是一个显示项。
    click(button('删除', row))
    await settle()
    expect(read(button('确认删除', one('#chat table tbody tr')))).toBe('确认删除')
    expect(read(button('取消', one('#chat table tbody tr')))).toBe('取消')
  })

  it('加一个频道：整份文档里只多这一条，身份映射与其余设置原样保留', async () => {
    const log = await openChatSection()
    type('ch-id', 'research')
    type('ch-dir', '/chat/research')
    click(button('加一个频道'))
    await settle()
    const chat = savedChannels(log)
    expect(chat?.channels).toEqual([
      { id: 'ops', directory: '/chat/ops', enabled: true },
      { id: 'research', directory: '/chat/research', enabled: true },
    ])
    // 关键的一半：改频道不该顺手抹掉身份映射（两者住在同一个 chat 块里）。
    expect(chat?.identities).toEqual({ U01ABCDEF: { actor: 'alice', note: '操作者本人' } })
    expect(toastText()).toContain('已加频道 research')
    // 保存后立刻请系统再看一遍目录：加频道的意义是"它读到东西了吗"，不是"保存成功"四个字。
    expect(log.sent('POST pass')).toHaveLength(1)
  })

  it('不合法的 id 当场说清规则，不发请求', async () => {
    const log = await openChatSection()
    type('ch-id', 'Bad_ID')
    type('ch-dir', '/chat/x')
    click(button('加一个频道'))
    await settle()
    expect(toastText()).toContain('小写字母开头')
    expect(log.sent('PUT settings')).toHaveLength(0)
  })

  it('重复的 id 当场说，因为"加了一个什么都没发生"比一句报错难懂得多', async () => {
    const log = await openChatSection()
    type('ch-id', 'ops')
    type('ch-dir', '/chat/ops2')
    click(button('加一个频道'))
    await settle()
    expect(toastText()).toContain('已经有一个 id 为 ops 的频道')
    expect(log.sent('PUT settings')).toHaveLength(0)
  })

  it('停用一个频道翻转的是它自己的 enabled，其余频道与设置不动', async () => {
    const log = await openChatSection({
      'GET state': chatState({
        settings: chatDocument({
          channels: [
            { id: 'ops', directory: '/chat/ops', enabled: true },
            { id: 'lab', directory: '/chat/lab', enabled: true },
          ],
        }),
      }),
    })
    const rows = all('#chat table tbody tr')
    click(button('停用', rows[1]!))
    await settle()
    expect(savedChannels(log)?.channels).toEqual([
      { id: 'ops', directory: '/chat/ops', enabled: true },
      { id: 'lab', directory: '/chat/lab', enabled: false },
    ])
    expect(toastText()).toContain('已停用频道 lab')
  })

  it('5 秒刷新不吃掉写到一半的频道表单', async () => {
    await openChatSection()
    type('ch-id', 'research')
    type('ch-dir', '/chat/re')
    // 一次完整刷新（load() 会重画聊天一节）。身份映射为此有草稿读回机制，频道表单复用同一条纪律。
    await tick(5000)
    expect(input('ch-id').value).toBe('research')
    expect(input('ch-dir').value).toBe('/chat/re')
  })

  it('没填目录就说清楚要填什么，而不是让服务器拒一遍', async () => {
    const log = await openChatSection()
    type('ch-id', 'research')
    click(button('加一个频道'))
    await settle()
    expect(toastText()).toContain('先写目录')
    expect(log.sent('PUT settings')).toHaveLength(0)
  })
})

describe('设置分区表单（U11）', () => {
  const openSettings = async (over: Routes = {}): ReturnType<typeof mount> => {
    const log = await mount(routes({ 'PUT settings': { settings: settings(), settingsRevision: 4 }, ...over }))
    click(button('设置'))
    await settle()
    return log
  }

  it('分区改一处，JSON 跟着变，脏状态立刻说出来', async () => {
    await openSettings()
    choose('sq-mode', 'observe')
    const parsed = JSON.parse(area('settings').value)
    expect(parsed.acceptMode).toBe('observe')
    // 改了没保存，页面上要看得见——切走丢改动是最容易白干的事。
    expect(byId('settings-dirty').classList.contains('hidden')).toBe(false)
    // 措辞本身也钉住：指示器说的是"有未保存的更改"，不是"改动"这种含糊话。
    expect(read(byId('settings-dirty'))).toContain('未保存')
    // 脏状态是**双向**指示器，所以它有两个跳变要钉。这一条与"保存后隐藏"（在下一条测试里）
    // 一起构成独立守卫：0.8 强形式量出单靠上面那条 classList 断言时，"永不显示"的变异在删掉它之后就无人发现。
    // 分区勾选也走同一条路：暂停是布尔，收的是 checkbox。
    click(input('sq-paused'))
    expect(JSON.parse(area('settings').value).paused).toBe(true)
  })

  it('「保存这一区」保存的是整份文档——四个入口，一个事实源', async () => {
    const { last } = await openSettings()
    choose('sq-mode', 'observe')
    click(button('保存这一区', byId('sec-accept')))
    await settle()
    // PUT 的仍是**整份** settings：API 收整份，分区只是把入口变近，不是分片保存。
    // 不与"保存后的文本框"比——保存成功后处理器会重新载入，文本框那时已经是服务器回的新状态了。
    const body = last('PUT settings')?.body as Record<string, unknown>
    expect(body).toMatchObject({ acceptMode: 'observe', paused: false, allowedSenders: ['operator'] })
    // 整份的证据：没被这一区碰过的字段也原样在里面（分片保存会把它们丢掉）。
    expect(body.executor).toEqual({ maxWorkers: 2, prepare: '', model: '' })
    expect(Object.keys(body.sources as object).sort()).toEqual(['cron', 'inbox', 'session'])
    expect(toastText()).toBe('已保存并生效')
    // 保存成功后脏状态必须消失，否则它就成了常驻的噪声。
    expect(byId('settings-dirty').classList.contains('hidden')).toBe(true)
    // 再改一次必须又亮起来：指示器的两个跳变都要真的发生，而不只是"曾经亮过"。
    // 要选一个与"保存后重新载入的值"不同的档——夹具重载回来就是 auto，再选 auto 等于没改，脏状态当然不亮。
    choose('sq-mode', 'observe')
    expect(byId('settings-dirty').classList.contains('hidden')).toBe(false)
  })

  it('JSON 手改会实时重画分区；不合法时分区不动——拿半份数据重画会把错误固化进表单', async () => {
    await openSettings()
    type('settings', JSON.stringify({ ...settings(), acceptMode: 'observe' }, null, 2))
    await settle()
    expect(input('sq-mode').value).toBe('observe')
    expect(input('sq-senders').value).toBe('operator')

    // 改坏 JSON：分区必须停在最后一份合法值上。
    choose('sq-mode', 'auto')
    type('settings', '{"acceptMode": ')
    expect(input('sq-mode').value).toBe('auto')
    expect(byId('settings-dirty').classList.contains('hidden')).toBe(false)
  })

  it('各来源开关写进 sources.<来源>.enabled，而关闭是产出侧的事——已受理的不受影响', async () => {
    await openSettings()
    const boxes = all('#sq-src-toggles input[data-src]')
    // 夹具有 cron / inbox / session 三个来源块，勾选状态画得对。
    expect(boxes.map(box => (box as HTMLElement).dataset.src).sort()).toEqual(['cron', 'inbox', 'session'])
    click(boxes[0]!)
    const parsed = JSON.parse(area('settings').value) as { sources: Record<string, Record<string, unknown>> }
    expect(parsed.sources.cron!.enabled).toBe(false)
  })

  it('收件目录分区收的是目录、轮询与开关', async () => {
    await openSettings()
    expect(input('sq-inbox-dir').value).toBe('/inbox')
    expect(input('sq-inbox-poll').value).toBe('5000')
    type('sq-inbox-dir', '/新收件目录')
    const parsed = JSON.parse(area('settings').value) as { sources: Record<string, Record<string, unknown>> }
    expect(parsed.sources.inbox!.directory).toBe('/新收件目录')
  })
})

describe('全局搜索（U9）', () => {
  it('按标题或 id 搜到任务，点结果直达详情', async () => {
    await mount(routes())
    type('search', '竞品')
    // 输入是 180ms 防抖的——不是等真实时间，是推进假时钟。
    await tick(250)
    const results = all('#search-results .sr')
    expect(results.length).toBe(1)
    expect(read(results[0]!)).toContain('整理本周竞品动态')
    expect(read(results[0]!)).toContain('任务')
    click(results[0]!)
    await settle()
    expect(byId('tab-tickets').classList.contains('hidden')).toBe(false)
    expect(read(one('#detail h2'))).toBe('整理本周竞品动态')
    // 选中即清空：搜索框不留旧字，下一次搜不用先删。
    expect(input('search').value).toBe('')
  })

  it('搜工作与排期也直达，搜不到就说没有，不静默', async () => {
    await mount(routes({
      'GET works': { works: [work({ id: 'work-7', name: '竞品周报' })] },
      'GET works/work-7': { work: work({ id: 'work-7', name: '竞品周报' }), tickets: [] },
      'GET schedules': { zone: 'Asia/Shanghai', now: AT, schedules: [scheduleView()] },
    }))
    type('search', '周报')
    await tick(250)
    const kinds = all('#search-results .sr .kind').map(node => read(node))
    expect(kinds).toContain('工作')

    type('search', '不存在的字')
    await tick(250)
    expect(read(one('#search-results .sr'))).toBe('没有匹配的。')
  })

  it('Esc 清空搜索并收起结果', async () => {
    await mount(routes())
    type('search', '竞品')
    await tick(250)
    expect(byId('search-results').classList.contains('hidden')).toBe(false)
    document.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    await settle()
    expect(input('search').value).toBe('')
    expect(byId('search-results').classList.contains('hidden')).toBe(true)
  })

  it('按 id 前缀也搜得到：人记得的常常是那 8 位短码', async () => {
    await mount(routes())
    type('search', 'ticket-1')
    await tick(250)
    // **不数行数**：空结果那条"没有匹配的。"同样是一个 .sr，所以 `toHaveLength(1)` 在搜不到时也成立——
    // 变异检验（去掉 id 匹配）当场量出这条断言是空的。断言内容，不断言条数。
    const row = one('#search-results .sr')
    expect(read(row)).toContain('整理本周竞品动态')
    expect(read(one('.kind', row))).toBe('任务')
    expect(read(row)).not.toContain('没有匹配')
  })
})

describe('列表用相对时间，绝对时刻不丢（U8）', () => {
  it('任务行说"多久前"，而精确时刻挂在 title 上——相对化不等于丢信息', async () => {
    await mount(routes())
    click(button('任务'))
    await settle()
    const cells = all('#tickets li .meta span').filter(node => node.getAttribute('title') !== null)
    expect(cells.length).toBeGreaterThan(0)
    // 文本是相对表达（或超 30 天退回的日期）。**不断言具体"3 天前"**：真实时钟在走，
    // 那样写会随日期漂移成 flake——W9 修过的同一类，不能在这里重新引进。
    expect(read(cells[0])).toMatch(/刚刚|分钟前|小时前|天前|\d{4}\//)
    expect(cells[0]!.getAttribute('title')).toContain('2026')
    // 详情里的时刻仍是绝对的：列表回答"多久前"，详情回答"几点几分"（邮件与 IM 的分法）。
    await openListed()
    expect(detailValue('创建')).toContain('2026')
  })

  it('"此刻"的最后动静也相对化，因为要判断的是"它还活着吗"', async () => {
    await mount(routes({ 'GET tickets/ticket-1/progress': progress({ lastEventAt: new Date().toISOString() }) }))
    await openListed()
    await settle()
    expect(text('d-progress')).toMatch(/最后动静\s*刚刚|最后动静\s*\d+ 分钟前/)
  })
})

describe('改名、筛选 chips 与导航徽标（U7）', () => {
  it('筛选是四档 chips，当前档看得见，点另一档就按那一档重新读', async () => {
    const { sent, last } = await mount(routes())
    click(button('任务'))
    await settle()
    const chips = all('#filter .chip-btn')
    expect(chips.map(node => node.textContent)).toEqual(// 【S4 产品变更】多了「已删除」一档。旧值：['进行中', '等你回答', '已结束', '全部']。
      // 加它的理由：list 一律隐藏墓碑，所以**只有这个过滤器能列出被删的任务**——
      // 读不到的墓碑不是审计痕迹，而"我到底删了什么、删掉多少"是事后唯一会被问的问题。
      ['进行中', '等你回答', '已结束', '全部', '已删除'])
    // 当前档是"看得见"的，不是藏在下拉里的一个 value。
    expect(chips[0]!.getAttribute('aria-pressed')).toBe('true')
    expect(chips.slice(1).every(node => node.getAttribute('aria-pressed') === 'false')).toBe(true)

    click(button('已结束'))
    await settle()
    expect(last('GET tickets')?.query.get('state')).toBe('ended')
    expect(all('#filter .chip-btn')[2]!.getAttribute('aria-pressed')).toBe('true')
    expect(all('#filter .chip-btn')[0]!.getAttribute('aria-pressed')).toBe('false')
    // 四档都还在：换档不是把别的档藏起来。
    expect(sent('GET tickets').map(call => call.query.get('state'))).toContain('open')
  })

  it('总览的「等你回答」卡点一下就切到任务页并选中那一档', async () => {
    await mount(routes())
    click(one('#ov-kpis .ov-kpi.clickable'))
    await settle()
    expect(byId('tab-tickets').classList.contains('hidden')).toBe(false)
    expect(all('#filter .chip-btn')[1]!.getAttribute('aria-pressed')).toBe('true')
  })

  it('徽标只在非零时出现：一个常驻的 0 是眼睛会自动跳过的东西', async () => {
    // 默认夹具里 attention=1，所以任务页徽标现身并报数。
    await mount(routes())
    const badge = byId('badge-tickets')
    expect(badge.classList.contains('hidden')).toBe(false)
    expect(badge.textContent).toBe('1')

    // 归零就必须消失，而不是显示 0——它唯一要说的话是"有事等你"。
    await mount(routes({
      'GET state': state({ counts: { ...(state().counts as Record<string, unknown>), attention: 0 } }),
    }))
    expect(byId('badge-tickets').classList.contains('hidden')).toBe(true)
  })

  it('聊天等映射与丢失各有一颗徽标：合并的前提在 U14 之后不成立了', async () => {
    // 【U23 产品变更，推翻 U7 的合并决定】U7 时两件事同住「来源」页，一颗徽标指一条路，合并是对的。
    // U14 解散来源页之后，聊天等映射去了「聊天」、丢失去了「记录」——再合并成一颗，它只能挂在其中一个
    // 按钮上，指向的却是两件事；而且两处共用同一个 id（重复 id 只渲染一颗），聊天那颗永远是空的。
    // 数字对了、含义没了，所以拆开：一颗说一件事。旧断言：
    //   expect(byId('badge-sources').classList.contains('hidden')).toBe(false)
    //   expect(byId('badge-sources').textContent).toBe('5')
    await mount(routes({
      'GET state': chatState({
        chat: chatView({ waiting: { count: 2, ids: ['U01'] } }),
        counts: { ...(chatState().counts as Record<string, unknown>), lost: { rows: 1, payloads: 2 } },
      }),
      'GET lost': { total: 3, shown: 3, rows: [], payloads: [], bounds: { keep: 20, chars: 1000 } },
    }))
    expect(byId('badge-chat').textContent).toBe('2')
    expect(byId('badge-chat').classList.contains('hidden')).toBe(false)
    expect(byId('badge-decisions').textContent).toBe('3')
    expect(byId('badge-decisions').classList.contains('hidden')).toBe(false)
  })

  it('菜单用操作者的词：任务、记录，而不是 Ticket、门禁记录', async () => {
    await mount(routes())
    const labels = [...byId('tabs').children].map(node => labelOf(node))
    // 【U13】排期并入派活，一级菜单 9 → 8。旧值：['总览','任务','工作','派活','记录','来源','排期','设置','提示词']
    // 【U14】来源页解散：留下的只有聊天，所以这一项改叫「聊天」。旧值含 '来源'。
    expect(labels).toEqual(['总览', '任务', '工作', '派活', '记录', '聊天', '设置', '提示词'])
    // data-tab 没跟着改：它是路由与深链的键，改它等于改协议，而改名只该改给人看的那一层。
    expect([...byId('tabs').children].map(node => (node as HTMLElement).dataset.tab))
      // 【U13】排期并入派活，一级菜单 9 → 8。旧值含 'schedules'。
      .toEqual(['overview', 'tickets', 'works', 'new', 'decisions', 'chat', 'settings', 'prompts'])
  })
})

describe('创建结果卡片与提示词分角色卡（U5 / U6）', () => {
  it('建成功了说的是人话，并给出打开它的按钮；原始 JSON 折叠但没删', async () => {
    await mount(routes({ 'POST tickets': { stored: true, disposition: 'accepted', ticketId: 'ticket-9' } }))
    click(button('派活'))
    await settle()
    type('n-title', '整理本周竞品动态')
    type('n-request', '产出 report.md')
    click(button('创建 Ticket'))
    await settle()
    expect(text('new-result')).toContain('已开任务 ticket-9')
    expect(text('new-result')).toContain('它已经进队列')
    // 原始返回还在，只是默认折叠：排障时它必须在，而"折叠"不等于"删除"（与 U4 同一条原则）。
    expect(text('new-result')).toContain('"ticketId": "ticket-9"')
    expect(one('#new-result details.tech').hasAttribute('open')).toBe(false)
    expect(read(button('打开这张任务', byId('new-result')))).toBe('打开这张任务')
  })

  it('observe 模式下说清"记录了但没执行"，并给出怎么让它真的跑', async () => {
    await mount(routes({ 'POST tickets': { stored: true, disposition: 'observed', reason: 'observed' } }))
    click(button('派活'))
    await settle()
    type('n-title', '整理本周竞品动态')
    type('n-request', '产出 report.md')
    click(button('创建 Ticket'))
    await settle()
    expect(text('new-result')).toContain('已记录，但没有执行')
    expect(text('new-result')).toContain('把受理模式改成「通过即执行」')  // 【U17】旧断言 '改成 auto'
  })

  it('被拒时把原因原话给出，并指向该去哪修', async () => {
    await mount(routes({ 'POST tickets': { stored: false, disposition: 'ignored', reason: 'sender_not_allowed', reasonText: '发起者不在允许名单' } }))
    click(button('派活'))
    await settle()
    type('n-title', 'x')
    type('n-request', 'y')
    click(button('创建 Ticket'))
    await settle()
    expect(text('new-result')).toContain('没有开任务')
    expect(text('new-result')).toContain('发起者不在允许名单')
    expect(text('new-result')).toContain('不在允许名单就去设置页加')
  })

  // 复用文件里既有的 PROMPTS 夹具，而不是自己手搓一份：第一版我把字段写成 `current`，
  // 而页面读的是 `override`，于是文本框是空的、芯片显示"读内置"——夹具与实现的字段名对不上，
  // 红的却是产品。用同一个夹具，这类错就不可能再发生。
  // 文件里那份 PROMPTS 定义在另一个 describe 内部，这里取不到；就地写一份**字段名与实现一致**的：
  // 页面读的是 `override`（不是 `current`），第一版正是把这两个搞混，夹具与实现对不上、红的却是产品。
  const MY_PROMPTS = {
    revision: 2, maxChars: 20_000,
    roles: [
      { role: 'worker', base: '内置的 worker 文本', override: '自定义的 worker 文本', pinsBase: false },
      { role: 'orchestrator', base: '内置的 orchestrator 文本', pinsBase: false },
    ],
  }
  const promptRoutes = (over: Routes = {}): Routes => routes({
    'GET prompts': MY_PROMPTS,
    'PUT prompts': { revision: 3 },
    ...over,
  })

  it('每个角色说自己是什么状态，并给出字数（U6）', async () => {
    await mount(promptRoutes())
    click(button('提示词'))
    await settle()
    expect(read(byId('p-worker-state'))).toBe('已覆盖')
    expect(read(byId('p-orchestrator-state'))).toBe('读内置')
    expect(text('p-worker-count')).toBe(`${'自定义的 worker 文本'.length} 字`)
    // 覆盖文本恰好等于内置时，系统会把这个角色钉在当前版本——这件事必须看得见，不能只在保存后才发现。
    type('p-worker', '内置的 worker 文本')
    expect(read(byId('p-worker-state'))).toContain('与内置相同')
  })

  it('只恢复一个角色时，另一个角色的当前值原样带上，不被顺手抹掉', async () => {
    const { last } = await mount(promptRoutes())
    click(button('提示词'))
    await settle()
    type('p-orchestrator', '我自己写的前台提示词')
    click(button('只恢复这个角色', byId('prompt-card-worker')))
    await settle()
    // PUT 的仍是整份文档，所以"只恢复 worker"必须把 orchestrator 的当前值一起送回去。
    expect(last('PUT prompts')?.body).toEqual({ worker: '', orchestrator: '我自己写的前台提示词' })
    // 第二条守卫，独立于具体值：0.8 强形式量出上一条是**唯一**守卫（删掉它，"两个都抹空"的变异就无人发现）。
    // 这一条只钉那个真正不可接受的结局——把操作者另一个角色写的东西悄悄抹掉。
    expect(last('PUT prompts')?.body).not.toEqual({ worker: '', orchestrator: '' })
    expect(toastText()).toBe('worker 已恢复内置（修订 3）')
  })
})

describe('短码与技术细节折叠（U4）', () => {
  const LONG = 'b356ac649bc46a144c38f9b4b6619175'

  it('技术细节默认折叠，但折叠不等于删除：文本还在 DOM 里', async () => {
    await mount(routes())
    await openListed()
    const fold = one('#detail details.tech')
    // 默认不展开——排障才看的东西不该天天占着屏幕。
    expect(fold.hasAttribute('open')).toBe(false)
    // 但一个字都没丢：授权全文、Trigger id、范围原文都还在文档里（既有 detailValue 断言也正因此不受影响）。
    expect(text('detail')).toContain('策略版本 pv-9f3c')
    expect(text('detail')).toContain('trigger-7')
    expect(text('detail')).toContain('只在这张 Ticket 自己的目录里工作')
    // 展开是操作者的一次点击，不是一次刷新。
    click(one('#detail details.tech summary'))
    expect(one('#detail details.tech').hasAttribute('open')).toBe(true)
  })

  it('正文显示 8 位短码，整串挂在点击复制上——抄 32 位十六进制不该靠人眼', async () => {
    await mount(routes({
      'GET tickets': { offset: 0, limit: 80, count: 1, tickets: [listed({ id: LONG })] },
      [`GET tickets/${LONG}`]: ticket({ id: LONG }),
      [`GET tickets/${LONG}/progress`]: progress(),
      [`GET tickets/${LONG}/files`]: files(),
      [`GET tickets/${LONG}/dependencies`]: { waitsFor: [], waitedOnBy: [] },
      [`GET tickets/${LONG}/events`]: { count: 0, returned: 0, events: [] },
    }))
    await openListed()
    // dd 的文本恰为短码，别无他物：整串若也画出来，这一行就又变回 32 位噪声。
    expect(detailValue('任务'))  // 【U7 改名】旧标签 'Ticket'.toBe('b356ac64…')
    const link = one('#detail .kv button.linklike')
    expect(link.getAttribute('title')).toContain(LONG)
    expect(read(link)).toBe('b356ac64…')
  })
})

describe('删除一张任务（S4）', () => {
  const gone = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
    at: LATER, assets: 'delete', directory: '/tmp/work/digest-ticket-1', files: 3, bytes: 1850, ...over,
  })
  const files = { directory: '/tmp/work/digest-ticket-1', count: 3, truncated: false, files: [
    { path: 'digest.md', directory: false, size: 1200, text: true },
    { path: 'sources', directory: true, size: 0, text: false },
    { path: 'RESULT.md', directory: false, size: 650, text: true },
  ] }

  it('两步确认，而后果那句话里的数字是量出来的，不是估的', async () => {
    const { sent } = await mount(routes({
      'GET tickets/ticket-1': ticket({ stage: 'done', ended: { at: LATER, by: 'agent', outcome: 'done', reason: '做完了' } }),
      'GET tickets': { offset: 0, limit: 80, count: 1, tickets: [listed({ stage: 'done' })] },
      'GET tickets/ticket-1/files': files,
      'POST tickets/ticket-1/delete': { deleted: 'ticket-1' },
    }))
    await openListed()
    // 第一步：只有按钮，没有确认块——一次误点不该直接删掉东西。
    expect(document.querySelector('#d-delete')).toBeNull()
    click(button('删除这张任务'))
    await settle()
    // 第二步：后果写成带数字的一句话，而且数字来自 files 路由（1200 + 650，目录不算字节）。
    expect((document.querySelector('#d-delete-consequence')?.textContent ?? '')).toContain('/tmp/work/digest-ticket-1')
    expect((document.querySelector('#d-delete-consequence')?.textContent ?? '')).toContain('3 个文件')
    expect((document.querySelector('#d-delete-consequence')?.textContent ?? '')).toContain('1.8 KB')
    // 默认落在可逆的一端：留着文件 + 留墓碑。
    expect((document.querySelector('#del-assets-keep') as HTMLInputElement).checked).toBe(true)
    expect((one('#del-record') as HTMLInputElement).checked).toBe(false)
    expect(button('确认删除').textContent).toBe('确认删除')
    click(button('确认删除'))
    await settle()
    expect(sent('POST tickets/ticket-1/delete').at(-1)!.body).toEqual({ assets: 'keep', record: 'tombstone' })
  })

  it('选"连文件一起删"与"记录也不留"，请求体如实反映，按钮文案也跟着变', async () => {
    const { sent } = await mount(routes({
      'GET tickets/ticket-1': ticket({ stage: 'done', ended: { at: LATER, by: 'agent', outcome: 'done', reason: '做完了' } }),
      'GET tickets': { offset: 0, limit: 80, count: 1, tickets: [listed({ stage: 'done' })] },
      'GET tickets/ticket-1/files': files,
      'POST tickets/ticket-1/delete': { deleted: 'ticket-1' },
    }))
    await openListed()
    click(button('删除这张任务'))
    await settle()
    click(document.querySelector('#del-assets-delete')!)
    click(document.querySelector('#del-record')!)
    await settle()
    //  stronger option 的按钮要说清它比默认多做了什么，而不是同一个"确认删除"。
    expect(button('确认删除（记录也不留）')).toBeDefined()
    click(button('确认删除（记录也不留）'))
    await settle()
    expect(sent('POST tickets/ticket-1/delete').at(-1)!.body).toEqual({ assets: 'delete', record: 'nothing' })
  })

  it('运行中的任务不给删，并且当场说清为什么——而不是让人点了再看后端拒绝', async () => {
    await mount(routes({
      'GET tickets/ticket-1': ticket({ stage: 'running' }),
      'GET tickets': { offset: 0, limit: 80, count: 1, tickets: [listed({ stage: 'running' })] },
    }))
    await openListed()
    const open = button('删除这张任务')
    expect(open.getAttribute('title')).toContain('先停止它')
    click(open)
    await settle()
    // 确认块不出现：一张还在跑的任务连"测量目录"这一步都不该走到。
    expect(document.querySelector('#d-delete')).toBeNull()
    expect(toastText()).toContain('先停止它')
  })

  it('墓碑把删掉的量念出来，并说明进气记录为什么还在', async () => {
    await mount(routes({
      'GET tickets/ticket-1': ticket({ stage: 'done', ended: { at: LATER, by: 'agent', outcome: 'done', reason: '做完了' }, deleted: gone() }),
      'GET tickets': { offset: 0, limit: 80, count: 1, tickets: [listed({ stage: 'done', deleted: gone() })] },
    }))
    click(button('已删除'))
    await settle()
    // 列表里它读作"已删除"，而不是继续显示被删之前的"已完成"。
    expect((one('#tickets')?.textContent ?? '')).toContain('已删除')
    click(one('#tickets li'))
    await settle()
    expect(document.querySelector('#d-tombstone')).not.toBeNull()
    expect((document.querySelector('#d-tombstone')?.textContent ?? '')).toContain('3 个文件')
    expect((document.querySelector('#d-tombstone')?.textContent ?? '')).toContain('1.8 KB')
    expect((document.querySelector('#d-tombstone')?.textContent ?? '')).toContain('唯一记录')
    expect((document.querySelector('#d-tombstone')?.textContent ?? '')).toContain('进气记录')
    // 已删的任务不再给删除按钮：重复删除是一个没有答案的问题。
    expect(all('#detail button').map(node => read(node)).some(label => label.includes('删除这张任务'))).toBe(false)
  })

  it('点「已删除」这一档真的按 state=deleted 去读', async () => {
    const { sent } = await mount(routes({
      'GET tickets': { offset: 0, limit: 80, count: 0, tickets: [] },
    }))
    click(button('已删除'))
    await settle()
    expect(sent('GET tickets').at(-1)!.query.get('state')).toBe('deleted')
  })
})

describe('分诊任务在面板上看得出来（S3b）', () => {
  const triaged = { id: 'ticket-triage', title: '现在有几张在跑', stage: 'done', waitsForPerson: false, triage: true,
    ended: { at: LATER, by: 'agent', outcome: 'done', reason: '回答了' } }
  const plain = { id: 'ticket-plain', title: '写一份摘要', stage: 'done', waitsForPerson: false,
    ended: { at: LATER, by: 'agent', outcome: 'done', reason: '做完了' } }

  it('列表里给它一个「分诊」标记，普通任务没有；详情里说清它是什么、为什么一轮就结束是正常的', async () => {
    await mount(routes({
      'GET tickets': { offset: 0, limit: 80, count: 2, tickets: [listed(triaged), listed(plain)] },
      'GET tickets/ticket-triage': ticket(triaged),
      'GET tickets/ticket-plain': ticket(plain),
    }))
    click(button('任务'))
    await settle()
    // one()/byId() 在缺席时会抛，所以"存在"用 one，"不存在"只能用原生查询。
    expect(one('#triage-chip-ticket-triage')).toBeDefined()
    expect(one('#triage-chip-ticket-triage').getAttribute('title')).toContain('决定这个请求变成什么')
    expect(document.querySelector('#triage-chip-ticket-plain')).toBeNull()

    click(all('#tickets li')[0]!)
    await settle()
    const detail = document.querySelector('#d-triage')?.textContent ?? ''
    expect(detail).toContain('分诊任务')
    expect(detail).toContain('一轮就结束')
    // 开关在哪：从这里能走到设置，而不是让人去猜这东西为什么存在。
    expect(detail).toContain('设置')
  })

  it('普通任务的详情里没有这段说明', async () => {
    await mount(routes({
      'GET tickets': { offset: 0, limit: 80, count: 1, tickets: [listed(plain)] },
      'GET tickets/ticket-plain': ticket(plain),
    }))
    click(button('任务'))
    await settle()
    click(one('#tickets li'))
    await settle()
    expect(document.querySelector('#d-triage')).toBeNull()
  })
})

describe('双向引擎血缘 (#d-mentions) 与已掌握的手艺管理（E4）', () => {
  it('即使后续任务的摘要没有提原任务名字，只要引擎记录了 citedBy / cites，#d-mentions 蓝框就双向渲染并可点开', async () => {
    const t1 = 'b356ac649bc46a144c38f9b4b6619175'
    const t2 = '19dd5c9ca7bce11fb2c9f7a2b04728b0'
    await mount(routes({
      'GET tickets': { offset: 0, limit: 80, count: 2, tickets: [
        listed({ id: t1, title: '搜集信息', stage: 'done', summary: '没有任何提及' }),
        listed({ id: t2, title: '信息比对', stage: 'done', summary: '同样没有任何提及' }),
      ] },
      [`GET tickets/${t1}`]: ticket({ id: t1, title: '搜集信息', stage: 'done', citedBy: [t2], cites: [] }),
      [`GET tickets/${t2}`]: ticket({ id: t2, title: '信息比对', stage: 'done', citedBy: [], cites: [t1] }),
    }))
    click(button('任务'))
    await settle()
    click(all('#tickets li')[0]!)
    await settle()
    const citedByRow = document.querySelector('#d-mentions-cited-by')
    expect(citedByRow).not.toBeNull()
    expect(citedByRow?.textContent).toContain('关联引用')
    expect(citedByRow?.textContent).toContain('信息比对（19dd5c9c） · 打开')

    // 点按钮跳转到引用方 t2，看到反向的「借力来源」
    click(button('信息比对（19dd5c9c） · 打开', one('#d-mentions')))
    await settle()
    const citesRow = document.querySelector('#d-mentions-cites')
    expect(citesRow).not.toBeNull()
    expect(citesRow?.textContent).toContain('借力来源')
    expect(citesRow?.textContent).toContain('搜集信息（b356ac64） · 打开')
  })

  it('在「提示词」页展示内置与任务沉淀的手艺（Skills），支持暂停与两步确认忘掉', async () => {
    let skillEnabled = true
    let deleted = false
    const { sent } = await mount(routes({
      'GET prompts': () => ({
        revision: 2, maxChars: 20_000,
        roles: [
          { role: 'worker', current: '自定义的 worker 文本', base: '内置的 worker 文本', override: '自定义的 worker 文本', pinsBase: false },
          { role: 'orchestrator', current: '内置的 orchestrator 文本', base: '内置的 orchestrator 文本', override: undefined, pinsBase: false },
        ],
        // 内置手艺现在由服务端给（面板不再存副本），所以桩必须带上它——否则这一页只会渲染动态那批。
        builtInSkills: [
          { name: 'myagent-html-to-text', title: '网页转干净正文', description: '把抓取的 HTML 网页转为纯文本', whenToUse: 'x', builtIn: true, enabled: true },
        ],
        skills: deleted ? [] : [{
          name: 'myagent-dedup-merger',
          title: '多源实体归一化去重器',
          description: '消除多源融资记录的全半角与别名重复',
          fromTicketId: '68172c094da50125a6fbbc642e56006b',
          enabled: skillEnabled,
          useCount: 3,
        }],
      }),
      'POST prompts/skills/myagent-dedup-merger/toggle': (call: { body?: { enabled?: boolean } }) => {
        skillEnabled = Boolean(call.body?.enabled)
        return { revision: 4 }
      },
      'POST prompts/skills/myagent-dedup-merger/delete': () => {
        deleted = true
        return { revision: 5, deleted: 'myagent-dedup-merger' }
      },
    }))
    click(button('提示词'))
    await settle()
    const listText = one('#skills-list').textContent ?? ''
    expect(listText).toContain('网页转干净正文')
    expect(listText).toContain('多源实体归一化去重器')
    // 【产品变更】旧断言：expect(listText).toContain('已复用 3 次')
    // 理由：`useCount` 数的是**用过这门手艺的任务数**（同任务重复加载只算一次、且只算宿主真正加载成功那次），
    // 不是调用次数。写「已复用 3 次」会让人以为一个 worker 重试三次等于三张任务验证过它。
    expect(listText).toContain('被 3 张任务用过')
    expect(listText).toContain('未经人工复核')

    click(one('#skill-toggle-myagent-dedup-merger'))
    await settle()
    expect(sent('POST prompts/skills/myagent-dedup-merger/toggle').at(-1)?.body).toEqual({ enabled: false })
    expect(one('#skill-card-myagent-dedup-merger').textContent).toContain('已暂停')

    // 来源任务不在列表里时，标签退化成人话而不是 8 位十六进制；整串 id 挂在 title 上（U16 的既有规矩）。
    const origin = one('#skill-origin-myagent-dedup-merger')
    expect(origin.textContent).toContain('一张已不在当前列表的任务')
    expect(origin.textContent).not.toContain('68172c09')
    expect(origin.getAttribute('title')).toContain('68172c094da50125a6fbbc642e56006b')

    // 取消分支：确认行收回去、卡片回到「忘掉」态、且**一个请求都不发**（第一步不发请求是两步确认的全部意义）。
    const beforeCancel = sent('POST prompts/skills/myagent-dedup-merger/delete').length
    click(one('#skill-del-myagent-dedup-merger'))
    await settle()
    expect(one('#skill-card-myagent-dedup-merger').textContent).toContain('确定忘掉这项手艺？')
    click(button('取消', one('#skill-card-myagent-dedup-merger')))
    await settle()
    expect(one('#skill-card-myagent-dedup-merger').textContent).not.toContain('确定忘掉这项手艺？')
    expect(document.querySelector('#skill-del-myagent-dedup-merger')).not.toBeNull()
    expect(sent('POST prompts/skills/myagent-dedup-merger/delete')).toHaveLength(beforeCancel)
    // 取消用的是服务端最近一次的列表，所以卡片还在（用旧快照重绘会让它凭空消失）。
    expect(one('#skills-list').textContent).toContain('多源实体归一化去重器')

    // 确认态属于那一次点击，不属于这一页：切走再回来，确认行不该还开着（旧实现把 confirmDeleteSkill
    // 留在模块级且 loadPrompts 从不重置它，于是操作者切个页回来还会看到一个自己已经放弃的删除确认）。
    click(one('#skill-del-myagent-dedup-merger'))
    await settle()
    expect(one('#skill-card-myagent-dedup-merger').textContent).toContain('确定忘掉这项手艺？')
    click(button('任务'))
    await settle()
    click(button('提示词'))
    await settle()
    expect(one('#skill-card-myagent-dedup-merger').textContent).not.toContain('确定忘掉这项手艺？')

    click(one('#skill-del-myagent-dedup-merger'))
    await settle()
    click(one('#skill-del-confirm-myagent-dedup-merger'))
    await settle()
    expect(sent('POST prompts/skills/myagent-dedup-merger/delete')).toHaveLength(1)
    expect(document.querySelector('#skill-card-myagent-dedup-merger')).toBeNull()
  })
})

describe('面板不再自己存一份内置手艺清单', () => {
  it('页面源码里没有内置手艺的名字或中文标题，它们只能来自 GET prompts 的 builtInSkills', () => {
    // 这一条拥有那处跨文件比较：内置手艺的事实住在 src/app/skills.ts 的 SKILLS 与 builtInSkillsView()，
    // 页面若再存一份，加第四门内置手艺时两边就会各自全绿地漂移（tests/skills.spec.ts 已钉住服务端那侧）。
    for (const needle of ['myagent-html-to-text', 'myagent-source-registry', 'myagent-polite-fetch',
      '网页转干净正文', '可审计信源登记表', '礼貌批量抓取器', 'BUILTIN_SKILLS_VIEW']) {
      expect(PAGE).not.toContain(needle)
    }
    expect(PAGE).toContain('body.builtInSkills')
  })
})

describe('bounded box-model CSS, cross-Ticket citation backlinks (F6), deep links, and quick settings', () => {
  it('declares an icon, so the browser does not probe /favicon.ico and 404 on every page load', () => {
    // Asserted at the source level because jsdom makes no favicon request at all — the 404 only exists in a real
    // browser, which is exactly the class of fact §4.49 says this suite is structurally blind to. The real-browser
    // script asserts the consequence (zero console errors, zero failed requests); this pins the cause.
    expect(PAGE).toMatch(/<link rel="icon" href="data:image\/svg\+xml,/)
  })

  it('bounds .filelist and pre heights in CSS so a 547-file Ticket cannot inflate the document to 37,112 px', () => {
    expect(PAGE).toMatch(/\.filelist\s*\{[^}]*max-height:\s*260px[^}]*overflow-y:\s*auto/)
    expect(PAGE).toMatch(/pre\s*\{[^}]*max-height:\s*240px[^}]*overflow-y:\s*auto/)
  })

  it('shows cross-Ticket citation backlinks (#d-mentions) when another Ticket mentions this Ticket id or title', async () => {
    const t1 = 'b356ac649bc46a144c38f9b4b6619175'
    const t2 = '19dd5c9ca7bce11fb2c9f7a2b04728b0'
    await mount(routes({
      'GET tickets': () => ({
        offset: 0, limit: 80, count: 2,
        tickets: [
          listed({ id: t1, title: '搜集信息', stage: 'done' }),
          listed({ id: t2, title: '信息比对', stage: 'done', summary: '已与另一 Ticket（搜集信息 / b356ac64）合并成综合论述。' }),
        ],
      }),
      [`GET tickets/${t1}`]: ticket({ id: t1, title: '搜集信息', stage: 'done' }),
      [`GET tickets/${t1}/progress`]: progress(),
      [`GET tickets/${t1}/files`]: files(),
      [`GET tickets/${t1}/dependencies`]: { waitsFor: [], waitedOnBy: [] },
      [`GET tickets/${t1}/events`]: { count: 0, returned: 0, events: [] },
      [`GET tickets/${t2}`]: ticket({ id: t2, title: '信息比对', stage: 'done' }),
      [`GET tickets/${t2}/progress`]: progress(),
      [`GET tickets/${t2}/files`]: files(),
      [`GET tickets/${t2}/dependencies`]: { waitsFor: [], waitedOnBy: [] },
      [`GET tickets/${t2}/events`]: { count: 0, returned: 0, events: [] },
    }))
    click(one('#tickets li'))
    await settle()
    const mentions = one('#d-mentions')
    expect(read(mentions)).toContain('关联引用')
    expect(read(mentions)).toContain('信息比对（19dd5c9c）')
    click(one('#d-mentions button'))
    await settle()
    expect(read(one('#detail h2'))).toBe('信息比对')
  })

  it('routes #work=<id> deep links directly to the Works tab and loads that Work detail', async () => {
    await mount(routes({
      'GET works': { works: [work({ id: 'work-99', name: '谷歌法律专题' })] },
      'GET works/work-99': {
        work: work({ id: 'work-99', name: '谷歌法律专题', scope: '法务范围' }),
        tickets: [],
      },
    }), '#work=work-99')
    await settle()
    expect(one('#tab-works').classList.contains('hidden')).toBe(false)
    expect(one('#tab-tickets').classList.contains('hidden')).toBe(true)
    expect(read(one('#work-detail'))).toContain('谷歌法律专题')
    expect(read(one('#work-detail'))).toContain('work-99')
  })

  it('syncs the quick settings bar (#settings-quick) with the JSON textarea in both directions', async () => {
    await mount(routes())
    click(button('设置'))
    await settle()
    expect(input('sq-mode').value).toBe('auto')
    expect(input('sq-workers').value).toBe('2')
    expect(input('sq-senders').value).toBe('operator')

    choose('sq-senders', 'operator, alice')
    choose('sq-mode', 'observe')
    const parsed = JSON.parse(area('settings').value)
    expect(parsed.acceptMode).toBe('observe')
    expect(parsed.allowedSenders).toEqual(['operator', 'alice'])
  })
})

describe('排期的送达地址（S-2）', () => {
  it('在排期行上说清报告送去哪个聊天频道', async () => {
    await mount(scheduleRoutes())
    click(button('派活'))
    await settle()
    click(button('定时派'))
    await settle()
    const rows = all('#schedules li').map(node => read(node)).join('\n')
    expect(rows).toContain('送到聊天频道 telegram')
  })

  it('服务端没报送达地址时明说未知，而不是留一格空白让人猜', async () => {
    await mount(scheduleRoutes({
      // 夹具的 deliverToText 在展开之后、会盖掉 over 里的 undefined，所以"服务端没报"只能这样造：
      // 造一份视图再把键删掉。夹具的写法本身不是错的——默认值必须能赢过调用者的省略——只是这里要的恰恰是"缺席"。
      'GET schedules': { zone: 'Asia/Shanghai', schedules: [(() => { const view = scheduleView(); delete view.deliverToText; return view })()] },
    }))
    click(button('派活'))
    await settle()
    click(button('定时派'))
    await settle()
    const rows = all('#schedules li').map(node => read(node)).join('\n')
    expect(rows).toContain('送达 （这一版服务端没报，未知）')
  })
})
