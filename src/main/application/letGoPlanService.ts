import type { HabitDraft, LetGoDraftResult, LetGoPlan, LetGoPlanInput, LetGoView } from '@shared/types'
import type { LetGoPlanner } from '../ai/letGoPlanner'
import type { PlanningContext, ProgressCallback } from '../ai/types'
import { todayIn } from '../domain/time'
import { tx, type Db } from '../persistence/db'
import type { SettingsRepo } from '../persistence/settingsRepo'
import type { HabitService } from './habitService'
import type { ReflectService } from './reflectService'

/**
 * Planning, with the user, how to let a bad habit go.
 *
 * `draft` asks the planner and hands the plan back unsaved, so the user can change it.
 * `save` then writes it through the ordinary services: the Let Go item they will check in
 * on, each replacement habit as a normal habit (scheduled, scored and synced like any
 * other), and each support in the backpack. Nothing here is new storage.
 */
export function letGoPlanService(deps: {
  db: Db
  settings: SettingsRepo
  habits: HabitService
  reflect: ReflectService
  planningContext: (now?: Date) => PlanningContext
  /** Resolved lazily so a missing API key is an error when planning, not at boot. */
  planner: () => LetGoPlanner
}) {
  const { db, settings, habits, reflect } = deps

  function validate(input: LetGoPlanInput): void {
    if (!input.title.trim()) throw new Error('Name the habit you want to let go of')
    if (input.weeklyMinutesBudget !== null && input.weeklyMinutesBudget < 15) {
      throw new Error('Give the new habits at least 15 minutes a week')
    }
  }

  const habitDraft = (s: LetGoPlan['sessions'][number]): HabitDraft => ({
    name: s.name,
    description: s.rationale,
    notes: null,
    recurrence: { kind: 'weekly', days: s.days },
    scheduledTime: s.scheduledTime,
    targetMinutes: s.targetMinutes,
    baselineMinutes: s.targetMinutes,
    difficultyLevel: 1,
    reminderLeadMinutes: null,
    colorKey: 'teal',
    googleTasklistId: null,
    goalId: null,
    active: true
  })

  return {
    draft(input: LetGoPlanInput, onProgress?: ProgressCallback, now: Date = new Date()): Promise<LetGoDraftResult> {
      validate(input)
      return deps.planner().plan(input, deps.planningContext(now), onProgress)
    },

    save(input: LetGoPlanInput, plan: LetGoPlan, now: Date = new Date()): LetGoView {
      validate(input)
      if (!plan.replacement.trim()) throw new Error('Say what you will do instead')
      if (plan.triggerContexts.length === 0) throw new Error('Pick at least one time it tends to happen')
      return tx(db, () => {
        const item = reflect.letGoCreate({
          title: input.title.trim(),
          triggerContexts: plan.triggerContexts,
          triggerNotes: plan.triggerNotes,
          replacement: plan.replacement.trim(),
          goalId: null,
          weight: plan.weight,
          startedOn: todayIn(settings.timezone(), now)
        })
        for (const s of plan.sessions) habits.create(habitDraft(s), now)
        for (const s of plan.supports) reflect.toolSave(null, { title: s.title, description: s.description, goalId: null, habitId: null })
        return reflect.letGoGet(item.id, now)!
      })
    }
  }
}

export type LetGoPlanService = ReturnType<typeof letGoPlanService>
