import { beforeEach, describe, expect, it } from 'vitest'
import type { HabitDraft } from '@shared/types'
import type { Db } from '@server/persistence/db'
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

// Thursday 20 August 2026, 20:43 Cairo time.
const NOW = new Date('2026-08-20T17:43:00.000Z')
const TODAY = '2026-08-20'

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

  return { db, habits, occurrences, logs, records, settings, todos, schedule, engine }
}

const draft = (o: Partial<HabitDraft> = {}): HabitDraft => ({
  name: 'Study AI',
  description: null,
  notes: null,
  recurrence: { kind: 'weekly', days: [1, 2, 3, 4, 5] },
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

/** Snapshot of everything derived, for byte-comparison across repeated runs. */
async function snapshot(db: Db) {
  return JSON.stringify({
    occurrences: await db.prepare('SELECT * FROM occurrence ORDER BY id').all(),
    daily: await db.prepare('SELECT * FROM daily_record ORDER BY habit_id, date').all(),
    weekly: await db.prepare('SELECT * FROM weekly_record ORDER BY week_start').all(),
    achievements: await db.prepare('SELECT * FROM user_achievement ORDER BY achievement_key').all()
  })
}

describe('schedule expansion', () => {
  it('materialises Mon–Fri occurrences over the horizon', async () => {
    const habit = await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW)

    const rows = await h.occurrences.listForHabit(habit.id, '2026-08-19', '2026-08-27')
    expect(rows.map((r) => r.date)).toEqual([
      '2026-08-19',
      '2026-08-20',
      '2026-08-21',
      '2026-08-24',
      '2026-08-25',
      '2026-08-26',
      '2026-08-27'
    ])
  })

  it('is idempotent across repeated expansions', async () => {
    await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW)
    const first = await snapshot(h.db)

    for (let i = 0; i < 5; i++) (await h.schedule.expandHorizon(NOW))
    expect(await snapshot(h.db)).toBe(first)
  })

  it('adds future days after a schedule change without touching the past', async () => {
    const habit = await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW)

    // Complete yesterday, so we can prove it survives.
    const yesterday = (await h.occurrences.getByHabitDate(habit.id, '2026-08-19'))!
    await h.occurrences.setStatus(yesterday.id, 'complete', '2026-08-19T16:00:00.000Z')

    const widened = await h.habits.update(habit.id, {
      ...draft(),
      recurrence: { kind: 'weekly', days: [1, 2, 3, 4, 5, 6, 7] }
    })
    const { added, orphaned } = await h.schedule.reschedule(widened, NOW)

    expect(added).toContain('2026-08-22') // Saturday, newly scheduled
    expect(added).toContain('2026-08-23') // Sunday
    expect(orphaned).toHaveLength(0)
    expect((await h.occurrences.get(yesterday.id))!.status).toBe('complete')
  })

  it('orphans future days a narrowed schedule no longer covers', async () => {
    const habit = await h.habits.create(draft({ recurrence: { kind: 'weekly', days: [1, 2, 3, 4, 5, 6, 7] } }))
    await h.schedule.expandHorizon(NOW)

    const narrowed = await h.habits.update(habit.id, {
      ...draft(),
      recurrence: { kind: 'weekly', days: [1, 3, 5] }
    })
    const { orphaned } = await h.schedule.reschedule(narrowed, NOW)

    expect(orphaned.length).toBeGreaterThan(0)
    // Nothing in the past is ever orphaned.
    for (const id of orphaned) {
      expect((await h.occurrences.get(id))!.date >= TODAY).toBe(true)
    }
  })
})

