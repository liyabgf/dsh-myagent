/**
 * The gate, the policy version, and what a settings change does to work already authorized.
 *
 * These are the rules the whole system rests on: every Trigger passes through `gate`, and every Mandate carries the
 * policy version that produced it. They are tested directly rather than through the Engine, because a wrong verdict here
 * is either work that never runs or work that runs when it should not.
 */
import { describe, expect, it } from 'vitest'
import { GATE_REASONS, SettingsSchema, gate, parseSettings, policyEffects, policyVersion, settingsPolicy } from '../src/core/index.ts'
import type { Settings } from '../src/core/policy.ts'
import type { Mandate, Trigger } from '../src/core/model.ts'

const settings = (value: unknown = {}): Settings =>
  parseSettings({ acceptMode: 'auto', allowedSenders: ['operator'], ...value as object })

const trigger = (over: Partial<Trigger> = {}): Trigger => ({
  id: 'trigger-1', source: 'inbox', kind: 'inbox', at: '2026-11-03T01:00:00.000Z',
  actor: { id: 'operator', kind: 'person' }, text: '整理本周竞品动态', title: '竞品动态', ...over,
})

const schedule = (over: object = {}) => ({
  id: 'digest', name: '每日摘要', prompt: '写今天的摘要', timing: { kind: 'daily', time: '09:00' }, ...over,
})

describe('a schedule has to say what it asks for', () => {
  it('refuses a schedule with no id, which would share one next run with every other such schedule', () => {
    const result = SettingsSchema.safeParse({ sources: { cron: { schedules: [{ prompt: '做事', timing: { kind: 'daily', time: '09:00' } }] } } })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues.map(issue => issue.path.join('.'))).toContain('sources.cron.schedules.0.id')
  })

  it('refuses a schedule with no request text, which would be refused as empty on every firing', () => {
    for (const prompt of [undefined, '', '   ']) {
      const result = SettingsSchema.safeParse({ sources: { cron: { schedules: [{ id: 'digest', prompt, timing: { kind: 'daily', time: '09:00' } }] } } })
      expect(result.success, `prompt ${JSON.stringify(prompt)}`).toBe(false)
      if (!result.success) expect(result.error.issues.map(issue => issue.path.join('.'))).toContain('sources.cron.schedules.0.prompt')
    }
  })

  it('refuses two schedules that share an id, naming the id that collides', () => {
    const result = SettingsSchema.safeParse({ sources: { cron: { schedules: [schedule(), schedule({ name: '另一个' })] } } })
    expect(result.success).toBe(false)
    if (result.success) return
    expect(result.error.issues[0]!.message).toContain('digest')
    expect(result.error.issues[0]!.path.join('.')).toBe('sources.cron.schedules.1.id')
  })

  it('refuses an id that would not survive being a file name or a cursor key', () => {
    for (const id of ['Digest', '1digest', 'dig est', 'x'.repeat(41)]) {
      expect(SettingsSchema.safeParse({ sources: { cron: { schedules: [schedule({ id })] } } }).success, id).toBe(false)
    }
  })

  it('fills in what is cosmetic and keeps what matters', () => {
    const parsed = settings({ sources: { cron: { schedules: [{ id: 'digest', prompt: '写今天的摘要', timing: { kind: 'daily', time: '09:00' } }] } } })
    expect(parsed.sources.cron.schedules[0]).toMatchObject({ id: 'digest', name: '', scope: '', enabled: true })
  })

  it('refuses a timing that cannot be computed', () => {
    expect(SettingsSchema.safeParse({ sources: { cron: { schedules: [schedule({ timing: { kind: 'cron', expression: '* * *' } })] } } }).success).toBe(false)
    expect(SettingsSchema.safeParse({ sources: { cron: { schedules: [schedule({ timing: { kind: 'daily', time: '25:00' } })] } } }).success).toBe(false)
    expect(SettingsSchema.safeParse({ sources: { cron: { schedules: [schedule({ timing: { kind: 'every', seconds: 5 } })] } } }).success).toBe(false)
    // And accepts the four shapes it does support.
    for (const timing of [
      { kind: 'every', seconds: 600 }, { kind: 'daily', time: '09:00' },
      { kind: 'weekly', time: '09:00', weekdays: [1, 4] }, { kind: 'cron', expression: '*/15 9-17 * * 1-5' },
    ]) {
      expect(SettingsSchema.safeParse({ sources: { cron: { schedules: [schedule({ timing })] } } }).success, JSON.stringify(timing)).toBe(true)
    }
  })
})

