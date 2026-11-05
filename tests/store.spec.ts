/** The Store: one SQLite writer for the domain records, the effect queue, the settings and the small key-value facts. */
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { DatabaseSync } from 'node:sqlite'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, afterEach, beforeEach, describe, expect, it } from 'vitest'
import { LOST_TRIGGER_CHARS, LOST_TRIGGER_KEEP, SCHEMA_VERSION, SchemaTooNew, Store, KV } from '../src/app/store.ts'
import { parseSettings } from '../src/core/index.ts'
import type { TriggerRecord } from '../src/core/index.ts'
import type { Decision, Disposition, Ticket, Trigger } from '../src/core/model.ts'
import { discard } from './helpers/temp.ts'

/**
 * The one directory in the suite whose lifetime is the file rather than a test: every case writes its own database
 * inside it, and `keeps what it wrote across a close and an open of the same file` reopens one of them. So it goes
 * when the file is done — `tempDir` would register it against whichever case happened to ask, which is not its owner.
 */
const directory = mkdtempSync(join(tmpdir(), 'myagent-store-'))
afterAll(() => { discard(directory) })
/** One database per case: a Store is the whole state of a deployment, so two cases must not share one. */
let path = ''
let serial = 0
const open: Store[] = []
const store = (): Store => { const made = new Store(path); open.push(made); return made }

beforeEach(() => { path = join(directory, `test-${serial++}.sqlite3`) })
afterEach(() => { for (const made of open.splice(0)) made.close() })

const trigger = (id: string, at: string, over: Partial<Trigger> = {}): TriggerRecord => ({
  trigger: {
    id, source: 'cron', kind: 'cron', at, actor: { id: 'operator', kind: 'person' },
    text: `work ${id}`, title: `Title ${id}`, ...over,
  },
  disposition: { state: 'ignored', decisionId: `decision-${id}` } satisfies Disposition,
})

const ticket = (id: string, createdAt: string, over: Partial<Ticket> = {}): Ticket => ({
  id, title: `Ticket ${id}`, createdAt,
  mandate: {
    policyVersion: 'v1', scope: 'Work in this directory', strength: 'explicit',
    sender: { id: 'operator', kind: 'person' }, via: 'schedule', at: createdAt,
  },
  origin: { triggerId: `trigger-${id}` }, attachments: [],
  assignments: [{ id: `assignment-${id}`, state: 'pending', createdAt }],
  notes: [], inputs: [], ...over,
})

const decision = (id: string, at: string, over: Partial<Decision> = {}): Decision => ({
  id, triggerId: `trigger-${id}`, at, outcome: 'ignore', reason: 'sender_not_allowed', policyVersion: 'v1', ...over,
})

