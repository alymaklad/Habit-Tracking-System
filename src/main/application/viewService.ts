import type {
  AchievementView,
  CalendarBlock,
  CalendarMonthDay,
  DashboardCard,
  DashboardView,
  DifficultyProposal,
  LocalDate,
  PersonalRecordView,
  ProgressView,
  SeriesPoint,
  WeeklyReview
} from '@shared/types'
import { ACHIEVEMENTS, PERSONAL_RECORD_LABELS } from '../domain/achievements'
import { levelInfo } from '../domain/levels'
import { fullXp } from '../domain/scoring'
import {
  addDays,
  daysInMonth,
  formatDuration,
  isoWeekNumber,
  monthStart,
  todayIn,
  weekStart,
  weekday
} from '../domain/time'
import { proposeAdjustment } from '../domain/difficulty'
import type { HabitRepo } from '../persistence/habitRepo'
import type { OccurrenceRepo } from '../persistence/occurrenceRepo'
import type { LogRepo } from '../persistence/logRepo'
import type { RecordRepo } from '../persistence/recordRepo'
import type { SettingsRepo } from '../persistence/settingsRepo'
import type { RecomputeService } from './recomputeService'

/** Read models for the renderer. Everything here is derived; nothing is written. */
export function viewService(deps: {
  habits: HabitRepo
  occurrences: OccurrenceRepo
  logs: LogRepo
  records: RecordRepo
  settings: SettingsRepo
  engine: RecomputeService
  runningOccurrenceId: () => number | null
}) {
  const { habits, occurrences, logs, records, settings, engine, runningOccurrenceId } = deps

  function today(now: Date = new Date()): LocalDate {
    return todayIn(settings.timezone(), now)
  }

  // ------------------------------------------------------------ dashboard

  function dashboard(now: Date = new Date()): DashboardView {
    const date = today(now)
    const cfg = settings.scoring()
    const running = runningOccurrenceId()

    const cards: DashboardCard[] = occurrences.listOnDate(date).map((occ) => {
      const habit = habits.get(occ.habitId)!
      const logged = logs.totalFor(occ.id, now)
      const rec = records.dailyForHabit(occ.habitId, date, date)[0]
      const timer = logs.runningFor(occ.id)

      return {
        habitId: occ.habitId,
        occurrenceId: occ.id,
        name: habit.name,
        difficultyLevel: habit.difficultyLevel,
        scheduledTime: occ.scheduledTime,
        targetMinutes: occ.targetMinutes,
        loggedMinutes: logged.minutes,
        percent:
          occ.targetMinutes > 0
            ? Math.min(100, Math.round((logged.minutes / occ.targetMinutes) * 100))
            : 0,
        status: rec?.status ?? occ.status,
        origin: logged.origin,
        xpReward: fullXp(occ.targetMinutes, habit.difficultyLevel),
        streak: engine.streakFor(occ.habitId).current,
        timerRunning: running === occ.id && timer !== null,
        timerStartedAt: timer?.startedAt ?? null,
        googleTaskId: occ.googleTaskId
      }
    })

    const dayRecords = records.dailyOn(date)
    const dayPoints = dayRecords.reduce((s, r) => s + r.points, 0)
    // The best a day can score: every scheduled habit fully completed.
    const dayPointsMax = cards.length * cfg.fullCompletion

    return {
      date,
      cards,
      dayPoints,
      dayPointsMax,
      level: levelInfo(records.totalXp()),
      weekNumber: isoWeekNumber(date)
    }
  }

  // ------------------------------------------------------------- calendar

  function calendarRange(from: LocalDate, to: LocalDate, now: Date = new Date()): CalendarBlock[] {
    const running = runningOccurrenceId()
    return occurrences.listInRange(from, to).map((occ) => {
      const habit = habits.get(occ.habitId)!
      const rec = records.dailyForHabit(occ.habitId, occ.date, occ.date)[0]
      return {
        occurrenceId: occ.id,
        habitId: occ.habitId,
        name: habit.name,
        date: occ.date,
        scheduledTime: occ.scheduledTime,
        targetMinutes: occ.targetMinutes,
        status: rec?.status ?? occ.status,
        timerRunning: running === occ.id
      }
    })
    void now
  }

  function calendarMonth(anchor: LocalDate): CalendarMonthDay[] {
    const first = monthStart(anchor)
    const total = daysInMonth(anchor)
    // Pad back to the Monday of the week the 1st falls in.
    const lead = weekday(first) - 1
    const gridStart = addDays(first, -lead)

    const out: CalendarMonthDay[] = []
    for (let i = 0; i < 42; i++) {
      const date = addDays(gridStart, i)
      const inMonth = date >= first && date <= addDays(first, total - 1)
      const day = records.dailyOn(date)
      out.push({
        date,
        inMonth,
        scheduled: day.length,
        complete: day.filter((d) => d.status === 'complete').length,
        partial: day.filter((d) => d.status === 'partial').length,
        missed: day.filter((d) => d.status === 'missed').length
      })
    }
    return out
  }

  // ------------------------------------------------------------- progress

  function progress(weeks = 8, now: Date = new Date()): ProgressView {
    const all = records.weeklyAll(weeks)
    const label = (ws: LocalDate) => `W${isoWeekNumber(ws)}`

    const hoursPerWeek: SeriesPoint[] = all.map((w) => ({
      label: label(w.weekStart),
      value: Math.round((w.totalMinutes / 60) * 10) / 10
    }))
    const completionPerWeek: SeriesPoint[] = all.map((w) => ({
      label: label(w.weekStart),
      value: Math.round(w.completionRate)
    }))
    const pointsPerWeek: SeriesPoint[] = all.map((w) => ({
      label: label(w.weekStart),
      value: w.totalPoints
    }))

    // Daily best-streak series over the same span.
    const start = all[0]?.weekStart ?? weekStart(today(now))
    const streakSeries: SeriesPoint[] = []
    const difficultySeries: SeriesPoint[] = all.map((w) => ({
      label: label(w.weekStart),
      value:
        habits.listActive().reduce((s, h) => s + h.difficultyLevel, 0) /
        Math.max(1, habits.listActive().length)
    }))

    let cursor = start
    const end = today(now)
    while (cursor <= end) {
      const day = records.dailyOn(cursor)
      streakSeries.push({
        label: cursor,
        value: day.filter((d) => d.status === 'complete').length
      })
      cursor = addDays(cursor, 7)
    }

    const totalHours = Math.round((records.totalMinutes() / 60) * 10) / 10
    const last = all[all.length - 1]

    return {
      hoursPerWeek,
      completionPerWeek,
      pointsPerWeek,
      streakSeries,
      difficultySeries,
      totalHours,
      improvementPercentage: last?.improvementPercentage ?? null
    }
  }

  // --------------------------------------------------------- weekly review

  function weeklyReview(anchor?: LocalDate, now: Date = new Date()): WeeklyReview | null {
    const ws = anchor ? weekStart(anchor) : weekStart(addDays(today(now), -7))
    const week = records.weekly(ws)
    if (!week) return null

    const prev = records.weekly(addDays(ws, -7))
    const daily = records.dailyInRange(ws, addDays(ws, 6))
    const scheduled = daily.filter((d) => d.status !== 'skipped').length
    const completed = daily.filter((d) => d.status === 'complete').length

    // Per-habit completion rates for best and weakest.
    const perHabit = new Map<number, { done: number; total: number }>()
    for (const d of daily) {
      if (d.status === 'skipped') continue
      const e = perHabit.get(d.habitId) ?? { done: 0, total: 0 }
      e.total++
      if (d.status === 'complete') e.done++
      perHabit.set(d.habitId, e)
    }

    const ranked = [...perHabit.entries()]
      .map(([habitId, e]) => ({
        name: habits.get(habitId)?.name ?? 'Unknown',
        completionRate: e.total === 0 ? 0 : (e.done / e.total) * 100
      }))
      .sort((a, b) => b.completionRate - a.completionRate)

    const best = ranked[0] ?? null
    const weakest = ranked.length > 1 ? (ranked[ranked.length - 1] ?? null) : null

    const analysis: string[] = []
    const recommendations: string[] = []

    if (week.improvementPercentage !== null) {
      const delta = Math.round(week.improvementPercentage * 10) / 10
      analysis.push(
        delta >= 0
          ? `You improved total time by ${delta}%, from ${formatDuration(prev?.totalMinutes ?? 0)} to ${formatDuration(week.totalMinutes)}.`
          : `Total time fell ${Math.abs(delta)}%, from ${formatDuration(prev?.totalMinutes ?? 0)} to ${formatDuration(week.totalMinutes)}.`
      )
    } else {
      analysis.push(`You logged ${formatDuration(week.totalMinutes)} this week.`)
    }

    if (best) {
      analysis.push(
        `Your strongest habit was ${best.name} at ${Math.round(best.completionRate)}% completion.`
      )
    }
    if (weakest && weakest.completionRate < 70) {
      analysis.push(`${weakest.name} dropped to ${Math.round(weakest.completionRate)}%.`)
    }

    for (const [habitId, e] of perHabit) {
      const habit = habits.get(habitId)
      if (!habit) continue
      const adj = proposeAdjustment({
        habitName: habit.name,
        baselineMinutes: habit.baselineMinutes,
        currentLevel: habit.difficultyLevel,
        completionRate: e.total === 0 ? 0 : (e.done / e.total) * 100,
        scheduled: e.total
      })
      if (adj.direction !== 'hold') recommendations.push(adj.rationale)
    }
    if (recommendations.length === 0) {
      recommendations.push('Everything is inside its target band — keep all habits as they are.')
    }

    return {
      weekStart: ws,
      weekNumber: isoWeekNumber(ws),
      totalMinutes: week.totalMinutes,
      previousMinutes: prev?.totalMinutes ?? 0,
      improvementPercentage: week.improvementPercentage,
      tasksCompleted: completed,
      tasksScheduled: scheduled,
      consistency: scheduled === 0 ? 0 : (completed / scheduled) * 100,
      xp: week.xp,
      points: week.totalPoints,
      bestHabit: best,
      weakestHabit: weakest,
      streak: engine.globalStreak().current,
      analysis,
      recommendations
    }
  }

  // --------------------------------------------------------- achievements

  function achievements(now: Date = new Date()): AchievementView[] {
    const stats = engine.achievementStats(now)
    const unlocked = records.unlockedAchievements()
    return ACHIEVEMENTS.map((def) => {
      const { progress: p, label } = def.evaluate(stats)
      const at = unlocked.get(def.key) ?? null
      return {
        key: def.key,
        name: def.name,
        description: def.description,
        unlockedAt: at,
        progress: at ? 1 : p,
        progressLabel: at ? 'Unlocked' : label
      }
    })
  }

  function personalRecords(): PersonalRecordView[] {
    const rows = records.personalRecords()
    return Object.entries(PERSONAL_RECORD_LABELS).map(([kind, label]) => {
      const row = rows.find((r) => r.kind === kind)
      return {
        kind,
        label,
        value: row?.display ?? '—',
        achievedOn: row?.achieved_on ?? null
      }
    })
  }

  function proposals(): DifficultyProposal[] {
    return records.pendingProposals()
  }

  return {
    dashboard,
    calendarRange,
    calendarMonth,
    progress,
    weeklyReview,
    achievements,
    personalRecords,
    proposals
  }
}

export type ViewService = ReturnType<typeof viewService>
