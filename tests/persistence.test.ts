import { beforeEach, describe, expect, it } from 'vitest'
import type { HabitDraft } from '@shared/types'
import { useSchema, type Db } from '@server/persistence/db'
import { freshDb, testDriver } from './pg'
import { MIGRATIONS } from '@server/persistence/migrations'
import { habitRepo } from '@server/persistence/habitRepo'
import { occurrenceRepo } from '@server/persistence/occurrenceRepo'
import { logRepo } from '@server/persistence/logRepo'
import { recordRepo } from '@server/persistence/recordRepo'
import { settingsRepo } from '@server/persistence/settingsRepo'
import { syncRepo } from '@server/persistence/syncRepo'

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

beforeEach(async () => {
  db = await freshDb()
})

describe('migrations', () => {
  it('creates the schema', async () => {
    const tables = (
      await db.prepare("SELECT table_name AS name FROM information_schema.tables WHERE table_schema = 'test' ORDER BY 1").all()
    ).map((r) => (r as { name: string }).name)
    expect(tables).toContain('habit')
    expect(tables).toContain('occurrence')
    expect(tables).toContain('daily_record')
    expect(tables).toContain('oauth_token')
  })

  it('is idempotent', async () => {
    await useSchema(testDriver(), 'test')
    await useSchema(testDriver(), 'test')
    const n = (await db.prepare('SELECT COUNT(*) AS n FROM schema_migration').get()) as { n: number }
    // Each migration applies exactly once, however many there are.
    expect(n.n).toBe(MIGRATIONS.length)
  })

  it('adds the calendar mirror columns', async () => {
    const cols = (
      (await db
        .prepare("SELECT column_name AS name FROM information_schema.columns WHERE table_schema = 'test' AND table_name = 'occurrence'")
        .all()) as { name: string }[]
    ).map((c) => c.name)
    expect(cols).toContain('google_event_id')
    expect(cols).toContain('event_etag')
  })
})

describe('habits', () => {
  it('round-trips a habit including its recurrence', async () => {
    const repo = habitRepo(db)
    const h = await repo.create(draft())
    expect(h.id).toBeGreaterThan(0)
    expect(h.recurrence).toEqual({ kind: 'weekly', days: [1, 2, 3, 4, 5] })
    expect(h.targetMinutes).toBe(45)
    expect(h.active).toBe(true)
  })

  it('updates without creating a second row', async () => {
    const repo = habitRepo(db)
    const h = await repo.create(draft())
    await repo.update(h.id, { ...draft(), name: 'Deutsch', targetMinutes: 50 })
    expect(await repo.list()).toHaveLength(1)
    expect((await repo.get(h.id))!.name).toBe('Deutsch')
    expect((await repo.get(h.id))!.targetMinutes).toBe(50)
  })

  it('pauses rather than deletes', async () => {
    const repo = habitRepo(db)
    const h = await repo.create(draft())
    await repo.setActive(h.id, false)
    expect((await repo.get(h.id))!.active).toBe(false)
    expect(await repo.list()).toHaveLength(1)
    expect(await repo.listActive()).toHaveLength(0)
  })
})

