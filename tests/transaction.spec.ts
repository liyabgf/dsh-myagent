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
import { describe, expect, it } from 'vitest'
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
