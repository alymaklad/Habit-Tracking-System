import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import type { HabitDraft } from '@shared/types'
import { migrate, type Db } from '@main/persistence/db'
import { MIGRATIONS } from '@main/persistence/migrations'
import { habitRepo } from '@main/persistence/habitRepo'
import { occurrenceRepo } from '@main/persistence/occurrenceRepo'
import { logRepo } from '@main/persistence/logRepo'
import { recordRepo } from '@main/persistence/recordRepo'
import { settingsRepo } from '@main/persistence/settingsRepo'
import { syncRepo } from '@main/persistence/syncRepo'

function freshDb(): Db {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  migrate(db)
  return db
}

const draft = (o: Partial<HabitDraft> = {}): HabitDraft => ({
  name: 'German',
  description: null,
  notes: null,
  recurrence: { kind: 'weekly', days: [1, 2, 3, 4, 5] },
  scheduledTime: '20:00',
  targetMinutes: 45,
  baselineMinutes: 20,
  difficultyLevel: 2,
  reminderLeadMinutes: 30,
  colorKey: 'violet',
  googleTasklistId: null,
  goalId: null,
  active: true,
  ...o
})

let db: Db

beforeEach(() => {
  db = freshDb()
})

describe('migrations', () => {
  it('creates the schema', () => {
    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
      .all()
      .map((r) => (r as { name: string }).name)
    expect(tables).toContain('habit')
    expect(tables).toContain('occurrence')
    expect(tables).toContain('daily_record')
    expect(tables).toContain('oauth_token')
  })

  it('is idempotent', () => {
    expect(() => migrate(db)).not.toThrow()
    expect(() => migrate(db)).not.toThrow()
    const n = db.prepare('SELECT COUNT(*) AS n FROM schema_migration').get() as { n: number }
    // Each migration applies exactly once, however many there are.
    expect(n.n).toBe(MIGRATIONS.length)
  })

  it('adds the calendar mirror columns', () => {
    const cols = (db.prepare('PRAGMA table_info(occurrence)').all() as { name: string }[]).map(
      (c) => c.name
    )
    expect(cols).toContain('google_event_id')
    expect(cols).toContain('event_etag')
  })
})

describe('habits', () => {
  it('round-trips a habit including its recurrence', () => {
    const repo = habitRepo(db)
    const h = repo.create(draft())
    expect(h.id).toBeGreaterThan(0)
    expect(h.recurrence).toEqual({ kind: 'weekly', days: [1, 2, 3, 4, 5] })
    expect(h.targetMinutes).toBe(45)
    expect(h.active).toBe(true)
  })

  it('updates without creating a second row', () => {
    const repo = habitRepo(db)
    const h = repo.create(draft())
    repo.update(h.id, { ...draft(), name: 'Deutsch', targetMinutes: 50 })
    expect(repo.list()).toHaveLength(1)
    expect(repo.get(h.id)!.name).toBe('Deutsch')
    expect(repo.get(h.id)!.targetMinutes).toBe(50)
  })

  it('pauses rather than deletes', () => {
    const repo = habitRepo(db)
    const h = repo.create(draft())
    repo.setActive(h.id, false)
    expect(repo.get(h.id)!.active).toBe(false)
    expect(repo.list()).toHaveLength(1)
    expect(repo.listActive()).toHaveLength(0)
  })
})

