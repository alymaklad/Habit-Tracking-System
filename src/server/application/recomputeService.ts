import type { LocalDate, StreakInfo } from '@shared/types'
import type { OccurrenceFacts, WeekFacts } from '../domain/scoring'
import {
  completionRate as rate,
  improvement,
  pointsFor,
  statusOf,
  weeklyBonus,
  xpFor
} from '../domain/scoring'
import { computeStreaks, type StreakDay } from '../domain/streaks'
import { earnedKeys, type AchievementStats } from '../domain/achievements'
import { addDays, diffDays, formatDuration, todayIn, weekStart } from '../domain/time'
import { expand } from '../domain/recurrence'
import type { Db } from '../persistence/db'
import type { HabitRepo } from '../persistence/habitRepo'
import type { OccurrenceRepo } from '../persistence/occurrenceRepo'
import type { LogRepo } from '../persistence/logRepo'
import type { RecordRepo } from '../persistence/recordRepo'
import type { SettingsRepo } from '../persistence/settingsRepo'

/**
 * The engine.
 *
 * Nothing here increments anything. Every daily and weekly figure is DERIVED from the
 * occurrence rows and time logs for a date range, then written over whatever was there
 * before. Three consequences fall out of that, all of them required behaviour:
 *
 *  - running a sync five times produces an identical database;
 *  - un-ticking a Google task takes its points and XP back with no compensating entry;
 *  - the whole history can be rebuilt from source rows at any time.
 */
