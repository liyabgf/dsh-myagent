/**
 * Timing for the cron Source: five-field Vixie cron expressions, daily, weekly and fixed-rate schedules, and the
 * next instant each one fires. Pure and testable; it knows nothing about Triggers or the Store.
 *
 * Zone rules, matching DSH's own scheduler: a local time that does not exist in the zone (a spring-forward gap) is
 * skipped, and a local time that occurs twice (an autumn fallback) fires once, at the earlier instant.
 */

/** When a schedule fires. `time` is `HH:mm` or `HH:mm:ss`; `timeZone` is `UTC` or an IANA `Area/Location`. */
export type Timing =
  | { readonly kind: 'every'; readonly seconds: number }
  | { readonly kind: 'daily'; readonly time: string; readonly timeZone?: string }
  | { readonly kind: 'weekly'; readonly time: string; readonly weekdays: readonly number[]; readonly timeZone?: string }
  | { readonly kind: 'cron'; readonly expression: string; readonly timeZone?: string }

/** A parsed cron expression: the value sets of its five fields, and which of the two day fields it restricted. */
export interface CronSpec {
  readonly minutes: ReadonlySet<number>
  readonly hours: ReadonlySet<number>
  readonly daysOfMonth: ReadonlySet<number>
  readonly months: ReadonlySet<number>
  readonly daysOfWeek: ReadonlySet<number>
  /** True when the day-of-month field named values rather than `*`. */
  readonly domRestricted: boolean
  /** True when the day-of-week field named values rather than `*`. */
  readonly dowRestricted: boolean
}

/** Local wall-clock parts of one instant in one zone. */
export interface ZoneParts {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
}

/** How many days ahead `nextRun` looks for a matching instant before it gives up. */
const HORIZON_DAYS = 400
/** Cached `Intl.DateTimeFormat` per zone; constructing one is measurably slower than formatting with it. */
const formats = new Map<string, Intl.DateTimeFormat>()

/** The zone this process runs in, the default of a schedule that names none. */
export function localZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
}

function formatOf(zone: string): Intl.DateTimeFormat {
  let format = formats.get(zone)
  if (format === undefined) {
    format = new Intl.DateTimeFormat('en-US', {
      timeZone: zone, hour12: false, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    })
    formats.set(zone, format)
  }
  return format
}

/** Read an instant's wall-clock parts in `zone`. An ICU midnight hour of `24` is folded to `0`. */
export function zoneParts(zone: string, ms: number): ZoneParts {
  const parts: Record<string, string> = {}
  for (const part of formatOf(zone).formatToParts(new Date(ms))) if (part.type !== 'literal') parts[part.type] = part.value
  return {
    year: Number(parts.year), month: Number(parts.month), day: Number(parts.day),
    hour: Number(parts.hour) % 24, minute: Number(parts.minute), second: Number(parts.second),
  }
}

/** `zone`'s offset from UTC at `ms`, in milliseconds, as local-minus-UTC. */
function offsetOf(zone: string, ms: number): number {
  const parts = zoneParts(zone, ms)
  return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second) - ms
}

/**
 * The instant at which `zone`'s wall clock reads `local`, or `undefined` when that local time does not exist there.
 * Refines the offset once across a DST boundary, and verifies by reading the result back.
 */
export function localToUtc(zone: string, local: ZoneParts): number | undefined {
  const asIfUtc = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, local.second)
  // A wall-clock reading that is not representable, such as February 30, is refused before any zone work.
  const roundTrip = new Date(asIfUtc)
  if (roundTrip.getUTCFullYear() !== local.year || roundTrip.getUTCMonth() !== local.month - 1
    || roundTrip.getUTCDate() !== local.day) return undefined
  for (const candidate of [asIfUtc - offsetOf(zone, asIfUtc), asIfUtc - offsetOf(zone, asIfUtc - offsetOf(zone, asIfUtc))]) {
    const back = zoneParts(zone, candidate)
    if (back.year === local.year && back.month === local.month && back.day === local.day
      && back.hour === local.hour && back.minute === local.minute && back.second === local.second) return candidate
  }
  return undefined
}

