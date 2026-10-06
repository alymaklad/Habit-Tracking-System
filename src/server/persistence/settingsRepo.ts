import { DEFAULT_SCORING, type AppSettings, type ScoringConfig, type ThemeMode } from '@shared/types'
import type { Db } from './db'

export const DEFAULT_SETTINGS: AppSettings = {
  displayName: '',
  // Replaced on first sign-in by the browser's own zone (see bootstrap).
  timezone: 'UTC',
  theme: 'light',
  syncIntervalMinutes: 5,
  provisionHorizonDays: 7,
  reduceMotion: false,
  notificationsEnabled: true,
  notifyUpcoming: true,
  notifyCompletion: true,
  notifyStreak: true,
  notifyWeeklyReview: true,
  defaultReminderLeadMinutes: 30,
  weeklyPointsTarget: 0,
  tourDone: false,
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

  // A repository lives for one request, and settings are read on nearly every path;
  // remember what this request has already read (and written) instead of asking again.
  const cache = new Map<string, string | null>()

  async function readRaw<T>(key: string, fallback: T): Promise<T> {
    let value = cache.get(key)
    if (value === undefined) {
      const row = (await get.get(key)) as { value: string } | undefined
      value = row?.value ?? null
      cache.set(key, value)
    }
    if (value === null) return fallback
    try {
      return JSON.parse(value) as T
    } catch {
      return fallback
    }
  }

  async function writeRaw(key: string, value: unknown): Promise<void> {
    const json = JSON.stringify(value)
    await put.run(key, json)
    cache.set(key, json)
  }

  return {
    async all(): Promise<AppSettings> {
      const stored = await readRaw<Partial<AppSettings>>('app', {})
      return {
        ...DEFAULT_SETTINGS,
        ...stored,
        // Nested objects are merged field-by-field so a new default lands for a user
        // whose stored settings predate it.
        scoring: { ...DEFAULT_SCORING, ...(stored.scoring ?? {}) },
        push: { ...DEFAULT_SETTINGS.push, ...(stored.push ?? {}) }
      }
    },

    async save(patch: Partial<AppSettings>): Promise<AppSettings> {
      const current = await this.all()
      const next: AppSettings = {
        ...current,
        ...patch,
        scoring: { ...current.scoring, ...(patch.scoring ?? {}) },
        push: { ...current.push, ...(patch.push ?? {}) }
      }
      await writeRaw('app', next)
      return next
    },

    async scoring(): Promise<ScoringConfig> {
      return (await this.all()).scoring
    },

    async timezone(): Promise<string> {
      return (await this.all()).timezone
    },

    async theme(): Promise<ThemeMode> {
      return (await this.all()).theme
    },

    /** Small scratch values that are not user-facing settings. */
    getFlag<T>(key: string, fallback: T): Promise<T> {
      return readRaw<T>(`flag:${key}`, fallback)
    },

    setFlag(key: string, value: unknown): Promise<void> {
      return writeRaw(`flag:${key}`, value)
    }
  }
}

export type SettingsRepo = ReturnType<typeof settingsRepo>
