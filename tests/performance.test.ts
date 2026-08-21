import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import type { HabitDraft } from '@shared/types'
import { migrate, type Db } from '@main/persistence/db'
import { habitRepo } from '@main/persistence/habitRepo'
import { occurrenceRepo } from '@main/persistence/occurrenceRepo'
import { logRepo } from '@main/persistence/logRepo'
import { recordRepo } from '@main/persistence/recordRepo'
import { settingsRepo } from '@main/persistence/settingsRepo'
import { scheduleService } from '@main/application/scheduleService'
import { recomputeService } from '@main/application/recomputeService'
import { viewService } from '@main/application/viewService'

// Thursday 20 August 2026. The ISO week runs Mon 17 → Sun 23.
const NOW = new Date('2026-08-20T17:43:00.000Z')
const WEEK_START = '2026-08-17'

function harness() {
  const db = new Database(':memory:') as Db
  db.pragma('foreign_keys = ON')
  migrate(db)

  const habits = habitRepo(db)
  const occurrences = occurrenceRepo(db)
  const logs = logRepo(db)
  const records = recordRepo(db)
  const settings = settingsRepo(db)
  settings.save({ timezone: 'Africa/Cairo', provisionHorizonDays: 7 })

  const schedule = scheduleService({ db, habits, occurrences, settings })
  const engine = recomputeService({ db, habits, occurrences, logs, records, settings })
  const views = viewService({
    habits,
    occurrences,
    logs,
    records,
    settings,
    engine,
    runningOccurrenceId: () => null
  })

  return { db, habits, occurrences, logs, records, settings, schedule, engine, views }
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
  active: true,
  ...o
})

let h: ReturnType<typeof harness>

beforeEach(() => {
  h = harness()
})

/** Complete a habit on a date, crediting the target. */
function complete(habitId: number, date: string, target = 120): void {
  h.occurrences.ensure(habitId, date, '18:00', target)
  const occ = h.occurrences.getByHabitDate(habitId, date)!
  h.logs.setAssumed(habitId, occ.id, target, `${date}T16:00:00.000Z`)
  h.occurrences.setStatus(occ.id, 'complete', `${date}T16:00:00.000Z`)
}

/** Leave a habit untouched on a date, so an elapsed day scores it as missed. */
function miss(habitId: number, date: string, target = 120): void {
  h.occurrences.ensure(habitId, date, '18:00', target)
}

function partial(habitId: number, date: string, minutes: number, target = 120): void {
  h.occurrences.ensure(habitId, date, '18:00', target)
  const occ = h.occurrences.getByHabitDate(habitId, date)!
  h.logs.start(habitId, occ.id, `${date}T15:00:00.000Z`)
  h.logs.stop(occ.id, new Date(new Date(`${date}T15:00:00.000Z`).getTime() + minutes * 60_000).toISOString())
}

function refresh(): void {
  h.engine.refresh('2026-07-01', '2026-09-30', NOW)
}

