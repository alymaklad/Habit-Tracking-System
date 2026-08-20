import type { LocalDate, OccurrenceStatus, StreakInfo } from '@shared/types'

export interface StreakDay {
  date: LocalDate
  status: OccurrenceStatus
}

/**
 * Streaks count SCHEDULED days only, so a habit that runs Mon–Fri is not broken by
 * the weekend.
 *
 *  - `complete` extends the streak
 *  - `skipped` (a justified skip) is neutral — it neither extends nor breaks, which is
 *    the whole point of marking a day off as justified
 *  - `partial` and `missed` break it
 *  - `pending` is unresolved, so trailing pending days are ignored rather than
 *    treated as a break — today being unfinished must not reset a live streak
 */
export function computeStreaks(days: StreakDay[]): StreakInfo {
  const ordered = [...days].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))

  let longest = 0
  let run = 0
  for (const d of ordered) {
    if (d.status === 'complete') {
      run++
      if (run > longest) longest = run
    } else if (d.status === 'skipped' || d.status === 'pending') {
      // neutral
    } else {
      run = 0
    }
  }

  // Current streak walks backwards from the last resolved day.
  let current = 0
  for (let i = ordered.length - 1; i >= 0; i--) {
    const s = ordered[i]!.status
    if (s === 'pending' || s === 'skipped') continue
    if (s === 'complete') current++
    else break
  }

  return { current, longest: Math.max(longest, current) }
}
