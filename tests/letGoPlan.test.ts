import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { GoalView, LetGoPlanInput } from '@shared/types'
import type { Db } from '@server/persistence/db'
import { freshDb } from './pg'
import { habitRepo } from '@server/persistence/habitRepo'
import { occurrenceRepo } from '@server/persistence/occurrenceRepo'
import { logRepo } from '@server/persistence/logRepo'
import { recordRepo } from '@server/persistence/recordRepo'
import { settingsRepo } from '@server/persistence/settingsRepo'
import { goalRepo } from '@server/persistence/goalRepo'
import { letGoRepo } from '@server/persistence/letGoRepo'
import { journalRepo } from '@server/persistence/journalRepo'
import { scheduleService } from '@server/application/scheduleService'
import { recomputeService } from '@server/application/recomputeService'
import { habitService } from '@server/application/habitService'
import { reflectService } from '@server/application/reflectService'
import { letGoPlanService } from '@server/application/letGoPlanService'
import { letGoPlanner } from '@server/ai/letGoPlanner'
import { normaliseLetGoPlan, PlanShapeError } from '@server/ai/goalPlanSchema'
import { weeklyMinutes } from '@server/ai/scheduleConflicts'
import { diskStore } from '@server/platform/attachmentStore'
import type { PlanningContext } from '@server/ai/types'
import { FakeAi, sampleLetGoPlan } from './fakeAi'

const NOW = new Date('2026-09-28T10:00:00.000Z')
const calendar: PlanningContext = { today: '2026-09-28', timezone: 'Africa/Cairo', occupied: [], committedMinutesPerWeek: 0 }
const input: LetGoPlanInput = {
  title: 'Late-night scrolling',
  description: 'I scroll in bed for an hour and sleep badly.',
  weeklyMinutesBudget: 180
}

describe('letGoPlanner', () => {
  it('drafts, checks and passes a plan on the first try, without any research step', async () => {
    const ai = new FakeAi()
    const phases: string[] = []
    const result = await letGoPlanner({ ai }).plan(input, calendar, (p) => phases.push(p.phase))
    expect(result.plan.replacement).toBe('Read two pages of a paper book')
    expect(result.plan.triggerContexts).toEqual(['before_sleep', 'boredom'])
    expect(result.warnings).toEqual([])
    expect(ai.count('research')).toBe(0)
    expect(phases).toEqual(['drafting', 'reviewing'])
    // The prompt carries what the user said.
    expect(ai.calls[0]!.prompt!.user).toContain('I scroll in bed for an hour')
  })

  it('shortens replacement habits to the weekly budget itself', async () => {
    const ai = new FakeAi()
    ai.letGoDrafts = [sampleLetGoPlan({ sessions: [{ name: 'Evening walk', days: [1, 2, 3, 4, 5, 6, 7], scheduledTime: '21:00', targetMinutes: 60, rationale: null }] })]
    const result = await letGoPlanner({ ai }).plan(input, calendar)
    expect(weeklyMinutes(result.plan.sessions)).toBeLessThanOrEqual(180)
    expect(result.notes[0]).toMatch(/shortened/)
    expect(ai.count('finalize')).toBe(1)
  })

  it('sends a clash with the existing schedule back for another draft', async () => {
    const ai = new FakeAi()
    ai.letGoDrafts = [
      sampleLetGoPlan({ sessions: [{ name: 'Reading', days: [1], scheduledTime: '22:00', targetMinutes: 20, rationale: null }] }),
      sampleLetGoPlan({ sessions: [{ name: 'Reading', days: [1], scheduledTime: '21:00', targetMinutes: 20, rationale: null }] })
    ]
    const busy: PlanningContext = { ...calendar, occupied: [{ name: 'Night shift', days: [1], start: 22 * 60, end: 23 * 60 }], committedMinutesPerWeek: 60 }
    const result = await letGoPlanner({ ai }).plan(input, busy)
    expect(result.iterations).toBe(2)
    expect(result.plan.sessions[0]!.scheduledTime).toBe('21:00')
  })

  it('hands back the reviewer’s unresolved points after the last draft', async () => {
    const ai = new FakeAi()
    ai.critiques = [{ verdict: 'fail', feedback: ['The "instead" needs to work in bed, at night.'] }]
    const result = await letGoPlanner({ ai, maxIterations: 2 }).plan(input, calendar)
    expect(result.iterations).toBe(2)
    expect(result.warnings).toEqual(['The "instead" needs to work in bed, at night.'])
  })

  it('returns the checked draft when the rate limit hits the review', async () => {
    const ai = new FakeAi()
    ai.limitFrom = { critique: 1 }
    const result = await letGoPlanner({ ai }).plan(input, calendar)
    expect(result.plan.sessions).toHaveLength(1)
    expect(await result.warnings.at(-1)).toMatch(/per-minute limit/)
  })
})

describe('normaliseLetGoPlan', () => {
  it('refuses a plan with no replacement habit, no "instead" and no trigger', async () => {
    expect(() => normaliseLetGoPlan(sampleLetGoPlan({ sessions: [], replacement: ' ', triggerContexts: [] }))).toThrow(PlanShapeError)
  })
})

describe('letGoPlanService.save', () => {
  let dir: string
  let db: Db

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), 'khatwa-letgoplan-'))
    db = await freshDb()
  })
  afterEach(() => rmSync(dir, { recursive: true, force: true }))

  it('creates the Let Go item, the replacement habits and the supports, in one go', async () => {
    const habits = habitRepo(db)
    const occurrences = occurrenceRepo(db)
    const logs = logRepo(db)
    const records = recordRepo(db)
    const settings = settingsRepo(db)
    await settings.save({ timezone: 'Africa/Cairo', provisionHorizonDays: 7 })
    const schedule = scheduleService({ db, habits, occurrences, settings })
    const engine = recomputeService({ db, habits, occurrences, logs, records, settings })
    const habitsApi = habitService({ db, habits, occurrences, logs, records, settings, schedule, engine })
    const reflect = reflectService({ letGo: letGoRepo(db), journal: journalRepo(db), goals: goalRepo(db), settings, files: diskStore(dir), goalViews: async () => [] as GoalView[] })
    const svc = letGoPlanService({ db, settings, habits: habitsApi, reflect, planningContext: async () => calendar, planner: async () => letGoPlanner({ ai: new FakeAi() }) })

    const plan = normaliseLetGoPlan(sampleLetGoPlan())
    const item = await svc.save(input, plan, NOW)

    expect(item).toMatchObject({ title: 'Late-night scrolling', replacement: 'Read two pages of a paper book', weight: 'medium', status: 'carrying', startedOn: '2026-09-28' })
    expect(item.triggerContexts).toEqual(['before_sleep', 'boredom'])
    expect((await habits.listActive()).map((h) => h.name)).toEqual(['Wind-down reading'])
    expect((await reflect.tools()).map((t) => t.title)).toEqual(['Phone charges in the hallway'])
  })
})
