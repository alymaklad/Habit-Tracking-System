import type { GoalDraftInput, GoalPlan } from '@shared/types'
import type { AiClient, FetchedPage, PageToJudge, Prompt } from '@main/ai/anthropicClient'
import type { Critique, RawGoalPlan } from '@main/ai/goalPlanSchema'
import type { GoalPlanner, PlanningContext } from '@main/ai/types'

/** A plan that passes every deterministic check against an empty calendar. */
export function samplePlan(overrides: Partial<RawGoalPlan> = {}): RawGoalPlan {
  return {
    summary: 'Three short sessions a week, building to a conversation by the target date.',
    sessions: [
      { name: 'Spanish vocabulary', days: [1, 3, 5], scheduledTime: '07:30', targetMinutes: 30, rationale: null },
      { name: 'Spanish listening', days: [6], scheduledTime: '10:00', targetMinutes: 45, rationale: 'Weekend immersion' }
    ],
    milestones: [
      { title: 'Finish unit 1', dueDate: '2026-09-05', description: null },
      { title: 'Hold a 5-minute conversation', dueDate: '2026-10-10', description: 'With a tutor' }
    ],
    mindMap: [
      { id: 'root', parentId: null, title: 'Learn Spanish' },
      { id: 'n1', parentId: 'root', title: 'Vocabulary' },
      { id: 'n2', parentId: 'root', title: 'Listening' }
    ],
    resources: [
      { title: 'Language Transfer', type: 'course', note: 'Free audio course', url: 'https://www.languagetransfer.org/' },
      { title: 'Graded readers', type: 'book', note: 'Search for A1 Spanish readers', url: null }
    ],
    ...overrides
  }
}

/**
 * Stands in for the Anthropic client. Scripted per call so a test can say exactly what
 * the Actor drafts on each attempt and what the critique returns — the same idea as
 * `FakeGoogle`, minus the clock.
 */
export class FakeAi implements AiClient {
  researchText = 'Findings: Language Transfer is a good free course. https://www.languagetransfer.org/'
  drafts: RawGoalPlan[] = [samplePlan()]
  critiques: Critique[] = [{ verdict: 'pass', feedback: [] }]
  pages = new Map<string, FetchedPage>()
  /** URLs the relevance judge should call off-topic. */
  offTopic = new Set<string>()

  readonly calls: {
    kind: 'research' | 'finalize' | 'critique' | 'fetch' | 'judge'
    prompt?: Prompt
    url?: string
    pages?: PageToJudge[]
  }[] = []

  async research(prompt: Prompt): Promise<string> {
    this.calls.push({ kind: 'research', prompt })
    return this.researchText
  }

  async finalize(prompt: Prompt): Promise<RawGoalPlan> {
    this.calls.push({ kind: 'finalize', prompt })
    const next = this.drafts.length > 1 ? this.drafts.shift()! : this.drafts[0]!
    return next
  }

  async critique(prompt: Prompt): Promise<Critique> {
    this.calls.push({ kind: 'critique', prompt })
    const next = this.critiques.length > 1 ? this.critiques.shift()! : this.critiques[0]!
    return next
  }

  async fetchPage(url: string): Promise<FetchedPage> {
    this.calls.push({ kind: 'fetch', url })
    return this.pages.get(url) ?? { ok: true, title: 'Page', excerpt: 'Some page text about the topic.', error: null }
  }

  async judgeRelevance(pages: PageToJudge[]): Promise<boolean[]> {
    this.calls.push({ kind: 'judge', pages })
    return pages.map((p) => !this.offTopic.has(p.url))
  }

  count(kind: 'research' | 'finalize' | 'critique' | 'fetch' | 'judge'): number {
    return this.calls.filter((c) => c.kind === kind).length
  }
}

/** Stands in for the whole planner port, for goalService tests that never touch the loop. */
export class FakeGoalPlanner implements GoalPlanner {
  result: GoalPlan
  lastInput: GoalDraftInput | null = null
  lastContext: PlanningContext | null = null

  constructor(plan?: GoalPlan) {
    this.result = plan ?? samplePlan()
  }

  async plan(input: GoalDraftInput, context: PlanningContext) {
    this.lastInput = input
    this.lastContext = context
    return { plan: this.result, iterations: 1, warnings: [] }
  }
}
