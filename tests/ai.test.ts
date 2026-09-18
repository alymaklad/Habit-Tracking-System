import { describe, expect, it } from 'vitest'
import type { GoalDraftInput } from '@shared/types'
import { GoalPlanSchema, normalisePlan, PlanShapeError } from '@main/ai/goalPlanSchema'
import {
  describeConflict,
  findInternalConflicts,
  findScheduleConflicts,
  weeklyMinutes
} from '@main/ai/scheduleConflicts'
import { critiquePrompt, finalizePrompt, researchPrompt } from '@main/ai/promptBuilder'
import { intervenor } from '@main/ai/intervenor'
import { anthropicGoalPlanner, MAX_FINDINGS_CHARS } from '@main/ai/goalPlanner'
import { AiError } from '@main/ai/anthropicClient'
import type { PlanningContext } from '@main/ai/types'
import { FakeAi, samplePlan } from './fakeAi'

const input: GoalDraftInput = {
  title: 'Learn Spanish',
  description: 'Complete beginner, want to hold a basic conversation.',
  targetDate: '2026-11-01',
  weeklyMinutesBudget: 240
}

const emptyCalendar: PlanningContext = {
  today: '2026-08-23',
  timezone: 'Africa/Cairo',
  occupied: [],
  committedMinutesPerWeek: 0
}

/** Workout Mon/Wed/Fri 09:30–11:00 — the real habit from this user's schedule. */
const withWorkout: PlanningContext = {
  ...emptyCalendar,
  occupied: [{ name: 'Workout', days: [1, 3, 5], start: 9 * 60 + 30, end: 11 * 60 }],
  committedMinutesPerWeek: 270
}

// ---------------------------------------------------------------- schema

describe('GoalPlanSchema', () => {
  it('accepts a well-formed plan', () => {
    expect(GoalPlanSchema.safeParse(samplePlan()).success).toBe(true)
    expect(() => normalisePlan(samplePlan())).not.toThrow()
  })

  it('rejects a plan missing a required section', () => {
    const { sessions: _dropped, ...partial } = samplePlan()
    expect(GoalPlanSchema.safeParse(partial).success).toBe(false)
  })

  it('refuses a session with no valid weekdays instead of creating a habit that never runs', () => {
    const raw = samplePlan({
      sessions: [{ name: 'Ghost', days: [0, 8], scheduledTime: '07:00', targetMinutes: 30, rationale: null }]
    })
    expect(() => normalisePlan(raw)).toThrow(PlanShapeError)
    try {
      normalisePlan(raw)
    } catch (err) {
      expect((err as PlanShapeError).problems[0]).toMatch(/no valid weekdays/)
    }
  })

  it('refuses a malformed time or date rather than passing it to the scheduler', () => {
    expect(() =>
      normalisePlan(
        samplePlan({
          sessions: [{ name: 'X', days: [1], scheduledTime: '7am', targetMinutes: 30, rationale: null }]
        })
      )
    ).toThrow(/expected HH:MM/)
    expect(() =>
      normalisePlan(samplePlan({ milestones: [{ title: 'M', dueDate: 'next week', description: null }] }))
    ).toThrow(/expected YYYY-MM-DD/)
  })

  it('requires exactly one mind-map root and no dangling parents', () => {
    expect(() =>
      normalisePlan(
        samplePlan({
          mindMap: [
            { id: 'a', parentId: null, title: 'A' },
            { id: 'b', parentId: null, title: 'B' }
          ]
        })
      )
    ).toThrow(/exactly one root/)
    expect(() =>
      normalisePlan(
        samplePlan({
          mindMap: [
            { id: 'a', parentId: null, title: 'A' },
            { id: 'b', parentId: 'zzz', title: 'B' }
          ]
        })
      )
    ).toThrow(/missing parent/)
  })

  it('dedupes and sorts weekdays and drops non-http resource links', () => {
    const plan = normalisePlan(
      samplePlan({
        sessions: [{ name: 'X', days: [5, 1, 5, 3], scheduledTime: '07:00', targetMinutes: 30, rationale: null }],
        resources: [{ title: 'R', type: 'site', note: 'n', url: 'javascript:alert(1)' }]
      })
    )
    expect(plan.sessions[0]!.days).toEqual([1, 3, 5])
    expect(plan.resources[0]!.url).toBeNull()
  })
})