/** The operator-facing contract: a bad settings document is refused with the field named, not silently defaulted. */
const issuesOf = (value: unknown): string[] => {
  const result = SettingsSchema.safeParse(value)
  return result.success ? [] : result.error.issues.map(issue => `${issue.path.join('.')}: ${issue.message}`)
}

describe('a settings document a person wrote', () => {
  it('refuses what it cannot use and names the field, so the panel can point at it', () => {
    const issues = issuesOf({ sources: { cron: { schedules: [{ name: '没有 id 也没有内容' }] } } })
    expect(issues.join('\n')).toContain('schedules.0.id')
    expect(issues.join('\n')).toContain('schedules.0.prompt')
    expect(issues.join('\n')).toContain('schedules.0.timing')
  })

  it('accepts an empty document, which is how a fresh deployment starts', () => {
    expect(parseSettings({})).toMatchObject({ acceptMode: 'observe', paused: false, allowedSenders: ['operator'] })
    expect(parseSettings({}).sources.cron.schedules).toEqual([])
  })

  it('refuses an unknown field rather than keeping a setting nobody reads', () => {
    expect(issuesOf({ acceptMod: 'auto' }).join('\n')).toContain('acceptMod')
  })
})

describe('the gate', () => {
  it('admits a request from an allowed sender, and says so with a fixed reason', () => {
    const verdict = gate(trigger(), settings())
    expect(verdict).toMatchObject({ allow: true, observe: false, reason: 'accepted', via: 'inbox', strength: 'explicit' })
    expect(verdict.scope).toContain('own directory')
  })

  it('records instead of executing while the accept mode is observe', () => {
    const verdict = gate(trigger(), settings({ acceptMode: 'observe' }))
    expect(verdict).toMatchObject({ allow: true, observe: true, reason: 'observed' })
    // The record is complete: the scope it would have run under is part of what is written down.
    expect(verdict.scope).toContain('own directory')
  })

  it('reaches every one of its fixed reasons, so a refusal always has a wording', () => {
    const cases: [GateReasonOf, Trigger, unknown][] = [
      ['accepted', trigger(), {}],
      ['observed', trigger(), { acceptMode: 'observe' }],
      ['paused', trigger(), { paused: true }],
      ['source_disabled', trigger({ kind: 'inbox', source: 'inbox' }), { sources: { inbox: { enabled: false } } }],
      ['source_disabled', trigger({ kind: 'cron', source: 'cron' }), { sources: { cron: { enabled: false } } }],
      ['source_disabled', trigger({ kind: 'session', source: 'session' }), { sources: { session: { enabled: false } } }],
      ['sender_not_allowed', trigger({ actor: { id: 'stranger', kind: 'person' } }), {}],
      ['system_actor', trigger({ actor: { id: 'watcher', kind: 'system' } }), { allowedSenders: ['operator', 'watcher'] }],
      ['empty_request', trigger({ text: '   ' }), {}],
      ['unknown_source', trigger({ kind: 'telegram' as never, source: 'telegram' as never }), {}],
    ]
    const seen = new Set<string>()
    for (const [reason, item, value] of cases) {
      expect(gate(item, settings(value)).reason, `${reason} for ${item.kind}`).toBe(reason)
      seen.add(reason)
    }
    // Every reason the panel can be asked to word is one the gate can actually produce — no unreachable code in the
    // vocabulary of refusals, and no refusal without a wording.
    expect([...seen].sort()).toEqual(Object.keys(GATE_REASONS).sort())
  })

  it('refuses a Trigger of a kind it has no rule for, rather than falling through to another Source\'s rules', () => {
    const verdict = gate(trigger({ kind: 'telegram' as never, source: 'telegram' as never }), settings())
    expect(verdict).toMatchObject({ allow: false, reason: 'unknown_source' })
    expect(verdict.detail).toContain('telegram')
  })

  it('lets a pause outrank every other judgement, because nothing runs while paused', () => {
    const verdict = gate(trigger({ actor: { id: 'stranger', kind: 'person' } }), settings({ paused: true }))
    expect(verdict.reason).toBe('paused')
  })

  it('takes the scope from the request, then from the schedule, then from the default', () => {
    const cron = trigger({ kind: 'cron', source: 'cron', meta: { schedule: 'digest' } })
    const withSchedules = settings({ sources: { cron: { schedules: [schedule({ scope: '只读 ~/notes' })] } } })
    expect(gate(cron, withSchedules).scope).toBe('只读 ~/notes')
    // A scope written on the Trigger itself wins, which is how an inbox file's front matter narrows its own work.
    expect(gate({ ...cron, meta: { schedule: 'digest', scope: '只读这一个文件' } }, withSchedules).scope).toBe('只读这一个文件')
    expect(gate(cron, settings({ sources: { cron: { schedules: [schedule()] } } })).scope).toContain('own directory')
    // A schedule that is gone from the settings falls back rather than failing.
    expect(gate(cron, settings()).scope).toContain('own directory')
  })

  it('is a pure function: the same input gives the same verdict, and the Trigger is not changed', () => {
    const item = trigger({ meta: { scope: '窄一点' } })
    const before = JSON.stringify(item)
    const first = gate(item, settings())
    const second = gate(item, settings())
    expect(first).toEqual(second)
    expect(JSON.stringify(item)).toBe(before)
  })
})

