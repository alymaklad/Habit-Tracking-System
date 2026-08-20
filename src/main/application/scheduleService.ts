import type { Habit, LocalDate } from '@shared/types'
import { addDays, todayIn } from '../domain/time'
import { expand } from '../domain/recurrence'
import type { HabitRepo } from '../persistence/habitRepo'
import type { OccurrenceRepo } from '../persistence/occurrenceRepo'
import type { SettingsRepo } from '../persistence/settingsRepo'
import { tx, type Db } from '../persistence/db'

/**
 * The app owns the schedule. This turns each habit's recurrence into concrete
 * occurrence rows over a rolling horizon.
 *
 * Expansion is idempotent by construction: `occurrenceRepo.ensure` upserts on
 * (habit_id, date) and refuses to touch a row that is no longer pending, so running it
 * every sync neither duplicates rows nor resets a finished day.
 */
export function scheduleService(deps: {
  db: Db
  habits: HabitRepo
  occurrences: OccurrenceRepo
  settings: SettingsRepo
}) {
  const { db, habits, occurrences, settings } = deps

  function horizonEnd(from: LocalDate): LocalDate {
    return addDays(from, Math.max(1, settings.all().provisionHorizonDays))
  }

  return {
    /**
     * Materialise every active habit's occurrences from `from` to the horizon.
     * Also fills in a short window of PAST days so a habit created today still has
     * yesterday's row to score against if the user backfills.
     */
    expandHorizon(now: Date = new Date()): { created: number; from: LocalDate; to: LocalDate } {
      const tz = settings.timezone()
      const today = todayIn(tz, now)
      const from = addDays(today, -1)
      const to = horizonEnd(today)

      let created = 0
      tx(db, () => {
        for (const habit of habits.listActive()) {
          for (const date of expand(habit.recurrence, from, to)) {
            const before = occurrences.getByHabitDate(habit.id, date)
            occurrences.ensure(habit.id, date, habit.scheduledTime, habit.targetMinutes)
            if (!before) created++
          }
        }
      })

      return { created, from, to }
    },

    /**
     * Re-expand one habit after its schedule changed. Only FUTURE pending occurrences
     * are touched — past days and anything already completed are left exactly as they
     * are, so editing a schedule never rewrites history.
     */
    reschedule(habit: Habit, now: Date = new Date()): { added: LocalDate[]; orphaned: number[] } {
      const tz = settings.timezone()
      const today = todayIn(tz, now)
      const to = horizonEnd(today)
      const wanted = expand(habit.recurrence, today, to)

      const added: LocalDate[] = []
      let orphaned: number[] = []

      tx(db, () => {
        for (const date of wanted) {
          if (!occurrences.getByHabitDate(habit.id, date)) added.push(date)
          occurrences.ensure(habit.id, date, habit.scheduledTime, habit.targetMinutes)
        }
        orphaned = occurrences
          .listOrphanedAfter(habit.id, today, wanted)
          .map((o) => o.id)
      })

      return { added, orphaned }
    },

    horizon(now: Date = new Date()): { from: LocalDate; to: LocalDate } {
      const today = todayIn(settings.timezone(), now)
      return { from: today, to: horizonEnd(today) }
    }
  }
}

export type ScheduleService = ReturnType<typeof scheduleService>
