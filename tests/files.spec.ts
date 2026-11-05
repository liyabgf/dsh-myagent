/**
 * Reading a Ticket's directory from the panel.
 *
 * Two things have to hold: an operator can see and take what a run produced without opening a terminal, and a route
 * that serves files cannot be talked into serving one outside the Ticket's directory.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { isTextFile, listFiles, MAX_FILE_BYTES, readForPanel, resolveInside } from '../src/app/files.ts'
import { api, deployment, type Deployment } from './helpers/deployment.ts'
import { wait } from './helpers/host.ts'
import { tempDir } from './helpers/temp.ts'

const settle = async (runtime: Deployment['runtime'], ms = 80): Promise<void> => {
  await runtime.nudge()
  await wait(ms)
  runtime.passes.requestPass()
  await wait(ms)
}

function sample(): string {
  const root = tempDir('myagent-files-')
  writeFileSync(join(root, 'RESULT.md'), '# 结果\n\n做完了。\n', 'utf8')
  writeFileSync(join(root, 'data.csv'), 'a,b\n1,2\n', 'utf8')
  mkdirSync(join(root, 'charts'), { recursive: true })
  writeFileSync(join(root, 'charts', 'trend.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]), 'binary')
  mkdirSync(join(root, 'scripts'), { recursive: true })
  writeFileSync(join(root, 'scripts', 'run.py'), 'print("hi")\n', 'utf8')
  // A dependency tree a worker may well have made: it is not the operator's output and must not crowd it out.
  mkdirSync(join(root, 'node_modules', 'left-pad'), { recursive: true })
  writeFileSync(join(root, 'node_modules', 'left-pad', 'index.js'), 'module.exports = {}', 'utf8')
  mkdirSync(join(root, '.git'), { recursive: true })
  writeFileSync(join(root, '.git', 'HEAD'), 'ref: refs/heads/main', 'utf8')
  return root
}

describe('listing a directory', () => {
  it('walks what a run produced and leaves out the noise', async () => {
    const listing = await listFiles(sample())
    const paths = listing.files.map(file => file.path)
    // Locale order, not ASCII: a person scanning the list reads charts, data, RESULT, scripts.
    expect(paths).toEqual(['charts', 'charts/trend.png', 'data.csv', 'RESULT.md', 'scripts', 'scripts/run.py'])
    expect(listing.count).toBe(4)
    expect(listing.truncated).toBe(false)
  })

  it('says which entries are worth showing as text', async () => {
    const listing = await listFiles(sample())
    const byPath = Object.fromEntries(listing.files.map(file => [file.path, file]))
    expect(byPath['RESULT.md']).toMatchObject({ text: true, directory: false })
    expect(byPath['charts/trend.png']).toMatchObject({ text: false, directory: false })
    expect(byPath['charts']).toMatchObject({ text: false, directory: true })
    expect(byPath['data.csv']!.size).toBe('a,b\n1,2\n'.length)
  })

  it('reports sizes and modification times, which is how a person tells a real output from a stub', async () => {
    const root = sample()
    const listing = await listFiles(root)
    const result = listing.files.find(file => file.path === 'RESULT.md')!
    expect(result.size).toBe(readFileSync(join(root, 'RESULT.md')).length)
    expect(Date.parse(result.mtime!)).toBeGreaterThan(Date.now() - 60_000)
  })

  it('stops at a bound and says it stopped, rather than serving an unbounded tree', async () => {
    const root = tempDir('myagent-many-')
    for (let index = 0; index < 600; index++) writeFileSync(join(root, `file-${index}.txt`), 'x', 'utf8')
    const listing = await listFiles(root)
    expect(listing.files.length).toBeLessThanOrEqual(500)
    expect(listing.truncated).toBe(true)
  })

  it('lists an empty directory as empty', async () => {
    const listing = await listFiles(tempDir('myagent-empty-'))
    expect(listing).toMatchObject({ files: [], count: 0, truncated: false })
  })

  it('lists a directory that is gone as empty, rather than throwing at the panel', async () => {
    const listing = await listFiles(join(tempDir('myagent-gone-'), 'nope'))
    expect(listing).toMatchObject({ files: [], count: 0 })
  })
})

describe('which paths may be served', () => {
  it('accepts a path inside the directory and refuses every way out of it', () => {
    const root = sample()
    expect(resolveInside(root, 'RESULT.md')).toBe(join(root, 'RESULT.md'))
    expect(resolveInside(root, 'charts/trend.png')).toBe(join(root, 'charts', 'trend.png'))
    expect(resolveInside(root, './RESULT.md')).toBe(join(root, 'RESULT.md'))
    for (const escape of ['../secret.txt', 'charts/../../secret.txt', '/etc/passwd', '..']) {
      expect(resolveInside(root, escape), escape).toBeUndefined()
    }
  })

  it('tells a text file from a binary one by name and size', () => {
    expect(isTextFile('report.md', 100)).toBe(true)
    expect(isTextFile('data.CSV', 100)).toBe(true)
    expect(isTextFile('image.png', 100)).toBe(false)
    expect(isTextFile('huge.log', MAX_FILE_BYTES + 1)).toBe(false)
    expect(isTextFile('no-extension', 100)).toBe(false)
  })

  it('hands over bytes as base64, which is what a download link is built from', async () => {
    const root = sample()
    const read = await readForPanel(join(root, 'RESULT.md'))
    expect(Buffer.from(read.base64, 'base64').toString('utf8')).toBe('# 结果\n\n做完了。\n')
    expect(read.size).toBe(readFileSync(join(root, 'RESULT.md')).length)
  })
})

describe('the panel\'s file routes', () => {
  /** One Ticket with a known directory and some output in it. */
  async function ticketWithFiles(context: Deployment): Promise<{ id: string; directory: string }> {
    const { runtime, host, inbox } = context
    const path = join(inbox, 'produce.md')
    writeFileSync(path, '产出两个文件然后汇报。', 'utf8')
    const at = new Date(Date.now() - 5_000)
    const { utimesSync } = await import('node:fs')
    utimesSync(path, at, at)
    await settle(runtime)
    const id = runtime.store.tickets.list()[0]!.id
    const directory = runtime.store.tickets.get(id)!.execution!.directory
    mkdirSync(join(directory, 'charts'), { recursive: true })
    writeFileSync(join(directory, 'RESULT.md'), '# 结果\n', 'utf8')
    writeFileSync(join(directory, 'charts', 'trend.png'), Buffer.from([0x89, 0x50]), 'binary')
    void host
    return { id, directory }
  }

  it('lists what a run produced', async () => {
    const context = await deployment('auto')
    try {
      const { id, directory } = await ticketWithFiles(context)
      const { json } = await context.host.request(api(`tickets/${id}/files`))
      expect(json.directory).toBe(directory)
      expect((json.files as { path: string }[]).map(file => file.path)).toEqual(['charts', 'charts/trend.png', 'RESULT.md'])
      expect(json.count).toBe(2)
    } finally { await context.runtime.stop() }
  })

  it('serves a text file as text and a binary one as base64', async () => {
    const context = await deployment('auto')
    try {
      const { id } = await ticketWithFiles(context)
      const text = await context.host.request(api(`tickets/${id}/file?path=RESULT.md`))
      expect(text.json).toMatchObject({ path: 'RESULT.md', text: true })
      expect(Buffer.from(text.json.base64 as string, 'base64').toString('utf8')).toBe('# 结果\n')
      const binary = await context.host.request(api(`tickets/${id}/file?path=${encodeURIComponent('charts/trend.png')}`))
      expect(binary.json).toMatchObject({ text: false })
      expect(binary.json.base64).toBeTruthy()
    } finally { await context.runtime.stop() }
  })

  it('refuses to be talked out of the Ticket\'s directory', async () => {
    const context = await deployment('auto')
    try {
      const { id } = await ticketWithFiles(context)
      for (const escape of ['../myagent.json', '%2e%2e%2fmyagent.json', '/etc/passwd']) {
        const response = await context.host.request(api(`tickets/${id}/file?path=${escape}`))
        expect(response.status, escape).toBe(400)
        expect(response.json.error).toContain('outside')
      }
    } finally { await context.runtime.stop() }
  })

  it('says plainly when there is no such file, or it is a directory', async () => {
    const context = await deployment('auto')
    try {
      const { id } = await ticketWithFiles(context)
      expect((await context.host.request(api(`tickets/${id}/file?path=nope.md`))).status).toBe(404)
      expect((await context.host.request(api(`tickets/${id}/file?path=charts`))).status).toBe(400)
      expect((await context.host.request(api(`tickets/${id}/file`))).status).toBe(400)
      expect((await context.host.request(api('tickets/missing/files'))).status).toBe(404)
    } finally { await context.runtime.stop() }
  })
})