type GateReasonOf = keyof typeof GATE_REASONS

describe('the policy version', () => {
  it('does not move for anything that is not about authorization', () => {
    const base = policyVersion(settings())
    expect(policyVersion(settings({ executor: { maxWorkers: 5, prepare: 'git init', model: 'a/b' } }))).toBe(base)
    expect(policyVersion(settings({ notify: { enabled: true } }))).toBe(base)
    expect(policyVersion(settings({ sources: { inbox: { pollMs: 60000 } } }))).toBe(base)
    // A schedule's display name is cosmetic; its id, request, scope, timing and enabled flag are not.
    const withSchedule = settings({ sources: { cron: { schedules: [schedule()] } } })
    const renamed = settings({ sources: { cron: { schedules: [schedule({ name: '换了个名字' })] } } })
    expect(policyVersion(renamed)).toBe(policyVersion(withSchedule))
    expect(policyVersion(settings({ paused: true }))).toBe(base)
  })

  it('moves for everything that decides whether work may run', () => {
    const base = policyVersion(settings())
    expect(policyVersion(settings({ acceptMode: 'observe' }))).not.toBe(base)
    expect(policyVersion(settings({ allowedSenders: ['operator', 'alice'] }))).not.toBe(base)
    expect(policyVersion(settings({ sources: { inbox: { enabled: false } } }))).not.toBe(base)
    expect(policyVersion(settings({ sources: { session: { enabled: false } } }))).not.toBe(base)
    expect(policyVersion(settings({ sources: { cron: { schedules: [schedule()] } } }))).not.toBe(base)
    // The request text is the authorization, so editing it is a new policy.
    const one = settings({ sources: { cron: { schedules: [schedule()] } } })
    const two = settings({ sources: { cron: { schedules: [schedule({ prompt: '写明天的摘要' })] } } })
    expect(policyVersion(two)).not.toBe(policyVersion(one))
  })

  it('does not care what order the allowed senders or the schedules are written in', () => {
    expect(policyVersion(settings({ allowedSenders: ['alice', 'operator'] })))
      .toBe(policyVersion(settings({ allowedSenders: ['operator', 'alice'] })))
    const a = settings({ sources: { cron: { schedules: [schedule({ id: 'aaa' }), schedule({ id: 'zzz' })] } } })
    const b = settings({ sources: { cron: { schedules: [schedule({ id: 'zzz' }), schedule({ id: 'aaa' })] } } })
    expect(policyVersion(a)).toBe(policyVersion(b))
  })

  it('is short enough to carry on every Mandate', () => {
    expect(policyVersion(settings())).toHaveLength(16)
  })
})

