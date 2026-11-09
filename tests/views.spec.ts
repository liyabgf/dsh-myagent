/**
 * Views: the JSON shape the panel and the tools both read.
 *
 * One shape per record, computed from the record's own facts. A wrong view is not a cosmetic bug — it is the operator
 * reading something false about work that is running unattended, so each field is pinned here.
 */
import { describe, expect, it } from 'vitest'
import { decisionView, scheduleView, ticketSummary, ticketView, updatedAt } from '../src/app/views.ts'
import type { Assignment, Decision, Report, Ticket } from '../src/core/model.ts'

const assignment = (over: Partial<Assignment> = {}): Assignment =>
  ({ id: 'assignment-1', state: 'running', createdAt: '2026-11-03T01:00:00.000Z', ...over })

const base = (over: Partial<Ticket> = {}): Ticket => ({
  id: 'ticket-1', title: '每日摘要', createdAt: '2026-11-03T01:00:00.000Z',
  mandate: {
    policyVersion: 'pv1', scope: '只在本目录工作', strength: 'explicit',
    sender: { id: 'operator', kind: 'person' }, via: 'schedule', at: '2026-11-03T01:00:00.000Z',
  },
  origin: { triggerId: 'trigger-1' }, attachments: [],
  execution: { name: 'digest', directory: '/work/digest-ticket-1' },
  assignments: [assignment()], notes: [], inputs: [], ...over,
})

const report = (over: Partial<Report> = {}): Report =>
  ({ state: 'progress', summary: '进行中', at: '2026-11-03T01:05:00.000Z', ...over })

describe('updatedAt', () => {
  it('is the latest instant anything happened, whichever field it is in', () => {
    expect(updatedAt(base())).toBe('2026-11-03T01:00:00.000Z')
    expect(updatedAt(base({ assignments: [assignment({ report: report({ at: '2026-11-03T01:20:00.000Z' }) })] })))
      .toBe('2026-11-03T01:20:00.000Z')
    expect(updatedAt(base({ ended: { at: '2026-11-03T01:30:00.000Z', by: 'agent', outcome: 'done', reason: 'ready' } })))
      .toBe('2026-11-03T01:30:00.000Z')
    expect(updatedAt(base({ notes: [{ text: 'x', at: '2026-11-03T01:40:00.000Z' }] })))
      .toBe('2026-11-03T01:40:00.000Z')
    expect(updatedAt(base({ attention: { at: '2026-11-03T01:50:00.000Z', question: '哪一个？' } })))
      .toBe('2026-11-03T01:50:00.000Z')
    // An input that arrived but was not delivered yet still counts: it is something that happened.
    expect(updatedAt(base({ inputs: [{ id: 'i1', kind: 'text', text: 'x', at: '2026-11-03T02:00:00.000Z' }] })))
      .toBe('2026-11-03T02:00:00.000Z')
  })
})