describe('the progress route', () => {
  it('shows the worker\'s Session, its recent tools and the last thing it said', async () => {
    const context = await deployment('auto')
    const { runtime, host } = context
    try {
      const path = join(context.inbox, 'watch.md')
      writeFileSync(path, '做点事。', 'utf8')
      const { utimesSync } = await import('node:fs')
      const at = new Date(Date.now() - 5_000)
      utimesSync(path, at, at)
      await settle(runtime)
      const id = runtime.store.tickets.list()[0]!.id
      const agent = host.agents.get(`worker-${id}`)!
      // What a Session log looks like while a worker is mid-task.
      agent.session.events.push(
        { seq: 1, type: 'turn/start', data: { turn: 3 } },
        { seq: 2, type: 'tool/call', data: { name: 'bash' } },
        { seq: 3, type: 'assistant/message', data: { message: { content: [{ type: 'text', text: '正在读取数据。' }] } } },
        { seq: 4, type: 'tool/call', data: { name: 'read' } },
      )
      const { json } = await host.request(api(`tickets/${id}/progress`))
      expect(json).toMatchObject({ sessionId: `worker-${id}`, loaded: true, agentStatus: 'running', turn: 3 })
      expect(json.lastSaid).toBe('正在读取数据。')
      // Newest first, which is what a person watching wants.
      expect((json.recentTools as { name: string }[]).map(tool => tool.name)).toEqual(['read', 'bash'])
      expect(json.assignment).toMatchObject({ state: 'running' })
      expect(json.sessionTitle).toBeTruthy()
    } finally { await runtime.stop() }
  })

  it('says a worker that is not loaded is not loaded, instead of showing nothing', async () => {
    const context = await deployment('observe')
    const { runtime, host } = context
    try {
      const result = await host.request(api('tickets'), { method: 'POST', body: { title: 'x', request: 'y' } })
      expect(result.json.disposition).toBe('observed')
      // In observe mode there is no Ticket at all, so progress has nothing to read.
      expect((await host.request(api('tickets/no-such-ticket/progress'))).status).toBe(404)
      expect(runtime.store.tickets.list()).toEqual([])
    } finally { await runtime.stop() }
  })
})
