/**
 * The transaction contract, asserted against BOTH implementations.
 *
 * Every domain test runs on `Memory` while production runs on `Store`. They used to disagree in four places —
 * snapshot depth, what a throwing deferred action did to already-committed data, what happened to `depth` afterwards,
 * and whether a nested rollback undid anything — and the suite was green throughout, because nothing ever asked the
 * two to answer the same question. V2's cascade cancel depends on nested rollback, so from here on the two are pinned
 * to one contract by this file: a change to either that breaks the agreement fails twice, once per implementation.
 */
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { Memory } from '../src/core/memory.ts'
import { Store } from '../src/app/store.ts'
import type { ArtifactRepository, TriggerRecord } from '../src/core/engine.ts'

/** The part of a transaction implementation this contract holds it to. */
interface Subject {
  atomic<T>(run: () => T): T
  afterCommit(run: () => void): void
  readonly triggers: { save(record: TriggerRecord): void; list(): TriggerRecord[] }
  readonly artifacts: ArtifactRepository
  readonly deferredFailures: readonly { at: string; message: string }[]
}

/**
 * One stored Trigger, which is the smallest record both implementations can hold.
 *
 * Each gets its own instant on purpose. `Store` lists Triggers `ORDER BY at` while `Memory` lists them in insertion
 * order, so two records sharing an instant come back in different orders — a real difference between the two, but not
 * part of the transaction contract, and giving them distinct instants keeps these cases reading like the order they
 * were written in.
 */
let sequence = 0
const record = (id: string): TriggerRecord => ({
  trigger: {
    id, source: 'inbox', kind: 'inbox', at: new Date(Date.UTC(2026, 10, 3, 0, 0, sequence++)).toISOString(),
    actor: { id: 'operator', kind: 'person' }, text: '做点事', title: '一件事',
  },
  disposition: { state: 'ignored', decisionId: `decision-${id}` },
})

const ids = (subject: Subject): string[] => subject.triggers.list().map(stored => stored.trigger.id)

/** Both implementations, opened and disposed the same way, so a case reads identically for either. */
const implementations: readonly { name: string; open(): Promise<{ subject: Subject; dispose(): Promise<void> }> }[] = [
  { name: 'Memory', open: async () => ({ subject: new Memory(), dispose: async () => {} }) },
  {
    name: 'Store',
    open: async () => {
      const directory = mkdtempSync(join(tmpdir(), 'myagent-tx-'))
      const store = new Store(join(directory, 'tx.sqlite3'))
      return {
        subject: store,
        dispose: async () => { store.close(); rmSync(directory, { recursive: true, force: true }) },
      }
    },
  },
]

