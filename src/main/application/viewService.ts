import type {
  AchievementView,
  CalendarBlock,
  CalendarMonthDay,
  DashboardCard,
  DashboardView,
  DifficultyProposal,
  LocalDate,
  PerformanceDay,
  PerformanceHabit,
  PerformanceView,
  PersonalRecordView,
  TodoGroup,
  TodoItem,
  TodoView,
  WeekVerdict,
  ProgressView,
  SeriesPoint,
  WeeklyReview
} from '@shared/types'
import { ACHIEVEMENTS, PERSONAL_RECORD_LABELS } from '../domain/achievements'
import { levelInfo } from '../domain/levels'
import { fullXp, improvement } from '../domain/scoring'
import {
  addDays,
  daysInMonth,
  formatDuration,
  formatWeekLabel,
  monthStart,
  todayIn,
  weekStart,
  weekday
} from '../domain/time'
import { proposeAdjustment } from '../domain/difficulty'
import { carriedDays, detectAvoidance, isOverdue, orderByUrgency, suggestFromHistory } from '../domain/todo'
import type { HabitRepo } from '../persistence/habitRepo'
import type { OccurrenceRepo } from '../persistence/occurrenceRepo'
import type { LogRepo } from '../persistence/logRepo'
import type { RecordRepo } from '../persistence/recordRepo'
import type { SettingsRepo } from '../persistence/settingsRepo'
import type { TodoRepo } from '../persistence/todoRepo'
import type { RecomputeService } from './recomputeService'

