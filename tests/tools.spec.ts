/**
 * The tools: how a person drives this system from a Session, and how a worker speaks.
 *
 * A tool answer is what a model reads next, so a refusal has to say what to do rather than throw a stack trace at it,
 * and a schema has to refuse an argument that would produce work nobody asked for — a blank title, an empty answer.
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { Store } from '../src/app/store.ts'
import { definitionOf, mainTools, workerTools, type Tool, type ToolsHost } from '../src/app/tools.ts'
import {
  Engine, parseSettings, settingsPolicy, type Assignment, type Delivery, type Executor, type Mandate,
  type Report, type Settings, type Ticket, type TicketInput,
} from '../src/core/index.ts'
import { tempDir } from './helpers/temp.ts'

class FakeExecutor implements Executor {
  /** Bound after construction, because the Engine is built with this Executor in its options. */
  engine?: Engine
  readonly started: { ticketId: string; assignmentId: string }[] = []
  prepare(ticket: Ticket, _mandate: Mandate): Ticket {
    return { ...ticket, execution: { name: ticket.id, directory: `/tmp/work/${ticket.id}` } }
  }
  start(ticket: Ticket, assignment: Assignment): void { this.started.push({ ticketId: ticket.id, assignmentId: assignment.id }); this.engine?.assignmentStarted(ticket.id, assignment.id) }
  deliver(): void {}
  stop(): void {}
}

class FakeDelivery implements Delivery {
  readonly reports: Report[] = []
  report(_ticket: Ticket, report: Report): void { this.reports.push(report) }
}

interface Harness {
  readonly store: Store
  readonly engine: Engine
  readonly executor: FakeExecutor
  readonly tools: Tool[]
  readonly settings: () => Settings
  save(value: unknown): void
  /**
   * Call a tool the way DSH does: through the registration shape, which parses the arguments against the schema and
   * applies its defaults. Calling `execute` directly instead would test a path no model can reach, and every default
   * the schema carries would silently be missing.
   */
  call(name: string, args: unknown): Promise<Record<string, unknown>>
  registered(name: string, args: unknown): Promise<unknown>
  worker(ticketId: string): Tool
  report(ticketId: string, args: unknown): Promise<unknown>
}

function harness(acceptMode: 'auto' | 'observe' = 'auto'): Harness {
  const directory = tempDir('myagent-tools-')
  const store = new Store(join(directory, 'tools.sqlite3'))
  const executor = new FakeExecutor()
  let current = parseSettings({ acceptMode, allowedSenders: ['operator'] })
  const engine = new Engine({
    repos: store, tx: store, policy: () => settingsPolicy(current), executor, delivery: new FakeDelivery(),
    now: () => '2026-11-03T02:00:00.000Z',
  })
  // The real Executor marks the Assignment running when a launch succeeds (executor.ts:156); a fake
  // that does not leaves every test reporting into a state production never reports from.
  executor.engine = engine
  const host: ToolsHost = { engine, store, acceptMode: () => current.acceptMode,
      // Mirrors what `Sessions.attempt` answers in production: the attempt a launch recorded. Answering `undefined`
      // here would exercise only the fallback and never the identity a report is supposed to carry.
      attempt: (ticketId: string) => store.tickets.get(ticketId)?.assignments.find(item => item.state === 'running')?.id,
      // S3a 的两个窄接口：这两个文件不测回话，桩只保证类型完整。**不返回假的 sent:true**——
      // 那会让任何误用它的测试看起来通过。
      returnAddressOf: () => undefined,
      replyToRequester: () => ({ sent: false, reason: 'stubbed: this suite does not exercise replies' }),
    raiseDecision: () => 'decision-1',
      askDesk: () => ({ sent: false }),  // stubbed
      promoteSkill: async () => ({ ok: false, error: 'stubbed' }),
      // Faithful where it matters: the authorization is the real Engine's, so a refusal the tool surfaces is a refusal
      // the Engine actually made. Only the IO is stubbed.
      readArtifact: async (source: string, target = '', path = '') => {
        try {
          engine.authorizeArtifactRead(source, target, path)
        } catch (error) {
          const failure = error as { message?: string; code?: string }
          return { ok: false as const, error: failure.message ?? String(error), code: failure.code }
        }
        return { ok: true as const, content: `content of ${path}`, size: 12, at: '2026-11-03T00:00:00.000Z' }
      },
    }
  const tools = mainTools(host)
  const find = (name: string): Tool => {
    const found = tools.find(tool => tool.name === name)
    if (found === undefined) throw new Error(`no tool named ${name}`)
    return found
  }
  const signal = () => new AbortController().signal
  return {
    store, engine, executor, tools,
    settings: () => current,
    save: value => { current = parseSettings(value) },
    call: async (name, args) => await definitionOf(find(name)).execute(args, { signal: signal() }) as Record<string, unknown>,
    registered: async (name, args) => await definitionOf(find(name)).execute(args, { signal: signal() }),
    worker: ticketId => workerTools(host, engine.require(ticketId))[0]!,
    report: async (ticketId, args) => await workerTools(host, engine.require(ticketId))[0]!
      .execute(args as never, signal()) as unknown,
  }
}

