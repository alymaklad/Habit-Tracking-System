import type { GoalDraftInput, GoalPlan, GoalPlanProgress, LocalDate } from '@shared/types'

/** A recurring block of time already committed, derived from an active habit. */
export interface OccupiedBlock {
  name: string
  /** ISO weekdays, Monday = 1 … Sunday = 7. */
  days: number[]
  /** Minutes since midnight. `end` may exceed 1440 for a block that crosses midnight. */
  start: number
  end: number
}

/** Everything the planner knows before it starts — gathered in-process, no model involved. */
export interface PlanningContext {
  today: LocalDate
  timezone: string
  occupied: OccupiedBlock[]
  /** Minutes per week already committed to habits, for the budget sanity check. */
  committedMinutesPerWeek: number
}

export type ProgressCallback = (progress: GoalPlanProgress) => void

/**
 * The port. `goalService` depends on this and nothing else in `ai/`, which is what lets
 * tests substitute a canned planner exactly as `FakeGoogle` stands in for Google.
 */
export interface GoalPlanner {
  plan(
    input: GoalDraftInput,
    context: PlanningContext,
    onProgress?: ProgressCallback
  ): Promise<{ plan: GoalPlan; iterations: number; warnings: string[] }>
}