describe('scoring a day', () => {
  it('scores a completed habit with measured time', async () => {
    const habit = await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW)
    const occ = (await h.occurrences.getByHabitDate(habit.id, TODAY))!

    await h.logs.start(habit.id, occ.id, '2026-08-20T15:00:00.000Z')
    await h.logs.stop(occ.id, '2026-08-20T17:00:00.000Z') // 120 minutes
    await h.occurrences.setStatus(occ.id, 'complete', '2026-08-20T17:00:00.000Z')

    await h.engine.refresh('2026-08-19', '2026-08-27', NOW)

    const rec = (await h.records.dailyForHabit(habit.id, TODAY, TODAY))[0]!
    expect(rec.status).toBe('complete')
    expect(rec.points).toBe(2)
    expect(rec.xp).toBe(20)
    expect(rec.durationMinutes).toBe(120)
    expect(rec.origin).toBe('timer')
  })

  it('scores a partial habit proportionally', async () => {
    const habit = await h.habits.create(draft({ name: 'German', targetMinutes: 45, difficultyLevel: 2 }))
    await h.schedule.expandHorizon(NOW)
    const occ = (await h.occurrences.getByHabitDate(habit.id, TODAY))!

    await h.logs.start(habit.id, occ.id, '2026-08-20T16:00:00.000Z')
    await h.logs.stop(occ.id, '2026-08-20T16:27:00.000Z') // 27 of 45

    await h.engine.refresh('2026-08-19', '2026-08-27', NOW)

    const rec = (await h.records.dailyForHabit(habit.id, TODAY, TODAY))[0]!
    expect(rec.status).toBe('partial')
    expect(rec.points).toBe(1)
    expect(rec.durationMinutes).toBe(27)
  })

  it('credits the target and badges it when Google reports a tick with no timer', async () => {
    const habit = await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW)
    const occ = (await h.occurrences.getByHabitDate(habit.id, TODAY))!

    // What the sync does on seeing status=completed with nothing logged locally.
    await h.logs.setAssumed(habit.id, occ.id, occ.targetMinutes, '2026-08-20T17:00:00.000Z')
    await h.occurrences.setStatus(occ.id, 'complete', '2026-08-20T17:00:00.000Z')

    await h.engine.refresh('2026-08-19', '2026-08-27', NOW)

    const rec = (await h.records.dailyForHabit(habit.id, TODAY, TODAY))[0]!
    expect(rec.status).toBe('complete')
    expect(rec.durationMinutes).toBe(120)
    expect(rec.origin).toBe('assumed')
  })

  it('leaves today pending rather than missed', async () => {
    const habit = await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW)
    await h.engine.refresh('2026-08-19', '2026-08-27', NOW)

    const rec = (await h.records.dailyForHabit(habit.id, TODAY, TODAY))[0]!
    expect(rec.status).toBe('pending')
    expect(rec.points).toBe(0)
  })

  it('marks an elapsed empty day as missed', async () => {
    const habit = await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW)
    await h.engine.refresh('2026-08-19', '2026-08-27', NOW)

    const rec = (await h.records.dailyForHabit(habit.id, '2026-08-19', '2026-08-19'))[0]!
    expect(rec.status).toBe('missed')
    expect(rec.points).toBe(-1)
  })

  it('never penalises a justified skip', async () => {
    const habit = await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW)
    const yesterday = (await h.occurrences.getByHabitDate(habit.id, '2026-08-19'))!
    await h.occurrences.setJustifiedSkip(yesterday.id, true, 'Travelling')

    await h.engine.refresh('2026-08-19', '2026-08-27', NOW)

    const rec = (await h.records.dailyForHabit(habit.id, '2026-08-19', '2026-08-19'))[0]!
    expect(rec.status).toBe('skipped')
    expect(rec.points).toBe(0)
  })
})

