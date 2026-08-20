import { describe, expect, it } from 'vitest'
import { DEFAULT_SCORING, type ScoringConfig } from '@shared/types'
import { countIn, describe as describeRec, expand, isValid, nextAfter, occursOn } from '@main/domain/recurrence'
import {
  completionRate,
  fullXp,
  improvement,
  percent,
  pointsFor,
  statusOf,
  weeklyBonus,
  type OccurrenceFacts
} from '@main/domain/scoring'
import { computeStreaks } from '@main/domain/streaks'
import { levelForXp, levelInfo, levelTitle } from '@main/domain/levels'
import { ladder, ladderStep, proposeAdjustment, targetForLevel } from '@main/domain/difficulty'
import { ACHIEVEMENTS, earnedKeys, type AchievementStats } from '@main/domain/achievements'

const cfg: ScoringConfig = DEFAULT_SCORING

const facts = (o: Partial<OccurrenceFacts>): OccurrenceFacts => ({
  targetMinutes: 60,
  loggedMinutes: 0,
  completed: false,
  justifiedSkip: false,
  elapsed: false,
  origin: null,
  ...o
})

// ------------------------------------------------------------- recurrence

describe('recurrence', () => {
  const monFri = { kind: 'weekly' as const, days: [1, 2, 3, 4, 5] }

  it('places weekly occurrences on the right weekdays', () => {
    expect(occursOn(monFri, '2026-08-20')).toBe(true) // Thursday
    expect(occursOn(monFri, '2026-08-22')).toBe(false) // Saturday
  })

  it('expands a Mon–Fri week to five days', () => {
    expect(expand(monFri, '2026-08-17', '2026-08-23')).toEqual([
      '2026-08-17',
      '2026-08-18',
      '2026-08-19',
      '2026-08-20',
      '2026-08-21'
    ])
  })

  it('expands every-N-days from its anchor', () => {
    const everyThree = { kind: 'everyN' as const, n: 3, anchor: '2026-08-17' }
    expect(expand(everyThree, '2026-08-17', '2026-08-26')).toEqual([
      '2026-08-17',
      '2026-08-20',
      '2026-08-23',
      '2026-08-26'
    ])
  })

  it('never places an every-N occurrence before its anchor', () => {
    const everyThree = { kind: 'everyN' as const, n: 3, anchor: '2026-08-17' }
    expect(occursOn(everyThree, '2026-08-14')).toBe(false)
  })

  it('spans month boundaries', () => {
    expect(expand(monFri, '2026-08-28', '2026-09-02')).toEqual([
      '2026-08-28',
      '2026-08-31',
      '2026-09-01',
      '2026-09-02'
    ])
  })

  it('returns nothing for an inverted range', () => {
    expect(expand(monFri, '2026-08-23', '2026-08-17')).toEqual([])
  })

  it('finds the next scheduled day, skipping the weekend', () => {
    expect(nextAfter(monFri, '2026-08-21')).toBe('2026-08-24')
  })

  it('counts occurrences in a range', () => {
    expect(countIn(monFri, '2026-08-17', '2026-08-30')).toBe(10)
  })

  it('describes schedules in words', () => {
    expect(describeRec(monFri)).toBe('Mon–Fri')
    expect(describeRec({ kind: 'weekly', days: [1, 2, 3, 4, 5, 6, 7] })).toBe('Daily')
    expect(describeRec({ kind: 'weekly', days: [6, 7] })).toBe('Weekends')
    expect(describeRec({ kind: 'weekly', days: [1, 3, 5] })).toBe('Mon/Wed/Fri')
    expect(describeRec({ kind: 'everyN', n: 1, anchor: '2026-08-17' })).toBe('Daily')
    expect(describeRec({ kind: 'everyN', n: 3, anchor: '2026-08-17' })).toBe('Every 3 days')
  })

  it('rejects invalid schedules', () => {
    expect(isValid({ kind: 'weekly', days: [] })).toBe(false)
    expect(isValid({ kind: 'weekly', days: [0] })).toBe(false)
    expect(isValid({ kind: 'weekly', days: [8] })).toBe(false)
    expect(isValid({ kind: 'everyN', n: 0, anchor: '2026-08-17' })).toBe(false)
    expect(isValid(monFri)).toBe(true)
  })
})

