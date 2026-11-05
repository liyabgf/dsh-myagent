/** What a Report becomes on its way out, and the one-writer lock over a state directory. */
import { writeFileSync } from 'node:fs'
import { hostname } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { headline, relayText, resultDocument, type NotifyPayload } from '../src/app/delivery.ts'
import { LockHeld, takeLock } from '../src/app/lock.ts'
import type { Ticket } from '../src/core/model.ts'
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