describe('idempotency', () => {
  it('produces a byte-identical database across five recomputes', async () => {
    const a = await h.habits.create(draft())
    const b = await h.habits.create(draft({ name: 'German', targetMinutes: 45, difficultyLevel: 2 }))
    await h.schedule.expandHorizon(NOW)

    const oa = (await h.occurrences.getByHabitDate(a.id, TODAY))!
    await h.logs.start(a.id, oa.id, '2026-08-20T15:00:00.000Z')
    await h.logs.stop(oa.id, '2026-08-20T17:00:00.000Z')
    await h.occurrences.setStatus(oa.id, 'complete', '2026-08-20T17:00:00.000Z')

    const ob = (await h.occurrences.getByHabitDate(b.id, TODAY))!
    await h.logs.start(b.id, ob.id, '2026-08-20T16:00:00.000Z')
    await h.logs.stop(ob.id, '2026-08-20T16:27:00.000Z')

    await h.engine.refresh('2026-08-19', '2026-08-27', NOW)
    const first = await snapshot(h.db)

    for (let i = 0; i < 5; i++) {
      await h.schedule.expandHorizon(NOW)
      await h.engine.refresh('2026-08-19', '2026-08-27', NOW)
    }

    expect(await snapshot(h.db)).toBe(first)
  })

  it('awards no XP twice for the same completion', async () => {
    const habit = await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW)
    const occ = (await h.occurrences.getByHabitDate(habit.id, TODAY))!
    await h.logs.setAssumed(habit.id, occ.id, 120, '2026-08-20T17:00:00.000Z')
    await h.occurrences.setStatus(occ.id, 'complete', '2026-08-20T17:00:00.000Z')

    await h.engine.refresh('2026-08-19', '2026-08-27', NOW)
    const xpOnce = await h.records.totalXp()

    for (let i = 0; i < 4; i++) (await h.engine.refresh('2026-08-19', '2026-08-27', NOW))
    expect(await h.records.totalXp()).toBe(xpOnce)
  })
})

describe('reverting a completion', () => {
  it('takes back exactly the points and XP it granted', async () => {
    const habit = await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW)
    const occ = (await h.occurrences.getByHabitDate(habit.id, TODAY))!

    // Ticked in Google.
    await h.logs.setAssumed(habit.id, occ.id, 120, '2026-08-20T17:00:00.000Z')
    await h.occurrences.setStatus(occ.id, 'complete', '2026-08-20T17:00:00.000Z')
    await h.engine.refresh('2026-08-19', '2026-08-27', NOW)

    const after = (await h.records.dailyForHabit(habit.id, TODAY, TODAY))[0]!
    expect(after.points).toBe(2)
    expect(after.xp).toBe(20)

    // Un-ticked in Google: the sync clears the assumed log and the completion mark.
    await h.logs.clearAssumed(occ.id)
    await h.occurrences.setStatus(occ.id, 'pending', null)
    await h.engine.refresh('2026-08-19', '2026-08-27', NOW)

    const reverted = (await h.records.dailyForHabit(habit.id, TODAY, TODAY))[0]!
    expect(reverted.status).toBe('pending')
    expect(reverted.points).toBe(0)
    expect(reverted.xp).toBe(0)
    expect(await h.records.totalXp()).toBe(0)
  })

  it('keeps measured time when a Google completion is undone', async () => {
    const habit = await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW)
    const occ = (await h.occurrences.getByHabitDate(habit.id, TODAY))!

    // The user genuinely ran the timer for 30 minutes, then ticked it in Google.
    await h.logs.start(habit.id, occ.id, '2026-08-20T15:00:00.000Z')
    await h.logs.stop(occ.id, '2026-08-20T15:30:00.000Z')
    await h.occurrences.setStatus(occ.id, 'complete', '2026-08-20T17:00:00.000Z')
    await h.engine.refresh('2026-08-19', '2026-08-27', NOW)
    expect((await h.records.dailyForHabit(habit.id, TODAY, TODAY))[0]!.status).toBe('complete')

    // Un-ticking must not discard the 30 measured minutes.
    await h.occurrences.setStatus(occ.id, 'pending', null)
    await h.engine.refresh('2026-08-19', '2026-08-27', NOW)

    const rec = (await h.records.dailyForHabit(habit.id, TODAY, TODAY))[0]!
    expect(rec.durationMinutes).toBe(30)
    expect(rec.status).toBe('partial')
    expect(rec.origin).toBe('timer')
  })
})

