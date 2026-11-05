/** The cron Source's timing: parsing, next-run computation, zone gaps and duplicates. */
import { describe, expect, it } from 'vitest'
import { describeTiming, localToUtc, localZone, nextRun, parseCron, parseTime, zoneParts } from '../src/core/timing.ts'

const at = (iso: string): Date => new Date(iso)

describe('parseTime', () => {
  it('reads HH:mm and HH:mm:ss', () => {
    expect(parseTime('08:00')).toBe(8 * 3600)
    expect(parseTime('23:59:59')).toBe(23 * 3600 + 59 * 60 + 59)
    expect(parseTime(' 0:05 ')).toBe(5 * 60)
  })
  it('refuses what is not a time of day', () => {
    expect(() => parseTime('8am')).toThrow(/Not a time of day/)
    expect(() => parseTime('24:00')).toThrow(/Hour out of range/)
    expect(() => parseTime('12:60')).toThrow(/Minute out of range/)
  })
})

describe('parseCron', () => {
  it('reads stars, lists, ranges and steps', () => {
    const spec = parseCron('*/15 9-17 * * 1-5')
    expect([...spec.minutes].sort((a, b) => a - b)).toEqual([0, 15, 30, 45])
    expect([...spec.hours].sort((a, b) => a - b)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 17])
    expect([...spec.daysOfWeek].sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5])
    expect(spec.domRestricted).toBe(false)
    expect(spec.dowRestricted).toBe(true)
  })
  it('folds a day-of-week of 7 into Sunday 0', () => {
    expect([...parseCron('0 0 * * 7').daysOfWeek]).toEqual([0])
    expect([...parseCron('0 0 * * 0').daysOfWeek]).toEqual([0])
  })
  it('refuses a malformed expression, naming the field', () => {
    expect(() => parseCron('* * *')).toThrow(/has 5 fields, this has 3/)
    expect(() => parseCron('60 * * * *')).toThrow(/minute/)
    expect(() => parseCron('* * 0 * *')).toThrow(/day-of-month/)
    expect(() => parseCron('* * * 13 *')).toThrow(/month/)
    expect(() => parseCron('* * * * 8')).toThrow(/day-of-week/)
    expect(() => parseCron('*/0 * * * *')).toThrow(/Bad step/)
    expect(() => parseCron('1,,2 * * * *')).toThrow(/Empty item/)
  })
})

