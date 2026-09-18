import type { GoalDraftInput, GoalPlan, GoalResource } from '@shared/types'
import type { AiClient, PageToJudge } from './anthropicClient'
import { critiquePrompt } from './promptBuilder'
import {
  describeConflict,
  findInternalConflicts,
  findScheduleConflicts,
  weeklyMinutes
} from './scheduleConflicts'
import type { PlanningContext } from './types'

export interface Review {
  accept: boolean
  /** Specific problems to hand back to the Actor. Empty when accepted. */
  feedback: string[]
  /**
   * The plan after in-place corrections (dead resource links stripped). Always returned
   * so the caller uses the corrected version even when the review otherwise passes.
   */
  plan: GoalPlan
  /** Things fixed silently that the user should still hear about. */
  notes: string[]
}

/**
 * The Intervenor: judges what the Actor produced and decides what happens next. It never
 * writes any part of the plan itself.
 *
 * Order matters and is deliberate:
 *  1. Deterministic checks first — schedule collisions and budget arithmetic. These are
 *     certain, free, and the kind of thing a model self-review misses half the time.
 *  2. Independent link verification — its own `web_fetch`, not the Actor's word. A dead
 *     link is fixed in place (dropped, replacement requested) rather than failing the
 *     whole draft.
 *  3. The critique call last, and only when 1–2 are clean, so no tokens are spent asking
 *     the model to discover a conflict that plain code already found.
 */
export function intervenor(deps: { ai: AiClient; verifyLinks?: boolean }) {
  const { ai } = deps
  const verifyLinks = deps.verifyLinks ?? true

  /**
   * Fetch every link first, then judge all the reachable pages in ONE model call. A dead
   * link costs no model call at all; six live links cost one, not six.
   */
  async function verifyResources(
    resources: GoalResource[],
    topic: string
  ): Promise<{ resources: GoalResource[]; dropped: string[] }> {
    if (!verifyLinks) return { resources, dropped: [] }

    const dropped: string[] = []
    const out: GoalResource[] = resources.map((r) => ({ ...r }))
    const reachable: { index: number; page: PageToJudge }[] = []

    for (let i = 0; i < out.length; i++) {
      const r = out[i]!
      if (!r.url) continue
      const page = await ai.fetchPage(r.url)
      if (!page.ok) {
        dropped.push(`${r.title} <${r.url}> (${page.error ?? 'unreachable'})`)
        // Keep the suggestion, lose the link — the note still tells the user what to look for.
        out[i] = { ...r, url: null }
        continue
      }
      if (page.title && !r.title.trim()) out[i] = { ...r, title: page.title }
      reachable.push({ index: i, page: { url: r.url, title: page.title, excerpt: page.excerpt } })
    }

    if (reachable.length > 0) {
      const verdicts = await ai.judgeRelevance(reachable.map((x) => x.page), topic)
      reachable.forEach((x, k) => {
        if (verdicts[k] === false) {
          const r = out[x.index]!
          dropped.push(`${r.title} <${r.url}> (page is not about the goal)`)
          out[x.index] = { ...r, url: null }
        }
      })
    }

    return { resources: out, dropped }
  }

  return {
    async review(input: GoalDraftInput, ctx: PlanningContext, draft: GoalPlan): Promise<Review> {
      const feedback: string[] = []
      const notes: string[] = []

      // 1. Deterministic.
      for (const c of findScheduleConflicts(draft.sessions, ctx.occupied)) {
        feedback.push(`Schedule conflict: ${describeConflict(c)}. Move or shorten the session.`)
      }
      for (const c of findInternalConflicts(draft.sessions)) {
        feedback.push(`Two proposed sessions overlap: ${describeConflict(c)}.`)
      }
      if (input.weeklyMinutesBudget) {
        const total = weeklyMinutes(draft.sessions)
        if (total > input.weeklyMinutesBudget * 1.15) {
          feedback.push(
            `The sessions add up to ${total} minutes per week but the budget is ${input.weeklyMinutesBudget}. Reduce the days or the length.`
          )
        }
      }
      if (input.targetDate) {
        for (const m of draft.milestones) {
          if (m.dueDate > input.targetDate) {
            feedback.push(`Milestone "${m.title}" is dated ${m.dueDate}, after the target date ${input.targetDate}.`)
          }
          if (m.dueDate < ctx.today) {
            feedback.push(`Milestone "${m.title}" is dated ${m.dueDate}, which is already in the past.`)
          }
        }
      }

      // 2. Independent link verification — fix in place, never fail the draft for it.
      const verified = await verifyResources(draft.resources, input.title)
      const plan: GoalPlan = { ...draft, resources: verified.resources }
      if (verified.dropped.length > 0) {
        feedback.push(
          `These resource links did not check out and were removed — replace them with working ones or set url to null: ${verified.dropped.join('; ')}`
        )
      }

      if (feedback.length > 0) {
        return { accept: false, feedback, plan, notes }
      }

      // 3. The cold read.
      const verdict = await ai.critique(critiquePrompt(input, ctx, plan, []))
      if (verdict.verdict === 'pass') {
        return { accept: true, feedback: [], plan, notes }
      }
      const items = verdict.feedback.map((f) => f.trim()).filter(Boolean)
      return {
        accept: false,
        feedback: items.length > 0 ? items : ['The reviewer rejected the plan without giving reasons; tighten pacing and make milestones concrete.'],
        plan,
        notes
      }
    }
  }
}

export type Intervenor = ReturnType<typeof intervenor>