/** Each request gets its own text: with a fixed clock, identical requests are the same Trigger by design. */
let serial = 0

/** Open one Ticket through the tool a person would use, and return its id. */
async function open(h: Harness, title = '每日摘要', over: object = {}): Promise<string> {
  serial++
  const answer = await h.call('myagent_create_ticket', { title, request: `写今天的摘要（第 ${serial} 份），产出 digest.md`, ...over })
  const id = answer.ticket_id as string | undefined
  expect(id, JSON.stringify(answer)).toBeTruthy()
  return id!
}

describe('the registration shape', () => {
  it('turns every tool into a JSON Schema DSH can hand a model', async () => {
    const h = harness()
    const id = await open(h)
    for (const tool of [...h.tools, h.worker(id)]) {
      const definition = definitionOf(tool)
      expect(definition.parameters).toMatchObject({ type: 'object' })
      expect(definition.name).toBe(tool.name)
      expect(definition.description.length).toBeGreaterThan(20)
      // The renderer is what a model reads back, so it has to be text and it has to survive any value.
      expect(definition.output.render({}, { anything: true })).toEqual([{ type: 'text', text: expect.stringContaining('anything') }])
    }
  })

  it('names the tools a person gets, and keeps the worker\'s own tool out of that list', () => {
    const names = harness().tools.map(tool => tool.name)
    // 【S3a 产品变更】前台多了 `myagent_reply`（把话送回请求者）。旧值：
    //   ['myagent_create_ticket', 'myagent_list_tickets', 'myagent_ticket_status', 'myagent_answer_ticket',
    //    'myagent_note_ticket', 'myagent_stop_ticket', 'myagent_retry_ticket']
    // 加它的理由：`myagent_answer_ticket` 是把文本交给 **worker**，前台此前**没有任何工具能把话送回聊天里那个人**——
    // 于是"前台自己回答请求者"这条路根本不存在，而它正是"拉优先于推"要依赖的能力。
    // 【B1 产品变更】又多了 `myagent_close_ticket`。上一行的旧值在那次之后是：
    //   [... 'myagent_reply', 'myagent_note_ticket', 'myagent_stop_ticket', 'myagent_retry_ticket']
    // 加它的理由：`desk:'main'` 时操作者自己的 Session 就是分诊台，而它**没有 `myagent_report`**
    // （那是 worker 的、绑在 attempt 上），所以它无法给一张分诊任务收尾——B1 缺的就是这一块。
    // 【0.11.0 产品变更】前台多了 `myagent_raise_decision`（把决断停到面板的「需要你决断的事」队列）。上一行的旧值是：
    //   ['myagent_create_ticket', 'myagent_list_tickets', 'myagent_ticket_status', 'myagent_answer_ticket',
    //    'myagent_reply', 'myagent_note_ticket', 'myagent_stop_ticket', 'myagent_close_ticket', 'myagent_retry_ticket']
    // 加它的理由：操作者要求"中间不需要我决断的机制"——值得他决断的事必须有一个**不打断任何事**的落点，
    // 否则 worker 遇到"该扩展但不该我自决"的事时，只有停下手等人这一种诚实做法。
    // 【G-1 产品变更】前台多了 `myagent_recall`（按关键词检索历史任务）。上一行的旧值是：
    //   ['myagent_create_ticket', 'myagent_list_tickets', 'myagent_ticket_status', 'myagent_answer_ticket',
    //    'myagent_reply', 'myagent_raise_decision', 'myagent_note_ticket', 'myagent_stop_ticket',
    //    'myagent_close_ticket', 'myagent_retry_ticket']
    // 加它的理由：操作者问"上次找到什么、那个文件叫什么"时，前台只有 list（state 筛选）没有检索——
    // 任务一多 list 就回答不了这个问题，而"凭印象回答"正是它该拒绝的事。
    expect(names).toEqual([
      'myagent_create_ticket', 'myagent_list_tickets', 'myagent_recall', 'myagent_ticket_status', 'myagent_answer_ticket',
      // 顺序照 mainTools 里的声明顺序：recall 紧跟 list（同族读者），raise_decision 在 note 之前，close_ticket 在 stop 之后、retry 之前。
      'myagent_reply', 'myagent_raise_decision', 'myagent_note_ticket', 'myagent_stop_ticket',
      'myagent_close_ticket', 'myagent_retry_ticket',
    ])
    expect(names).not.toContain('myagent_report')
  })

  it('refuses to open a Ticket that would report nowhere, rather than opening it silently', async () => {
    // `report_to_ticket` copies an address; when the named Ticket has none, the honest answer is an error at call
    // time. Opening the Ticket anyway would produce one whose reports reach only the panel — and the front desk would
    // believe it had routed the answer back to the person who asked.
    const h = harness()
    const result = await h.registered('myagent_create_ticket', {
      title: '巡视一遍', request: '看看现在有几张在跑', report_to_ticket: 'ticket-with-no-address',
    }) as { error?: string }
    expect(result.error).toContain('has no reply address to copy')
    expect(result.error).toContain('myagent_reply')
  })

  it('refuses arguments the schema does not describe, before the Engine sees them', async () => {
    const h = harness()
    // `strict` is what stops a model from inventing a field that would silently do nothing.
    await expect(h.registered('myagent_list_tickets', { state: 'open', colour: 'red' })).rejects.toSatisfy(
      (error: unknown) => error instanceof z.ZodError)
    await expect(h.registered('myagent_create_ticket', { title: '   ', request: '做事' })).rejects.toSatisfy(
      (error: unknown) => error instanceof z.ZodError)
    await expect(h.registered('myagent_ticket_status', {})).rejects.toSatisfy((error: unknown) => error instanceof z.ZodError)
  })
})

