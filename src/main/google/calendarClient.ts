import { z } from 'zod'
import { ReauthRequired, type AuthService } from './authService'
import { GoogleApiError } from './tasksClient'

const BASE = 'https://www.googleapis.com/calendar/v3'

/**
 * Google Calendar API v3 — used for ONE job: delivering timed reminders to a phone.
 *
 * This app holds `calendar.app.created`, which grants access only to secondary
 * calendars the app itself creates. It cannot read or modify the user's own calendars,
 * and it never reads events back for completion — Google Calendar events have no
 * completion field, which is why Google Tasks remains the sole completion source.
 */

const CalendarSchema = z.object({
  id: z.string(),
  summary: z.string().optional().default(''),
  timeZone: z.string().optional()
})
export type GoogleCalendar = z.infer<typeof CalendarSchema>

const EventSchema = z.object({
  id: z.string(),
  etag: z.string().optional(),
  status: z.enum(['confirmed', 'tentative', 'cancelled']).optional().default('confirmed'),
  summary: z.string().optional().default(''),
  updated: z.string().optional()
})
export type GoogleEvent = z.infer<typeof EventSchema>

const EventsPageSchema = z.object({
  items: z.array(EventSchema).optional().default([]),
  nextPageToken: z.string().optional()
})

export interface EventDraft {
  summary: string
  description?: string
  /** RFC 3339 with offset, e.g. 2026-08-20T18:00:00+03:00 */
  startIso: string
  endIso: string
  timeZone: string
  reminderMinutes: number | null
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function calendarClient(deps: { auth: AuthService; maxRetries?: number }) {
  const { auth } = deps
  const maxRetries = deps.maxRetries ?? 4

  async function request(
    path: string,
    init: { method?: string; query?: Record<string, string | undefined>; body?: unknown } = {}
  ): Promise<unknown> {
    const url = new URL(BASE + path)
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, v)
    }

    let attempt = 0
    for (;;) {
      const token = await auth.accessToken()
      const res = await fetch(url, {
        method: init.method ?? 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body ? { 'content-type': 'application/json' } : {})
        },
        ...(init.body ? { body: JSON.stringify(init.body) } : {})
      })

      if (res.ok) return res.status === 204 ? {} : await res.json()

      const text = await res.text()
      if (res.status === 401) throw new ReauthRequired()

      const retryable = res.status === 429 || res.status >= 500
      if (!retryable || attempt >= maxRetries) {
        throw new GoogleApiError(res.status, `${res.status} ${text.slice(0, 300)}`, retryable)
      }

      const retryAfter = Number(res.headers.get('retry-after'))
      const backoff =
        Number.isFinite(retryAfter) && retryAfter > 0
          ? retryAfter * 1000
          : Math.min(30_000, 2 ** attempt * 500) + Math.random() * 400
      await sleep(backoff)
      attempt++
    }
  }

  function body(draft: EventDraft): Record<string, unknown> {
    return {
      summary: draft.summary,
      description: draft.description,
      start: { dateTime: draft.startIso, timeZone: draft.timeZone },
      end: { dateTime: draft.endIso, timeZone: draft.timeZone },
      // A popup override is what the Google Calendar mobile app turns into a timed
      // push notification. `useDefault: false` stops the calendar's own defaults from
      // adding a second, unwanted alert.
      reminders:
        draft.reminderMinutes === null
          ? { useDefault: false, overrides: [] }
          : {
              useDefault: false,
              overrides: [
                { method: 'popup', minutes: Math.min(40320, Math.max(0, draft.reminderMinutes)) }
              ]
            },
      transparency: 'transparent'
    }
  }

  return {
    /** Create the app's own secondary calendar. This is the only one it can touch. */
    async createCalendar(summary: string, timeZone: string): Promise<GoogleCalendar> {
      return CalendarSchema.parse(
        await request('/calendars', { method: 'POST', body: { summary, timeZone } })
      )
    },

    /** Rename the app's own calendar (used once, when the app itself was renamed). */
    async renameCalendar(calendarId: string, summary: string): Promise<GoogleCalendar> {
      return CalendarSchema.parse(
        await request(`/calendars/${encodeURIComponent(calendarId)}`, { method: 'PATCH', body: { summary } })
      )
    },

    async getCalendar(calendarId: string): Promise<GoogleCalendar | null> {
      try {
        return CalendarSchema.parse(
          await request(`/calendars/${encodeURIComponent(calendarId)}`)
        )
      } catch (err) {
        if (err instanceof GoogleApiError && (err.status === 404 || err.status === 403)) return null
        throw err
      }
    },

    async insertEvent(calendarId: string, draft: EventDraft): Promise<GoogleEvent> {
      return EventSchema.parse(
        await request(`/calendars/${encodeURIComponent(calendarId)}/events`, {
          method: 'POST',
          body: body(draft)
        })
      )
    },

    async patchEvent(
      calendarId: string,
      eventId: string,
      draft: EventDraft
    ): Promise<GoogleEvent> {
      return EventSchema.parse(
        await request(
          `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
          { method: 'PATCH', body: body(draft) }
        )
      )
    },

    async deleteEvent(calendarId: string, eventId: string): Promise<void> {
      try {
        await request(
          `/calendars/${encodeURIComponent(calendarId)}/events/${encodeURIComponent(eventId)}`,
          { method: 'DELETE' }
        )
      } catch (err) {
        // Already gone is a fine outcome.
        if (err instanceof GoogleApiError && (err.status === 404 || err.status === 410)) return
        throw err
      }
    },

    /** Events in a window — used to adopt orphans after a crash mid-create. */
    async listEvents(
      calendarId: string,
      timeMin: string,
      timeMax: string
    ): Promise<GoogleEvent[]> {
      const out: GoogleEvent[] = []
      let pageToken: string | undefined
      do {
        const page = EventsPageSchema.parse(
          await request(`/calendars/${encodeURIComponent(calendarId)}/events`, {
            query: { timeMin, timeMax, maxResults: '2500', singleEvents: 'true', pageToken }
          })
        )
        out.push(...page.items)
        pageToken = page.nextPageToken
      } while (pageToken)
      return out
    }
  }
}

export type CalendarClient = ReturnType<typeof calendarClient>