describe('occurrences are idempotent by (habit, date)', () => {
  it('never creates a duplicate for the same day', async () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const h = await habits.create(draft())

    for (let i = 0; i < 5; i++) (await occ.ensure(h.id, '2026-08-20', '20:00', 45))

    const rows = await occ.listForHabit(h.id, '2026-08-20', '2026-08-20')
    expect(rows).toHaveLength(1)
  })

  it('refreshes schedule fields on a pending occurrence', async () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const h = await habits.create(draft())

    await occ.ensure(h.id, '2026-08-20', '20:00', 45)
    await occ.ensure(h.id, '2026-08-20', '21:00', 50)

    const row = (await occ.getByHabitDate(h.id, '2026-08-20'))!
    expect(row.scheduledTime).toBe('21:00')
    expect(row.targetMinutes).toBe(50)
  })

  it('will not overwrite a completed occurrence', async () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const h = await habits.create(draft())

    await occ.ensure(h.id, '2026-08-20', '20:00', 45)
    const before = (await occ.getByHabitDate(h.id, '2026-08-20'))!
    await occ.setStatus(before.id, 'complete', '2026-08-20T18:00:00.000Z')

    // A later schedule expansion must not reset a finished day.
    await occ.ensure(h.id, '2026-08-20', '09:00', 15)

    const after = (await occ.getByHabitDate(h.id, '2026-08-20'))!
    expect(after.status).toBe('complete')
    expect(after.scheduledTime).toBe('20:00')
    expect(after.targetMinutes).toBe(45)
  })

  it('rejects two occurrences claiming the same Google task', async () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const h = await habits.create(draft())

    await occ.ensure(h.id, '2026-08-20', '20:00', 45)
    await occ.ensure(h.id, '2026-08-21', '20:00', 45)
    const a = (await occ.getByHabitDate(h.id, '2026-08-20'))!
    const b = (await occ.getByHabitDate(h.id, '2026-08-21'))!

    await occ.setProvision(a.id, 'created', 'gtask_abc', 'etag1', true)
    await expect(occ.setProvision(b.id, 'created', 'gtask_abc', 'etag2', true)).rejects.toThrow()
  })

  it('finds an occurrence by its Google task id', async () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const h = await habits.create(draft())
    await occ.ensure(h.id, '2026-08-20', '20:00', 45)
    const o = (await occ.getByHabitDate(h.id, '2026-08-20'))!
    await occ.setProvision(o.id, 'created', 'gtask_abc', 'etag1', true)

    expect((await occ.getByGoogleTaskId('gtask_abc'))!.id).toBe(o.id)
    expect(await occ.getByGoogleTaskId('nope')).toBeNull()
  })

  it('preserves history when a task is deleted in Google', async () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const h = await habits.create(draft())
    await occ.ensure(h.id, '2026-08-20', '20:00', 45)
    const o = (await occ.getByHabitDate(h.id, '2026-08-20'))!
    await occ.setStatus(o.id, 'complete', '2026-08-20T18:00:00.000Z')

    await occ.softDelete(o.id)

    // Gone from active listings...
    expect(await occ.listOnDate('2026-08-20')).toHaveLength(0)
    // ...but the row and its completion survive.
    const raw = (await occ.get(o.id))!
    expect(raw.deletedAt).not.toBeNull()
    expect(raw.status).toBe('complete')
  })

  it('reschedules a single day without duplicating', async () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const h = await habits.create(draft())
    await occ.ensure(h.id, '2026-08-20', '20:00', 45)
    const o = (await occ.getByHabitDate(h.id, '2026-08-20'))!

    await occ.reschedule(o.id, '2026-08-21', '18:00')

    expect(await occ.getByHabitDate(h.id, '2026-08-20')).toBeNull()
    expect((await occ.getByHabitDate(h.id, '2026-08-21'))!.id).toBe(o.id)
    expect(await occ.listForHabit(h.id, '2026-08-01', '2026-08-31')).toHaveLength(1)
  })

  it('lists only unprovisioned occurrences of active habits', async () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const a = await habits.create(draft({ name: 'A' }))
    const b = await habits.create(draft({ name: 'B', active: false }))

    await occ.ensure(a.id, '2026-08-20', '20:00', 45)
    await occ.ensure(b.id, '2026-08-20', '20:00', 45)

    const pending = await occ.listUnprovisioned('2026-08-20', '2026-08-27')
    expect(pending).toHaveLength(1)
    expect(pending[0]!.habitId).toBe(a.id)
  })
})

describe('time logs', () => {
  it('accumulates timer minutes and reports provenance', async () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const logs = logRepo(db)
    const h = await habits.create(draft())
    await occ.ensure(h.id, '2026-08-20', '20:00', 45)
    const o = (await occ.getByHabitDate(h.id, '2026-08-20'))!

    await logs.start(h.id, o.id, '2026-08-20T18:00:00.000Z')
    const minutes = await logs.stop(o.id, '2026-08-20T18:27:00.000Z')

    expect(minutes).toBe(27)
    expect(await logs.totalFor(o.id)).toEqual({ minutes: 27, origin: 'timer' })
  })

  it('counts a running timer toward the total', async () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const logs = logRepo(db)
    const h = await habits.create(draft())
    await occ.ensure(h.id, '2026-08-20', '20:00', 45)
    const o = (await occ.getByHabitDate(h.id, '2026-08-20'))!

    await logs.start(h.id, o.id, '2026-08-20T18:00:00.000Z')
    const now = new Date('2026-08-20T18:12:00.000Z')
    expect((await logs.totalFor(o.id, now)).minutes).toBe(12)
    expect(await logs.runningFor(o.id)).not.toBeNull()
  })

  it('lets measured minutes outrank assumed ones', async () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const logs = logRepo(db)
    const h = await habits.create(draft())
    await occ.ensure(h.id, '2026-08-20', '20:00', 45)
    const o = (await occ.getByHabitDate(h.id, '2026-08-20'))!

    await logs.setAssumed(h.id, o.id, 45, '2026-08-20T18:00:00.000Z')
    expect((await logs.totalFor(o.id)).origin).toBe('assumed')

    await logs.start(h.id, o.id, '2026-08-20T19:00:00.000Z')
    await logs.stop(o.id, '2026-08-20T19:30:00.000Z')
    expect((await logs.totalFor(o.id)).origin).toBe('timer')
  })

  it('replaces rather than stacks assumed entries on repeated syncs', async () => {
    const habits = habitRepo(db)
    const occ = occurrenceRepo(db)
    const logs = logRepo(db)
    const h = await habits.create(draft())
    await occ.ensure(h.id, '2026-08-20', '20:00', 45)
    const o = (await occ.getByHabitDate(h.id, '2026-08-20'))!

    for (let i = 0; i < 4; i++) (await logs.setAssumed(h.id, o.id, 45, '2026-08-20T18:00:00.000Z'))

    expect((await logs.totalFor(o.id)).minutes).toBe(45)
  })
})

