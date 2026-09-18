import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import type { GoalDraftInput, HabitDraft } from '@shared/types'
import { migrate, type Db } from '@main/persistence/db'
import { habitRepo } from '@main/persistence/habitRepo'
import { occurrenceRepo } from '@main/persistence/occurrenceRepo'
import { logRepo } from '@main/persistence/logRepo'
import { recordRepo } from '@main/persistence/recordRepo'
import { settingsRepo } from '@main/persistence/settingsRepo'
import { todoRepo } from '@main/persistence/todoRepo'
import { goalRepo } from '@main/persistence/goalRepo'
import { scheduleService } from '@main/application/scheduleService'
import { recomputeService } from '@main/application/recomputeService'
import { habitService } from '@main/application/habitService'
import { todoService } from '@main/application/todoService'
import { goalService } from '@main/application/goalService'
import { viewService } from '@main/application/viewService'
import { normalisePlan } from '@main/ai/goalPlanSchema'
import { FakeGoalPlanner, samplePlan } from './fakeAi'

const NOW = new Date('2026-08-23T10:00:00.000Z') // Sunday 23 Aug 2026, Cairo

function harness() {
  const db = new Database(':memory:') as Db
  db.pragma('foreign_keys = ON')
  migrate(db)

  const habits = habitRepo(db)
  const occurrences = occurrenceRepo(db)
  const logs = logRepo(db)
  const records = recordRepo(db)
  const settings = settingsRepo(db)
  const todos = todoRepo(db)
  const goals = goalRepo(db)
  settings.save({ timezone: 'Africa/Cairo', provisionHorizonDays: 7 })

  const schedule = scheduleService({ db, habits, occurrences, settings })
  const engine = recomputeService({ db, habits, occurrences, logs, records, settings })
  const habitsApi = habitService({ db, habits, occurrences, logs, records, settings, schedule, engine })
  const todosApi = todoService({ db, todos, occurrences, settings, habits: habitsApi })
  const views = viewService({
    habits, occurrences, logs, records, settings, todos, engine,
    runningOccurrenceId: () => null
  })
  const planner = new FakeGoalPlanner()
  const goalsApi = goalService({
    db, goals, habitRepo: habits, todoRepo: todos, settings,
    habits: habitsApi, todos: todosApi, engine,
    planner: () => planner
  })

  return { db, habits, occurrences, todos, goals, schedule, engine, habitsApi, todosApi, goalsApi, views, planner }
}

const draft = (o: Partial<HabitDraft> = {}): HabitDraft => ({
  name: 'Workout',
  description: null,
  notes: null,
  recurrence: { kind: 'weekly', days: [1, 3, 5] },
  scheduledTime: '09:30',
  targetMinutes: 90,
  baselineMinutes: 90,
  difficultyLevel: 2,
  reminderLeadMinutes: 30,
  colorKey: 'violet',
  googleTasklistId: null,
  goalId: null,
  active: true,
  ...o
})

const input: GoalDraftInput = {
  title: 'Learn Spanish',
  description: 'Complete beginner.',
  targetDate: '2026-11-01',
  weeklyMinutesBudget: 240
}

let h: ReturnType<typeof harness>

beforeEach(() => {
  h = harness()
})