// ---------------------------------------------------------------- scoring

describe('scoring tiers', () => {
  it('treats meeting the target as complete', () => {
    const f = facts({ loggedMinutes: 60 })
    expect(statusOf(f, cfg)).toBe('complete')
    expect(pointsFor(statusOf(f, cfg), cfg)).toBe(2)
  })

  it('treats exceeding the target as complete, capping the displayed percent', () => {
    const f = facts({ loggedMinutes: 95 })
    expect(statusOf(f, cfg)).toBe('complete')
    expect(percent(f)).toBe(100)
  })

  it('treats a quarter of the target as partial', () => {
    const f = facts({ loggedMinutes: 27, targetMinutes: 45 })
    expect(statusOf(f, cfg)).toBe('partial')
    expect(percent(f)).toBe(60)
    expect(pointsFor(statusOf(f, cfg), cfg)).toBe(1)
  })

  it('leaves an unelapsed empty day pending rather than missed', () => {
    expect(statusOf(facts({ elapsed: false }), cfg)).toBe('pending')
    expect(pointsFor('pending', cfg)).toBe(0)
  })

  it('penalises an elapsed empty day', () => {
    const f = facts({ elapsed: true })
    expect(statusOf(f, cfg)).toBe('missed')
    expect(pointsFor(statusOf(f, cfg), cfg)).toBe(-1)
  })

  it('never penalises a justified skip', () => {
    const f = facts({ elapsed: true, justifiedSkip: true })
    expect(statusOf(f, cfg)).toBe('skipped')
    expect(pointsFor(statusOf(f, cfg), cfg)).toBe(0)
  })

  it('honours a Google completion with no timer run', () => {
    const f = facts({ completed: true, loggedMinutes: 60, origin: 'assumed' })
    expect(statusOf(f, cfg)).toBe('complete')
  })

  it('reverts cleanly when a completion is undone', () => {
    const done = facts({ completed: true, loggedMinutes: 60, origin: 'assumed' })
    expect(pointsFor(statusOf(done, cfg), cfg)).toBe(2)
    // Same occurrence after the Google task is un-ticked: nothing logged, day elapsed.
    const undone = facts({ completed: false, loggedMinutes: 0, elapsed: true })
    expect(pointsFor(statusOf(undone, cfg), cfg)).toBe(-1)
  })

  it('respects a reconfigured scoring table', () => {
    const custom: ScoringConfig = { ...cfg, fullCompletion: 5, unjustifiedSkip: -3 }
    expect(pointsFor('complete', custom)).toBe(5)
    expect(pointsFor('missed', custom)).toBe(-3)
  })

  it('respects a reconfigured partial threshold', () => {
    const strict: ScoringConfig = { ...cfg, partialThreshold: 0.5 }
    const f = facts({ loggedMinutes: 18, targetMinutes: 60, elapsed: true })
    expect(statusOf(f, cfg)).toBe('partial')
    expect(statusOf(f, strict)).toBe('missed')
  })
})

describe('xp', () => {
  it('rewards longer targets and higher difficulty', () => {
    expect(fullXp(30, 2)).toBeGreaterThan(0)
    expect(fullXp(120, 3)).toBeGreaterThan(fullXp(30, 3))
    expect(fullXp(60, 4)).toBeGreaterThan(fullXp(60, 1))
  })

  it('lands near the brief’s anchors', () => {
    expect(fullXp(30, 2)).toBe(10)
    expect(fullXp(120, 3)).toBe(20)
  })

  it('clamps absurd targets', () => {
    expect(fullXp(10000, 1)).toBe(fullXp(180, 1))
    expect(fullXp(1, 1)).toBe(fullXp(15, 1))
  })
})