describe('streaks and achievements', () => {
  it('counts a streak across scheduled days only', async () => {
    const habit = await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW)

    // Complete the whole preceding week.
    for (const d of ['2026-08-10', '2026-08-11', '2026-08-12', '2026-08-13', '2026-08-14']) {
      await h.occurrences.ensure(habit.id, d, '18:00', 120)
      const o = (await h.occurrences.getByHabitDate(habit.id, d))!
      await h.logs.setAssumed(habit.id, o.id, 120, `${d}T16:00:00.000Z`)
      await h.occurrences.setStatus(o.id, 'complete', `${d}T16:00:00.000Z`)
    }
    await h.occurrences.ensure(habit.id, '2026-08-17', '18:00', 120)
    const mon = (await h.occurrences.getByHabitDate(habit.id, '2026-08-17'))!
    await h.logs.setAssumed(habit.id, mon.id, 120, '2026-08-17T16:00:00.000Z')
    await h.occurrences.setStatus(mon.id, 'complete', '2026-08-17T16:00:00.000Z')

    await h.engine.refresh('2026-08-10', '2026-08-27', NOW)

    // Mon 17th follows Fri 14th with no scheduled day between: the weekend does not break it.
    expect((await h.engine.streakFor(habit.id)).longest).toBe(6)
  })

  it('unlocks the 7-day streak achievement exactly once', async () => {
    const habit = await h.habits.create(draft({ recurrence: { kind: 'weekly', days: [1, 2, 3, 4, 5, 6, 7] } }))
    for (let i = 8; i <= 15; i++) {
      const d = `2026-08-${String(i).padStart(2, '0')}`
      await h.occurrences.ensure(habit.id, d, '18:00', 120)
      const o = (await h.occurrences.getByHabitDate(habit.id, d))!
      await h.logs.setAssumed(habit.id, o.id, 120, `${d}T16:00:00.000Z`)
      await h.occurrences.setStatus(o.id, 'complete', `${d}T16:00:00.000Z`)
    }

    const first = await h.engine.refresh('2026-08-08', '2026-08-27', NOW)
    expect(first.newAchievements).toContain('streak_7')

    const second = await h.engine.refresh('2026-08-08', '2026-08-27', NOW)
    expect(second.newAchievements).toEqual([])
    expect((await h.records.unlockedAchievements()).has('streak_7')).toBe(true)
  })
})

describe('weekly aggregation', () => {
  it('rolls daily records up and computes improvement against the previous week', async () => {
    const habit = await h.habits.create(draft())

    // Previous week: three completions.
    for (const d of ['2026-08-10', '2026-08-11', '2026-08-12']) {
      await h.occurrences.ensure(habit.id, d, '18:00', 120)
      const o = (await h.occurrences.getByHabitDate(habit.id, d))!
      await h.logs.setAssumed(habit.id, o.id, 120, `${d}T16:00:00.000Z`)
      await h.occurrences.setStatus(o.id, 'complete', `${d}T16:00:00.000Z`)
    }
    // This week: four.
    for (const d of ['2026-08-17', '2026-08-18', '2026-08-19', '2026-08-20']) {
      await h.occurrences.ensure(habit.id, d, '18:00', 120)
      const o = (await h.occurrences.getByHabitDate(habit.id, d))!
      await h.logs.setAssumed(habit.id, o.id, 120, `${d}T16:00:00.000Z`)
      await h.occurrences.setStatus(o.id, 'complete', `${d}T16:00:00.000Z`)
    }

    await h.engine.refresh('2026-08-10', '2026-08-27', NOW)

    // Weeks run Sat–Fri: 08-10/11/12 (Mon–Wed) fall in the week starting 08-08, and
    // 08-17/18/19/20 (Mon–Thu) fall in the week starting 08-15 — one week later.
    const prev = (await h.records.weekly('2026-08-08'))!
    const cur = (await h.records.weekly('2026-08-15'))!
    expect(prev.totalMinutes).toBe(360)
    expect(cur.totalMinutes).toBe(480)
    expect(cur.improvementPercentage).toBeCloseTo(33.33, 1)
  })
})

describe('rebuild from source', () => {
  it('reconstructs identical records after dropping every derived table', async () => {
    const habit = await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW)
    const occ = (await h.occurrences.getByHabitDate(habit.id, TODAY))!
    await h.logs.setAssumed(habit.id, occ.id, 120, '2026-08-20T17:00:00.000Z')
    await h.occurrences.setStatus(occ.id, 'complete', '2026-08-20T17:00:00.000Z')
    await h.engine.refresh('2026-08-19', '2026-08-27', NOW)

    const before = JSON.stringify(await h.records.dailyInRange('2026-08-19', '2026-08-27'))

    await h.engine.rebuildAll(NOW)

    expect(JSON.stringify(await h.records.dailyInRange('2026-08-19', '2026-08-27'))).toBe(before)
  })
})

