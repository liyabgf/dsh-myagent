/**
 * Files that come with a request.
 *
 * A Ticket that reads a file from somewhere else is not self-contained: the operator can move or clean that file up
 * while the work sits in the queue, and the worker then produces something plausible out of nothing. So the files are
 * copied into the Ticket's own directory before it starts, and a file that cannot be copied fails the Ticket.
 */
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { frontMatter } from '../src/sources/inbox.ts'
import { attachmentsOf, Engine, Memory, parseSettings, settingsPolicy, type Trigger } from '../src/core/index.ts'
import { definitionOf, mainTools, type ToolsHost } from '../src/app/tools.ts'
import { Store } from '../src/app/store.ts'
import { tempDir } from './helpers/temp.ts'

const trigger = (meta: Record<string, unknown>): Trigger => ({
  id: 'trigger-1', source: 'inbox', kind: 'inbox', at: '2026-11-03T05:00:00.000Z',
  actor: { id: 'operator', kind: 'person' }, text: '处理这些文件', title: '处理文件', meta,
})

function engineHarness() {
  const memory = new Memory()
  let current = parseSettings({ acceptMode: 'auto', allowedSenders: ['operator'] })
  const engine = new Engine({
    repos: memory, tx: memory, policy: () => settingsPolicy(current),
    executor: {
      prepare: ticket => ({ ...ticket, execution: { name: ticket.id, directory: `/tmp/work/${ticket.id}` } }),
      start() {}, deliver() {}, stop() {},
    },
    delivery: { report() {} },
    now: () => '2026-11-03T05:00:00.000Z',
  })
  return { memory, engine }
}

describe('normalizing what a request brought', () => {
  it('takes the name from the path, and keeps where it came from', () => {
    expect(attachmentsOf(trigger({ attachments: ['/tmp/data/sales-q3.csv'] })))
      .toEqual([{ name: 'sales-q3.csv', source: '/tmp/data/sales-q3.csv' }])
  })

  it('gives two files with the same name different names, so neither overwrites the other', () => {
    expect(attachmentsOf(trigger({ attachments: ['/a/report.csv', '/b/report.csv', '/c/report.csv'] })))
      .toEqual([
        { name: 'report.csv', source: '/a/report.csv' },
        { name: 'report-2.csv', source: '/b/report.csv' },
        { name: 'report-3.csv', source: '/c/report.csv' },
      ])
  })

  it('keeps a dotted name intact when it disambiguates', () => {
    expect(attachmentsOf(trigger({ attachments: ['/a/.env', '/b/.env'] })).map(item => item.name))
      .toEqual(['.env', '.env-2'])
  })

  it('ignores what is not a path, rather than copying something nobody named', () => {
    expect(attachmentsOf(trigger({}))).toEqual([])
    expect(attachmentsOf(trigger({ attachments: [] }))).toEqual([])
    expect(attachmentsOf(trigger({ attachments: ['', '  ', 42, null, '/a/real.txt'] })))
      .toEqual([{ name: 'real.txt', source: '/a/real.txt' }])
    expect(attachmentsOf(trigger({ attachments: '/not/an/array' }))).toEqual([])
  })
})

describe('a request file that brings files', () => {
  it('reads attach: from the front matter, comma separated', () => {
    const parsed = frontMatter('---\ntitle: 季度报表\nattach: /tmp/a.csv, /tmp/b.pdf\n---\n处理它们。', 'fallback')
    expect(parsed).toMatchObject({ title: '季度报表', attachments: ['/tmp/a.csv', '/tmp/b.pdf'] })
    expect(parsed.body).toBe('处理它们。')
  })

  it('accepts the plural key and a single file, and trims what a person typed', () => {
    expect(frontMatter('---\nattachments: /tmp/only.csv\n---\nx', 'f').attachments).toEqual(['/tmp/only.csv'])
    expect(frontMatter('---\nattach:\n---\nx', 'f').attachments).toBeUndefined()
    expect(frontMatter('---\nattach:  /a.csv ,, /b.csv  \n---\nx', 'f').attachments).toEqual(['/a.csv', '/b.csv'])
  })

  it('leaves a file without front matter alone', () => {
    expect(frontMatter('处理 /tmp/a.csv。', 'fallback').attachments).toBeUndefined()
  })
})

