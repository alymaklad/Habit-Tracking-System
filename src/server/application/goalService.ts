import type {
  GoalDraftInput,
  GoalDraftResult,
  GoalObstacle,
  GoalPlan,
  GoalResource,
  GoalView,
  Habit,
  HabitDraft,
  MindMapNode,
  SavedGoalDraft
} from '@shared/types'
import type { GoalPlanner, OccupiedBlock, PlanningContext, ProgressCallback } from '../ai/types'
import { toMinutes } from '../ai/scheduleConflicts'
import { diffDays, todayIn } from '../domain/time'
import type { Db } from '../persistence/db'
import type { GoalRepo } from '../persistence/goalRepo'
import type { HabitRepo } from '../persistence/habitRepo'
import type { SettingsRepo } from '../persistence/settingsRepo'
import type { TodoRepo } from '../persistence/todoRepo'
import type { HabitService } from './habitService'
import type { RecomputeService } from './recomputeService'
import type { TodoService } from './todoService'

const GOAL_COLOURS = ['teal', 'amber', 'rose', 'sky', 'lime', 'violet']

/**
 * A goal is a front door onto habits and to-dos, not a schedule of its own.
 *
 * `draftPlan` asks the planner for a plan and hands it back unpersisted, so the wizard can
 * let the user edit it. `commit` then writes ordinary rows through the ordinary services:
 * each session becomes a habit via `habits.create` (scheduling, scoring, Google sync all
 * apply as usual) and each milestone a manual to-do. Nothing here knows how to score.
 */