/** Parse `HH:mm` or `HH:mm:ss` into seconds since local midnight. @throws for any other shape. */
/** Whether a name names a time zone `Intl` accepts, which is what `nextRun` throws on when it does not. */
export function knownTimeZone(zone: string): boolean {
  try { new Intl.DateTimeFormat('en', { timeZone: zone }); return true } catch { return false }
}

export function parseTime(text: string): number {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(text.trim())
  if (match === null) throw new Error(`Not a time of day: ${JSON.stringify(text)}; expected HH:mm or HH:mm:ss`)
  const hour = Number(match[1]), minute = Number(match[2]), second = Number(match[3] ?? '0')
  if (hour > 23) throw new Error(`Hour out of range in ${JSON.stringify(text)}`)
  if (minute > 59) throw new Error(`Minute out of range in ${JSON.stringify(text)}`)
  if (second > 59) throw new Error(`Second out of range in ${JSON.stringify(text)}`)
  return hour * 3600 + minute * 60 + second
}

/** One cron field's values within `[min, max]`, supporting `*`, lists, ranges and steps. */
function field(text: string, min: number, max: number, name: string, wrap?: [number, number]): Set<number> {
  const values = new Set<number>()
  for (const item of text.split(',')) {
    const part = item.trim()
    if (part === '') throw new Error(`Empty item in the ${name} field`)
    const [range, stepText, ...rest] = part.split('/')
    if (rest.length > 0) throw new Error(`Malformed item ${JSON.stringify(item)} in the ${name} field`)
    const step = stepText === undefined ? 1 : Number(stepText)
    if (!Number.isInteger(step) || step < 1) throw new Error(`Bad step in ${JSON.stringify(item)} in the ${name} field`)
    let low: number, high: number
    if (range === undefined) throw new Error(`Malformed item ${JSON.stringify(item)} in the ${name} field`)
    if (range === '*') { low = min; high = max }
    else if (range.includes('-')) {
      const [lowText, highText] = range.split('-')
      low = Number(lowText); high = Number(highText)
    }
    else { low = Number(range); high = stepText === undefined ? low : max }
    if (!Number.isInteger(low) || !Number.isInteger(high)) throw new Error(`Malformed item ${JSON.stringify(item)} in the ${name} field`)
    // A day-of-week of 7 is Sunday, the same day as 0.
    if (wrap !== undefined) {
      if (low === wrap[1]) low = wrap[0]
      if (high === wrap[1]) high = wrap[0]
    }
    if (low < min || high > max || low > high) throw new Error(`Value out of range in ${JSON.stringify(item)} in the ${name} field`)
    for (let value = low; value <= high; value += step) values.add(value)
  }
  return values
}

/**
 * Parse a five-field Vixie cron expression: minute, hour, day-of-month, month, day-of-week.
 * When both day fields are restricted, a day matches if either one does, as Vixie cron does.
 * @throws with the offending field named.
 */
export function parseCron(expression: string): CronSpec {
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) throw new Error(`A cron expression has 5 fields, this has ${fields.length}: ${JSON.stringify(expression)}`)
  const [minute, hour, dom, month, dow] = fields as [string, string, string, string, string]
  return {
    minutes: field(minute, 0, 59, 'minute'),
    hours: field(hour, 0, 23, 'hour'),
    daysOfMonth: field(dom, 1, 31, 'day-of-month'),
    months: field(month, 1, 12, 'month'),
    daysOfWeek: field(dow, 0, 6, 'day-of-week', [0, 7]),
    domRestricted: dom !== '*',
    dowRestricted: dow !== '*',
  }
}

