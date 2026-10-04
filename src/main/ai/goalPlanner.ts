import type { GoalDraftInput, GoalDraftResult, GoalPlan, GoalPlanPhase, GoalPlanProgress } from '@shared/types'
import { AiError, type AiClient } from './anthropicClient'
import { normalisePlan, PlanShapeError } from './goalPlanSchema'
import { deterministicIssues, intervenor as makeIntervenor, type Intervenor } from './intervenor'
import { fitToBudget, keepTracedLinks } from './planRepair'
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

const isRateLimit = (err: unknown): boolean => err instanceof AiError && err.kind === 'rate_limit'

const STOPPED_EARLY =
  'The AI provider hit its per-minute limit before the planner finished, so this is the last complete draft. Look it over, or try again in a minute for a fully checked plan.'

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
    async plan(input: GoalDraftInput, ctx: PlanningContext, onProgress?: ProgressCallback): Promise<GoalDraftResult> {
      let current: GoalPlanProgress = { phase: 'researching', iteration: 1, maxIterations }
      const report = (phase: GoalPlanPhase, iteration: number): void => {
        current = { phase, iteration, maxIterations }
        onProgress?.(current)
      }
      // A rate-limit wait becomes a countdown in the wizard instead of a silent stall.
      ai.setWaitListener?.((ms) => onProgress?.({ ...current, waitingUntil: Date.now() + ms }))

      try {
        report('researching', 1)
        const findings = clampFindings(await inPhase('researching', () => ai.research(researchPrompt(input, ctx))))

        let feedback: string[] = []
        /** The newest draft that went through a full review, with what the review said. */
        let last: { plan: GoalPlan; issues: string[]; notes: string[] } | null = null

        /** Fix what code can fix before any model looks at it again. */
        const repair = (draft: GoalPlan): { plan: GoalPlan; notes: string[] } => {
          const notes: string[] = []
          let plan = draft
          const fitted = fitToBudget(plan.sessions, input.weeklyMinutesBudget)
          if (fitted) {
            plan = { ...plan, sessions: fitted.sessions }
            notes.push(fitted.note)
          }
          const traced = keepTracedLinks(plan.resources, findings)
          if (traced.note) notes.push(traced.note)
          return { plan: { ...plan, resources: traced.resources }, notes }
        }

        /**
         * The provider stopped answering part-way. Hand back the best draft there is rather
         * than nothing: the last reviewed one, or failing that a fresh one with its links
         * taken out (they were never checked) and the code-only checks run on it.
         */
        const stoppedEarly = (unreviewed: { plan: GoalPlan; notes: string[] } | null, err: unknown): GoalDraftResult => {
          if (last) return { plan: last.plan, iterations: current.iteration, warnings: [...last.issues, STOPPED_EARLY], notes: last.notes }
          if (!unreviewed) throw err
          const plan = { ...unreviewed.plan, resources: unreviewed.plan.resources.map((r) => ({ ...r, url: null })) }
          return {
            plan,
            iterations: current.iteration,
            warnings: [...deterministicIssues(input, ctx, plan).map((i) => i.user), STOPPED_EARLY],
            notes: [...unreviewed.notes.filter((n) => !/link/i.test(n)), 'Links were left out because there was no time to check them — search for the resources by name.']
          }
        }

        for (let iteration = 1; iteration <= maxIterations; iteration++) {
          const phase = iteration === 1 ? 'drafting' : 'revising'
          report(phase, iteration)

          let repaired: { plan: GoalPlan; notes: string[] }
          try {
            repaired = repair(normalisePlan(await inPhase(phase, () => ai.finalize(finalizePrompt(input, ctx, findings, feedback)))))
          } catch (err) {
            // A structurally broken draft is itself feedback: tell the Actor exactly what was
            // wrong and let it try again, rather than failing the whole run on one bad turn.
            if (err instanceof PlanShapeError && iteration < maxIterations) {
              feedback = err.problems.map((p) => `Structural problem: ${p}`)
              continue
            }
            if (isRateLimit(err)) return stoppedEarly(null, err)
            throw err
          }

          report('reviewing', iteration)
          let review
          try {
            review = await inPhase('reviewing', () => intervenor.review(input, ctx, repaired.plan))
          } catch (err) {
            if (isRateLimit(err)) return stoppedEarly(repaired, err)
            throw err
          }
          const notes = [...repaired.notes, ...review.notes]
          last = { plan: review.plan, issues: review.issues, notes }

          if (review.accept) {
            return { plan: review.plan, iterations: iteration, warnings: [], notes }
          }
          feedback = review.feedback
        }

        if (!last) throw new Error('The planner could not produce a usable draft.')
        return { plan: last.plan, iterations: maxIterations, warnings: last.issues, notes: last.notes }
      } finally {
        ai.setWaitListener?.(null)
      }
    }
  }
}