describe('live timer figures', () => {
  it('reports settled minutes separately from a running timer', async () => {
    const habit = await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW)
    const occ = (await h.occurrences.getByHabitDate(habit.id, TODAY))!

    // 25 finished minutes, then a timer running for another 10.
    await h.logs.start(habit.id, occ.id, '2026-08-20T14:00:00.000Z')
    await h.logs.stop(occ.id, '2026-08-20T14:25:00.000Z')
    await h.logs.start(habit.id, occ.id, '2026-08-20T17:33:00.000Z')

    const views = viewService({
      habits: h.habits,
      occurrences: h.occurrences,
      logs: h.logs,
      records: h.records,
      settings: h.settings,
      todos: h.todos,
      engine: h.engine,
      runningOccurrenceId: async () => occ.id
    })

    const card = (await views.dashboard(NOW)).cards.find((c) => c.occurrenceId === occ.id)!
    expect(card.timerRunning).toBe(true)
    // 25 finished + 10 elapsed = 35 total, of which 25 are settled.
    expect(card.loggedMinutes).toBe(35)
    expect(card.closedMinutes).toBe(25)

    // The UI adds elapsed time to the settled figure; doing so must not double-count.
    const elapsed = Math.floor(
      (NOW.getTime() - new Date(card.timerStartedAt!).getTime()) / 60000
    )
    expect(card.closedMinutes + elapsed).toBe(card.loggedMinutes)
  })

  it('leaves settled minutes equal to the total when no timer runs', async () => {
    const habit = await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW)
    const occ = (await h.occurrences.getByHabitDate(habit.id, TODAY))!
    await h.logs.start(habit.id, occ.id, '2026-08-20T14:00:00.000Z')
    await h.logs.stop(occ.id, '2026-08-20T14:40:00.000Z')

    const views = viewService({
      habits: h.habits,
      occurrences: h.occurrences,
      logs: h.logs,
      records: h.records,
      settings: h.settings,
      todos: h.todos,
      engine: h.engine,
      runningOccurrenceId: async () => null
    })

    const card = (await views.dashboard(NOW)).cards.find((c) => c.occurrenceId === occ.id)!
    expect(card.loggedMinutes).toBe(40)
    expect(card.closedMinutes).toBe(40)
  })
})

describe('progress view', () => {
  it('stops its charts at the current week, though next week is already scheduled', async () => {
    const habit = await h.habits.create(draft())
    // Two past weeks of finished work, then the horizon reaching into next week.
    for (let d = -14; d <= 0; d++) {
      const day = new Date(NOW.getTime() + d * 86_400_000)
      await h.schedule.expandHorizon(day)
    }
    for (const occ of (await h.occurrences.listInRange('2026-08-06', '2026-08-19'))) {
      await h.logs.addManual(habit.id, occ.id, 120, `${occ.date}T18:00:00.000Z`)
      await h.occurrences.setStatus(occ.id, 'complete', `${occ.date}T20:00:00.000Z`)
    }
    await h.engine.rebuildAll(NOW)

    const views = viewService({
      habits: h.habits,
      occurrences: h.occurrences,
      logs: h.logs,
      records: h.records,
      settings: h.settings,
      todos: h.todos,
      engine: h.engine,
      runningOccurrenceId: async () => null
    })
    const thisWeek = '2026-08-15' // weeks run Saturday to Friday
    const weeks = (await h.records.weeklyAll(20)).map((w) => w.weekStart)
    expect(weeks.some((w) => w > thisWeek)).toBe(true) // next week has a record already

    const series = (await views.progress(8, NOW)).hoursPerWeek
    expect(series.at(-1)!.label).toBe(thisWeek.slice(8))
    expect(series.at(-1)!.value).toBeGreaterThan(0)
  })
})
