/**
 * The shipped artifact has to be the one this source builds.
 *
 * A stale `lib/index.js` is the one failure that makes every other verification lie: the host loads `lib`, the tests
 * load `src`, and both can be green while the deployed plugin is rounds behind. That happened here — `pnpm check` was
 * piped through `head`, which sent SIGPIPE upstream and killed the build step, and the missing "Build complete" line
 * read as success because nothing had errored. Every one of these assertions fails against that stale bundle.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { SCHEMA_VERSION } from '../src/app/store.ts'

const root = join(import.meta.dirname, '..')
const bundle = join(root, 'lib', 'index.js')

/** Every TypeScript file under a directory, recursively. */
function sources(directory: string): string[] {
  const found: string[] = []
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) found.push(...sources(path))
    else if (entry.name.endsWith('.ts')) found.push(path)
  }
  return found
}

describe('the built bundle', () => {
  // No `skipIf` here, deliberately: this is the one assertion that must fail when the artifact is absent. Skipping it
  // would mean deleting `lib/index.js` turns the guard green — and a guard that exempts itself when the thing it guards
  // is missing is not a guard. The three below may skip, because by then this one has already said so out loud.
  it('exists, because the host loads this file and nothing else', () => {
    expect(existsSync(bundle), 'lib/index.js is missing — run pnpm build').toBe(true)
    expect(statSync(bundle).size).toBeGreaterThan(0)
  })

  it.skipIf(!existsSync(bundle))('is newer than every source file, so what ships is what this source says', () => {
    const built = statSync(bundle).mtimeMs
    const stale = sources(join(root, 'src'))
      .filter(path => statSync(path).mtimeMs > built)
      .map(path => path.slice(root.length + 1))
    expect(stale).toEqual([])
  })

  it.skipIf(!existsSync(bundle))('stamps the schema version this source declares', () => {
    // The ladder stamps the version once, at the end of a successful migration. A bundle built from older source
    // stamps an older number, and the difference is invisible to every test that reads `src`.
    expect(readFileSync(bundle, 'utf8')).toContain(`.run(${SCHEMA_VERSION})`)
  })

  it.skipIf(!existsSync(bundle))('no longer creates what this source has dropped', () => {
    // The dead `settings` table was dropped in schema version 2. A bundle that still creates it is from before that.
    expect(readFileSync(bundle, 'utf8')).not.toContain('CREATE TABLE IF NOT EXISTS settings')
  })
})