// ------------------------------------------------------------- conflicts

describe('scheduleConflicts', () => {
  it('finds a session that lands inside an occupied block', () => {
    const conflicts = findScheduleConflicts(
      [{ name: 'Spanish', days: [1, 2, 3], scheduledTime: '09:30', targetMinutes: 45, rationale: null }],
      withWorkout.occupied
    )
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]!.days).toEqual([1, 3]) // Tuesday is free
    expect(describeConflict(conflicts[0]!)).toBe(
      '"Spanish" (09:30–10:15) overlaps "Workout" (09:30–11:00) on Mon/Wed'
    )
  })

  it('does not treat an adjacent block as a conflict', () => {
    const conflicts = findScheduleConflicts(
      [{ name: 'Spanish', days: [1], scheduledTime: '11:00', targetMinutes: 30, rationale: null }],
      withWorkout.occupied
    )
    expect(conflicts).toHaveLength(0)
  })

  it('catches a session that starts before the block and runs into it', () => {
    const conflicts = findScheduleConflicts(
      [{ name: 'Spanish', days: [1], scheduledTime: '09:00', targetMinutes: 45, rationale: null }],
      withWorkout.occupied
    )
    expect(conflicts).toHaveLength(1)
  })

  it('catches two proposed sessions overlapping each other', () => {
    const conflicts = findInternalConflicts([
      { name: 'A', days: [2], scheduledTime: '18:00', targetMinutes: 60, rationale: null },
      { name: 'B', days: [2, 4], scheduledTime: '18:30', targetMinutes: 30, rationale: null }
    ])
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]!.days).toEqual([2])
  })

  it('sums weekly minutes across days', () => {
    expect(weeklyMinutes(normalisePlan(samplePlan()).sessions)).toBe(3 * 30 + 45)
  })
})

// --------------------------------------------------------------- prompts

describe('promptBuilder', () => {
  it('spells out the occupied blocks so the Actor is constrained up front', () => {
    const p = researchPrompt(input, withWorkout)
    expect(p.user).toContain('Workout: Mon/Wed/Fri 09:30–11:00')
    expect(p.user).toContain('Learn Spanish')
    expect(p.user).toContain('2026-11-01')
    expect(p.user).toContain('4h per week')
  })

  it('carries prior feedback into the revision prompt', () => {
    const p = finalizePrompt(input, emptyCalendar, 'findings here', ['Schedule conflict: X', 'Too long'])
    expect(p.user).toContain('findings here')
    expect(p.user).toContain('- Schedule conflict: X')
    expect(p.user).toContain('- Too long')
    expect(finalizePrompt(input, emptyCalendar, 'f', []).user).not.toContain('previous draft')
  })

  it('shows the critic the draft but not the research', () => {
    const p = critiquePrompt(input, emptyCalendar, normalisePlan(samplePlan()), [])
    expect(p.user).toContain('Spanish vocabulary')
    expect(p.user).toContain('Finish unit 1')
    expect(p.user).not.toContain('Findings:')
  })
})

// ------------------------------------------------------------ intervenor

