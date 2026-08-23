import type { LocalDate } from '@shared/types'
import { diffDays, weekday } from './time'

/**
 * The pure half of the to-do list: ordering, carry-forward accounting, pattern
 * suggestions and avoidance detection. No I/O, no clock — `today` is passed in.
 */

export type TodoKind = 'manual' | 'subtask'

export interface TodoFacts {
  id: number
  kind: TodoKind
  title: string
  done: boolean
  dropped: boolean
  /** Manual items only: the day it currently sits on. */
  date: LocalDate | null
  /** Manual items only: the day it was first added. */
  createdOn: LocalDate | null
  /** Subtasks only: the scheduled time of the habit they belong to. */
  scheduledTime: string | null
  habitId: number | null
  position: number
}

/** How many days an item has been pushed forward without being finished. */
export function carriedDays(item: Pick<TodoFacts, 'date' | 'createdOn'>): number {
  if (!item.date || !item.createdOn) return 0
  return Math.max(0, diffDays(item.createdOn, item.date))
}

/** Past its scheduled time and still open. */
export function isOverdue(
  item: Pick<TodoFacts, 'done' | 'dropped' | 'scheduledTime' | 'date'>,
  today: LocalDate,
  nowMinutes: number
): boolean {
  if (item.done || item.dropped) return false
  if (item.date && item.date < today) return true
  if (!item.scheduledTime) return false
  const [h, m] = item.scheduledTime.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0) < nowMinutes
}

/**
 * Urgency ordering.
 *
 * Overdue first, then timed items by their time, then untimed ones, then anything
 * finished. Carried items sort ahead of fresh ones within the untimed group, so the
 * thing you have been avoiding is the thing you see.
 */
export function orderByUrgency(
  items: TodoFacts[],
  today: LocalDate,
  nowMinutes: number
): TodoFacts[] {
  const rank = (t: TodoFacts): number => {
    if (t.done || t.dropped) return 4
    if (isOverdue(t, today, nowMinutes)) return 0
    return t.scheduledTime ? 1 : 2
  }

  return [...items].sort((a, b) => {
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb

    // Within timed items, earliest first.
    if (a.scheduledTime && b.scheduledTime && a.scheduledTime !== b.scheduledTime) {
      return a.scheduledTime < b.scheduledTime ? -1 : 1
    }

    // Within untimed items, the longest-carried first.
    const ca = carriedDays(a)
    const cb = carriedDays(b)
    if (ca !== cb) return cb - ca

    if (a.position !== b.position) return a.position - b.position
    return a.id - b.id
  })
}

// ------------------------------------------------------------ avoidance

/** Carrying something this many days without doing it is worth saying out loud. */
export const AVOIDANCE_DAYS = 3

export interface AvoidanceFlag {
  todoId: number
  title: string
  carried: number
  message: string
}

export function detectAvoidance(items: TodoFacts[]): AvoidanceFlag[] {
  return items
    .filter((t) => !t.done && !t.dropped && carriedDays(t) >= AVOIDANCE_DAYS)
    .map((t) => {
      const carried = carriedDays(t)
      return {
        todoId: t.id,
        title: t.title,
        carried,
        message: `Carried ${carried} days without being done. Reschedule it, break it into smaller steps, or drop it.`
      }
    })
    .sort((a, b) => b.carried - a.carried)
}

// ----------------------------------------------------------- suggestions

/** Weekday occurrences needed before a repeat counts as a pattern rather than noise. */
export const SUGGESTION_MIN_HITS = 3
/** How much of the recent history the pattern has to cover. */
export const SUGGESTION_MIN_RATIO = 0.6

export interface HistoryEntry {
  title: string
  date: LocalDate
}

export interface Suggestion {
  title: string
  weekday: number
  hits: number
  opportunities: number
  reason: string
}

const normalise = (title: string): string => title.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * Items you keep adding on the same weekday.
 *
 * Deliberately conservative: a suggestion has to have appeared on at least three of
 * that weekday and on most of them. A list that guesses wrong is worse than one that
 * stays quiet, because every wrong guess is something to dismiss.
 */
export function suggestFromHistory(
  history: HistoryEntry[],
  today: LocalDate,
  alreadyPresent: string[] = []
): Suggestion[] {
  const targetWeekday = weekday(today)
  const present = new Set(alreadyPresent.map(normalise))

  // Count, per title, how many of that weekday it appeared on.
  const hitsByTitle = new Map<string, { title: string; dates: Set<LocalDate> }>()
  const weekdayDates = new Set<LocalDate>()

  for (const entry of history) {
    if (entry.date >= today) continue
    if (weekday(entry.date) !== targetWeekday) continue
    weekdayDates.add(entry.date)

    const key = normalise(entry.title)
    if (!key) continue
    const found = hitsByTitle.get(key) ?? { title: entry.title, dates: new Set<LocalDate>() }
    found.dates.add(entry.date)
    hitsByTitle.set(key, found)
  }

  const opportunities = weekdayDates.size
  if (opportunities === 0) return []

  const out: Suggestion[] = []
  for (const [key, found] of hitsByTitle) {
    if (present.has(key)) continue
    const hits = found.dates.size
    if (hits < SUGGESTION_MIN_HITS) continue
    if (hits / opportunities < SUGGESTION_MIN_RATIO) continue
    out.push({
      title: found.title,
      weekday: targetWeekday,
      hits,
      opportunities,
      reason: `You added this on ${hits} of the last ${opportunities} ${WEEKDAY_NAMES[targetWeekday]}s.`
    })
  }

  return out.sort((a, b) => b.hits - a.hits).slice(0, 3)
}

const WEEKDAY_NAMES: Record<number, string> = {
  1: 'Monday',
  2: 'Tuesday',
  3: 'Wednesday',
  4: 'Thursday',
  5: 'Friday',
  6: 'Saturday',
  7: 'Sunday'
}

// ----------------------------------------------------------- roll-up

/**
 * Whether an occurrence's subtasks say the habit is finished.
 *
 * `null` means "no opinion" — an occurrence with no subtasks is completed the usual
 * ways (the Done button, the timer, or a tick in Google), and this must not override
 * that. Only an occurrence that actually has steps gets an opinion about them.
 */
export function subtasksSayComplete(subtasks: Pick<TodoFacts, 'done' | 'dropped'>[]): boolean | null {
  const live = subtasks.filter((s) => !s.dropped)
  if (live.length === 0) return null
  return live.every((s) => s.done)
}
