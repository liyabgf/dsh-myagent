/**
 * One Ticket waiting for another.
 *
 * The wait is expressed as a deferral, never as a failure: five failed attempts would end the Ticket with a report
 * nobody asked for, and a dependency that takes a day would look exactly like a broken launch. These tests are the
 * reason `Later` is honoured when it is thrown rather than returned — before that fix, waiting was indistinguishable
 * from failing.
 */
import { describe, expect, it } from 'vitest'
import { deployment, type Deployment } from './helpers/deployment.ts'

const wait = (ms: number): Promise<void> => new Promise(resolve => setTimeout(resolve, ms))

/** Let the pump run its passes, which is what a deployment does on its own every two seconds. */
async function settle(context: Deployment, times = 3): Promise<void> {
  for (let pass = 0; pass < times; pass++) {
    await context.runtime.nudge()
    await wait(40)
  }
}

async function withDeployment(run: (context: Deployment) => Promise<void>): Promise<void> {
  const context = await deployment('auto')
  try { await run(context) } finally { await context.runtime.stop() }
}

describe('a Ticket that waits for another', () => {
  it('does not launch until the one it waits for has finished, and the wait costs it nothing', async () => {
    await withDeployment(async context => {
      const { engine } = context.runtime
      const upstream = engine.createTicket({ title: '先做这个', text: '做点事' })
      const downstream = engine.createTicket({ title: '再做这个', text: '做点事' })
      engine.dependOn(downstream.ticketId!, upstream.ticketId!)
      // More passes than the retry budget, so a wait implemented as failures would have given up by now.
      await settle(context, 8)

      expect(engine.require(upstream.ticketId!).assignments.at(-1)!.state).toBe('running')
      const waiting = engine.require(downstream.ticketId!).assignments.at(-1)!
      expect(waiting.state).toBe('pending')
      // Nothing was reported, nobody was told, and the health board is clean: the Ticket is early, not broken.
      expect(waiting.report).toBeUndefined()
      expect(engine.require(downstream.ticketId!).ended).toBeUndefined()
      expect(context.runtime.health.problems()).toEqual([])

      engine.report(upstream.ticketId!, { state: 'ready', summary: '做完了' })
      await settle(context)
      // The release is prompt: ending the upstream re-queues the waiting launch instead of letting it wait out a
      // deferral interval.
      expect(engine.require(downstream.ticketId!).assignments.at(-1)!.state).toBe('running')
    })
  })

  it('releases on any ending when asked to, and only on success when asked for that', async () => {
    await withDeployment(async context => {
      const { engine } = context.runtime
      const upstream = engine.createTicket({ title: '会放弃的一张', text: '做点事' })
      const cleanup = engine.createTicket({ title: '无论如何都要收尾', text: '做点事' })
      const followUp = engine.createTicket({ title: '只有成功了才继续', text: '做点事' })
      engine.dependOn(cleanup.ticketId!, upstream.ticketId!, 'ended')
      engine.dependOn(followUp.ticketId!, upstream.ticketId!, 'done')
      await settle(context)

      engine.assignmentStarted(upstream.ticketId!, engine.require(upstream.ticketId!).assignments[0]!.id)
      engine.report(upstream.ticketId!, { state: 'dropped', summary: '没什么可做的' })
      await settle(context)

      // A cleanup runs either way; work that needed the result does not run on a Ticket that produced none.
      expect(engine.require(cleanup.ticketId!).assignments.at(-1)!.state).toBe('running')
      expect(engine.require(followUp.ticketId!).assignments.at(-1)!.state).toBe('pending')
      expect(engine.blockedBy(followUp.ticketId!)).toHaveLength(1)
    })
  })

  it('refuses an edge that would make a Ticket wait for itself, and writes nothing', async () => {
    await withDeployment(async context => {
      const { engine } = context.runtime
      const first = engine.createTicket({ title: '第一张', text: '做点事' })
      const second = engine.createTicket({ title: '第二张', text: '做点事' })
      expect(() => engine.dependOn(first.ticketId!, first.ticketId!)).toThrow(/wait for itself/)
      engine.dependOn(second.ticketId!, first.ticketId!)
      // Closing the loop the other way round is the case a self-edge check on its own would miss.
      expect(() => engine.dependOn(first.ticketId!, second.ticketId!)).toThrow(/wait for itself/)
      expect(engine.blockedBy(first.ticketId!)).toEqual([])
      expect(engine.dependantsOf(first.ticketId!).map(edge => edge.downstream)).toEqual([second.ticketId])
    })
  })

  it('leaves no edge behind when the transaction that wrote it rolls back', async () => {
    await withDeployment(async context => {
      const { engine, store } = context.runtime
      const first = engine.createTicket({ title: '第一张', text: '做点事' })
      const second = engine.createTicket({ title: '第二张', text: '做点事' })
      expect(() => store.atomic(() => {
        engine.dependOn(second.ticketId!, first.ticketId!)
        throw new Error('整批操作失败')
      })).toThrow('整批操作失败')
      expect(engine.blockedBy(second.ticketId!)).toEqual([])
      expect(engine.history(second.ticketId!).map(event => event.type)).not.toContain('dependency')
    })
  })

  it('records the wait in the Ticket’s history, because a Ticket that never starts has to explain itself', async () => {
    await withDeployment(async context => {
      const { engine } = context.runtime
      const first = engine.createTicket({ title: '第一张', text: '做点事' })
      const second = engine.createTicket({ title: '第二张', text: '做点事' })
      engine.dependOn(second.ticketId!, first.ticketId!)
      expect(engine.history(second.ticketId!).map(event => event.type)).toContain('dependency')
      expect(engine.history(second.ticketId!).at(-1)!.detail).toMatchObject({ upstream: first.ticketId, on: 'done' })
      // And undoing it is recorded too, so the history does not claim a wait that is no longer there.
      engine.dropDependency(second.ticketId!, first.ticketId!)
      expect(engine.blockedBy(second.ticketId!)).toEqual([])
      expect(engine.history(second.ticketId!).filter(event => event.type === 'dependency')).toHaveLength(2)
    })
  })
})