describe('occurrences are idempotent by (habit, date)', () => {
  it('never creates a duplicate for the same day', () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const h = habits.create(draft())

    for (let i = 0; i < 5; i++) occ.ensure(h.id, '2026-08-20', '20:00', 45)

    const rows = occ.listForHabit(h.id, '2026-08-20', '2026-08-20')
    expect(rows).toHaveLength(1)
  })

  it('refreshes schedule fields on a pending occurrence', () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const h = habits.create(draft())

    occ.ensure(h.id, '2026-08-20', '20:00', 45)
    occ.ensure(h.id, '2026-08-20', '21:00', 50)

    const row = occ.getByHabitDate(h.id, '2026-08-20')!
    expect(row.scheduledTime).toBe('21:00')
    expect(row.targetMinutes).toBe(50)
  })

  it('will not overwrite a completed occurrence', () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const h = habits.create(draft())

    occ.ensure(h.id, '2026-08-20', '20:00', 45)
    const before = occ.getByHabitDate(h.id, '2026-08-20')!
    occ.setStatus(before.id, 'complete', '2026-08-20T18:00:00.000Z')

    // A later schedule expansion must not reset a finished day.
    occ.ensure(h.id, '2026-08-20', '09:00', 15)

    const after = occ.getByHabitDate(h.id, '2026-08-20')!
    expect(after.status).toBe('complete')
    expect(after.scheduledTime).toBe('20:00')
    expect(after.targetMinutes).toBe(45)
  })

  it('rejects two occurrences claiming the same Google task', () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const h = habits.create(draft())

    occ.ensure(h.id, '2026-08-20', '20:00', 45)
    occ.ensure(h.id, '2026-08-21', '20:00', 45)
    const a = occ.getByHabitDate(h.id, '2026-08-20')!
    const b = occ.getByHabitDate(h.id, '2026-08-21')!

    occ.setProvision(a.id, 'created', 'gtask_abc', 'etag1', true)
    expect(() => occ.setProvision(b.id, 'created', 'gtask_abc', 'etag2', true)).toThrow()
  })

  it('finds an occurrence by its Google task id', () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const h = habits.create(draft())
    occ.ensure(h.id, '2026-08-20', '20:00', 45)
    const o = occ.getByHabitDate(h.id, '2026-08-20')!
    occ.setProvision(o.id, 'created', 'gtask_abc', 'etag1', true)

    expect(occ.getByGoogleTaskId('gtask_abc')!.id).toBe(o.id)
    expect(occ.getByGoogleTaskId('nope')).toBeNull()
  })

  it('preserves history when a task is deleted in Google', () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const h = habits.create(draft())
    occ.ensure(h.id, '2026-08-20', '20:00', 45)
    const o = occ.getByHabitDate(h.id, '2026-08-20')!
    occ.setStatus(o.id, 'complete', '2026-08-20T18:00:00.000Z')

    occ.softDelete(o.id)

    // Gone from active listings...
    expect(occ.listOnDate('2026-08-20')).toHaveLength(0)
    // ...but the row and its completion survive.
    const raw = occ.get(o.id)!
    expect(raw.deletedAt).not.toBeNull()
    expect(raw.status).toBe('complete')
  })

  it('reschedules a single day without duplicating', () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const h = habits.create(draft())
    occ.ensure(h.id, '2026-08-20', '20:00', 45)
    const o = occ.getByHabitDate(h.id, '2026-08-20')!

    occ.reschedule(o.id, '2026-08-21', '18:00')

    expect(occ.getByHabitDate(h.id, '2026-08-20')).toBeNull()
    expect(occ.getByHabitDate(h.id, '2026-08-21')!.id).toBe(o.id)
    expect(occ.listForHabit(h.id, '2026-08-01', '2026-08-31')).toHaveLength(1)
  })

  it('lists only unprovisioned occurrences of active habits', () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const a = habits.create(draft({ name: 'A' }))
    const b = habits.create(draft({ name: 'B', active: false }))

    occ.ensure(a.id, '2026-08-20', '20:00', 45)
    occ.ensure(b.id, '2026-08-20', '20:00', 45)

    const pending = occ.listUnprovisioned('2026-08-20', '2026-08-27')
    expect(pending).toHaveLength(1)
    expect(pending[0]!.habitId).toBe(a.id)
  })
})

describe('time logs', () => {
  it('accumulates timer minutes and reports provenance', () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const logs = logRepo(db)
    const h = habits.create(draft())
    occ.ensure(h.id, '2026-08-20', '20:00', 45)
    const o = occ.getByHabitDate(h.id, '2026-08-20')!

    logs.start(h.id, o.id, '2026-08-20T18:00:00.000Z')
    const minutes = logs.stop(o.id, '2026-08-20T18:27:00.000Z')

    expect(minutes).toBe(27)
    expect(logs.totalFor(o.id)).toEqual({ minutes: 27, origin: 'timer' })
  })

  it('counts a running timer toward the total', () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const logs = logRepo(db)
    const h = habits.create(draft())
    occ.ensure(h.id, '2026-08-20', '20:00', 45)
    const o = occ.getByHabitDate(h.id, '2026-08-20')!

    logs.start(h.id, o.id, '2026-08-20T18:00:00.000Z')
    const now = new Date('2026-08-20T18:12:00.000Z')
    expect(logs.totalFor(o.id, now).minutes).toBe(12)
    expect(logs.runningFor(o.id)).not.toBeNull()
  })

  it('lets measured minutes outrank assumed ones', () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const logs = logRepo(db)
    const h = habits.create(draft())
    occ.ensure(h.id, '2026-08-20', '20:00', 45)
    const o = occ.getByHabitDate(h.id, '2026-08-20')!

    logs.setAssumed(h.id, o.id, 45, '2026-08-20T18:00:00.000Z')
    expect(logs.totalFor(o.id).origin).toBe('assumed')

    logs.start(h.id, o.id, '2026-08-20T19:00:00.000Z')
    logs.stop(o.id, '2026-08-20T19:30:00.000Z')
    expect(logs.totalFor(o.id).origin).toBe('timer')
  })

  it('replaces rather than stacks assumed entries on repeated syncs', () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const logs = logRepo(db)
    const h = habits.create(draft())
    occ.ensure(h.id, '2026-08-20', '20:00', 45)
    const o = occ.getByHabitDate(h.id, '2026-08-20')!

    for (let i = 0; i < 4; i++) logs.setAssumed(h.id, o.id, 45, '2026-08-20T18:00:00.000Z')

    expect(logs.totalFor(o.id).minutes).toBe(45)
  })
})

