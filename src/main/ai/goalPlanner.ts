import type { GoalDraftInput, GoalPlan, GoalPlanPhase } from '@shared/types'
import { AiError, type AiClient } from './anthropicClient'
import { normalisePlan, PlanShapeError } from './goalPlanSchema'
import { intervenor as makeIntervenor, type Intervenor } from './intervenor'
import { finalizePrompt, researchPrompt } from './promptBuilder'
import type { GoalPlanner, PlanningContext, ProgressCallback } from './types'

export const DEFAULT_MAX_ITERATIONS = 3

/**
 * Research output is re-sent on every drafting pass, so its size is paid for repeatedly
 * — and on providers with a per-request token cap (Groq's free tier) an unbounded
 * findings block is what pushes the draft over the limit.
 */
export const MAX_FINDINGS_CHARS = 6000

export function clampFindings(findings: string): string {
  if (findings.length <= MAX_FINDINGS_CHARS) return findings
  return `${findings.slice(0, MAX_FINDINGS_CHARS)}\n\n[research summary truncated to fit the request limit]`
}

const PHASE_LABEL: Record<GoalPlanPhase, string> = {
  researching: 'While researching',
  drafting: 'While drafting',
  revising: 'While revising',
  reviewing: 'While reviewing'
}

/** Name the phase in any provider error, so "too large" points at one request, not the whole run. */
async function inPhase<T>(phase: GoalPlanPhase, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn()
  } catch (err) {
    if (err instanceof AiError) {
      throw new AiError(`${PHASE_LABEL[phase]}: ${err.message}`, err.kind)
    }
    throw err
  }
}

/**
 * Actor + Intervenor in a bounded Reflexion loop.
 *
 *   research → finalize → review ─┬─ pass → done
 *                                 └─ fail → finalize again with the feedback, up to the cap
 *
 * Research runs once: the findings do not change between revisions, only the plan drawn
 * from them does. When the cap is hit the last draft is returned with the unresolved
 * feedback as warnings — the wizard's human review is the tie-breaker, not another turn.
 */
export function anthropicGoalPlanner(deps: {
  ai: AiClient
  intervenor?: Intervenor
  maxIterations?: number
}): GoalPlanner {
  const ai = deps.ai
  const intervenor = deps.intervenor ?? makeIntervenor({ ai })
  const maxIterations = deps.maxIterations ?? DEFAULT_MAX_ITERATIONS

  return {
    async plan(input: GoalDraftInput, ctx: PlanningContext, onProgress?: ProgressCallback) {
      const report = (phase: 'researching' | 'drafting' | 'reviewing' | 'revising', iteration: number): void =>
        onProgress?.({ phase, iteration, maxIterations })

      report('researching', 1)
      const findings = clampFindings(await inPhase('researching', () => ai.research(researchPrompt(input, ctx))))

      let feedback: string[] = []
      let last: GoalPlan | null = null

      for (let iteration = 1; iteration <= maxIterations; iteration++) {
        const phase = iteration === 1 ? 'drafting' : 'revising'
        report(phase, iteration)

        let draft: GoalPlan
        try {
          draft = normalisePlan(
            await inPhase(phase, () => ai.finalize(finalizePrompt(input, ctx, findings, feedback)))
          )
        } catch (err) {
          // A structurally broken draft is itself feedback: tell the Actor exactly what was
          // wrong and let it try again, rather than failing the whole run on one bad turn.
          if (err instanceof PlanShapeError && iteration < maxIterations) {
            feedback = err.problems.map((p) => `Structural problem: ${p}`)
            continue
          }
          throw err
        }

        report('reviewing', iteration)
        const review = await inPhase('reviewing', () => intervenor.review(input, ctx, draft))
        last = review.plan

        if (review.accept) {
          return { plan: review.plan, iterations: iteration, warnings: review.notes }
        }
        feedback = review.feedback
      }

      if (!last) throw new Error('The planner could not produce a usable draft.')
      return {
        plan: last,
        iterations: maxIterations,
        warnings: [
          `The reviewer still had concerns after ${maxIterations} attempts — check these yourself:`,
          ...feedback
        ]
      }
    }
  }
}