describe('what a settings change does to work already authorized', () => {
  const mandate = (over: Partial<Mandate> = {}): Mandate => ({
    policyVersion: 'v1', scope: '在本目录工作', strength: 'explicit',
    sender: { id: 'operator', kind: 'person' }, via: 'inbox', at: '2026-11-03T01:00:00.000Z', ...over,
  })

  it('holds while the sender is still allowed, and says why once they are not', () => {
    expect(settingsPolicy(settings()).revalidate(mandate())).toMatchObject({ holds: true })
    const after = settingsPolicy(settings({ allowedSenders: ['someone-else'] }))
    expect(after.revalidate(mandate())).toMatchObject({ holds: false, reason: 'sender_not_allowed' })
    expect(after.revalidate(mandate()).detail).toContain('operator')
  })

  it('keeps a Mandate holding while processing is paused, because a pause holds execution rather than withdrawing it', () => {
    expect(settingsPolicy(settings({ paused: true })).revalidate(mandate())).toMatchObject({ holds: true })
  })

  it('bears only on Tickets that are still open', () => {
    const before = settings()
    const after = settings({ allowedSenders: ['someone-else'] })
    const effects = policyEffects([
      { id: 'open', mandate: mandate() },
      { id: 'ended', mandate: mandate(), ended: { at: 'x', by: 'agent', outcome: 'done', reason: 'ready' } },
    ], before, after)
    expect(effects).toEqual([{ ticketId: 'open', reason: 'sender_not_allowed', detail: 'operator may no longer start work here' }])
  })

  it('says nothing when the version did not move, so a Ticket is not told about a change that does not concern it', () => {
    expect(policyEffects([{ id: 'open', mandate: mandate() }], settings(), settings({ executor: { maxWorkers: 7 } }))).toEqual([])
  })
})

describe('a schedule whose zone the platform does not know', () => {
  // Everything downstream assumes the zone parses: `nextRun` throws on an unknown one, and that throw escaped
  // `start()` uncontained. Validating it here turns a settings typo into a refused save instead of a deployment
  // with no Sources at all.
  const withZone = (timeZone: string) => parseSettings({
    sources: { cron: { enabled: true, schedules: [{
      id: 'zoned', name: '带时区', enabled: true, prompt: '做点事',
      timing: { kind: 'daily', time: '09:00', timeZone },
    }] } },
  })

  it('refuses a zone that is not a zone', () => {
    expect(() => withZone('Mars/Olympus')).toThrow(/zone needs a name the platform knows/)
  })

  it('accepts a real zone, including the alias names the platform still answers to', () => {
    expect(withZone('Asia/Shanghai').sources.cron.schedules[0]!.timing).toMatchObject({ timeZone: 'Asia/Shanghai' })
    expect(withZone('UTC').sources.cron.schedules[0]!.timing).toMatchObject({ timeZone: 'UTC' })
  })
})

describe('a Source that sets its own policy', () => {
  const triggerOf = (kind: 'cron' | 'inbox' | 'session', id: string): Trigger => ({
    id, source: kind, kind, at: '2026-11-03T00:00:00.000Z',
    actor: { id: 'operator', kind: 'person' }, text: '做点事', title: '一件事',
  })

  it('observes what its own mode names, independently of every other Source', () => {
    const current = settings({ acceptMode: 'auto', sources: { inbox: { enabled: true, acceptMode: 'observe' } } })
    expect(gate(triggerOf('inbox', 'i1'), current)).toMatchObject({ allow: true, observe: true, reason: 'observed' })
    expect(gate(triggerOf('cron', 'c1'), current)).toMatchObject({ allow: true, observe: false, reason: 'accepted' })
    expect(gate(triggerOf('session', 's1'), current)).toMatchObject({ allow: true, observe: false, reason: 'accepted' })
  })

  it('honours its own sender list, and falls back to the global one when it has none', () => {
    const current = settings({ allowedSenders: ['operator'], sources: { session: { enabled: true, allowedSenders: ['alice'] } } })
    expect(gate(triggerOf('session', 's1'), current)).toMatchObject({ allow: false, reason: 'sender_not_allowed' })
    expect(gate({ ...triggerOf('session', 's2'), actor: { id: 'alice', kind: 'person' } }, current))
      .toMatchObject({ allow: true, reason: 'accepted' })
    // The other Sources still use the global list, which is the point of a fallback rather than a replacement.
    expect(gate(triggerOf('inbox', 'i1'), current)).toMatchObject({ allow: true, reason: 'accepted' })
  })

  it('moves the policy version for a Source’s mode, and never for its pause', () => {
    const base = policyVersion(settings())
    // A mode is authorization: tightening one Source has to reach the Tickets it already accepted.
    expect(policyVersion(settings({ sources: { inbox: { enabled: true, acceptMode: 'observe' } } }))).not.toBe(base)
    expect(policyVersion(settings({ sources: { cron: { enabled: true, allowedSenders: ['alice'] } } }))).not.toBe(base)
    // A pause holds work; it does not withdraw the authorization to do it. Counting it would stamp a policy-change
    // note onto every live Ticket of a paused Source and say the opposite of what happened.
    expect(policyVersion(settings({ sources: { inbox: { enabled: true, paused: true } } }))).toBe(base)
    expect(policyVersion(settings({ paused: true }))).toBe(base)
  })
})

