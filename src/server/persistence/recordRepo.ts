import type {
  DailyRecord,
  DifficultyProposal,
  LocalDate,
  OccurrenceStatus,
  TimeLogOrigin,
  WeeklyRecord
} from '@shared/types'
import type { Db } from './db'

interface DailyRow {
  habit_id: number
  date: string
  status: string
  points: number
  xp: number
  duration_minutes: number
  target_minutes: number
  origin: string | null
}

const toDaily = (r: DailyRow): DailyRecord => ({
  habitId: r.habit_id,
  date: r.date,
  status: r.status as OccurrenceStatus,
  points: r.points,
  xp: r.xp,
  durationMinutes: r.duration_minutes,
  targetMinutes: r.target_minutes,
  origin: (r.origin as TimeLogOrigin | null) ?? null
})

export function recordRepo(db: Db) {
  const upsertDaily = db.prepare(`
    INSERT INTO daily_record (habit_id, date, status, points, xp, duration_minutes, target_minutes, origin)
    VALUES (@habit_id, @date, @status, @points, @xp, @duration_minutes, @target_minutes, @origin)
    ON CONFLICT (habit_id, date) DO UPDATE SET
      status = excluded.status, points = excluded.points, xp = excluded.xp,
      duration_minutes = excluded.duration_minutes, target_minutes = excluded.target_minutes,
      origin = excluded.origin
  `)

  const upsertWeekly = db.prepare(`
    INSERT INTO weekly_record (week_start, total_points, completion_rate, total_minutes, improvement_percentage, xp)
    VALUES (@week_start, @total_points, @completion_rate, @total_minutes, @improvement_percentage, @xp)
    ON CONFLICT (week_start) DO UPDATE SET
      total_points = excluded.total_points, completion_rate = excluded.completion_rate,
      total_minutes = excluded.total_minutes,
      improvement_percentage = excluded.improvement_percentage, xp = excluded.xp
  `)

  return {
    // ---------------------------------------------------------- daily

    async putDaily(r: DailyRecord): Promise<void> {
      await upsertDaily.run({
        habit_id: r.habitId,
        date: r.date,
        status: r.status,
        points: r.points,
        xp: r.xp,
        duration_minutes: r.durationMinutes,
        target_minutes: r.targetMinutes,
        origin: r.origin
      })
    },

    async deleteDaily(habitId: number, date: LocalDate): Promise<void> {
      await db.prepare('DELETE FROM daily_record WHERE habit_id = ? AND date = ?').run(habitId, date)
    },

    async dailyInRange(from: LocalDate, to: LocalDate): Promise<DailyRecord[]> {
      return (
        (await db
          .prepare('SELECT * FROM daily_record WHERE date BETWEEN ? AND ? ORDER BY date')
          .all(from, to)) as DailyRow[]
      ).map(toDaily)
    },

    async dailyForHabit(habitId: number, from: LocalDate, to: LocalDate): Promise<DailyRecord[]> {
      return (
        (await db
          .prepare(
            'SELECT * FROM daily_record WHERE habit_id = ? AND date BETWEEN ? AND ? ORDER BY date'
          )
          .all(habitId, from, to)) as DailyRow[]
      ).map(toDaily)
    },

    async dailyOn(date: LocalDate): Promise<DailyRecord[]> {
      return (
        (await db.prepare('SELECT * FROM daily_record WHERE date = ?').all(date)) as DailyRow[]
      ).map(toDaily)
    },

    /** Lifetime XP. Recomputed from daily records, never incremented. */
    async totalXp(): Promise<number> {
      const r = (await db.prepare('SELECT COALESCE(SUM(xp), 0) AS xp FROM daily_record').get()) as {
        xp: number
      }
      return r.xp
    },

    async totalMinutes(): Promise<number> {
      const r = (await db
        .prepare('SELECT COALESCE(SUM(duration_minutes), 0) AS m FROM daily_record')
        .get()) as { m: number }
      return r.m
    },

    async totalCompleted(): Promise<number> {
      const r = (await db
        .prepare("SELECT COUNT(*) AS n FROM daily_record WHERE status = 'complete'")
        .get()) as { n: number }
      return r.n
    },

    // --------------------------------------------------------- weekly

    async putWeekly(w: WeeklyRecord): Promise<void> {
      await upsertWeekly.run({
        week_start: w.weekStart,
        total_points: w.totalPoints,
        completion_rate: w.completionRate,
        total_minutes: w.totalMinutes,
        improvement_percentage: w.improvementPercentage,
        xp: w.xp
      })
    },

    async weekly(weekStart: LocalDate): Promise<WeeklyRecord | null> {
      const r = (await db.prepare('SELECT * FROM weekly_record WHERE week_start = ?').get(weekStart)) as
        | Record<string, never>
        | undefined
      if (!r) return null
      const row = r as unknown as {
        week_start: string
        total_points: number
        completion_rate: number
        total_minutes: number
        improvement_percentage: number | null
        xp: number
      }
      return {
        weekStart: row.week_start,
        totalPoints: row.total_points,
        completionRate: row.completion_rate,
        totalMinutes: row.total_minutes,
        improvementPercentage: row.improvement_percentage,
        xp: row.xp
      }
    },

    async weeklyAll(limit = 26): Promise<WeeklyRecord[]> {
      const rows = (await db
        .prepare('SELECT * FROM weekly_record ORDER BY week_start DESC LIMIT ?')
        .all(limit)) as {
        week_start: string
        total_points: number
        completion_rate: number
        total_minutes: number
        improvement_percentage: number | null
        xp: number
      }[]
      return rows
        .map((row) => ({
          weekStart: row.week_start,
          totalPoints: row.total_points,
          completionRate: row.completion_rate,
          totalMinutes: row.total_minutes,
          improvementPercentage: row.improvement_percentage,
          xp: row.xp
        }))
        .reverse()
    },

    async bestWeekPoints(excludeWeek?: LocalDate): Promise<number> {
      const r = (
        excludeWeek
          ? (await db.prepare(
              'SELECT COALESCE(MAX(total_points), 0) AS p FROM weekly_record WHERE week_start <> ?'
            ).get(excludeWeek))
          : await db.prepare('SELECT COALESCE(MAX(total_points), 0) AS p FROM weekly_record').get()
      ) as { p: number }
      return r.p
    },

    // ---------------------------------------------------- proposals

    async putProposal(p: {
      habitId: number
      weekStart: LocalDate
      currentLevel: number
      proposedLevel: number
      currentTarget: number
      proposedTarget: number
      completionRate: number
      rationale: string
    }): Promise<void> {
      await db.prepare(
        `INSERT INTO difficulty_proposal
           (habit_id, week_start, current_level, proposed_level, current_target,
            proposed_target, completion_rate, rationale, state, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)
         ON CONFLICT (habit_id, week_start) DO NOTHING`
      ).run(
        p.habitId,
        p.weekStart,
        p.currentLevel,
        p.proposedLevel,
        p.currentTarget,
        p.proposedTarget,
        p.completionRate,
        p.rationale,
        new Date().toISOString()
      )
    },

    async pendingProposals(): Promise<DifficultyProposal[]> {
      const rows = (await db
        .prepare(
          `SELECT p.*, h.name AS habit_name FROM difficulty_proposal p
             JOIN habit h ON h.id = p.habit_id
            WHERE p.state = 'pending' ORDER BY p.week_start DESC`
        )
        .all()) as {
        id: number
        habit_id: number
        habit_name: string
        week_start: string
        current_target: number
        proposed_target: number
        completion_rate: number
        rationale: string
        state: string
      }[]
      return rows.map((r) => ({
        id: r.id,
        habitId: r.habit_id,
        habitName: r.habit_name,
        weekStart: r.week_start,
        currentTarget: r.current_target,
        proposedTarget: r.proposed_target,
        completionRate: r.completion_rate,
        rationale: r.rationale,
        state: r.state as 'pending' | 'accepted' | 'rejected'
      }))
    },

    async getProposal(id: number) {
      return (await db.prepare('SELECT * FROM difficulty_proposal WHERE id = ?').get(id)) as
        | {
            id: number
            habit_id: number
            proposed_level: number
            proposed_target: number
          }
        | undefined
    },

    async resolveProposal(id: number, state: 'accepted' | 'rejected'): Promise<void> {
      await db.prepare('UPDATE difficulty_proposal SET state = ? WHERE id = ?').run(state, id)
    },

    // ------------------------------------------------- achievements

    async unlockedAchievements(): Promise<Map<string, string>> {
      const rows = (await db.prepare('SELECT * FROM user_achievement').all()) as {
        achievement_key: string
        unlocked_at: string
      }[]
      return new Map(rows.map((r) => [r.achievement_key, r.unlocked_at]))
    },

    async unlockAchievement(key: string, at: string): Promise<boolean> {
      const info = await db
        .prepare(
          'INSERT INTO user_achievement (achievement_key, unlocked_at) VALUES (?, ?) ON CONFLICT DO NOTHING'
        )
        .run(key, at)
      return info.changes > 0
    },

    // ---------------------------------------------- personal records

    async deleteWeekly(weekStart: LocalDate): Promise<void> {
      await db.prepare('DELETE FROM weekly_record WHERE week_start = ?').run(weekStart)
    },

    async putPersonalRecord(kind: string, value: number, display: string, on: LocalDate | null): Promise<void> {
      // Zero is not a record. Without this a fresh install shows "0 days" as your
      // longest streak, which reads as a real figure rather than "nothing yet".
      if (value <= 0) return
      await db.prepare(
        `INSERT INTO personal_record (kind, value, display, achieved_on, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT (kind) DO UPDATE SET
           value = excluded.value, display = excluded.display,
           achieved_on = excluded.achieved_on, updated_at = excluded.updated_at
         WHERE excluded.value > personal_record.value`
      ).run(kind, value, display, on, new Date().toISOString())
    },

    async personalRecords() {
      return (await db.prepare('SELECT * FROM personal_record').all()) as {
        kind: string
        value: number
        display: string
        achieved_on: string | null
      }[]
    }
  }
}

export type RecordRepo = ReturnType<typeof recordRepo>
