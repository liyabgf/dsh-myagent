/**
 * The desktop notification: what macOS is asked to show, and what a refusal there costs.
 *
 * A notification is the one part of a delivery that is pure courtesy — `RESULT.md` and the notice in the main Session
 * are the record — so these hold two things apart: the banner has to carry enough to be worth interrupting somebody
 * for, and nothing about it may reach the delivery's own outcome.
 *
 * The delivery is driven through its effect queue rather than through a whole deployment, so what the notifier was asked
 * to run is read off the spawn it made instead of inferred from a timing, and a notifier program can be injected that
 * this machine does not have.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { SubprocessRuntime } from '@deepseek-ai/dsh-subprocess'
import { afterEach, describe, expect, it } from 'vitest'
import { writeFile } from 'node:fs/promises'
import { findNotifier, OutcomeDelivery } from '../src/app/delivery.ts'
import { Effects } from '../src/app/effects.ts'
import { HealthBoard } from '../src/app/health.ts'
import type { Sessions } from '../src/app/sessions.ts'
import { Store } from '../src/app/store.ts'
import { parseSettings, type Report, type Ticket } from '../src/core/index.ts'
import { stubHost, type StubOptions } from './helpers/host.ts'
import { tempDir } from './helpers/temp.ts'

/** The panel prefix a Runtime hands its delivery, which is what a clicked banner opens. */
const PANEL = 'http://127.0.0.1:3080/myagent/#ticket='
/** The notifier program these tests inject; nothing here runs it, only reads the command built for it. */
const NOTIFIER = '/opt/homebrew/bin/terminal-notifier'
const AT = '2026-11-03T03:00:00.000Z'
/** The two places `findNotifier` looks before it looks at PATH, which a given machine may or may not have. */
const BUILT_IN = ['/opt/homebrew/bin/terminal-notifier', '/usr/local/bin/terminal-notifier']

interface HarnessOptions extends StubOptions {
  /** The notifier program to inject; the default forces the `osascript` path, as a machine without one takes it. */
  readonly notifier?: string | null
  /** Make the spawned notification fail after it started, rather than refusing to start at all. */
  readonly doneRejects?: string
  /** Whether the operator turned desktop notifications on; the default is on, since that is what these tests watch. */
  readonly notifyEnabled?: boolean
  /** The panel prefix to hand the delivery; an empty one is a profile with no web server, so there is nothing to open. */
  readonly panelPath?: string
}

interface Harness {
  readonly store: Store
  readonly health: HealthBoard
  /** Every subprocess the delivery spawned, in order; a notification is the only thing here that spawns one. */
  readonly spawns: { argv: string[]; cwd: string }[]
  /** What the main Session was told, which is the record a banner must never stand in for. */
  readonly notices: { text: string; requestId: string }[]
  /** Everything logged at debug level, which is the only place a failed courtesy is allowed to surface. */
  readonly debugs: string[]
  /** This harness's own temporary state directory. */
  readonly directory: string
  /** Queue one Report and run the pump over it, which is the path a notification takes in production. */
  notify(ticket: Ticket, report: Report): Promise<void>
}

const open: Store[] = []
afterEach(() => { for (const store of open.splice(0)) store.close() })