describe('planning context', () => {
  it('turns active habits into occupied blocks and totals the committed minutes', () => {
    h.habitsApi.create(draft(), NOW)
    h.habitsApi.create(draft({ name: 'Paused', active: false }), NOW)
    const ctx = h.goalsApi.planningContext(NOW)
    expect(ctx.today).toBe('2026-08-23')
    expect(ctx.occupied).toEqual([{ name: 'Workout', days: [1, 3, 5], start: 570, end: 660 }])
    expect(ctx.committedMinutesPerWeek).toBe(270)
  })

  it('treats an every-N-days habit as occupying every weekday', () => {
    h.habitsApi.create(draft({ recurrence: { kind: 'everyN', n: 3, anchor: '2026-08-20' } }), NOW)
    expect(h.goalsApi.planningContext(NOW).occupied[0]!.days).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
})

describe('draftPlan', () => {
  it('hands the planner the input and the live context and returns its result unpersisted', async () => {
    h.habitsApi.create(draft(), NOW)
    const result = await h.goalsApi.draftPlan(input, undefined, NOW)
    expect(result.plan.sessions).toHaveLength(2)
    expect(h.planner.lastInput).toEqual(input)
    expect(h.planner.lastContext!.occupied[0]!.name).toBe('Workout')
    expect(h.goals.list()).toHaveLength(0)
    expect(h.habits.list()).toHaveLength(1)
  })

  it('validates before spending a model call', async () => {
    await expect(h.goalsApi.draftPlan({ ...input, title: '  ' }, undefined, NOW)).rejects.toThrow(/needs a title/)
    await expect(h.goalsApi.draftPlan({ ...input, targetDate: '2026-08-01' }, undefined, NOW)).rejects.toThrow(/in the future/)
    expect(h.planner.lastInput).toBeNull()
  })
})

describe('commit', () => {
  it('creates one real habit per session and one to-do per milestone, all linked to the goal', () => {
    const view = h.goalsApi.commit(input, normalisePlan(samplePlan()), NOW)

    expect(view.status).toBe('active')
    expect(view.habits.map((x) => x.name)).toEqual(['Spanish vocabulary', 'Spanish listening'])
    expect(view.milestonesTotal).toBe(2)
    expect(view.milestonesDone).toBe(0)
    expect(view.daysToTarget).toBe(70)

    const spawned = h.habits.listByGoal(view.id)
    expect(spawned).toHaveLength(2)
    expect(spawned[0]).toMatchObject({
      recurrence: { kind: 'weekly', days: [1, 3, 5] },
      scheduledTime: '07:30',
      targetMinutes: 30,
      goalId: view.id,
      active: true
    })

    const milestones = h.todos.listByGoal(view.id)
    expect(milestones.map((m) => [m.title, m.date])).toEqual([
      ['Finish unit 1', '2026-09-05'],
      ['Hold a 5-minute conversation', '2026-10-10']
    ])
    expect(milestones[1]!.notes).toBe('With a tutor')
  })

  it('schedules the new habits through the ordinary scheduler, so they appear in views', () => {
    h.goalsApi.commit(input, normalisePlan(samplePlan()), NOW)
    // Monday 24 Aug is inside the 7-day horizon and a vocabulary day.
    const blocks = h.views.calendarRange('2026-08-24', '2026-08-24')
    expect(blocks.map((b) => b.name)).toContain('Spanish vocabulary')
  })

  it('stores the mind map and resources on the goal', () => {
    const view = h.goalsApi.commit(input, normalisePlan(samplePlan()), NOW)
    expect(view.mindMap).toHaveLength(3)
    expect(view.resources[0]!.url).toBe('https://www.languagetransfer.org/')
  })

  it('refuses a plan with no sessions', () => {
    expect(() =>
      h.goalsApi.commit(input, { ...normalisePlan(samplePlan()), sessions: [] }, NOW)
    ).toThrow(/at least one session/)
    expect(h.goals.list()).toHaveLength(0)
  })

  it('rolls back everything if a session is invalid', () => {
    const plan = normalisePlan(samplePlan())
    plan.sessions[1] = { ...plan.sessions[1]!, targetMinutes: 0 }
    expect(() => h.goalsApi.commit(input, plan, NOW)).toThrow()
    expect(h.goals.list()).toHaveLength(0)
    expect(h.habits.list()).toHaveLength(0)
    expect(h.todos.listForDate('2026-09-05')).toHaveLength(0)
  })
})

describe('closing a goal', () => {
  it('pauses the habits it created so no further occurrences are generated, keeping history', () => {
    const view = h.goalsApi.commit(input, normalisePlan(samplePlan()), NOW)
    const habitId = view.habits[0]!.id
    const before = h.occurrences.listInRange('2026-08-23', '2026-08-30').filter((o) => o.habitId === habitId)
    expect(before.length).toBeGreaterThan(0)

    h.goalsApi.close(view.id, 'achieved', NOW)

    const after = h.goalsApi.get(view.id, NOW)!
    expect(after.status).toBe('achieved')
    expect(after.closedAt).not.toBeNull()
    expect(h.habits.get(habitId)!.active).toBe(false)
    // Existing occurrences are left alone; only future expansion stops.
    expect(h.occurrences.listInRange('2026-08-23', '2026-08-30').filter((o) => o.habitId === habitId)).toHaveLength(before.length)
    expect(h.schedule.expandHorizon(new Date('2026-09-01T10:00:00.000Z')).created).toBe(0)
  })

  it('does not touch habits that belong to other goals or to no goal', () => {
    const own = h.habitsApi.create(draft(), NOW)
    const view = h.goalsApi.commit(input, normalisePlan(samplePlan()), NOW)
    h.goalsApi.close(view.id, 'abandoned', NOW)
    expect(h.habits.get(own.id)!.active).toBe(true)
  })

  it('can be reopened, resuming its habits', () => {
    const view = h.goalsApi.commit(input, normalisePlan(samplePlan()), NOW)
    h.goalsApi.close(view.id, 'abandoned', NOW)
    h.goalsApi.reopen(view.id, NOW)
    expect(h.goalsApi.get(view.id, NOW)!.status).toBe('active')
    expect(h.habits.listByGoal(view.id).every((x) => x.active)).toBe(true)
  })
})

describe('milestone progress', () => {
  it('counts finished milestones and leaves dropped ones out of the total', () => {
    const view = h.goalsApi.commit(input, normalisePlan(samplePlan()), NOW)
    const [first, second] = h.todos.listByGoal(view.id)
    h.todosApi.setDone(first!.id, true, NOW)
    h.todosApi.drop(second!.id, NOW)
    const after = h.goalsApi.get(view.id, NOW)!
    expect(after.milestonesDone).toBe(1)
    expect(after.milestonesTotal).toBe(1)
  })
})

describe('removing a goal', () => {
  it('unlinks its habits and to-dos instead of deleting them', () => {
    const view = h.goalsApi.commit(input, normalisePlan(samplePlan()), NOW)
    const habitId = view.habits[0]!.id
    h.goalsApi.remove(view.id)
    expect(h.goals.get(view.id)).toBeNull()
    expect(h.habits.get(habitId)).not.toBeNull()
    expect(h.habits.get(habitId)!.goalId).toBeNull()
    expect(h.todos.listForDate('2026-09-05')).toHaveLength(1)
  })
})