for (const implementation of implementations) {
  describe(`the transaction contract, as ${implementation.name} implements it`, () => {
    /** Open a subject for one case and make sure it is disposed even when the case fails. */
    const withSubject = async (run: (subject: Subject) => void | Promise<void>): Promise<void> => {
      const { subject, dispose } = await implementation.open()
      try { await run(subject) } finally { await dispose() }
    }

    it('keeps what a transaction committed when a deferred action throws, and stays usable', async () => {
      await withSubject(subject => {
        // The transaction has already committed by the time deferred actions run, so one that throws is a failure of
        // that action, not of the transaction. Rolling the data back here — which `Memory` used to do — made a test
        // asserting "nothing was left behind" pass while production had committed it.
        subject.atomic(() => {
          subject.triggers.save(record('kept'))
          subject.afterCommit(() => { throw new Error('the launch could not be enqueued') })
        })
        expect(ids(subject)).toEqual(['kept'])
        expect(subject.deferredFailures).toHaveLength(1)
        expect(subject.deferredFailures[0]!.message).toContain('the launch could not be enqueued')
        // A corrupted depth used to make every later transaction fail on `SAVEPOINT s-1`, with the data committed and
        // the deployment dead until the process restarted.
        subject.atomic(() => { subject.triggers.save(record('afterwards')) })
        expect(ids(subject)).toEqual(['kept', 'afterwards'])
      })
    })

    it('keeps running the deferred actions after one of them throws', async () => {
      await withSubject(subject => {
        const ran: string[] = []
        subject.atomic(() => {
          subject.afterCommit(() => { throw new Error('first fails') })
          subject.afterCommit(() => ran.push('second'))
        })
        // A launch that never enqueued is survivable; a launch nobody even attempted is not, and the tail of the queue
        // used to vanish with the first throw.
        expect(ran).toEqual(['second'])
        expect(subject.deferredFailures).toHaveLength(1)
      })
    })

    it('undoes only the inner writes when a nested transaction fails and the outer swallows it', async () => {
      await withSubject(subject => {
        const ran: string[] = []
        subject.atomic(() => {
          subject.triggers.save(record('outer'))
          subject.afterCommit(() => ran.push('outer'))
          try {
            subject.atomic(() => {
              subject.triggers.save(record('inner'))
              subject.afterCommit(() => ran.push('inner'))
              throw new Error('the inner command failed')
            })
          } catch { ran.push('caught') }
        })
        // `Store` answers a nested failure with `ROLLBACK TO`, which undoes the inner writes; `Memory` used to snapshot
        // only at depth 0 and so kept them. Cascade cancel is exactly this shape.
        expect(ids(subject)).toEqual(['outer'])
        // A deferred action belongs to the writes of the transaction that registered it, so the inner one must not run.
        expect(ran).toEqual(['caught', 'outer'])
      })
    })

    it('runs deferred actions once, in the order they were registered, after the outermost commit', async () => {
      await withSubject(subject => {
        const ran: string[] = []
        subject.atomic(() => {
          subject.afterCommit(() => ran.push('first'))
          subject.atomic(() => { subject.afterCommit(() => ran.push('nested')) })
          subject.afterCommit(() => ran.push('last'))
          // Nothing may observe the queue mid-transaction: these run only once the outer commit has happened.
          expect(ran).toEqual([])
        })
        expect(ran).toEqual(['first', 'nested', 'last'])
      })
    })

    it('runs a deferred action at once when there is no transaction to wait for', async () => {
      await withSubject(subject => {
        const ran: string[] = []
        subject.afterCommit(() => ran.push('inline'))
        expect(ran).toEqual(['inline'])
      })
    })

    it('undoes a registered artifact when the transaction that registered it rolls back', async () => {
      await withSubject(subject => {
        // An artifact must point at a report that exists, so a report whose transaction rolled back leaves none behind.
        expect(() => subject.atomic(() => {
          subject.artifacts.save({ ticketId: 't1', path: 'report.md', at: '2026-11-03T00:00:00.000Z' })
          throw new Error('the report was refused')
        })).toThrow('the report was refused')
        expect(subject.artifacts.list('t1')).toEqual([])
      })
    })

    it('undoes everything and runs nothing deferred when the transaction itself fails', async () => {
      await withSubject(subject => {
        const ran: string[] = []
        expect(() => subject.atomic(() => {
          subject.triggers.save(record('doomed'))
          subject.afterCommit(() => ran.push('doomed'))
          throw new Error('the command failed')
        })).toThrow('the command failed')
        expect(ids(subject)).toEqual([])
        expect(ran).toEqual([])
        expect(subject.deferredFailures).toHaveLength(0)
        // A failed transaction must leave the implementation usable, which is what a leaked depth would prevent.
        subject.atomic(() => { subject.triggers.save(record('next')) })
        expect(ids(subject)).toEqual(['next'])
      })
    })
  })
}


