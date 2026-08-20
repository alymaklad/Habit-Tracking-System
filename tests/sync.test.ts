import { beforeEach, describe, expect, it } from 'vitest'
import Database from 'better-sqlite3'
import type { HabitDraft } from '@shared/types'
import { migrate, type Db } from '@main/persistence/db'
import { habitRepo } from '@main/persistence/habitRepo'
import { occurrenceRepo } from '@main/persistence/occurrenceRepo'
import { logRepo } from '@main/persistence/logRepo'
import { recordRepo } from '@main/persistence/recordRepo'
import { settingsRepo } from '@main/persistence/settingsRepo'
import { syncRepo } from '@main/persistence/syncRepo'
import { scheduleService } from '@main/application/scheduleService'
import { recomputeService } from '@main/application/recomputeService'
import { taskProvisioner } from '@main/sync/taskProvisioner'
import { taskSyncer } from '@main/sync/taskSyncer'
import {
  buildNotes,
  durationFromTitle,
  habitIdFromNotes,
  isAppOwned,
  normaliseTitle
} from '@main/sync/taskMapping'
import { FakeGoogle } from './fakeGoogle'

const NOW = new Date('2026-08-20T17:43:00.000Z')
const TODAY = '2026-08-20'
const LIST = 'list-habits'

function harness() {
  const db = new Database(':memory:') as Db
  db.pragma('foreign_keys = ON')
  migrate(db)

  const habits = habitRepo(db)
  const occurrences = occurrenceRepo(db)
  const logs = logRepo(db)
  const records = recordRepo(db)
  const settings = settingsRepo(db)
  const sync = syncRepo(db)
  settings.save({ timezone: 'Africa/Cairo', provisionHorizonDays: 7 })
  settings.setFlag('tasklistId', LIST)
  settings.setFlag('tasklistName', 'Habits')

  const google = new FakeGoogle()
  const tasks = google.client()

  const schedule = scheduleService({ db, habits, occurrences, settings })
  const engine = recomputeService({ db, habits, occurrences, logs, records, settings })
  const provisioner = taskProvisioner({ habits, occurrences, settings, sync, tasks })
  const syncer = taskSyncer({ db, habits, occurrences, logs, sync, tasks })

  return { db, habits, occurrences, logs, records, settings, sync, google, schedule, engine, provisioner, syncer }
}

const draft = (o: Partial<HabitDraft> = {}): HabitDraft => ({
  name: 'Study AI',
  description: null,
  notes: null,
  recurrence: { kind: 'weekly', days: [1, 2, 3, 4, 5] },
  scheduledTime: '18:00',
  targetMinutes: 120,
  baselineMinutes: 120,
  difficultyLevel: 3,
  reminderLeadMinutes: 30,
  colorKey: 'violet',
  googleTasklistId: null,
  active: true,
  ...o
})

let h: ReturnType<typeof harness>

beforeEach(() => {
  h = harness()
})

// ------------------------------------------------------------- mapping

describe('task identification', () => {
  it('round-trips the habit marker through notes', () => {
    const notes = buildNotes({ id: 4, targetMinutes: 120 }, '18:00')
    expect(notes).toContain('18:00')
    expect(notes).toContain('2h target')
    expect(habitIdFromNotes(notes)).toBe(4)
    expect(isAppOwned(notes)).toBe(true)
  })

  it('treats a user-written task as not ours', () => {
    expect(habitIdFromNotes('just my own note')).toBeNull()
    expect(habitIdFromNotes(null)).toBeNull()
    expect(isAppOwned('remember the milk')).toBe(false)
  })

  it('strips a duration the user typed into the title', () => {
    expect(normaliseTitle('Study AI — 2 hours')).toBe('study ai')
    expect(normaliseTitle('German – 45 minutes')).toBe('german')
    expect(normaliseTitle('Read - 30 min')).toBe('read')
    expect(normaliseTitle('Exercise 1h')).toBe('exercise')
  })

  it('folds case, punctuation and spacing', () => {
    expect(normaliseTitle('  STUDY   A.I.  ')).toBe('study a i')
    expect(normaliseTitle('Study AI')).toBe(normaliseTitle('study  ai'))
  })

  it('does not mistake a number in the name for a duration', () => {
    expect(normaliseTitle('Chapter 7')).toBe('chapter 7')
  })

  it('reads a duration out of a title when there is one', () => {
    expect(durationFromTitle('Study AI — 2 hours')).toBe(120)
    expect(durationFromTitle('German – 45 minutes')).toBe(45)
    expect(durationFromTitle('Read')).toBeNull()
    expect(durationFromTitle('Task 99 hours')).toBeNull()
  })
})

// -------------------------------------------------------- provisioning