describe('domain records', () => {
  it('round-trips a Trigger with its disposition', () => {
    const made = store()
    const record = trigger('t1', '2026-11-02T10:00:00.000Z')
    made.triggers.save(record)
    expect(made.triggers.get('t1')).toEqual(record)
    expect(made.triggers.get('missing')).toBeUndefined()
  })

  it('updates a Trigger in place, so a repeat cannot make a second row', () => {
    const made = store()
    made.triggers.save(trigger('t1', '2026-11-02T10:00:00.000Z'))
    made.triggers.save({ ...trigger('t1', '2026-11-02T10:00:00.000Z'), disposition: { state: 'accepted', ticketId: 'x', decisionId: 'd' } })
    expect(made.triggers.list()).toHaveLength(1)
    expect(made.triggers.get('t1')?.disposition.state).toBe('accepted')
  })

  it('stores a lost Trigger under its own identity, with the payload verbatim', () => {
    const made = store()
    // A payload that fails inside `receive` on a field the record does not need: the four columns beside it are what
    // this row promises, and `record` holds the text that arrived rather than a Trigger re-assembled from it.
    const raw = JSON.stringify({ id: 'lost-1', source: 'rule', kind: 'rule', at: '2026-11-04T00:00:00.000Z', text: '把摘要发到群里' })
    made.triggers.insertLost({
      id: 'lost-1', source: 'rule', kind: 'rule', at: '2026-11-04T00:00:00.000Z',
      error: 'TypeError: Cannot read properties of undefined (reading \'kind\')', effectKey: 'trigger-effect-1', raw,
    })
    const row = made.triggers.get('lost-1')!
    // Exactly three fields: no `decisionId`, because the gate never ran to a verdict and a Decision here would be one
    // that never happened.
    expect(row.disposition).toEqual({
      state: 'lost', effectKey: 'trigger-effect-1',
      error: 'TypeError: Cannot read properties of undefined (reading \'kind\')',
    })
    expect(row.trigger).toEqual(JSON.parse(raw))
    // Nothing was invented to fill the shape: what the payload lacked, the row lacks.
    expect((row.trigger as { actor?: unknown }).actor).toBeUndefined()
    // And the intake counts put it under the Source that really asked, not under a failure dressed as one.
    expect(made.triggers.countBySource()).toEqual({ rule: { lost: 1 } })
  })

  it('leaves a Trigger row that is already there alone, because it may be the truer record', () => {
    const made = store()
    const accepted: TriggerRecord = {
      ...trigger('lost-1', '2026-11-04T00:00:00.000Z', { source: 'rule', kind: 'rule' }),
      disposition: { state: 'accepted', ticketId: 'ticket-1', decisionId: 'decision-1' },
    }
    made.triggers.save(accepted)
    // The other way a `trigger` effect fails permanently is the Store itself failing, and then the read at the top of
    // `receive` can throw over a row that is already there saying `accepted`, with a Ticket behind it. An update here
    // would replace work that exists with a claim that it was dropped, so a conflict is left alone — and the row an
    // earlier give-up wrote is protected by the same rule, which is what makes a re-delivery add no second row.
    made.triggers.insertLost({
      id: 'lost-1', source: 'rule', kind: 'rule', at: '2026-11-04T00:00:00.000Z',
      error: 'TypeError: no actor', effectKey: 'trigger-effect-1', raw: '{"id":"lost-1"}',
    })
    made.triggers.insertLost({
      id: 'lost-1', source: 'rule', kind: 'rule', at: '2026-11-04T00:00:00.000Z',
      error: 'Error: the second reason', effectKey: 'trigger-effect-2', raw: '{"id":"lost-1","re":true}',
    })
    expect(made.triggers.list()).toHaveLength(1)
    expect(made.triggers.get('lost-1')!.disposition).toEqual(accepted.disposition)
  })

  it('keeps the most recent twenty given-up payloads, and says how long a cut one was', () => {
    const made = store()
    const total = LOST_TRIGGER_KEEP + 5
    for (let index = 0; index < total; index++) {
      made.pushLostPayload({
        at: `2026-11-04T00:00:${String(index).padStart(2, '0')}Z`,
        effectKey: `trigger-effect-${index}`,
        // Longer than the per-payload bound, and longer than the error bound: both cuts must be visible.
        error: 'x'.repeat(500),
        payload: 'y'.repeat(LOST_TRIGGER_CHARS + 40),
      })
    }
    const kept = made.lostPayloads()
    expect(kept).toHaveLength(LOST_TRIGGER_KEEP)
    // The oldest five are dropped, in order, and each entry says what it holds.
    expect(kept.map(entry => entry.effectKey)).toEqual(
      [...Array(LOST_TRIGGER_KEEP).keys()].map(index => `trigger-effect-${index + 5}`))
    expect(kept[0]!.payload).toHaveLength(LOST_TRIGGER_CHARS)
    expect(kept[0]!.chars).toBe(LOST_TRIGGER_CHARS + 40)
    expect(kept[0]!.error).toHaveLength(400)
    // One value in `kv`, not a row per loss: the bound is what keeps this from being the unbounded append §4.35
    // refused `kv` for, and the whole value is rewritten on every loss so it has to stay small.
    expect(made.keys(KV.lostTriggers)).toEqual([KV.lostTriggers])
  })

  it('lists Triggers newest first and only those since a moment', () => {
    const made = store()
    for (const [id, at] of [['a', '2026-11-01T10:00:00.000Z'], ['b', '2026-11-03T10:00:00.000Z'], ['c', '2026-11-02T10:00:00.000Z']] as const) {
      made.triggers.save(trigger(id, at))
    }
    expect(made.triggers.since('', 10).map(record => record.trigger.id)).toEqual(['b', 'c', 'a'])
    expect(made.triggers.since('2026-11-02T00:00:00.000Z', 10).map(record => record.trigger.id)).toEqual(['b', 'c'])
    expect(made.triggers.since('', 1).map(record => record.trigger.id)).toEqual(['b'])
  })

  it('counts Tickets by what a person cares about', () => {
    const made = store()
    made.tickets.save(ticket('open', '2026-11-02T10:00:00.000Z'))
    made.tickets.save(ticket('waiting', '2026-11-02T11:00:00.000Z', { attention: { at: '2026-11-02T11:30:00.000Z', question: 'Which one?' } }))
    made.tickets.save(ticket('ended', '2026-11-02T09:00:00.000Z', { ended: { at: '2026-11-02T09:30:00.000Z', by: 'agent', outcome: 'done', reason: 'ready' } }))
    expect(made.tickets.count()).toEqual({ open: 2, ended: 1, attention: 1 })
    expect(made.tickets.open().map(item => item.id).sort()).toEqual(['open', 'waiting'])
  })

  it('pages Tickets newest first by state', () => {
    const made = store()
    for (const hour of [10, 11, 12]) made.tickets.save(ticket(`t${hour}`, `2026-11-02T${hour}:00:00.000Z`))
    made.tickets.save(ticket('done', '2026-11-02T13:00:00.000Z', { ended: { at: '2026-11-02T13:30:00.000Z', by: 'agent', outcome: 'done', reason: 'ready' } }))
    expect(made.tickets.page('all', 0, 2).map(item => item.id)).toEqual(['done', 't12'])
    expect(made.tickets.page('all', 2, 2).map(item => item.id)).toEqual(['t11', 't10'])
    expect(made.tickets.page('open', 0, 10).map(item => item.id)).toEqual(['t12', 't11', 't10'])
    expect(made.tickets.page('ended', 0, 10).map(item => item.id)).toEqual(['done'])
  })

  it('round-trips Decisions and reads one back by id', () => {
    const made = store()
    made.decisions.save(decision('d1', '2026-11-02T10:00:00.000Z', { outcome: 'accept', reason: 'accepted', ticketId: 'ticket-1' }))
    made.decisions.save(decision('d2', '2026-11-02T09:00:00.000Z'))
    expect(made.decisions.get('d1')).toMatchObject({ outcome: 'accept', ticketId: 'ticket-1' })
    expect(made.decisions.list(10).map(item => item.id)).toEqual(['d1', 'd2'])
  })
})