/** Read models for the renderer. Everything here is derived; nothing is written. */
export function viewService(deps: {
  habits: HabitRepo
  occurrences: OccurrenceRepo
  logs: LogRepo
  records: RecordRepo
  settings: SettingsRepo
  todos: TodoRepo
  engine: RecomputeService
  runningOccurrenceId: () => number | null
}) {
  const { habits, occurrences, logs, records, settings, todos, engine, runningOccurrenceId } = deps

  function today(now: Date = new Date()): LocalDate {
    return todayIn(settings.timezone(), now)
  }

  /**
   * Minutes excluding a running timer. `totalFor` counts a live timer's elapsed time up
   * to `now`, so subtracting that portion leaves a settled figure the UI can add to
   * second by second — otherwise the card would sit frozen between fetches.
   */
  function closedMinutes(total: number, startedAt: string | null, now: Date): number {
    if (!startedAt) return total
    const elapsed = Math.max(0, Math.floor((now.getTime() - new Date(startedAt).getTime()) / 60000))
    return Math.max(0, total - elapsed)
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
        closedMinutes: closedMinutes(logged.minutes, timer?.startedAt ?? null, now),
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
      weekLabel: formatWeekLabel(weekStart(date))
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
    // Pad back to the Saturday of the week the 1st falls in.
    const gridStart = weekStart(first)

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
    // Chart x-axis ticks: a bare day-of-month is enough space-wise; the card's
    // headline above each chart already carries the broader context.
    const label = (ws: LocalDate) => ws.slice(8)

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

  // ---------------------------------------------------------------- to-do

  function todoView(anchor?: LocalDate, now: Date = new Date()): TodoView {
    const date = anchor ?? today(now)
    const nowMinutes = now.getHours() * 60 + now.getMinutes()

    const records = todos.listForDate(date).filter((t) => !t.dropped)
    const ordered = orderByUrgency(records, date, nowMinutes)

    const habitName = (id: number | null): string | null =>
      id === null ? null : (habits.get(id)?.name ?? null)

    const items: TodoItem[] = ordered.map((t) => ({
      id: t.id,
      kind: t.kind,
      title: t.title,
      notes: (t as { notes?: string | null }).notes ?? null,
      done: t.done,
      dropped: t.dropped,
      date: t.date,
      carried: carriedDays(t),
      overdue: isOverdue(t, date, nowMinutes),
      habitId: t.habitId,
      habitName: habitName(t.habitId),
      occurrenceId: (t as { occurrenceId?: number | null }).occurrenceId ?? null,
      scheduledTime: t.scheduledTime
    }))

    // Group subtasks under their habit; manual items share one group.
    const groups: TodoGroup[] = []
    const byOccurrence = new Map<number, TodoGroup>()

    for (const item of items) {
      if (item.kind === 'subtask' && item.occurrenceId !== null) {
        let group = byOccurrence.get(item.occurrenceId)
        if (!group) {
          const occ = occurrences.get(item.occurrenceId)
          group = {
            habitId: item.habitId,
            habitName: item.habitName,
            occurrenceId: item.occurrenceId,
            scheduledTime: item.scheduledTime,
            habitComplete: occ?.completedAt !== null && occ?.completedAt !== undefined,
            items: [],
            done: 0,
            total: 0
          }
          byOccurrence.set(item.occurrenceId, group)
          groups.push(group)
        }
        group.items.push(item)
        group.total++
        if (item.done) group.done++
      }
    }

    const manual = items.filter((i) => i.kind === 'manual')
    if (manual.length > 0) {
      groups.push({
        habitId: null,
        habitName: null,
        occurrenceId: null,
        scheduledTime: null,
        habitComplete: false,
        items: manual,
        done: manual.filter((i) => i.done).length,
        total: manual.length
      })
    }

    // Suggestions are withheld when the title is already on today's list.
    const suggestions = suggestFromHistory(
      todos.history(),
      date,
      items.map((i) => i.title)
    ).map((s) => ({ title: s.title, reason: s.reason }))

    return {
      date,
      items,
      groups,
      manualDone: manual.filter((i) => i.done).length,
      manualTotal: manual.length,
      subtaskDone: items.filter((i) => i.kind === 'subtask' && i.done).length,
      subtaskTotal: items.filter((i) => i.kind === 'subtask').length,
      carriedCount: items.filter((i) => i.carried > 0 && !i.done).length,
      suggestions,
      avoidance: detectAvoidance(records)
    }
  }

  // ----------------------------------------------------------- performance

  /** Aggregate the daily records for a date range into one row per calendar day. */
  function daysBetween(from: LocalDate, to: LocalDate, inPeriod: (d: LocalDate) => boolean) {
    const rows = records.dailyInRange(from, to)
    const byDate = new Map<LocalDate, PerformanceDay>()

    for (const date of dateRangeInclusive(from, to)) {
      byDate.set(date, {
        date,
        weekday: weekday(date),
        inPeriod: inPeriod(date),
        points: 0,
        xp: 0,
        minutes: 0,
        completed: 0,
        scheduled: 0,
        delta: null
      })
    }

    for (const r of rows) {
      const day = byDate.get(r.date)
      if (!day) continue
      day.points += r.points
      day.xp += r.xp
      day.minutes += r.durationMinutes
      if (r.status !== 'skipped') day.scheduled++
      if (r.status === 'complete') day.completed++
    }

    // The delta compares against the previous day that actually had something
    // scheduled — otherwise a rest day would read as a collapse in performance.
    const ordered = [...byDate.values()]
    let previous: PerformanceDay | null = null
    for (const day of ordered) {
      if (day.scheduled === 0) continue
      day.delta = previous ? day.points - previous.points : null
      previous = day
    }

    return ordered
  }

  function dateRangeInclusive(from: LocalDate, to: LocalDate): LocalDate[] {
    const out: LocalDate[] = []
    let cursor = from
    // Guard against a malformed range rather than looping forever.
    for (let i = 0; i < 400 && cursor <= to; i++) {
      out.push(cursor)
      cursor = addDays(cursor, 1)
    }
    return out
  }

  function habitBreakdown(from: LocalDate, to: LocalDate): PerformanceHabit[] {
    const rows = records.dailyInRange(from, to)
    const acc = new Map<number, PerformanceHabit>()

    for (const r of rows) {
      const habit = habits.get(r.habitId)
      if (!habit) continue
      let e = acc.get(r.habitId)
      if (!e) {
        e = {
          habitId: r.habitId,
          name: habit.name,
          difficultyLevel: habit.difficultyLevel,
          points: 0,
          xp: 0,
          minutes: 0,
          completed: 0,
          partial: 0,
          missed: 0,
          scheduled: 0,
          completionRate: 0,
          trend: null
        }
        acc.set(r.habitId, e)
      }
      e.points += r.points
      e.xp += r.xp
      e.minutes += r.durationMinutes
      // A justified skip is not held against the habit, so it leaves the denominator.
      if (r.status !== 'skipped') e.scheduled++
      if (r.status === 'complete') e.completed++
      else if (r.status === 'partial') e.partial++
      else if (r.status === 'missed') e.missed++
    }

    for (const e of acc.values()) {
      e.completionRate = e.scheduled === 0 ? 0 : (e.completed / e.scheduled) * 100
    }
    return [...acc.values()]
  }

  function performance(anchor?: LocalDate, now: Date = new Date()): PerformanceView {
    const today = todayIn(settings.timezone(), now)
    const ws = weekStart(anchor ?? today)
    const weekEnd = addDays(ws, 6)

    const days = daysBetween(ws, weekEnd, () => true)
    const basePoints = days.reduce((s, d) => s + d.points, 0)

    // weekly_record carries the bonuses; the difference is what they contributed.
    const weekly = records.weekly(ws)
    const totalPoints = weekly?.totalPoints ?? basePoints
    const previous = records.weekly(addDays(ws, -7))
    const previousWeekPoints = previous?.totalPoints ?? 0

    const scheduledDays = days.filter((d) => d.scheduled > 0)
    const bestDay =
      scheduledDays.length > 0
        ? scheduledDays.reduce((m, d) => (d.points > m.points ? d : m))
        : null
    const worstDay =
      scheduledDays.length > 0
        ? scheduledDays.reduce((m, d) => (d.points < m.points ? d : m))
        : null

    // Habit ranking, with a trend against the same habit last week.
    const thisWeek = habitBreakdown(ws, weekEnd)
    const lastWeek = new Map(
      habitBreakdown(addDays(ws, -7), addDays(ws, -1)).map((h) => [h.habitId, h])
    )
    for (const h of thisWeek) {
      const prev = lastWeek.get(h.habitId)
      h.trend = prev && prev.scheduled > 0 ? h.completionRate - prev.completionRate : null
    }

    // Rank by completion rate, then by points, so a habit scheduled more often does
    // not automatically outrank a shorter one it beat on consistency.
    const ranked = [...thisWeek].sort(
      (a, b) => b.completionRate - a.completionRate || b.points - a.points
    )
    const rated = ranked.filter((h) => h.scheduled > 0)

    // --- weekly points target ---------------------------------------------
    const cfg = settings.scoring()
    const weeklyTarget = Math.max(0, settings.all().weeklyPointsTarget)

    // A sensible target to propose: every scheduled occurrence this week completed.
    const scheduledThisWeek = days.reduce((s, d) => s + d.scheduled, 0)
    const suggestedTarget = Math.max(1, scheduledThisWeek * cfg.fullCompletion)

    const targetMet = weeklyTarget > 0 && totalPoints >= weeklyTarget
    const pointsToTarget = weeklyTarget > 0 ? Math.max(0, weeklyTarget - totalPoints) : 0
    const targetProgress =
      weeklyTarget > 0 ? Math.min(1, Math.max(0, totalPoints / weeklyTarget)) : 0

    // Judge the last eight weeks against the CURRENT target. History is re-evaluated
    // rather than frozen, matching how changing the scoring values re-prices past
    // weeks — one target, applied consistently.
    const thisWeekStart = weekStart(today)
    const recentWeeks: WeekVerdict[] = []
    for (let i = 7; i >= 0; i--) {
      const start = addDays(ws, -7 * i)
      const rec = records.weekly(start)
      if (!rec && start !== ws) continue
      const points = rec?.totalPoints ?? (start === ws ? totalPoints : 0)
      const inProgress = start >= thisWeekStart
      recentWeeks.push({
        weekStart: start,
        weekLabel: formatWeekLabel(start),
        points,
        target: weeklyTarget,
        met: weeklyTarget > 0 && points >= weeklyTarget,
        inProgress
      })
    }

    // Count back through COMPLETED weeks only: the current week is still winnable, so
    // it must not break a run before it has had a chance to finish.
    let targetStreak = 0
    if (weeklyTarget > 0) {
      for (let i = recentWeeks.length - 1; i >= 0; i--) {
        const w = recentWeeks[i]!
        if (w.inProgress) continue
        if (w.met) targetStreak++
        else break
      }
    }

    // Month grid: pad back to Saturday so the heatmap lines up with the week columns.
    const monthAnchor = anchor ?? today
    const first = monthStart(monthAnchor)
    const last = addDays(first, daysInMonth(monthAnchor) - 1)
    const gridStart = weekStart(first)
    const gridEnd = addDays(gridStart, 41)
    const monthGrid = daysBetween(gridStart, gridEnd, (d) => d >= first && d <= last)
    const monthPoints = monthGrid.filter((d) => d.inPeriod).reduce((s, d) => s + d.points, 0)
    const peakDayPoints = monthGrid.reduce((m, d) => Math.max(m, d.points), 0)

    return {
      weekStart: ws,
      weekLabel: formatWeekLabel(ws),
      totalPoints,
      basePoints,
      bonusPoints: totalPoints - basePoints,
      previousWeekPoints,
      pointsDelta: improvement(previousWeekPoints, totalPoints),
      days,
      bestDay,
      worstDay,
      habits: ranked,
      best: rated[0] ?? null,
      weakest: rated.length > 1 ? (rated[rated.length - 1] ?? null) : null,
      weeklyTarget,
      suggestedTarget,
      targetMet,
      pointsToTarget,
      targetProgress,
      recentWeeks,
      targetStreak,
      monthAnchor,
      monthGrid,
      monthPoints,
      peakDayPoints
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
      weekLabel: formatWeekLabel(ws),
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
    todoView,
    performance,
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
