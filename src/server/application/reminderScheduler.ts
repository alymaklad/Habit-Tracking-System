import type { LocalDate, Occurrence } from '@shared/types'
import { localToInstant, todayIn } from '../domain/time'
import type { HabitRepo } from '../persistence/habitRepo'
import type { OccurrenceRepo } from '../persistence/occurrenceRepo'
import type { SettingsRepo } from '../persistence/settingsRepo'
import type { NotificationService } from './notificationService'

/**
 * "German starts in 30 minutes."
 *
 * There is no long-running process to hold a timer per occurrence, so reminders are
 * polled instead: whoever comes by — the open app every minute, the cron — calls
 * `fireDue`, which sends each reminder whose moment has arrived and stamps it sent.
 *
 * Two rules carried over from the timer version:
 *  - `reminder_sent_at` makes delivery exactly-once, however many callers overlap.
 *  - A reminder found more than GRACE_MS late is marked sent WITHOUT being shown; telling
 *    someone their session starts in 30 minutes when it started an hour ago helps no one.
 */

export const GRACE_MS = 10 * 60_000

export function reminderScheduler(deps: {
  habits: HabitRepo
  occurrences: OccurrenceRepo
  settings: SettingsRepo
  notifications: NotificationService
}) {
  const { habits, occurrences, settings, notifications } = deps

  async function leadFor(habitId: number): Promise<number> {
    const habit = await habits.get(habitId)
    return habit?.reminderLeadMinutes ?? (await settings.all()).defaultReminderLeadMinutes
  }

  function dueAt(date: LocalDate, time: string, leadMinutes: number, tz: string): number {
    const start = new Date(localToInstant(date, time, tz)).getTime()
    return start - leadMinutes * 60_000
  }

  const settled = (o: Occurrence): boolean => Boolean(o.reminderSentAt || o.completedAt || o.justifiedSkip || o.deletedAt)

  /** Deliver one occurrence's reminder if it is still wanted. */
  async function fire(occurrenceId: number, now: Date): Promise<boolean> {
    const occ = await occurrences.get(occurrenceId)
    if (!occ || settled(occ)) return false

    const habit = await habits.get(occ.habitId)
    if (!habit?.active) return false

    const lead = await leadFor(occ.habitId)
    const at = dueAt(occ.date, occ.scheduledTime, lead, await settings.timezone())
    await occurrences.setReminderSent(occ.id, now.toISOString())
    if (now.getTime() - at > GRACE_MS) return false

    await notifications.upcoming(habit.name, lead)
    return true
  }

  /** Occurrences from today through the next day and a half that still need a reminder. */
  async function candidates(now: Date): Promise<{ occ: Occurrence; at: number }[]> {
    const s = await settings.all()
    if (!s.notificationsEnabled || !s.notifyUpcoming) return []
    const tz = s.timezone
    const horizonEnd = new Date(now.getTime() + 36 * 60 * 60_000)
    const out: { occ: Occurrence; at: number }[] = []
    for (const occ of await occurrences.listInRange(todayIn(tz, now), todayIn(tz, horizonEnd))) {
      if (settled(occ)) continue
      const habit = await habits.get(occ.habitId)
      if (!habit?.active) continue
      out.push({ occ, at: dueAt(occ.date, occ.scheduledTime, await leadFor(occ.habitId), tz) })
    }
    return out
  }

  return {
    /** Sends every reminder whose time has come. Returns how many were shown. */
    async fireDue(now: Date = new Date()): Promise<number> {
      let shown = 0
      for (const { occ, at } of await candidates(now)) {
        if (at <= now.getTime() && (await fire(occ.id, now))) shown++
      }
      return shown
    },

    /** The next moment a reminder falls due, so the open app knows when to look again. */
    async nextDueAt(now: Date = new Date()): Promise<string | null> {
      const future = (await candidates(now)).map((c) => c.at).filter((t) => t > now.getTime() - GRACE_MS)
      return future.length ? new Date(Math.max(now.getTime(), Math.min(...future))).toISOString() : null
    },

    /** How many reminders are still to come in the next day and a half. */
    async pendingCount(now: Date = new Date()): Promise<number> {
      return (await candidates(now)).filter((c) => c.at - now.getTime() >= -GRACE_MS).length
    },

    fireNow: fire
  }
}

export type ReminderScheduler = ReturnType<typeof reminderScheduler>
