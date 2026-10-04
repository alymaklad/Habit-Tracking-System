import type { GoalDraftInput, GoalPlan, GoalResource } from '@shared/types'
import type { AiClient, PageToJudge } from './anthropicClient'
import { critiquePrompt } from './promptBuilder'
import {
  describeConflict,
  findInternalConflicts,
  findScheduleConflicts,
  weeklyMinutes
} from './scheduleConflicts'
import { BUDGET_SLACK } from './planRepair'
import type { PlanningContext } from './types'

/** One problem, worded twice: as an instruction for the model, and plainly for the user. */
export interface Issue {
  model: string
  user: string
}

const hours = (minutes: number): string => {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`
}

/**
 * The checks that need no model: schedule collisions, budget arithmetic and dates. They
 * are certain and free, and they still run when the provider stops answering mid-plan.
 */
export function deterministicIssues(input: GoalDraftInput, ctx: PlanningContext, draft: GoalPlan): Issue[] {
  const issues: Issue[] = []
  for (const c of findScheduleConflicts(draft.sessions, ctx.occupied)) {
    issues.push({
      model: `Schedule conflict: ${describeConflict(c)}. Move or shorten the session.`,
      user: `"${c.session}" clashes with "${c.against}", which you already do then — move it to another time.`
    })
  }
  for (const c of findInternalConflicts(draft.sessions)) {
    issues.push({
      model: `Two proposed sessions overlap: ${describeConflict(c)}.`,
      user: `"${c.session}" and "${c.against}" are set for the same time — move one of them.`
    })
  }
  if (input.weeklyMinutesBudget) {
    const total = weeklyMinutes(draft.sessions)
    if (total > input.weeklyMinutesBudget * BUDGET_SLACK) {
      issues.push({
        model: `The sessions add up to ${total} minutes per week but the budget is ${input.weeklyMinutesBudget}. Reduce the days or the length.`,
        user: `The sessions add up to ${hours(total)} a week, more than your ${hours(input.weeklyMinutesBudget)} — drop a day or shorten a session.`
      })
    }
  }
  if (input.targetDate) {
    for (const m of draft.milestones) {
      if (m.dueDate > input.targetDate) {
        issues.push({
          model: `Milestone "${m.title}" is dated ${m.dueDate}, after the target date ${input.targetDate}.`,
          user: `"${m.title}" is due after your target date — move it earlier.`
        })
      }
    }
  }
  for (const m of draft.milestones) {
    if (m.dueDate < ctx.today) {
      issues.push({
        model: `Milestone "${m.title}" is dated ${m.dueDate}, which is already in the past.`,
        user: `"${m.title}" is dated in the past — give it a date ahead.`
      })
    }
  }
  return issues
}

export interface Review {
  accept: boolean
  /** Specific problems to hand back to the Actor. Empty when accepted. */
  feedback: string[]
  /** The same problems, worded for the user — what the wizard shows if they are never fixed. */
  issues: string[]
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
      const notes: string[] = []

      // 1. Deterministic.
      const found = deterministicIssues(input, ctx, draft)
      const feedback = found.map((i) => i.model)
      const issues = found.map((i) => i.user)

      // 2. Independent link verification — fix in place, never fail the draft for it.
      const verified = await verifyResources(draft.resources, input.title)
      const plan: GoalPlan = { ...draft, resources: verified.resources }
      if (verified.dropped.length > 0) {
        // Already fixed in place, so the user hears it as a note; the model is still asked
        // for replacements on the next pass.
        feedback.push(
          `These resource links did not check out and were removed — replace them with working ones or set url to null: ${verified.dropped.join('; ')}`
        )
        const n = verified.dropped.length
        notes.push(
          `${n === 1 ? 'One link' : `${n} links`} did not open or was off topic, so ${n === 1 ? 'it was' : 'they were'} removed — the suggestion${n === 1 ? ' is' : 's are'} kept; search for ${n === 1 ? 'it' : 'them'} by name.`
        )
      }

      if (found.length > 0) {
        return { accept: false, feedback, issues, plan, notes }
      }
      if (verified.dropped.length > 0) {
        // Only links were wrong, and they are already gone: one more pass for replacements
        // is worth it, but there is nothing left for the user to fix.
        return { accept: false, feedback, issues: [], plan, notes }
      }

      // 3. The cold read.
      const verdict = await ai.critique(critiquePrompt(input, ctx, plan, []))
      if (verdict.verdict === 'pass') {
        return { accept: true, feedback: [], issues: [], plan, notes }
      }
      const items = verdict.feedback.map((f) => f.trim()).filter(Boolean)
      const reasons = items.length > 0 ? items : ['The reviewer rejected the plan without giving reasons; tighten pacing and make milestones concrete.']
      return {
        accept: false,
        feedback: reasons,
        // The critique is free text from a reviewer reading the plan; it reads fine to a person too.
        issues: items.length > 0 ? items : ['The reviewer thought the plan was too vague — check the pacing and make the waypoints concrete.'],
        plan,
        notes
      }
    }
  }
}

export type Intervenor = ReturnType<typeof intervenor>