describe('opening a Ticket from a Session', () => {
  it('opens one and says what it became', async () => {
    const h = harness()
    const answer = await h.call('myagent_create_ticket', { title: '调研三家竞品', request: '产出 report.md', scope: '只读 ~/notes' })
    expect(answer).toMatchObject({ stored: 'stored', disposition: 'accepted', accept_mode: 'auto', reason: 'accepted' })
    const ticket = h.engine.require(answer.ticket_id as string)
    expect(ticket.mandate).toMatchObject({ scope: '只读 ~/notes', via: 'session', sender: { id: 'operator' } })
    expect(ticket.execution?.directory).toContain(ticket.id.slice(0, 8))
    // Opening a Ticket is what asks the Executor to launch it.
    expect(h.executor.started).toHaveLength(1)
  })

  it('records instead of executing while the accept mode is observe, and says how to change that', async () => {
    const h = harness('observe')
    const answer = await h.call('myagent_create_ticket', { title: '调研', request: '产出 report.md' })
    expect(answer).toMatchObject({ disposition: 'observed', accept_mode: 'observe', reason: 'observed' })
    expect(answer.ticket_id).toBeUndefined()
    expect(answer.note).toContain('acceptMode')
    expect(h.executor.started).toEqual([])
    expect(h.store.decisions.list(5)[0]).toMatchObject({ outcome: 'observe' })
  })

  it('refuses a sender who may not originate work, with the gate\'s own reason', async () => {
    const h = harness()
    const answer = await h.call('myagent_create_ticket', { title: '调研', request: '做事', sender: 'stranger' })
    expect(answer).toMatchObject({ disposition: 'ignored', reason: 'sender_not_allowed' })
    expect(answer.detail).toContain('stranger')
    expect(h.executor.started).toEqual([])
  })

  it('opens one Ticket when the same request arrives twice, so a retried tool call cannot duplicate work', async () => {
    const h = harness()
    const request = { title: '调研', request: '产出 report.md' }
    const first = await h.call('myagent_create_ticket', request)
    const second = await h.call('myagent_create_ticket', request)
    expect(first).toMatchObject({ stored: 'stored', disposition: 'accepted' })
    expect(second).toMatchObject({ stored: 'duplicate', disposition: 'accepted' })
    expect(second.ticket_id).toBe(first.ticket_id)
    expect(h.store.tickets.list()).toHaveLength(1)
    // One Ticket means one launch, not two workers in one directory.
    expect(h.executor.started).toHaveLength(1)
    // A different request is different work.
    expect(await open(h, '另一件事')).not.toBe(first.ticket_id)
  })
})

