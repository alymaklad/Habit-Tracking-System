import { beforeEach, describe, expect, it, vi } from 'vitest'
import Database from 'better-sqlite3'
import type { AppSettings, HabitDraft, NotificationChannel } from '@shared/types'
import { migrate, type Db } from '@main/persistence/db'
import { habitRepo } from '@main/persistence/habitRepo'
import { occurrenceRepo } from '@main/persistence/occurrenceRepo'
import { settingsRepo } from '@main/persistence/settingsRepo'
import { scheduleService } from '@main/application/scheduleService'
import { notificationService } from '@main/application/notificationService'
import { reminderScheduler, GRACE_MS } from '@main/application/reminderScheduler'
import { pushRelay } from '@main/platform/pushRelay'

// Thursday 20 August 2026. German is scheduled at 20:00 Cairo with a 30-minute lead,
// so its reminder is due at 19:30 Cairo = 16:30 UTC.
const TODAY = '2026-08-20'
const NOW_BEFORE = new Date('2026-08-20T12:00:00.000Z')

function harness(overrides: Partial<AppSettings> = {}) {
  const db = new Database(':memory:') as Db
  db.pragma('foreign_keys = ON')
  migrate(db)

  const habits = habitRepo(db)
  const occurrences = occurrenceRepo(db)
  const settings = settingsRepo(db)
  settings.save({
    timezone: 'Africa/Cairo',
    provisionHorizonDays: 7,
    defaultReminderLeadMinutes: 30,
    ...overrides
  })

  const schedule = scheduleService({ db, habits, occurrences, settings })

  const toasts: { title: string; body: string }[] = []
  const pushed: { title: string; body: string }[] = []

  const relay = pushRelay({ config: () => settings.all().push })
  const notifications = notificationService({
    settings: () => settings.all(),
    push: {
      ...relay,
      configured: () => settings.all().push.enabled,
      send: async (m) => {
        pushed.push({ title: m.title, body: m.body })
        return true
      }
    },
    toast: (title, body) => toasts.push({ title, body })
  })

  const reminders = reminderScheduler({ habits, occurrences, settings, notifications })

  return { db, habits, occurrences, settings, schedule, notifications, reminders, toasts, pushed }
}

const draft = (o: Partial<HabitDraft> = {}): HabitDraft => ({
  name: 'German',
  description: null,
  notes: null,
  recurrence: { kind: 'weekly', days: [1, 2, 3, 4, 5, 6, 7] },
  scheduledTime: '20:00',
  targetMinutes: 45,
  baselineMinutes: 20,
  difficultyLevel: 2,
  reminderLeadMinutes: null,
  colorKey: 'violet',
  googleTasklistId: null,
  goalId: null,
  active: true,
  ...o
})

let h: ReturnType<typeof harness>

beforeEach(() => {
  vi.useRealTimers()
  h = harness()
})

describe('notification channels', () => {
  it('sends a toast but no push when push is off', async () => {
    await h.notifications.streakAlive(6)
    expect(h.toasts).toHaveLength(1)
    expect(h.toasts[0]!.title).toContain('6-day streak')
    expect(h.pushed).toHaveLength(0)
  })

  it('sends to both channels when push is configured', async () => {
    h.settings.save({
      channels: ['toast', 'push'],
      push: { enabled: true, server: 'https://ntfy.sh', topic: 'secret-topic' }
    })

    await h.notifications.streakAlive(6)

    expect(h.toasts).toHaveLength(1)
    expect(h.pushed).toHaveLength(1)
    expect(h.pushed[0]!.title).toContain('6-day streak')
  })

  it('sends nothing at all when notifications are switched off', async () => {
    h.settings.save({ notificationsEnabled: false })
    await h.notifications.streakAlive(6)
    await h.notifications.completed('German', 15)
    await h.notifications.weeklyReviewReady('Aug 22–28')
    expect(h.toasts).toHaveLength(0)
    expect(h.pushed).toHaveLength(0)
  })

  it('honours each kind’s own switch independently', async () => {
    h.settings.save({ notifyStreak: false, notifyWeeklyReview: true })

    await h.notifications.streakAlive(6)
    expect(h.toasts).toHaveLength(0)

    await h.notifications.weeklyReviewReady('Aug 22–28')
    expect(h.toasts).toHaveLength(1)
  })

  it('routes push-only when the user wants nothing on the desktop', async () => {
    h.settings.save({
      channels: ['push'] as NotificationChannel[],
      push: { enabled: true, server: 'https://ntfy.sh', topic: 't' }
    })
    await h.notifications.completed('Coding', 20)
    expect(h.toasts).toHaveLength(0)
    expect(h.pushed).toHaveLength(1)
  })
})