export function goalService(deps: {
  db: Db
  goals: GoalRepo
  habitRepo: HabitRepo
  todoRepo: TodoRepo
  settings: SettingsRepo
  habits: HabitService
  todos: TodoService
  engine: RecomputeService
  /** Resolved lazily so a missing API key is an error at draft time, not at boot. */
  planner: () => Promise<GoalPlanner>
}) {
  const { db, goals, habitRepo, todoRepo, settings, habits, todos, engine } = deps

  const today = async (now: Date = new Date()): Promise<string> => todayIn(await settings.timezone(), now)

  /** What the planner needs to know before it starts — computed here, no model involved. */
  async function planningContext(now: Date = new Date()): Promise<PlanningContext> {
    const active = await habitRepo.listActive()
    const occupied: OccupiedBlock[] = active.map((h) => {
      const start = toMinutes(h.scheduledTime)
      return {
        name: h.name,
        // An every-N-days habit lands on unpredictable weekdays; treat it as occupying all of them.
        days: h.recurrence.kind === 'weekly' ? h.recurrence.days : [1, 2, 3, 4, 5, 6, 7],
        start,
        end: start + h.targetMinutes
      }
    })
    const committedMinutesPerWeek = occupied.reduce(
      (sum, b) => sum + b.days.length * (b.end - b.start),
      0
    )
    return { today: await today(now), timezone: await settings.timezone(), occupied, committedMinutesPerWeek }
  }

  async function validate(input: GoalDraftInput, now: Date): Promise<void> {
    if (!input.title.trim()) throw new Error('A goal needs a title')
    if (input.targetDate && input.targetDate <= (await today(now))) {
      throw new Error('The target date has to be in the future')
    }
    if (input.weeklyMinutesBudget !== null && input.weeklyMinutesBudget < 15) {
      throw new Error('Give the goal at least 15 minutes a week')
    }
  }

  function sessionToDraft(goalId: number, s: GoalPlan['sessions'][number], index: number): HabitDraft {
    return {
      name: s.name,
      description: s.rationale,
      notes: null,
      recurrence: { kind: 'weekly', days: s.days },
      scheduledTime: s.scheduledTime,
      targetMinutes: s.targetMinutes,
      baselineMinutes: s.targetMinutes,
      difficultyLevel: 1,
      reminderLeadMinutes: null,
      colorKey: GOAL_COLOURS[index % GOAL_COLOURS.length]!,
      googleTasklistId: null,
      goalId,
      active: true
    }
  }

  async function toView(goalId: number, now: Date): Promise<GoalView | null> {
    const goal = await goals.get(goalId)
    if (!goal) return null
    const spawned = await habitRepo.listByGoal(goalId)
    const milestones = await todoRepo.listByGoal(goalId)
    const done = milestones.filter((m) => m.done).length
    return {
      ...goal,
      habits: await Promise.all(
        spawned.map(async (h: Habit) => ({
          id: h.id,
          name: h.name,
          active: h.active,
          streak: (await engine.streakFor(h.id)).current
        }))
      ),
      milestones: milestones.map((m) => ({
        id: m.id,
        title: m.title,
        date: m.date,
        done: m.done,
        dropped: m.dropped
      })),
      milestonesDone: done,
      milestonesTotal: milestones.filter((m) => !m.dropped).length,
      daysToTarget: goal.targetDate ? diffDays(await today(now), goal.targetDate) : null
    }
  }

  return {
    planningContext,

    async draftPlan(
      input: GoalDraftInput,
      onProgress?: ProgressCallback,
      now: Date = new Date()
    ): Promise<GoalDraftResult> {
      await validate(input, now)
      return (await deps.planner()).plan(input, await planningContext(now), onProgress)
    },

    /** Persist an approved plan: one goal row, one habit per session, one to-do per milestone. */
    async commit(input: GoalDraftInput, plan: GoalPlan, now: Date = new Date()): Promise<GoalView> {
      await validate(input, now)
      if (plan.sessions.length === 0) throw new Error('The plan needs at least one session')

      return db.transaction(async () => {
        const goal = await goals.create({
          title: input.title,
          description: input.description,
          targetDate: input.targetDate,
          weeklyMinutesBudget: input.weeklyMinutesBudget,
          mindMap: plan.mindMap,
          resources: plan.resources
        })
        for (const [i, s] of plan.sessions.entries()) await habits.create(sessionToDraft(goal.id, s, i), now)
        for (const m of plan.milestones) {
          await todos.addManual(m.title, m.dueDate, now, { notes: m.description, goalId: goal.id })
        }
        return (await toView(goal.id, now))!
      })
    },

    async list(now: Date = new Date()): Promise<GoalView[]> {
      const views = await Promise.all((await goals.list()).map((g) => toView(g.id, now)))
      return views.filter((g): g is GoalView => g !== null)
    },

    get(id: number, now: Date = new Date()): Promise<GoalView | null> {
      return toView(id, now)
    },

    /**
     * Closing a goal pauses the habits it created — `setActive(false)` is all it takes for
     * the scheduler to stop generating occurrences. History and XP already earned stay.
     */
    async close(id: number, outcome: 'achieved' | 'abandoned', now: Date = new Date()): Promise<void> {
      const goal = await goals.get(id)
      if (!goal) return
      await db.transaction(async () => {
        await goals.setStatus(id, outcome, now.toISOString())
        for (const h of await habitRepo.listByGoal(id)) {
          if (h.active) await habits.setActive(h.id, false, now)
        }
      })
    },

    async reopen(id: number, now: Date = new Date()): Promise<void> {
      const goal = await goals.get(id)
      if (!goal) return
      await db.transaction(async () => {
        await goals.setStatus(id, 'active', null)
        for (const h of await habitRepo.listByGoal(id)) {
          if (!h.active) await habits.setActive(h.id, true, now)
        }
      })
    },

    async updatePlan(id: number, patch: { mindMap?: MindMapNode[]; resources?: GoalResource[]; obstacles?: GoalObstacle[] }): Promise<void> {
      if (patch.obstacles !== undefined) {
        const milestoneIds = new Set((await todoRepo.listByGoal(id)).map((m) => m.id))
        patch = {
          ...patch,
          obstacles: patch.obstacles.map((o) => {
            const title = o.title?.trim()
            if (!title) throw new Error('Name what stands in the way')
            if (o.nearMilestoneId !== null && !milestoneIds.has(o.nearMilestoneId)) throw new Error('That milestone is no longer on this mountain')
            return { id: String(o.id), title, note: o.note?.trim() || null, nearMilestoneId: o.nearMilestoneId, passed: !!o.passed }
          })
        }
      }
      await goals.setPlanJson(id, patch)
    },

    /** The wizard's one saved draft; null clears it. */
    async draft(): Promise<SavedGoalDraft | null> {
      return settings.getFlag<SavedGoalDraft | null>('goalDraft', null)
    },

    async saveDraft(draft: SavedGoalDraft | null): Promise<void> {
      if (draft !== null && !draft.title?.trim() && !draft.plan) throw new Error('Name the mountain before saving a draft')
      await settings.setFlag('goalDraft', draft === null ? null : { ...draft, savedAt: new Date().toISOString() })
    },

    /** Removes the goal only; its habits and to-dos keep their history, unlinked. */
    async remove(id: number): Promise<void> {
      await goals.remove(id)
    }
  }
}

export type GoalService = ReturnType<typeof goalService>