describe('a Source that is denied rather than switched off', () => {
  const triggerOf = (kind: 'cron' | 'inbox', id: string, actor: { id: string; kind: 'person' | 'system' } = { id: 'operator', kind: 'person' }): Trigger => ({
    id, source: kind, kind, at: '2026-11-03T00:00:00.000Z', actor, text: '做点事', title: '一件事',
  })

  it('refuses at the gate and says it was denied, which is a different fact from being switched off', () => {
    const denied = settings({ sources: { inbox: { enabled: true, deny: true } } })
    expect(gate(triggerOf('inbox', 'i1'), denied)).toMatchObject({ allow: false, reason: 'source_disabled' })
    expect(gate(triggerOf('inbox', 'i1'), denied).detail).toContain('denied')
    // The Source is still on, so the other Sources are unaffected and this one is still reading.
    expect(gate(triggerOf('cron', 'c1'), denied)).toMatchObject({ allow: true, reason: 'accepted' })
  })

  it('admits a system actor only for a Source that was told it may originate work nobody wrote', () => {
    const system = triggerOf('cron', 'c1', { id: 'watchdog', kind: 'system' })
    expect(gate(system, settings())).toMatchObject({ allow: false, reason: 'system_actor' })
    // The switch alone is not enough: the actor still has to be named on the list of who may originate work. Admitting
    // "any system actor" would make one setting worth any number of unidentified producers, and the list is the place
    // where a person already decides who may ask for things.
    expect(gate(system, settings({ sources: { cron: { enabled: true, allowSystemActors: true } } })))
      .toMatchObject({ allow: false, reason: 'sender_not_allowed' })
    const allowed = settings({
      allowedSenders: ['operator', 'watchdog'],
      sources: { cron: { enabled: true, allowSystemActors: true } },
    })
    expect(gate(system, allowed)).toMatchObject({ allow: true, reason: 'accepted' })
    // Turning it on for one Source does not turn it on for another.
    expect(gate(triggerOf('inbox', 'i1', { id: 'watchdog', kind: 'system' }), allowed))
      .toMatchObject({ allow: false, reason: 'system_actor' })
  })

  it('moves the policy version for both, because both change who may originate work', () => {
    const base = policyVersion(settings())
    expect(policyVersion(settings({ sources: { inbox: { enabled: true, deny: true } } }))).not.toBe(base)
    expect(policyVersion(settings({ sources: { cron: { enabled: true, allowSystemActors: true } } }))).not.toBe(base)
  })
})

