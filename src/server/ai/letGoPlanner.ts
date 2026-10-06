import type { GoalPlan, GoalPlanPhase, GoalPlanProgress, LetGoDraftResult, LetGoPlan, LetGoPlanInput } from '@shared/types'
import type { AiClient } from './anthropicClient'
import { inPhase, isRateLimit, STOPPED_EARLY, DEFAULT_MAX_ITERATIONS } from './goalPlanner'
import { normaliseLetGoPlan, PlanShapeError } from './goalPlanSchema'
import { deterministicIssues } from './intervenor'
import { letGoCritiquePrompt, letGoPrompt } from './letGoPrompts'
import { fitToBudget } from './planRepair'
import type { PlanningContext, ProgressCallback } from './types'

export interface LetGoPlanner {
  plan(input: LetGoPlanInput, ctx: PlanningContext, onProgress?: ProgressCallback): Promise<LetGoDraftResult>
}

/**
 * The same draft → check → revise loop as the goal planner, for letting a habit go.
 *
 * No research step and no links: the plan is about the person's own days. The code
 * checks (schedule clashes, the weekly budget) run on the replacement habits exactly as
 * they do for a goal's sessions, and the budget is fitted in code before any review.
 */
export function letGoPlanner(deps: { ai: AiClient; maxIterations?: number }): LetGoPlanner {
  const { ai } = deps
  const maxIterations = deps.maxIterations ?? DEFAULT_MAX_ITERATIONS

  return {
    async plan(input, ctx, onProgress) {
      let current: GoalPlanProgress = { phase: 'drafting', iteration: 1, maxIterations }
      const report = (phase: GoalPlanPhase, iteration: number): void => {
        current = { phase, iteration, maxIterations }
        onProgress?.(current)
      }
      ai.setWaitListener?.((ms) => onProgress?.({ ...current, waitingUntil: Date.now() + ms }))

      // The code checks speak about goal plans; a let-go plan's habits are its sessions.
      const asGoal = (plan: LetGoPlan): GoalPlan => ({ summary: plan.summary, sessions: plan.sessions, milestones: [], mindMap: [], resources: [] })
      const goalInput = { title: input.title, description: input.description, targetDate: null, weeklyMinutesBudget: input.weeklyMinutesBudget }

      try {
        let feedback: string[] = []
        let last: { plan: LetGoPlan; issues: string[]; notes: string[] } | null = null

        for (let iteration = 1; iteration <= maxIterations; iteration++) {
          const phase = iteration === 1 ? 'drafting' : 'revising'
          report(phase, iteration)

          let plan: LetGoPlan
          const notes: string[] = []
          try {
            plan = normaliseLetGoPlan(await inPhase(phase, () => ai.finalizeLetGo(letGoPrompt(input, ctx, feedback))))
          } catch (err) {
            if (err instanceof PlanShapeError && iteration < maxIterations) {
              feedback = err.problems.map((p) => `Structural problem: ${p}`)
              continue
            }
            if (isRateLimit(err) && last) return { plan: last.plan, iterations: iteration, warnings: [...last.issues, STOPPED_EARLY], notes: last.notes }
            throw err
          }
          const fitted = fitToBudget(plan.sessions, input.weeklyMinutesBudget)
          if (fitted) {
            plan = { ...plan, sessions: fitted.sessions }
            notes.push(fitted.note)
          }

          report('reviewing', iteration)
          const found = deterministicIssues(goalInput, ctx, asGoal(plan))
          last = { plan, issues: found.map((i) => i.user), notes }
          if (found.length > 0) {
            feedback = found.map((i) => i.model)
            continue
          }
          let verdict
          try {
            verdict = await inPhase('reviewing', () => ai.critique(letGoCritiquePrompt(input, ctx, plan, [])))
          } catch (err) {
            // The code checks passed, so this draft is usable even unreviewed.
            if (isRateLimit(err)) return { plan, iterations: iteration, warnings: [STOPPED_EARLY], notes }
            throw err
          }
          if (verdict.verdict === 'pass') return { plan, iterations: iteration, warnings: [], notes }
          const items = verdict.feedback.map((f) => f.trim()).filter(Boolean)
          feedback = items.length ? items : ['The reviewer found the plan too vague; make the "instead" and the habits concrete.']
          last = { plan, issues: items.length ? items : ['The reviewer thought the plan was too vague — make it concrete before you start.'], notes }
        }

        if (!last) throw new Error('The planner could not produce a usable plan.')
        return { plan: last.plan, iterations: maxIterations, warnings: last.issues, notes: last.notes }
      } finally {
        ai.setWaitListener?.(null)
      }
    }
  }
}