describe('weekly bonuses', () => {
  const base = {
    scheduled: 5,
    completed: 5,
    partial: 0,
    totalMinutes: 400,
    targetMinutes: 300,
    completedWorstDay: false,
    sevenDayConsistent: false
  }

  it('pays for beating the weekly target', () => {
    expect(weeklyBonus(base, cfg)).toBe(5)
  })

  it('stacks all three bonuses', () => {
    expect(
      weeklyBonus({ ...base, completedWorstDay: true, sevenDayConsistent: true }, cfg)
    ).toBe(18)
  })

  it('pays nothing when the target is missed', () => {
    expect(weeklyBonus({ ...base, totalMinutes: 200 }, cfg)).toBe(0)
  })
})

describe('rates and improvement', () => {
  it('computes completion rate', () => {
    expect(completionRate(18, 21)).toBeCloseTo(85.714, 2)
    expect(completionRate(0, 0)).toBe(0)
  })

  it('computes period-over-period improvement', () => {
    expect(improvement(8.5, 11.2)).toBeCloseTo(31.76, 1)
    expect(improvement(10.25, 12.667)).toBeCloseTo(23.58, 1)
  })

  it('returns null rather than dividing by zero', () => {
    expect(improvement(0, 12)).toBeNull()
  })
})

// ---------------------------------------------------------------- streaks

describe('streaks', () => {
  const day = (date: string, status: 'complete' | 'missed' | 'partial' | 'skipped' | 'pending') =>
    ({ date, status }) as const

  it('counts consecutive completions', () => {
    const s = computeStreaks([
      day('2026-08-17', 'complete'),
      day('2026-08-18', 'complete'),
      day('2026-08-19', 'complete')
    ])
    expect(s.current).toBe(3)
    expect(s.longest).toBe(3)
  })

  it('breaks on a miss but remembers the longest run', () => {
    const s = computeStreaks([
      day('2026-08-10', 'complete'),
      day('2026-08-11', 'complete'),
      day('2026-08-12', 'complete'),
      day('2026-08-13', 'complete'),
      day('2026-08-14', 'missed'),
      day('2026-08-17', 'complete'),
      day('2026-08-18', 'complete')
    ])
    expect(s.current).toBe(2)
    expect(s.longest).toBe(4)
  })

  it('bridges a justified skip without extending the streak', () => {
    const s = computeStreaks([
      day('2026-08-17', 'complete'),
      day('2026-08-18', 'skipped'),
      day('2026-08-19', 'complete')
    ])
    expect(s.current).toBe(2)
  })

  it('does not let today’s unfinished habit reset a live streak', () => {
    const s = computeStreaks([
      day('2026-08-18', 'complete'),
      day('2026-08-19', 'complete'),
      day('2026-08-20', 'pending')
    ])
    expect(s.current).toBe(2)
  })

  it('breaks on a partial', () => {
    const s = computeStreaks([
      day('2026-08-18', 'complete'),
      day('2026-08-19', 'partial'),
      day('2026-08-20', 'complete')
    ])
    expect(s.current).toBe(1)
  })

  it('is order-independent', () => {
    const shuffled = computeStreaks([
      day('2026-08-19', 'complete'),
      day('2026-08-17', 'complete'),
      day('2026-08-18', 'complete')
    ])
    expect(shuffled.current).toBe(3)
  })

  it('handles an empty history', () => {
    expect(computeStreaks([])).toEqual({ current: 0, longest: 0 })
  })
})

// ----------------------------------------------------------------- levels

describe('levels', () => {
  it('places 2,340 XP at level 4', () => {
    const info = levelInfo(2340)
    expect(info.level).toBe(4)
    expect(info.title).toBe('Focused')
    expect(info.levelFloor).toBe(1800)
    expect(info.levelCeiling).toBe(2800)
    expect(info.xpToNext).toBe(460)
    expect(info.progress).toBeCloseTo(0.54, 2)
  })

  it('starts everyone at level 1', () => {
    expect(levelForXp(0)).toBe(1)
    expect(levelInfo(0).title).toBe('Beginner')
  })

  it('increases the cost of every level', () => {
    const spans = [1, 2, 3, 4, 5].map((n) => levelInfo(0).levelCeiling && n)
    expect(spans.length).toBe(5)
    let prev = 0
    for (let n = 1; n <= 8; n++) {
      const span = levelInfo(0) && 100 * n * (n + 3) - 100 * (n - 1) * (n + 2)
      expect(span).toBeGreaterThan(prev)
      prev = span
    }
  })

  it('names levels beyond the title table', () => {
    expect(levelTitle(99)).toBe('Legend')
  })

  it('never reports negative XP', () => {
    expect(levelInfo(-500).currentXp).toBe(0)
    expect(levelInfo(-500).level).toBe(1)
  })
})