describe('weekly totals', () => {
  it('sums the daily points for the current week', () => {
    const a = h.habits.create(draft())
    complete(a.id, '2026-08-17')
    complete(a.id, '2026-08-18')
    miss(a.id, '2026-08-19')
    refresh()

    const perf = h.views.performance(undefined, NOW)
    expect(perf.weekStart).toBe(WEEK_START)
    // +2 +2 −1 = 3, and Thursday onward is still pending (0).
    expect(perf.basePoints).toBe(3)
  })

  it('separates bonus points from day points', () => {
    const a = h.habits.create(draft())
    for (const d of ['2026-08-17', '2026-08-18', '2026-08-19']) complete(a.id, d)
    refresh()

    const perf = h.views.performance(undefined, NOW)
    expect(perf.totalPoints).toBe(perf.basePoints + perf.bonusPoints)
  })

  it('reports no comparison when there is no previous week', () => {
    const a = h.habits.create(draft())
    complete(a.id, '2026-08-17')
    refresh()

    const perf = h.views.performance(undefined, NOW)
    expect(perf.previousWeekPoints).toBe(0)
    expect(perf.pointsDelta).toBeNull()
  })

  it('compares against the previous week once there is one', () => {
    const a = h.habits.create(draft())
    // Previous week: two completions.
    complete(a.id, '2026-08-10')
    complete(a.id, '2026-08-11')
    // This week: four.
    for (const d of ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20']) complete(a.id, d)
    refresh()

    const perf = h.views.performance(undefined, NOW)
    expect(perf.previousWeekPoints).toBeGreaterThan(0)
    expect(perf.pointsDelta).not.toBeNull()
    expect(perf.pointsDelta!).toBeGreaterThan(0)
  })
})

describe('day-by-day movement', () => {
  it('returns Monday to Sunday in order', () => {
    h.habits.create(draft())
    refresh()
    const perf = h.views.performance(undefined, NOW)
    expect(perf.days).toHaveLength(7)
    expect(perf.days[0]!.date).toBe('2026-08-17')
    expect(perf.days[0]!.weekday).toBe(1)
    expect(perf.days[6]!.date).toBe('2026-08-23')
    expect(perf.days[6]!.weekday).toBe(7)
  })

  it('computes the change against the previous scheduled day', () => {
    const a = h.habits.create(draft())
    complete(a.id, '2026-08-17') // +2
    miss(a.id, '2026-08-18') //     −1
    complete(a.id, '2026-08-19') // +2
    refresh()

    const perf = h.views.performance(undefined, NOW)
    const [mon, tue, wed] = perf.days

    expect(mon!.points).toBe(2)
    expect(mon!.delta).toBeNull() // nothing before it in the week

    expect(tue!.points).toBe(-1)
    expect(tue!.delta).toBe(-3) // 2 → −1

    expect(wed!.points).toBe(2)
    expect(wed!.delta).toBe(3) // −1 → 2
  })

  it('skips unscheduled days rather than reading them as a collapse', () => {
    // Mon/Wed/Fri only: Tuesday has nothing, so Wednesday compares against Monday.
    const a = h.habits.create(draft({ recurrence: { kind: 'weekly', days: [1, 3, 5] } }))
    complete(a.id, '2026-08-17')
    complete(a.id, '2026-08-19')
    refresh()

    const perf = h.views.performance(undefined, NOW)
    const tue = perf.days.find((d) => d.date === '2026-08-18')!
    const wed = perf.days.find((d) => d.date === '2026-08-19')!

    expect(tue.scheduled).toBe(0)
    expect(tue.delta).toBeNull()
    // Wednesday's delta is against Monday, not against the empty Tuesday.
    expect(wed.delta).toBe(0)
  })

  it('identifies the best and weakest scheduled days', () => {
    const a = h.habits.create(draft())
    const b = h.habits.create(draft({ name: 'German', targetMinutes: 45 }))

    complete(a.id, '2026-08-17')
    complete(b.id, '2026-08-17', 45) // Monday: +4
    miss(a.id, '2026-08-18')
    miss(b.id, '2026-08-18', 45) //     Tuesday: −2
    refresh()

    const perf = h.views.performance(undefined, NOW)
    expect(perf.bestDay!.date).toBe('2026-08-17')
    expect(perf.bestDay!.points).toBe(4)
    expect(perf.worstDay!.date).toBe('2026-08-18')
    expect(perf.worstDay!.points).toBe(-2)
  })

  it('has no best or worst day when nothing is scheduled', () => {
    const perf = h.views.performance(undefined, NOW)
    expect(perf.bestDay).toBeNull()
    expect(perf.worstDay).toBeNull()
  })
})

describe('habit ranking', () => {
  it('ranks by completion rate and marks best and weakest', () => {
    const strong = h.habits.create(draft({ name: 'Coding' }))
    const weak = h.habits.create(draft({ name: 'German', targetMinutes: 45 }))

    for (const d of ['2026-08-17', '2026-08-18', '2026-08-19']) complete(strong.id, d)
    complete(weak.id, '2026-08-17', 45)
    miss(weak.id, '2026-08-18', 45)
    miss(weak.id, '2026-08-19', 45)
    refresh()

    const perf = h.views.performance(undefined, NOW)
    expect(perf.best!.name).toBe('Coding')
    expect(perf.best!.completionRate).toBe(100)
    expect(perf.weakest!.name).toBe('German')
    expect(Math.round(perf.weakest!.completionRate)).toBe(33)
  })

  it('does not let a frequently scheduled habit outrank a more consistent one', () => {
    // Daily habit at 60%, twice-weekly habit at 100%.
    const daily = h.habits.create(draft({ name: 'Daily' }))
    const twice = h.habits.create(draft({ name: 'Twice', recurrence: { kind: 'weekly', days: [1, 4] } }))

    complete(daily.id, '2026-08-17')
    complete(daily.id, '2026-08-18')
    complete(daily.id, '2026-08-19')
    miss(daily.id, '2026-08-20')
    miss(daily.id, '2026-08-21')

    complete(twice.id, '2026-08-17')
    complete(twice.id, '2026-08-20')
    refresh()

    const perf = h.views.performance(undefined, NOW)
    // Twice wins on rate despite scoring fewer total points.
    expect(perf.best!.name).toBe('Twice')
    expect(perf.habits[0]!.points).toBeLessThanOrEqual(
      perf.habits.find((x) => x.name === 'Daily')!.points + 4
    )
  })

  it('leaves justified skips out of the denominator', () => {
    const a = h.habits.create(draft())
    complete(a.id, '2026-08-17')
    h.occurrences.ensure(a.id, '2026-08-18', '18:00', 120)
    const skipped = h.occurrences.getByHabitDate(a.id, '2026-08-18')!
    h.occurrences.setJustifiedSkip(skipped.id, true, 'Travelling')
    refresh()

    const perf = h.views.performance(undefined, NOW)
    const habit = perf.habits.find((x) => x.habitId === a.id)!
    // One completion out of one counted day — the skip is not held against it.
    expect(habit.scheduled).toBe(1)
    expect(habit.completionRate).toBe(100)
  })

  it('counts partial and missed days separately', () => {
    const a = h.habits.create(draft())
    complete(a.id, '2026-08-17')
    partial(a.id, '2026-08-18', 60)
    miss(a.id, '2026-08-19')
    refresh()

    const perf = h.views.performance(undefined, NOW)
    const habit = perf.habits.find((x) => x.habitId === a.id)!
    expect(habit.completed).toBe(1)
    expect(habit.partial).toBe(1)
    expect(habit.missed).toBe(1)
    expect(habit.scheduled).toBe(3)
  })

  it('trends a habit against its own previous week', () => {
    const a = h.habits.create(draft())
    // Last week: 1 of 2.
    complete(a.id, '2026-08-10')
    miss(a.id, '2026-08-11')
    // This week: 2 of 2.
    complete(a.id, '2026-08-17')
    complete(a.id, '2026-08-18')
    refresh()

    const perf = h.views.performance(undefined, NOW)
    const habit = perf.habits.find((x) => x.habitId === a.id)!
    expect(habit.trend).toBe(50) // 50% → 100%
  })

  it('reports no trend for a habit with no previous week', () => {
    const a = h.habits.create(draft())
    complete(a.id, '2026-08-17')
    refresh()

    const perf = h.views.performance(undefined, NOW)
    expect(perf.habits.find((x) => x.habitId === a.id)!.trend).toBeNull()
  })

  it('has no weakest habit when only one habit exists', () => {
    const a = h.habits.create(draft())
    complete(a.id, '2026-08-17')
    refresh()

    const perf = h.views.performance(undefined, NOW)
    expect(perf.best).not.toBeNull()
    expect(perf.weakest).toBeNull()
  })
})

describe('month heatmap', () => {
  it('returns a six-week grid starting on a Monday', () => {
    h.habits.create(draft())
    refresh()
    const perf = h.views.performance(undefined, NOW)

    expect(perf.monthGrid).toHaveLength(42)
    expect(perf.monthGrid[0]!.weekday).toBe(1)
    // August 2026 starts on a Saturday, so the grid opens on Monday 27 July.
    expect(perf.monthGrid[0]!.date).toBe('2026-07-27')
  })

  it('marks days outside the month', () => {
    h.habits.create(draft())
    refresh()
    const perf = h.views.performance(undefined, NOW)

    expect(perf.monthGrid.find((d) => d.date === '2026-07-27')!.inPeriod).toBe(false)
    expect(perf.monthGrid.find((d) => d.date === '2026-08-01')!.inPeriod).toBe(true)
    expect(perf.monthGrid.find((d) => d.date === '2026-08-31')!.inPeriod).toBe(true)
    expect(perf.monthGrid.find((d) => d.date === '2026-09-01')!.inPeriod).toBe(false)
  })

  it('totals only the days inside the month', () => {
    const a = h.habits.create(draft())
    complete(a.id, '2026-07-28') // previous month, inside the grid
    complete(a.id, '2026-08-17') // this month
    refresh()

    const perf = h.views.performance(undefined, NOW)
    expect(perf.monthPoints).toBe(2)
    expect(perf.peakDayPoints).toBe(2)
  })

  it('carries the points needed to shade each cell', () => {
    const a = h.habits.create(draft())
    complete(a.id, '2026-08-17')
    refresh()

    const perf = h.views.performance(undefined, NOW)
    const cell = perf.monthGrid.find((d) => d.date === '2026-08-17')!
    expect(cell.points).toBe(2)
    expect(cell.completed).toBe(1)
    expect(cell.scheduled).toBe(1)
    expect(cell.minutes).toBe(120)
  })
})

describe('navigating to another week', () => {
  it('reports the anchored week rather than the current one', () => {
    const a = h.habits.create(draft())
    complete(a.id, '2026-08-10')
    complete(a.id, '2026-08-11')
    refresh()

    const perf = h.views.performance('2026-08-12', NOW)
    expect(perf.weekStart).toBe('2026-08-10')
    expect(perf.basePoints).toBe(4)
  })
})