describe('nextRun', () => {
  it('counts a fixed rate from the instant it is given', () => {
    expect(nextRun({ kind: 'every', seconds: 90 }, at('2026-11-02T12:00:00Z'))).toBe(at('2026-11-02T12:01:30Z').getTime())
  })
  it('refuses a rate that is not a positive whole number of seconds', () => {
    expect(nextRun({ kind: 'every', seconds: 0 }, at('2026-11-02T12:00:00Z'))).toBeUndefined()
  })
  it('finds the next daily instant in UTC', () => {
    expect(nextRun({ kind: 'daily', time: '08:00', timeZone: 'UTC' }, at('2026-11-02T09:00:00Z'))).toBe(at('2026-11-03T08:00:00Z').getTime())
    expect(nextRun({ kind: 'daily', time: '08:00', timeZone: 'UTC' }, at('2026-11-02T07:59:59Z'))).toBe(at('2026-11-02T08:00:00Z').getTime())
  })
  it('finds the next daily instant in a zone east of UTC', () => {
    // 08:00 in Asia/Shanghai is 00:00 UTC.
    expect(nextRun({ kind: 'daily', time: '08:00', timeZone: 'Asia/Shanghai' }, at('2026-11-02T01:00:00Z')))
      .toBe(at('2026-11-03T00:00:00Z').getTime())
  })
  it('fires strictly after the instant it is given, never on it', () => {
    const exact = at('2026-11-02T08:00:00Z')
    expect(nextRun({ kind: 'daily', time: '08:00', timeZone: 'UTC' }, exact)).toBe(at('2026-11-03T08:00:00Z').getTime())
  })
  it('finds the next weekly instant on an ISO weekday', () => {
    // 2026-11-02 is a Monday; the next Friday is 2026-11-06.
    expect(nextRun({ kind: 'weekly', time: '17:30', weekdays: [5], timeZone: 'UTC' }, at('2026-11-02T12:00:00Z')))
      .toBe(at('2026-11-06T17:30:00Z').getTime())
  })
  it('finds the next cron instant of a working-hours schedule', () => {
    // 2026-11-02 is a Monday, 12:07 UTC; the next quarter hour inside 9-17 on a weekday is 12:15.
    expect(nextRun({ kind: 'cron', expression: '*/15 9-17 * * 1-5', timeZone: 'UTC' }, at('2026-11-02T12:07:00Z')))
      .toBe(at('2026-11-02T12:15:00Z').getTime())
  })
  it('rolls over to the next matching day', () => {
    expect(nextRun({ kind: 'cron', expression: '0 9 * * 1-5', timeZone: 'UTC' }, at('2026-11-06T18:00:00Z')))
      .toBe(at('2026-11-09T09:00:00Z').getTime())
  })
  it('matches either day field when both are restricted, as Vixie cron does', () => {
    // The 1st of the month, or any Monday. 2026-11-01 is the 1st (a Sunday), so it wins over Monday 2026-11-02.
    expect(nextRun({ kind: 'cron', expression: '0 0 1 * 1', timeZone: 'UTC' }, at('2026-10-30T00:00:00Z')))
      .toBe(at('2026-11-01T00:00:00Z').getTime())
    // From the 1st itself, the next match is the Monday after it.
    expect(nextRun({ kind: 'cron', expression: '0 0 1 * 1', timeZone: 'UTC' }, at('2026-11-01T00:00:00Z')))
      .toBe(at('2026-11-02T00:00:00Z').getTime())
  })
  it('requires both day fields when only one is restricted', () => {
    // Only Mondays in November; 2026-11-03 is a Tuesday.
    expect(nextRun({ kind: 'cron', expression: '0 0 * 11 1', timeZone: 'UTC' }, at('2026-11-02T12:00:00Z')))
      .toBe(at('2026-11-09T00:00:00Z').getTime())
  })
  it('skips a local time that does not exist in the zone', () => {
    // America/New_York springs forward on 2026-03-08: 02:30 local never happens that day.
    const next = nextRun({ kind: 'daily', time: '02:30', timeZone: 'America/New_York' }, at('2026-03-08T05:00:00Z'))
    expect(next).toBe(at('2026-03-09T06:30:00Z').getTime())
  })
  it('fires once, at the earlier instant, when a local time occurs twice', () => {
    // America/New_York falls back on 2026-11-01: 01:30 local happens at 05:30 UTC and again at 06:30 UTC.
    expect(localToUtc('America/New_York', { year: 2026, month: 11, day: 1, hour: 1, minute: 30, second: 0 }))
      .toBe(at('2026-11-01T05:30:00Z').getTime())
  })
  it('gives up rather than looping forever on a date that cannot occur', () => {
    expect(nextRun({ kind: 'cron', expression: '0 0 30 2 *', timeZone: 'UTC' }, at('2026-11-02T00:00:00Z'))).toBeUndefined()
  })
})

describe('zone helpers', () => {
  it('reads wall-clock parts in a zone', () => {
    expect(zoneParts('Asia/Shanghai', at('2026-11-02T16:00:00Z').getTime())).toMatchObject({ year: 2026, month: 11, day: 3, hour: 0, minute: 0 })
    expect(zoneParts('UTC', at('2026-11-02T16:00:00Z').getTime())).toMatchObject({ year: 2026, month: 11, day: 2, hour: 16 })
  })
  it('refuses a wall-clock reading that is not a date', () => {
    expect(localToUtc('UTC', { year: 2026, month: 2, day: 30, hour: 0, minute: 0, second: 0 })).toBeUndefined()
  })
  it('names the zone this process runs in', () => {
    expect(typeof localZone()).toBe('string')
    expect(localZone().length).toBeGreaterThan(0)
  })
})

describe('describeTiming', () => {
  it('words each kind in one line', () => {
    expect(describeTiming({ kind: 'every', seconds: 900 })).toBe('every 15 min')
    expect(describeTiming({ kind: 'every', seconds: 7200 })).toBe('every 2 h')
    expect(describeTiming({ kind: 'every', seconds: 172800 })).toBe('every 2 d')
    expect(describeTiming({ kind: 'every', seconds: 90 })).toBe('every 90 s')
    expect(describeTiming({ kind: 'daily', time: '08:00', timeZone: 'UTC' })).toBe('daily at 08:00 (UTC)')
    expect(describeTiming({ kind: 'weekly', time: '08:00', weekdays: [5, 1], timeZone: 'UTC' })).toBe('weekly on 1,5 at 08:00 (UTC)')
    expect(describeTiming({ kind: 'cron', expression: '0 9 * * 1-5', timeZone: 'UTC' })).toBe('cron 0 9 * * 1-5 (UTC)')
  })
})
