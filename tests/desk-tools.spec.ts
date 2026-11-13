/**
 * desk-tools: ToolSchema projection + tool call execution.
 * Verifies the schema is pure JSON and the execution path doesn't throw on unknown tools.
 */
import { describe, expect, it } from 'vitest'
import { DESK_GATE_TOOL_NAME, deskGateToolSchema, deskToolSchemas, executeDeskToolCalls } from '../src/app/desk-tools.ts'
import { stubHost } from './helpers/host.ts'
import { Store } from '../src/app/store.ts'
import type { ToolsHost } from '../src/app/tools.ts'
import { Engine, parseSettings, settingsPolicy } from '../src/core/index.ts'

function host() { return stubHost() as unknown as import('../src/app/tools.ts').ToolsHost }

describe('desk-tools', () => {
  it('produces a ToolSchema for every registered main tool', () => {
    const schemas = deskToolSchemas(host())
    expect(schemas.length).toBeGreaterThan(5)
    for (const s of schemas) {
      expect(typeof s.name).toBe('string')
      expect(typeof s.description).toBe('string')
      expect(s.parameters).toBeTypeOf('object')
      expect(s.parameters.type).toBe('object')
    }
  })

  it('every schema parameters is lossless JSON (no undefined values)', () => {
    const schemas = deskToolSchemas(host())
    for (const s of schemas) {
      const round = JSON.parse(JSON.stringify(s.parameters))
      expect(round).toEqual(s.parameters)
    }
  })

  it('executes myagent_list_tickets against a real Engine and Store with schema defaults', async () => {
    const store = new Store(':memory:')
    try {
      const settings = parseSettings({ acceptMode: 'auto', allowedSenders: ['operator'] })
      const engine = new Engine({
        repos: store, tx: store, policy: () => settingsPolicy(settings),
        executor: {
          prepare: ticket => ticket,
          start: (ticket, assignment) => { engine.assignmentStarted(ticket.id, assignment.id) },
          deliver: () => {},
          stop: () => {},
        },
        delivery: { report: () => {} },
        now: () => '2026-11-03T02:00:00.000Z',
      })
      const unexpectedIO = (): never => { throw new Error('this test does not exercise host IO') }
      const toolsHost: ToolsHost = {
        engine, store, acceptMode: () => settings.acceptMode,
        attempt: ticketId => store.tickets.get(ticketId)?.assignments.find(item => item.state === 'running')?.id,
        askDesk: unexpectedIO,
        readArtifact: unexpectedIO,
        raiseDecision: unexpectedIO,
        returnAddressOf: unexpectedIO,
        replyToRequester: unexpectedIO,
        promoteSkill: unexpectedIO,
      }
      const created = engine.createTicket({ title: 'Desk bridge success', text: 'List this real ticket' })
      expect(created.disposition.state).toBe('accepted')
      expect(created.ticketId).toBeTruthy()

      const results = await executeDeskToolCalls(
        [{ id: 'tc-list', name: 'myagent_list_tickets', arguments: '{}' }],
        toolsHost,
        new AbortController().signal,
      )

      expect(results).toHaveLength(1)
      expect(results[0]).toMatchObject({
        toolCallId: 'tc-list', name: 'myagent_list_tickets', isError: false,
      })
      expect(JSON.parse(results[0]!.content)).toMatchObject({
        count: 1, state: 'open',
        tickets: [{ id: created.ticketId, title: 'Desk bridge success' }],
      })
    } finally {
      store.close()
    }
  })

  it('executes an unknown tool call without throwing', async () => {
    const results = await executeDeskToolCalls(
      [{ id: 'tc-1', name: 'nonexistent_tool', arguments: '{}' }],
      host(),
      new AbortController().signal,
    )
    expect(results[0]!.isError).toBe(true)
    expect(results[0]!.content).toContain('Unknown tool')
  })

  it('executes a tool call with bad JSON arguments without throwing', async () => {
    const results = await executeDeskToolCalls(
      [{ id: 'tc-1', name: 'myagent_list_tickets', arguments: 'not-json' }],
      host(),
      new AbortController().signal,
    )
    expect(results[0]!.isError).toBe(true)
  })
})

/**
 * 【R3】Gateway tool schema: the lightweight zero-parameter tool that mounts the full toolset on demand.
 */
describe('deskGateToolSchema (R3)', () => {
  it('has the correct name and empty parameters', () => {
    const gate = deskGateToolSchema()
    expect(gate.name).toBe(DESK_GATE_TOOL_NAME)
    expect(gate.name).toBe('myagent_use_tools')
    expect(JSON.parse(JSON.stringify(gate.parameters))).toEqual({
      type: 'object', properties: {}, additionalProperties: false,
    })
  })

  it('is not in the full deskToolSchemas — it is the gateway, not a desk tool', () => {
    const names = deskToolSchemas(host() as unknown as import('../src/app/tools.ts').ToolsHost).map(s => s.name)
    expect(names).not.toContain(DESK_GATE_TOOL_NAME)
  })
})