describe('provisioning', () => {
  it('creates one Google task per scheduled day', async () => {
    h.habits.create(draft())
    h.schedule.expandHorizon(NOW)
    const { from, to } = h.schedule.horizon(NOW)

    const result = await h.provisioner.provision(from, to)

    expect(result.created).toBeGreaterThan(0)
    expect(h.google.countTitled('Study AI')).toBe(result.created)
  })

  it('creates nothing on a second run', async () => {
    h.habits.create(draft())
    h.schedule.expandHorizon(NOW)
    const { from, to } = h.schedule.horizon(NOW)

    const first = await h.provisioner.provision(from, to)
    const before = h.google.live().length

    for (let i = 0; i < 4; i++) await h.provisioner.provision(from, to)

    expect(h.google.live().length).toBe(before)
    expect(h.google.countTitled('Study AI')).toBe(first.created)
  })

  it('adopts a task the user already created rather than duplicating it', async () => {
    h.habits.create(draft())
    h.schedule.expandHorizon(NOW)
    const { from, to } = h.schedule.horizon(NOW)

    // The user made their own "Study AI" for today before connecting.
    const mine = h.google.seedUserTask('Study AI', TODAY)

    const result = await h.provisioner.provision(from, to)

    expect(result.adopted).toBe(1)
    expect(h.google.countTitled('Study AI')).toBe(result.created + 1)
    const occ = h.occurrences.getByHabitDate(1, TODAY)!
    expect(occ.googleTaskId).toBe(mine.id)
    // Adopted, not created by us — so we must never delete it.
    expect(occ.createdByApp).toBe(false)
  })

  it('adopts a task whose title carries a duration suffix', async () => {
    h.habits.create(draft())
    h.schedule.expandHorizon(NOW)
    const { from, to } = h.schedule.horizon(NOW)

    h.google.seedUserTask('Study AI — 2 hours', TODAY)
    const result = await h.provisioner.provision(from, to)

    expect(result.adopted).toBe(1)
  })

  it('recovers from a crash between create and record, without duplicating', async () => {
    h.habits.create(draft())
    h.schedule.expandHorizon(NOW)
    const { from, to } = h.schedule.horizon(NOW)

    // The task lands in Google but the response is lost.
    h.google.failNextCreates = 1
    await expect(h.provisioner.provision(from, to)).rejects.toThrow(/simulated/)

    const createdInGoogle = h.google.countTitled('Study AI')
    expect(createdInGoogle).toBe(1)

    // Startup reconcile claims the orphan...
    const adopted = await h.provisioner.reconcile(from, to)
    expect(adopted).toBe(1)

    // ...and the normal run then fills in the rest without a second copy for that day.
    await h.provisioner.provision(from, to)
    const perDay = new Map<string, number>()
    for (const t of h.google.live()) {
      const d = (t.due ?? '').slice(0, 10)
      perDay.set(d, (perDay.get(d) ?? 0) + 1)
    }
    for (const [, n] of perDay) expect(n).toBe(1)
  })

  it('writes the time and duration into the notes, since Google cannot store them', async () => {
    h.habits.create(draft())
    h.schedule.expandHorizon(NOW)
    const { from, to } = h.schedule.horizon(NOW)
    await h.provisioner.provision(from, to)

    const task = h.google.live().find((t) => (t.due ?? '').startsWith(TODAY))!
    expect(task.notes).toContain('18:00')
    expect(task.notes).toContain('2h target')
    expect(task.due).toBe(`${TODAY}T00:00:00.000Z`)
  })

  it('only deletes tasks it created itself', async () => {
    h.habits.create(draft())
    h.schedule.expandHorizon(NOW)
    const { from, to } = h.schedule.horizon(NOW)
    h.google.seedUserTask('Study AI', TODAY)
    await h.provisioner.provision(from, to)

    const adoptedOcc = h.occurrences.getByHabitDate(1, TODAY)!
    const ownOcc = h.occurrences.getByHabitDate(1, '2026-08-21')!

    const removed = await h.provisioner.removeOrphans([adoptedOcc.id, ownOcc.id])

    expect(removed).toBe(1) // only ours
    expect(h.google.live().some((t) => t.id === adoptedOcc.googleTaskId)).toBe(true)
  })
})

// --------------------------------------------------------------- pull