describe('a fourth Source kind is visible to every call site', () => {
  // Two call sites each enumerated three kinds, and adding the rule Source made both wrong in a way no type check can
  // see: the gate read the SESSION block's `enabled` for a rule Trigger, and the policy version did not move for any
  // rule knob at all. Both now derive the kind list from the settings document instead of writing it out.
  const ruleTrigger: Trigger = {
    id: 'r1', source: 'rule', kind: 'rule', at: '2026-11-03T00:00:00.000Z',
    actor: { id: 'digest-done', kind: 'system' }, text: '做点事', title: '一件事',
  }
  const ruleSettings = (rule: Record<string, unknown>, session: Record<string, unknown> = {}) => settings({
    acceptMode: 'auto', allowedSenders: ['operator', 'digest-done'],
    sources: { rule: { enabled: true, allowSystemActors: true, ...rule }, session: { enabled: true, ...session } },
  })

  it('moves the policy version for every rule knob, exactly as it does for the other Sources', () => {
    const base = policyVersion(ruleSettings({}))
    for (const knob of [{ deny: true }, { allowSystemActors: false }, { acceptMode: 'observe' }, { allowedSenders: ['nobody'] }]) {
      expect(policyVersion(ruleSettings(knob)), `${JSON.stringify(knob)} did not move the version`).not.toBe(base)
    }
  })

  it('reads the rule Source’s own enabled flag rather than the session one', () => {
    // Disabling the session Source used to disable the rule Source too — and to say so in the refusal detail, which is
    // a false statement written into the audit record rather than merely a wrong verdict.
    expect(gate(ruleTrigger, ruleSettings({}, { enabled: false }))).toMatchObject({ allow: true, via: 'rule' })
    const refused = gate(ruleTrigger, ruleSettings({ enabled: false }))
    expect(refused).toMatchObject({ allow: false, reason: 'source_disabled' })
    expect(refused.detail).toContain('rule')
    expect(refused.detail).not.toContain('session')
  })
})

describe('the triage switch (S3b)', () => {
  it('ships off, so nobody pays for a judge they did not ask for', () => {
    // 【B1 产品变更】triage 多了 desk。旧值：{ enabled: false }。默认仍是专职分诊台（B2）。
    // 【triage.sources 产品变更】默认只判 chat。旧值：{ enabled: false, desk: 'dedicated' }，
    // 而 inbox/cron 在代码里写死为可判（TRIAGED_SOURCES）。改成可配且默认收窄，理由见 policy.ts 的注释：
    // 排期是操作者自己立的长期指令、inbox 是他亲手写的请求，判它们等于花一次总管轮次重判已判过的事，
    // 而判错就把他要的活丢了。
    expect(parseSettings({}).triage).toEqual({ enabled: false, desk: 'dedicated', sources: ['chat'] })
    expect(parseSettings({ triage: { enabled: true } }).triage.enabled).toBe(true)
  })

  it('takes the triageable kinds and refuses one it has no judge for', () => {
    expect(parseSettings({ triage: { sources: ['chat', 'inbox', 'cron'] } }).triage.sources)
      .toEqual(['chat', 'inbox', 'cron'])
    expect(parseSettings({ triage: { sources: [] } }).triage.sources).toEqual([])
    // A kind with no intake path (`session`, `rule`) is refused rather than silently never matching: a setting whose
    // value can never take effect reads as a choice the operator made.
    expect(() => parseSettings({ triage: { sources: ['session'] } })).toThrowError(/sources/)
  })

  /**
   * 【B1 产品变更】这条测试原先断言 `desk` **被拒绝**，因为它那时是个不能取另一个值的旋钮——
   * 旧断言：`expect(() => parseSettings({ triage: { enabled: true, desk: 'main' } })).toThrowError(/desk/)`。
   *
   * 现在 B1 真的实现了（`myagent_close_ticket` 是它缺的那块），所以断言换成"两个值都收，第三个值拒"。
   * 原来那条的理由仍然成立，只是被满足了：**一个不能取另一个值的开关比没有开关更糟**，
   * 因为它读起来像操作者做过的选择，而两个值行为相同。
   */
  it('takes both desks and refuses a third, now that the second one actually works', () => {
    expect(parseSettings({ triage: { enabled: true, desk: 'main' } }).triage.desk).toBe('main')
    expect(parseSettings({ triage: { enabled: true, desk: 'dedicated' } }).triage.desk).toBe('dedicated')
    expect(() => parseSettings({ triage: { desk: 'whoever' } })).toThrowError(/desk/)
  })

  it('does not move the policy version, because routing a future request invalidates no authorization', () => {
    const base = settings({})
    expect(policyVersion(settings({ triage: { enabled: true } }))).toBe(policyVersion(base))
    expect(policyVersion(settings({ triage: { enabled: true, sources: ['chat', 'inbox', 'cron'] } })))
      .toBe(policyVersion(base))
    // The contrast that makes the line above meaningful: something that DOES bear on authorization moves it.
    expect(policyVersion(settings({ allowedSenders: ['operator', 'alice'] }))).not.toBe(policyVersion(base))
  })
})

