import { DateTime } from 'luxon'
import type { Habit, LocalDate, Occurrence } from '@shared/types'
import type { CalendarClient, EventDraft } from '../google/calendarClient'
import type { HabitRepo } from '../persistence/habitRepo'
import type { OccurrenceRepo } from '../persistence/occurrenceRepo'
import type { SettingsRepo } from '../persistence/settingsRepo'
import type { SyncRepo } from '../persistence/syncRepo'

export const MIRROR_CALENDAR_TITLE = 'Khatwa'
/** The calendar's name before the app was renamed; such a calendar is renamed, not replaced. */
const LEGACY_CALENDAR_TITLE = 'Adaptive Habit League'
const CALENDAR_FLAG = 'mirrorCalendarId'

/**
 * Mirrors each scheduled occurrence onto the app's own Google calendar, purely so a
 * phone can ring.
 *
 * Why this exists: Google Tasks notifications are Google Calendar notifications
 * underneath, and a date-only task becomes an all-day entry that fires no timed push.
 * The Tasks API cannot write a time. A timed calendar event carrying a popup reminder
 * is the only native way to deliver "German starts in 30 minutes" to mobile.
 *
 * What this is NOT: a completion source. Calendar events have no completion field.
 * Nothing here is ever read back to decide whether a habit was done — that comes only
 * from the Google Task.
 */
export function eventMirror(deps: {
  habits: HabitRepo
  occurrences: OccurrenceRepo
  settings: SettingsRepo
  sync: SyncRepo
  calendar: CalendarClient
}) {
  const { habits, occurrences, settings, sync, calendar } = deps

  async function resolveCalendarId(): Promise<string> {
    const stored = await settings.getFlag<string | null>(CALENDAR_FLAG, null)
    if (stored) {
      // Confirm it still exists — the user may have deleted it from the Calendar UI.
      const found = await calendar.getCalendar(stored)
      if (found) {
        if (found.summary === LEGACY_CALENDAR_TITLE) {
          // Best effort: a failed rename leaves a working calendar with the old name.
          await calendar
            .renameCalendar(stored, MIRROR_CALENDAR_TITLE)
            .then(() => sync.log('info', `Renamed reminder calendar to "${MIRROR_CALENDAR_TITLE}"`))
            .catch((err: unknown) => sync.log('warn', `Could not rename the reminder calendar: ${err instanceof Error ? err.message : String(err)}`))
        }
        return stored
      }
      await settings.setFlag(CALENDAR_FLAG, null)
    }

    const tz = await settings.timezone()
    const created = await calendar.createCalendar(MIRROR_CALENDAR_TITLE, tz)
    await settings.setFlag(CALENDAR_FLAG, created.id)
    await sync.log('info', `Created reminder calendar "${MIRROR_CALENDAR_TITLE}"`)
    return created.id
  }

  async function draftFor(habit: Habit, occ: Occurrence): Promise<EventDraft> {
    const tz = await settings.timezone()
    const lead = habit.reminderLeadMinutes ?? (await settings.all()).defaultReminderLeadMinutes

    const [h, m] = occ.scheduledTime.split(':').map(Number)
    const start = DateTime.fromISO(occ.date, { zone: tz }).set({
      hour: h ?? 0,
      minute: m ?? 0,
      second: 0,
      millisecond: 0
    })
    const end = start.plus({ minutes: Math.max(5, occ.targetMinutes) })

    return {
      summary: habit.name,
      description: `${occ.targetMinutes} minute target · tracked by ${MIRROR_CALENDAR_TITLE}. Tick the matching Google Task to complete it.`,
      startIso: start.toISO({ suppressMilliseconds: true })!,
      endIso: end.toISO({ suppressMilliseconds: true })!,
      timeZone: tz,
      reminderMinutes: (await settings.all()).notifyUpcoming ? lead : null
    }
  }

  return {
    resolveCalendarId,

    async calendarId(): Promise<string | null> {
      return settings.getFlag<string | null>(CALENDAR_FLAG, null)
    },

    /** Create the missing mirror events in a window. Idempotent by `google_event_id`. */
    async mirror(from: LocalDate, to: LocalDate): Promise<{ created: number }> {
      if (!(await settings.all()).calendarMirrorEnabled) return { created: 0 }

      const pending = await occurrences.listUnmirrored(from, to)
      if (pending.length === 0) return { created: 0 }

      const calendarId = await resolveCalendarId()
      let created = 0

      for (const occ of pending) {
        const habit = await habits.get(occ.habitId)
        if (!habit) continue
        try {
          const event = await calendar.insertEvent(calendarId, (await draftFor(habit, occ)))
          await occurrences.setEvent(occ.id, event.id, event.etag ?? null)
          created++
        } catch (err) {
          // A reminder that fails to mirror must never fail the sync — the habit still
          // works, it just will not ring on the phone.
          await sync.log(
            'warn',
            `Could not mirror "${habit.name}" on ${occ.date}: ${err instanceof Error ? err.message : String(err)}`
          )
          break
        }
      }

      if (created > 0) await sync.log('info', `Mirrored ${created} reminder event(s) to your calendar`)
      return { created }
    },

    /** Push a changed time, duration or reminder lead to an existing mirror event. */
    async update(occurrenceId: number): Promise<void> {
      if (!(await settings.all()).calendarMirrorEnabled) return
      const occ = await occurrences.get(occurrenceId)
      if (!occ?.googleEventId) return
      const habit = await habits.get(occ.habitId)
      if (!habit) return

      const calendarId = await resolveCalendarId()
      try {
        const event = await calendar.patchEvent(calendarId, occ.googleEventId, (await draftFor(habit, occ)))
        await occurrences.setEvent(occ.id, event.id, event.etag ?? null)
      } catch (err) {
        await sync.log(
          'warn',
          `Could not update reminder for "${habit.name}": ${err instanceof Error ? err.message : String(err)}`
        )
      }
    },

    /** Remove a mirror event — used when an occurrence is descheduled or deleted. */
    async remove(occurrenceId: number): Promise<void> {
      const occ = await occurrences.get(occurrenceId)
      if (!occ?.googleEventId) return
      const calendarId = await this.calendarId()
      if (!calendarId) return
      try {
        await calendar.deleteEvent(calendarId, occ.googleEventId)
      } catch {
        // Deleting a reminder is best-effort; the local row is authoritative.
      }
      await occurrences.setEvent(occ.id, null, null)
    },

    /** Drop every mirrored event, e.g. when the user turns the feature off. */
    async removeAll(from: LocalDate, to: LocalDate): Promise<number> {
      const calendarId = await this.calendarId()
      if (!calendarId) return 0
      const mirrored = await occurrences.listMirrored(from, to)
      let removed = 0
      for (const occ of mirrored) {
        if (!occ.googleEventId) continue
        try {
          await calendar.deleteEvent(calendarId, occ.googleEventId)
          removed++
        } catch {
          // ignore
        }
        await occurrences.setEvent(occ.id, null, null)
      }
      return removed
    }
  }
}

export type EventMirror = ReturnType<typeof eventMirror>