describe('intervenor', () => {
  it('rejects on a schedule conflict without spending a critique call', async () => {
    const ai = new FakeAi()
    const iv = intervenor({ ai })
    const plan = normalisePlan(
      samplePlan({
        sessions: [{ name: 'Spanish', days: [1, 3], scheduledTime: '10:00', targetMinutes: 30, rationale: null }]
      })
    )
    const review = await iv.review(input, withWorkout, plan)
    expect(review.accept).toBe(false)
    expect(review.feedback[0]).toMatch(/Schedule conflict: "Spanish" .* overlaps "Workout"/)
    expect(ai.count('critique')).toBe(0)
  })

  it('rejects when the sessions blow the weekly budget', async () => {
    const ai = new FakeAi()
    const plan = normalisePlan(
      samplePlan({
        sessions: [{ name: 'Marathon', days: [1, 2, 3, 4, 5, 6, 7], scheduledTime: '06:00', targetMinutes: 90, rationale: null }]
      })
    )
    const review = await intervenor({ ai }).review(input, emptyCalendar, plan)
    expect(review.accept).toBe(false)
    expect(review.feedback.join(' ')).toMatch(/630 minutes per week but the budget is 240/)
  })

  it('rejects a milestone dated after the target', async () => {
    const ai = new FakeAi()
    const plan = normalisePlan(
      samplePlan({ milestones: [{ title: 'Late', dueDate: '2026-12-25', description: null }] })
    )
    const review = await intervenor({ ai }).review(input, emptyCalendar, plan)
    expect(review.accept).toBe(false)
    expect(review.feedback[0]).toMatch(/"Late" is dated 2026-12-25, after the target date/)
  })

  it('strips a dead link in place and asks for a replacement, keeping the suggestion', async () => {
    const ai = new FakeAi()
    ai.pages.set('https://www.languagetransfer.org/', {
      ok: false,
      title: null,
      excerpt: '',
      error: 'url_not_accessible'
    })
    const review = await intervenor({ ai }).review(input, emptyCalendar, normalisePlan(samplePlan()))
    expect(review.accept).toBe(false)
    expect(review.plan.resources[0]!.url).toBeNull()
    expect(review.plan.resources[0]!.title).toBe('Language Transfer')
    expect(review.feedback[0]).toMatch(/did not check out/)
    expect(ai.count('fetch')).toBe(1) // the null-url resource is never fetched
    expect(ai.count('judge')).toBe(0) // nothing reachable, so nothing to judge
  })

  it('strips a link whose page is off-topic', async () => {
    const ai = new FakeAi()
    ai.offTopic.add('https://www.languagetransfer.org/')
    const review = await intervenor({ ai }).review(input, emptyCalendar, normalisePlan(samplePlan()))
    expect(review.plan.resources[0]!.url).toBeNull()
    expect(review.feedback[0]).toMatch(/not about the goal/)
  })

  it('judges every reachable link in a single call', async () => {
    const ai = new FakeAi()
    const plan = normalisePlan(
      samplePlan({
        resources: [
          { title: 'A', type: 'site', note: 'a', url: 'https://a.example/' },
          { title: 'B', type: 'site', note: 'b', url: 'https://b.example/' },
          { title: 'C', type: 'site', note: 'c', url: 'https://c.example/' },
          { title: 'D', type: 'book', note: 'search for it', url: null }
        ]
      })
    )
    ai.pages.set('https://b.example/', { ok: false, title: null, excerpt: '', error: 'http_404' })
    const review = await intervenor({ ai }).review(input, emptyCalendar, plan)
    expect(ai.count('fetch')).toBe(3)
    expect(ai.count('judge')).toBe(1)
    expect(ai.calls.find((c) => c.kind === 'judge')!.pages!.map((p) => p.url)).toEqual([
      'https://a.example/',
      'https://c.example/'
    ])
    expect(review.plan.resources.map((r) => r.url)).toEqual(['https://a.example/', null, 'https://c.example/', null])
  })

  it('runs the cold critique only once the deterministic checks pass, and relays its feedback', async () => {
    const ai = new FakeAi()
    ai.critiques = [{ verdict: 'fail', feedback: ['Milestone 2 is too ambitious for 4h/week.'] }]
    const review = await intervenor({ ai }).review(input, emptyCalendar, normalisePlan(samplePlan()))
    expect(ai.count('critique')).toBe(1)
    expect(review.accept).toBe(false)
    expect(review.feedback).toEqual(['Milestone 2 is too ambitious for 4h/week.'])
  })

  it('accepts when everything is clean', async () => {
    const ai = new FakeAi()
    const review = await intervenor({ ai }).review(input, emptyCalendar, normalisePlan(samplePlan()))
    expect(review.accept).toBe(true)
    expect(review.feedback).toEqual([])
  })
})

