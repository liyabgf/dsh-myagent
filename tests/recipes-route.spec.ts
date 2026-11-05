/**
 * The recipes route: the panel's template picker, fed from the same files a person would copy by hand.
 *
 * One text of each recipe is the point. If the panel carried its own copy, the shipped example, the test that keeps it
 * valid, and the thing the operator actually clicks would drift apart — and the drift shows up as a task that fails in
 * a way nobody can explain from what they see on screen.
 */
import { describe, expect, it } from 'vitest'
import { api, deployment } from './helpers/deployment.ts'

describe('GET /api/recipes', () => {
  it('offers the shipped request file as something a person can start from', async () => {
    const context = await deployment('observe')
    try {
      const { json } = await context.host.request(api('recipes'))
      // The stub answers a JSON object; the shape this route returns is asserted below, not by the compiler.
      const recipes = json as unknown as { name: string; kind: string; title?: string; text?: string; scope?: string }[]
      const request = recipes.find(recipe => recipe.name === 'data-report.md')
      expect(request).toBeDefined()
      expect(request).toMatchObject({ kind: 'request', title: '月度数据报表' })
      // The front matter is metadata for the intake path, not part of what the worker is asked to do.
      expect(request!.text).not.toContain('---')
      expect(request!.text).toContain('合成一份月度报表')
      expect(request!.scope).toContain('只读')
    } finally { await context.runtime.stop() }
  })

  it('offers the shipped settings file as a schedule the panel can prefill', async () => {
    const context = await deployment('observe')
    try {
      const { json } = await context.host.request(api('recipes'))
      const recipes = json as unknown as { name: string; kind: string; schedule?: Record<string, unknown> }[]
      const settings = recipes.find(recipe => recipe.name === 'daily-digest.json')
      expect(settings).toMatchObject({ kind: 'settings' })
      expect(settings!.schedule).toMatchObject({ id: 'daily-digest', enabled: true })
      expect((settings!.schedule!.prompt as string).length).toBeGreaterThan(200)
      expect(settings!.schedule!.timing).toMatchObject({ kind: 'daily', time: '09:00' })
    } finally { await context.runtime.stop() }
  })

  it('lists them in a stable order, so the picker does not move between refreshes', async () => {
    const context = await deployment('observe')
    try {
      const first = await context.host.request(api('recipes'))
      const second = await context.host.request(api('recipes'))
      const names = (body: unknown) => (body as unknown as { name: string }[]).map(recipe => recipe.name)
      expect(names(first.json)).toEqual(names(second.json))
      expect(names(first.json)).toEqual([...names(first.json)].sort())
      expect(names(first.json).length).toBeGreaterThanOrEqual(2)
    } finally { await context.runtime.stop() }
  })

  it('is behind the same fence as every other route', async () => {
    const context = await deployment('observe')
    try {
      // Explicit headers replace the panel's own, which is how a request the fence must refuse is sent.
      const response = await context.host.request(api('recipes'), { headers: { host: '127.0.0.1:3080' } })
      expect(response.status).toBe(403)
      expect(response.json.error).toContain('same-origin')
    } finally { await context.runtime.stop() }
  })
})
