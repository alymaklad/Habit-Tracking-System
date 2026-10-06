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
import { habitService } from '@server/application/habitService'
import { todoService } from '@server/application/todoService'
import { viewService } from '@server/application/viewService'
import {
  carriedDays,
  detectAvoidance,
  isOverdue,
  orderByUrgency,
  subtasksSayComplete,
  suggestFromHistory,
  type TodoFacts
} from '@server/domain/todo'

const NOW = new Date('2026-08-20T17:43:00.000Z') // Thursday, 20:43 Cairo
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
  const habitsApi = habitService({ db, habits, occurrences, logs, records, settings, schedule, engine })
  const todosApi = todoService({ db, todos, occurrences, settings, habits: habitsApi })
  const views = viewService({
    habits, occurrences, logs, records, settings, todos, engine,
    runningOccurrenceId: async () => null
  })

  return { db, habits, occurrences, logs, records, settings, todos, schedule, engine, habitsApi, todosApi, views }
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

const fact = (o: Partial<TodoFacts> = {}): TodoFacts => ({
  id: 1, kind: 'manual', title: 'x', done: false, dropped: false,
  date: TODAY, createdOn: TODAY, scheduledTime: null, habitId: null, position: 0,
  ...o
})

// ----------------------------------------------------------- pure domain

describe('carry accounting', () => {
  it('counts days between when it was added and where it sits now', async () => {
    expect(carriedDays(fact({ createdOn: '2026-08-17', date: '2026-08-20' }))).toBe(3)
    expect(carriedDays(fact({ createdOn: TODAY, date: TODAY }))).toBe(0)
  })

  it('never reports a negative carry', async () => {
    expect(carriedDays(fact({ createdOn: '2026-08-25', date: TODAY }))).toBe(0)
  })
})

describe('overdue detection', () => {
  const noon = 12 * 60

  it('marks a passed scheduled time as overdue', async () => {
    expect(isOverdue(fact({ scheduledTime: '09:00' }), TODAY, noon)).toBe(true)
    expect(isOverdue(fact({ scheduledTime: '18:00' }), TODAY, noon)).toBe(false)
  })

  it('marks anything left on an earlier day as overdue', async () => {
    expect(isOverdue(fact({ date: '2026-08-19' }), TODAY, noon)).toBe(true)
  })

  it('never marks a finished or dropped item overdue', async () => {
    expect(isOverdue(fact({ scheduledTime: '09:00', done: true }), TODAY, noon)).toBe(false)
    expect(isOverdue(fact({ scheduledTime: '09:00', dropped: true }), TODAY, noon)).toBe(false)
  })
})

describe('urgency ordering', () => {
  it('puts overdue first, then timed, then untimed, then done', async () => {
    const items = [
      fact({ id: 1, title: 'done', done: true }),
      fact({ id: 2, title: 'untimed' }),
      fact({ id: 3, title: 'later', scheduledTime: '20:00' }),
      fact({ id: 4, title: 'overdue', scheduledTime: '07:00' })
    ]
    const order = orderByUrgency(items, TODAY, 12 * 60).map((t) => t.title)
    expect(order).toEqual(['overdue', 'later', 'untimed', 'done'])
  })

  it('sorts timed items by their time', async () => {
    const items = [
      fact({ id: 1, title: 'late', scheduledTime: '22:00' }),
      fact({ id: 2, title: 'early', scheduledTime: '19:00' })
    ]
    expect(orderByUrgency(items, TODAY, 12 * 60).map((t) => t.title)).toEqual(['early', 'late'])
  })

  it('floats the longest-carried item to the top of the untimed group', async () => {
    const items = [
      fact({ id: 1, title: 'fresh', createdOn: TODAY }),
      fact({ id: 2, title: 'stale', createdOn: '2026-08-15' })
    ]
    expect(orderByUrgency(items, TODAY, 12 * 60).map((t) => t.title)).toEqual(['stale', 'fresh'])
  })

  it('does not mutate the input', async () => {
    const items = [fact({ id: 1 }), fact({ id: 2, scheduledTime: '07:00' })]
    const before = items.map((t) => t.id)
    orderByUrgency(items, TODAY, 12 * 60)
    expect(items.map((t) => t.id)).toEqual(before)
  })
})