describe('the triage predicate itself (S3b)', () => {
  /**
   * The same rule the engine-level test asserts, observed one layer down: the predicate rather than the Assignment it
   * eventually produces.
   *
   * It exists because 0.8 found the engine assertion to be the ONLY guard on the depth condition, and the reason is
   * worth stating rather than papering over: `createTicket` synthesizes a `session` Trigger and a rule chain produces
   * `rule` Triggers, so **no code today produces `source: chat|inbox|cron` together with `depth > 0`** — the depth
   * condition is defense in depth for a combination that does not occur yet. A predicate-level test is the honest
   * second guard for a rule that is currently unreachable end to end: it pins the rule now, so the day something does
   * produce that combination, the guard is already known to work.
   */
  const trigger = (over: Record<string, unknown> = {}): Trigger => ({
    id: 'trigger-1', source: 'chat', kind: 'chat', at: '2026-11-07T08:00:00.000Z',
    actor: { id: 'alice', kind: 'person' }, text: '现在有几张在跑？', title: '巡视', ...over,
  } as Trigger)

  it('triages a person’s words from a Source, and nothing else', () => {
    const on = settingsPolicy(settings({ triage: { enabled: true } }))
    expect(on.triage(trigger())).toBe(true)
    // 【triage.sources 产品变更】inbox 与 cron 默认**不**判。旧断言两条都是 toBe(true)。
    // 收窄的理由：排期与 inbox 是操作者自己下的指令，再判一次是白花一轮，判错则丢掉他要的活。
    expect(on.triage(trigger({ source: 'inbox', kind: 'inbox' }))).toBe(false)
    expect(on.triage(trigger({ source: 'cron', kind: 'cron' }))).toBe(false)
    // And they come back the moment the operator asks for them — the knob has two real values.
    const all = settingsPolicy(settings({ triage: { enabled: true, sources: ['chat', 'inbox', 'cron'] } }))
    expect(all.triage(trigger({ source: 'inbox', kind: 'inbox' }))).toBe(true)
    expect(all.triage(trigger({ source: 'cron', kind: 'cron' }))).toBe(true)
    // An empty list judges nothing, even with the switch on.
    const none = settingsPolicy(settings({ triage: { enabled: true, sources: [] } }))
    expect(none.triage(trigger())).toBe(false)
    // Already in the room, or already decided.
    expect(on.triage(trigger({ source: 'session', kind: 'session' }))).toBe(false)
    expect(on.triage(trigger({ source: 'rule', kind: 'rule' }))).toBe(false)
    // Defense in depth: a Ticket the desk opened must never be triaged again.
    expect(on.triage(trigger({ meta: { depth: 1 } }))).toBe(false)
    expect(on.triage(trigger({ meta: { depth: 0 } }))).toBe(true)
    // Off means off, for every source.
    const off = settingsPolicy(settings({}))
    expect(off.triage(trigger())).toBe(false)
  })

  /**
   * Second lock on `sources`, from the other direction: the predicate matches on the Trigger's KIND, not its Source
   * INSTANCE id. Those coincide for the three built-ins, so a `source`-based test cannot tell them apart — and a
   * second instance of one kind (a second chat channel configured as its own Source) would silently stop matching.
   */
  it('decides by the Source kind, so a second instance of a kind is judged the same way', () => {
    const on = settingsPolicy(settings({ triage: { enabled: true } }))
    // Same kind, a different instance id: still triaged.
    expect(on.triage(trigger({ source: 'chat-second-room', kind: 'chat' }))).toBe(true)
    // An instance id that happens to name a triageable kind, on a kind that is not one: not triaged.
    expect(on.triage(trigger({ source: 'inbox', kind: 'session' }))).toBe(false)
  })
})