describe('reading what the system is doing', () => {
  it('lists by the state asked for, newest first, within the limit', async () => {
    const h = harness()
    const one = await open(h, '第一个')
    await open(h, '第二个')
    await h.call('myagent_stop_ticket', { ticket_id: one, reason: '不需要了' })
    const openList = await h.call('myagent_list_tickets', {}) as { count: number; tickets: { title: string }[] }
    expect(openList.count).toBe(1)
    expect(openList.tickets[0]!.title).toBe('第二个')
    const ended = await h.call('myagent_list_tickets', { state: 'ended' }) as { tickets: { outcome: string }[] }
    expect(ended.tickets[0]!.outcome).toBe('stopped')
    const all = await h.call('myagent_list_tickets', { state: 'all', limit: 1 }) as { count: number }
    expect(all.count).toBe(1)
    // The defaults are the ones a person usually means.
    expect((await h.call('myagent_list_tickets', {})).state).toBe('open')
  })

  it('reads one Ticket in full, including what it is allowed to do', async () => {
    const h = harness()
    const id = await open(h, '调研', { scope: '只读 ~/notes' })
    const view = await h.call('myagent_ticket_status', { ticket_id: id })
    expect(view.mandate).toMatchObject({ scope: '只读 ~/notes', via: 'session' })
    // A launch that succeeded marks the attempt running, exactly as the real Executor does at executor.ts:156.
    expect(view.assignment).toMatchObject({ state: 'running' })
    expect(view).toHaveProperty('latest_report')
    expect(view.inputs).toEqual([])
  })

  it('says a Ticket it cannot find is missing, rather than answering with nothing', async () => {
    const h = harness()
    expect(await h.call('myagent_ticket_status', { ticket_id: 'no-such-ticket' }))
      .toMatchObject({ code: 'ticket_missing' })
    expect((await h.call('myagent_ticket_status', { ticket_id: 'no-such-ticket' })).error).toBeTruthy()
  })

  it('tells a caller with no Ticket where work enters, instead of only naming the id that was wrong', async () => {
    const h = harness()
    // The refusal met by a person who opened a Session in the GUI, ran it under the worker preset and asked it to
    // report: the code says what was wrong with this call, and `next` says what to do instead. Naming only a bad id
    // sends its reader looking for another id, which is how "I dispatched work and myagent looks broken" gets written
    // (`19-production-findings.md` F7).
    const missing = await h.call('myagent_ticket_status', { ticket_id: 'no-such-ticket' })
    expect(missing).toMatchObject({ code: 'ticket_missing' })
    expect(missing.next).toContain('派活')
    expect(missing.next).toContain('myagent-main')
    expect(missing.next).toContain('inbox')

    const id = await open(h)
    await h.call('myagent_stop_ticket', { ticket_id: id })
    const ended = await h.call('myagent_note_ticket', { ticket_id: id, text: '补一句' })
    expect(ended).toMatchObject({ code: 'ticket_ended' })
    expect(ended.next).toContain('派活')
    // A refusal that is not about there being no live Ticket keeps its one line: guidance where it does not apply is
    // noise, and a model that learns to skip `next` stops reading it where it matters.
    expect(await h.call('myagent_stop_ticket', { ticket_id: id })).not.toHaveProperty('next')
  })
})

