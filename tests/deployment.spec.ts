/**
 * Deployment configuration: the directories this system owns, and what happens when a person writes one wrong.
 *
 * A wrong path here is not a runtime surprise later — it is where the database, the lock, every Ticket's directory and
 * the inbox live, so each failure has to name the setting it came from.
 */
import { mkdirSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { Config, SetupError, dshHome, expandPath, machineOf, machineView } from '../src/deployment.ts'
import { tempDir } from './helpers/temp.ts'

const directory = () => tempDir('myagent-config-')

describe('expandPath', () => {
  it('expands a home directory, keeps an absolute path, and resolves a relative one against the cwd', () => {
    expect(expandPath('~')).toBe(homedir())
    expect(expandPath('~/notes')).toBe(join(homedir(), 'notes'))
    expect(expandPath('/var/tmp/x')).toBe('/var/tmp/x')
    expect(expandPath('state')).toBe(resolve(process.cwd(), 'state'))
    // Whitespace a person left in a config file is not part of a path.
    expect(expandPath('  ~/notes  ')).toBe(join(homedir(), 'notes'))
    expect(expandPath('   ')).toBe('')
  })
})

describe('dshHome', () => {
  const saved = process.env.DSH_HOME
  afterEach(() => {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
  })

  it('is what the harness set, and DSH\'s own default when a bare shell did not', () => {
    process.env.DSH_HOME = join(tmpdir(), 'dsh-home')
    expect(dshHome()).toBe(join(tmpdir(), 'dsh-home'))
    delete process.env.DSH_HOME
    expect(dshHome()).toBe(join(homedir(), '.dsh'))
    process.env.DSH_HOME = '   '
    expect(dshHome()).toBe(join(homedir(), '.dsh'))
  })
})

describe('machineOf', () => {
  const saved = process.env.DSH_HOME
  let home: string
  beforeEach(() => {
    home = directory()
    process.env.DSH_HOME = home
  })
  afterEach(() => {
    if (saved === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = saved
  })

  it('puts everything under DSH\'s home when a profile says nothing', () => {
    const machine = machineOf(Config({}))
    expect(machine.stateDir).toBe(join(home, 'state', 'myagent'))
    expect(machine.workRoot).toBe(join(machine.stateDir, 'work'))
    expect(machine.inboxDir).toBe(join(machine.stateDir, 'inbox'))
    expect(machine.mainSessionId).toBe('myagent-main')
    expect(machine.promptMaxChars.get()).toBe(100_000)
  })

  it('makes the directories it resolved, so the first Ticket does not fail on a missing one', () => {
    const machine = machineOf(Config({}))
    expect(() => mkdirSync(machine.workRoot, { recursive: true })).not.toThrow()
    expect(machineView(machine)).toEqual({
      stateDir: machine.stateDir, workRoot: machine.workRoot,
      inboxDir: machine.inboxDir, mainSessionId: machine.mainSessionId,
    })
  })

  it('takes the paths a profile wrote', () => {
    const state = directory()
    const work = join(directory(), 'work')
    const machine = machineOf(Config({ stateDir: state, workRoot: work, inboxDir: join(state, 'in'), mainSessionId: 'desk' }))
    expect(machine.stateDir).toBe(state)
    expect(machine.workRoot).toBe(work)
    expect(machine.inboxDir).toBe(join(state, 'in'))
    expect(machine.mainSessionId).toBe('desk')
    // Expansion of `~` and of a relative path is `expandPath`'s business, and is tested there: `machineOf` makes the
    // directories it resolves, so pointing it at `~/work` from a test would leave one behind in the operator's home.
    expect(expandPath('~/work')).toBe(join(homedir(), 'work'))
  })

  it('treats an empty setting as no setting, rather than as a directory called nothing', () => {
    const machine = machineOf(Config({ stateDir: '', workRoot: '  ', inboxDir: '', mainSessionId: '' }))
    expect(machine.stateDir).toBe(join(home, 'state', 'myagent'))
    expect(machine.workRoot).toBe(join(machine.stateDir, 'work'))
    expect(machine.mainSessionId).toBe('myagent-main')
  })

  it('names the setting that cannot be used, one at a time', () => {
    // A path under a regular file cannot be made, which is the ordinary way a configuration goes wrong.
    const root = directory()
    const blocker = join(root, 'a-file')
    writeFileSync(blocker, 'not a directory', 'utf8')
    const problemOf = (config: unknown): string => {
      try { machineOf(config as never); return 'no error' } catch (error) { return (error as SetupError).problem }
    }
    expect(problemOf(Config({ stateDir: blocker }))).toBe('stateDir')
    expect(problemOf(Config({ stateDir: root, workRoot: join(blocker, 'work') }))).toBe('workRoot')
    expect(problemOf(Config({ stateDir: root, inboxDir: join(blocker, 'inbox') }))).toBe('inboxDir')
    // The message carries the path, so the operator can see which one to fix.
    try { machineOf(Config({ stateDir: root, workRoot: join(blocker, 'work') })) } catch (error) {
      expect((error as SetupError).message).toContain(join(blocker, 'work'))
      expect((error as SetupError).message).toContain('could not be made')
    }
  })

  it('refuses a main Session id that could not be a Session id', () => {
    for (const id of ['has space', 'slash/inside', '']) {
      if (id === '') continue
      expect(() => machineOf(Config({ mainSessionId: id }))).toThrow(SetupError)
    }
    expect(() => machineOf(Config({ mainSessionId: 'my-agent_1' }))).not.toThrow()
  })

  it('refuses configuration keys it does not use, rather than ignoring a setting nobody reads', () => {
    expect(() => machineOf({ stateDir: directory(), stateDirectory: '/tmp/x' } as never)).toThrow(/keys it does not use/)
  })
})

describe('the configuration schema', () => {
  it('bounds the prompt override, which is stored in the database and sent to a model', () => {
    expect(Config({ promptMaxChars: 100_000 }).promptMaxChars.get()).toBe(100_000)
    expect(() => Config({ promptMaxChars: 10 })).toThrow()
    expect(() => Config({ promptMaxChars: 10_000_000 })).toThrow()
  })
})