describe('a Ticket carries its files', () => {
  it('records them, and treats a different set of files as a different request', () => {
    const { engine, memory } = engineHarness()
    const first = engine.createTicket({ title: '处理', text: '同样的话', attachments: ['/tmp/a.csv'] })
    const second = engine.createTicket({ title: '处理', text: '同样的话', attachments: ['/tmp/b.csv'] })
    expect(first.ticketId).not.toBe(second.ticketId)
    expect(memory.tickets.get(first.ticketId!)!.attachments).toEqual([{ name: 'a.csv', source: '/tmp/a.csv' }])
    expect(memory.tickets.get(second.ticketId!)!.attachments).toEqual([{ name: 'b.csv', source: '/tmp/b.csv' }])
    // The same request with the same files is still one Ticket, so a retried tool call cannot duplicate the work.
    const again = engine.createTicket({ title: '处理', text: '同样的话', attachments: ['/tmp/a.csv'] })
    expect(again).toMatchObject({ stored: 'duplicate' })
    expect(again.ticketId).toBe(first.ticketId)
  })

  it('takes them from a Trigger any Source produced', () => {
    const { engine, memory } = engineHarness()
    const result = engine.receive(trigger({ attachments: ['/data/x.xlsx'] }))
    expect(memory.tickets.get(result.ticketId!)!.attachments).toEqual([{ name: 'x.xlsx', source: '/data/x.xlsx' }])
  })
})

describe('the tool a person drives it with', () => {
  function host() {
    const directory = tempDir('myagent-attach-')
    const store = new Store(join(directory, 'attach.sqlite3'))
    let current = parseSettings({ acceptMode: 'auto', allowedSenders: ['operator'] })
    const engine = new Engine({
      repos: store, tx: store, policy: () => settingsPolicy(current),
      executor: {
        prepare: ticket => ({ ...ticket, execution: { name: ticket.id, directory: join(directory, 'work', ticket.id) } }),
        start() {}, deliver() {}, stop() {},
      },
      delivery: { report() {} },
      now: () => '2026-11-03T05:00:00.000Z',
    })
    const toolsHost: ToolsHost = { engine, store, acceptMode: () => current.acceptMode,
      // Mirrors what `Sessions.attempt` answers in production: the attempt a launch recorded. Answering `undefined`
      // here would exercise only the fallback and never the identity a report is supposed to carry.
      attempt: (ticketId: string) => store.tickets.get(ticketId)?.assignments.find(item => item.state === 'running')?.id,
      // Faithful where it matters: the authorization is the real Engine's, so a refusal the tool surfaces is a refusal
      // the Engine actually made. Only the IO is stubbed.
      readArtifact: async (source: string, target: string, path: string) => {
        try {
          engine.authorizeArtifactRead(source, target, path)
        } catch (error) {
          const failure = error as { message?: string; code?: string }
          return { ok: false as const, error: failure.message ?? String(error), code: failure.code }
        }
        return { ok: true as const, content: `content of ${path}`, size: 12, at: '2026-11-03T00:00:00.000Z' }
      },
    }
    const tools = mainTools(toolsHost)
    const call = async (name: string, args: unknown) =>
      await definitionOf(tools.find(tool => tool.name === name)!).execute(args, { signal: new AbortController().signal })
    return { store, engine, call, directory }
  }

  it('passes attachments through, and the schema refuses what is not a list of paths', async () => {
    const { call, store } = host()
    const answer = await call('myagent_create_ticket', {
      title: '季度报表', request: '处理附件里的数据', attachments: ['/tmp/sales.csv', '/tmp/traffic.csv'],
    }) as Record<string, unknown>
    expect(answer.disposition).toBe('accepted')
    expect(store.tickets.get(answer.ticket_id as string)!.attachments).toEqual([
      { name: 'sales.csv', source: '/tmp/sales.csv' }, { name: 'traffic.csv', source: '/tmp/traffic.csv' },
    ])
    for (const bad of [{ attachments: '/tmp/one.csv' }, { attachments: [''] }, { attachments: [1] }]) {
      await expect(call('myagent_create_ticket', { title: 'x', request: 'y', ...bad }))
        .rejects.toSatisfy((error: unknown) => error instanceof z.ZodError)
    }
  })

  it('describes what an attachment does, because a model has to decide whether to pass one', () => {
    const schema = z.toJSONSchema(mainTools({} as never)[0]!.schema) as { properties: Record<string, { description?: string }> }
    expect(schema.properties.attachments!.description).toContain('copied into the Ticket')
    expect(schema.properties.attachments!.description).toContain('fails the Ticket')
  })
})