describe('talking to a running Ticket', () => {
  it('answers a Ticket that asked, which clears the question and delivers the text', async () => {
    const h = harness()
    const id = await open(h)
    await h.report(id, { state: 'blocked', summary: '需要决定', question: '按公司还是按产品？' })
    expect(h.engine.require(id).attention?.question).toBe('按公司还是按产品？')
    const answer = await h.call('myagent_answer_ticket', { ticket_id: id, text: '按公司排' })
    expect(answer).toMatchObject({ ticket_id: id, waits_for_person: false })
    const ticket = h.engine.require(id)
    expect(ticket.attention).toBeUndefined()
    expect(ticket.inputs.at(-1)).toMatchObject({ kind: 'text', text: '按公司排' })
  })

  it('gives a working Ticket a fact without granting it anything', async () => {
    const h = harness()
    const id = await open(h)
    const answer = await h.call('myagent_note_ticket', { ticket_id: id, text: '数据在 ~/notes/2026' })
    expect(answer).toMatchObject({ ticket_id: id, delivered_to: 'running' })
    const ticket = h.engine.require(id)
    expect(ticket.inputs.at(-1)).toMatchObject({ kind: 'note', text: '数据在 ~/notes/2026' } as Partial<TicketInput>)
    // The scope is the authorization, and a note does not change it.
    expect(ticket.mandate.scope).toContain('own directory')
  })

  it('refuses an answer to a Ticket that has ended, with the code the model can act on', async () => {
    const h = harness()
    const id = await open(h)
    await h.call('myagent_stop_ticket', { ticket_id: id })
    expect(await h.call('myagent_answer_ticket', { ticket_id: id, text: '还在吗' })).toMatchObject({ code: 'ticket_ended' })
    expect(await h.call('myagent_note_ticket', { ticket_id: id, text: '补一句' })).toMatchObject({ code: 'ticket_ended' })
  })

  it('stops a Ticket once, and says the second stop has nothing to stop', async () => {
    const h = harness()
    const id = await open(h)
    expect(await h.call('myagent_stop_ticket', { ticket_id: id, reason: '不需要了' }))
      .toMatchObject({ stage: 'stopped', outcome: 'stopped' })
    expect(h.engine.require(id).ended?.reason).toBe('不需要了')
    expect(await h.call('myagent_stop_ticket', { ticket_id: id })).toMatchObject({ code: 'stop_refused' })
  })

  it('retries a Ticket that stalled, and refuses one that is simply working', async () => {
    const h = harness()
    const working = await open(h, '正在干活')
    h.engine.assignmentStarted(working, h.engine.require(working).assignments[0]!.id)
    expect(await h.call('myagent_retry_ticket', { ticket_id: working })).toMatchObject({ code: 'retry_refused' })

    const blocked = await open(h, '卡住了')
    // A stalled attempt is one that ran and could not finish; one that never started is pushed again as it is.
    h.engine.assignmentStarted(blocked, h.engine.require(blocked).assignments[0]!.id)
    await h.report(blocked, { state: 'failed', summary: '模型没回答' })
    const retried = await h.call('myagent_retry_ticket', { ticket_id: blocked }) as { assignments: number; stage: string }
    expect(retried.assignments).toBe(2)
    expect(retried.stage).toBe('pending')
    // The fresh attempt is in the same directory, so the work continues rather than starting over.
    expect(h.engine.require(blocked).execution?.directory).toContain(blocked.slice(0, 8))
    expect(h.executor.started.filter(start => start.ticketId === blocked)).toHaveLength(2)
  })
})