export function recomputeService(deps: {
  db: Db
  habits: HabitRepo
  occurrences: OccurrenceRepo
  logs: LogRepo
  records: RecordRepo
  settings: SettingsRepo
}) {
  const { db, habits, occurrences, logs, records, settings } = deps

  async function recomputeRange(from: LocalDate, to: LocalDate, now: Date = new Date()): Promise<void> {
    const tz = await settings.timezone()
    const cfg = await settings.scoring()
    const today = todayIn(tz, now)

    await db.transaction(async () => {
      const rows = await occurrences.listInRange(from, to)
      const totals = await logs.totalsInRange(from, to, now)
      const habitById = new Map((await habits.list()).map((h) => [h.id, h]))

      for (const occ of rows) {
        const habit = habitById.get(occ.habitId)
        if (!habit) continue

        const logged = totals.get(occ.id) ?? { minutes: 0, origin: null }
        const facts: OccurrenceFacts = {
          targetMinutes: occ.targetMinutes,
          loggedMinutes: logged.minutes,
          completed: occ.completedAt !== null,
          justifiedSkip: occ.justifiedSkip,
          // A day is only "missed" once it is behind us. Today stays pending.
          elapsed: diffDays(occ.date, today) > 0,
          origin: logged.origin
        }

        const status = statusOf(facts, cfg)

        await records.putDaily({
          habitId: occ.habitId,
          date: occ.date,
          status,
          points: pointsFor(status, cfg),
          xp: xpFor(status, facts, habit.difficultyLevel),
          durationMinutes: logged.minutes,
          targetMinutes: occ.targetMinutes,
          origin: logged.origin
        })

        // Keep the denormalised status on the occurrence in step for the UI.
        if (occ.status !== status) {
          await occurrences.setStatus(occ.id, status, occ.completedAt)
        }
      }
    })
  }

  /** Which weekday historically completes worst — used for the worst-day bonus. */
  async function worstWeekday(): Promise<number | null> {
    const rows = (await db
      .prepare(
        `SELECT date, status FROM daily_record WHERE status IN ('complete','partial','missed')`
      )
      .all()) as { date: string; status: string }[]
    if (rows.length === 0) return null

    const tally = new Map<number, { done: number; total: number }>()
    for (const r of rows) {
      const wd = new Date(`${r.date}T00:00:00Z`).getUTCDay() || 7
      const e = tally.get(wd) ?? { done: 0, total: 0 }
      e.total++
      if (r.status === 'complete') e.done++
      tally.set(wd, e)
    }

    let worst: number | null = null
    let worstRate = Infinity
    for (const [wd, e] of tally) {
      if (e.total < 2) continue
      const r = e.done / e.total
      if (r < worstRate) {
        worstRate = r
        worst = wd
      }
    }
    return worst
  }

  async function recomputeWeek(ws: LocalDate, now: Date = new Date()): Promise<void> {
    const cfg = await settings.scoring()
    const weekEnd = addDays(ws, 6)
    const daily = await records.dailyInRange(ws, weekEnd)

    // A week with nothing scheduled has no score to record. Writing a row of zeros
    // would put empty weeks into the charts and the weekly review; clearing any stale
    // row also keeps the history honest after habits are deleted.
    if (daily.length === 0) {
      await records.deleteWeekly(ws)
      return
    }

    const totalMinutes = daily.reduce((s, d) => s + d.durationMinutes, 0)
    const targetMinutes = daily.reduce((s, d) => s + d.targetMinutes, 0)
    const xp = daily.reduce((s, d) => s + d.xp, 0)
    const basePoints = daily.reduce((s, d) => s + d.points, 0)

    const scheduled = daily.filter((d) => d.status !== 'skipped').length
    const completed = daily.filter((d) => d.status === 'complete').length
    const partial = daily.filter((d) => d.status === 'partial').length

    const worst = await worstWeekday()
    const completedWorstDay =
      worst !== null &&
      daily.some(
        (d) =>
          d.status === 'complete' && (new Date(`${d.date}T00:00:00Z`).getUTCDay() || 7) === worst
      )

    // Seven-day consistency: every scheduled day in the week landed on target.
    const sevenDayConsistent = scheduled > 0 && completed === scheduled

    const facts: WeekFacts = {
      scheduled,
      completed,
      partial,
      totalMinutes,
      targetMinutes,
      completedWorstDay,
      sevenDayConsistent
    }

    const prev = await records.weekly(addDays(ws, -7))
    const totalPoints = basePoints + weeklyBonus(facts, cfg)

    await records.putWeekly({
      weekStart: ws,
      totalPoints,
      completionRate: rate(completed, scheduled),
      totalMinutes,
      improvementPercentage: prev ? improvement(prev.totalMinutes, totalMinutes) : null,
      xp
    })

    void now
  }

  async function recomputeWeeksTouching(from: LocalDate, to: LocalDate, now?: Date): Promise<void> {
    let ws = weekStart(from)
    const last = weekStart(to)
    // Recompute one extra week forward so the improvement % of the following week,
    // which reads this week's totals, stays correct.
    const stop = addDays(last, 7)
    while (diffDays(ws, stop) >= 0) {
      await recomputeWeek(ws, now)
      ws = addDays(ws, 7)
    }
  }

  // ------------------------------------------------------------- streaks

  async function streakFor(habitId: number): Promise<StreakInfo> {
    const rows = await records.dailyForHabit(habitId, '2000-01-01', '2999-12-31')
    const days: StreakDay[] = rows.map((r) => ({ date: r.date, status: r.status }))
    return computeStreaks(days)
  }

  async function globalStreak(): Promise<StreakInfo> {
    let current = 0
    let longest = 0
    for (const h of await habits.list()) {
      const s = await streakFor(h.id)
      current = Math.max(current, s.current)
      longest = Math.max(longest, s.longest)
    }
    return { current, longest }
  }

  // -------------------------------------------------------- achievements

  async function achievementStats(now: Date = new Date()): Promise<AchievementStats> {
    const g = await globalStreak()
    const weeks = await records.weeklyAll(200)
    const thisWeek = weekStart(todayIn(await settings.timezone(), now))
    const current = weeks.find((w) => w.weekStart === thisWeek)
    const best = await records.bestWeekPoints(thisWeek)

    const perfectWeeks = weeks.filter((w) => w.completionRate >= 100).length

    return {
      longestStreak: g.longest,
      currentStreak: g.current,
      totalMinutes: await records.totalMinutes(),
      tasksCompleted: await records.totalCompleted(),
      perfectWeeks,
      beatOwnRecord: current !== undefined && best > 0 && current.totalPoints > best,
      comeback: await detectComeback()
    }
  }

  /** Three consecutive completions following a run of three or more missed days. */
  async function detectComeback(): Promise<boolean> {
    for (const h of await habits.list()) {
      const rows = await records.dailyForHabit(h.id, '2000-01-01', '2999-12-31')
      let missRun = 0
      let doneRun = 0
      for (const r of rows) {
        if (r.status === 'missed') {
          missRun++
          doneRun = 0
        } else if (r.status === 'complete') {
          if (missRun >= 3) {
            doneRun++
            if (doneRun >= 3) return true
          } else {
            doneRun = 0
            missRun = 0
          }
        }
      }
    }
    return false
  }

  async function evaluateAchievements(now: Date = new Date()): Promise<string[]> {
    const stats = await achievementStats(now)
    const already = await records.unlockedAchievements()
    const newly: string[] = []
    for (const key of earnedKeys(stats)) {
      if (already.has(key)) continue
      if (await records.unlockAchievement(key, now.toISOString())) newly.push(key)
    }
    return newly
  }

  async function updatePersonalRecords(now: Date = new Date()): Promise<void> {
    const g = await globalStreak()
    await records.putPersonalRecord('longest_streak', g.longest, `${g.longest} days`, null)

    const weeks = await records.weeklyAll(200)
    const bestHours = weeks.reduce((m, w) => (w.totalMinutes > m.totalMinutes ? w : m), {
      totalMinutes: 0,
      totalPoints: 0,
      weekStart: ''
    } as (typeof weeks)[number])
    if (bestHours.totalMinutes > 0) {
      await records.putPersonalRecord(
        'most_hours_week',
        bestHours.totalMinutes,
        formatDuration(bestHours.totalMinutes),
        bestHours.weekStart
      )
    }

    const bestPoints = weeks.reduce((m, w) => (w.totalPoints > m.totalPoints ? w : m), {
      totalMinutes: 0,
      totalPoints: 0,
      weekStart: ''
    } as (typeof weeks)[number])
    if (bestPoints.totalPoints > 0) {
      await records.putPersonalRecord(
        'most_points_week',
        bestPoints.totalPoints,
        `${bestPoints.totalPoints}`,
        bestPoints.weekStart
      )
    }

    const bestRate = weeks.reduce((m, w) => Math.max(m, w.completionRate), 0)
    if (bestRate > 0) {
      await records.putPersonalRecord(
        'best_completion_rate',
        bestRate,
        `${Math.round(bestRate)}%`,
        null
      )
    }

    const byDay = (await db
      .prepare(
        'SELECT date, SUM(duration_minutes) AS m FROM daily_record GROUP BY date ORDER BY m DESC LIMIT 1'
      )
      .get()) as { date: string; m: number } | undefined
    if (byDay && byDay.m > 0) {
      await records.putPersonalRecord('most_productive_day', byDay.m, formatDuration(byDay.m), byDay.date)
    }

    void now
  }

  return {
    recomputeRange,
    recomputeWeek,
    recomputeWeeksTouching,
    streakFor,
    globalStreak,
    achievementStats,
    evaluateAchievements,
    updatePersonalRecords,

    /** Recompute a range and everything downstream of it. */
    async refresh(from: LocalDate, to: LocalDate, now: Date = new Date()): Promise<{ newAchievements: string[] }> {
      return db.transaction(async () => {
        await recomputeRange(from, to, now)
        await recomputeWeeksTouching(from, to, now)
        const newAchievements = await evaluateAchievements(now)
        await updatePersonalRecords(now)
        return { newAchievements }
      })
    },

    /** Full rebuild from source rows — the Settings "recompute all statistics" action. */
    async rebuildAll(now: Date = new Date()): Promise<void> {
      const earliest = await occurrences.earliestDate()
      const tz = await settings.timezone()
      const today = todayIn(tz, now)
      if (!earliest) return
      const latest = (await habits.listActive())
        .flatMap((h) => expand(h.recurrence, today, addDays(today, 30)))
        .reduce((max, d) => (d > max ? d : max), today)

      await db.transaction(async () => {
        await db.prepare('DELETE FROM daily_record').run()
        await db.prepare('DELETE FROM weekly_record').run()
        await recomputeRange(earliest, latest, now)
        await recomputeWeeksTouching(earliest, latest, now)
        await evaluateAchievements(now)
        await updatePersonalRecords(now)
      })
    }
  }
}

export type RecomputeService = ReturnType<typeof recomputeService>
