import { formatDuration } from './time'

/**
 * Progressive difficulty. The app measures improvement rather than counting ticks, so
 * a habit carries a baseline and climbs a ladder of targets.
 *
 * Nothing here applies itself: `proposeAdjustment` returns a suggestion that the user
 * accepts or rejects, per the "do not blindly increase difficulty" requirement.
 */

export const RAISE_AT = 90
export const HOLD_AT = 70

/** Ladder step: a fifth of the baseline, rounded to 5 minutes, clamped to 5–20. */
export function ladderStep(baselineMinutes: number): number {
  const raw = Math.round((baselineMinutes * 0.2) / 5) * 5
  return Math.min(20, Math.max(5, raw))
}

export function targetForLevel(baselineMinutes: number, level: number): number {
  const n = Math.max(1, Math.floor(level))
  return baselineMinutes + (n - 1) * ladderStep(baselineMinutes)
}

export function ladder(baselineMinutes: number, levels = 6): number[] {
  return Array.from({ length: levels }, (_, i) => targetForLevel(baselineMinutes, i + 1))
}

export type AdjustmentDirection = 'raise' | 'hold' | 'reduce'

export interface Adjustment {
  direction: AdjustmentDirection
  currentLevel: number
  proposedLevel: number
  currentTarget: number
  proposedTarget: number
  rationale: string
}

export function proposeAdjustment(args: {
  habitName: string
  baselineMinutes: number
  currentLevel: number
  completionRate: number
  scheduled: number
}): Adjustment {
  const { habitName, baselineMinutes, currentLevel, completionRate, scheduled } = args
  const currentTarget = targetForLevel(baselineMinutes, currentLevel)
  const rate = Math.round(completionRate * 10) / 10

  // Too little evidence to move a target on.
  if (scheduled < 3) {
    return {
      direction: 'hold',
      currentLevel,
      proposedLevel: currentLevel,
      currentTarget,
      proposedTarget: currentTarget,
      rationale: `Only ${scheduled} scheduled ${scheduled === 1 ? 'session' : 'sessions'} this week — not enough to judge ${habitName} yet.`
    }
  }

  if (completionRate >= RAISE_AT) {
    const proposedLevel = currentLevel + 1
    const proposedTarget = targetForLevel(baselineMinutes, proposedLevel)
    return {
      direction: 'raise',
      currentLevel,
      proposedLevel,
      currentTarget,
      proposedTarget,
      rationale: `${habitName} ran at ${rate}% this week. Raising the target from ${formatDuration(currentTarget)} to ${formatDuration(proposedTarget)} keeps it challenging.`
    }
  }

  if (completionRate >= HOLD_AT) {
    return {
      direction: 'hold',
      currentLevel,
      proposedLevel: currentLevel,
      currentTarget,
      proposedTarget: currentTarget,
      rationale: `${habitName} held at ${rate}% — inside the ${HOLD_AT}–${RAISE_AT - 1}% band, so the target stays at ${formatDuration(currentTarget)}.`
    }
  }

  const proposedLevel = Math.max(1, currentLevel - 1)
  const proposedTarget = targetForLevel(baselineMinutes, proposedLevel)
  if (proposedLevel === currentLevel) {
    return {
      direction: 'hold',
      currentLevel,
      proposedLevel,
      currentTarget,
      proposedTarget,
      rationale: `${habitName} dropped to ${rate}%, but it is already at its baseline of ${formatDuration(currentTarget)}. Consider rescheduling it rather than shortening it further.`
    }
  }

  return {
    direction: 'reduce',
    currentLevel,
    proposedLevel,
    currentTarget,
    proposedTarget,
    rationale: `${habitName} dropped to ${rate}%, below the ${HOLD_AT}% floor. Easing the target back to ${formatDuration(proposedTarget)} until consistency recovers.`
  }
}
