import type { LocalDate } from '@shared/types'
import { localToInstant, todayIn } from '../domain/time'
import type { HabitRepo } from '../persistence/habitRepo'
import type { OccurrenceRepo } from '../persistence/occurrenceRepo'
import type { SettingsRepo } from '../persistence/settingsRepo'
import type { NotificationService } from './notificationService'

/** A reminder more than this far past due is dropped rather than fired late. */
export const GRACE_MS = 10 * 60_000
/** Timers longer than this are re-armed in stages; setTimeout overflows past ~24.8 days. */
const MAX_TIMER_MS = 6 * 60 * 60_000

/**
 * Desktop reminders.
 *
 * The mobile half of this is delivered by the calendar mirror, written ahead of time;
 * this half fires a Windows toast on the machine. Both are needed: the calendar event
 * rings the phone, this rings the desk.
 *
 * Three failure modes a background app has to survive, all handled here:
 *  - the app restarts, so timers are rebuilt from the database rather than kept in
 *    memory only;
 *  - the machine sleeps through a reminder, so a missed one fires only inside a grace
 *    window and is otherwise dropped, rather than arriving as a confusing burst;
 *  - a reminder could fire twice, so `reminder_sent_at` makes delivery at-most-once.
 */
export function reminderScheduler(deps: {
  habits: HabitRepo
  occurrences: OccurrenceRepo
  settings: SettingsRepo
  notifications: NotificationService
}) {
  const { habits, occurrences, settings, notifications } = deps

  const timers = new Map<number, NodeJS.Timeout>()

  function clearAll(): void {
    for (const t of timers.values()) clearTimeout(t)
    timers.clear()
  }

  function leadFor(habitId: number): number {
    const habit = habits.get(habitId)
    return habit?.reminderLeadMinutes ?? settings.all().defaultReminderLeadMinutes
  }

  /** When the reminder for an occurrence should fire, as epoch ms. */
  function dueAt(date: LocalDate, time: string, leadMinutes: number, tz: string): number {
    const start = new Date(localToInstant(date, time, tz)).getTime()
    return start - leadMinutes * 60_000
  }

  async function fire(occurrenceId: number, now: Date): Promise<void> {
    timers.delete(occurrenceId)

    const occ = occurrences.get(occurrenceId)
    if (!occ || occ.deletedAt || occ.reminderSentAt) return
    if (occ.completedAt || occ.justifiedSkip) return

    const habit = habits.get(occ.habitId)
    if (!habit?.active) return

    const lead = leadFor(occ.habitId)
    const at = dueAt(occ.date, occ.scheduledTime, lead, settings.timezone())
    if (now.getTime() - at > GRACE_MS) {
      // Too stale — the machine was probably asleep. Record it as sent so it does not
      // resurface, but do not shout about something that already started.
      occurrences.setReminderSent(occ.id, now.toISOString())
      return
    }

    occurrences.setReminderSent(occ.id, now.toISOString())
    await notifications.upcoming(habit.name, lead)
  }

  function arm(occurrenceId: number, delayMs: number, now: Date): void {
    const existing = timers.get(occurrenceId)
    if (existing) clearTimeout(existing)

    // setTimeout is unreliable over very long delays; re-arm in stages instead.
    if (delayMs > MAX_TIMER_MS) {
      const t = setTimeout(() => {
        timers.delete(occurrenceId)
        rearm(new Date())
      }, MAX_TIMER_MS)
      t.unref?.()
      timers.set(occurrenceId, t)
      return
    }

    const t = setTimeout(() => void fire(occurrenceId, new Date()), Math.max(0, delayMs))
    t.unref?.()
    timers.set(occurrenceId, t)
    void now
  }

  /**
   * Rebuild every pending timer from the database. Safe to call as often as you like —
   * on boot, after a sync, on wake, after a settings change.
   */
  function rearm(now: Date = new Date()): number {
    clearAll()

    const s = settings.all()
    if (!s.notificationsEnabled || !s.notifyUpcoming || !s.channels.includes('toast')) return 0

    const tz = s.timezone
    const today = todayIn(tz, now)
    // Today and tomorrow is enough; a later sync or the staged re-arm picks up the rest.
    const horizonEnd = new Date(now.getTime() + 36 * 60 * 60_000)

    let armed = 0
    for (const occ of occurrences.listInRange(today, todayIn(tz, horizonEnd))) {
      if (occ.reminderSentAt || occ.completedAt || occ.justifiedSkip || occ.deletedAt) continue
      const habit = habits.get(occ.habitId)
      if (!habit?.active) continue

      const at = dueAt(occ.date, occ.scheduledTime, leadFor(occ.habitId), tz)
      const delay = at - now.getTime()

      if (delay < -GRACE_MS) continue // long past; leave it alone
      arm(occ.id, delay, now)
      armed++
    }

    return armed
  }

  return {
    rearm,
    stop: clearAll,
    pendingCount: (): number => timers.size,
    /** Exposed for tests and for the "send a test notification" button. */
    fireNow: fire
  }
}

export type ReminderScheduler = ReturnType<typeof reminderScheduler>