describe('avoidance detection', () => {
  it('flags an item carried three days or more', async () => {
    const flags = detectAvoidance([
      fact({ id: 1, title: 'Fix the bug', createdOn: '2026-08-14' }),
      fact({ id: 2, title: 'Buy milk', createdOn: '2026-08-19' })
    ])
    expect(flags).toHaveLength(1)
    expect(flags[0]!.title).toBe('Fix the bug')
    expect(flags[0]!.carried).toBe(6)
  })

  it('says nothing about finished or dropped items', async () => {
    expect(
      detectAvoidance([
        fact({ id: 1, createdOn: '2026-08-10', done: true }),
        fact({ id: 2, createdOn: '2026-08-10', dropped: true })
      ])
    ).toHaveLength(0)
  })

  it('orders the worst offender first', async () => {
    const flags = detectAvoidance([
      fact({ id: 1, title: 'three', createdOn: '2026-08-17' }),
      fact({ id: 2, title: 'ten', createdOn: '2026-08-10' })
    ])
    expect(flags.map((f) => f.title)).toEqual(['ten', 'three'])
  })
})

describe('suggestions from history', () => {
  // Thursdays before 20 August: 13, 6, 30 July…
  const thursdays = ['2026-08-13', '2026-08-06', '2026-07-30', '2026-07-23']

  it('suggests something added on most of that weekday', async () => {
    const history = thursdays.map((date) => ({ title: 'Weekly review', date }))
    const s = suggestFromHistory(history, TODAY)
    expect(s).toHaveLength(1)
    expect(s[0]!.title).toBe('Weekly review')
    expect(s[0]!.reason).toContain('Thursday')
  })

  it('stays quiet below the evidence threshold', async () => {
    const history = thursdays.slice(0, 2).map((date) => ({ title: 'Weekly review', date }))
    expect(suggestFromHistory(history, TODAY)).toHaveLength(0)
  })

  it('stays quiet when the pattern is weak against the opportunities', async () => {
    // Three hits, but across ten Thursdays — 30% is not a pattern.
    const many = Array.from({ length: 10 }, (_, i) => `2026-0${i < 3 ? '8' : '7'}-13`)
    void many
    const history = [
      ...thursdays.slice(0, 3).map((date) => ({ title: 'Weekly review', date })),
      ...['2026-07-16', '2026-07-09', '2026-07-02', '2026-06-25', '2026-06-18', '2026-06-11', '2026-06-04']
        .map((date) => ({ title: 'Something else', date }))
    ]
    expect(suggestFromHistory(history, TODAY).map((s) => s.title)).not.toContain('Weekly review')
  })

  it('ignores other weekdays', async () => {
    const mondays = ['2026-08-17', '2026-08-10', '2026-08-03', '2026-07-27']
    const history = mondays.map((date) => ({ title: 'Plan the week', date }))
    expect(suggestFromHistory(history, TODAY)).toHaveLength(0)
  })

  it('does not suggest something already on the list', async () => {
    const history = thursdays.map((date) => ({ title: 'Weekly review', date }))
    expect(suggestFromHistory(history, TODAY, ['weekly review'])).toHaveLength(0)
  })

  it('matches titles regardless of case and spacing', async () => {
    const history = [
      { title: 'Weekly Review', date: '2026-08-13' },
      { title: 'weekly  review', date: '2026-08-06' },
      { title: 'WEEKLY REVIEW', date: '2026-07-30' }
    ]
    expect(suggestFromHistory(history, TODAY)).toHaveLength(1)
  })
})

describe('subtask roll-up verdict', () => {
  it('has no opinion when there are no subtasks', async () => {
    expect(subtasksSayComplete([])).toBeNull()
  })

  it('is complete only when every live step is done', async () => {
    expect(subtasksSayComplete([{ done: true, dropped: false }])).toBe(true)
    expect(subtasksSayComplete([{ done: true, dropped: false }, { done: false, dropped: false }])).toBe(false)
  })

  it('ignores dropped steps', async () => {
    expect(
      subtasksSayComplete([{ done: true, dropped: false }, { done: false, dropped: true }])
    ).toBe(true)
  })

  it('returns to no-opinion when every step is dropped', async () => {
    expect(subtasksSayComplete([{ done: false, dropped: true }])).toBeNull()
  })
})

// ------------------------------------------------------ subtasks ⇄ habit