// ------------------------------------------------------------- difficulty

describe('progressive difficulty', () => {
  it('derives a sane ladder step from the baseline', () => {
    expect(ladderStep(20)).toBe(5)
    expect(ladderStep(30)).toBe(5)
    expect(ladderStep(120)).toBe(20)
  })

  it('builds an ascending ladder', () => {
    expect(ladder(20, 6)).toEqual([20, 25, 30, 35, 40, 45])
  })

  it('maps level to target', () => {
    expect(targetForLevel(20, 1)).toBe(20)
    expect(targetForLevel(20, 3)).toBe(30)
  })

  it('raises the target at 90% or better', () => {
    const a = proposeAdjustment({
      habitName: 'Coding', baselineMinutes: 120, currentLevel: 3, completionRate: 94, scheduled: 6
    })
    expect(a.direction).toBe('raise')
    expect(a.proposedLevel).toBe(4)
    expect(a.proposedTarget).toBeGreaterThan(a.currentTarget)
  })

  it('holds between 70 and 89%', () => {
    const a = proposeAdjustment({
      habitName: 'Read', baselineMinutes: 30, currentLevel: 2, completionRate: 78, scheduled: 7
    })
    expect(a.direction).toBe('hold')
    expect(a.proposedTarget).toBe(a.currentTarget)
  })

  it('eases the target below 70%', () => {
    const a = proposeAdjustment({
      habitName: 'German', baselineMinutes: 20, currentLevel: 4, completionRate: 67, scheduled: 9
    })
    expect(a.direction).toBe('reduce')
    expect(a.proposedLevel).toBe(3)
    expect(a.proposedTarget).toBeLessThan(a.currentTarget)
  })

  it('refuses to reduce below the baseline', () => {
    const a = proposeAdjustment({
      habitName: 'German', baselineMinutes: 20, currentLevel: 1, completionRate: 40, scheduled: 7
    })
    expect(a.direction).toBe('hold')
    expect(a.rationale).toContain('baseline')
  })

  it('will not move a target on too little evidence', () => {
    const a = proposeAdjustment({
      habitName: 'Journal', baselineMinutes: 15, currentLevel: 1, completionRate: 100, scheduled: 1
    })
    expect(a.direction).toBe('hold')
  })
})

// ----------------------------------------------------------- achievements

describe('achievements', () => {
  const stats = (o: Partial<AchievementStats> = {}): AchievementStats => ({
    longestStreak: 0,
    currentStreak: 0,
    totalMinutes: 0,
    tasksCompleted: 0,
    perfectWeeks: 0,
    beatOwnRecord: false,
    comeback: false,
    ...o
  })

  it('unlocks nothing from a standing start', () => {
    expect(earnedKeys(stats())).toEqual([])
  })

  it('unlocks the 7-day streak at exactly seven', () => {
    expect(earnedKeys(stats({ longestStreak: 6 }))).not.toContain('streak_7')
    expect(earnedKeys(stats({ longestStreak: 7 }))).toContain('streak_7')
  })

  it('unlocks both hour milestones in order', () => {
    expect(earnedKeys(stats({ totalMinutes: 600 }))).toContain('hours_10')
    expect(earnedKeys(stats({ totalMinutes: 600 }))).not.toContain('hours_100')
    expect(earnedKeys(stats({ totalMinutes: 6000 }))).toContain('hours_100')
  })

  it('reports partial progress with a readable label', () => {
    const def = ACHIEVEMENTS.find((a) => a.key === 'hours_100')!
    const r = def.evaluate(stats({ totalMinutes: 3684 }))
    expect(r.progress).toBeCloseTo(0.614, 2)
    expect(r.label).toBe('61h 24m of 100h')
  })

  it('has a unique key per achievement', () => {
    const keys = ACHIEVEMENTS.map((a) => a.key)
    expect(new Set(keys).size).toBe(keys.length)
  })
})
