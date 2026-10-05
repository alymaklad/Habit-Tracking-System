import type { GoalDraftInput, GoalPlan } from '@shared/types'
import { AiError, type AiClient, type FetchedPage, type PageToJudge, type Prompt } from '@main/ai/anthropicClient'
import type { Critique, RawGoalPlan, RawLetGoPlan } from '@main/ai/goalPlanSchema'
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

/** A let-go plan that passes every deterministic check against an empty calendar. */
export function sampleLetGoPlan(overrides: Partial<RawLetGoPlan> = {}): RawLetGoPlan {
  return {
    summary: 'Scrolling fills the gap before sleep. Put the phone out of reach and read instead.',
    triggerContexts: ['before_sleep', 'boredom'],
    triggerNotes: 'In bed, when too tired to read.',
    replacement: 'Read two pages of a paper book',
    weight: 'medium',
    sessions: [{ name: 'Wind-down reading', days: [1, 2, 3, 4, 5, 6, 7], scheduledTime: '22:00', targetMinutes: 20, rationale: 'Fills the same slot' }],
    supports: [{ title: 'Phone charges in the hallway', description: 'Out of the bedroom after 21:30.' }],
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
  letGoDrafts: RawLetGoPlan[] = [sampleLetGoPlan()]
  critiques: Critique[] = [{ verdict: 'pass', feedback: [] }]
  pages = new Map<string, FetchedPage>()
  /** URLs the relevance judge should call off-topic. */
  offTopic = new Set<string>()
  /** From the Nth call of a kind (1-based) onwards, that kind answers with a rate limit. */
  limitFrom: Partial<Record<'research' | 'finalize' | 'critique', number>> = {}
  waitListener: ((ms: number) => void) | null = null

  setWaitListener(listener: ((ms: number) => void) | null): void {
    this.waitListener = listener
  }

  private limit(kind: 'research' | 'finalize' | 'critique'): void {
    const from = this.limitFrom[kind]
    if (from !== undefined && this.count(kind) >= from) throw new AiError('The AI provider is rate-limiting requests.', 'rate_limit')
  }

  readonly calls: {
    kind: 'research' | 'finalize' | 'critique' | 'fetch' | 'judge'
    prompt?: Prompt
    url?: string
    pages?: PageToJudge[]
  }[] = []

  async research(prompt: Prompt): Promise<string> {
    this.calls.push({ kind: 'research', prompt })
    this.limit('research')
    return this.researchText
  }

  async finalize(prompt: Prompt): Promise<RawGoalPlan> {
    this.calls.push({ kind: 'finalize', prompt })
    this.limit('finalize')
    const next = this.drafts.length > 1 ? this.drafts.shift()! : this.drafts[0]!
    return next
  }

  async finalizeLetGo(prompt: Prompt): Promise<RawLetGoPlan> {
    this.calls.push({ kind: 'finalize', prompt })
    this.limit('finalize')
    return this.letGoDrafts.length > 1 ? this.letGoDrafts.shift()! : this.letGoDrafts[0]!
  }

  async critique(prompt: Prompt): Promise<Critique> {
    this.calls.push({ kind: 'critique', prompt })
    this.limit('critique')
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
    return { plan: this.result, iterations: 1, warnings: [], notes: [] }
  }
}