function harness(options: HarnessOptions = {}): Harness {
  const host = stubHost(options)
  const directory = tempDir('myagent-machine-')
  const store = new Store(join(directory, 'myagent.sqlite3'))
  open.push(store)
  store.saveSettings(parseSettings({ notify: { enabled: options.notifyEnabled ?? true } }))
  const health = new HealthBoard()
  const lifetime = new AbortController().signal
  // The queue shares the board the delivery writes to, so a failure that escaped the notification's own catch would
  // be recorded here and the assertions below would see it.
  const effects = new Effects(store, { health: health.entry('effects'), lifetime })
  const notices: { text: string; requestId: string }[] = []
  const sessions = {
    notify: async (text: string, requestId: string) => { notices.push({ text, requestId }) },
    // An ending leaves a notice in the history; waking the front desk for one would cost the operator a model turn.
    // Refusing it here means a delivery that did wake somebody fails the assertions below instead of passing quietly.
    relay: async (): Promise<boolean> => { throw new Error('an ending must not wake the main Session') },
  } as unknown as Sessions
  const debugs: string[] = []
  const ctx = {
    ...host.ctx,
    logger: { ...host.ctx.logger, debug: (...args: unknown[]) => { debugs.push(args.map(String).join(' ')) } },
  } as unknown as Context
  // The stub host answers a spawn with a process that worked, or one that refuses to start; a notification that dies
  // after it started is the third case, and it is the one `await handle.done` is there for.
  const subprocess: SubprocessRuntime = options.doneRejects === undefined
    ? host.ctx.subprocess
    : {
      spawn: (spec: { argv: string[]; cwd: string }) => {
        host.calls.spawns.push({ argv: spec.argv, cwd: spec.cwd })
        return { done: Promise.reject(new Error(options.doneRejects)) }
      },
    } as unknown as SubprocessRuntime
  const delivery = new OutcomeDelivery({
    context: ctx, store, effects, sessions, health, lifetime, subprocess,
    settings: () => store.settings(), panelPath: () => options.panelPath ?? PANEL,
    // No Source is running in this harness, and none is needed: these Tickets are made by hand, so their Triggers were
    // never stored and no `replyTo` exists to dispatch. `report` counts the reply as having nowhere to go and goes on.
    source: () => undefined,
    // No reply is ever given up on here, so nothing is recorded; a stub that wrote to a log this harness has no
    // Engine for would be the one thing that could make a notification test lie about a delivery.
    replyLost: () => {},
    // 【G-3 站点 2】同生产路径的真写：notify 走 ENDING 时这里就是 RESULT.md 的落点。
    writeResultFile: async (directory: string, name: string, text: string) => {
      await writeFile(join(directory, name), text, 'utf8')
    },
  }, options.notifier ?? null)
  return {
    store, health, spawns: host.calls.spawns, notices, debugs, directory,
    notify: async (ticket, report) => {
      delivery.report(ticket, report)
      await effects.runDue()
    },
  }
}

/** One Ticket in the Store, with a directory of its own that `RESULT.md` can be written into. */
function ticket(context: Harness, over: Partial<Ticket> = {}): Ticket {
  const directory = join(context.directory, 'work', 'ticket-1')
  mkdirSync(directory, { recursive: true })
  const made: Ticket = {
    id: 'ticket-1', title: '整理本周竞品动态', createdAt: '2026-11-03T02:00:00.000Z',
    mandate: {
      policyVersion: 'abc123', scope: 'Work in this Ticket\'s own directory and write nothing outside it.',
      strength: 'explicit', sender: { id: 'operator', kind: 'person' }, via: 'schedule', at: '2026-11-03T02:00:00.000Z',
    },
    origin: { triggerId: 'trigger-1' }, attachments: [],
    assignments: [{ id: 'assignment-1', state: 'running', createdAt: '2026-11-03T02:00:00.000Z' }],
    notes: [], inputs: [],
    execution: { name: 'digest', directory },
    ...over,
  }
  context.store.tickets.save(made)
  return made
}

/** The command the one notification was spawned with; a second banner for one Report would fail here rather than below. */
function notification(context: Harness): string[] {
  expect(context.spawns).toHaveLength(1)
  return context.spawns[0]!.argv
}

/** Run `run` with PATH replaced, and put PATH back however the machine had it. */
function onPath(directory: string, run: () => void): void {
  const original = process.env.PATH
  process.env.PATH = directory
  try { run() } finally {
    if (original === undefined) delete process.env.PATH
    else process.env.PATH = original
  }
}

