import type { Habit, HabitDraft, LocalDate } from '@shared/types'
import { isValid } from '../domain/recurrence'
import { targetForLevel } from '../domain/difficulty'
import { todayIn } from '../domain/time'
import type { Db } from '../persistence/db'
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

  async function today(now: Date = new Date()): Promise<LocalDate> {
    return todayIn(await settings.timezone(), now)
  }

  async function refreshAround(date: LocalDate, now: Date = new Date()): Promise<void> {
    const horizon = await schedule.horizon(now)
    const from = date < horizon.from ? date : horizon.from
    const to = date > horizon.to ? date : horizon.to
    await engine.refresh(from, to, now)
  }

  function validate(draft: HabitDraft): void {
    if (!draft.name.trim()) throw new Error('A habit needs a name')
    if (!isValid(draft.recurrence)) throw new Error('That schedule is not valid')
    if (!/^\d{2}:\d{2}$/.test(draft.scheduledTime)) throw new Error('Time must be HH:MM')
    if (draft.targetMinutes < 1) throw new Error('The target must be at least a minute')
    if (draft.baselineMinutes < 1) throw new Error('The baseline must be at least a minute')
  }

  return {
    async list(): Promise<Habit[]> {
      return habits.list()
    },

    async get(id: number): Promise<Habit | null> {
      return habits.get(id)
    },

    async create(draft: HabitDraft, now: Date = new Date()): Promise<Habit> {
      validate(draft)
      return db.transaction(async () => {
        const habit = await habits.create(draft)
        await schedule.reschedule(habit, now)
        await refreshAround(await today(now), now)
        return habit
      })
    },

    async update(id: number, draft: HabitDraft, now: Date = new Date()): Promise<{ habit: Habit; orphaned: number[] }> {
      validate(draft)
      return db.transaction(async () => {
        const habit = await habits.update(id, draft)
        const { orphaned } = await schedule.reschedule(habit, now)
        await refreshAround(await today(now), now)
        return { habit, orphaned }
      })
    },

    async setActive(id: number, active: boolean, now: Date = new Date()): Promise<void> {
      await db.transaction(async () => {
        await habits.setActive(id, active)
        const habit = await habits.get(id)
        if (habit && active) await schedule.reschedule(habit, now)
        await refreshAround(await today(now), now)
      })
    },

    // ---------------------------------------------------------- a day

    /**
     * Mark an occurrence complete or not from inside the app. Returns the occurrence id
     * so the caller can queue the matching Google patch.
     */
    async setCompleted(occurrenceId: number, completed: boolean, now: Date = new Date()): Promise<number | null> {
      const occ = await occurrences.get(occurrenceId)
      if (!occ) return null

      await db.transaction(async () => {
        if (completed) {
          await occurrences.setStatus(occ.id, 'complete', now.toISOString())
          // Completing by hand with no timer run credits the target, badged `assumed`.
          if ((await logs.totalFor(occ.id, now)).minutes === 0) {
            await logs.setAssumed(occ.habitId, occ.id, occ.targetMinutes, now.toISOString())
          }
        } else {
          await occurrences.setStatus(occ.id, 'pending', null)
          await logs.clearAssumed(occ.id)
        }
        await refreshAround(occ.date, now)
      })

      return occ.id
    },

    async setJustifiedSkip(
      occurrenceId: number,
      skip: boolean,
      reason: string | null,
      now: Date = new Date()
    ): Promise<void> {
      const occ = await occurrences.get(occurrenceId)
      if (!occ) return
      await db.transaction(async () => {
        await occurrences.setJustifiedSkip(occ.id, skip, reason)
        await refreshAround(occ.date, now)
      })
    },

    async reschedule(occurrenceId: number, date: LocalDate, time: string, now: Date = new Date()): Promise<void> {
      const occ = await occurrences.get(occurrenceId)
      if (!occ) return
      if ((await occurrences.getByHabitDate(occ.habitId, date)) && date !== occ.date) {
        throw new Error('That day already has this habit scheduled')
      }
      await db.transaction(async () => {
        const oldDate = occ.date
        await occurrences.reschedule(occ.id, date, time)
        await refreshAround(oldDate, now)
        await refreshAround(date, now)
      })
    },

    // ---------------------------------------------------------- timer

    async startTimer(occurrenceId: number, now: Date = new Date()): Promise<void> {
      const occ = await occurrences.get(occurrenceId)
      if (!occ) return
      await db.transaction(async () => {
        // Only one timer runs at a time; starting a second stops the first.
        const running = await logs.anyRunning()
        if (running?.occurrenceId && running.occurrenceId !== occurrenceId) {
          await logs.stop(running.occurrenceId, now.toISOString())
        }
        // A measured run supersedes any assumed credit.
        await logs.clearAssumed(occ.id)
        await logs.start(occ.habitId, occ.id, now.toISOString())
        await refreshAround(occ.date, now)
      })
    },

    async stopTimer(occurrenceId: number, now: Date = new Date()): Promise<number> {
      const occ = await occurrences.get(occurrenceId)
      if (!occ) return 0
      return db.transaction(async () => {
        const minutes = await logs.stop(occ.id, now.toISOString())
        await refreshAround(occ.date, now)
        return minutes
      })
    },

    async addManualMinutes(occurrenceId: number, minutes: number, now: Date = new Date()): Promise<void> {
      const occ = await occurrences.get(occurrenceId)
      if (!occ || minutes <= 0) return
      await db.transaction(async () => {
        await logs.clearAssumed(occ.id)
        await logs.addManual(occ.habitId, occ.id, Math.round(minutes), now.toISOString())
        await refreshAround(occ.date, now)
      })
    },

    async runningOccurrenceId(): Promise<number | null> {
      return (await logs.anyRunning())?.occurrenceId ?? null
    },

    // ----------------------------------------------------- difficulty

    async acceptProposal(proposalId: number, now: Date = new Date()): Promise<void> {
      const p = await records.getProposal(proposalId)
      if (!p) return
      await db.transaction(async () => {
        await habits.setDifficulty(p.habit_id, p.proposed_level, p.proposed_target)
        await records.resolveProposal(proposalId, 'accepted')
        const habit = await habits.get(p.habit_id)
        if (habit) await schedule.reschedule(habit, now)
        await refreshAround(await today(now), now)
      })
    },

    async rejectProposal(proposalId: number): Promise<void> {
      await records.resolveProposal(proposalId, 'rejected')
    },

    /** Recompute the difficulty target from the ladder, e.g. after editing a baseline. */
    async syncTargetToLevel(habitId: number): Promise<void> {
      const habit = await habits.get(habitId)
      if (!habit) return
      await habits.setDifficulty(
        habitId,
        habit.difficultyLevel,
        targetForLevel(habit.baselineMinutes, habit.difficultyLevel)
      )
    }
  }
}

export type HabitService = ReturnType<typeof habitService>
