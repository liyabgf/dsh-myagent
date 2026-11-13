import { describe, expect, it } from 'vitest'
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, existsSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync, spawnSync, spawn } from 'node:child_process'

const root = resolve(import.meta.dirname, '..')
const release = readFileSync(join(root, 'scripts/release.sh'), 'utf8')
const migration = join(root, 'scripts/verify-migration.sh')
function fixture() {
  const dir = mkdtempSync('/tmp/myagent-script-contract-')
  mkdirSync(join(dir, 'bin')); mkdirSync(join(dir, 'tmp')); mkdirSync(join(dir, 'pub', '.git'), { recursive: true }); writeFileSync(join(dir, 'pub', '.git', 'HEAD'), 'ref: refs/heads/main\n')
  return dir
}
function stub(dir: string, name: string, body: string) {
  writeFileSync(join(dir, 'bin', name), '#!/bin/bash\n' + body, { mode: 0o755 })
}
function environment(dir: string, extra: Record<string, string> = {}) {
  return { ...process.env, PATH: join(dir, 'bin') + ':' + process.env.PATH, TMPDIR: join(dir, 'tmp'), ...extra }
}
function guard(fetch: string, push: string, fail = '') {
  const dir = fixture()
  // Execute only the actual target guard, never release.sh or its synchronization/push code.
  const start = release.indexOf('# L01 fix:')
  const end = release.indexOf('# END RELEASE TARGET GUARD', start)
  expect(start).toBeGreaterThan(0); expect(end).toBeGreaterThan(start)
  stub(dir, 'git', `case "$*" in
'remote get-url --all origin') [ "$FAIL" != fetch ] || exit 17; printf '%b\\n' "$FETCH" ;;
'remote get-url --push --all origin') [ "$FAIL" != push ] || exit 18; printf '%s\\n' "$PUSH" ;;
'rev-parse --abbrev-ref HEAD') echo main ;;
'status --porcelain') : ;;
*) echo "unexpected git invocation: $*" >&2; exit 99 ;;
esac\n`)
  const guardCode = release.slice(start, end)
  return spawnSync('bash', ['-c', 'set -euo pipefail\n' + guardCode + '\nvalidate_release_target'], {
    encoding: 'utf8', env: environment(dir, { FETCH: fetch, PUSH: push, FAIL: fail, PUB: join(dir, 'pub'), SRC: root, REPO: 'liyabgf/dsh-myagent' }),
  })
}
const good = 'https://github.com/liyabgf/dsh-myagent.git'
function realGuard(configs: string[][]) {
  const dir = fixture(); const pub = join(dir, 'actual')
  const env = environment(dir, { GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_COUNT: '0', PUB: pub, SRC: root, REPO: 'liyabgf/dsh-myagent' })
  const git = (args: string[]) => execFileSync('git', args, { env })
  git(['init', '-q', '-b', 'main', pub])
  git(['-C', pub, '-c', 'user.name=Synthetic', '-c', 'user.email=synthetic@example.test', 'commit', '--allow-empty', '-qm', 'fixture'])
  git(['-C', pub, 'remote', 'add', 'origin', good])
  for (const args of configs) git(['-C', pub, 'config', ...args])
  const start = release.indexOf('# L01 fix:'); const end = release.indexOf('# END RELEASE TARGET GUARD', start)
  return spawnSync('bash', ['-c', 'set -euo pipefail\n' + release.slice(start, end) + '\nvalidate_release_target'], { env, encoding: 'utf8' })
}
describe('release actual push destination guard', () => {
  it('uses real Git rewrite-expanded push/fetch URLs with isolated configuration', () => {
    expect(realGuard([]).status).toBe(0)
    expect(realGuard([['url.https://evil.test/.pushInsteadOf', 'https://github.com/']]).status).not.toBe(0)
    expect(realGuard([['url.https://evil.test/.insteadOf', 'https://github.com/']]).status).not.toBe(0)
    expect(realGuard([['--add', 'remote.origin.pushurl', good], ['--add', 'remote.origin.pushurl', 'no_push']]).status).not.toBe(0)
    expect(realGuard([['--add', 'remote.origin.pushurl', good], ['--add', 'remote.origin.pushurl', good]]).status).not.toBe(0)
    expect(realGuard([['remote.origin.url', 'alias:liyabgf/dsh-myagent.git'], ['url.https://github.com/.insteadOf', 'alias:']]).status).toBe(0)
  })
  it.each([good, 'https://github.com/liyabgf/dsh-myagent', 'git@github.com:liyabgf/dsh-myagent.git', 'git@github.com:liyabgf/dsh-myagent', 'ssh://git@github.com/liyabgf/dsh-myagent.git'])('accepts canonical %s', url => {
    expect(guard(url, url).status).toBe(0)
  })
  it.each(['no_push', 'https://evil.test/liyabgf/dsh-myagent.git', 'git@github.com.evil.test:liyabgf/dsh-myagent.git', 'https://github.com@evil.test/liyabgf/dsh-myagent.git', 'https://github.com/evil/liyabgf/dsh-myagent.git', 'https://github.com/liyabgf/dsh-myagent-evil.git', 'https://github.com/liyabgf/dsh-myagent.git/extra', 'https://github.com/liyabgf/dsh-myagent.git?x=1', ''])('rejects actual push target %s despite correct fetch', url => {
    expect(guard(good, url).status).not.toBe(0)
  })
  it('requires every push URL and every fetch URL to match', () => {
    expect(guard(good, good + '\n' + 'no_push').status).not.toBe(0)
    expect(guard(good + '\nhttps://evil.test/liyabgf/dsh-myagent.git', good).status).not.toBe(0)
    expect(guard(good, good + '\ngit@github.com:liyabgf/dsh-myagent.git').status).not.toBe(0)
    expect(guard(good + '\ngit@github.com:liyabgf/dsh-myagent.git', good).status).toBe(0)
  })
  it.each(['fetch', 'push'])('fails closed when %s lookup fails', fail => {
    expect(guard(good, good, fail).status).not.toBe(0)
  })
})
function database(dir: string) {
  const db = join(dir, "source ' quoted?#.sqlite3")
  execFileSync('sqlite3', [db, `create table triggers(id,source,kind,at,disposition,record); create table tickets(id,createdAt,open,record); create table decisions(id,triggerId,at,outcome,record); create table kv(key,value); create table schema_version(version); insert into schema_version values(1); insert into kv values('settings:document','before');`])
  return db
}
function nodeStub(dir: string) {
  stub(dir, 'node', `printf '%s\\n' "$PWD" >> "$TRACE"
if [[ "$*" == *SCHEMA_VERSION* ]]; then
  [ "$TEST_VERSION_EXIT" = 0 ] || { echo version-failure-stderr >&2; exit "$TEST_VERSION_EXIT"; }
  printf 2; exit 0
fi
[ "$TEST_NODE_EXIT" = 0 ] || { echo injected-failure-stderr >&2; exit "$TEST_NODE_EXIT"; }
# New implementation passes the snapshot as argv, old code embeds it in JS.
db="${'$'}{!#}"
[[ "$db" == *.sqlite3 ]] || db=$(printf '%s' "$*" | python3 -c 'import re,sys; print(re.search(r"Store\x28\x27(.*?)\x27\x29",sys.stdin.read()).group(1))')
if [ -n "$REQUIRE_WAL" ]; then
  sqlite3 "$db" "select value from kv where key='wal-only'" | grep -qx wal-visible || exit 29
  [ "$(sqlite3 "$db" "select count(*) from kv where key='uncommitted'")" = 0 ] || exit 30
fi
sqlite3 "$db" 'update schema_version set version=2; create table artifacts(id);'
`)
}
function migrate(dir: string, db: string, extra: Record<string, string> = {}) {
  return spawnSync('bash', [migration, db], { cwd: dir, encoding: 'utf8', env: environment(dir, { TRACE: join(dir, 'trace'), TEST_NODE_EXIT: '0', TEST_VERSION_EXIT: '0', REQUIRE_WAL: '', ...extra }) })
}
describe('migration on synthetic SQLite only', () => {
  it('propagates cd failure and never invokes node from a fallback cwd', () => {
    const dir = fixture(); const db = database(dir); nodeStub(dir)
    const hook = join(dir, 'bash-env')
    writeFileSync(hook, `cd() { if [ "$1" = "${root}" ]; then echo injected-cd-failure >&2; return 43; fi; builtin cd "$@"; }\n`)
    const result = migrate(dir, db, { BASH_ENV: hook })
    expect(result.status, result.stdout + result.stderr).toBe(43)
    expect(result.stdout + result.stderr).toContain('injected-cd-failure')
    expect(existsSync(join(dir, 'trace'))).toBe(false)
    expect(readdirSync(join(dir, 'tmp'))).toEqual([])
  })
  it('propagates an early digest SQL failure instead of hiding it behind later successful queries', () => {
    const dir = fixture(); const db = database(dir); nodeStub(dir)
    execFileSync('sqlite3', [db, 'drop table triggers'])
    const result = migrate(dir, db)
    expect(result.status).not.toBe(0)
    expect(result.stdout + result.stderr).toContain('no such table: triggers')
    expect(existsSync(join(dir, 'trace'))).toBe(false)
    expect(readdirSync(join(dir, 'tmp'))).toEqual([])
  })
  it('fails on table metadata query error rather than declaring settings absent', () => {
    const dir = fixture(); const db = database(dir); nodeStub(dir)
    stub(dir, 'sqlite3', `case "$*" in *"name='settings'"*) echo injected-metadata-error >&2; exit 44 ;; esac\nexec /usr/bin/sqlite3 "$@"\n`)
    const result = migrate(dir, db)
    expect(result.status).toBe(44)
    expect(result.stdout + result.stderr).toContain('injected-metadata-error')
    expect(result.stdout).not.toContain('死表 settings 已删除')
    expect(readdirSync(join(dir, 'tmp'))).toEqual([])
  })
  it('reports original node stderr and status under set-e and removes all temporary outputs', () => {
    const dir = fixture(); const db = database(dir); nodeStub(dir)
    const result = migrate(dir, db, { TEST_NODE_EXIT: '37' })
    expect(result.status, result.stdout + result.stderr).toBe(37)
    expect(result.stdout + result.stderr).toContain('injected-failure-stderr')
    expect(result.stdout + result.stderr).toContain('37')
    expect(readdirSync(join(dir, 'tmp'))).toEqual([])
  })
  it('runs migration and expected-version lookup from the same repository cwd', () => {
    const dir = fixture(); const db = database(dir); nodeStub(dir)
    const result = migrate(dir, db)
    expect(result.status, result.stdout + result.stderr).toBe(0)
    expect(readFileSync(join(dir, 'trace'), 'utf8').trim().split('\n')).toEqual([root, root])
    expect(execFileSync('sqlite3', [db, 'select version from schema_version'], { encoding: 'utf8' }).trim()).toBe('1')
    expect(readdirSync(join(dir, 'tmp'))).toEqual([])
  })
  it('preserves stderr/status for expected-version lookup failure and cleans up', () => {
    const dir = fixture(); const db = database(dir); nodeStub(dir)
    const result = migrate(dir, db, { TEST_VERSION_EXIT: '41' })
    expect(result.status).toBe(41)
    expect(result.stdout + result.stderr).toContain('version-failure-stderr')
    expect(readdirSync(join(dir, 'tmp'))).toEqual([])
  })
  it('includes committed WAL rows in the snapshot while a synthetic writer stays open', async () => {
    const dir = fixture(); const db = database(dir); nodeStub(dir)
    const writer = spawn('python3', ['-u', '-c', `import sqlite3,sys,time\nc=sqlite3.connect(sys.argv[1])\nc.execute('pragma journal_mode=wal')\nc.execute('pragma wal_autocheckpoint=0')\nc.execute("insert into kv values('wal-only','wal-visible')")\nc.commit()\nc.execute(\"insert into kv values('uncommitted','must-not-appear')\")\nprint('ready',flush=True)\ntime.sleep(30)`, db])
    try {
      await new Promise<void>((resolveReady, reject) => { writer.stdout.once('data', () => resolveReady()); writer.once('error', reject) })
      expect(existsSync(db + '-wal')).toBe(true)
      const result = migrate(dir, db, { REQUIRE_WAL: '1' })
      expect(result.status, result.stdout + result.stderr).toBe(0)
      expect(readdirSync(join(dir, 'tmp'))).toEqual([])
    } finally { writer.kill() }
  })
})
