import { describe, expect, it } from 'vitest'
import type { GoalDraftInput, GoalSession } from '@shared/types'
import { anthropicGoalPlanner } from '@main/ai/goalPlanner'
import { fitToBudget, keepTracedLinks, MIN_SESSION_MINUTES, normaliseUrl } from '@main/ai/planRepair'
import { weeklyMinutes } from '@main/ai/scheduleConflicts'
import type { PlanningContext } from '@main/ai/types'
import { FakeAi, samplePlan } from './fakeAi'

const session = (name: string, days: number[], targetMinutes: number): GoalSession => ({
  name,
  days,
  scheduledTime: '07:00',
  targetMinutes,
  rationale: null
})

const input: GoalDraftInput = {
  title: 'Learn the saxophone',
  description: 'Complete beginner.',
  targetDate: '2026-11-01',
  weeklyMinutesBudget: 300
}

const calendar: PlanningContext = { today: '2026-08-23', timezone: 'Africa/Cairo', occupied: [], committedMinutesPerWeek: 0 }

describe('fitToBudget', () => {
  it('leaves a plan that fits (with the reviewer’s slack) alone', () => {
    expect(fitToBudget([session('Practice', [1, 3, 5], 100)], 300)).toBeNull()
    expect(fitToBudget([session('Practice', [1, 3, 5], 110)], 300)).toBeNull() // 330 ≤ 345
    expect(fitToBudget([session('Practice', [1, 3, 5], 200)], null)).toBeNull()
  })

  it('shortens every session by the same proportion to land within the budget', () => {
    const fitted = fitToBudget([session('Long tones', [1, 2, 3, 4, 5], 60), session('Repertoire', [6], 300)], 300)!
    expect(weeklyMinutes(fitted.sessions)).toBeLessThanOrEqual(300)
    expect(fitted.sessions.map((s) => s.targetMinutes)).toEqual([30, 150])
    expect(fitted.sessions.every((s) => s.targetMinutes % 5 === 0)).toBe(true)
    expect(fitted.note).toBe('The sessions came to 10 h a week, over your 5 h budget, so they were shortened to 5 h.')
  })

  it('drops days from the busiest session once sessions hit the shortest sensible length', () => {
    const fitted = fitToBudget([session('Scales', [1, 2, 3, 4, 5, 6, 7], 30)], 60)!
    expect(fitted.sessions[0]!.targetMinutes).toBe(MIN_SESSION_MINUTES)
    expect(fitted.sessions[0]!.days).toEqual([1, 2, 3, 4])
    expect(weeklyMinutes(fitted.sessions)).toBe(60)
  })
})

describe('keepTracedLinks', () => {
  it('treats scheme, www, case and trailing slashes as the same link', () => {
    expect(normaliseUrl('https://WWW.Example.com/Path/')).toBe(normaliseUrl('http://example.com/path'))
  })

  it('keeps links that came from the research and drops invented ones, keeping the suggestion', () => {
    const findings = 'See https://www.saxopedia.com/beginners/ and (https://yamaha.com/sax).'
    const { resources, note } = keepTracedLinks(
      [
        { title: 'Saxopedia', type: 'website', note: '', url: 'https://saxopedia.com/beginners' },
        { title: 'Yamaha guide', type: 'website', note: '', url: 'https://yamaha.com/sax' },
        { title: 'Invented', type: 'book', note: '', url: 'https://www.amazon.com/dp/1234567890' },
        { title: 'No link', type: 'book', note: '', url: null }
      ],
      findings
    )
    expect(resources.map((r) => r.url)).toEqual(['https://saxopedia.com/beginners', 'https://yamaha.com/sax', null, null])
    expect(resources).toHaveLength(4)
    expect(note).toMatch(/^One suggested link could not be traced/)
  })

  it('says nothing when every link is traced', () => {
    expect(keepTracedLinks([{ title: 'A', type: 'book', note: '', url: null }], '').note).toBeNull()
  })
})

describe('planner repairs and early stops', () => {
  it('fits an over-budget draft itself instead of spending revisions on it', async () => {
    const ai = new FakeAi()
    ai.drafts = [samplePlan({ sessions: [session('Practice', [1, 2, 3, 4, 5], 120)] })]
    const result = await anthropicGoalPlanner({ ai }).plan(input, calendar)
    expect(result.iterations).toBe(1)
    expect(ai.count('finalize')).toBe(1)
    expect(weeklyMinutes(result.plan.sessions)).toBeLessThanOrEqual(300)
    expect(result.warnings).toEqual([])
    expect(result.notes[0]).toMatch(/shortened/)
  })

  it('removes links the research never mentioned before anything fetches them', async () => {
    const ai = new FakeAi()
    ai.researchText = 'Findings with no links at all.'
    const result = await anthropicGoalPlanner({ ai }).plan(input, calendar)
    expect(result.plan.resources.every((r) => r.url === null)).toBe(true)
    expect(ai.count('fetch')).toBe(0)
    expect(result.notes.join(' ')).toMatch(/could not be traced/)
  })

  it('returns the last reviewed draft when the limit hits during a revision', async () => {
    const ai = new FakeAi()
    ai.critiques = [{ verdict: 'fail', feedback: ['Pacing is too steep in week one.'] }]
    ai.limitFrom = { finalize: 2 }
    const result = await anthropicGoalPlanner({ ai }).plan(input, calendar)
    expect(result.plan.sessions.length).toBeGreaterThan(0)
    expect(result.warnings[0]).toBe('Pacing is too steep in week one.')
    expect(result.warnings[1]).toMatch(/per-minute limit/)
  })

  it('returns the unreviewed draft without its unchecked links when the limit hits the first review', async () => {
    const ai = new FakeAi()
    ai.limitFrom = { critique: 1 }
    const result = await anthropicGoalPlanner({ ai }).plan(input, calendar)
    expect(result.plan.resources.every((r) => r.url === null)).toBe(true)
    expect(result.warnings.at(-1)).toMatch(/per-minute limit/)
    expect(result.notes.join(' ')).toMatch(/no time to check them/)
  })

  it('still fails when there is no draft to fall back on', async () => {
    const ai = new FakeAi()
    ai.limitFrom = { research: 1 }
    await expect(anthropicGoalPlanner({ ai }).plan(input, calendar)).rejects.toMatchObject({ kind: 'rate_limit' })
  })

  it('turns a provider wait into a countdown on the progress feed, and unhooks afterwards', async () => {
    const ai = new FakeAi()
    const seen: (number | null | undefined)[] = []
    const run = anthropicGoalPlanner({ ai }).plan(input, calendar, (p) => seen.push(p.waitingUntil))
    ai.waitListener?.(20_000)
    await run
    const waits = seen.filter((w): w is number => typeof w === 'number')
    expect(waits).toHaveLength(1)
    expect(waits[0]! - Date.now()).toBeGreaterThan(15_000)
    expect(ai.waitListener).toBeNull()
  })
})