describe('effects', () => {
  it('claims what is due once, and settles it so it never runs again', async () => {
    const made = store()
    made.enqueueEffect('launch', 'k1', { ticketId: 'a' })
    made.enqueueEffect('launch', 'k2', { ticketId: 'b' }, Date.now() + 60_000)
    const claimed = made.claimEffects('launch', 10)
    expect(claimed.map(effect => effect.key)).toEqual(['k1'])
    expect(claimed[0]).toMatchObject({ kind: 'launch', payload: { ticketId: 'a' }, running: true })
    // A second claim finds it running, and the one not due yet stays queued.
    expect(made.claimEffects('launch', 10)).toEqual([])
    made.settleEffect('launch', 'k1')
    expect(made.pendingEffects('launch', 'k1')).toBe(false)
    expect(made.pendingEffects('launch', 'k2')).toBe(true)
    expect(made.effectCounts()).toEqual({ launch: 1 })
  })

  it('replaces a pending effect of the same identity instead of queueing a second one', () => {
    const made = store()
    made.enqueueEffect('notify', 'k1', { n: 1 })
    made.enqueueEffect('notify', 'k1', { n: 2 })
    expect(made.claimEffects('notify', 10).map(effect => effect.payload)).toEqual([{ n: 2 }])
  })

  it('counts a failure and defers the next attempt to when the caller says', () => {
    const made = store()
    made.enqueueEffect('launch', 'k1', {})
    made.claimEffects('launch', 10)
    made.failEffect('launch', 'k1', Date.now() + 60_000)
    const row = made.claimEffects('launch', 10)
    expect(row).toEqual([])
    // The row is still there with one failure on it, waiting for its moment.
    expect(made.effectCounts()).toEqual({ launch: 1 })
    made.deferEffect('launch', 'k1', Date.now() - 1)
    expect(made.claimEffects('launch', 10).map(effect => [effect.key, effect.failures])).toEqual([['k1', 1]])
  })

  it('gives back what a dead process had claimed', () => {
    const made = store()
    made.enqueueEffect('launch', 'k1', {})
    made.claimEffects('launch', 10)
    expect(made.releaseRunning()).toBe(1)
    expect(made.claimEffects('launch', 10).map(effect => effect.key)).toEqual(['k1'])
  })
})

