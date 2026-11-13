import { describe, expect, it } from 'vitest'
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { spawnSync } from 'node:child_process'
import { afterEach } from 'vitest'

const temporary: string[] = []
afterEach(() => { for (const path of temporary.splice(0)) rmSync(path, { recursive: true, force: true }) })

describe('browser verifier dependency preflight', () => {
  it('resolves explicitly configured dependencies without launching a browser', () => {
    const directory = mkdtempSync(join(tmpdir(), 'myagent-browser-preflight-'))
    temporary.push(directory)
    const module = join(directory, 'playwright.cjs')
    writeFileSync(module, `module.exports = { chromium: { launch() { throw new Error('must not launch in preflight') } } }`)
    const executable = join(directory, 'chrome')
    writeFileSync(executable, '#!/bin/sh\nexit 99\n')
    chmodSync(executable, 0o700)
    const result = spawnSync(process.execPath, ['scripts/verify-browser.mjs', '--preflight'], {
      encoding: 'utf8', env: { ...process.env, MYAGENT_PLAYWRIGHT_PATH: module, MYAGENT_CHROME_PATH: executable }, timeout: 5_000,
    })
    expect(result.status).toBe(0)
    expect(result.stdout).toContain('no browser was launched')
  })

  it('fails clearly when a configured runner is unavailable', () => {
    const directory = mkdtempSync(join(tmpdir(), 'myagent-browser-missing-'))
    temporary.push(directory)
    const result = spawnSync(process.execPath, ['scripts/verify-browser.mjs', '--preflight'], {
      encoding: 'utf8', env: { ...process.env, MYAGENT_PLAYWRIGHT_PATH: join(directory, 'missing.cjs') }, timeout: 5_000,
    })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('Browser verifier prerequisites unavailable')
  })
})
