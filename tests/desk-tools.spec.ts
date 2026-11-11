/**
 * desk-tools: ToolSchema projection + tool call execution.
 * Verifies the schema is pure JSON and the execution path doesn't throw on unknown tools.
 */
import { describe, expect, it } from 'vitest'
import { deskToolSchemas, executeDeskToolCalls } from '../src/app/desk-tools.ts'
import { stubHost, type StubHost } from './helpers/host.ts'

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