describe('Store COMMIT failure recovery', () => {
  it('rolls back a failed inner RELEASE without losing outer writes or deferred callbacks', () => {
    const store = new Store(':memory:')
    const db = (store as unknown as { db: import('node:sqlite').DatabaseSync }).db
    const exec = db.exec.bind(db)
    let failRelease = true
    const calls: string[] = []
    const spy = vi.spyOn(db, 'exec').mockImplementation(sql => {
      calls.push(sql)
      if (sql === 'RELEASE s1' && failRelease) {
        failRelease = false
        throw new Error('injected RELEASE failure')
      }
      exec(sql)
    })
    const ran: string[] = []
    try {
      store.atomic(() => {
        store.set('outer', 'kept')
        store.afterCommit(() => ran.push('outer'))
        expect(() => store.atomic(() => {
          store.set('inner', 'rolled back')
          store.afterCommit(() => ran.push('inner'))
        })).toThrow('injected RELEASE failure')
        expect(store.get('inner')).toBeUndefined()
        expect((store as unknown as { depth: number }).depth).toBe(1)
        store.atomic(() => { store.set('next-inner', 'kept') })
      })
      expect(store.get('outer')).toBe('kept')
      expect(store.get('next-inner')).toBe('kept')
      expect(ran).toEqual(['outer'])
      expect(calls).toContain('ROLLBACK TO s1')
      expect(calls.filter(sql => sql === 'RELEASE s1')).toHaveLength(3)
      expect((store as unknown as { queue: unknown[] }).queue).toEqual([])
      expect((store as unknown as { depth: number }).depth).toBe(0)
    } finally { spy.mockRestore(); store.close() }
  })

  it('closes the Store and rejects later transactions/hooks when rollback itself fails', () => {
    const store = new Store(':memory:')
    const db = (store as unknown as { db: import('node:sqlite').DatabaseSync }).db
    const exec = db.exec.bind(db)
    const rollbackFailure = new Error('injected ROLLBACK failure')
    const workFailure = new Error('work failed')
    const spy = vi.spyOn(db, 'exec').mockImplementation(sql => {
      if (sql === 'ROLLBACK') throw rollbackFailure
      exec(sql)
    })
    let failure: unknown
    let callbackRan = false
    try {
      store.atomic(() => {
        store.afterCommit(() => { callbackRan = true })
        throw workFailure
      })
    } catch (error) { failure = error }
    try {
      expect(failure).toBeInstanceOf(AggregateError)
      expect((failure as AggregateError).errors).toEqual([workFailure, rollbackFailure])
      expect((store as unknown as { queue: unknown[] }).queue).toEqual([])
      expect((store as unknown as { depth: number }).depth).toBe(0)
      expect(() => store.atomic(() => { callbackRan = true })).toThrow('Store is unusable')
      expect(() => store.afterCommit(() => { callbackRan = true })).toThrow('Store is unusable')
      expect(() => store.set('later', 'not allowed')).toThrow()
      expect(callbackRan).toBe(false)
    } finally { spy.mockRestore(); try { store.close() } catch { /* closed by fail-closed recovery */ } }
  })

  it('rolls back deferred-constraint COMMIT failure, clears hooks, and remains usable', async () => {
    const store = new Store(':memory:')
    const db = (store as unknown as { db: import('node:sqlite').DatabaseSync }).db
    try {
      db.exec('CREATE TABLE parent (id INTEGER PRIMARY KEY)')
      db.exec('CREATE TABLE child (parent_id INTEGER REFERENCES parent(id) DEFERRABLE INITIALLY DEFERRED)')
      const ran: string[] = []
      expect(() => store.atomic(() => {
        db.exec('INSERT INTO child (parent_id) VALUES (404)')
        store.afterCommit(() => ran.push('leaked'))
      })).toThrow(/FOREIGN KEY constraint failed/)
      expect(ran).toEqual([])
      // The queue must be truncated immediately, not merely hidden by the next transaction's mark.
      expect((store as unknown as { queue: unknown[] }).queue).toHaveLength(0)
      expect((store as unknown as { depth: number }).depth).toBe(0)
      expect((db.prepare('SELECT count(*) AS n FROM child').get() as { n: number }).n).toBe(0)
      store.atomic(() => {
        db.exec('INSERT INTO parent (id) VALUES (404)')
        db.exec('INSERT INTO child (parent_id) VALUES (404)')
        store.afterCommit(() => ran.push('next'))
      })
      expect((db.prepare('SELECT count(*) AS n FROM child').get() as { n: number }).n).toBe(1)
      expect(ran).toEqual(['next'])
    } finally { store.close() }
  })
})


