import { beforeEach, describe, expect, it } from 'vitest'
import type { GoalDraftInput, HabitDraft } from '@shared/types'
import { freshDb } from './pg'
import { habitRepo } from '@server/persistence/habitRepo'
import { occurrenceRepo } from '@server/persistence/occurrenceRepo'
import { logRepo } from '@server/persistence/logRepo'
import { recordRepo } from '@server/persistence/recordRepo'
import { settingsRepo } from '@server/persistence/settingsRepo'
import { todoRepo } from '@server/persistence/todoRepo'
import { goalRepo } from '@server/persistence/goalRepo'
import { scheduleService } from '@server/application/scheduleService'
import { recomputeService } from '@server/application/recomputeService'
import { habitService } from '@server/application/habitService'
import { todoService } from '@server/application/todoService'
import { goalService } from '@server/application/goalService'
import { viewService } from '@server/application/viewService'
import { normalisePlan } from '@server/ai/goalPlanSchema'
import { FakeGoalPlanner, samplePlan } from './fakeAi'

const NOW = new Date('2026-08-23T10:00:00.000Z') // Sunday 23 Aug 2026, Cairo

async function harness() {
  const db = await freshDb()

  const habits = habitRepo(db)
  const occurrences = occurrenceRepo(db)
  const logs = logRepo(db)
  const records = recordRepo(db)
  const settings = settingsRepo(db)
  const todos = todoRepo(db)
  const goals = goalRepo(db)
  await settings.save({ timezone: 'Africa/Cairo', provisionHorizonDays: 7 })

  const schedule = scheduleService({ db, habits, occurrences, settings })
  const engine = recomputeService({ db, habits, occurrences, logs, records, settings })
  const habitsApi = habitService({ db, habits, occurrences, logs, records, settings, schedule, engine })
  const todosApi = todoService({ db, todos, occurrences, settings, habits: habitsApi })
  const views = viewService({
    habits, occurrences, logs, records, settings, todos, engine,
    runningOccurrenceId: async () => null
  })
  const planner = new FakeGoalPlanner()
  const goalsApi = goalService({
    db, goals, habitRepo: habits, todoRepo: todos, settings,
    habits: habitsApi, todos: todosApi, engine,
    planner: async () => planner
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

let h: Awaited<ReturnType<typeof harness>>

beforeEach(async () => {
  h = await harness()
})

describe('planning context', () => {
  it('turns active habits into occupied blocks and totals the committed minutes', async () => {
    await h.habitsApi.create(draft(), NOW)
    await h.habitsApi.create(draft({ name: 'Paused', active: false }), NOW)
    const ctx = await h.goalsApi.planningContext(NOW)
    expect(ctx.today).toBe('2026-08-23')
    expect(ctx.occupied).toEqual([{ name: 'Workout', days: [1, 3, 5], start: 570, end: 660 }])
    expect(ctx.committedMinutesPerWeek).toBe(270)
  })

  it('treats an every-N-days habit as occupying every weekday', async () => {
    await h.habitsApi.create(draft({ recurrence: { kind: 'everyN', n: 3, anchor: '2026-08-20' } }), NOW)
    expect((await h.goalsApi.planningContext(NOW)).occupied[0]!.days).toEqual([1, 2, 3, 4, 5, 6, 7])
  })
})

describe('draftPlan', () => {
  it('hands the planner the input and the live context and returns its result unpersisted', async () => {
    await h.habitsApi.create(draft(), NOW)
    const result = await h.goalsApi.draftPlan(input, undefined, NOW)
    expect(result.plan.sessions).toHaveLength(2)
    expect(h.planner.lastInput).toEqual(input)
    expect(h.planner.lastContext!.occupied[0]!.name).toBe('Workout')
    expect(await h.goals.list()).toHaveLength(0)
    expect(await h.habits.list()).toHaveLength(1)
  })

  it('validates before spending a model call', async () => {
    await expect(h.goalsApi.draftPlan({ ...input, title: '  ' }, undefined, NOW)).rejects.toThrow(/needs a title/)
    await expect(h.goalsApi.draftPlan({ ...input, targetDate: '2026-08-01' }, undefined, NOW)).rejects.toThrow(/in the future/)
    expect(h.planner.lastInput).toBeNull()
  })
})

describe('commit', () => {
  it('creates one real habit per session and one to-do per milestone, all linked to the goal', async () => {
    const view = await h.goalsApi.commit(input, normalisePlan(samplePlan()), NOW)

    expect(view.status).toBe('active')
    expect(view.habits.map((x) => x.name)).toEqual(['Spanish vocabulary', 'Spanish listening'])
    expect(view.milestonesTotal).toBe(2)
    expect(view.milestonesDone).toBe(0)
    expect(view.daysToTarget).toBe(70)

    const spawned = await h.habits.listByGoal(view.id)
    expect(spawned).toHaveLength(2)
    expect(spawned[0]).toMatchObject({
      recurrence: { kind: 'weekly', days: [1, 3, 5] },
      scheduledTime: '07:30',
      targetMinutes: 30,
      goalId: view.id,
      active: true
    })

    const milestones = await h.todos.listByGoal(view.id)
    expect(milestones.map((m) => [m.title, m.date])).toEqual([
      ['Finish unit 1', '2026-09-05'],
      ['Hold a 5-minute conversation', '2026-10-10']
    ])
    expect(milestones[1]!.notes).toBe('With a tutor')
  })

  it('schedules the new habits through the ordinary scheduler, so they appear in views', async () => {
    await h.goalsApi.commit(input, normalisePlan(samplePlan()), NOW)
    // Monday 24 Aug is inside the 7-day horizon and a vocabulary day.
    const blocks = await h.views.calendarRange('2026-08-24', '2026-08-24')
    expect(blocks.map((b) => b.name)).toContain('Spanish vocabulary')
  })

  it('stores the mind map and resources on the goal', async () => {
    const view = await h.goalsApi.commit(input, normalisePlan(samplePlan()), NOW)
    expect(view.mindMap).toHaveLength(3)
    expect(view.resources[0]!.url).toBe('https://www.languagetransfer.org/')
  })

  it('refuses a plan with no sessions', async () => {
    await expect(h.goalsApi.commit(input, { ...normalisePlan(samplePlan()), sessions: [] }, NOW)).rejects.toThrow(/at least one session/)
    expect(await h.goals.list()).toHaveLength(0)
  })

  it('rolls back everything if a session is invalid', async () => {
    const plan = normalisePlan(samplePlan())
    plan.sessions[1] = { ...plan.sessions[1]!, targetMinutes: 0 }
    await expect(h.goalsApi.commit(input, plan, NOW)).rejects.toThrow()
    expect(await h.goals.list()).toHaveLength(0)
    expect(await h.habits.list()).toHaveLength(0)
    expect(await h.todos.listForDate('2026-09-05')).toHaveLength(0)
  })
})

describe('closing a goal', () => {
  it('pauses the habits it created so no further occurrences are generated, keeping history', async () => {
    const view = await h.goalsApi.commit(input, normalisePlan(samplePlan()), NOW)
    const habitId = view.habits[0]!.id
    const before = (await h.occurrences.listInRange('2026-08-23', '2026-08-30')).filter((o) => o.habitId === habitId)
    expect(before.length).toBeGreaterThan(0)

    await h.goalsApi.close(view.id, 'achieved', NOW)

    const after = (await h.goalsApi.get(view.id, NOW))!
    expect(after.status).toBe('achieved')
    expect(after.closedAt).not.toBeNull()
    expect((await h.habits.get(habitId))!.active).toBe(false)
    // Existing occurrences are left alone; only future expansion stops.
    expect((await h.occurrences.listInRange('2026-08-23', '2026-08-30')).filter((o) => o.habitId === habitId)).toHaveLength(before.length)
    expect((await h.schedule.expandHorizon(new Date('2026-09-01T10:00:00.000Z'))).created).toBe(0)
  })

  it('does not touch habits that belong to other goals or to no goal', async () => {
    const own = await h.habitsApi.create(draft(), NOW)
    const view = await h.goalsApi.commit(input, normalisePlan(samplePlan()), NOW)
    await h.goalsApi.close(view.id, 'abandoned', NOW)
    expect((await h.habits.get(own.id))!.active).toBe(true)
  })

  it('can be reopened, resuming its habits', async () => {
    const view = await h.goalsApi.commit(input, normalisePlan(samplePlan()), NOW)
    await h.goalsApi.close(view.id, 'abandoned', NOW)
    await h.goalsApi.reopen(view.id, NOW)
    expect((await h.goalsApi.get(view.id, NOW))!.status).toBe('active')
    expect((await h.habits.listByGoal(view.id)).every((x) => x.active)).toBe(true)
  })
})

describe('milestone progress', () => {
  it('counts finished milestones and leaves dropped ones out of the total', async () => {
    const view = await h.goalsApi.commit(input, normalisePlan(samplePlan()), NOW)
    const [first, second] = await h.todos.listByGoal(view.id)
    await h.todosApi.setDone(first!.id, true, NOW)
    await h.todosApi.drop(second!.id, NOW)
    const after = (await h.goalsApi.get(view.id, NOW))!
    expect(after.milestonesDone).toBe(1)
    expect(after.milestonesTotal).toBe(1)
  })
})

describe('removing a goal', () => {
  it('unlinks its habits and to-dos instead of deleting them', async () => {
    const view = await h.goalsApi.commit(input, normalisePlan(samplePlan()), NOW)
    const habitId = view.habits[0]!.id
    await h.goalsApi.remove(view.id)
    expect(await h.goals.get(view.id)).toBeNull()
    expect(await h.habits.get(habitId)).not.toBeNull()
    expect((await h.habits.get(habitId))!.goalId).toBeNull()
    expect(await h.todos.listForDate('2026-09-05')).toHaveLength(1)
  })
})

describe('obstacles and the saved draft', () => {
  it('keeps obstacles tied to the mountain’s own waypoints', async () => {
    const h = await harness()
    const g = await h.goalsApi.commit(input, normalisePlan(samplePlan()), NOW)
    const first = (await h.goalsApi.get(g.id, NOW))!.milestones[0]!
    await h.goalsApi.updatePlan(g.id, { obstacles: [{ id: 'o1', title: '  Fear of starting ', note: '', nearMilestoneId: first.id, passed: false }] })
    expect((await h.goalsApi.get(g.id, NOW))!.obstacles).toEqual([{ id: 'o1', title: 'Fear of starting', note: null, nearMilestoneId: first.id, passed: false }])
    await expect(h.goalsApi.updatePlan(g.id, { obstacles: [{ id: 'o2', title: 'x', note: null, nearMilestoneId: 99999, passed: false }] })).rejects.toThrow(/no longer on this mountain/)
    await expect(h.goalsApi.updatePlan(g.id, { obstacles: [{ id: 'o3', title: '  ', note: null, nearMilestoneId: null, passed: false }] })).rejects.toThrow(/Name what stands/)
  })

  it('saves one wizard draft and clears it', async () => {
    const h = await harness()
    expect(await h.goalsApi.draft()).toBeNull()
    await h.goalsApi.saveDraft({ title: 'Learn Spanish', story: '', targetDate: null, weeklyMinutes: 240, anchors: [], plan: null, warnings: [], iterations: 0, savedAt: '' })
    expect(await h.goalsApi.draft()).toMatchObject({ title: 'Learn Spanish', weeklyMinutes: 240 })
    expect((await h.goalsApi.draft())!.savedAt).not.toBe('')
    await h.goalsApi.saveDraft(null)
    expect(await h.goalsApi.draft()).toBeNull()
  })
})
