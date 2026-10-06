import { beforeEach, describe, expect, it } from 'vitest'
import type { HabitDraft } from '@shared/types'
import { freshDb } from './pg'
import { habitRepo } from '@server/persistence/habitRepo'
import { occurrenceRepo } from '@server/persistence/occurrenceRepo'
import { logRepo } from '@server/persistence/logRepo'
import { recordRepo } from '@server/persistence/recordRepo'
import { settingsRepo } from '@server/persistence/settingsRepo'
import { todoRepo } from '@server/persistence/todoRepo'
import { scheduleService } from '@server/application/scheduleService'
import { recomputeService } from '@server/application/recomputeService'
import { viewService } from '@server/application/viewService'

// Thursday 20 August 2026. The user's week runs Sat 15 → Fri 21.
const NOW = new Date('2026-08-20T17:43:00.000Z')
const WEEK_START = '2026-08-15'

async function harness() {
  const db = await freshDb()

  const habits = habitRepo(db)
  const occurrences = occurrenceRepo(db)
  const logs = logRepo(db)
  const records = recordRepo(db)
  const settings = settingsRepo(db)
  const todos = todoRepo(db)
  await settings.save({ timezone: 'Africa/Cairo', provisionHorizonDays: 7 })

  const schedule = scheduleService({ db, habits, occurrences, settings })
  const engine = recomputeService({ db, habits, occurrences, logs, records, settings })
  const views = viewService({
    habits,
    occurrences,
    logs,
    records,
    settings,
    todos,
    engine,
    runningOccurrenceId: async () => null
  })

  return { db, habits, occurrences, logs, records, settings, todos, schedule, engine, views }
}

const draft = (o: Partial<HabitDraft> = {}): HabitDraft => ({
  name: 'Study AI',
  description: null,
  notes: null,
  recurrence: { kind: 'weekly', days: [1, 2, 3, 4, 5, 6, 7] },
  scheduledTime: '18:00',
  targetMinutes: 120,
  baselineMinutes: 120,
  difficultyLevel: 3,
  reminderLeadMinutes: 30,
  colorKey: 'violet',
  googleTasklistId: null,
  goalId: null,
  active: true,
  ...o
})

let h: Awaited<ReturnType<typeof harness>>

beforeEach(async () => {
  h = await harness()
})

/** Complete a habit on a date, crediting the target. */
async function complete(habitId: number, date: string, target = 120): Promise<void> {
  await h.occurrences.ensure(habitId, date, '18:00', target)
  const occ = (await h.occurrences.getByHabitDate(habitId, date))!
  await h.logs.setAssumed(habitId, occ.id, target, `${date}T16:00:00.000Z`)
  await h.occurrences.setStatus(occ.id, 'complete', `${date}T16:00:00.000Z`)
}

/** Leave a habit untouched on a date, so an elapsed day scores it as missed. */
async function miss(habitId: number, date: string, target = 120): Promise<void> {
  await h.occurrences.ensure(habitId, date, '18:00', target)
}

async function partial(habitId: number, date: string, minutes: number, target = 120): Promise<void> {
  await h.occurrences.ensure(habitId, date, '18:00', target)
  const occ = (await h.occurrences.getByHabitDate(habitId, date))!
  await h.logs.start(habitId, occ.id, `${date}T15:00:00.000Z`)
  await h.logs.stop(occ.id, new Date(new Date(`${date}T15:00:00.000Z`).getTime() + minutes * 60_000).toISOString())
}

async function refresh(): Promise<void> {
  await h.engine.refresh('2026-07-01', '2026-09-30', NOW)
}