// B3b receipts must participate in the same nested transaction contract as Inputs.
for (const kind of ['Memory', 'Store'] as const) {
  it(`${kind} rolls back nested receipts and preserves committed receipts across reopen`, () => {
    const directory = mkdtempSync(join(tmpdir(), 'myagent-receipts-'))
    const path = join(directory, 'receipts.sqlite3')
    const subject = kind === 'Memory' ? new Memory() : new Store(path)
    const receipt = { version: 1 as const, fingerprint: 'facts', consumedAt: 'now', targets: [{ ticketId: 'target', mode: 'note' as const }] }
    try {
      const hooks: string[] = []
      subject.atomic(() => {
        subject.inputConsumptions.save('kept', receipt)
        expect(() => subject.atomic(() => {
          subject.inputConsumptions.save('inner', receipt)
          subject.afterCommit(() => hooks.push('inner'))
          throw new Error('inner rollback')
        })).toThrow('inner rollback')
      })
      expect(subject.inputConsumptions.get('kept')).toEqual(receipt)
      expect(subject.inputConsumptions.get('inner')).toBeUndefined()
      expect(() => subject.atomic(() => {
        subject.atomic(() => subject.inputConsumptions.save('outer', receipt))
        throw new Error('outer rollback')
      })).toThrow('outer rollback')
      expect(subject.inputConsumptions.get('outer')).toBeUndefined()
      expect(hooks).toEqual([])
      if (subject instanceof Store) {
        subject.close()
        const reopened = new Store(path)
        try { expect(reopened.inputConsumptions.get('kept')).toEqual(receipt) }
        finally { reopened.close() }
      }
    } finally {
      if (subject instanceof Store) { try { subject.close() } catch {} }
      rmSync(directory, { recursive: true, force: true })
    }
  })
}


it('Store atomically rolls back continuation inputs, context, subscription and effects on receipt failure', async () => {
  const { Engine, parseSettings, settingsPolicy } = await import('../src/core/index.ts')
  const directory = mkdtempSync(join(tmpdir(), 'myagent-consume-store-'))
  const path = join(directory, 'consume.sqlite3')
  const store = new Store(path)
  const hooks: string[] = []
  const engine = new Engine({ repos: store, tx: store, inputConsumptions: store.inputConsumptions,
    policy: () => settingsPolicy(parseSettings({ acceptMode: 'auto', allowedSenders: ['operator'] })),
    executor: { prepare: ticket => ticket, start: () => { hooks.push('start') }, deliver: () => { hooks.push('deliver') }, stop: () => {} },
    delivery: { report: () => {} }, emit: event => hooks.push(event.type),
  })
  try {
    const main = engine.receive(record('main').trigger).ticketId!
    const ctx = engine.receive(record('ctx').trigger).ticketId!
    const incoming = { ...record('incoming').trigger, threadKey: 'chat:ops:t' }
    const command = { trigger: incoming, target: { ticketId: main, mode: 'answer' as const }, threadKey: incoming.threadKey, contextTicketIds: [ctx] }
    const before = JSON.stringify([store.tickets.list(), store.events.list(main), store.events.list(ctx), store.threads.list(), hooks])
    const save = store.inputConsumptions.save
    store.inputConsumptions.save = () => { throw new Error('receipt failure') }
    expect(() => engine.consumeContinuation(command)).toThrow('receipt failure')
    expect(JSON.stringify([store.tickets.list(), store.events.list(main), store.events.list(ctx), store.threads.list(), hooks])).toBe(before)
    expect(store.inputConsumptions.get(incoming.id)).toBeUndefined()
    store.inputConsumptions.save = save
    expect(engine.consumeContinuation(command).stored).toBe('consumed')
    const reopened = new Store(path)
    try {
      expect(reopened.inputConsumptions.get(incoming.id)?.targets).toHaveLength(2)
      expect(reopened.tickets.get(main)!.inputs).toHaveLength(1)
      expect(reopened.tickets.get(ctx)!.inputs).toHaveLength(1)
    } finally { reopened.close() }
  } finally { store.close(); rmSync(directory, { recursive: true, force: true }) }
})
