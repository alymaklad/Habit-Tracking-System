import type { Habit, HabitDraft, LocalDate } from '@shared/types'
import { isValid } from '../domain/recurrence'
import { targetForLevel } from '../domain/difficulty'
import { todayIn } from '../domain/time'
import { tx, type Db } from '../persistence/db'
import type { HabitRepo } from '../persistence/habitRepo'
import type { OccurrenceRepo } from '../persistence/occurrenceRepo'
import type { LogRepo } from '../persistence/logRepo'
import type { RecordRepo } from '../persistence/recordRepo'
import type { SettingsRepo } from '../persistence/settingsRepo'
import type { ScheduleService } from './scheduleService'
import type { RecomputeService } from './recomputeService'

/**
 * Everything the user can do to a habit or a day, in one place.
 *
 * Each mutation follows the same shape: change the source rows, recompute the affected
 * range, and hand back the ids that need pushing to Google. Nothing here talks to
 * Google directly — the orchestrator owns that, so every action works offline.
 */
export function habitService(deps: {
  db: Db
  habits: HabitRepo
  occurrences: OccurrenceRepo
  logs: LogRepo
  records: RecordRepo
  settings: SettingsRepo
  schedule: ScheduleService
  engine: RecomputeService
}) {
  const { db, habits, occurrences, logs, records, settings, schedule, engine } = deps

  function today(now: Date = new Date()): LocalDate {
    return todayIn(settings.timezone(), now)
  }

  function refreshAround(date: LocalDate, now: Date = new Date()): void {
    const horizon = schedule.horizon(now)
    const from = date < horizon.from ? date : horizon.from
    const to = date > horizon.to ? date : horizon.to
    engine.refresh(from, to, now)
  }

  function validate(draft: HabitDraft): void {
    if (!draft.name.trim()) throw new Error('A habit needs a name')
    if (!isValid(draft.recurrence)) throw new Error('That schedule is not valid')
    if (!/^\d{2}:\d{2}$/.test(draft.scheduledTime)) throw new Error('Time must be HH:MM')
    if (draft.targetMinutes < 1) throw new Error('The target must be at least a minute')
    if (draft.baselineMinutes < 1) throw new Error('The baseline must be at least a minute')
  }

  return {
    list(): Habit[] {
      return habits.list()
    },

    get(id: number): Habit | null {
      return habits.get(id)
    },

    create(draft: HabitDraft, now: Date = new Date()): Habit {
      validate(draft)
      return tx(db, () => {
        const habit = habits.create(draft)
        schedule.reschedule(habit, now)
        refreshAround(today(now), now)
        return habit
      })
    },

    update(id: number, draft: HabitDraft, now: Date = new Date()): { habit: Habit; orphaned: number[] } {
      validate(draft)
      return tx(db, () => {
        const habit = habits.update(id, draft)
        const { orphaned } = schedule.reschedule(habit, now)
        refreshAround(today(now), now)
        return { habit, orphaned }
      })
    },

    setActive(id: number, active: boolean, now: Date = new Date()): void {
      tx(db, () => {
        habits.setActive(id, active)
        const habit = habits.get(id)
        if (habit && active) schedule.reschedule(habit, now)
        refreshAround(today(now), now)
      })
    },

    // ---------------------------------------------------------- a day

    /**
     * Mark an occurrence complete or not from inside the app. Returns the occurrence id
     * so the caller can queue the matching Google patch.
     */
    setCompleted(occurrenceId: number, completed: boolean, now: Date = new Date()): number | null {
      const occ = occurrences.get(occurrenceId)
      if (!occ) return null

      tx(db, () => {
        if (completed) {
          occurrences.setStatus(occ.id, 'complete', now.toISOString())
          // Completing by hand with no timer run credits the target, badged `assumed`.
          if (logs.totalFor(occ.id, now).minutes === 0) {
            logs.setAssumed(occ.habitId, occ.id, occ.targetMinutes, now.toISOString())
          }
        } else {
          occurrences.setStatus(occ.id, 'pending', null)
          logs.clearAssumed(occ.id)
        }
        refreshAround(occ.date, now)
      })

      return occ.id
    },

    setJustifiedSkip(
      occurrenceId: number,
      skip: boolean,
      reason: string | null,
      now: Date = new Date()
    ): void {
      const occ = occurrences.get(occurrenceId)
      if (!occ) return
      tx(db, () => {
        occurrences.setJustifiedSkip(occ.id, skip, reason)
        refreshAround(occ.date, now)
      })
    },

    reschedule(occurrenceId: number, date: LocalDate, time: string, now: Date = new Date()): void {
      const occ = occurrences.get(occurrenceId)
      if (!occ) return
      if (occurrences.getByHabitDate(occ.habitId, date) && date !== occ.date) {
        throw new Error('That day already has this habit scheduled')
      }
      tx(db, () => {
        const oldDate = occ.date
        occurrences.reschedule(occ.id, date, time)
        refreshAround(oldDate, now)
        refreshAround(date, now)
      })
    },

    // ---------------------------------------------------------- timer

    startTimer(occurrenceId: number, now: Date = new Date()): void {
      const occ = occurrences.get(occurrenceId)
      if (!occ) return
      tx(db, () => {
        // Only one timer runs at a time; starting a second stops the first.
        const running = logs.anyRunning()
        if (running?.occurrenceId && running.occurrenceId !== occurrenceId) {
          logs.stop(running.occurrenceId, now.toISOString())
        }
        // A measured run supersedes any assumed credit.
        logs.clearAssumed(occ.id)
        logs.start(occ.habitId, occ.id, now.toISOString())
        refreshAround(occ.date, now)
      })
    },

    stopTimer(occurrenceId: number, now: Date = new Date()): number {
      const occ = occurrences.get(occurrenceId)
      if (!occ) return 0
      return tx(db, () => {
        const minutes = logs.stop(occ.id, now.toISOString())
        refreshAround(occ.date, now)
        return minutes
      })
    },

    addManualMinutes(occurrenceId: number, minutes: number, now: Date = new Date()): void {
      const occ = occurrences.get(occurrenceId)
      if (!occ || minutes <= 0) return
      tx(db, () => {
        logs.clearAssumed(occ.id)
        logs.addManual(occ.habitId, occ.id, Math.round(minutes), now.toISOString())
        refreshAround(occ.date, now)
      })
    },

    runningOccurrenceId(): number | null {
      return logs.anyRunning()?.occurrenceId ?? null
    },

    // ----------------------------------------------------- difficulty

    acceptProposal(proposalId: number, now: Date = new Date()): void {
      const p = records.getProposal(proposalId)
      if (!p) return
      tx(db, () => {
        habits.setDifficulty(p.habit_id, p.proposed_level, p.proposed_target)
        records.resolveProposal(proposalId, 'accepted')
        const habit = habits.get(p.habit_id)
        if (habit) schedule.reschedule(habit, now)
        refreshAround(today(now), now)
      })
    },

    rejectProposal(proposalId: number): void {
      records.resolveProposal(proposalId, 'rejected')
    },

    /** Recompute the difficulty target from the ladder, e.g. after editing a baseline. */
    syncTargetToLevel(habitId: number): void {
      const habit = habits.get(habitId)
      if (!habit) return
      habits.setDifficulty(
        habitId,
        habit.difficultyLevel,
        targetForLevel(habit.baselineMinutes, habit.difficultyLevel)
      )
    }
  }
}

export type HabitService = ReturnType<typeof habitService>