describe('transactions', () => {
  it('keeps the writes of a committed transaction', () => {
    const made = store()
    made.atomic(() => { made.tickets.save(ticket('t1', '2026-11-02T10:00:00.000Z')) })
    expect(made.tickets.get('t1')).toBeDefined()
  })

  it('undoes every write of a transaction that threw', () => {
    const made = store()
    made.tickets.save(ticket('kept', '2026-11-02T10:00:00.000Z'))
    expect(() => made.atomic(() => {
      made.tickets.save(ticket('rolled', '2026-11-02T10:00:00.000Z'))
      made.set('kv:gone', true)
      throw new Error('no')
    })).toThrow('no')
    expect(made.tickets.get('rolled')).toBeUndefined()
    expect(made.get('kv:gone')).toBeUndefined()
    expect(made.tickets.get('kept')).toBeDefined()
  })

  it('runs after-commit work only once the outermost transaction committed', () => {
    const made = store()
    const ran: string[] = []
    made.atomic(() => {
      made.afterCommit(() => ran.push('outer'))
      made.atomic(() => { made.afterCommit(() => ran.push('inner')) })
      expect(ran).toEqual([])
    })
    expect(ran.sort()).toEqual(['inner', 'outer'])
  })

  it('drops after-commit work when the transaction rolls back', () => {
    const made = store()
    const ran: string[] = []
    expect(() => made.atomic(() => {
      made.afterCommit(() => ran.push('never'))
      throw new Error('no')
    })).toThrow('no')
    expect(ran).toEqual([])
  })
})

describe('settings and small facts', () => {
  it('answers the defaults before anything is stored', () => {
    const made = store()
    expect(made.settingsRevision()).toBe(0)
    expect(made.settings()).toMatchObject({ acceptMode: 'observe', paused: false, sources: { inbox: { enabled: true } } })
  })

  it('stores settings as one document and moves the revision', () => {
    const made = store()
    const next = parseSettings({ acceptMode: 'auto', allowedSenders: ['operator', 'alice'] })
    expect(made.saveSettings(next)).toBe(1)
    expect(made.settingsRevision()).toBe(1)
    expect(made.settings()).toMatchObject({ acceptMode: 'auto', allowedSenders: ['operator', 'alice'] })
    expect(made.saveSettings(next)).toBe(2)
  })

  it('round-trips key-value facts, including a Source read position', () => {
    const made = store()
    made.set(KV.sourceCursor('cron'), { schedules: { s1: { next: 5 } } })
    expect(made.get(KV.sourceCursor('cron'))).toEqual({ schedules: { s1: { next: 5 } } })
    expect(made.keys('source:')).toEqual([KV.sourceCursor('cron')])
    made.delete(KV.sourceCursor('cron'))
    expect(made.get(KV.sourceCursor('cron'))).toBeUndefined()
  })

  it('keeps what it wrote across a close and an open of the same file', () => {
    const first = store()
    first.set('probe', 1)
    first.tickets.save(ticket('kept', '2026-11-02T10:00:00.000Z'))
    first.close()
    open.splice(open.indexOf(first), 1)
    const again = store()
    expect(again.get('probe')).toBe(1)
    expect(again.tickets.get('kept')?.title).toBe('Ticket kept')
    // Opening a database this build already wrote does not migrate it again.
    expect(again.settingsRevision()).toBe(0)
  })
})

describe('a state directory written by a newer myagent', () => {
  it('refuses to open a database whose schema it does not know', () => {
    const other = join(directory, 'newer.sqlite3')
    const first = new Store(other)
    first.set('anything', 1)
    first.close()
    // A newer deployment would have written a bigger number here; this one is unreadable to us.
    const raw = new DatabaseSync(other)
    raw.prepare('UPDATE schema_version SET version = 99').run()
    raw.close()
    expect(() => new Store(other)).toThrow(SchemaTooNew)
    expect(() => new Store(other)).toThrow(/schema 99/)
  })
})

