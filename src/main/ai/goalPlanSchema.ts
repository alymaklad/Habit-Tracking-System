import { z } from 'zod'
import type { GoalPlan } from '@shared/types'

/**
 * The shape the Actor must produce. Sent to the API as the structured-output format and
 * used again to validate whatever comes back — a model response is untrusted input, the
 * same way a Google payload is.
 *
 * Kept deliberately flat: structured outputs reject recursive schemas and numeric
 * bounds, so ranges (weekday 1–7, minutes > 0) are enforced in `normalisePlan` below.
 */
export const GoalSessionSchema = z.object({
  name: z.string(),
  days: z.array(z.number().int()),
  scheduledTime: z.string(),
  targetMinutes: z.number().int(),
  rationale: z.string().nullable()
})

export const GoalMilestoneSchema = z.object({
  title: z.string(),
  dueDate: z.string(),
  description: z.string().nullable()
})

export const MindMapNodeSchema = z.object({
  id: z.string(),
  parentId: z.string().nullable(),
  title: z.string()
})

export const GoalResourceSchema = z.object({
  title: z.string(),
  type: z.string(),
  note: z.string(),
  url: z.string().nullable()
})

export const GoalPlanSchema = z.object({
  summary: z.string(),
  sessions: z.array(GoalSessionSchema),
  milestones: z.array(GoalMilestoneSchema),
  mindMap: z.array(MindMapNodeSchema),
  resources: z.array(GoalResourceSchema)
})

export type RawGoalPlan = z.infer<typeof GoalPlanSchema>

/** What the Intervenor's critique call must return. */
export const CritiqueSchema = z.object({
  verdict: z.enum(['pass', 'fail']),
  /** Specific, actionable problems — empty on pass. */
  feedback: z.array(z.string())
})

export type Critique = z.infer<typeof CritiqueSchema>

/** One call judges every fetched resource page at once — far fewer requests than one per link. */
export const RelevanceSchema = z.object({
  verdicts: z.array(z.object({ url: z.string(), relevant: z.boolean() }))
})

export type Relevance = z.infer<typeof RelevanceSchema>

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

/**
 * Tighten a schema-valid plan into one the rest of the app can trust.
 *
 * Throws with a readable message rather than quietly dropping bad rows: a session with
 * no valid days is a planning failure the loop should see, not a habit that silently
 * never runs.
 */
export function normalisePlan(raw: RawGoalPlan): GoalPlan {
  const problems: string[] = []

  const sessions = raw.sessions.map((s, i) => {
    const days = [...new Set(s.days.filter((d) => d >= 1 && d <= 7))].sort((a, b) => a - b)
    if (days.length === 0) problems.push(`session ${i + 1} ("${s.name}") has no valid weekdays`)
    if (!TIME.test(s.scheduledTime)) problems.push(`session ${i + 1} ("${s.name}") has time "${s.scheduledTime}", expected HH:MM`)
    if (s.targetMinutes < 5) problems.push(`session ${i + 1} ("${s.name}") is under 5 minutes`)
    if (!s.name.trim()) problems.push(`session ${i + 1} has no name`)
    return {
      name: s.name.trim(),
      days,
      scheduledTime: s.scheduledTime,
      targetMinutes: Math.round(s.targetMinutes),
      rationale: s.rationale?.trim() || null
    }
  })

  const milestones = raw.milestones.map((m, i) => {
    if (!DATE.test(m.dueDate)) problems.push(`milestone ${i + 1} ("${m.title}") has date "${m.dueDate}", expected YYYY-MM-DD`)
    if (!m.title.trim()) problems.push(`milestone ${i + 1} has no title`)
    return { title: m.title.trim(), dueDate: m.dueDate, description: m.description?.trim() || null }
  })

  const ids = new Set(raw.mindMap.map((n) => n.id))
  const roots = raw.mindMap.filter((n) => n.parentId === null).length
  if (raw.mindMap.length > 0 && roots !== 1) problems.push(`mind map must have exactly one root, found ${roots}`)
  for (const n of raw.mindMap) {
    if (n.parentId !== null && !ids.has(n.parentId)) problems.push(`mind map node "${n.title}" points at a missing parent`)
  }

  const resources = raw.resources.map((r) => ({
    title: r.title.trim(),
    type: r.type.trim() || 'resource',
    note: r.note.trim(),
    url: r.url && /^https?:\/\//i.test(r.url) ? r.url.trim() : null
  }))

  if (sessions.length === 0) problems.push('the plan has no practice sessions')

  if (problems.length > 0) throw new PlanShapeError(problems)

  return { summary: raw.summary.trim(), sessions, milestones, mindMap: raw.mindMap, resources }
}

export class PlanShapeError extends Error {
  constructor(readonly problems: string[]) {
    super(`The drafted plan is not usable: ${problems.join('; ')}`)
    this.name = 'PlanShapeError'
  }
}
