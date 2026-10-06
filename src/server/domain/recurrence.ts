import type { LocalDate, Recurrence } from '@shared/types'
import { addDays, dateRange, diffDays, weekday } from './time'

/** Does this habit's schedule place an occurrence on `date`? */
export function occursOn(rec: Recurrence, date: LocalDate): boolean {
  if (rec.kind === 'weekly') {
    return rec.days.includes(weekday(date))
  }
  if (rec.n <= 0) return false
  const delta = diffDays(rec.anchor, date)
  return delta >= 0 && delta % rec.n === 0
}

/** Every scheduled date in `[from, to]`, inclusive. */
export function expand(rec: Recurrence, from: LocalDate, to: LocalDate): LocalDate[] {
  if (diffDays(from, to) < 0) return []
  return dateRange(from, to).filter((d) => occursOn(rec, d))
}

/** The next scheduled date strictly after `date`, or null within `lookahead` days. */
export function nextAfter(rec: Recurrence, date: LocalDate, lookahead = 366): LocalDate | null {
  for (let i = 1; i <= lookahead; i++) {
    const d = addDays(date, i)
    if (occursOn(rec, d)) return d
  }
  return null
}

/** How many occurrences the schedule places in `[from, to]`. */
export function countIn(rec: Recurrence, from: LocalDate, to: LocalDate): number {
  return expand(rec, from, to).length
}

const DAY_NAMES = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function describe(rec: Recurrence): string {
  if (rec.kind === 'everyN') {
    return rec.n === 1 ? 'Daily' : `Every ${rec.n} days`
  }
  const days = [...rec.days].sort((a, b) => a - b)
  if (days.length === 7) return 'Daily'
  if (days.length === 5 && days.every((d) => d <= 5)) return 'Mon–Fri'
  if (days.length === 2 && days[0] === 6 && days[1] === 7) return 'Weekends'
  return days.map((d) => DAY_NAMES[d]).join('/')
}

export function isValid(rec: Recurrence): boolean {
  if (rec.kind === 'weekly') {
    return rec.days.length > 0 && rec.days.every((d) => Number.isInteger(d) && d >= 1 && d <= 7)
  }
  return Number.isInteger(rec.n) && rec.n >= 1 && /^\d{4}-\d{2}-\d{2}$/.test(rec.anchor)
}