/** Whether one calendar day matches a cron spec's two day fields, by Vixie's OR rule when both are restricted. */
function dayMatches(spec: CronSpec, month: number, dayOfMonth: number, dayOfWeek: number): boolean {
  if (!spec.months.has(month)) return false
  const dom = spec.daysOfMonth.has(dayOfMonth), dow = spec.daysOfWeek.has(dayOfWeek)
  return spec.domRestricted && spec.dowRestricted ? dom || dow : dom && dow
}

/** ISO weekday (Monday 1 … Sunday 7) of a UTC-constructed calendar date. */
function isoWeekday(year: number, month: number, day: number): number {
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay()
  return weekday === 0 ? 7 : weekday
}

const sorted = (values: ReadonlySet<number>): number[] => [...values].sort((a, b) => a - b)

/**
 * The next instant strictly after `from` at which `timing` fires, or `undefined` when it never fires again within
 * {@link HORIZON_DAYS}. A fixed rate counts from `from`, so its caller stores the instant it used as the base.
 */
export function nextRun(timing: Timing, from: Date): number | undefined {
  if (timing.kind === 'every') {
    if (!Number.isInteger(timing.seconds) || timing.seconds < 1) return undefined
    return from.getTime() + timing.seconds * 1000
  }
  const zone = timing.timeZone ?? localZone()
  if (timing.kind === 'cron') return nextCron(parseCron(timing.expression), from.getTime(), zone)
  const secondsOfDay = parseTime(timing.time)
  const hour = Math.floor(secondsOfDay / 3600), minute = Math.floor(secondsOfDay % 3600 / 60), second = secondsOfDay % 60
  const fromParts = zoneParts(zone, from.getTime())
  for (let offset = 0; offset <= HORIZON_DAYS; offset++) {
    const date = new Date(Date.UTC(fromParts.year, fromParts.month - 1, fromParts.day + offset))
    const year = date.getUTCFullYear(), month = date.getUTCMonth() + 1, day = date.getUTCDate()
    if (timing.kind === 'weekly' && !timing.weekdays.includes(isoWeekday(year, month, day))) continue
    const utc = localToUtc(zone, { year, month, day, hour, minute, second })
    if (utc !== undefined && utc > from.getTime()) return utc
  }
  return undefined
}

/** The next instant strictly after `from` at which a parsed cron expression fires in `zone`. */
export function nextCron(spec: CronSpec, fromMs: number, zone: string): number | undefined {
  const fromParts = zoneParts(zone, fromMs)
  const minutes = sorted(spec.minutes), hours = sorted(spec.hours)
  for (let offset = 0; offset <= HORIZON_DAYS; offset++) {
    const date = new Date(Date.UTC(fromParts.year, fromParts.month - 1, fromParts.day + offset))
    const year = date.getUTCFullYear(), month = date.getUTCMonth() + 1, day = date.getUTCDate()
    if (!dayMatches(spec, month, day, new Date(Date.UTC(year, month - 1, day)).getUTCDay())) continue
    for (const hour of hours) {
      for (const minute of minutes) {
        const utc = localToUtc(zone, { year, month, day, hour, minute, second: 0 })
        if (utc !== undefined && utc > fromMs) return utc
      }
    }
  }
  return undefined
}

/** A one-line English description of `timing`, for the panel and for a Ticket's origin note. */
export function describeTiming(timing: Timing): string {
  // Only the timings that name a wall clock carry a zone; an interval has none.
  const zone = 'timeZone' in timing ? timing.timeZone ?? localZone() : localZone()
  switch (timing.kind) {
    case 'every': {
      const seconds = timing.seconds
      return seconds % 86400 === 0 ? `every ${seconds / 86400} d`
        : seconds % 3600 === 0 ? `every ${seconds / 3600} h`
          : seconds % 60 === 0 ? `every ${seconds / 60} min` : `every ${seconds} s`
    }
    case 'daily': return `daily at ${timing.time} (${zone})`
    case 'weekly': return `weekly on ${timing.weekdays.slice().sort((a, b) => a - b).join(',')} at ${timing.time} (${zone})`
    case 'cron': return `cron ${timing.expression} (${zone})`
  }
}
