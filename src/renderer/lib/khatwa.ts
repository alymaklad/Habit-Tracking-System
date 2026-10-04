import type { GoalPlan, GoalView, Habit, LocalDate, OccurrenceStatus } from '@shared/types'
import { addDays, toLocalDate } from './format'

export function today(): LocalDate {
  return toLocalDate(new Date())
}

export function greeting(now = new Date()): string {
  const h = now.getHours()
  if (h < 5) return 'Good evening'
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

export function longDate(date: LocalDate): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
}

export function monthYear(date: LocalDate): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export function shortMonthYear(date: LocalDate): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })
}

export function dayMonth(date: LocalDate): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

/** `16:00` → `4:00 PM`, in the user's locale. */
export function time12(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number)
  const d = new Date()
  d.setHours(h ?? 0, m ?? 0, 0, 0)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

const ROMAN: [number, string][] = [
  [1000, 'M'],
  [900, 'CM'],
  [500, 'D'],
  [400, 'CD'],
  [100, 'C'],
  [90, 'XC'],
  [50, 'L'],
  [40, 'XL'],
  [10, 'X'],
  [9, 'IX'],
  [5, 'V'],
  [4, 'IV'],
  [1, 'I']
]

export function roman(n: number): string {
  let rest = Math.max(1, Math.floor(n))
  let out = ''
  for (const [v, s] of ROMAN) {
    while (rest >= v) {
      out += s
      rest -= v
    }
  }
  return out
}

/** Days between two local dates, b − a. */
export function daysBetween(a: LocalDate, b: LocalDate): number {
  const ms = new Date(`${b}T12:00:00`).getTime() - new Date(`${a}T12:00:00`).getTime()
  return Math.round(ms / 86_400_000)
}

/** The seven dates of the Saturday-to-Friday week that begins on `saturday`. */
export function weekDates(saturday: LocalDate): LocalDate[] {
  return Array.from({ length: 7 }, (_, i) => addDays(saturday, i))
}

/** ISO weekday, Monday = 1 … Sunday = 7. */
export function isoWeekday(date: LocalDate): number {
  const d = new Date(`${date}T12:00:00`).getDay()
  return d === 0 ? 7 : d
}

export function weekdayShort(date: LocalDate): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })
}

/** How many times a habit is scheduled in a Saturday-to-Friday week. */
export function sessionsPerWeek(habit: Pick<Habit, 'recurrence'>): number {
  const r = habit.recurrence
  if (r.kind === 'weekly') return r.days.length
  return Math.max(1, Math.round(7 / r.n))
}

export function isScheduledOn(habit: Pick<Habit, 'recurrence'>, date: LocalDate): boolean {
  const r = habit.recurrence
  if (r.kind === 'weekly') return r.days.includes(isoWeekday(date))
  const diff = daysBetween(r.anchor, date)
  return diff >= 0 && diff % r.n === 0
}

/**
 * An occurrence nobody ticked keeps the status `pending` even after its day has passed;
 * for display, a past pending day is a missed one.
 */
export function effectiveStatus<T extends { status: OccurrenceStatus; date: LocalDate }>(o: T, now: LocalDate = today()): OccurrenceStatus {
  return o.status === 'pending' && o.date < now ? 'missed' : o.status
}

/** The next milestone still to be reached, or null once they are all done. */
export function currentMilestone(goal: GoalView): GoalView['milestones'][number] | null {
  const open = goal.milestones
    .filter((m) => !m.done && !m.dropped)
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'))
  return open[0] ?? null
}

export function goalProgress(goal: GoalView): number {
  return goal.milestonesTotal > 0 ? goal.milestonesDone / goal.milestonesTotal : 0
}

export function plural(n: number, one: string, many = `${one}s`): string {
  return `${n} ${n === 1 ? one : many}`
}

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/)[0] ?? ''
}

export function initial(displayName: string): string {
  return (displayName.trim()[0] ?? 'K').toUpperCase()
}

/**
 * Moves a camp along the ridge. Dates stay in climbing order: the date slots are kept,
 * and each camp takes the slot of the place it lands in.
 */
export function moveMilestone(milestones: GoalPlan['milestones'], from: number, to: number): GoalPlan['milestones'] {
  if (from === to || to < 0 || to >= milestones.length) return milestones
  const slots = milestones.map((m) => m.dueDate).sort()
  const next = [...milestones]
  const [moved] = next.splice(from, 1)
  next.splice(to, 0, moved!)
  return next.map((m, i) => ({ ...m, dueDate: slots[i]! }))
}