describe('subtasks completing the habit', () => {
  async function seed() {
    const habit = await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW)
    const occ = (await h.occurrences.getByHabitDate(habit.id, TODAY))!
    return { habit, occ }
  }

  it('completes the habit when the last step is ticked', async () => {
    const { occ } = await seed()
    const a = await h.todosApi.addSubtask(occ.id, 'Read the paper', NOW)
    const b = await h.todosApi.addSubtask(occ.id, 'Write notes', NOW)

    await h.todosApi.setDone(a, true, NOW)
    expect((await h.occurrences.get(occ.id))!.completedAt).toBeNull()

    await h.todosApi.setDone(b, true, NOW)
    expect((await h.occurrences.get(occ.id))!.completedAt).not.toBeNull()
  })

  it('reopens the habit when a step is un-ticked', async () => {
    const { occ } = await seed()
    const a = await h.todosApi.addSubtask(occ.id, 'Step one', NOW)
    await h.todosApi.setDone(a, true, NOW)
    expect((await h.occurrences.get(occ.id))!.completedAt).not.toBeNull()

    await h.todosApi.setDone(a, false, NOW)
    expect((await h.occurrences.get(occ.id))!.completedAt).toBeNull()
  })

  it('takes the points back when a step is un-ticked', async () => {
    const { habit, occ } = await seed()
    const a = await h.todosApi.addSubtask(occ.id, 'Step one', NOW)

    await h.todosApi.setDone(a, true, NOW)
    await h.engine.refresh('2026-08-19', '2026-08-27', NOW)
    expect((await h.records.dailyForHabit(habit.id, TODAY, TODAY))[0]!.points).toBe(2)

    await h.todosApi.setDone(a, false, NOW)
    await h.engine.refresh('2026-08-19', '2026-08-27', NOW)
    expect((await h.records.dailyForHabit(habit.id, TODAY, TODAY))[0]!.points).toBe(0)
  })

  it('reopens a completed habit when a new step is added', async () => {
    const { occ } = await seed()
    const a = await h.todosApi.addSubtask(occ.id, 'Step one', NOW)
    await h.todosApi.setDone(a, true, NOW)
    expect((await h.occurrences.get(occ.id))!.completedAt).not.toBeNull()

    await h.todosApi.addSubtask(occ.id, 'Step two', NOW)
    expect((await h.occurrences.get(occ.id))!.completedAt).toBeNull()
  })

  it('lets a dropped step unblock the habit', async () => {
    const { occ } = await seed()
    const a = await h.todosApi.addSubtask(occ.id, 'Doable', NOW)
    const b = await h.todosApi.addSubtask(occ.id, 'Not happening', NOW)
    await h.todosApi.setDone(a, true, NOW)
    expect((await h.occurrences.get(occ.id))!.completedAt).toBeNull()

    await h.todosApi.drop(b, NOW)
    expect((await h.occurrences.get(occ.id))!.completedAt).not.toBeNull()
  })

  it('leaves a habit with no steps entirely alone', async () => {
    const { occ } = await seed()
    // Completed the ordinary way; no subtasks exist to have an opinion.
    await h.habitsApi.setCompleted(occ.id, true, NOW)
    await h.todosApi.reconcileOccurrence(occ.id, NOW)
    expect((await h.occurrences.get(occ.id))!.completedAt).not.toBeNull()
  })
})

describe('subtask templates', () => {
  it('applies a habit template to its occurrences', async () => {
    const habit = await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW)
    await h.todosApi.setTemplates(habit.id, ['Warm up', 'Main set', 'Cool down'])

    const { from, to } = await h.schedule.horizon(NOW)
    const applied = await h.todosApi.applyTemplatesInRange(from, to)
    expect(applied).toBeGreaterThan(0)

    const occ = (await h.occurrences.getByHabitDate(habit.id, TODAY))!
    expect((await h.todos.listSubtasks(occ.id)).map((s) => s.title)).toEqual([
      'Warm up',
      'Main set',
      'Cool down'
    ])
  })

  it('does not duplicate steps when applied repeatedly', async () => {
    const habit = await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW)
    await h.todosApi.setTemplates(habit.id, ['Warm up', 'Main set'])
    const { from, to } = await h.schedule.horizon(NOW)

    for (let i = 0; i < 4; i++) (await h.todosApi.applyTemplatesInRange(from, to))

    const occ = (await h.occurrences.getByHabitDate(habit.id, TODAY))!
    expect(await h.todos.listSubtasks(occ.id)).toHaveLength(2)
  })
})

// ------------------------------------------------------- manual + carry

