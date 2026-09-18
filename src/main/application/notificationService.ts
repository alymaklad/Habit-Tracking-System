import type { AppSettings, NotificationChannel } from '@shared/types'
import type { PushRelay } from '../platform/pushRelay'

export type NotificationKind = 'upcoming' | 'completion' | 'streak' | 'weeklyReview' | 'achievement'

export interface Notice {
  kind: NotificationKind
  title: string
  body: string
  priority?: number
  tags?: string[]
}

/**
 * Fans one notification out to the channels the user has enabled.
 *
 * Channel responsibilities differ, and the split is not arbitrary:
 *  - `toast`    — native Windows notification. Desktop only; it cannot reach a phone.
 *  - `calendar` — handled by the event mirror, NOT here. Only "starts in N minutes"
 *                 can be expressed as a calendar reminder, and it must be written
 *                 ahead of time rather than fired at the moment.
 *  - `push`     — the relay, for everything the app decides for itself: streak alive,
 *                 weekly review ready, achievement unlocked. None of these has a
 *                 calendar equivalent.
 */
export function notificationService(deps: {
  settings: () => AppSettings
  push: PushRelay
  /** Injected so the service stays testable without an Electron runtime. */
  toast: (title: string, body: string) => void
  log?: (message: string) => void
}) {
  const { settings, push, toast } = deps

  function enabled(kind: NotificationKind): boolean {
    const s = settings()
    if (!s.notificationsEnabled) return false
    switch (kind) {
      case 'upcoming':
        return s.notifyUpcoming
      case 'completion':
        return s.notifyCompletion
      case 'streak':
        return s.notifyStreak
      case 'weeklyReview':
        return s.notifyWeeklyReview
      case 'achievement':
        return s.notifyCompletion
    }
  }

  function channels(): NotificationChannel[] {
    return settings().channels
  }

  async function deliver(notice: Notice): Promise<void> {
    if (!enabled(notice.kind)) return

    const active = channels()
    if (active.includes('toast')) {
      toast(notice.title, notice.body)
    }
    if (active.includes('push') && push.configured()) {
      await push.send({
        title: notice.title,
        body: notice.body,
        priority: notice.priority ?? 3,
        tags: notice.tags ?? []
      })
    }
  }

  return {
    deliver,

    upcoming(habitName: string, minutes: number): Promise<void> {
      return deliver({
        kind: 'upcoming',
        title: habitName,
        body: `Starts in ${minutes} minutes.`,
        priority: 4,
        tags: ['alarm_clock']
      })
    },

    completed(habitName: string, xp: number): Promise<void> {
      return deliver({
        kind: 'completion',
        title: `${habitName} completed`,
        body: `+${xp} XP`,
        priority: 3,
        tags: ['fire']
      })
    },

    streakAlive(days: number): Promise<void> {
      return deliver({
        kind: 'streak',
        title: `Your ${days}-day streak is alive`,
        body: 'Keep it going tomorrow.',
        priority: 3,
        tags: ['fire']
      })
    },

    streakAtRisk(habitName: string, days: number): Promise<void> {
      return deliver({
        kind: 'streak',
        title: `${days}-day streak at risk`,
        body: `${habitName} is still open today.`,
        priority: 4,
        tags: ['warning']
      })
    },

    weeklyReviewReady(weekLabel: string): Promise<void> {
      return deliver({
        kind: 'weeklyReview',
        title: 'Your weekly review is ready',
        body: `${weekLabel} is summarised and waiting.`,
        priority: 3,
        tags: ['bar_chart']
      })
    },

    achievementUnlocked(name: string): Promise<void> {
      return deliver({
        kind: 'achievement',
        title: 'Achievement unlocked',
        body: name,
        priority: 3,
        tags: ['trophy']
      })
    }
  }
}

export type NotificationService = ReturnType<typeof notificationService>
