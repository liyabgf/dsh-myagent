/** Prompts: the shipped text, the operator's overrides, and finding the files this package ships. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PROMPT_MAX_CHARS, PromptConflict, Prompts, packageFile, promptFile } from '../src/app/prompts.ts'

/** The key-value half of the Store, which is all `Prompts` uses. */
function fakeStore() {
  const values = new Map<string, unknown>()
  return {
    get: <T>(key: string): T | undefined => values.get(key) as T | undefined,
    set: (key: string, value: unknown): void => { values.set(key, value) },
    values,
  }
}

describe('the files this package ships', () => {
  it('finds both role prompts, whichever layout this module runs from', () => {
    for (const role of ['worker', 'orchestrator'] as const) {
      const text = readFileSync(promptFile(role), 'utf8')
      expect(text.length).toBeGreaterThan(200)
      expect(text).toContain(role === 'worker' ? 'myagent_report' : 'myagent_create_ticket')
    }
  })

  it('finds the panel page and the bundle patch', () => {
    expect(readFileSync(packageFile('panel/index.html'), 'utf8')).toContain('x-myagent-request')
    expect(readFileSync(packageFile('cordis.patch.yml'), 'utf8')).toContain('myagent-worker')
  })

  it('says plainly what is missing rather than serving nothing', () => {
    expect(() => packageFile('prompts/absent.md')).toThrow(/missing from this myagent installation/)
  })
})

describe('prompt overrides', () => {
  it('runs the shipped text until an override is stored', () => {
    const prompts = new Prompts(fakeStore())
    expect(prompts.current('worker')).toBe(prompts.base('worker'))
    expect(prompts.revision()).toBe(0)
    expect(prompts.config()).toEqual({})
  })

  it('takes an override, moves the revision, and keeps the shipped text for the other role', () => {
    const store = fakeStore()
    const prompts = new Prompts(store)
    expect(prompts.save({ worker: 'You are one Ticket\'s worker. Report honestly.' })).toBe(1)
    expect(prompts.current('worker')).toBe('You are one Ticket\'s worker. Report honestly.')
    expect(prompts.current('orchestrator')).toBe(prompts.base('orchestrator'))
    expect(prompts.revision()).toBe(1)
    expect(prompts.version('worker')).toMatchObject({ revision: 1, role: 'worker' })
    // A live Session rebinds when the revision moves, which is how an edit reaches it without a restart.
    expect(new Prompts(store).revision()).toBe(1)
    expect(new Prompts(store).current('worker')).toContain('Report honestly')
  })

  it('returns a role to its shipped text when the override is emptied', () => {
    const prompts = new Prompts(fakeStore())
    prompts.save({ worker: 'Something else' })
    prompts.save({ worker: '   ' })
    expect(prompts.current('worker')).toBe(prompts.base('worker'))
    expect(prompts.config()).toEqual({})
  })

  it('refuses an override that is not text, is too long, or names no role', () => {
    const prompts = new Prompts(fakeStore())
    expect(() => prompts.save({ worker: 'x'.repeat(PROMPT_MAX_CHARS + 1) })).toThrow(PromptConflict)
    expect(() => prompts.save({ worker: 42 as unknown as string })).toThrow(PromptConflict)
    expect(() => prompts.save({ nobody: 'text' } as never)).toThrow(/not a prompt role/)
    // Nothing was stored by the refused saves.
    expect(prompts.revision()).toBe(0)
  })

  it('flags an override that only repeats the shipped text, which pins the role to it', () => {
    const prompts = new Prompts(fakeStore())
    prompts.save({ worker: prompts.base('worker') })
    expect(prompts.overrideIsBase('worker')).toBe(true)
    expect(prompts.overrideIsBase('orchestrator')).toBe(false)
  })
})