describe('manual items', () => {
  it('rejects an empty title', async () => {
    await expect(h.todosApi.addManual('   ', TODAY, NOW)).rejects.toThrow(/title/)
  })

  it('carries an unfinished item forward to today', async () => {
    await h.todosApi.addManual('Fix the bug', '2026-08-17', NOW)
    const moved = await h.todosApi.carryForward(NOW)

    expect(moved).toBe(1)
    const view = await h.views.todoView(TODAY, NOW)
    const item = view.items.find((i) => i.title === 'Fix the bug')!
    expect(item.date).toBe(TODAY)
    expect(item.carried).toBe(3)
  })

  it('leaves finished and dropped items where they are', async () => {
    const done = await h.todosApi.addManual('Done thing', '2026-08-17', NOW)
    const dropped = await h.todosApi.addManual('Given up', '2026-08-17', NOW)
    await h.todosApi.setDone(done, true, NOW)
    await h.todosApi.drop(dropped, NOW)

    expect(await h.todosApi.carryForward(NOW)).toBe(0)
  })

  it('is idempotent when run repeatedly on the same day', async () => {
    await h.todosApi.addManual('Fix the bug', '2026-08-17', NOW)
    await h.todosApi.carryForward(NOW)
    expect(await h.todosApi.carryForward(NOW)).toBe(0)
    expect((await h.views.todoView(TODAY, NOW)).items.filter((i) => i.title === 'Fix the bug')).toHaveLength(1)
  })

  it('never carries a subtask forward', async () => {
    const habit = await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW)
    const yesterday = (await h.occurrences.getByHabitDate(habit.id, '2026-08-19'))!
    await h.todosApi.addSubtask(yesterday.id, 'Yesterday step', NOW)

    expect(await h.todosApi.carryForward(NOW)).toBe(0)
    // It stays on the day it belonged to.
    expect((await h.views.todoView('2026-08-19', NOW)).items.some((i) => i.title === 'Yesterday step')).toBe(true)
    expect((await h.views.todoView(TODAY, NOW)).items.some((i) => i.title === 'Yesterday step')).toBe(false)
  })
})

// --------------------------------------------------------------- view

describe('the to-do view', () => {
  it('counts manual and subtask progress separately', async () => {
    const habit = await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW)
    const occ = (await h.occurrences.getByHabitDate(habit.id, TODAY))!

    const m1 = await h.todosApi.addManual('Buy milk', TODAY, NOW)
    await h.todosApi.addManual('Email Ahmed', TODAY, NOW)
    const s1 = await h.todosApi.addSubtask(occ.id, 'Read', NOW)
    await h.todosApi.addSubtask(occ.id, 'Write', NOW)

    await h.todosApi.setDone(m1, true, NOW)
    await h.todosApi.setDone(s1, true, NOW)

    const view = await h.views.todoView(TODAY, NOW)
    expect(view.manualDone).toBe(1)
    expect(view.manualTotal).toBe(2)
    expect(view.subtaskDone).toBe(1)
    expect(view.subtaskTotal).toBe(2)
  })

  it('groups subtasks under their habit and manual items on their own', async () => {
    const habit = await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW)
    const occ = (await h.occurrences.getByHabitDate(habit.id, TODAY))!
    await h.todosApi.addSubtask(occ.id, 'Read', NOW)
    await h.todosApi.addManual('Buy milk', TODAY, NOW)

    const view = await h.views.todoView(TODAY, NOW)
    const habitGroup = view.groups.find((g) => g.habitId === habit.id)!
    const manualGroup = view.groups.find((g) => g.habitId === null)!

    expect(habitGroup.habitName).toBe('Study AI')
    expect(habitGroup.items).toHaveLength(1)
    expect(manualGroup.items).toHaveLength(1)
  })

  it('hides dropped items but still counts them as avoided', async () => {
    const dropped = await h.todosApi.addManual('Given up', '2026-08-10', NOW)
    await h.todosApi.carryForward(NOW)
    await h.todosApi.drop(dropped, NOW)

    const view = await h.views.todoView(TODAY, NOW)
    expect(view.items.some((i) => i.title === 'Given up')).toBe(false)
    expect(view.avoidance.some((a) => a.title === 'Given up')).toBe(false)
  })

  it('reports the count of carried items', async () => {
    await h.todosApi.addManual('Old one', '2026-08-16', NOW)
    await h.todosApi.addManual('New one', TODAY, NOW)
    await h.todosApi.carryForward(NOW)

    const view = await h.views.todoView(TODAY, NOW)
    expect(view.carriedCount).toBe(1)
    expect(view.avoidance).toHaveLength(1)
  })
})
