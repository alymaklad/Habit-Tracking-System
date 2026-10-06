import type { OccurrenceStatus, ScoringConfig, TimeLogOrigin } from '@shared/types'

/**
 * Pure scoring. Nothing here reads a clock or a database, and nothing increments:
 * every value is a function of (logged minutes, target, status, config), so replaying
 * a sync recomputes the same numbers and un-ticking a task takes its points back
 * automatically.
 */

export interface OccurrenceFacts {
  targetMinutes: number
  loggedMinutes: number
  /** True once the source of truth (app or Google) says it is done. */
  completed: boolean
  justifiedSkip: boolean
  /** A day in the past with nothing logged and no completion is a miss. */
  elapsed: boolean
  origin: TimeLogOrigin | null
}

export function completionRatio(f: OccurrenceFacts): number {
  if (f.targetMinutes <= 0) return f.completed ? 1 : 0
  return f.loggedMinutes / f.targetMinutes
}

/** Percentage shown on the card, capped at 100 for display. */
export function percent(f: OccurrenceFacts): number {
  return Math.min(100, Math.round(completionRatio(f) * 100))
}

export function statusOf(f: OccurrenceFacts, cfg: ScoringConfig): OccurrenceStatus {
  if (f.justifiedSkip) return 'skipped'
  const ratio = completionRatio(f)
  if (f.completed || ratio >= 1) return 'complete'
  if (ratio >= cfg.partialThreshold) return 'partial'
  return f.elapsed ? 'missed' : 'pending'
}

export function pointsFor(status: OccurrenceStatus, cfg: ScoringConfig): number {
  switch (status) {
    case 'complete':
      return cfg.fullCompletion
    case 'partial':
      return cfg.partialCompletion
    case 'skipped':
      return cfg.skipped
    case 'missed':
      return cfg.unjustifiedSkip
    case 'pending':
      return 0
  }
}

// ------------------------------------------------------------------- XP

/**
 * XP rewards effort targeted and difficulty carried, not raw minutes — otherwise a
 * long easy habit would out-earn a short hard one. Anchors: a 30-minute tier-2 habit
 * is worth ~10 XP, a two-hour tier-3 habit ~20.
 */
export const XP_BASE = 12.5
const XP_MIN_MINUTES = 15
const XP_MAX_MINUTES = 180

export function fullXp(targetMinutes: number, difficultyLevel: number): number {
  const clamped = Math.min(Math.max(targetMinutes, XP_MIN_MINUTES), XP_MAX_MINUTES)
  const durationFactor = 0.5 + (clamped / 120) * 0.75
  const difficultyFactor = 1 + (Math.max(1, difficultyLevel) - 1) * 0.15
  return Math.round(XP_BASE * durationFactor * difficultyFactor)
}

export function xpFor(
  status: OccurrenceStatus,
  f: OccurrenceFacts,
  difficultyLevel: number
): number {
  const full = fullXp(f.targetMinutes, difficultyLevel)
  if (status === 'complete') return full
  if (status === 'partial') return Math.round(full * Math.min(1, completionRatio(f)))
  return 0
}

// --------------------------------------------------------------- bonuses

export interface WeekFacts {
  /** Scheduled occurrences in the week. */
  scheduled: number
  completed: number
  partial: number
  totalMinutes: number
  targetMinutes: number
  /** Completed on the weekday that historically has the lowest completion rate. */
  completedWorstDay: boolean
  /** Every one of the last seven scheduled days met its target. */
  sevenDayConsistent: boolean
}

export function weeklyBonus(w: WeekFacts, cfg: ScoringConfig): number {
  let bonus = 0
  if (w.targetMinutes > 0 && w.totalMinutes > w.targetMinutes) bonus += cfg.beatWeeklyTarget
  if (w.completedWorstDay) bonus += cfg.worstDayCompletion
  if (w.sevenDayConsistent) bonus += cfg.sevenDayConsistency
  return bonus
}

export function completionRate(completed: number, scheduled: number): number {
  return scheduled === 0 ? 0 : (completed / scheduled) * 100
}

/** Period-over-period change, or null when the earlier period has nothing to compare. */
export function improvement(previous: number, current: number): number | null {
  if (previous <= 0) return null
  return ((current - previous) / previous) * 100
}
