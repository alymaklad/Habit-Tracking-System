import type { Habit, LocalTime } from '@shared/types'
import { formatDuration } from '../domain/time'

/**
 * Deciding which habit an incoming Google task belongs to.
 *
 * The Tasks API has no `extendedProperties`, so there is nowhere to hang an
 * application identifier except the task's own `notes`. The app writes a marker there
 * — and the same line doubles as genuinely useful text on your phone, because Google
 * Tasks can store neither a time of day nor a duration.
 *
 * Resolution order used by the syncer:
 *   1. the stored `google_task_id` on an occurrence  (definitive)
 *   2. the `[ahl:<habitId>]` marker in the notes     (survives a rename)
 *   3. normalised title + due date                   (last resort)
 */

export const MARKER_PREFIX = 'ahl'
const MARKER_RE = /\[ahl:(\d+)\]/i

export const APP_SIGNATURE = 'Adaptive Habit League'

/** The notes body written onto a provisioned task. */
export function buildNotes(habit: Pick<Habit, 'id' | 'targetMinutes'>, time: LocalTime): string {
  return `${time} · ${formatDuration(habit.targetMinutes)} target · ${APP_SIGNATURE} [${MARKER_PREFIX}:${habit.id}]`
}

/** The habit id embedded in a task's notes, if the app wrote them. */
export function habitIdFromNotes(notes: string | null | undefined): number | null {
  if (!notes) return null
  const m = MARKER_RE.exec(notes)
  if (!m?.[1]) return null
  const id = Number(m[1])
  return Number.isSafeInteger(id) && id > 0 ? id : null
}

/**
 * Title normalisation for the fallback match.
 *
 * Strips a trailing duration the user may have typed into the title themselves — the
 * brief's own examples look like "Study AI — 2 hours" — then folds case, punctuation
 * and whitespace so cosmetic edits do not orphan a mapping.
 */
const TRAILING_DURATION_RE =
  /[\s–—-]*\b\d+(?:[.,]\d+)?\s*(?:h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b\s*$/i

export function normaliseTitle(title: string | null | undefined): string {
  if (!title) return ''
  let t = title.trim()
  // Repeat: "Study AI — 2 hours 30 minutes" sheds one unit at a time.
  for (let i = 0; i < 3; i++) {
    const next = t.replace(TRAILING_DURATION_RE, '')
    if (next === t) break
    t = next.trim()
  }
  return t
    .toLowerCase()
    .replace(/[–—]/g, '-')
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** Did this app create the task? Used before deleting anything from the user's list. */
export function isAppOwned(notes: string | null | undefined): boolean {
  return habitIdFromNotes(notes) !== null
}

/** Minutes parsed out of a title like "Study AI — 2 hours", when present. */
export function durationFromTitle(title: string | null | undefined): number | null {
  if (!title) return null
  const m = /\b(\d+(?:[.,]\d+)?)\s*(h|hr|hrs|hour|hours|m|min|mins|minute|minutes)\b\s*$/i.exec(
    title.trim()
  )
  if (!m?.[1] || !m[2]) return null
  const value = Number(m[1].replace(',', '.'))
  if (!Number.isFinite(value) || value <= 0) return null
  const isHours = /^h/i.test(m[2])
  const minutes = Math.round(isHours ? value * 60 : value)
  return minutes > 0 && minutes <= 24 * 60 ? minutes : null
}