describe('pulling changes', () => {
  async function seeded() {
    h.habits.create(draft())
    h.schedule.expandHorizon(NOW)
    const { from, to } = h.schedule.horizon(NOW)
    await h.provisioner.provision(from, to)
    await h.syncer.pull(LIST) // establish the watermark
    const occ = h.occurrences.getByHabitDate(1, TODAY)!
    return { occ, from, to }
  }

  it('marks a habit complete when it is ticked in Google', async () => {
    const { occ, from, to } = await seeded()

    h.google.completeInGoogle(occ.googleTaskId!)
    const result = await h.syncer.pull(LIST)

    expect(result.applied).toBe(1)
    expect(result.affected).toContain(TODAY)

    h.engine.refresh(from, to, NOW)
    const rec = h.records.dailyForHabit(1, TODAY, TODAY)[0]!
    expect(rec.status).toBe('complete')
    expect(rec.points).toBe(2)
    expect(rec.xp).toBe(20)
    // Credited at target and badged, because no timer ever ran.
    expect(rec.origin).toBe('assumed')
    expect(rec.durationMinutes).toBe(120)
  })

  it('takes the points back when it is un-ticked in Google', async () => {
    const { occ, from, to } = await seeded()

    h.google.completeInGoogle(occ.googleTaskId!)
    await h.syncer.pull(LIST)
    h.engine.refresh(from, to, NOW)
    expect(h.records.totalXp()).toBe(20)

    h.google.uncompleteInGoogle(occ.googleTaskId!)
    await h.syncer.pull(LIST)
    h.engine.refresh(from, to, NOW)

    const rec = h.records.dailyForHabit(1, TODAY, TODAY)[0]!
    expect(rec.status).toBe('pending')
    expect(rec.points).toBe(0)
    expect(h.records.totalXp()).toBe(0)
  })

  it('keeps measured time when a Google tick is undone', async () => {
    const { occ, from, to } = await seeded()

    h.logs.start(1, occ.id, '2026-08-20T15:00:00.000Z')
    h.logs.stop(occ.id, '2026-08-20T15:40:00.000Z') // 40 real minutes

    h.google.completeInGoogle(occ.googleTaskId!)
    await h.syncer.pull(LIST)
    h.google.uncompleteInGoogle(occ.googleTaskId!)
    await h.syncer.pull(LIST)
    h.engine.refresh(from, to, NOW)

    const rec = h.records.dailyForHabit(1, TODAY, TODAY)[0]!
    expect(rec.durationMinutes).toBe(40)
    expect(rec.origin).toBe('timer')
    expect(rec.status).toBe('partial')
  })

  it('is idempotent across repeated pulls', async () => {
    const { occ, from, to } = await seeded()
    h.google.completeInGoogle(occ.googleTaskId!)

    await h.syncer.pull(LIST)
    h.engine.refresh(from, to, NOW)
    const xp = h.records.totalXp()

    for (let i = 0; i < 5; i++) {
      await h.syncer.pull(LIST)
      h.engine.refresh(from, to, NOW)
    }

    expect(h.records.totalXp()).toBe(xp)
    expect(h.logs.totalFor(occ.id).minutes).toBe(120)
  })

  it('retires a deleted task but keeps its history', async () => {
    const { occ, from, to } = await seeded()

    h.google.completeInGoogle(occ.googleTaskId!)
    await h.syncer.pull(LIST)
    h.engine.refresh(from, to, NOW)
    expect(h.records.dailyForHabit(1, TODAY, TODAY)[0]!.status).toBe('complete')

    h.google.deleteInGoogle(occ.googleTaskId!)
    await h.syncer.pull(LIST)

    expect(h.occurrences.get(occ.id)!.deletedAt).not.toBeNull()
    // The completed day is still in the record.
    expect(h.records.dailyForHabit(1, TODAY, TODAY)[0]!.status).toBe('complete')
  })

  it('follows a rename by id rather than losing the mapping', async () => {
    const { occ } = await seeded()

    h.google.renameInGoogle(occ.googleTaskId!, 'Study Artificial Intelligence')
    h.google.completeInGoogle(occ.googleTaskId!)
    const result = await h.syncer.pull(LIST)

    expect(result.applied).toBe(1)
    expect(h.occurrences.get(occ.id)!.completedAt).not.toBeNull()
  })

  it('follows a reschedule without creating a duplicate', async () => {
    const { occ } = await seeded()
    // Beyond the provisioning horizon, so no occurrence exists there yet.
    const target = '2026-09-15'

    h.google.rescheduleInGoogle(occ.googleTaskId!, `${target}T00:00:00.000Z`)
    await h.syncer.pull(LIST)

    expect(h.occurrences.get(occ.id)!.date).toBe(target)
    expect(
      h.occurrences.listForHabit(1, '2026-08-19', '2026-09-30').filter((o) => o.date === target)
    ).toHaveLength(1)
  })

  it('refuses a reschedule that would collide with an existing day', async () => {
    const { occ } = await seeded()
    // 21 August already has an occurrence for this habit.
    const occupied = '2026-08-21'
    expect(h.occurrences.getByHabitDate(1, occupied)).not.toBeNull()

    h.google.rescheduleInGoogle(occ.googleTaskId!, `${occupied}T00:00:00.000Z`)
    await h.syncer.pull(LIST)

    // Neither row moves, and nothing is destroyed.
    expect(h.occurrences.get(occ.id)!.date).toBe(TODAY)
    expect(h.occurrences.listForHabit(1, occupied, occupied)).toHaveLength(1)
    expect(h.sync.recent(20).some((l) => l.message.includes('already has an occurrence'))).toBe(true)
  })

  it('advances the watermark from the server clock, not the local one', async () => {
    const { occ } = await seeded()
    h.google.completeInGoogle(occ.googleTaskId!)
    await h.syncer.pull(LIST)

    const mark = h.sync.watermark(LIST)!
    // The fake server's clock is ahead of the test's wall clock; the watermark must
    // follow the server, otherwise a skewed machine would skip changes.
    expect(mark).toBe(h.google.now())
  })

  it('ignores a task that matches no habit', async () => {
    await seeded()
    h.google.seedUserTask('Buy milk', TODAY)

    const result = await h.syncer.pull(LIST)
    expect(result.applied).toBe(0)
  })
})

