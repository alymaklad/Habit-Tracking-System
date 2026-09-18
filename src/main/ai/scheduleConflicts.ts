import type { GoalSession } from '@shared/types'
import type { OccupiedBlock } from './types'

export interface Conflict {
  session: string
  against: string
  /** ISO weekdays on which the two overlap. */
  days: number[]
  /** Both ranges as HH:MM–HH:MM, for the feedback message. */
  sessionRange: string
  againstRange: string
}

export function toMinutes(time: string): number {
  const [h, m] = time.split(':').map(Number)
  return (h ?? 0) * 60 + (m ?? 0)
}

function fmt(minutes: number): string {
  const m = ((minutes % 1440) + 1440) % 1440
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && bStart < aEnd
}

/**
 * The one check that never needs a model: does a proposed session land on top of
 * something the user already does? Adjacent blocks (one ends exactly when the other
 * starts) are not conflicts.
 */
export function findScheduleConflicts(sessions: GoalSession[], occupied: OccupiedBlock[]): Conflict[] {
  const out: Conflict[] = []
  for (const s of sessions) {
    const start = toMinutes(s.scheduledTime)
    const end = start + s.targetMinutes
    for (const block of occupied) {
      const days = s.days.filter((d) => block.days.includes(d) && overlaps(start, end, block.start, block.end))
      if (days.length === 0) continue
      out.push({
        session: s.name,
        against: block.name,
        days,
        sessionRange: `${fmt(start)}–${fmt(end)}`,
        againstRange: `${fmt(block.start)}–${fmt(block.end)}`
      })
    }
  }
  return out
}

/** Sessions in a plan can also collide with each other. */
export function findInternalConflicts(sessions: GoalSession[]): Conflict[] {
  const blocks: OccupiedBlock[] = sessions.map((s) => ({
    name: s.name,
    days: s.days,
    start: toMinutes(s.scheduledTime),
    end: toMinutes(s.scheduledTime) + s.targetMinutes
  }))
  const out: Conflict[] = []
  for (let i = 0; i < sessions.length; i++) {
    for (let j = i + 1; j < sessions.length; j++) {
      const found = findScheduleConflicts([sessions[i]!], [blocks[j]!])
      out.push(...found)
    }
  }
  return out
}

const DAY = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function describeConflict(c: Conflict): string {
  const days = c.days.map((d) => DAY[d]).join('/')
  return `"${c.session}" (${c.sessionRange}) overlaps "${c.against}" (${c.againstRange}) on ${days}`
}

/** Total minutes per week the plan's sessions add up to. */
export function weeklyMinutes(sessions: GoalSession[]): number {
  return sessions.reduce((sum, s) => sum + s.days.length * s.targetMinutes, 0)
}