describe('ticketSummary', () => {
  it('names the stage a person reads, for every state a Ticket can be in', () => {
    const cases: [string, Ticket][] = [
      ['pending', base({ assignments: [assignment({ state: 'pending' })] })],
      ['running', base()],
      ['waiting', base({ assignments: [assignment({ report: report({ state: 'waiting' }) })] })],
      // The report says why a Ticket needs a person; `attention` is the filter over such Tickets, not a stage.
      ['blocked', base({ assignments: [assignment({ report: report({ state: 'blocked' }) })], attention: { at: '2026-11-03T01:06:00.000Z', question: '哪一个？' } })],
      ['failed', base({ assignments: [assignment({ report: report({ state: 'failed' }) })], attention: { at: '2026-11-03T01:06:00.000Z', question: '进行中' } })],
      ['done', base({ ended: { at: '2026-11-03T01:10:00.000Z', by: 'agent', outcome: 'done', reason: 'ready' } })],
      ['stopped', base({ ended: { at: '2026-11-03T01:10:00.000Z', by: 'person', outcome: 'stopped', reason: '操作者停止' } })],
      ['dropped', base({ ended: { at: '2026-11-03T01:10:00.000Z', by: 'agent', outcome: 'dropped', reason: 'nothing to do' } })],
      ['failed', base({ ended: { at: '2026-11-03T01:10:00.000Z', by: 'agent', outcome: 'failed', reason: 'prepare failed' } })],
    ]
    for (const [stage, ticket] of cases) expect(ticketSummary(ticket).stage, stage).toBe(stage)
  })

  it('carries what a list row shows, and nothing that needs a second read', () => {
    const summary = ticketSummary(base({
      assignments: [assignment({ report: report({ state: 'blocked', summary: '需要决定', question: '按公司还是按产品？' }) })],
      attention: { at: '2026-11-03T01:06:00.000Z', question: '按公司还是按产品？' },
    }))
    expect(summary).toMatchObject({
      id: 'ticket-1', title: '每日摘要', via: 'schedule', sender: 'operator',
      directory: '/work/digest-ticket-1', waitsForPerson: true, question: '按公司还是按产品？', summary: '需要决定',
    })
  })

  it('says a Ticket that ended is not waiting for anybody, however it ended', () => {
    const ended = ticketSummary(base({
      attention: { at: '2026-11-03T01:06:00.000Z', question: '哪一个？' },
      ended: { at: '2026-11-03T01:10:00.000Z', by: 'person', outcome: 'stopped', reason: '操作者停止' },
    }))
    expect(ended.waitsForPerson).toBe(false)
    expect(ended.outcome).toBe('stopped')
    expect(ended.endedReason).toBe('操作者停止')
  })
})

describe('ticketView', () => {
  it('carries the authorization verbatim, because that is what the work is allowed to do', () => {
    const view = ticketView(base())
    expect(view.mandate).toEqual({
      scope: '只在本目录工作', strength: 'explicit', via: 'schedule',
      sender: { id: 'operator', kind: 'person' }, policyVersion: 'pv1', at: '2026-11-03T01:00:00.000Z',
    })
    expect(view.origin).toEqual({ triggerId: 'trigger-1' })
    expect(view.execution).toEqual({ name: 'digest', directory: '/work/digest-ticket-1' })
  })

  it('shows the current Assignment in full and every Assignment in brief', () => {
    const view = ticketView(base({
      assignments: [
        assignment({ state: 'ended', endedAt: '2026-11-03T01:08:00.000Z', endedReason: 'interrupted', report: report({ state: 'failed', summary: '进程重启前失败' }) }),
        assignment({ id: 'assignment-2', state: 'running', createdAt: '2026-11-03T01:09:00.000Z', deliveredAt: '2026-11-03T01:09:05.000Z' }),
      ],
    }))
    expect(view.assignment).toMatchObject({ id: 'assignment-2', state: 'running', deliveredAt: '2026-11-03T01:09:05.000Z' })
    expect(view.assignments).toEqual([
      { id: 'assignment-1', state: 'ended', report: 'failed', at: '2026-11-03T01:00:00.000Z' },
      { id: 'assignment-2', state: 'running', report: undefined, at: '2026-11-03T01:09:00.000Z' },
    ])
    // Every report is kept, not just the latest: the history of an attempt is the point of an Assignment.
    expect(view.reports).toHaveLength(1)
  })

  it('shows whether each Input arrived, which is what a delivery failure looks like', () => {
    const view = ticketView(base({
      inputs: [
        { id: 'i1', kind: 'text', text: '按公司排', at: '2026-11-03T01:06:00.000Z', deliveredAt: '2026-11-03T01:06:02.000Z' },
        { id: 'i2', kind: 'note', text: '路径在 ~/notes', at: '2026-11-03T01:07:00.000Z' },
      ],
    }))
    expect(view.inputs).toEqual([
      { id: 'i1', kind: 'text', at: '2026-11-03T01:06:00.000Z', deliveredAt: '2026-11-03T01:06:02.000Z', text: '按公司排' },
      { id: 'i2', kind: 'note', at: '2026-11-03T01:07:00.000Z', deliveredAt: undefined, text: '路径在 ~/notes' },
    ])
  })

  it('carries a delivery error, which is the only trace of a hand-over that did not arrive', () => {
    const view = ticketView(base({ assignments: [assignment({ deliveryError: 'SessionError: the agent was disposed' })] }))
    expect(view.assignment).toMatchObject({ deliveryError: 'SessionError: the agent was disposed' })
  })
})

