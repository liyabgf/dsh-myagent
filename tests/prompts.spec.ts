/** Prompts: the shipped text, the operator's overrides, and finding the files this package ships. */
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PROMPT_MAX_CHARS, PromptConflict, Prompts, packageFile, promptFile } from '../src/app/prompts.ts'
import { BUILTIN_SKILL_NAMES } from '../src/app/skills.ts'

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

describe('saved team skills in PromptConfig (E2)', () => {
  it('saves, toggles, counts uses, and removes a promoted skill while rejecting built-in collisions', () => {
    const store = fakeStore()
    const prompts = new Prompts(store)
    const saved = prompts.saveSkill({
      name: 'entity-dedup-merger',
      title: '多源实体归一化去重器',
      description: '归一化全半角括号与工商全称并消除重复融资记录',
      content: '# 多源实体归一化去重器\n\n```python\nprint("ok")\n```',
      fromTicketId: 'ticket-origin-1',
    })
    expect(saved.name).toBe('myagent-entity-dedup-merger')
    expect(saved.enabled).toBe(true)
    expect(saved.useCount).toBe(0)
    expect(prompts.skills()).toHaveLength(1)

    // Increment use count
    expect(prompts.recordSkillUse('myagent-entity-dedup-merger')?.useCount).toBe(1)
    // Toggle off and back on
    expect(prompts.setSkillEnabled('myagent-entity-dedup-merger', false).enabled).toBe(false)
    expect(prompts.setSkillEnabled('myagent-entity-dedup-merger', true).enabled).toBe(true)

    // Built-in skill names are protected
    expect(() => prompts.saveSkill({
      name: 'html-to-text', title: 'x', description: 'y', content: 'z',
    })).toThrow(/reserved for a built-in/)

    // Remove
    prompts.removeSkill('myagent-entity-dedup-merger')
    expect(prompts.skills()).toEqual([])
  })

  /**
   * The reserved list is derived, not spelled out.
   *
   * `prompts.ts` used to carry its own literal `['myagent-html-to-text', 'myagent-source-registry',
   * 'myagent-polite-fetch']`, which was a third copy of a fact `skills.ts` owns (the panel kept a second). A copy is
   * what drifts: add a fourth built-in and the refusal stays behind, so a worker can promote a craft under a built-in's
   * name — and the host resolves a duplicate name in one layer by IGNORING the second registration and handing back a
   * disposer that does nothing, so the craft would look saved on the panel and be unreachable in every worker.
   */
  it('refuses exactly the names SKILLS contributes, so the two lists cannot drift', () => {
    const prompts = new Prompts(fakeStore())
    expect(BUILTIN_SKILL_NAMES.length).toBeGreaterThan(0)
    for (const name of BUILTIN_SKILL_NAMES) {
      expect(() => prompts.saveSkill({
        name: name.replace(/^myagent-/, ''), title: 'x', description: 'y', content: 'z',
      })).toThrow(/reserved for a built-in/)
    }
    // And the derivation is not vacuous: a name outside the list is still accepted.
    expect(prompts.saveSkill({ name: 'not-a-built-in', title: 'x', description: 'y', content: 'z' }).name)
      .toBe('myagent-not-a-built-in')
  })

  it('keeps a promoted craft live with nobody approving it, which is the whole product promise', () => {
    // Containment is done by WHERE a craft is registered (one worker's own scope layer), never by making the operator
    // a gate: a craft waiting for a click is a craft the next Ticket re-derives.
    const prompts = new Prompts(fakeStore())
    expect(prompts.saveSkill({ name: 'auto', title: 'x', description: 'y', content: 'z' }).enabled).toBe(true)
  })
})
