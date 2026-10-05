import type { LetGoPlan, LetGoPlanInput } from '@shared/types'
import { renderContext } from './promptBuilder'
import type { PlanningContext } from './types'

const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
const TRIGGERS = 'morning, work, evening, before_sleep, boredom, stress, other'

/**
 * Drafts a plan to let a habit go. There is no research step: this is behaviour change,
 * not a topic to look up, and skipping it spares the user's rate limit.
 */
export function letGoPrompt(input: LetGoPlanInput, ctx: PlanningContext, feedback: string[]): { system: string; user: string } {
  const rules = [
    'You help someone stop a habit they no longer want, kindly and practically. Produce the plan as structured data. Rules:',
    `- triggerContexts: when the habit tends to happen. Only these values: ${TRIGGERS}.`,
    '- triggerNotes: one or two plain sentences about when and why it happens, from what they told you.',
    '- replacement: one short, concrete thing to do instead when the urge comes (not "use willpower").',
    '- weight: light, medium or heavy — how hard this habit is likely to be to leave behind.',
    '- sessions: 1–3 small replacement habits that fill the same time or need. "days" are ISO weekdays',
    '  (1 = Monday … 7 = Sunday), "scheduledTime" is HH:MM 24-hour, "targetMinutes" at least 5. They must not',
    '  overlap the occupied blocks or each other, and their weekly total must stay within the budget when one is given.',
    '- supports: 2–5 things that make it easier — a change to their surroundings, or a plan for the hard moment.',
    '- summary: two or three warm, plain sentences the user will read first. Use simple English.'
  ]
  const user = [
    `The habit they want to let go: ${input.title}`,
    input.description ? `What they told you: ${input.description}` : '',
    '',
    renderContext(input, ctx),
    ''
  ]
  if (feedback.length > 0) {
    user.push('--- Problems with the previous draft — fix every one of these ---')
    for (const f of feedback) user.push(`- ${f}`)
  }
  return { system: rules.join('\n'), user: user.filter(Boolean).join('\n') }
}

function renderLetGoPlan(plan: LetGoPlan): string {
  const lines = [
    `Summary: ${plan.summary}`,
    `Triggers: ${plan.triggerContexts.join(', ')}${plan.triggerNotes ? ` — ${plan.triggerNotes}` : ''}`,
    `Instead: ${plan.replacement}`,
    `Weight: ${plan.weight}`,
    '',
    'Replacement habits:'
  ]
  for (const s of plan.sessions) {
    lines.push(`  - ${s.name}: ${s.days.map((d) => DAY[d]).join('/')} at ${s.scheduledTime}, ${s.targetMinutes} min` + (s.rationale ? ` — ${s.rationale}` : ''))
  }
  lines.push('', 'Supports:')
  for (const s of plan.supports) lines.push(`  - ${s.title}${s.description ? ` — ${s.description}` : ''}`)
  return lines.join('\n')
}

/** The reviewer reads the finished plan cold, as it does for a goal plan. */
export function letGoCritiquePrompt(
  input: LetGoPlanInput,
  ctx: PlanningContext,
  plan: LetGoPlan,
  deterministicFindings: string[]
): { system: string; user: string } {
  return {
    system: [
      'You are reviewing a plan someone else drafted to help a person stop a habit. Fail it if: the "instead" is vague',
      'or unrealistic in the moment the urge comes; the replacement habits do not fit the time or need the habit filled;',
      'the triggers ignore what the person said; the tone is shaming; or the plan is too big to start this week.',
      'Pass it if it is kind, concrete and realistic, even if it is not the plan you would have written. Feedback must',
      'be specific and actionable. Return an empty feedback list on pass.'
    ].join(' '),
    user: [
      `The habit: ${input.title}`,
      input.description ? `What they said: ${input.description}` : '',
      '',
      renderContext(input, ctx),
      '',
      deterministicFindings.length > 0
        ? `Automated checks already found these problems (treat them as failures):\n${deterministicFindings.map((f) => `- ${f}`).join('\n')}\n`
        : 'Automated checks found no schedule conflicts.\n',
      '--- Draft plan ---',
      renderLetGoPlan(plan)
    ]
      .filter(Boolean)
      .join('\n')
  }
}