describe('a state directory written by an older myagent', () => {
  // A version-1 file: no artifacts table, a real Ticket row, a settings revision in kv, and the `settings` table no
  // build has ever read or written. This path had no test at all, which is why "a schema change strands the data" was
  // only ever true by inspection.
  const legacyFile = (): string => {
    const legacy = join(directory, 'legacy.sqlite3')
    rmSync(legacy, { force: true })
    const raw = new DatabaseSync(legacy)
    raw.exec(`CREATE TABLE schema_version (version INTEGER NOT NULL);
CREATE TABLE tickets (id TEXT PRIMARY KEY, createdAt TEXT NOT NULL, open INTEGER NOT NULL, record TEXT NOT NULL) WITHOUT ROWID;
CREATE INDEX tickets_open ON tickets (open, createdAt);
CREATE TABLE settings (block TEXT PRIMARY KEY, revision INTEGER NOT NULL, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;`)
    raw.prepare('INSERT INTO schema_version (version) VALUES (1)').run()
    raw.prepare("INSERT INTO kv (key, value) VALUES ('settings:revision', '7')").run()
    raw.prepare("INSERT INTO tickets (id, createdAt, open, record) VALUES (?, ?, ?, ?)").run(
      't1', '2026-11-03T00:00:00.000Z', 1, JSON.stringify({
        id: 't1', createdAt: '2026-11-03T00:00:00.000Z', title: '旧的一张',
        mandate: { via: 'inbox', sender: { id: 'operator', kind: 'person' }, scope: 'do it', policyVersion: 'v1' },
        origin: { triggerId: 'tr1' }, assignments: [], inputs: [],
      }))
    raw.close()
    return legacy
  }
  const versionOf = (path: string): number => {
    const raw = new DatabaseSync(path)
    const found = raw.prepare('SELECT version FROM schema_version').get() as { version: number }
    raw.close()
    return found.version
  }

  it('brings a version-1 file to the current schema without touching what it holds', () => {
    const legacy = legacyFile()
    const store = new Store(legacy)
    try {
      // Asserted against the constant rather than a number, so this does not rot at the next schema step.
      expect(versionOf(legacy)).toBe(SCHEMA_VERSION)
      // The operator's data survives verbatim.
      expect(store.tickets.get('t1')?.title).toBe('旧的一张')
      expect(store.settingsRevision()).toBe(7)
      // The registry this build runs on exists and answers.
      expect(store.artifacts.list('t1')).toEqual([])
    } finally { store.close() }
    // The one destructive statement is the one no build has ever used.
    const raw = new DatabaseSync(legacy)
    expect(raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'settings'").get()).toBeUndefined()
    raw.close()
  })

  it('leaves the version at 1 and the data untouched when a step throws', () => {
    // An interrupted migration is the whole rollback story, so it is worth making one actually interrupt: the stamp is
    // the last statement, so a throwing step must leave the file exactly as it was and the older build able to open it.
    const legacy = legacyFile()
    // A name collision makes the step fail for real: `CREATE TABLE IF NOT EXISTS artifacts` refuses an existing view.
    const collide = new DatabaseSync(legacy)
    collide.exec('CREATE VIEW artifacts AS SELECT 1 AS one')
    collide.close()
    // Either wording means the step died on the colliding name: the table it was about to create, or the index on it.
    expect(() => new Store(legacy)).toThrow(/views may not be indexed|artifacts/)
    expect(versionOf(legacy)).toBe(1)
    const after = new DatabaseSync(legacy)
    expect((after.prepare('SELECT count(*) AS total FROM tickets').get() as { total: number }).total).toBe(1)
    expect((after.prepare("SELECT value FROM kv WHERE key = 'settings:revision'").get() as { value: string }).value).toBe('7')
    after.close()
  })

  it('creates the registry on a fresh install too, and upserts by (ticket, path)', () => {
    const fresh = join(directory, 'fresh.sqlite3')
    const store = new Store(fresh)
    try {
      expect(versionOf(fresh)).toBe(SCHEMA_VERSION)
      expect(store.artifacts.list('t9')).toEqual([])
      store.artifacts.save({ ticketId: 't9', path: 'report.md', at: '2026-11-03T00:00:00.000Z' })
      store.artifacts.save({ ticketId: 't9', path: 'report.md', at: '2026-11-03T01:00:00.000Z', note: '第二版' })
      store.artifacts.save({ ticketId: 't9', path: 'chart.png', at: '2026-11-03T00:30:00.000Z' })
      // A path is replaced, not duplicated, and the order follows the registering report.
      expect(store.artifacts.list('t9')).toEqual([
        { ticketId: 't9', path: 'chart.png', at: '2026-11-03T00:30:00.000Z' },
        { ticketId: 't9', path: 'report.md', at: '2026-11-03T01:00:00.000Z', note: '第二版' },
      ])
    } finally { store.close() }
  })
})

describe('a state directory written by version 2', () => {
  // The ladder, not just the newest shape: a file at version 2 has a `tickets` table with no generated columns, and
  // this is the path a real upgrade takes. SQLite has no `ADD COLUMN IF NOT EXISTS`, so the step has to look first.
  const versionTwo = (): string => {
    const path = join(directory, 'version-two.sqlite3')
    rmSync(path, { force: true })
    const raw = new DatabaseSync(path)
    raw.exec(`CREATE TABLE schema_version (version INTEGER NOT NULL);
CREATE TABLE tickets (id TEXT PRIMARY KEY, createdAt TEXT NOT NULL, open INTEGER NOT NULL, record TEXT NOT NULL) WITHOUT ROWID;
CREATE INDEX tickets_open ON tickets (open, createdAt);
CREATE TABLE kv (key TEXT PRIMARY KEY, value TEXT NOT NULL) WITHOUT ROWID;
CREATE TABLE artifacts (ticketId TEXT NOT NULL, path TEXT NOT NULL, at TEXT NOT NULL, record TEXT NOT NULL, PRIMARY KEY (ticketId, path)) WITHOUT ROWID;`)
    raw.prepare('INSERT INTO schema_version (version) VALUES (2)').run()
    raw.prepare('INSERT INTO tickets (id, createdAt, open, record) VALUES (?, ?, ?, ?)').run(
      'old-1', '2026-11-03T00:00:00.000Z', 1,
      JSON.stringify({ id: 'old-1', createdAt: '2026-11-03T00:00:00.000Z', title: '版本二留下的一张', assignments: [], inputs: [], notes: [] }))
    raw.close()
    return path
  }

  it('adds the Project and Work tables and the generated columns without touching the row it found', () => {
    const path = versionTwo()
    const store = new Store(path)
    try {
      expect(store.tickets.get('old-1')?.title).toBe('版本二留下的一张')
      // A Ticket from before V2 belongs to no Work, and asking for one answers empty rather than failing.
      expect(store.tickets.byWork('anything')).toEqual([])
      const work = { id: 'w1', name: '每日摘要', createdAt: '2026-11-03T01:00:00.000Z' }
      store.works.save(work)
      expect(store.works.byProject(undefined)).toEqual([work])
      // Classifying the old Ticket writes the record, and the generated column picks it up without a second write —
      // which is the whole reason it is generated rather than promoted: a promoted column can go stale and lie.
      store.tickets.save({ ...store.tickets.get('old-1')!, workId: 'w1', workSeq: 1 })
      expect(store.tickets.byWork('w1').map(ticket => ticket.id)).toEqual(['old-1'])
    } finally { store.close() }
    const raw = new DatabaseSync(path)
    const version = (raw.prepare('SELECT version FROM schema_version').get() as { version: number }).version
    // `table_xinfo`, not `table_info`: a generated VIRTUAL column is hidden, and `table_info` omits hidden columns.
    const columns = (raw.prepare('PRAGMA table_xinfo(tickets)').all() as { name: string }[]).map(row => row.name)
    const tables = (raw.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(row => row.name)
    raw.close()
    expect(version).toBe(SCHEMA_VERSION)
    expect(columns).toEqual(expect.arrayContaining(['workId', 'workSeq']))
    expect(tables).toEqual(expect.arrayContaining(['projects', 'works', 'events']))
  })

  it('runs the same step twice without failing, which is what a fresh install does', () => {
    // A fresh database is created at the newest shape and then the ladder still runs over it, so every step has to be
    // safe against a file that already has what it produces.
    const path = join(directory, 'twice.sqlite3')
    const first = new Store(path)
    first.close()
    expect(() => new Store(path).close()).not.toThrow()
  })
})

describe('the suite\'s own temporary directories', () => {
  // Teardown is not the thing under test. A full-suite run once reddened a passing fault-injection test with
  // `ENOTEMPTY` from `rmSync` meeting a file still being written — the same test passed 3/3 in isolation. Retrying
  // fixes most of that; refusing to propagate fixes the rest, because a red suite trains people to ignore red.
  it('removes a directory it made, and does not fail a test when there is nothing to remove', () => {
    const directory = join(tmpdir(), `myagent-probe-${process.pid}`)
    rmSync(directory, { recursive: true, force: true })
    // The idempotent half: a test that already deleted its directory must not be punished for it.
    expect(() => discard(directory)).not.toThrow()
    // And the real half: a directory that exists is gone afterwards.
    mkdirSync(directory)
    writeFileSync(join(directory, 'kept.txt'), 'x')
    discard(directory)
    expect(existsSync(directory)).toBe(false)
  })
})
