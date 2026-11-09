/** What a Report becomes on its way out, and the one-writer lock over a state directory. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import type { Context } from '@deepseek-ai/cordis'
import {
  borrowedFrom, creditLine, creditText, escalationRelayText, escalationText, headline, isFirstEscalation, relayText,
  resultDocument, OutcomeDelivery, type NotifyPayload, type SendPayload,
} from '../src/app/delivery.ts'
import type { Effects } from '../src/app/effects.ts'
import { HealthBoard } from '../src/app/health.ts'
import { LockHeld, takeLock } from '../src/app/lock.ts'
import type { Sessions } from '../src/app/sessions.ts'
import { Store } from '../src/app/store.ts'
import type { Report, Ticket } from '../src/core/model.ts'
import { stubHost } from './helpers/host.ts'
import { tempDir } from './helpers/temp.ts'

const ticket = (over: Partial<Ticket> = {}): Ticket => ({
  id: 'ticket-1', title: '整理本周竞品动态', createdAt: '2026-11-02T10:00:00.000Z',
  mandate: {
    policyVersion: 'abc123', scope: 'Work in this Ticket\'s own directory and write nothing outside it.',
    strength: 'explicit', sender: { id: 'operator', kind: 'person' }, via: 'schedule', at: '2026-11-02T10:00:00.000Z',
  },
  origin: { triggerId: 'trigger-1' }, attachments: [],
  assignments: [{ id: 'assignment-1', state: 'running', createdAt: '2026-11-02T10:00:00.000Z' }],
  notes: [], inputs: [],
  execution: { name: 'digest', directory: '/tmp/work/digest-ticket-1' },
  ...over,
})

const payload = (over: Partial<Extract<NotifyPayload, { kind: 'report' }>> = {}): Extract<NotifyPayload, { kind: 'report' }> => ({
  kind: 'report', ticketId: 'ticket-1', state: 'ready', summary: '三家竞品的更新已整理成表格。', at: '2026-11-02T11:00:00.000Z', ...over,
})

describe('what a person is told', () => {
  it('names the Ticket and what became of it in one line', () => {
    expect(headline(ticket(), 'ready')).toBe('整理本周竞品动态 — done')
    expect(headline(ticket(), 'blocked')).toContain('needs you')
    expect(headline(ticket(), 'failed')).toContain('failed')
    expect(headline(ticket(), 'dropped')).toContain('dropped')
  })

  it('gives the main Session enough to act on, and where to look', () => {
    const text = relayText(ticket(), payload({ files: ['digest.md', 'table.csv'] }))
    expect(text).toContain('ticket-1')
    expect(text).toContain('三家竞品的更新已整理成表格。')
    expect(text).toContain('- digest.md')
    expect(text).toContain('Directory: /tmp/work/digest-ticket-1')
  })

  it('brings a blocked Ticket\'s question verbatim, with the way to answer it', () => {
    const text = relayText(ticket(), payload({ state: 'blocked', question: '按公司还是按产品排？' }))
    expect(text).toContain('The worker asks: 按公司还是按产品排？')
    expect(text).toContain('myagent_answer_ticket')
  })

  it('writes an ending into a document that stands on its own', () => {
    const document = resultDocument(ticket(), payload({ files: ['digest.md'] }))
    expect(document).toContain('# 整理本周竞品动态')
    expect(document).toContain('- Ticket: ticket-1')
    expect(document).toContain('- State: ready')
    expect(document).toContain('- Authorized by: operator via schedule')
    expect(document).toContain('## Scope')
    expect(document).toContain('Work in this Ticket\'s own directory')
    expect(document).toContain('## Files')
    expect(document).toContain('- digest.md')
  })

  it('keeps a question out of a report that has none', () => {
    expect(resultDocument(ticket(), payload())).not.toContain('## Question')
  })
})

describe('the state lock', () => {
  const directory = () => tempDir('myagent-lock-')

  it('lets one writer hold a state directory', () => {
    const path = directory()
    const lock = takeLock(path)
    expect(lock.record.pid).toBe(process.pid)
    lock.release()
    // A released directory is free again.
    const again = takeLock(path)
    again.release()
  })

  it('refuses a second live deployment over the same directory', () => {
    const path = directory()
    const first = takeLock(path)
    try {
      expect(() => takeLock(path)).toThrow(LockHeld)
      expect(() => takeLock(path)).toThrow(/one writer per state directory/)
    } finally { first.release() }
  })

  it('steals the lock of a holder that is gone', () => {
    const path = directory()
    // A pid this large cannot exist, which is what a crashed deployment leaves behind.
    writeFileSync(join(path, 'myagent.lock'), JSON.stringify({ pid: 4_194_303, host: hostname(), token: 'dead', at: '2026-01-01T00:00:00.000Z' }))
    const lock = takeLock(path)
    expect(lock.record.token).not.toBe('dead')
    lock.release()
  })

  it('does not steal the lock of another live process', () => {
    const path = directory()
    // Our own pid is alive, so a lock claiming it is a lock somebody holds.
    writeFileSync(join(path, 'myagent.lock'), JSON.stringify({ pid: process.pid, host: hostname(), token: 'other', at: '2026-01-01T00:00:00.000Z' }))
    expect(() => takeLock(path)).toThrow(LockHeld)
  })

  it('leaves a lock it stole nothing of, and removes only its own', () => {
    const path = directory()
    const first = takeLock(path)
    const second = (() => { try { return takeLock(path) } catch { return undefined } })()
    expect(second).toBeUndefined()
    first.release()
    // Releasing twice, or after somebody else took over, removes nothing of theirs.
    first.release()
    const third = takeLock(path)
    third.release()
  })
})

describe('what the Watchdog giving up is worth telling (S2)', () => {
  /**
   * Until S2 this fact reached two places — the Ticket's history and the health board — and both are read by the
   * operator at this machine. The person who asked in a chat room heard nothing, and was left waiting on work that
   * will never move again without them.
   */
  it('tells a requester in words they can act on, and leaves myagent’s own machinery out', () => {
    const text = escalationText(ticket(), 'has not started after 2 attempts to rescue it; it needs a person')
    expect(text).toContain('整理本周竞品动态 — needs a person')
    expect(text).toContain('has not started after 2 attempts to rescue it')
    expect(text).toContain('Nothing further will happen')
    // Neither means anything to somebody on a platform: the directory is on this machine, the tool is registered in a
    // Session they are not in. Telling them to use either would be a false instruction.
    expect(text).not.toContain('myagent_retry_ticket')
    expect(text).not.toContain('/tmp/work/digest-ticket-1')
  })

  it('tells the front desk the same fact with the means to act, because it is the one place that can', () => {
    const text = escalationRelayText(ticket(), 'has not started after 2 attempts to rescue it; it needs a person')
    expect(text).toContain('ticket-1')
    expect(text).toContain('the Watchdog has given up')
    expect(text).toContain('myagent_retry_ticket')
    expect(text).toContain('myagent_stop_ticket')
    expect(text).toContain('Directory: /tmp/work/digest-ticket-1')
  })

  it('names a Ticket that never started as one, rather than printing an empty path', () => {
    const text = escalationRelayText(ticket({ execution: undefined }), 'it needs a person')
    expect(text).toContain('(none — it never started)')
  })

  /**
   * The Watchdog re-escalates on every pass for as long as a Ticket stays past `maxActions`. Telling the requester
   * each time would message them every `everyMs`, and a repeated alarm trains a person to ignore it — so the history
   * keeps every escalation and the telling happens once.
   */
  it('counts only the first escalation as one worth pushing', () => {
    expect(isFirstEscalation([{ type: 'created' }, { type: 'launched' }])).toBe(true)
    expect(isFirstEscalation([{ type: 'created' }, { type: 'escalated' }])).toBe(false)
    expect(isFirstEscalation([])).toBe(true)
  })
})

