/**
 * The temporary-directory cleanup itself: a directory this suite makes dies with the test that made it.
 *
 * This is the guard behind the fix for `docs/v2/00-audit-and-plan.md` §4.51 — 55,205 directories and 6.0 GB left in
 * `os.tmpdir()`, and still growing, because nothing ever removed them. Counting directories before and after a gate
 * run is a measurement, and a measurement is not a guard: it says nothing the next time someone adds a spec that
 * forgets. So the mechanism is asserted here instead.
 *
 * The assertion has to span two cases, because a test cannot watch its own teardown — `onTestFinished` runs after the
 * case that registered it has already been judged. Cases in a file run in declaration order, which is what makes the
 * second one able to see what the first one left behind.
 */
import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { deployment } from './helpers/deployment.ts'
import { tempDir } from './helpers/temp.ts'

/** What the case below made, read by the case after it: the only way to see a teardown from inside the suite. */
let probed = ''
let probedState = ''

describe('a temporary directory this suite makes', () => {
  it('exists while the test that asked for it is still running', async () => {
    probed = tempDir('myagent-probe-')
    const context = await deployment()
    probedState = context.stateDir
    try {
      // Both pinned while they are alive, so the case after this one cannot pass vacuously: a teardown that removed
      // nothing and a directory that was never made look identical from over there.
      expect(existsSync(probed)).toBe(true)
      expect(existsSync(probedState)).toBe(true)
    } finally { await context.runtime.stop() }
  })

  it('is gone once that test has ended, which is what 2128 leaked directories were not', () => {
    // Without these two the case below is satisfied by an empty string, since `existsSync('')` is false — which is
    // also what a suite that never ran the case above looks like.
    expect(probed).not.toBe('')
    expect(probedState).not.toBe('')
    expect(existsSync(probed)).toBe(false)
    expect(existsSync(probedState)).toBe(false)
  })
})