describe('records', () => {
  it('upserts a daily record rather than duplicating it', async () => {
    const habits = habitRepo(db)
    const records = recordRepo(db)
    const h = await habits.create(draft())

    for (let i = 0; i < 3; i++) {
      await records.putDaily({
        habitId: h.id, date: '2026-08-20', status: 'complete',
        points: 2, xp: 11, durationMinutes: 45, targetMinutes: 45, origin: 'timer'
      })
    }

    const rows = await records.dailyOn('2026-08-20')
    expect(rows).toHaveLength(1)
    expect(await records.totalXp()).toBe(11)
  })

  it('reflects a revert by recomputing, not by subtracting', async () => {
    const habits = habitRepo(db)
    const records = recordRepo(db)
    const h = await habits.create(draft())

    await records.putDaily({
      habitId: h.id, date: '2026-08-20', status: 'complete',
      points: 2, xp: 11, durationMinutes: 45, targetMinutes: 45, origin: 'assumed'
    })
    expect(await records.totalXp()).toBe(11)

    // The Google task is un-ticked; the recompute writes the new truth over the old.
    await records.putDaily({
      habitId: h.id, date: '2026-08-20', status: 'missed',
      points: -1, xp: 0, durationMinutes: 0, targetMinutes: 45, origin: null
    })
    expect(await records.totalXp()).toBe(0)
    expect(await records.totalCompleted()).toBe(0)
  })

  it('unlocks an achievement only once', async () => {
    const records = recordRepo(db)
    expect(await records.unlockAchievement('streak_7', '2026-08-20T00:00:00.000Z')).toBe(true)
    expect(await records.unlockAchievement('streak_7', '2026-08-21T00:00:00.000Z')).toBe(false)
    expect((await records.unlockedAchievements()).size).toBe(1)
  })

  it('only raises a personal record, never lowers it', async () => {
    const records = recordRepo(db)
    await records.putPersonalRecord('longest_streak', 12, '12 days', '2026-08-20')
    await records.putPersonalRecord('longest_streak', 5, '5 days', '2026-08-25')
    const r = (await records.personalRecords()).find((x) => x.kind === 'longest_streak')!
    expect(r.value).toBe(12)
    expect(r.display).toBe('12 days')
  })
})

describe('settings', () => {
  it('returns defaults before anything is saved', async () => {
    const s = (await settingsRepo(db).all())
    expect(s.syncIntervalMinutes).toBe(5)
    expect(s.scoring.fullCompletion).toBe(2)
    expect(s.defaultReminderLeadMinutes).toBe(30)
  })

  it('merges a partial save over the defaults', async () => {
    const repo = settingsRepo(db)
    await repo.save({ syncIntervalMinutes: 15, scoring: { ...(await repo.scoring()), fullCompletion: 5 } })
    const s = await repo.all()
    expect(s.syncIntervalMinutes).toBe(15)
    expect(s.scoring.fullCompletion).toBe(5)
    // Untouched values survive.
    expect(s.scoring.unjustifiedSkip).toBe(-1)
    expect(s.provisionHorizonDays).toBe(7)
  })

  it('gives stored settings that predate displayName an empty name', async () => {
    (await db.prepare("INSERT INTO settings (key, value) VALUES ('app', ?)").run(JSON.stringify({ theme: 'dark', syncIntervalMinutes: 10 })))
    expect((await settingsRepo(db).all()).displayName).toBe('')
  })
})

describe('sync state', () => {
  it('tracks the watermark per task list', async () => {
    const repo = syncRepo(db)
    expect(await repo.watermark('list-1')).toBeNull()
    await repo.setWatermark('list-1', '2026-08-20T20:43:00.000Z')
    expect(await repo.watermark('list-1')).toBe('2026-08-20T20:43:00.000Z')
  })

  it('counts consecutive failures and clears them on success', async () => {
    const repo = syncRepo(db)
    await repo.markFailure('list-1', 'network')
    await repo.markFailure('list-1', 'network')
    expect((await repo.state('list-1'))!.failures).toBe(2)

    await repo.markSuccess('list-1', '2026-08-20T20:48:00.000Z')
    expect((await repo.state('list-1'))!.failures).toBe(0)
    expect((await repo.state('list-1'))!.last_error).toBeNull()
  })

  it('queues outbound work and drains it', async () => {
    const repo = syncRepo(db)
    await repo.enqueue('patch', null, { status: 'completed' })
    await repo.enqueue('patch', null, { status: 'needsAction' })
    expect(await repo.queuedCount()).toBe(2)

    const [first] = await repo.queued()
    await repo.dequeue(first!.id)
    expect(await repo.queuedCount()).toBe(1)
  })

  it('keeps the sync log bounded', async () => {
    const repo = syncRepo(db)
    for (let i = 0; i < 520; i++) (await repo.log('info', `entry ${i}`))
    const n = (await db.prepare('SELECT COUNT(*) AS n FROM sync_log').get()) as { n: number }
    expect(n.n).toBeLessThanOrEqual(500)
    expect((await repo.recent(3))[0]!.message).toBe('entry 519')
  })
})
