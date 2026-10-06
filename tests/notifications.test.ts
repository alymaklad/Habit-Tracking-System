import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { AppSettings, HabitDraft, NotificationChannel } from '@shared/types'
import { freshDb } from './pg'
import { habitRepo } from '@server/persistence/habitRepo'
import { occurrenceRepo } from '@server/persistence/occurrenceRepo'
import { settingsRepo } from '@server/persistence/settingsRepo'
import { scheduleService } from '@server/application/scheduleService'
import { notificationService } from '@server/application/notificationService'
import { reminderScheduler, GRACE_MS } from '@server/application/reminderScheduler'
import { pushRelay } from '@server/platform/pushRelay'

// Thursday 20 August 2026. German is scheduled at 20:00 Cairo with a 30-minute lead,
// so its reminder is due at 19:30 Cairo = 16:30 UTC.
const TODAY = '2026-08-20'
const NOW_BEFORE = new Date('2026-08-20T12:00:00.000Z')

async function harness(overrides: Partial<AppSettings> = {}) {
  const db = await freshDb()

  const habits = habitRepo(db)
  const occurrences = occurrenceRepo(db)
  const settings = settingsRepo(db)
  await settings.save({
    timezone: 'Africa/Cairo',
    provisionHorizonDays: 7,
    defaultReminderLeadMinutes: 30,
    ...overrides
  })

  const schedule = scheduleService({ db, habits, occurrences, settings })

  const toasts: { title: string; body: string }[] = []
  const pushed: { title: string; body: string }[] = []

  const relay = pushRelay({ config: async () => (await settings.all()).push })
  const notifications = notificationService({
    settings: () => settings.all(),
    push: {
      ...relay,
      configured: async () => (await settings.all()).push.enabled,
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

let h: Awaited<ReturnType<typeof harness>>

beforeEach(async () => {
  vi.useRealTimers()
  h = await harness()
})

describe('notification channels', () => {
  it('sends a toast but no push when push is off', async () => {
    await h.notifications.streakAlive(6)
    expect(h.toasts).toHaveLength(1)
    expect(h.toasts[0]!.title).toContain('6-day streak')
    expect(h.pushed).toHaveLength(0)
  })

  it('sends to both channels when push is configured', async () => {
    await h.settings.save({
      channels: ['toast', 'push'],
      push: { enabled: true, server: 'https://ntfy.sh', topic: 'secret-topic' }
    })

    await h.notifications.streakAlive(6)

    expect(h.toasts).toHaveLength(1)
    expect(h.pushed).toHaveLength(1)
    expect(h.pushed[0]!.title).toContain('6-day streak')
  })

  it('sends nothing at all when notifications are switched off', async () => {
    await h.settings.save({ notificationsEnabled: false })
    await h.notifications.streakAlive(6)
    await h.notifications.completed('German', 15)
    await h.notifications.weeklyReviewReady('Aug 22–28')
    expect(h.toasts).toHaveLength(0)
    expect(h.pushed).toHaveLength(0)
  })

  it('honours each kind’s own switch independently', async () => {
    await h.settings.save({ notifyStreak: false, notifyWeeklyReview: true })

    await h.notifications.streakAlive(6)
    expect(h.toasts).toHaveLength(0)

    await h.notifications.weeklyReviewReady('Aug 22–28')
    expect(h.toasts).toHaveLength(1)
  })

  it('routes push-only when the user wants nothing on the desktop', async () => {
    await h.settings.save({
      channels: ['push'] as NotificationChannel[],
      push: { enabled: true, server: 'https://ntfy.sh', topic: 't' }
    })
    await h.notifications.completed('Coding', 20)
    expect(h.toasts).toHaveLength(0)
    expect(h.pushed).toHaveLength(1)
  })
})

describe('push relay', () => {
  it('reports itself unconfigured without a topic', async () => {
    const relay = pushRelay({
      config: async () => ({ enabled: true, server: 'https://ntfy.sh', topic: '   ' })
    })
    expect(await relay.configured()).toBe(false)
  })

  it('reports itself unconfigured when disabled', async () => {
    const relay = pushRelay({
      config: async () => ({ enabled: false, server: 'https://ntfy.sh', topic: 'abc' })
    })
    expect(await relay.configured()).toBe(false)
  })

  it('rejects a server that is not http(s)', async () => {
    const relay = pushRelay({
      config: async () => ({ enabled: true, server: 'ftp://nope', topic: 'abc' })
    })
    expect(await relay.configured()).toBe(false)
  })

  it('posts the title as a header and the message as the body', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const fetchMock = vi.fn(async (url: string | URL, init: RequestInit) => {
      calls.push({ url: String(url), init })
      return new Response('ok', { status: 200 })
    })
    vi.stubGlobal('fetch', fetchMock)

    const relay = pushRelay({
      config: async () => ({ enabled: true, server: 'https://ntfy.sh/', topic: 'my topic' })
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
      config: async () => ({ enabled: true, server: 'https://ntfy.sh', topic: 'abc' })
    })
    await expect(relay.send({ title: 'x', body: 'y' })).resolves.toBe(false)
    vi.unstubAllGlobals()
  })
})

describe('reminder scheduling', () => {
  it('knows which reminders are still to come, and when the next is due', async () => {
    await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW_BEFORE)

    expect(await h.reminders.pendingCount(NOW_BEFORE)).toBeGreaterThan(0)
    // 20:00 Cairo minus the default 30 minutes = 19:30 Cairo = 16:30 UTC.
    expect(await h.reminders.nextDueAt(NOW_BEFORE)).toBe('2026-08-20T16:30:00.000Z')
  })

  it('has nothing pending when upcoming reminders are switched off', async () => {
    await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW_BEFORE)
    await h.settings.save({ notifyUpcoming: false })

    expect(await h.reminders.pendingCount(NOW_BEFORE)).toBe(0)
    expect(await h.reminders.nextDueAt(NOW_BEFORE)).toBeNull()
  })

  it('shows nothing in the browser when the toast channel is not in use', async () => {
    await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW_BEFORE)
    // Mobile-only: the calendar mirror rings the phone, the browser stays quiet.
    await h.settings.save({ channels: ['calendar'] })

    await h.reminders.fireDue(new Date('2026-08-20T16:31:00.000Z'))
    expect(h.toasts).toHaveLength(0)
  })

  it('fires the reminder with the habit’s own lead time', async () => {
    await h.habits.create(draft({ reminderLeadMinutes: 15 }))
    await h.schedule.expandHorizon(NOW_BEFORE)
    const occ = (await h.occurrences.getByHabitDate(1, TODAY))!

    // 20:00 Cairo minus 15 minutes = 19:45 Cairo = 16:45 UTC.
    await h.reminders.fireNow(occ.id, new Date('2026-08-20T16:45:00.000Z'))

    expect(h.toasts).toHaveLength(1)
    expect(h.toasts[0]!.title).toBe('German')
    expect(h.toasts[0]!.body).toBe('Starts in 15 minutes.')
  })

  it('delivers at most once even if fired repeatedly', async () => {
    await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW_BEFORE)
    const occ = (await h.occurrences.getByHabitDate(1, TODAY))!
    const at = new Date('2026-08-20T16:30:00.000Z')

    for (let i = 0; i < 5; i++) await h.reminders.fireNow(occ.id, at)

    expect(h.toasts).toHaveLength(1)
    expect((await h.occurrences.get(occ.id))!.reminderSentAt).not.toBeNull()
  })

  it('drops a reminder the machine slept through', async () => {
    await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW_BEFORE)
    const occ = (await h.occurrences.getByHabitDate(1, TODAY))!

    // Woke up well past the grace window.
    const late = new Date(new Date('2026-08-20T16:30:00.000Z').getTime() + GRACE_MS + 60_000)
    await h.reminders.fireNow(occ.id, late)

    expect(h.toasts).toHaveLength(0)
    // Marked as handled so it cannot resurface on the next re-arm.
    expect((await h.occurrences.get(occ.id))!.reminderSentAt).not.toBeNull()
  })

  it('still fires inside the grace window', async () => {
    await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW_BEFORE)
    const occ = (await h.occurrences.getByHabitDate(1, TODAY))!

    const slightlyLate = new Date(new Date('2026-08-20T16:30:00.000Z').getTime() + 60_000)
    await h.reminders.fireNow(occ.id, slightlyLate)

    expect(h.toasts).toHaveLength(1)
  })

  it('does not remind about an already completed habit', async () => {
    await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW_BEFORE)
    const occ = (await h.occurrences.getByHabitDate(1, TODAY))!
    await h.occurrences.setStatus(occ.id, 'complete', '2026-08-20T15:00:00.000Z')

    await h.reminders.fireNow(occ.id, new Date('2026-08-20T16:30:00.000Z'))
    expect(h.toasts).toHaveLength(0)
  })

  it('does not remind about a justified skip', async () => {
    await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW_BEFORE)
    const occ = (await h.occurrences.getByHabitDate(1, TODAY))!
    await h.occurrences.setJustifiedSkip(occ.id, true, 'Travelling')

    await h.reminders.fireNow(occ.id, new Date('2026-08-20T16:30:00.000Z'))
    expect(h.toasts).toHaveLength(0)
  })

  it('does not remind about a paused habit', async () => {
    await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW_BEFORE)
    const occ = (await h.occurrences.getByHabitDate(1, TODAY))!
    await h.habits.setActive(1, false)

    await h.reminders.fireNow(occ.id, new Date('2026-08-20T16:30:00.000Z'))
    expect(h.toasts).toHaveLength(0)
  })

  it('delivers what is due exactly once, however many callers come by', async () => {
    await h.habits.create(draft())
    await h.schedule.expandHorizon(NOW_BEFORE)

    // Nothing is due at noon; then two overlapping heartbeats just after 16:30 UTC.
    expect(await h.reminders.fireDue(NOW_BEFORE)).toBe(0)
    const at = new Date('2026-08-20T16:31:00.000Z')
    expect(await h.reminders.fireDue(at)).toBe(1)
    expect(await h.reminders.fireDue(at)).toBe(0)
    expect(h.toasts).toHaveLength(1)
  })
})
