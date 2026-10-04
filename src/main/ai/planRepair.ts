import type { GoalResource, GoalSession } from '@shared/types'
import { weeklyMinutes } from './scheduleConflicts'

/**
 * Deterministic repairs applied to every draft before review. Each one fixes something
 * a model reliably gets wrong and plain code reliably gets right, so the reviewer never
 * spends a revision asking for it.
 */

/** The reviewer lets the plan run this much over the budget before it complains. */
export const BUDGET_SLACK = 1.15
/** Sessions are never shortened below this; past it, a day is dropped instead. */
export const MIN_SESSION_MINUTES = 15

const hours = (minutes: number): string => {
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m} min`
}

/**
 * Shrinks the sessions to fit the weekly budget: every session shortened by the same
 * proportion (in 5-minute steps), and if the floor on session length still leaves the
 * plan over, days are dropped from the sessions that meet most often. Returns null when
 * the plan already fits.
 */
export function fitToBudget(
  sessions: GoalSession[],
  budget: number | null | undefined
): { sessions: GoalSession[]; note: string } | null {
  if (!budget || budget <= 0) return null
  const before = weeklyMinutes(sessions)
  if (before <= budget * BUDGET_SLACK) return null

  const factor = budget / before
  const out = sessions.map((s) => ({
    ...s,
    days: [...s.days],
    targetMinutes: Math.max(MIN_SESSION_MINUTES, Math.floor((s.targetMinutes * factor) / 5) * 5)
  }))

  while (weeklyMinutes(out) > budget) {
    const busiest = out.reduce<GoalSession | null>((a, s) => (s.days.length > 1 && (!a || s.days.length > a.days.length) ? s : a), null)
    if (!busiest) break
    busiest.days.pop()
  }

  const after = weeklyMinutes(out)
  return {
    sessions: out,
    note: `The sessions came to ${hours(before)} a week, over your ${hours(budget)} budget, so they were shortened to ${hours(after)}.`
  }
}

/** Scheme, `www.`, trailing slashes and case do not make two links different. */
export function normaliseUrl(url: string): string {
  return url
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[)\].,;>]+$/, '')
    .replace(/\/+$/, '')
}

/**
 * Keeps a resource's link only if that link appeared in the research findings — that is,
 * it came from a real search, not from the model's memory. The suggestion itself stays.
 */
export function keepTracedLinks(resources: GoalResource[], findings: string): { resources: GoalResource[]; note: string | null } {
  const seen = new Set((findings.match(/https?:\/\/[^\s<>"'`]+/gi) ?? []).map(normaliseUrl))
  let removed = 0
  const out = resources.map((r) => {
    if (!r.url || seen.has(normaliseUrl(r.url))) return r
    removed++
    return { ...r, url: null }
  })
  return {
    resources: out,
    note:
      removed === 0
        ? null
        : `${removed === 1 ? 'One suggested link' : `${removed} suggested links`} could not be traced to a real search result, so ${removed === 1 ? 'it was' : 'they were'} left off — search for ${removed === 1 ? 'that resource' : 'those resources'} by name.`
  }
}