describe('records', () => {
  it('upserts a daily record rather than duplicating it', () => {
    const habits = habitRepo(db)
    const records = recordRepo(db)
    const h = habits.create(draft())

    for (let i = 0; i < 3; i++) {
      records.putDaily({
        habitId: h.id, date: '2026-08-20', status: 'complete',
        points: 2, xp: 11, durationMinutes: 45, targetMinutes: 45, origin: 'timer'
      })
    }

    const rows = records.dailyOn('2026-08-20')
    expect(rows).toHaveLength(1)
    expect(records.totalXp()).toBe(11)
  })

  it('reflects a revert by recomputing, not by subtracting', () => {
    const habits = habitRepo(db)
    const records = recordRepo(db)
    const h = habits.create(draft())

    records.putDaily({
      habitId: h.id, date: '2026-08-20', status: 'complete',
      points: 2, xp: 11, durationMinutes: 45, targetMinutes: 45, origin: 'assumed'
    })
    expect(records.totalXp()).toBe(11)

    // The Google task is un-ticked; the recompute writes the new truth over the old.
    records.putDaily({
      habitId: h.id, date: '2026-08-20', status: 'missed',
      points: -1, xp: 0, durationMinutes: 0, targetMinutes: 45, origin: null
    })
    expect(records.totalXp()).toBe(0)
    expect(records.totalCompleted()).toBe(0)
  })

  it('unlocks an achievement only once', () => {
    const records = recordRepo(db)
    expect(records.unlockAchievement('streak_7', '2026-08-20T00:00:00.000Z')).toBe(true)
    expect(records.unlockAchievement('streak_7', '2026-08-21T00:00:00.000Z')).toBe(false)
    expect(records.unlockedAchievements().size).toBe(1)
  })

  it('only raises a personal record, never lowers it', () => {
    const records = recordRepo(db)
    records.putPersonalRecord('longest_streak', 12, '12 days', '2026-08-20')
    records.putPersonalRecord('longest_streak', 5, '5 days', '2026-08-25')
    const r = records.personalRecords().find((x) => x.kind === 'longest_streak')!
    expect(r.value).toBe(12)
    expect(r.display).toBe('12 days')
  })
})

describe('settings', () => {
  it('returns defaults before anything is saved', () => {
    const s = settingsRepo(db).all()
    expect(s.syncIntervalMinutes).toBe(5)
    expect(s.scoring.fullCompletion).toBe(2)
    expect(s.defaultReminderLeadMinutes).toBe(30)
  })

  it('merges a partial save over the defaults', () => {
    const repo = settingsRepo(db)
    repo.save({ syncIntervalMinutes: 15, scoring: { ...repo.scoring(), fullCompletion: 5 } })
    const s = repo.all()
    expect(s.syncIntervalMinutes).toBe(15)
    expect(s.scoring.fullCompletion).toBe(5)
    // Untouched values survive.
    expect(s.scoring.unjustifiedSkip).toBe(-1)
    expect(s.provisionHorizonDays).toBe(7)
  })
})

describe('sync state', () => {
  it('tracks the watermark per task list', () => {
    const repo = syncRepo(db)
    expect(repo.watermark('list-1')).toBeNull()
    repo.setWatermark('list-1', '2026-08-20T20:43:00.000Z')
    expect(repo.watermark('list-1')).toBe('2026-08-20T20:43:00.000Z')
  })

  it('counts consecutive failures and clears them on success', () => {
    const repo = syncRepo(db)
    repo.markFailure('list-1', 'network')
    repo.markFailure('list-1', 'network')
    expect(repo.state('list-1')!.failures).toBe(2)

    repo.markSuccess('list-1', '2026-08-20T20:48:00.000Z')
    expect(repo.state('list-1')!.failures).toBe(0)
    expect(repo.state('list-1')!.last_error).toBeNull()
  })

  it('queues outbound work and drains it', () => {
    const repo = syncRepo(db)
    repo.enqueue('patch', null, { status: 'completed' })
    repo.enqueue('patch', null, { status: 'needsAction' })
    expect(repo.queuedCount()).toBe(2)

    const [first] = repo.queued()
    repo.dequeue(first!.id)
    expect(repo.queuedCount()).toBe(1)
  })

  it('keeps the sync log bounded', () => {
    const repo = syncRepo(db)
    for (let i = 0; i < 520; i++) repo.log('info', `entry ${i}`)
    const n = db.prepare('SELECT COUNT(*) AS n FROM sync_log').get() as { n: number }
    expect(n.n).toBeLessThanOrEqual(500)
    expect(repo.recent(3)[0]!.message).toBe('entry 519')
  })
})
