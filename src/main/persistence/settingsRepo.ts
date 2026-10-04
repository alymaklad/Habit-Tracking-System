import { DEFAULT_SCORING, type AppSettings, type ScoringConfig, type ThemeMode } from '@shared/types'
import type { Db } from './db'

export const DEFAULT_SETTINGS: AppSettings = {
  displayName: '',
  timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
  theme: 'light',
  syncIntervalMinutes: 5,
  provisionHorizonDays: 7,
  startWithWindows: false,
  minimiseToTray: true,
  reduceMotion: false,
  notificationsEnabled: true,
  notifyUpcoming: true,
  notifyCompletion: true,
  notifyStreak: true,
  notifyWeeklyReview: true,
  defaultReminderLeadMinutes: 30,
  weeklyPointsTarget: 0,
  channels: ['toast', 'calendar'],
  calendarMirrorEnabled: true,
  push: { enabled: false, server: 'https://ntfy.sh', topic: '' },
  scoring: DEFAULT_SCORING
}

export function settingsRepo(db: Db) {
  const get = db.prepare('SELECT value FROM settings WHERE key = ?')
  const put = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value'
  )

  function readRaw<T>(key: string, fallback: T): T {
    const row = get.get(key) as { value: string } | undefined
    if (!row) return fallback
    try {
      return JSON.parse(row.value) as T
    } catch {
      return fallback
    }
  }

  return {
    all(): AppSettings {
      const stored = readRaw<Partial<AppSettings>>('app', {})
      return {
        ...DEFAULT_SETTINGS,
        ...stored,
        // Nested objects are merged field-by-field so a new default lands for a user
        // whose stored settings predate it.
        scoring: { ...DEFAULT_SCORING, ...(stored.scoring ?? {}) },
        push: { ...DEFAULT_SETTINGS.push, ...(stored.push ?? {}) }
      }
    },

    save(patch: Partial<AppSettings>): AppSettings {
      const current = this.all()
      const next: AppSettings = {
        ...current,
        ...patch,
        scoring: { ...current.scoring, ...(patch.scoring ?? {}) },
        push: { ...current.push, ...(patch.push ?? {}) }
      }
      put.run('app', JSON.stringify(next))
      return next
    },

    scoring(): ScoringConfig {
      return this.all().scoring
    },

    timezone(): string {
      return this.all().timezone
    },

    theme(): ThemeMode {
      return this.all().theme
    },

    /**
     * `save()` persists the whole blob, so the old dark default is stored for anyone who
     * ever saved a setting. The Khatwa design is light paper; move them over once.
     */
    adoptKhatwaTheme(): void {
      if (this.getFlag('khatwaThemeAdopted', false)) return
      if (this.all().theme === 'dark') this.save({ theme: 'light' })
      this.setFlag('khatwaThemeAdopted', true)
    },

    /** Small scratch values that are not user-facing settings. */
    getFlag<T>(key: string, fallback: T): T {
      return readRaw<T>(`flag:${key}`, fallback)
    },

    setFlag(key: string, value: unknown): void {
      put.run(`flag:${key}`, JSON.stringify(value))
    }
  }
}

export type SettingsRepo = ReturnType<typeof settingsRepo>