describe('what the desktop is asked to show', () => {
  it('names the Ticket and what became of it when this machine has no notifier program', async () => {
    const context = harness()
    await context.notify(ticket(context), { state: 'ready', summary: '写好了 digest.md', at: AT })
    // AppleScript is the fallback every macOS has: it cannot open the panel, so the text carries the whole account.
    expect(notification(context)).toEqual(['osascript', '-e',
      'display notification "写好了 digest.md" with title "整理本周竞品动态" subtitle "整理本周竞品动态 — done"'])
  })

  it('hands a notifier program the panel address of that Ticket, so clicking the banner goes somewhere', async () => {
    const context = harness({ notifier: NOTIFIER })
    const made = ticket(context)
    await context.notify(made, { state: 'ready', summary: '写好了 digest.md', at: AT })
    const command = notification(context)
    expect(command.slice(0, 8)).toEqual([NOTIFIER, '-title', '整理本周竞品动态', '-subtitle', '整理本周竞品动态 — done',
      '-message', '写好了 digest.md', '-open'])
    // The prefix ends in `#ticket=`, so only the id may follow: an API path segment inside the fragment would open
    // the panel and then find nothing to select.
    expect(command[8]).toBe(`${PANEL}${made.id}`)
  })

  it('flattens a report of several lines into the one line a banner holds', async () => {
    const context = harness()
    await context.notify(ticket(context), { state: 'ready', summary: '第一行\n\n  第二行\t制表\n第三行    多余的空格', at: AT })
    const script = notification(context)[2]!
    expect(script).not.toContain('\n')
    expect(script).toContain('display notification "第一行 第二行 制表 第三行 多余的空格" with title')
  })

  it('cuts a summary too long for an AppleScript banner at 160 characters and says it was cut', async () => {
    const context = harness()
    await context.notify(ticket(context), { state: 'ready', summary: `H${'a'.repeat(398)}T`, at: AT })
    const body = /^display notification "(.*)" with title/.exec(notification(context)[2]!)![1]!
    expect(body).toHaveLength(160)
    expect(body.endsWith('…')).toBe(true)
    // The head survives the cut and the tail does not: the first lines are the part worth interrupting somebody for.
    expect(body.startsWith('H')).toBe(true)
    expect(body).not.toContain('T')
  })

  it('gives a notifier program the longer body it can show, cut by the same rule', async () => {
    const context = harness({ notifier: NOTIFIER })
    await context.notify(ticket(context), { state: 'ready', summary: `H${'a'.repeat(398)}T`, at: AT })
    const message = notification(context)[6]!
    expect(message).toHaveLength(200)
    expect(message.startsWith('H')).toBe(true)
    expect(message.endsWith('…')).toBe(true)
    expect(message).not.toContain('T')
  })

  it('cuts the title and the headline it repeats to the 60 characters a banner line holds', async () => {
    const context = harness({ notifier: NOTIFIER })
    await context.notify(ticket(context, { title: `标${'题'.repeat(120)}` }), { state: 'ready', summary: '写好了', at: AT })
    const command = notification(context)
    expect(command[2]).toHaveLength(60)
    expect(command[2]!.endsWith('…')).toBe(true)
    // The headline is the title plus what became of it, so it is cut by the same rule rather than left whole and
    // pushed off the banner.
    expect(command[4]).toHaveLength(60)
    expect(command[4]!.endsWith('…')).toBe(true)
  })

  it('quotes a summary full of quotes and backslashes, so it cannot end the AppleScript string early', async () => {
    const context = harness()
    await context.notify(ticket(context), { state: 'ready', summary: 'he said "done" and wrote C:\\path\\x', at: AT })
    const script = notification(context)[2]!
    expect(script).toBe('display notification "he said \\"done\\" and wrote C:\\\\path\\\\x" '
      + 'with title "整理本周竞品动态" subtitle "整理本周竞品动态 — done"')
    // An unescaped quote is what a way out of the string looks like, and there is none left.
    expect(script).not.toContain('"done"')
  })
})

describe('a desktop that will not take the notification', () => {
  it('still settles the delivery when the notification cannot even start, because the notice is the record', async () => {
    const context = harness({ spawn: { throws: 'osascript: command not found' } })
    const made = ticket(context)
    await context.notify(made, { state: 'ready', summary: '写好了 digest.md', at: AT })
    // The banner was attempted, so what follows is a delivery that survived the attempt rather than one that skipped it.
    expect(notification(context)[0]).toBe('osascript')
    expect(readFileSync(join(made.execution!.directory, 'RESULT.md'), 'utf8')).toContain('写好了 digest.md')
    expect(context.notices.map(notice => notice.text).join('\n')).toContain('写好了 digest.md')
    // Settled rather than retried: a courtesy that failed is not work that is owed, and nothing is wrong with the
    // delivery, so the board says nothing either.
    expect(context.store.effectCounts()).toEqual({})
    expect(context.health.problems()).toEqual([])
    expect(context.debugs.join('\n')).toContain('osascript: command not found')
  })

  it('still settles the delivery when the notifier program fails after it started', async () => {
    const context = harness({ notifier: NOTIFIER, doneRejects: 'terminal-notifier exited with 1' })
    const made = ticket(context)
    await context.notify(made, { state: 'ready', summary: '写好了 digest.md', at: AT })
    expect(notification(context)[0]).toBe(NOTIFIER)
    expect(readFileSync(join(made.execution!.directory, 'RESULT.md'), 'utf8')).toContain('写好了 digest.md')
    expect(context.notices).toHaveLength(1)
    expect(context.store.effectCounts()).toEqual({})
    expect(context.health.problems()).toEqual([])
    expect(context.debugs.join('\n')).toContain('terminal-notifier exited with 1')
  })

  it('leaves the desktop alone when the operator did not turn notifications on, and keeps the record', async () => {
    const context = harness({ notifyEnabled: false })
    const made = ticket(context)
    await context.notify(made, { state: 'ready', summary: '写好了 digest.md', at: AT })
    expect(context.spawns).toEqual([])
    expect(context.notices).toHaveLength(1)
    expect(readFileSync(join(made.execution!.directory, 'RESULT.md'), 'utf8')).toContain('写好了 digest.md')
  })
})

