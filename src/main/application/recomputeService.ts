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
import { tx, type Db } from '../persistence/db'
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

  function recomputeRange(from: LocalDate, to: LocalDate, now: Date = new Date()): void {
    const tz = settings.timezone()
    const cfg = settings.scoring()
    const today = todayIn(tz, now)

    tx(db, () => {
      const rows = occurrences.listInRange(from, to)
      const totals = logs.totalsInRange(from, to, now)
      const habitById = new Map(habits.list().map((h) => [h.id, h]))

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

        records.putDaily({
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
          occurrences.setStatus(occ.id, status, occ.completedAt)
        }
      }
    })
  }

  /** Which weekday historically completes worst — used for the worst-day bonus. */
  function worstWeekday(): number | null {
    const rows = db
      .prepare(
        `SELECT date, status FROM daily_record WHERE status IN ('complete','partial','missed')`
      )
      .all() as { date: string; status: string }[]
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

  function recomputeWeek(ws: LocalDate, now: Date = new Date()): void {
    const cfg = settings.scoring()
    const weekEnd = addDays(ws, 6)
    const daily = records.dailyInRange(ws, weekEnd)

    // A week with nothing scheduled has no score to record. Writing a row of zeros
    // would put empty weeks into the charts and the weekly review; clearing any stale
    // row also keeps the history honest after habits are deleted.
    if (daily.length === 0) {
      records.deleteWeekly(ws)
      return
    }

    const totalMinutes = daily.reduce((s, d) => s + d.durationMinutes, 0)
    const targetMinutes = daily.reduce((s, d) => s + d.targetMinutes, 0)
    const xp = daily.reduce((s, d) => s + d.xp, 0)
    const basePoints = daily.reduce((s, d) => s + d.points, 0)

    const scheduled = daily.filter((d) => d.status !== 'skipped').length
    const completed = daily.filter((d) => d.status === 'complete').length
    const partial = daily.filter((d) => d.status === 'partial').length

    const worst = worstWeekday()
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

    const prev = records.weekly(addDays(ws, -7))
    const totalPoints = basePoints + weeklyBonus(facts, cfg)

    records.putWeekly({
      weekStart: ws,
      totalPoints,
      completionRate: rate(completed, scheduled),
      totalMinutes,
      improvementPercentage: prev ? improvement(prev.totalMinutes, totalMinutes) : null,
      xp
    })

    void now
  }

  function recomputeWeeksTouching(from: LocalDate, to: LocalDate, now?: Date): void {
    let ws = weekStart(from)
    const last = weekStart(to)
    // Recompute one extra week forward so the improvement % of the following week,
    // which reads this week's totals, stays correct.
    const stop = addDays(last, 7)
    while (diffDays(ws, stop) >= 0) {
      recomputeWeek(ws, now)
      ws = addDays(ws, 7)
    }
  }

  // ------------------------------------------------------------- streaks

  function streakFor(habitId: number): StreakInfo {
    const rows = records.dailyForHabit(habitId, '2000-01-01', '2999-12-31')
    const days: StreakDay[] = rows.map((r) => ({ date: r.date, status: r.status }))
    return computeStreaks(days)
  }

  function globalStreak(): StreakInfo {
    let current = 0
    let longest = 0
    for (const h of habits.list()) {
      const s = streakFor(h.id)
      current = Math.max(current, s.current)
      longest = Math.max(longest, s.longest)
    }
    return { current, longest }
  }

  // -------------------------------------------------------- achievements

  function achievementStats(now: Date = new Date()): AchievementStats {
    const g = globalStreak()
    const weeks = records.weeklyAll(200)
    const thisWeek = weekStart(todayIn(settings.timezone(), now))
    const current = weeks.find((w) => w.weekStart === thisWeek)
    const best = records.bestWeekPoints(thisWeek)

    const perfectWeeks = weeks.filter((w) => w.completionRate >= 100).length

    return {
      longestStreak: g.longest,
      currentStreak: g.current,
      totalMinutes: records.totalMinutes(),
      tasksCompleted: records.totalCompleted(),
      perfectWeeks,
      beatOwnRecord: current !== undefined && best > 0 && current.totalPoints > best,
      comeback: detectComeback()
    }
  }

  /** Three consecutive completions following a run of three or more missed days. */
  function detectComeback(): boolean {
    for (const h of habits.list()) {
      const rows = records.dailyForHabit(h.id, '2000-01-01', '2999-12-31')
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

  function evaluateAchievements(now: Date = new Date()): string[] {
    const stats = achievementStats(now)
    const already = records.unlockedAchievements()
    const newly: string[] = []
    for (const key of earnedKeys(stats)) {
      if (already.has(key)) continue
      if (records.unlockAchievement(key, now.toISOString())) newly.push(key)
    }
    return newly
  }

  function updatePersonalRecords(now: Date = new Date()): void {
    const g = globalStreak()
    records.putPersonalRecord('longest_streak', g.longest, `${g.longest} days`, null)

    const weeks = records.weeklyAll(200)
    const bestHours = weeks.reduce((m, w) => (w.totalMinutes > m.totalMinutes ? w : m), {
      totalMinutes: 0,
      totalPoints: 0,
      weekStart: ''
    } as (typeof weeks)[number])
    if (bestHours.totalMinutes > 0) {
      records.putPersonalRecord(
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
      records.putPersonalRecord(
        'most_points_week',
        bestPoints.totalPoints,
        `${bestPoints.totalPoints}`,
        bestPoints.weekStart
      )
    }

    const bestRate = weeks.reduce((m, w) => Math.max(m, w.completionRate), 0)
    if (bestRate > 0) {
      records.putPersonalRecord(
        'best_completion_rate',
        bestRate,
        `${Math.round(bestRate)}%`,
        null
      )
    }

    const byDay = db
      .prepare(
        'SELECT date, SUM(duration_minutes) AS m FROM daily_record GROUP BY date ORDER BY m DESC LIMIT 1'
      )
      .get() as { date: string; m: number } | undefined
    if (byDay && byDay.m > 0) {
      records.putPersonalRecord('most_productive_day', byDay.m, formatDuration(byDay.m), byDay.date)
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
    refresh(from: LocalDate, to: LocalDate, now: Date = new Date()): { newAchievements: string[] } {
      return tx(db, () => {
        recomputeRange(from, to, now)
        recomputeWeeksTouching(from, to, now)
        const newAchievements = evaluateAchievements(now)
        updatePersonalRecords(now)
        return { newAchievements }
      })
    },

    /** Full rebuild from source rows — the Settings "recompute all statistics" action. */
    rebuildAll(now: Date = new Date()): void {
      const earliest = occurrences.earliestDate()
      const tz = settings.timezone()
      const today = todayIn(tz, now)
      if (!earliest) return
      const latest = habits
        .listActive()
        .flatMap((h) => expand(h.recurrence, today, addDays(today, 30)))
        .reduce((max, d) => (d > max ? d : max), today)

      tx(db, () => {
        db.prepare('DELETE FROM daily_record').run()
        db.prepare('DELETE FROM weekly_record').run()
        recomputeRange(earliest, latest, now)
        recomputeWeeksTouching(earliest, latest, now)
        evaluateAchievements(now)
        updatePersonalRecords(now)
      })
    }
  }
}

export type RecomputeService = ReturnType<typeof recomputeService>