describe('the worker\'s one tool', () => {
  it('ends a Ticket on ready, carrying what it produced', async () => {
    const h = harness()
    const id = await open(h)
    const answer = await h.report(id, { state: 'ready', summary: '写好了 digest.md', files: ['digest.md'] }) as Record<string, unknown>
    expect(answer).toMatchObject({ state: 'ready' })
    const ticket = h.engine.require(id)
    expect(ticket.ended).toMatchObject({ outcome: 'done' })
    expect(ticket.result).toMatchObject({ summary: '写好了 digest.md', files: ['digest.md'] })
  })

  it('keeps a Ticket open on blocked, with the question a person has to answer', async () => {
    const h = harness()
    const id = await open(h)
    await h.report(id, { state: 'blocked', summary: '需要决定', question: '按公司还是按产品？' })
    const ticket = h.engine.require(id)
    expect(ticket.ended).toBeUndefined()
    expect(ticket.attention?.question).toBe('按公司还是按产品？')
  })

  it('records progress without changing what the Ticket is', async () => {
    const h = harness()
    const id = await open(h)
    await h.report(id, { state: 'progress', summary: '读完三个源' })
    const ticket = h.engine.require(id)
    expect(ticket.ended).toBeUndefined()
    expect(ticket.attention).toBeUndefined()
    expect(ticket.assignments[0]!.report).toMatchObject({ state: 'progress', summary: '读完三个源' })
  })

  it('drops a request that needed no work, which ends the Ticket without a result', async () => {
    const h = harness()
    const id = await open(h)
    await h.report(id, { state: 'dropped', summary: '这个请求已经是上周的产物' })
    expect(h.engine.require(id).ended).toMatchObject({ outcome: 'dropped' })
  })

  it('refuses a report from a Ticket whose authorization ended', async () => {
    const h = harness()
    const id = await open(h)
    await h.call('myagent_stop_ticket', { ticket_id: id })
    const tool = h.worker(id)
    // 【产品变更】旧断言：await expect(definitionOf(tool).execute({ state: 'ready', summary: '太晚了' }, { signal: new AbortController().signal }))
    //   .rejects.toMatchObject({ code: 'ticket_ended' })
    // 理由：异常逃给宿主会变成 worker 读不懂的 tool error，而 `NEXT_STEP` 表里早就为 `ticket_ended` 写好了
    // "下一步该做什么"的文案却送不到它眼前。现在与 `myagent_note_ticket` 一致：resolve 成 { error, code, next }。
    // 断言没有放宽——`code` 仍然被钉住，另外新增 `next` 文案必须真的送到。
    const answer = await definitionOf(tool).execute({ state: 'ready', summary: '太晚了' }, { signal: new AbortController().signal }) as Record<string, unknown>
    expect(answer).toMatchObject({ code: 'ticket_ended' })
    expect(String(answer.error)).toContain('has ended')
    expect(String(answer.next)).toContain('needs a Ticket of its own')
  })

  /**
   * Order is the assertion here, not the promotion's own outcome.
   *
   * A promotion writes into the shared craft library and cannot be taken back by a later failure, while a report that
   * lands on an ended Ticket is refused cleanly — so the reversible step must not come after the irreversible one.
   * And the answer must not look like a failed report: a top-level `error` is what tells a worker "your report did not
   * land", which sends it to report the same work again against a Ticket that has already ended.
   */
  it('lands the report first, then reports a failed promotion beside it rather than instead of it', async () => {
    const h = harness()
    const id = await open(h)
    // The harness's `promoteSkill` answers `{ ok: false, error: 'stubbed' }`, which is the failing half of the pair.
    const answer = await h.report(id, {
      state: 'ready', summary: '写好了 digest.md', files: ['digest.md'],
      promote_skill: { name: 'dedup', title: '去重器', description: '去重', script_path: 'dedup.py' },
    }) as Record<string, unknown>
    // (a) The report landed: the Ticket really ended, and with the outcome a `ready` report produces.
    expect(h.engine.require(id).ended).toMatchObject({ outcome: 'done' })
    expect(answer).toMatchObject({ state: 'ready', ended: true, outcome: 'done' })
    // (b) The promotion's failure travels on the result, and no success is claimed for it.
    expect(String(answer.skill_promotion_error)).toContain('stubbed')
    expect('promoted_skill' in answer).toBe(false)
    // (c) Nothing at the top level reads as "the report failed".
    expect('error' in answer).toBe(false)
    expect('code' in answer).toBe(false)
  })
})

describe('what the report tool answers with', () => {
  // DSH refuses a tool result whose JSON is not lossless, and `{ outcome: undefined }` is exactly that. Every
  // non-terminal report came back to the worker as a tool error while the report itself had landed, so the worker
  // believed reporting had failed and spent a turn retrying it.
  it('omits the outcome key entirely while the Ticket is still open', async () => {
    const context = harness()
    const made = context.engine.createTicket({ title: '还在做', text: '做点事' })
    const answer = await context.report(made.ticketId!, { state: 'progress', summary: '进展顺利' }) as Record<string, unknown>
    expect('outcome' in answer).toBe(false)
    expect('note' in answer).toBe(false)
    expect(answer).toMatchObject({ ended: false, state: 'progress' })
  })

  it('names the outcome once the Ticket has ended, so the worker stops reporting', async () => {
    const context = harness()
    const made = context.engine.createTicket({ title: '要结束', text: '做点事' })
    const answer = await context.report(made.ticketId!, { state: 'ready', summary: '做完了' }) as Record<string, unknown>
    expect(answer).toMatchObject({ ended: true, outcome: 'done' })
    expect(String(answer.note)).toContain('has ended')
  })
})

