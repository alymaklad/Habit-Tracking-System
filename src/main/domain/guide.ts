import type { GoalView, GuideInsight, JournalEntry, LetGoView, LocalDate, Tool } from '@shared/types'
import { addDays } from './time'

const FEELING_WORDS: Record<string, string> = {
  stressed: 'stressed',
  bored: 'bored',
  tired: 'tired',
  lonely: 'lonely',
  overwhelmed: 'overwhelmed',
  frustrated: 'frustrated',
  other: 'something else'
}

/**
 * The Guide only counts what the user logged and says so. Every observation names its
 * numbers and its source, phrases the meaning as a possibility, and never diagnoses.
 */
export function guideInsights(input: {
  letGos: LetGoView[]
  journal: JournalEntry[]
  goals: GoalView[]
  tools: Tool[]
  today: LocalDate
}): GuideInsight[] {
  const { letGos, journal, goals, tools, today } = input
  const out: GuideInsight[] = []
  const toolTitles = new Set(tools.map((t) => t.title.trim().toLowerCase()))

  for (const lg of letGos.filter((l) => l.status === 'carrying')) {
    const returned = lg.checkins.filter((c) => !c.resisted).slice(-6)
    if (returned.length >= 3) {
      const counts = new Map<string, number>()
      for (const c of returned) for (const f of new Set(c.feelings)) counts.set(f, (counts.get(f) ?? 0) + 1)
      const top = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]
      if (top && top[1] >= 2 && top[0] !== 'other') {
        out.push({
          key: `letgo-feeling:${lg.id}:${top[0]}:${top[1]}/${returned.length}`,
          observation: `You've mentioned feeling ${FEELING_WORDS[top[0]]} in ${top[1]} of your last ${returned.length} reflections where ${lg.title.toLowerCase()} returned. This might be worth exploring.`,
          evidence: `From your check-ins between ${returned[0]!.date} and ${returned[returned.length - 1]!.date}.`,
          action: { kind: 'open-letgo', label: 'Look at the pattern', id: lg.id }
        })
      }
    }

    const alt = lg.alternatives[0]
    if (alt && alt.count >= 3 && !toolTitles.has(alt.text.toLowerCase())) {
      out.push({
        key: `letgo-alternative:${lg.id}:${alt.text.toLowerCase()}:${alt.count}`,
        observation: `On ${alt.count} of your free days from ${lg.title.toLowerCase()}, you logged “${alt.text}”. It may be one of the things that helps you climb.`,
        evidence: `${lg.stats.daysFree} free days recorded in all.`,
        action: { kind: 'add-tool', label: 'Keep it as a tool', title: alt.text, goalId: lg.goalId }
      })
    }

    if (lg.ceremonyReady) {
      out.push({
        key: `ceremony:${lg.id}`,
        observation: `${lg.title} has been left behind on ${lg.stats.daysFree} of ${lg.stats.daysTracked} tracked days.`,
        evidence: `A freedom rate of ${Math.round(lg.stats.freedomRate * 100)}% across the days you checked in.`,
        action: { kind: 'ceremony', label: 'Consider putting it down', id: lg.id }
      })
    }
  }

  const recentDaily = journal
    .filter((e) => e.kind === 'daily' && e.date > addDays(today, -14) && e.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date))
  const heavy = recentDaily.filter((e) => e.mood === 'low' || e.mood === 'stressed' || e.mood === 'exhausted')
  if (recentDaily.length >= 4 && heavy.length >= 3) {
    out.push({
      key: `mood:${today.slice(0, 7)}:${heavy.length}/${recentDaily.length}`,
      observation: `You described your day as low, stressed or exhausted in ${heavy.length} of your last ${recentDaily.length} daily reflections.`,
      evidence: 'From the mood you chose in each daily check-in over the past two weeks.',
      action: { kind: 'write', label: 'Write about it', prompt: 'What do I need right now?', goalId: null }
    })
  }

  const notToday = recentDaily.filter((e) => e.stepToward === 'not_today')
  if (recentDaily.length >= 4 && notToday.length >= 3) {
    const goalId = notToday.find((e) => e.goalId !== null)?.goalId ?? goals.find((g) => g.status === 'active')?.id ?? null
    out.push({
      key: `pace:${today.slice(0, 7)}:${notToday.length}/${recentDaily.length}`,
      observation: `You answered “not today” for a step toward your mountain in ${notToday.length} of your last ${recentDaily.length} daily reflections. Would you like to review the pace of your trail?`,
      evidence: 'From the “Did I take a step toward my Mountain?” answer in your daily check-ins.',
      action: goalId !== null ? { kind: 'open-mountain', label: 'Review my trail', id: goalId } : null
    })
  }

  const slow = journal.filter((e) => e.date > addDays(today, -30) && /\b(too )?slow(ly)?\b/i.test(`${e.title ?? ''} ${e.body}`))
  if (slow.length >= 2) {
    const goalId = slow.find((e) => e.goalId !== null)?.goalId ?? null
    out.push({
      key: `slow:${today.slice(0, 7)}:${slow.length}`,
      observation: `You've written about moving slowly in ${slow.length} reflections this past month. Would you like to review the pace of your trail?`,
      evidence: 'From the words in your own journal entries.',
      action: goalId !== null ? { kind: 'open-mountain', label: 'Review my trail', id: goalId } : { kind: 'write', label: 'Write more', prompt: 'How do I feel about my Mountain?', goalId: null }
    })
  }

  return out
}