// --------------------------------------------------------------- push

describe('pushing local changes', () => {
  async function seeded() {
    h.habits.create(draft())
    h.schedule.expandHorizon(NOW)
    const { from, to } = h.schedule.horizon(NOW)
    await h.provisioner.provision(from, to)
    await h.syncer.pull(LIST)
    return h.occurrences.getByHabitDate(1, TODAY)!
  }

  it('sends a local completion to Google', async () => {
    const occ = await seeded()

    h.syncer.enqueueStatus(occ.id, true)
    expect(h.sync.queuedCount()).toBe(1)

    const result = await h.syncer.push(LIST)

    expect(result.pushed).toBe(1)
    expect(h.sync.queuedCount()).toBe(0)
    expect(h.google.all().find((t) => t.id === occ.googleTaskId)!.status).toBe('completed')
  })

  it('holds the queue while offline and drains it on reconnect', async () => {
    const occ = await seeded()
    h.syncer.enqueueStatus(occ.id, true)

    // Simulate the push failing: the op stays queued for the next cycle.
    const broken = { ...h.google.client(), getTask: async () => { throw new Error('offline') } }
    const offlineSyncer = taskSyncer({
      db: h.db, habits: h.habits, occurrences: h.occurrences,
      logs: h.logs, sync: h.sync, tasks: broken
    })

    const failed = await offlineSyncer.push(LIST)
    expect(failed.pushed).toBe(0)
    expect(h.sync.queuedCount()).toBe(1)

    const recovered = await h.syncer.push(LIST)
    expect(recovered.pushed).toBe(1)
    expect(h.sync.queuedCount()).toBe(0)
  })

  it('lets a newer remote change win instead of overwriting it', async () => {
    const occ = await seeded()

    // Queue a local un-tick, stamped with the server's current time...
    h.syncer.enqueueStatus(occ.id, false, new Date(h.google.now()))
    // ...then the user completes it on their phone, after our op was queued.
    h.google.advanceClock(60_000)
    h.google.completeInGoogle(occ.googleTaskId!)

    const result = await h.syncer.push(LIST)

    expect(result.conflicts).toBe(1)
    expect(result.pushed).toBe(0)
    // Google's state stands.
    expect(h.google.all().find((t) => t.id === occ.googleTaskId)!.status).toBe('completed')
    expect(h.sync.queuedCount()).toBe(0)
  })
})

// ------------------------------------------------- end-to-end round trip

describe('the full loop', () => {
  it('goes from a Google tick to XP, streak and level', async () => {
    h.habits.create(draft())
    h.habits.create(draft({ name: 'German', targetMinutes: 45, difficultyLevel: 2, scheduledTime: '20:00' }))
    h.schedule.expandHorizon(NOW)
    const { from, to } = h.schedule.horizon(NOW)
    await h.provisioner.provision(from, to)
    await h.syncer.pull(LIST)

    const studyToday = h.occurrences.getByHabitDate(1, TODAY)!
    const germanToday = h.occurrences.getByHabitDate(2, TODAY)!

    // Ticked on a phone.
    h.google.completeInGoogle(studyToday.googleTaskId!)
    // Timer run in the app, short of target.
    h.logs.start(2, germanToday.id, '2026-08-20T16:00:00.000Z')
    h.logs.stop(germanToday.id, '2026-08-20T16:27:00.000Z')

    const pulled = await h.syncer.pull(LIST)
    expect(pulled.applied).toBe(1)

    const { newAchievements } = h.engine.refresh(from, to, NOW)

    const study = h.records.dailyForHabit(1, TODAY, TODAY)[0]!
    const german = h.records.dailyForHabit(2, TODAY, TODAY)[0]!

    expect(study.status).toBe('complete')
    expect(study.points).toBe(2)
    expect(german.status).toBe('partial')
    expect(german.points).toBe(1)
    expect(h.records.totalXp()).toBe(study.xp + german.xp)
    expect(Array.isArray(newAchievements)).toBe(true)
  })
})
