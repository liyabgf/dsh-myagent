/**
 * Prose that names the tool surface must not drift from the code that registers it.
 *
 * This is not a hypothetical. `src/app/tools.ts`'s own header said "A worker gets ONE tool" for eleven rounds after
 * that stopped being true — and the header said so itself, in a sentence added when the drift was finally caught. It
 * then said "three tools", which was true for a while and then quietly stopped being true again (the count is six).
 * `docs/v2/07-modules-and-capabilities.md` C214 named the missing half of the fix precisely: not "correct the prose",
 * but "a test that asserts the prose names the tools".
 *
 * So the assertion is about COVERAGE, not about wording: every tool registered on a worker must be named somewhere in
 * `prompts/worker.md`, and every tool the prompt names must actually exist. Both directions, because a prompt that
 * advertises a tool the worker does not have is the same class of lie as one that hides a tool it does.
 *
 * Deliberately NOT asserted: the exact sentence, the order, or any count. A count in prose is the thing that drifts,
 * which is why the header now names tools instead of counting them.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { workerTools, type Tool, type ToolsHost } from '../src/app/tools.ts'
import { Memory } from '../src/core/memory.ts'
import { Engine } from '../src/core/engine.ts'
import { settingsPolicy, parseSettings } from '../src/core/policy.ts'

const WORKER_PROMPT = readFileSync(join(import.meta.dirname, '..', 'prompts', 'worker.md'), 'utf8')

const host = (): ToolsHost => {
  const memory = new Memory()
  const settings = parseSettings({ acceptMode: 'auto' })
  const engine = new Engine({
    repos: memory, tx: memory, policy: () => settingsPolicy(settings),
    executor: { prepare: (t: unknown) => t, start: () => {}, deliver: async () => {}, stop: async () => {} } as never,
    delivery: { report: () => {} } as never,
  })
  return {
    engine, store: memory, acceptMode: () => settings.acceptMode,
    attempt: () => undefined,
    readArtifact: async () => ({ ok: false as const, error: 'stub' }),
    returnAddressOf: () => undefined,
    replyToRequester: () => ({ sent: false }),
    promoteSkill: async () => ({ ok: false as const, error: 'stub' }),
    raiseDecision: () => 'decision-1',
    askDesk: () => ({ sent: false }),
  } as unknown as ToolsHost
}

const registered = (): Tool[] => {
  const ticket = {
    id: 'ticket-1', title: 'x', assignments: [], inputs: [], notes: [], attachments: [],
    mandate: { policyVersion: 'v', scope: 's', strength: 'explicit', sender: { id: 'operator', kind: 'person' },
      via: 'session', at: '' },
    origin: { triggerId: 't' }, createdAt: '',
  } as never
  return workerTools(host(), ticket)
}

describe('the worker prompt and the worker tool surface say the same thing', () => {
  const tools = registered()
  const names = tools.map(tool => tool.name)

  it('registers the tools this suite was written against, so a rename cannot pass silently', () => {
    // 第二把锁（换角度）：下面两条断言是"互相覆盖"，而互相覆盖在一边整个空掉时会双双通过。
    // 钉住清单本身，才能让"少注册了一个工具"表现为红，而不是表现为两条空断言的绿。
    expect(names.sort()).toEqual([
      'myagent_ask_desk', 'myagent_handback', 'myagent_note_ticket',
      'myagent_raise_decision', 'myagent_read_artifact', 'myagent_report',
    ])
  })

  it('names every registered tool in prompts/worker.md', () => {
    const unnamed = names.filter(name => !WORKER_PROMPT.includes(name))
    expect(unnamed, 'worker.md must name every tool the worker actually has').toEqual([])
  })

  it('names no tool the worker does not have', () => {
    // Every `myagent_*` token the prompt mentions must be a real registered tool — except the desk's own
    // `myagent_close_ticket`, which worker.md mentions only to explain that closing a triage Ticket is the
    // desk's move and not the worker's.
    const mentioned = [...new Set(WORKER_PROMPT.match(/myagent_[a-z_]+/g) ?? [])]
    const invented = mentioned.filter(name => !names.includes(name) && name !== 'myagent_close_ticket')
    expect(invented, 'worker.md advertises tools the worker does not have').toEqual([])
  })

  it('does not state a count of the worker tools anywhere in tools.ts prose', () => {
    // The drift this file exists to prevent was a NUMBER going stale ("one tool", then "three tools").
    // Naming tools cannot go stale silently — a renamed tool fails the assertion above. So forbid the shape
    // that does: a count of tools asserted in prose inside the file that registers them.
    const source = readFileSync(join(import.meta.dirname, '..', 'src', 'app', 'tools.ts'), 'utf8')
    const countClaims = source.match(/gets (one|two|three|four|five|six|seven|\d+) tools?/gi) ?? []
    expect(countClaims, 'tools.ts must name its tools, not count them').toEqual([])
  })
})