describe('push relay', () => {
  it('reports itself unconfigured without a topic', () => {
    const relay = pushRelay({
      config: () => ({ enabled: true, server: 'https://ntfy.sh', topic: '   ' })
    })
    expect(relay.configured()).toBe(false)
  })

  it('reports itself unconfigured when disabled', () => {
    const relay = pushRelay({
      config: () => ({ enabled: false, server: 'https://ntfy.sh', topic: 'abc' })
    })
    expect(relay.configured()).toBe(false)
  })

  it('rejects a server that is not http(s)', () => {
    const relay = pushRelay({
      config: () => ({ enabled: true, server: 'ftp://nope', topic: 'abc' })
    })
    expect(relay.configured()).toBe(false)
  })

  it('posts the title as a header and the message as the body', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetchMock = vi.fn(async (url: string | URL, init: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response('ok', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const relay = pushRelay({
      config: () => ({ enabled: true, server: 'https://ntfy.sh/', topic: 'my topic' })
    })
    const ok = await relay.send({ title: 'Streak', body: '6 days', priority: 4, tags: ['fire'] })

    expect(ok).toBe(true)
    expect(calls[0]!.url).toBe('https://ntfy.sh/my%20topic')
    const headers = calls[0]!.init.headers as Record<string, string>
    expect(headers.Title).toBe('Streak')
    expect(headers.Priority).toBe('4')
    expect(headers.Tags).toBe('fire')
    expect(calls[0]!.init.body).toBe('6 days')

    vi.unstubAllGlobals()
  })

  it('never throws when the relay is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('ENOTFOUND') }))
    const relay = pushRelay({
      config: () => ({ enabled: true, server: 'https://ntfy.sh', topic: 'abc' })
    })
    await expect(relay.send({ title: 'x', body: 'y' })).resolves.toBe(false)
    vi.unstubAllGlobals()
  })
})

describe('reminder scheduling', () => {
  it('arms a timer for each upcoming occurrence', () => {
    h.habits.create(draft())
    h.schedule.expandHorizon(NOW_BEFORE)

    const armed = h.reminders.rearm(NOW_BEFORE)

    expect(armed).toBeGreaterThan(0)
    expect(h.reminders.pendingCount()).toBe(armed)
    h.reminders.stop()
  })

  it('arms nothing when desktop reminders are switched off', () => {
    h.habits.create(draft())
    h.schedule.expandHorizon(NOW_BEFORE)
    h.settings.save({ notifyUpcoming: false })

    expect(h.reminders.rearm(NOW_BEFORE)).toBe(0)
  })

  it('arms nothing when the toast channel is not in use', () => {
    h.habits.create(draft())
    h.schedule.expandHorizon(NOW_BEFORE)
    // Mobile-only: the calendar mirror rings the phone, the desktop stays quiet.
    h.settings.save({ channels: ['calendar'] })

    expect(h.reminders.rearm(NOW_BEFORE)).toBe(0)
  })

  it('fires the reminder with the habit’s own lead time', async () => {
    h.habits.create(draft({ reminderLeadMinutes: 15 }))
    h.schedule.expandHorizon(NOW_BEFORE)
    const occ = h.occurrences.getByHabitDate(1, TODAY)!

    // 20:00 Cairo minus 15 minutes = 19:45 Cairo = 16:45 UTC.
    await h.reminders.fireNow(occ.id, new Date('2026-08-20T16:45:00.000Z'))

    expect(h.toasts).toHaveLength(1)
    expect(h.toasts[0]!.title).toBe('German')
    expect(h.toasts[0]!.body).toBe('Starts in 15 minutes.')
  })

  it('delivers at most once even if fired repeatedly', async () => {
    h.habits.create(draft())
    h.schedule.expandHorizon(NOW_BEFORE)
    const occ = h.occurrences.getByHabitDate(1, TODAY)!
    const at = new Date('2026-08-20T16:30:00.000Z')

    for (let i = 0; i < 5; i++) await h.reminders.fireNow(occ.id, at)

    expect(h.toasts).toHaveLength(1)
    expect(h.occurrences.get(occ.id)!.reminderSentAt).not.toBeNull()
  })

  it('drops a reminder the machine slept through', async () => {
    h.habits.create(draft())
    h.schedule.expandHorizon(NOW_BEFORE)
    const occ = h.occurrences.getByHabitDate(1, TODAY)!

    // Woke up well past the grace window.
    const late = new Date(new Date('2026-08-20T16:30:00.000Z').getTime() + GRACE_MS + 60_000)
    await h.reminders.fireNow(occ.id, late)

    expect(h.toasts).toHaveLength(0)
    // Marked as handled so it cannot resurface on the next re-arm.
    expect(h.occurrences.get(occ.id)!.reminderSentAt).not.toBeNull()
  })

  it('still fires inside the grace window', async () => {
    h.habits.create(draft())
    h.schedule.expandHorizon(NOW_BEFORE)
    const occ = h.occurrences.getByHabitDate(1, TODAY)!

    const slightlyLate = new Date(new Date('2026-08-20T16:30:00.000Z').getTime() + 60_000)
    await h.reminders.fireNow(occ.id, slightlyLate)

    expect(h.toasts).toHaveLength(1)
  })

  it('does not remind about an already completed habit', async () => {
    h.habits.create(draft())
    h.schedule.expandHorizon(NOW_BEFORE)
    const occ = h.occurrences.getByHabitDate(1, TODAY)!
    h.occurrences.setStatus(occ.id, 'complete', '2026-08-20T15:00:00.000Z')

    await h.reminders.fireNow(occ.id, new Date('2026-08-20T16:30:00.000Z'))
    expect(h.toasts).toHaveLength(0)
  })

  it('does not remind about a justified skip', async () => {
    h.habits.create(draft())
    h.schedule.expandHorizon(NOW_BEFORE)
    const occ = h.occurrences.getByHabitDate(1, TODAY)!
    h.occurrences.setJustifiedSkip(occ.id, true, 'Travelling')

    await h.reminders.fireNow(occ.id, new Date('2026-08-20T16:30:00.000Z'))
    expect(h.toasts).toHaveLength(0)
  })

  it('does not remind about a paused habit', async () => {
    h.habits.create(draft())
    h.schedule.expandHorizon(NOW_BEFORE)
    const occ = h.occurrences.getByHabitDate(1, TODAY)!
    h.habits.setActive(1, false)

    await h.reminders.fireNow(occ.id, new Date('2026-08-20T16:30:00.000Z'))
    expect(h.toasts).toHaveLength(0)
  })

  it('rebuilds its timers from the database, so a restart loses nothing', () => {
    h.habits.create(draft())
    h.schedule.expandHorizon(NOW_BEFORE)

    const first = h.reminders.rearm(NOW_BEFORE)
    h.reminders.stop()
    expect(h.reminders.pendingCount()).toBe(0)

    // A fresh scheduler over the same database arms the same set.
    const second = h.reminders.rearm(NOW_BEFORE)
    expect(second).toBe(first)
    h.reminders.stop()
  })
})
