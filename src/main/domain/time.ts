import { DateTime } from 'luxon'
import type { Iso, LocalDate, LocalTime } from '@shared/types'

/**
 * All "which day is this" decisions go through here.
 *
 * Two rules this module exists to enforce:
 *  1. Instants are stored as UTC ISO strings; calendar dates are stored as plain
 *     `YYYY-MM-DD` strings and are never round-tripped through a Date.
 *  2. A Google Task's `due` is DATE-ONLY and comes back as midnight UTC. Running it
 *     through a timezone conversion shifts it a day for anyone west of UTC, so it is
 *     parsed by slicing the date portion — never by interpreting it as an instant.
 */

export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

export function assertLocalDate(d: string): LocalDate {
  if (!DATE_RE.test(d)) throw new Error(`not a local date: ${d}`)
  return d
}

/** The calendar date `instant` falls on, in `tz`. */
export function toLocalDate(instant: Iso | Date, tz: string): LocalDate {
  const dt = instant instanceof Date
    ? DateTime.fromJSDate(instant, { zone: tz })
    : DateTime.fromISO(instant, { zone: tz })
  return dt.toISODate()!
}

export function todayIn(tz: string, now: Date = new Date()): LocalDate {
  return toLocalDate(now, tz)
}

/** The instant at which `date` + `time` occurs in `tz`. Handles DST via luxon. */
export function localToInstant(date: LocalDate, time: LocalTime, tz: string): Iso {
  const [h, m] = time.split(':').map(Number)
  return DateTime.fromISO(date, { zone: tz })
    .set({ hour: h ?? 0, minute: m ?? 0, second: 0, millisecond: 0 })
    .toUTC()
    .toISO()!
}

// ------------------------------------------------------- Google due dates

/**
 * Read a Google Task `due` value as a calendar date.
 *
 * The API documents `due` as date-only ("the time portion of the timestamp is
 * discarded") and returns it as `YYYY-MM-DDT00:00:00.000Z`. Slicing is deliberate:
 * `DateTime.fromISO(due).setZone(tz).toISODate()` would return the PREVIOUS day for
 * every user in a negative UTC offset.
 */
export function parseGoogleDue(due: string | null | undefined): LocalDate | null {
  if (!due) return null
  const head = due.slice(0, 10)
  return DATE_RE.test(head) ? head : null
}

/** Write a calendar date as the `due` value Google expects. */
export function toGoogleDue(date: LocalDate): string {
  return `${assertLocalDate(date)}T00:00:00.000Z`
}

// ------------------------------------------------------------- arithmetic

export function addDays(date: LocalDate, n: number): LocalDate {
  return DateTime.fromISO(date, { zone: 'utc' }).plus({ days: n }).toISODate()!
}

export function diffDays(from: LocalDate, to: LocalDate): number {
  const a = DateTime.fromISO(from, { zone: 'utc' })
  const b = DateTime.fromISO(to, { zone: 'utc' })
  return Math.round(b.diff(a, 'days').days)
}

/** ISO weekday, Monday = 1 … Sunday = 7. */
export function weekday(date: LocalDate): number {
  return DateTime.fromISO(date, { zone: 'utc' }).weekday
}

/**
 * The Saturday that starts the user's week containing `date`.
 *
 * Deliberately not the ISO week (Monday). This user's week runs Sat–Fri — Saturday is
 * the first workday after Friday's day off — so every weekly aggregation (point
 * totals, the weekly review, the weekly target) anchors here instead of the
 * calendar-standard Monday.
 */
export function weekStart(date: LocalDate): LocalDate {
  const back = (weekday(date) - 6 + 7) % 7
  return addDays(date, -back)
}

/** True ISO week number (Monday-based). Kept as a general utility, not used for the
 *  app's own week labels — those are Saturday-anchored and an ISO number would no
 *  longer describe the same span. */
export function isoWeekNumber(date: LocalDate): number {
  return DateTime.fromISO(date, { zone: 'utc' }).weekNumber
}

/** "Aug 22–28", or "Aug 29 – Sep 4" when the week crosses a month (or year) boundary. */
export function formatWeekLabel(start: LocalDate): string {
  const end = addDays(start, 6)
  const s = DateTime.fromISO(start, { zone: 'utc' })
  const e = DateTime.fromISO(end, { zone: 'utc' })
  if (s.month === e.month) return `${s.toFormat('LLL')} ${s.day}–${e.day}`
  const yearSuffix = s.year === e.year ? '' : `, ${e.year}`
  return `${s.toFormat('LLL')} ${s.day} – ${e.toFormat('LLL')} ${e.day}${yearSuffix}`
}

export function monthStart(date: LocalDate): LocalDate {
  return DateTime.fromISO(date, { zone: 'utc' }).startOf('month').toISODate()!
}

export function daysInMonth(date: LocalDate): number {
  return DateTime.fromISO(date, { zone: 'utc' }).daysInMonth!
}

/** Inclusive range of calendar dates. */
export function dateRange(from: LocalDate, to: LocalDate): LocalDate[] {
  const out: LocalDate[] = []
  const n = diffDays(from, to)
  for (let i = 0; i <= n; i++) out.push(addDays(from, i))
  return out
}

// ------------------------------------------------------------ formatting

export function formatDayLabel(date: LocalDate): string {
  return DateTime.fromISO(date, { zone: 'utc' }).toFormat('cccc d LLLL')
}

/** "1m ago", "just now", "2d ago" — for the sync status control. */
export function formatRelative(from: Iso | null, now: Date = new Date()): string {
  if (!from) return 'never'
  const ms = now.getTime() - new Date(from).getTime()
  if (ms < 0) return 'just now'
  const s = Math.floor(ms / 1000)
  if (s < 45) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${Math.max(m, 1)}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

/** "< 1m", "3m", "due now" — countdown for the next scheduled sync. */
export function formatCountdown(to: Iso | null, now: Date = new Date()): string {
  if (!to) return '—'
  const ms = new Date(to).getTime() - now.getTime()
  if (ms <= 0) return 'due now'
  const m = Math.floor(ms / 60000)
  if (m < 1) return '< 1m'
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h`
}

export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rem = m % 60
  return rem === 0 ? `${h}h` : `${h}h ${String(rem).padStart(2, '0')}m`
}

export function formatClock(time: LocalTime): string {
  return time
}
