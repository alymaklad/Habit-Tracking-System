import type { LetGoCheckin, LetGoFeeling, LetGoStats, LetGoView, LocalDate } from '@shared/types'
import { addDays, diffDays } from './time'

/** Tracked days and freedom rate needed before the leave-behind ceremony is offered. */
export const CEREMONY_MIN_DAYS = 21
export const CEREMONY_MIN_RATE = 0.7

/**
 * Freedom is counted, never reset: a day the behaviour returned lowers the rate and ends
 * the current run of free days, but every free day already recorded still counts.
 */
export function letGoStats(checkins: LetGoCheckin[], startedOn: LocalDate, today: LocalDate): LetGoStats {
  const past = checkins.filter((c) => c.date <= today)
  const byDate = new Map(past.map((c) => [c.date, c]))
  const tracked = past.length
  const free = past.filter((c) => c.resisted).length

  // Today not being answered yet does not end the run.
  let cursor = byDate.has(today) ? today : addDays(today, -1)
  let current = 0
  while (byDate.get(cursor)?.resisted) {
    current++
    cursor = addDays(cursor, -1)
  }

  let best = 0
  let run = 0
  let prev: LocalDate | null = null
  for (const c of [...past].sort((a, b) => a.date.localeCompare(b.date))) {
    if (c.resisted && prev !== null && diffDays(prev, c.date) === 1 && run > 0) run++
    else run = c.resisted ? 1 : 0
    best = Math.max(best, run)
    prev = c.date
  }

  return {
    daysCarried: Math.max(1, diffDays(startedOn, today) + 1),
    daysTracked: tracked,
    daysFree: free,
    freedomRate: tracked ? free / tracked : 0,
    currentStreak: current,
    bestStreak: best
  }
}

/** Feelings the user named on the days it returned, most frequent first. */
export function feelingPatterns(checkins: LetGoCheckin[]): LetGoView['feelings'] {
  const returned = checkins.filter((c) => !c.resisted)
  const counts = new Map<LetGoFeeling, number>()
  for (const c of returned) for (const f of new Set(c.feelings)) counts.set(f, (counts.get(f) ?? 0) + 1)
  return [...counts.entries()]
    .map(([feeling, count]) => ({ feeling, count, share: returned.length ? count / returned.length : 0 }))
    .sort((a, b) => b.count - a.count)
}

/** Alternatives logged on free days, grouped case-insensitively, most frequent first. */
export function alternativeCounts(checkins: LetGoCheckin[]): LetGoView['alternatives'] {
  const groups = new Map<string, { text: string; count: number }>()
  for (const c of checkins) {
    const text = c.alternative?.trim()
    if (!c.resisted || !text) continue
    const key = text.toLowerCase()
    const g = groups.get(key)
    if (g) g.count++
    else groups.set(key, { text, count: 1 })
  }
  return [...groups.values()].sort((a, b) => b.count - a.count)
}

export function ceremonyReady(stats: LetGoStats, status: LetGoView['status']): boolean {
  return status === 'carrying' && stats.daysTracked >= CEREMONY_MIN_DAYS && stats.freedomRate >= CEREMONY_MIN_RATE
}