describe('decisionView', () => {
  const decision = (over: Partial<Decision> = {}): Decision => ({
    id: 'decision-1', triggerId: 'trigger-1', at: '2026-11-03T01:00:00.000Z', outcome: 'ignore',
    reason: 'sender_not_allowed', detail: 'stranger is not on the allowed list', policyVersion: 'pv1', ...over,
  })

  it('carries the refusal and the request it belonged to', () => {
    expect(decisionView(decision(), '每日摘要')).toMatchObject({
      id: 'decision-1', triggerId: 'trigger-1', outcome: 'ignore', reason: 'sender_not_allowed',
      detail: 'stranger is not on the allowed list', policyVersion: 'pv1', title: '每日摘要',
    })
  })

  it('links an accepted Decision to the Ticket it produced', () => {
    expect(decisionView(decision({ outcome: 'accept', reason: 'accepted', ticketId: 'ticket-1', detail: undefined })))
      .toMatchObject({ outcome: 'accept', ticketId: 'ticket-1', title: undefined })
  })
})

describe('scheduleView', () => {
  const daily = { id: 'digest', name: '每日摘要', enabled: true, prompt: '写今天的摘要', scope: '', timing: { kind: 'daily', time: '09:00' } as const }
  const from = Date.parse('2026-11-03T02:00:00.000Z')

  it('says when an enabled schedule fires next, in words and as an instant', () => {
    const view = scheduleView(daily, from) as { next: string; describe: string; zone: string }
    expect(new Date(view.next).getTime()).toBeGreaterThan(from)
    expect(view.describe.length).toBeGreaterThan(3)
    // The zone the timing is read in belongs on the answer: a host in another zone fires at another instant.
    expect(view.zone.length).toBeGreaterThan(0)
  })

  it('gives no next run for a schedule that is switched off', () => {
    expect(scheduleView({ ...daily, enabled: false }, from).next).toBeUndefined()
  })

  it('carries the request and the scope, which is what the editor has to show', () => {
    expect(scheduleView(daily, from)).toMatchObject({ id: 'digest', name: '每日摘要', enabled: true, prompt: '写今天的摘要' })
  })

  it('says where the reports go, and says so plainly when they go nowhere but the file system', () => {
    expect(scheduleView({ ...daily, deliverTo: { channel: 'telegram' } }, from)).toMatchObject({
      deliverTo: { channel: 'telegram' },
      deliverToText: '送到聊天频道 telegram（该频道的默认会话）',
    })
    expect(scheduleView({ ...daily, deliverTo: { channel: 'ops', thread: 't-9' } }, from).deliverToText)
      .toBe('送到聊天频道 ops 的会话 t-9')
    // The absence is a fact worth stating: a schedule whose output lands only in RESULT.md is invisible to a
    // chat-first operator, and a blank cell would not tell which of the two it is.
    const plain = scheduleView(daily, from)
    expect(plain.deliverTo).toBeUndefined()
    expect(plain.deliverToText).toBe('只落 RESULT.md 与主会话通知（不进聊天室）')
  })
})

describe('the triage marker on a summary (S3b)', () => {
  /**
   * Derived from the attempt behind the Ticket, not stored as a second opinion about it: a triage Ticket is one whose
   * latest Assignment says `role: 'triage'`, and that is the same fact the Session's prompt and tool set were chosen
   * from.
   */
  it('says so when the attempt behind it is a triage one, and stays quiet otherwise', () => {
    expect(ticketSummary(base({ assignments: [assignment({ role: 'triage' })] })).triage).toBe(true)
    expect(ticketSummary(base()).triage).toBeUndefined()
    // Still marked once it has closed: a triage Ticket that answered in one turn and ended is the NORMAL case, and
    // that is exactly when the marker matters — otherwise it is indistinguishable from a worker that gave up.
    expect(ticketSummary(base({
      assignments: [assignment({ role: 'triage', state: 'ended', endedReason: 'reported' })],
      ended: { at: '2026-11-03T02:00:00.000Z', by: 'agent', outcome: 'done', reason: '回答了' },
    })).triage).toBe(true)
  })
})
