/**
 * 【G-5】A worker that goes quiet must become VISIBLE without being touched — and must stop being visible
 * when it is over.
 *
 * The live deployment caught the second half the hard way: the visibility was written to the health board as a
 * `problem`, nothing ever cleared it, and after the Ticket was stopped the red line stayed on the board. That is the
 * S38/S41 permanent false alarm in its exact original shape, and `tests/watchdog.spec.ts` could not have caught it —
 * that file tests the Watchdog against a STUB host, so the runtime's own health writing was never exercised.
 *
 * So this file drives the real timer and asserts the shape the operator asked for: the DECISION QUEUE carries it
 * (it is a thing he decides), the HEALTH BOARD does not (a thing that happened is not a thing happening).
 *
 * It costs one `watchdog.everyMs` tick, which the settings schema floors at 10 s — that is the price of driving the
 * real timer instead of a stub, and it is what makes this the test that catches a health line coming back.
 */
import { describe, expect, it } from 'vitest'
import { deployment } from './helpers/deployment.ts'
import { wait } from './helpers/host.ts'

/** Turn the watchdog's interval down to nothing so a pass happens inside the test. */
const armFast = (runtime: { saveSettings: (settings: unknown) => void }): void => {
  runtime.saveSettings({
    acceptMode: 'auto',
    watchdog: { enabled: true, everyMs: 10_000, silentMs: 1, launchStuckMs: 600_000, maxActions: 2 },
  })
}

describe('a silent worker is visible in the queue and absent from the board', () => {
  it('raises one decision and leaves no health problem behind', async () => {
    const { runtime } = await deployment('auto')
    try {
      const made = runtime.engine.createTicket({ title: '安静的任务', text: '做点事' })
      const ticketId = made.ticketId!
      armFast(runtime as never)
      // Started, then nothing: the honest reading is "silent since it started".
      runtime.engine.assignmentStarted(ticketId, runtime.engine.require(ticketId).assignments[0]!.id)

      // Let the real timer fire. Bounded, and generous against a loaded machine.
      for (let i = 0; i < 320; i++) {
        if (runtime.decisions().some(item => item.source === 'watchdog-silent')) break
        await wait(50)
      }

      const raised = runtime.decisions().filter(item => item.source === 'watchdog-silent')
      expect(raised.length, 'the queue must hear about it exactly once').toBe(1)
      expect(raised[0]!.title).toContain('静默')

      // The board is "right now". A silence report is a past event with a decision attached to it, so putting it
      // there leaves a line that survives the Ticket — which is what the live run showed.
      const entries = runtime.health.problems().map(problem => problem.detail).join('\n')
      expect(entries, 'the health board must not carry a silence report').not.toContain('静默')
    } finally { await runtime.stop() }
  }, 25_000)   // one watchdog tick, which the settings schema floors at 10 s
})