describe('looking the notifier program up', () => {
  it('finds nothing on a machine whose PATH holds no terminal-notifier', () => {
    const installed = BUILT_IN.filter(candidate => existsSync(candidate))
    onPath(tempDir('myagent-empty-'), () => {
      // The two built-in locations are probed before PATH, so a machine that has one installed answers with it
      // whatever PATH says; `installed[0]` is undefined on a machine that has neither.
      expect(findNotifier()).toBe(installed[0])
    })
  })

  it('finds the executable a machine has on its PATH', () => {
    const directory = tempDir('myagent-bin-')
    const program = join(directory, 'terminal-notifier')
    writeFileSync(program, '#!/bin/sh\nexit 0\n', { mode: 0o755 })
    const installed = BUILT_IN.filter(candidate => existsSync(candidate))
    onPath(directory, () => {
      // A built-in install wins because it is probed first, which is the order the lookup documents.
      expect(findNotifier()).toBe(installed[0] ?? program)
    })
  })
})

describe('the way in a banner carries', () => {
  it('leaves out the address when this profile has no web server to open', async () => {
    const context = harness({ notifier: NOTIFIER, panelPath: '' })
    await context.notify(ticket(context), { state: 'ready', summary: '写好了', at: AT })
    // `-open` with nothing after it, or with a bare Ticket id, would be a URL that goes nowhere.
    expect(notification(context)).not.toContain('-open')
    expect(notification(context).slice(0, 7)).toEqual([NOTIFIER, '-title', '整理本周竞品动态',
      '-subtitle', '整理本周竞品动态 — done', '-message', '写好了'])
  })

  it('does not cut a banner in the middle of a character', async () => {
    // The 160th unit of this summary is the second half of an emoji; a clip that counts code units would put a lone
    // surrogate into argv, and the banner would end in U+FFFD.
    const summary = `${'数'.repeat(158)}😀尾巴`
    const context = harness()
    await context.notify(ticket(context), { state: 'ready', summary, at: AT })
    const script = notification(context)[2]!
    const body = /display notification "(.*)" with title/su.exec(script)![1]!
    expect(body.endsWith('…')).toBe(true)
    expect(/[\uD800-\uDBFF]…/u.test(body), 'a lone high surrogate before the ellipsis').toBe(false)
    expect(body).not.toContain('\uFFFD')
    expect([...body.replace(/…$/, '')].join('').length).toBeLessThanOrEqual(159)
  })
})

describe('which program is taken for the notifier', () => {
  const savedPath = process.env.PATH
  afterEach(() => { process.env.PATH = savedPath })
  const skipIfBuiltIn = (): boolean => BUILT_IN.some(existsSync)

  it('does not take a directory, or a file it may not execute, for a notifier program', () => {
    if (skipIfBuiltIn()) return
    const directory = tempDir('myagent-notifier-')
    const candidate = join(directory, 'terminal-notifier')
    process.env.PATH = directory
    // A directory of that name on PATH: `existsSync` alone would have accepted it, and every spawn after that would
    // have failed at debug level, so the machine would silently lose all notifications forever.
    mkdirSync(candidate)
    expect(findNotifier()).toBeUndefined()
    // A file of that name that is not executable.
    rmSync(candidate, { recursive: true })
    writeFileSync(candidate, '#!/bin/sh\n', 'utf8')
    expect(findNotifier()).toBeUndefined()
  })

  it('takes a file it may execute, which is the only thing worth spawning', () => {
    if (skipIfBuiltIn()) return
    const directory = tempDir('myagent-notifier-')
    const candidate = join(directory, 'terminal-notifier')
    writeFileSync(candidate, '#!/bin/sh\n', 'utf8')
    chmodSync(candidate, 0o755)
    process.env.PATH = directory
    expect(findNotifier()).toBe(candidate)
  })
})
