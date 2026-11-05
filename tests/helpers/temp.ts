/**
 * The suite's temporary directories, and the moment each one dies.
 *
 * Every `deployment()` and a dozen specs beside it made a state directory under `os.tmpdir()` and nothing removed it,
 * so the leak was a slope rather than a number: 55,205 directories and 6.0 GB after about forty gates, and 2128 more
 * in the fifteen minutes before the fix was written (`docs/v2/00-audit-and-plan.md` §4.51). The removal is registered
 * here, at creation, because creation is the one point every directory passes through — a cleanup each spec has to
 * remember is a cleanup the next spec forgets, and forgetting it costs 200 directories a run.
 *
 * The lifetime being registered is the TEST's, not the runtime's, and that distinction is the whole design.
 * `tests/fault-injection.spec.ts` builds a second Runtime over the same `stateDir` after the first one has stopped, so
 * hanging the removal on the `finally { await runtime.stop() }` every test already has would delete the directory out
 * from under the restart. It would not even fail loudly everywhere: the restart block at `fault-injection.spec.ts:307`
 * asserts only absences — no Decision, no Ticket, no effect row to retry — and a removed directory satisfies every one
 * of them. A global `afterAll` is refused for the same reason (§4.51): it cannot tell a finished directory from one
 * that is about to be restarted into.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { onTestFinished } from 'vitest'

/**
 * Remove a directory this suite made. Idempotent, unhurt by a test that already deleted it, and — the part that
 * matters — **never able to turn a passing test red**.
 *
 * `maxRetries`/`retryDelay` are what Node offers for exactly this race: a recursive removal can meet a file still
 * being written and fail with ENOTEMPTY, which is what a full-suite run produced (`myagent-test-GTW9lx`, passing 3/3
 * in isolation). Retrying fixes most of it. The `try` fixes the rest, and the reason it is not silent is that a leak
 * is the whole subject of this file: a directory that survives is reported with its path, so the count can be checked
 * against `os.tmpdir()` rather than trusted.
 *
 * The principle behind swallowing at all: **teardown is not the thing under test.** A cleanup failure says something
 * about the filesystem, not about myagent, and letting it redden the suite trains people to ignore red — which is the
 * one thing `scripts/gate.sh` exists to prevent (`docs/v2/04-execution-discipline.md` §0.1).
 */
export function discard(directory: string): void {
  try {
    rmSync(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 20 })
  } catch (error) {
    console.warn(`myagent tests — a temporary directory survived its test: ${directory} (${String(error)})`)
  }
}

/**
 * A fresh directory in `os.tmpdir()`, removed when the test that asked for it ends — whether it passed or failed.
 *
 * Call it from inside a test, or from a `beforeEach` that belongs to one. `onTestFinished` throws anywhere else, and
 * that is deliberate: a directory whose lifetime is a whole file (`tests/store.spec.ts`, which reopens the same
 * database across cases) should say so with its own `afterAll` rather than be registered against a test that is not
 * its owner and quietly outlive it.
 */
export function tempDir(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix))
  onTestFinished(() => { discard(directory) })
  return directory
}