describe('recalling past work (G-1: myagent_recall)', () => {
  /** 一张已完成的任务，带产物与摘要——回忆的主要对象。 */
  const done = async (h: Harness, title: string, summary: string, files: string[] = []): Promise<string> => {
    const id = await open(h, title)
    h.engine.assignmentStarted(id, h.engine.require(id).assignments[0]!.id)
    h.engine.report(id, { state: 'ready', summary, files })
    return id
  }

  it('finds ended work by title and by summary, with artifacts and outcome on each hit', async () => {
    const h = harness()
    const china = await done(h, '资本布局调研', '中国 AI 产业的投资流向已整理。', ['report.md', 'data/capital.csv'])
    await done(h, '竞品日报', '竞品的定价变化。', ['daily.md'])
    const mine = await open(h, '还在做')   // 未完成：没有 result

    const hit = await h.call('myagent_recall', { query: '资本' }) as {
      count: number; total: number; truncated: boolean
      tickets: { ticket_id: string; title: string; stage: string; outcome: string; summary: string; artifacts: string[] }[]
    }
    // 只命中那张，且把它真正需要回忆的东西都带上了：结局、完整摘要、产物路径。
    expect(hit.count).toBe(1)
    expect(hit.tickets[0]).toMatchObject({ ticket_id: china, title: '资本布局调研', stage: 'done', outcome: 'done' })
    expect(hit.tickets[0]!.summary).toBe('中国 AI 产业的投资流向已整理。')
    // 产物按存储顺序（路径字母序）返回——顺序不是这条断言的对象，齐全才是。
    expect(hit.tickets[0]!.artifacts).toEqual(expect.arrayContaining(['report.md', 'data/capital.csv']))
    // 摘要也能作为检索面：问"投资流向"而不是标题词。
    const bySummary = await h.call('myagent_recall', { query: '投资流向' }) as { count: number }
    expect(bySummary.count).toBe(1)
    // 进行中的那张按 state 不筛——回忆本来就包括"还没做完的"。
    const openHit = await h.call('myagent_recall', { query: '还在做' }) as { tickets: { ticket_id: string }[] }
    expect(openHit.tickets[0]!.ticket_id).toBe(mine)
  })

  it('ANDs the terms, ignores case, orders newest first, and truncates honestly', async () => {
    const h = harness()
    await done(h, 'A 融资统计', '第一季度的融资。')
    const second = await done(h, 'B 融资统计', '第二季度的融资。')
    // 两个词都命中才召回（AND 不是 OR）——问句里的限定词才有效。
    const both = await h.call('myagent_recall', { query: '融资 第二季度' }) as { count: number; tickets: { ticket_id: string }[] }
    expect(both.count).toBe(1)
    expect(both.tickets[0]!.ticket_id).toBe(second)
    // 大小写不敏感：检索词用大写也命中中文摘要里的英文。
    await done(h, 'CSV 整理', 'The CSV file is ready.')
    const upper = await h.call('myagent_recall', { query: 'csv' }) as { count: number }
    expect(upper.count).toBe(1)
    // newest first；limit 收口并如实说 truncated。
    await done(h, 'C 融资统计', '第三季度的融资。')
    const limited = await h.call('myagent_recall', { query: '融资', limit: 1 }) as {
      count: number; total: number; truncated: boolean; tickets: { title: string }[]
    }
    expect(limited).toMatchObject({ count: 1, total: 3, truncated: true })
    expect(limited.tickets[0]!.title).toBe('C 融资统计')
  })

  it('answers count 0 honestly when nothing matched, and leaves tombstones out', async () => {
    const h = harness()
    const id = await done(h, '会被删掉的', '删掉它')
    h.engine.deleteTicket(id, { assets: 'keep', record: 'tombstone' })
    const none = await h.call('myagent_recall', { query: '删掉' }) as { count: number; total: number; tickets: unknown[] }
    expect(none).toMatchObject({ count: 0, total: 0, truncated: false })
    expect(none.tickets).toEqual([])
    const missing = await h.call('myagent_recall', { query: '不存在' }) as { count: number }
    expect(missing.count).toBe(0)
  })
})