describe('weekly totals', () => {
  it('sums the daily points for the current week', async () => {
    const a = await h.habits.create(draft())
    await complete(a.id, '2026-08-17')
    await complete(a.id, '2026-08-18')
    await miss(a.id, '2026-08-19')
    await refresh()

    const perf = await h.views.performance(undefined, NOW)
    expect(perf.weekStart).toBe(WEEK_START)
    // +2 +2 −1 = 3, and Thursday onward is still pending (0).
    expect(perf.basePoints).toBe(3)
  })

  it('separates bonus points from day points', async () => {
    const a = await h.habits.create(draft())
    for (const d of ['2026-08-17', '2026-08-18', '2026-08-19']) (await complete(a.id, d))
    await refresh()

    const perf = await h.views.performance(undefined, NOW)
    expect(perf.totalPoints).toBe(perf.basePoints + perf.bonusPoints)
  })

  it('reports no comparison when there is no previous week', async () => {
    const a = await h.habits.create(draft())
    await complete(a.id, '2026-08-17')
    await refresh()

    const perf = await h.views.performance(undefined, NOW)
    expect(perf.previousWeekPoints).toBe(0)
    expect(perf.pointsDelta).toBeNull()
  })

  it('compares against the previous week once there is one', async () => {
    const a = await h.habits.create(draft())
    // Previous week: two completions.
    await complete(a.id, '2026-08-10')
    await complete(a.id, '2026-08-11')
    // This week: four.
    for (const d of ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20']) (await complete(a.id, d))
    await refresh()

    const perf = await h.views.performance(undefined, NOW)
    expect(perf.previousWeekPoints).toBeGreaterThan(0)
    expect(perf.pointsDelta).not.toBeNull()
    expect(perf.pointsDelta!).toBeGreaterThan(0)
  })
})

describe('day-by-day movement', () => {
  it('returns Saturday to Friday in order', async () => {
    await h.habits.create(draft())
    await refresh()
    const perf = await h.views.performance(undefined, NOW)
    expect(perf.days).toHaveLength(7)
    expect(perf.days[0]!.date).toBe('2026-08-15')
    expect(perf.days[0]!.weekday).toBe(6)
    expect(perf.days[6]!.date).toBe('2026-08-21')
    expect(perf.days[6]!.weekday).toBe(5)
  })

  it('computes the change against the previous scheduled day', async () => {
    const a = await h.habits.create(draft())
    await complete(a.id, '2026-08-17') // +2
    await miss(a.id, '2026-08-18') //     −1
    await complete(a.id, '2026-08-19') // +2
    await refresh()

    const perf = await h.views.performance(undefined, NOW)
    const mon = perf.days.find((d) => d.date === '2026-08-17')!
    const tue = perf.days.find((d) => d.date === '2026-08-18')!
    const wed = perf.days.find((d) => d.date === '2026-08-19')!

    expect(mon.points).toBe(2)
    expect(mon.delta).toBeNull() // Sat/Sun before it were never scheduled

    expect(tue.points).toBe(-1)
    expect(tue.delta).toBe(-3) // 2 → −1

    expect(wed.points).toBe(2)
    expect(wed.delta).toBe(3) // −1 → 2
  })

  it('skips unscheduled days rather than reading them as a collapse', async () => {
    // Mon/Wed/Fri only: Tuesday has nothing, so Wednesday compares against Monday.
    const a = await h.habits.create(draft({ recurrence: { kind: 'weekly', days: [1, 3, 5] } }))
    await complete(a.id, '2026-08-17')
    await complete(a.id, '2026-08-19')
    await refresh()

    const perf = await h.views.performance(undefined, NOW)
    const tue = perf.days.find((d) => d.date === '2026-08-18')!
    const wed = perf.days.find((d) => d.date === '2026-08-19')!

    expect(tue.scheduled).toBe(0)
    expect(tue.delta).toBeNull()
    // Wednesday's delta is against Monday, not against the empty Tuesday.
    expect(wed.delta).toBe(0)
  })

  it('identifies the best and weakest scheduled days', async () => {
    const a = await h.habits.create(draft())
    const b = await h.habits.create(draft({ name: 'German', targetMinutes: 45 }))

    await complete(a.id, '2026-08-17')
    await complete(b.id, '2026-08-17', 45) // Monday: +4
    await miss(a.id, '2026-08-18')
    await miss(b.id, '2026-08-18', 45) //     Tuesday: −2
    await refresh()

    const perf = await h.views.performance(undefined, NOW)
    expect(perf.bestDay!.date).toBe('2026-08-17')
    expect(perf.bestDay!.points).toBe(4)
    expect(perf.worstDay!.date).toBe('2026-08-18')
    expect(perf.worstDay!.points).toBe(-2)
  })

  it('has no best or worst day when nothing is scheduled', async () => {
    const perf = await h.views.performance(undefined, NOW)
    expect(perf.bestDay).toBeNull()
    expect(perf.worstDay).toBeNull()
  })
})

describe('habit ranking', () => {
  it('ranks by completion rate and marks best and weakest', async () => {
    const strong = await h.habits.create(draft({ name: 'Coding' }))
    const weak = await h.habits.create(draft({ name: 'German', targetMinutes: 45 }))

    for (const d of ['2026-08-17', '2026-08-18', '2026-08-19']) (await complete(strong.id, d))
    await complete(weak.id, '2026-08-17', 45)
    await miss(weak.id, '2026-08-18', 45)
    await miss(weak.id, '2026-08-19', 45)
    await refresh()

    const perf = await h.views.performance(undefined, NOW)
    expect(perf.best!.name).toBe('Coding')
    expect(perf.best!.completionRate).toBe(100)
    expect(perf.weakest!.name).toBe('German')
    expect(Math.round(perf.weakest!.completionRate)).toBe(33)
  })

  it('does not let a frequently scheduled habit outrank a more consistent one', async () => {
    // Daily habit at 60%, twice-weekly habit at 100%.
    const daily = await h.habits.create(draft({ name: 'Daily' }))
    const twice = await h.habits.create(draft({ name: 'Twice', recurrence: { kind: 'weekly', days: [1, 4] } }))

    await complete(daily.id, '2026-08-17')
    await complete(daily.id, '2026-08-18')
    await complete(daily.id, '2026-08-19')
    await miss(daily.id, '2026-08-20')
    await miss(daily.id, '2026-08-21')

    await complete(twice.id, '2026-08-17')
    await complete(twice.id, '2026-08-20')
    await refresh()

    const perf = await h.views.performance(undefined, NOW)
    // Twice wins on rate despite scoring fewer total points.
    expect(perf.best!.name).toBe('Twice')
    expect(perf.habits[0]!.points).toBeLessThanOrEqual(
      perf.habits.find((x) => x.name === 'Daily')!.points + 4
    )
  })

  it('leaves justified skips out of the denominator', async () => {
    const a = await h.habits.create(draft())
    await complete(a.id, '2026-08-17')
    await h.occurrences.ensure(a.id, '2026-08-18', '18:00', 120)
    const skipped = (await h.occurrences.getByHabitDate(a.id, '2026-08-18'))!
    await h.occurrences.setJustifiedSkip(skipped.id, true, 'Travelling')
    await refresh()

    const perf = await h.views.performance(undefined, NOW)
    const habit = perf.habits.find((x) => x.habitId === a.id)!
    // One completion out of one counted day — the skip is not held against it.
    expect(habit.scheduled).toBe(1)
    expect(habit.completionRate).toBe(100)
  })

  it('counts partial and missed days separately', async () => {
    const a = await h.habits.create(draft())
    await complete(a.id, '2026-08-17')
    await partial(a.id, '2026-08-18', 60)
    await miss(a.id, '2026-08-19')
    await refresh()

    const perf = await h.views.performance(undefined, NOW)
    const habit = perf.habits.find((x) => x.habitId === a.id)!
    expect(habit.completed).toBe(1)
    expect(habit.partial).toBe(1)
    expect(habit.missed).toBe(1)
    expect(habit.scheduled).toBe(3)
  })

  it('trends a habit against its own previous week', async () => {
    const a = await h.habits.create(draft())
    // Last week: 1 of 2.
    await complete(a.id, '2026-08-10')
    await miss(a.id, '2026-08-11')
    // This week: 2 of 2.
    await complete(a.id, '2026-08-17')
    await complete(a.id, '2026-08-18')
    await refresh()

    const perf = await h.views.performance(undefined, NOW)
    const habit = perf.habits.find((x) => x.habitId === a.id)!
    expect(habit.trend).toBe(50) // 50% → 100%
  })

  it('reports no trend for a habit with no previous week', async () => {
    const a = await h.habits.create(draft())
    await complete(a.id, '2026-08-17')
    await refresh()

    const perf = await h.views.performance(undefined, NOW)
    expect(perf.habits.find((x) => x.habitId === a.id)!.trend).toBeNull()
  })

  it('has no weakest habit when only one habit exists', async () => {
    const a = await h.habits.create(draft())
    await complete(a.id, '2026-08-17')
    await refresh()

    const perf = await h.views.performance(undefined, NOW)
    expect(perf.best).not.toBeNull()
    expect(perf.weakest).toBeNull()
  })
})

describe('month heatmap', () => {
  it('returns a six-week grid starting on a Saturday', async () => {
    await h.habits.create(draft())
    await refresh()
    const perf = await h.views.performance(undefined, NOW)

    expect(perf.monthGrid).toHaveLength(42)
    expect(perf.monthGrid[0]!.weekday).toBe(6)
    // August 2026 opens on a Saturday itself, so the grid needs no lead-in padding.
    expect(perf.monthGrid[0]!.date).toBe('2026-08-01')
  })

  it('marks days outside the month', async () => {
    await h.habits.create(draft())
    await refresh()
    const perf = await h.views.performance(undefined, NOW)

    expect(perf.monthGrid.find((d) => d.date === '2026-08-01')!.inPeriod).toBe(true)
    expect(perf.monthGrid.find((d) => d.date === '2026-08-31')!.inPeriod).toBe(true)
    expect(perf.monthGrid.find((d) => d.date === '2026-09-01')!.inPeriod).toBe(false)
    expect(perf.monthGrid.find((d) => d.date === '2026-09-11')!.inPeriod).toBe(false)
  })

  it('totals only the days inside the month', async () => {
    const a = await h.habits.create(draft())
    await complete(a.id, '2026-07-28') // previous month, inside the grid
    await complete(a.id, '2026-08-17') // this month
    await refresh()

    const perf = await h.views.performance(undefined, NOW)
    expect(perf.monthPoints).toBe(2)
    expect(perf.peakDayPoints).toBe(2)
  })

  it('carries the points needed to shade each cell', async () => {
    const a = await h.habits.create(draft())
    await complete(a.id, '2026-08-17')
    await refresh()

    const perf = await h.views.performance(undefined, NOW)
    const cell = perf.monthGrid.find((d) => d.date === '2026-08-17')!
    expect(cell.points).toBe(2)
    expect(cell.completed).toBe(1)
    expect(cell.scheduled).toBe(1)
    expect(cell.minutes).toBe(120)
  })
})

describe('navigating to another week', () => {
  it('reports the anchored week rather than the current one', async () => {
    const a = await h.habits.create(draft())
    await complete(a.id, '2026-08-10')
    await complete(a.id, '2026-08-11')
    await refresh()

    const perf = await h.views.performance('2026-08-12', NOW)
    expect(perf.weekStart).toBe('2026-08-08')
    expect(perf.basePoints).toBe(4)
  })
})

describe('a fresh database stays clean', () => {
  it('writes no weekly rows and no personal records with nothing scheduled', async () => {
    // Exactly what happens on first launch: bootstrap expands an empty schedule and
    // recomputes. Neither should leave derived rows behind.
    await h.schedule.expandHorizon(NOW)
    await h.engine.refresh('2026-08-01', '2026-09-30', NOW)

    expect(await h.records.weeklyAll(50)).toHaveLength(0)
    expect(await h.records.personalRecords()).toHaveLength(0)
  })

  it('never records a personal best of zero', async () => {
    await h.records.putPersonalRecord('longest_streak', 0, '0 days', null)
    expect(await h.records.personalRecords()).toHaveLength(0)

    await h.records.putPersonalRecord('longest_streak', 3, '3 days', '2026-08-20')
    expect(await h.records.personalRecords()).toHaveLength(1)
  })

  it('clears a weekly row once its last habit is gone', async () => {
    const a = await h.habits.create(draft())
    await complete(a.id, '2026-08-17')
    await refresh()
    expect(await h.records.weekly('2026-08-15')).not.toBeNull()

    // Deleting the habit cascades its records away; the week should go with them.
    await h.habits.remove(a.id)
    await refresh()
    expect(await h.records.weekly('2026-08-15')).toBeNull()
  })
})

describe('weekly points target', () => {
  it('reports no target until one is set, and suggests a sensible one', async () => {
    const a = await h.habits.create(draft())
    await complete(a.id, '2026-08-17')
    await refresh()

    const perf = await h.views.performance(undefined, NOW)
    expect(perf.weeklyTarget).toBe(0)
    expect(perf.targetMet).toBe(false)
    // Suggestion = every scheduled occurrence completed, at +2 each.
    expect(perf.suggestedTarget).toBeGreaterThan(0)
  })

  it('tracks progress toward the target', async () => {
    const a = await h.habits.create(draft())
    await complete(a.id, '2026-08-17')
    await complete(a.id, '2026-08-18')
    await refresh()
    await h.settings.save({ weeklyPointsTarget: 10 })

    const perf = await h.views.performance(undefined, NOW)
    expect(perf.weeklyTarget).toBe(10)
    expect(perf.targetMet).toBe(perf.totalPoints >= 10)
    expect(perf.pointsToTarget).toBe(Math.max(0, 10 - perf.totalPoints))
    expect(perf.targetProgress).toBeCloseTo(Math.min(1, perf.totalPoints / 10), 5)
  })

  it('marks the target met once the points land', async () => {
    const a = await h.habits.create(draft())
    for (const d of ['2026-08-17', '2026-08-18', '2026-08-19']) (await complete(a.id, d))
    await refresh()
    await h.settings.save({ weeklyPointsTarget: 3 })

    const perf = await h.views.performance(undefined, NOW)
    expect(perf.targetMet).toBe(true)
    expect(perf.pointsToTarget).toBe(0)
    expect(perf.targetProgress).toBe(1)
  })

  it('judges each recent week and marks the current one in progress', async () => {
    const a = await h.habits.create(draft())
    await complete(a.id, '2026-08-10')
    await complete(a.id, '2026-08-11')
    await complete(a.id, '2026-08-17')
    await refresh()
    await h.settings.save({ weeklyPointsTarget: 3 })

    const perf = await h.views.performance(undefined, NOW)
    const current = perf.recentWeeks.find((w) => w.weekStart === '2026-08-15')!
    const previous = perf.recentWeeks.find((w) => w.weekStart === '2026-08-08')

    expect(current.inProgress).toBe(true)
    if (previous) expect(previous.inProgress).toBe(false)
    expect(perf.recentWeeks.every((w) => w.target === 3)).toBe(true)
  })

  it('does not let the unfinished current week break the streak', async () => {
    const a = await h.habits.create(draft())
    // A completed previous week that met the target.
    for (const d of ['2026-08-10', '2026-08-11', '2026-08-12']) (await complete(a.id, d))
    // The current week has barely started.
    await refresh()
    await h.settings.save({ weeklyPointsTarget: 5 })

    const perf = await h.views.performance(undefined, NOW)
    // The current week is still winnable, so it is skipped rather than counted a miss.
    expect(perf.targetStreak).toBeGreaterThanOrEqual(1)
  })

  it('turns the target off again when set to zero', async () => {
    const a = await h.habits.create(draft())
    await complete(a.id, '2026-08-17')
    await refresh()
    await h.settings.save({ weeklyPointsTarget: 5 })
    expect((await h.views.performance(undefined, NOW)).weeklyTarget).toBe(5)

    await h.settings.save({ weeklyPointsTarget: 0 })
    const off = await h.views.performance(undefined, NOW)
    expect(off.weeklyTarget).toBe(0)
    expect(off.targetMet).toBe(false)
    expect(off.targetStreak).toBe(0)
  })
})