/**
 * The borrowed-work line: the one fact about a report that until now existed only in the panel (减负).
 *
 * The Engine has written bidirectional lineage into both Tickets' logs since cross-Ticket reuse landed — `artifact_read`
 * in `authorizeArtifactRead`, `skill_used` in `skillUsed` — and the only reader of either was the panel's lineage view.
 * So the operator on a phone, which is where this system is actually used from, got a summary that read as
 * self-produced even when it was mostly an earlier job's data. "This one reused last week's crawl" is exactly the fact
 * that decides whether an answer can be trusted without opening a browser.
 *
 * These drive the real `OutcomeDelivery.report` / `notify` over a real `Store`, because three of the facts under test
 * are the Store's own and not mine: `events.list` answers oldest first, `tickets.get` still resolves a tombstone that
 * `list` hides, and a title comes off the row rather than being passed in. A hand-made stub would assert my copy of
 * those rules and stay green if the real ones moved.
 */
describe('the borrowed-work line on the way back to whoever asked', () => {
  const AT = '2026-11-08T02:00:00.000Z'
  const ready = (summary: string, files?: readonly string[]): Report =>
    ({ state: 'ready', summary, at: AT, ...(files === undefined ? {} : { files }) })

  interface Rig {
    readonly store: Store
    /** Every text Delivery asked the queue to carry back to a requester, in order. */
    readonly replies: string[]
    /** Every notice Delivery left for the front desk, in order — the reader that must NOT get the line. */
    readonly notices: string[]
    /** Warnings Delivery logged, format and arguments joined: the trace a failed lineage read has to leave. */
    readonly warnings: string[]
    readonly delivery: OutcomeDelivery
    /** Run the notify handler over everything queued for it, which is what writes `RESULT.md`. */
    notify(): Promise<void>
  }

  /**
   * A Delivery over a real Store and a queue that records instead of running.
   *
   * The queue is the stub, not the store: what is under test is which texts Delivery composes and where each one goes,
   * and a recording queue shows both without a platform to deliver to.
   */
  function rig(seed: (store: Store) => void = () => {}, over?: Store): Rig {
    const store = over ?? new Store(join(tempDir('myagent-credit-'), 'credit.sqlite3'))
    seed(store)
    const queued: { kind: string; payload: unknown }[] = []
    const handlers = new Map<string, (payload: unknown) => unknown>()
    const effects = {
      handle: (kind: string, handler: (payload: unknown) => unknown) => { handlers.set(kind, handler) },
      enqueue: (kind: string, _key: string, payload: unknown) => { queued.push({ kind, payload }) },
    } as unknown as Effects
    const notices: string[] = []
    const warnings: string[] = []
    const host = stubHost()
    const context = {
      logger: {
        debug() {}, info() {}, error() {},
        warn: (format: unknown, ...args: unknown[]) => { warnings.push([format, ...args].join(' ')) },
      },
      subprocess: host.ctx.subprocess,
    } as unknown as Context
    const delivery = new OutcomeDelivery({
      context, store, effects, health: new HealthBoard(), lifetime: new AbortController().signal,
      subprocess: host.ctx.subprocess,
      // `notify.enabled` defaults to false, so no desktop notification is spawned and no subprocess is needed here.
      settings: () => store.settings(), panelPath: () => '', source: () => undefined,
      sessions: {
        notify: async (text: string) => { notices.push(text) },
        relay: async (text: string) => { notices.push(text) },
      } as unknown as Sessions,
      replyLost: () => {},
      // 【G-3 站点 2】镜像生产的写路径（LocalHostSandbox.writeWorkspaceFile）：测试断的是盘上的文件。
      writeResultFile: async (directory: string, name: string, text: string) => {
        await writeFile(join(directory, name), text, 'utf8')
      },
    }, null)
    return {
      store, notices, warnings, delivery,
      get replies() { return queued.filter(row => row.kind === 'send').map(row => (row.payload as SendPayload).text) },
      async notify() {
        for (const row of queued.filter(item => item.kind === 'notify')) await handlers.get('notify')!(row.payload)
      },
    }
  }

  /** One Ticket with a way back, a directory that exists, and a row in the store so its title can be read. */
  function live(store: Store, id: string, title: string): Ticket {
    const triggerId = `trigger-${id}`
    store.triggers.save({
      trigger: {
        id: triggerId, source: 'chat', kind: 'chat', at: AT, actor: { id: 'alice', kind: 'person' },
        text: '整理一下', title, replyTo: { kind: 'chat', channel: 'ops' },
      },
      disposition: { state: 'accepted', ticketId: id, decisionId: `decision-${id}` },
    })
    const directory = join(tempDir(`myagent-dir-${id}-`), 'work')
    mkdirSync(directory, { recursive: true })
    const row = ticket({ id, title, origin: { triggerId }, execution: { name: 'digest', directory } })
    store.tickets.save(row)
    return row
  }

  /** The row the Engine writes into the READER's log when it takes an artifact another Ticket registered. */
  const read = (store: Store, of: string, from: string, path: string): void => {
    store.events.append({
      ticketId: of, at: AT, type: 'artifact_read', by: { kind: 'agent', id: of }, detail: { fromTicketId: from, path },
    })
  }
  /** The row it writes into the CONSUMER's log when it uses a 手艺 another Ticket promoted. */
  const used = (store: Store, of: string, from: string, skill: string): void => {
    store.events.append({
      ticketId: of, at: AT, type: 'skill_used', by: { kind: 'agent', id: of }, detail: { fromTicketId: from, skill },
    })
  }

  it('names the earlier job this answer stands on, and leaves myagent’s own machinery out', () => {
    const harness = rig(store => {
      const source = live(store, 'ticket-src', '抓取本周竞品数据')
      live(store, 'ticket-me', '写一份对比说明')
      read(store, 'ticket-me', 'ticket-src', 'data/table.csv')
      expect(source.title).toBe('抓取本周竞品数据')
    })
    const me = harness.store.tickets.get('ticket-me')!
    harness.delivery.report(me, ready('两家的定价已经对比完。', ['compare.md']))

    expect(harness.replies).toHaveLength(1)
    const text = harness.replies[0]!
    expect(text).toContain('（这份用上了「抓取本周竞品数据」的成果）')
    // The answer first and the qualification last: on a phone the first screenful has to be the result.
    expect(text.startsWith('两家的定价已经对比完。')).toBe(true)
    expect(text.endsWith('（这份用上了「抓取本周竞品数据」的成果）')).toBe(true)
    // Nothing here is actionable for a person on a platform: the ids and the directory are on this machine, the path
    // is inside it, and the tool names belong to a Session they are not in.
    expect(text).not.toContain('ticket-src')
    expect(text).not.toContain('ticket-me')
    expect(text).not.toContain(me.execution!.directory)
    expect(text).not.toContain('data/table.csv')
    expect(text).not.toContain('myagent_')
  })

  it('merges several sources into one counted sentence, and names one job once however many files it gave', () => {
    const harness = rig(store => {
      live(store, 'ticket-a', '抓取本周竞品数据')
      live(store, 'ticket-b', '上周的价格表')
      live(store, 'ticket-c', '渠道清单')
      live(store, 'ticket-me', '写一份对比说明')
      // Four files, three jobs. The Engine records one `artifact_read` per (source, path), so a report built on two
      // files of the same job is two events — and two mentions of one job would read as a stutter.
      read(store, 'ticket-me', 'ticket-a', 'data/table.csv')
      read(store, 'ticket-me', 'ticket-a', 'data/notes.md')
      read(store, 'ticket-me', 'ticket-b', 'price.csv')
      read(store, 'ticket-me', 'ticket-c', 'channels.csv')
    })
    harness.delivery.report(harness.store.tickets.get('ticket-me')!, ready('对比写好了。'))

    const text = harness.replies[0]!
    expect(text).toContain('（这份用上了「抓取本周竞品数据」「上周的价格表」等 3 项前序成果）')
    // Deduplicated by job rather than by file: two events for `ticket-a`, one mention of its title.
    expect(text.split('抓取本周竞品数据')).toHaveLength(2)
    // Counted, not listed: the third job is in the number and not in the sentence, which is what keeps this one line.
    expect(text).not.toContain('渠道清单')
    expect(text).not.toContain('ticket-a')
  })

  it('says nothing at all when nothing was borrowed, and the reply is byte for byte what it was before', async () => {
    const harness = rig(store => { live(store, 'ticket-me', '写一份对比说明') })
    const me = harness.store.tickets.get('ticket-me')!
    harness.delivery.report(me, ready('两家的定价已经对比完。', ['compare.md', 'notes.md']))

    // The pre-change `replyText` output, written out rather than recomputed from the new code: the fact under test is
    // that an ordinary report is untouched, and an expectation the new code produced would prove nothing about that.
    expect(harness.replies[0]).toBe('两家的定价已经对比完。\n\nFiles:\n- compare.md\n- notes.md')
    // And nothing apologetic in its place. A parenthesis on every ordinary report is how a real one stops being read.
    expect(harness.replies[0]).not.toContain('用上了')
    expect(harness.replies[0]).not.toContain('未复用')

    await harness.notify()
    const document = readFileSync(join(me.execution!.directory, 'RESULT.md'), 'utf8')
    expect(document).not.toContain('## Borrowed work')
    expect(document).not.toContain('用上了')
  })

  it('counts a source the operator has deleted instead of naming it, and never prints an id in its place', () => {
    const harness = rig(store => {
      const gone = live(store, 'ticket-gone', '抓取本周竞品数据')
      live(store, 'ticket-me', '写一份对比说明')
      read(store, 'ticket-me', 'ticket-gone', 'data/table.csv')
      // A tombstone: hidden from every list, still resolvable by `get`. The operator removed this job and its title
      // went with it, so naming it in a chat message would hand back what they deleted.
      store.tickets.save({ ...gone, deleted: { at: AT, assets: 'delete', files: 3, bytes: 4096 } })
      expect(store.tickets.list().some(row => row.id === 'ticket-gone')).toBe(false)
    })
    harness.delivery.report(harness.store.tickets.get('ticket-me')!, ready('对比写好了。'))

    const text = harness.replies[0]!
    expect(text).toContain('（这份用上了 1 项已删除任务的成果）')
    expect(text).not.toContain('抓取本周竞品数据')
    expect(text).not.toContain('ticket-gone')
    expect(text).not.toContain('undefined')
  })

  it('counts a source that is alive but has no title to give, rather than falling back to its id', () => {
    const harness = rig(store => {
      live(store, 'ticket-blank', '   ')
      live(store, 'ticket-me', '写一份对比说明')
      read(store, 'ticket-me', 'ticket-blank', 'data/table.csv')
    })
    harness.delivery.report(harness.store.tickets.get('ticket-me')!, ready('对比写好了。'))

    const text = harness.replies[0]!
    expect(text).toContain('（这份用上了 1 项前序成果）')
    expect(text).not.toContain('ticket-blank')
    expect(text).not.toContain('undefined')
  })

  it('clips a title too long to glance at, and keeps the whole line under its ceiling', () => {
    const long = '这是一条长得离谱的任务标题'.repeat(20)
    const harness = rig(store => {
      live(store, 'ticket-long', long)
      live(store, 'ticket-me', '写一份对比说明')
      read(store, 'ticket-me', 'ticket-long', 'data/table.csv')
    })
    harness.delivery.report(harness.store.tickets.get('ticket-me')!, ready('对比写好了。'))

    const line = harness.replies[0]!.split('\n').at(-1)!
    expect(line.startsWith('（这份用上了「')).toBe(true)
    expect(line.endsWith('」的成果）') || line.endsWith('…）')).toBe(true)
    // The ceiling as the number the source documents, not through its exported constant: a mutation that raised the
    // constant would otherwise raise the assertion along with it and stay green.
    expect(line.length).toBeLessThanOrEqual(120)
    // Clipped, and visibly so — an operator has to be able to tell this is not the whole title.
    expect(line).toContain('…')
    expect(line).not.toContain(long)
    expect(line).toContain(long.slice(0, 12))
  })

  it('counts the 手艺 a report used and never writes their technical names to a person', () => {
    const harness = rig(store => {
      live(store, 'ticket-old', '上一次抓数据')
      live(store, 'ticket-me', '写一份对比说明')
      used(store, 'ticket-me', 'ticket-old', 'myagent-polite-fetch')
      used(store, 'ticket-me', 'ticket-old', 'myagent-source-registry')
      // The same 手艺 again: one 门, not two.
      used(store, 'ticket-me', 'ticket-old', 'myagent-polite-fetch')
    })
    harness.delivery.report(harness.store.tickets.get('ticket-me')!, ready('抓完了，也比对完了。'))

    const text = harness.replies[0]!
    expect(text).toContain('（这份用上了 2 门已沉淀的手艺）')
    // A skill name is a plugin identifier. To a person on a phone it means nothing and reads like a leak.
    expect(text).not.toContain('myagent-')
    expect(text).not.toContain('polite-fetch')
    expect(text).not.toContain('ticket-old')
  })

  it('keeps it to one line when a report borrowed both data and 手艺', () => {
    const harness = rig(store => {
      live(store, 'ticket-src', '抓取本周竞品数据')
      live(store, 'ticket-me', '写一份对比说明')
      read(store, 'ticket-me', 'ticket-src', 'data/table.csv')
      used(store, 'ticket-me', 'ticket-src', 'myagent-polite-fetch')
    })
    harness.delivery.report(harness.store.tickets.get('ticket-me')!, ready('对比写好了。'))

    const text = harness.replies[0]!
    expect(text).toContain('（这份用上了「抓取本周竞品数据」的成果，以及 1 门已沉淀的手艺）')
    // One line, not two: the constraint is a glance, and a second parenthesis competes with the first.
    expect(text.split('\n').filter(row => row.includes('用上了'))).toHaveLength(1)
    expect(text).not.toContain('myagent-')
  })

  it('says nothing about the jobs that reused THIS one, which is a fact about their reports and not this one', () => {
    const harness = rig(store => {
      live(store, 'ticket-me', '抓取本周竞品数据')
      live(store, 'ticket-down', '写一份对比说明')
      // The mirror-image row the Engine writes into the PRODUCER's own log (`byTicketId`, not `fromTicketId`).
      store.events.append({
        ticketId: 'ticket-me', at: AT, type: 'artifact_read', by: { kind: 'agent', id: 'ticket-down' },
        detail: { byTicketId: 'ticket-down', path: 'data/table.csv' },
      })
    })
    harness.delivery.report(harness.store.tickets.get('ticket-me')!, ready('抓完了。'))

    expect(harness.replies[0]).toBe('抓完了。')
    expect(harness.replies[0]).not.toContain('写一份对比说明')
  })

  it('still delivers the report when reading the lineage throws, and puts the reason in the log instead', () => {
    const real = new Store(join(tempDir('myagent-credit-hostile-'), 'credit.sqlite3'))
    live(real, 'ticket-src', '抓取本周竞品数据')
    live(real, 'ticket-me', '写一份对比说明')
    read(real, 'ticket-me', 'ticket-src', 'data/table.csv')
    // A store whose event log refuses to be read. A busy database is not hypothetical — this file already sets
    // `busy_timeout` for it — and the line under test is a courtesy, so it may not cost the answer it explains.
    const hostile = {
      events: { list: (): never => { throw new Error('database is locked') } },
      tickets: real.tickets,
      triggers: real.triggers,
    } as unknown as Store
    const harness = rig(() => {}, hostile)
    const me = real.tickets.get('ticket-me')!

    expect(() => harness.delivery.report(me, ready('对比写好了。', ['compare.md']))).not.toThrow()
    // The reply still went out, with the answer and without the line: the requester is not the one who pays for a
    // database that was momentarily busy.
    expect(harness.replies).toHaveLength(1)
    expect(harness.replies[0]).toBe('对比写好了。\n\nFiles:\n- compare.md')
    expect(harness.replies[0]).not.toContain('用上了')
    // Dropped, but not silently. This is what separates "nothing was borrowed" from "we could not read it", and a
    // health-board line would be wrong: nothing owed to anybody went missing, so `complain` would erase a real problem.
    expect(harness.warnings.join('\n')).toContain('ticket-me')
    expect(harness.warnings.join('\n')).toContain('database is locked')
  })

  it('writes the same sentence into RESULT.md, and leaves it out of the notice the front desk reads', async () => {
    const harness = rig(store => {
      live(store, 'ticket-src', '抓取本周竞品数据')
      live(store, 'ticket-me', '写一份对比说明')
      read(store, 'ticket-me', 'ticket-src', 'data/table.csv')
    })
    const me = harness.store.tickets.get('ticket-me')!
    harness.delivery.report(me, ready('对比写好了。', ['compare.md']))
    await harness.notify()

    // The file a person reads later says what the message said then, in the same words and unwrapped: a document has
    // no parenthesis to hide behind, and two texts about one fact must not disagree with each other.
    const document = readFileSync(join(me.execution!.directory, 'RESULT.md'), 'utf8')
    expect(document).toContain('## Borrowed work')
    expect(document).toContain('这份用上了「抓取本周竞品数据」的成果')
    expect(document).not.toContain('ticket-src')
    expect(harness.replies[0]).toContain('（这份用上了「抓取本周竞品数据」的成果）')

    // The front desk's notice does NOT carry it. That reader is myagent's own main Session at this machine: the same
    // text already hands it the Ticket id and the directory, and the panel's lineage view is one click away.
    expect(harness.notices).toHaveLength(1)
    expect(harness.notices[0]!).toContain('ticket-me')
    expect(harness.notices[0]!).not.toContain('用上了')
    expect(harness.notices[0]!).not.toContain('抓取本周竞品数据')
  })

  it('reads the log oldest first and one job once, which is what makes the count mean jobs and not files', () => {
    const harness = rig(store => {
      live(store, 'ticket-later', '上周的价格表')
      live(store, 'ticket-earlier', '抓取本周竞品数据')
      live(store, 'ticket-me', '写一份对比说明')
      read(store, 'ticket-me', 'ticket-earlier', 'data/table.csv')
      used(store, 'ticket-me', 'ticket-earlier', 'myagent-polite-fetch')
      read(store, 'ticket-me', 'ticket-earlier', 'data/notes.md')
      read(store, 'ticket-me', 'ticket-later', 'price.csv')
    })
    expect(borrowedFrom(harness.store, 'ticket-me')).toEqual({
      titles: ['抓取本周竞品数据', '上周的价格表'], gone: 0, nameless: 0, skills: 1,
    })
  })

  it('names what it can and counts the rest, in one sentence', () => {
    expect(creditText({ titles: ['A'], gone: 0, nameless: 0, skills: 0 })).toBe('这份用上了「A」的成果')
    expect(creditText({ titles: ['A', 'B'], gone: 0, nameless: 0, skills: 0 })).toBe('这份用上了「A」「B」的成果')
    expect(creditText({ titles: ['A', 'B', 'C'], gone: 0, nameless: 0, skills: 0 }))
      .toBe('这份用上了「A」「B」等 3 项前序成果')
    // A source with no name to give still moves the count, so the number and the names cannot drift apart.
    expect(creditText({ titles: ['A'], gone: 1, nameless: 0, skills: 0 })).toBe('这份用上了「A」等 2 项前序成果')
    expect(creditText({ titles: [], gone: 1, nameless: 0, skills: 0 })).toBe('这份用上了 1 项已删除任务的成果')
    expect(creditText({ titles: [], gone: 0, nameless: 1, skills: 0 })).toBe('这份用上了 1 项前序成果')
    expect(creditText({ titles: ['A'], gone: 0, nameless: 0, skills: 2 }))
      .toBe('这份用上了「A」的成果，以及 2 门已沉淀的手艺')
    expect(creditText({ titles: [], gone: 0, nameless: 0, skills: 3 })).toBe('这份用上了 3 门已沉淀的手艺')
    // Nothing borrowed is `undefined`, not an empty string and not a sentence saying so: the caller appends nothing.
    expect(creditText({ titles: [], gone: 0, nameless: 0, skills: 0 })).toBeUndefined()
    expect(creditLine({ titles: [], gone: 0, nameless: 0, skills: 0 })).toBeUndefined()
    expect(creditLine({ titles: ['A'], gone: 0, nameless: 0, skills: 0 })).toBe('（这份用上了「A」的成果）')
  })
})