// ------------------------------------------------------------------ loop

describe('goalPlanner loop', () => {
  it('researches once, drafts once and accepts on a clean first pass', async () => {
    const ai = new FakeAi()
    const phases: string[] = []
    const result = await anthropicGoalPlanner({ ai }).plan(input, emptyCalendar, (p) =>
      phases.push(`${p.phase}:${p.iteration}`)
    )
    expect(result.iterations).toBe(1)
    expect(result.warnings).toEqual([])
    expect(ai.count('research')).toBe(1)
    expect(ai.count('finalize')).toBe(1)
    expect(phases).toEqual(['researching:1', 'drafting:1', 'reviewing:1'])
  })

  it('feeds the reviewer\'s feedback into the next draft and stops as soon as it passes', async () => {
    const ai = new FakeAi()
    const conflicting = samplePlan({
      sessions: [{ name: 'Spanish', days: [1], scheduledTime: '10:00', targetMinutes: 30, rationale: null }]
    })
    ai.drafts = [conflicting, samplePlan()]
    const phases: string[] = []
    const result = await anthropicGoalPlanner({ ai }).plan(input, withWorkout, (p) =>
      phases.push(`${p.phase}:${p.iteration}`)
    )
    expect(result.iterations).toBe(2)
    expect(ai.count('research')).toBe(1) // research is not repeated per revision
    expect(ai.count('finalize')).toBe(2)
    const second = ai.calls.filter((c) => c.kind === 'finalize')[1]!
    expect(second.prompt!.user).toContain('overlaps "Workout"')
    expect(phases).toEqual(['researching:1', 'drafting:1', 'reviewing:1', 'revising:2', 'reviewing:2'])
  })

  it('halts at the cap and surfaces the unresolved feedback instead of looping', async () => {
    const ai = new FakeAi()
    ai.critiques = [{ verdict: 'fail', feedback: ['Still too ambitious.'] }]
    const result = await anthropicGoalPlanner({ ai, maxIterations: 3 }).plan(input, emptyCalendar)
    expect(result.iterations).toBe(3)
    expect(ai.count('finalize')).toBe(3)
    expect(ai.count('critique')).toBe(3)
    expect(result.warnings[0]).toMatch(/still had concerns after 3 attempts/)
    expect(result.warnings).toContain('Still too ambitious.')
    expect(result.plan.sessions.length).toBeGreaterThan(0)
  })

  it('clamps oversized research findings before they are re-sent on every draft', async () => {
    const ai = new FakeAi()
    ai.researchText = 'x'.repeat(MAX_FINDINGS_CHARS + 5000)
    await anthropicGoalPlanner({ ai }).plan(input, emptyCalendar)
    const finalize = ai.calls.find((c) => c.kind === 'finalize')!
    expect(finalize.prompt!.user.length).toBeLessThan(MAX_FINDINGS_CHARS + 2000)
    expect(finalize.prompt!.user).toContain('truncated to fit the request limit')
  })

  it('names the phase in a provider error', async () => {
    const ai = new FakeAi()
    ai.finalize = async () => {
      throw new AiError('Groq refused the request as too large.', 'other')
    }
    await expect(anthropicGoalPlanner({ ai }).plan(input, emptyCalendar)).rejects.toThrow(
      /^While drafting: Groq refused the request as too large\./
    )
  })

  it('treats a structurally broken draft as feedback for the next attempt', async () => {
    const ai = new FakeAi()
    const broken = samplePlan({
      sessions: [{ name: 'Ghost', days: [], scheduledTime: '07:00', targetMinutes: 30, rationale: null }]
    })
    ai.drafts = [broken, samplePlan()]
    const result = await anthropicGoalPlanner({ ai }).plan(input, emptyCalendar)
    expect(result.iterations).toBe(2)
    const second = ai.calls.filter((c) => c.kind === 'finalize')[1]!
    expect(second.prompt!.user).toContain('Structural problem: session 1 ("Ghost") has no valid weekdays')
  })
})
