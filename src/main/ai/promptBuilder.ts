import type { GoalDraftInput, GoalPlan } from '@shared/types'
import type { PlanningContext } from './types'

const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

function fmt(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function hours(minutes: number): string {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m ? `${h}h ${m}m` : `${h}h`
}

/** The facts the Actor must respect, rendered once and reused by every prompt. */
export function renderContext(input: GoalDraftInput, ctx: PlanningContext): string {
  const lines: string[] = []
  lines.push(`Today is ${ctx.today} (timezone ${ctx.timezone}).`)
  if (input.targetDate) lines.push(`The user wants to reach this goal by ${input.targetDate}.`)
  if (input.weeklyMinutesBudget) {
    lines.push(`They can give it about ${hours(input.weeklyMinutesBudget)} per week in total.`)
  }
  lines.push(
    `They already spend ${hours(ctx.committedMinutesPerWeek)} per week on existing habits. ` +
      `Do not schedule anything inside these occupied blocks:`
  )
  if (ctx.occupied.length === 0) {
    lines.push('  (none — their calendar is open)')
  }
  for (const b of ctx.occupied) {
    lines.push(`  - ${b.name}: ${b.days.map((d) => DAY[d]).join('/')} ${fmt(b.start)}–${fmt(b.end)}`)
  }
  return lines.join('\n')
}

export function researchPrompt(input: GoalDraftInput, ctx: PlanningContext): { system: string; user: string } {
  return {
    system: [
      'You are a learning-and-habit coach helping someone turn a goal into a concrete weekly routine.',
      'This is the research step. Use web search to find current, reputable resources (courses, books,',
      'practice sites, communities) and realistic pacing guidance for the goal. Prefer well-known,',
      'stable sources. For each resource you intend to recommend, note its exact URL as it appeared',
      'in the search results — a later step will verify each link, and a wrong URL will be discarded.',
      'Finish with a concise summary of what you found — under 500 words: up to six recommended',
      'resources with their URLs, a realistic sense of how long the goal takes at the stated weekly',
      'time budget, and the main sub-topics. Do not produce the final plan yet.'
    ].join(' '),
    user: [
      `Goal: ${input.title}`,
      input.description ? `Context from the user: ${input.description}` : '',
      '',
      renderContext(input, ctx)
    ]
      .filter(Boolean)
      .join('\n')
  }
}

export function finalizePrompt(
  input: GoalDraftInput,
  ctx: PlanningContext,
  findings: string,
  feedback: string[]
): { system: string; user: string } {
  const rules = [
    'Produce the plan as structured data. Rules:',
    '- sessions: recurring practice blocks. `days` are ISO weekdays (1 = Monday … 7 = Sunday).',
    '  `scheduledTime` is HH:MM 24-hour. Sessions must not overlap the occupied blocks or each other.',
    '  Keep the total weekly minutes at or under the stated budget when one is given.',
    '- milestones: 3–8 dated checkpoints between today and the target date, in order, each a',
    '  concrete, checkable outcome (not "keep practising").',
    '- mindMap: one root node whose title is the goal, then sub-topics as children. Use short ids',
    '  like "root", "n1", "n2". Every parentId must reference an existing id.',
    '- resources: only include a `url` if it appeared verbatim in the research findings; otherwise',
    '  set it to null and describe what to search for in `note`.',
    '- summary: two or three sentences the user will read first.'
  ]

  const user = [
    `Goal: ${input.title}`,
    input.description ? `Context from the user: ${input.description}` : '',
    '',
    renderContext(input, ctx),
    '',
    '--- Research findings ---',
    findings.trim() || '(no research was available)',
    ''
  ]
  if (feedback.length > 0) {
    user.push('--- Problems with the previous draft — fix every one of these ---')
    for (const f of feedback) user.push(`- ${f}`)
    user.push('')
  }

  return {
    system: `You are a learning-and-habit coach turning research into a weekly routine.\n${rules.join('\n')}`,
    user: user.filter((l) => l !== undefined).join('\n')
  }
}

function renderPlan(plan: GoalPlan): string {
  const lines: string[] = [`Summary: ${plan.summary}`, '', 'Sessions:']
  for (const s of plan.sessions) {
    lines.push(
      `  - ${s.name}: ${s.days.map((d) => DAY[d]).join('/')} at ${s.scheduledTime}, ${s.targetMinutes} min` +
        (s.rationale ? ` — ${s.rationale}` : '')
    )
  }
  lines.push('', 'Milestones:')
  for (const m of plan.milestones) {
    lines.push(`  - ${m.dueDate}: ${m.title}` + (m.description ? ` — ${m.description}` : ''))
  }
  lines.push('', 'Resources:')
  for (const r of plan.resources) {
    lines.push(`  - [${r.type}] ${r.title}${r.url ? ` <${r.url}>` : ''} — ${r.note}`)
  }
  lines.push('', `Mind map: ${plan.mindMap.length} nodes`)
  return lines.join('\n')
}

/**
 * The critique sees only the finished draft and the brief — not the Actor's reasoning —
 * so it judges the output cold instead of rubber-stamping its own train of thought.
 */
export function critiquePrompt(
  input: GoalDraftInput,
  ctx: PlanningContext,
  plan: GoalPlan,
  deterministicFindings: string[]
): { system: string; user: string } {
  return {
    system: [
      'You are reviewing a learning plan someone else drafted. Judge it against the goal and the',
      'constraints only. Fail it if: the pacing is unrealistic for the time budget and deadline;',
      'milestones are vague or out of order; the sessions do not plausibly add up to the milestones;',
      'the resources are off-topic or padded; or the plan ignores something the user said.',
      'Pass it if it is realistic, concrete and respects the constraints, even if it is not the plan',
      'you would have written. Feedback must be specific and actionable — name the session,',
      'milestone or resource and say what to change. Return an empty feedback list on pass.'
    ].join(' '),
    user: [
      `Goal: ${input.title}`,
      input.description ? `Context from the user: ${input.description}` : '',
      '',
      renderContext(input, ctx),
      '',
      deterministicFindings.length > 0
        ? `Automated checks already found these problems (treat them as failures):\n${deterministicFindings.map((f) => `- ${f}`).join('\n')}\n`
        : 'Automated checks found no schedule conflicts or dead links.\n',
      '--- Draft plan ---',
      renderPlan(plan)
    ]
      .filter(Boolean)
      .join('\n')
  }
}
