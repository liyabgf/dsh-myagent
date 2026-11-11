/**
 * Every tool this bundle registers must hand DSH a parameters object that survives
 * `snapshotJsonValue` — DSH projects each tool's schema when it binds the tool family, and a single
 * non-JSON value (undefined, function, symbol, NaN, -0, or a cycle) makes the projection throw:
 *
 *   tool "myagent_create_ticket" parameters must be lossless JSON before schema projection
 *
 * That throw is not local to the offending tool: it happens while the family is being projected, so
 * ONE bad declaration took down every myagent tool for the Session — including the desk's ability to
 * close a triage Ticket and a worker's ability to report. A production run sat in that state for days
 * with a green health board, because nothing in myagent exercised the projection; only the host does.
 *
 * So this file walks the same rules as `packages/util/values`'s walkJsonValue, over the real
 * definitions produced by `definitionOf`, for every tool on both Session kinds.
 */
import { describe, expect, it } from 'vitest'
import { definitionOf, mainTools, workerTools, type Tool, type ToolsHost } from '../src/app/tools.ts'
import { Memory } from '../src/core/memory.ts'
import { Engine } from '../src/core/engine.ts'
import { settingsPolicy, parseSettings } from '../src/core/policy.ts'

/** The same lossless-JSON rules DSH applies (walkJsonValue), reported by path so a failure names the field. */
function findNonJson(value: unknown, path: string, seen = new Set<object>()): string[] {
  if (value === undefined) return [`${path}: undefined`]
  if (value === null) return []
  const kind = typeof value
  if (kind === 'boolean' || kind === 'string') return []
  if (kind === 'number') {
    if (!Number.isFinite(value)) return [`${path}: non-finite number ${value}`]
    if (Object.is(value, -0)) return [`${path}: negative zero`]
    return []
  }
  if (kind !== 'object') return [`${path}: ${kind}`]   // function, symbol, bigint
  const obj = value as object
  if (seen.has(obj)) return [`${path}: cycle`]
  seen.add(obj)
  const symbols = Object.getOwnPropertySymbols(obj)
  if (symbols.length > 0) return [`${path}: ${symbols.length} symbol key(s)`]
  const out: string[] = []
  if (Array.isArray(obj)) {
    obj.forEach((item, index) => out.push(...findNonJson(item, `${path}[${index}]`, seen)))
  } else {
    for (const key of Object.keys(obj as Record<string, unknown>)) {
      out.push(...findNonJson((obj as Record<string, unknown>)[key], `${path}.${key}`, seen))
    }
  }
  seen.delete(obj)
  return out
}

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
    recall: () => [],
    settings: () => settings,
    engineView: () => ({}),
  } as unknown as ToolsHost
}

const allTools = (): { label: string; tool: Tool }[] => {
  const h = host()
  const ticket = { id: 'ticket-1', title: 'x', assignments: [], inputs: [], notes: [], attachments: [],
    mandate: { policyVersion: 'v', scope: 's', strength: 'explicit', sender: { id: 'operator', kind: 'person' }, via: 'session', at: '' },
    origin: { triggerId: 't' }, createdAt: '', updatedAt: '' } as never
  return [
    ...mainTools(h).map(tool => ({ label: `main/${tool.name}`, tool })),
    ...workerTools(h, ticket).map(tool => ({ label: `worker/${tool.name}`, tool })),
  ]
}

describe('every registered tool hands DSH lossless JSON parameters', () => {
  it('projects without the error that takes down the whole tool family', () => {
    const tools = allTools()
    expect(tools.length).toBeGreaterThan(5)
    for (const { label, tool } of tools) {
      const definition = definitionOf(tool)
      const problems = findNonJson(definition.parameters, 'parameters')
      expect(problems, `${label} parameters are not lossless JSON`).toEqual([])
      // The output schema is projected too; a bad one breaks the family the same way.
      expect(findNonJson(definition.output.schema, 'output.schema'), `${label} output schema`).toEqual([])
    }
  })

  it('names every tool it checked, so a tool added without a schema cannot slip through unscanned', () => {
    const names = allTools().map(entry => entry.label).sort()
    // 第二把锁（换角度）：上面那条断言"没有坏值"，这条断言"该扫的都扫到了"。
    // 少注册一个工具，上面那条会静默通过——所以这里把清单钉住。
    expect(names).toContain('main/myagent_create_ticket')
    expect(names).toContain('main/myagent_close_ticket')
    expect(names).toContain('worker/myagent_report')
    expect(names).toContain('worker/myagent_ask_desk')
    expect(names).toContain('worker/myagent_handback')
    expect(names).toContain('worker/myagent_read_artifact')
  })
})
