import type { LocalDate, Occurrence, OccurrenceStatus, ProvisionState } from '@shared/types'
import { boolToInt, intToBool, type Db } from './db'

interface OccurrenceRow {
  id: number
  habit_id: number
  date: string
  scheduled_time: string
  target_minutes: number
  status: string
  completed_at: string | null
  justified_skip: number
  skip_reason: string | null
  google_task_id: string | null
  google_event_id: string | null
  event_etag: string | null
  provision_state: string
  created_by_app: number
  etag: string | null
  last_modified: string | null
  deleted_at: string | null
  reminder_sent_at: string | null
}

function toOccurrence(r: OccurrenceRow): Occurrence {
  return {
    id: r.id,
    habitId: r.habit_id,
    date: r.date,
    scheduledTime: r.scheduled_time,
    targetMinutes: r.target_minutes,
    status: r.status as OccurrenceStatus,
    completedAt: r.completed_at,
    justifiedSkip: intToBool(r.justified_skip),
    skipReason: r.skip_reason,
    googleTaskId: r.google_task_id,
    googleEventId: r.google_event_id,
    provisionState: r.provision_state as ProvisionState,
    createdByApp: intToBool(r.created_by_app),
    deletedAt: r.deleted_at,
    reminderSentAt: r.reminder_sent_at
  }
}

export function occurrenceRepo(db: Db) {
  /**
   * Upsert keyed on (habit_id, date), which is what makes schedule expansion idempotent:
   * re-running it over a date range that already has rows changes nothing but the
   * schedule fields, and never duplicates or resets progress.
   */
  const ensure = db.prepare(`
    INSERT INTO occurrence (habit_id, date, scheduled_time, target_minutes)
    VALUES (?, ?, ?, ?)
    ON CONFLICT (habit_id, date) DO UPDATE SET
      scheduled_time = excluded.scheduled_time,
      target_minutes = excluded.target_minutes
    WHERE occurrence.status = 'pending' AND occurrence.deleted_at IS NULL
  `)

  const byId = db.prepare('SELECT * FROM occurrence WHERE id = ?')
  const byGoogleId = db.prepare('SELECT * FROM occurrence WHERE google_task_id = ?')
  const byHabitDate = db.prepare('SELECT * FROM occurrence WHERE habit_id = ? AND date = ?')

  const onDate = db.prepare(`
    SELECT o.* FROM occurrence o
    JOIN habit h ON h.id = o.habit_id
    WHERE o.date = ? AND o.deleted_at IS NULL AND h.active = 1
    ORDER BY o.scheduled_time
  `)

  const inRange = db.prepare(`
    SELECT * FROM occurrence
    WHERE date BETWEEN ? AND ? AND deleted_at IS NULL
    ORDER BY date, scheduled_time
  `)

  const habitInRange = db.prepare(`
    SELECT * FROM occurrence
    WHERE habit_id = ? AND date BETWEEN ? AND ? AND deleted_at IS NULL
    ORDER BY date
  `)

  return {
    async ensure(habitId: number, date: LocalDate, time: string, target: number): Promise<void> {
      await ensure.run(habitId, date, time, target)
    },

    async get(id: number): Promise<Occurrence | null> {
      const r = (await byId.get(id)) as OccurrenceRow | undefined
      return r ? toOccurrence(r) : null
    },

    async getByGoogleTaskId(taskId: string): Promise<Occurrence | null> {
      const r = (await byGoogleId.get(taskId)) as OccurrenceRow | undefined
      return r ? toOccurrence(r) : null
    },

    async getByHabitDate(habitId: number, date: LocalDate): Promise<Occurrence | null> {
      const r = (await byHabitDate.get(habitId, date)) as OccurrenceRow | undefined
      return r ? toOccurrence(r) : null
    },

    async listOnDate(date: LocalDate): Promise<Occurrence[]> {
      return ((await onDate.all(date)) as OccurrenceRow[]).map(toOccurrence)
    },

    async listInRange(from: LocalDate, to: LocalDate): Promise<Occurrence[]> {
      return ((await inRange.all(from, to)) as OccurrenceRow[]).map(toOccurrence)
    },

    async listForHabit(habitId: number, from: LocalDate, to: LocalDate): Promise<Occurrence[]> {
      return ((await habitInRange.all(habitId, from, to)) as OccurrenceRow[]).map(toOccurrence)
    },

    /** Occurrences that still need a Google task creating, oldest first. */
    async listUnprovisioned(from: LocalDate, to: LocalDate): Promise<Occurrence[]> {
      const rows = (await db
        .prepare(
          `SELECT o.* FROM occurrence o
             JOIN habit h ON h.id = o.habit_id
            WHERE o.google_task_id IS NULL
              AND o.deleted_at IS NULL
              AND o.provision_state IN ('none', 'failed')
              AND h.active = 1
              AND o.date BETWEEN ? AND ?
            ORDER BY o.date, o.scheduled_time`
        )
        .all(from, to)) as OccurrenceRow[]
      return rows.map(toOccurrence)
    },

    async setStatus(id: number, status: OccurrenceStatus, completedAt: string | null): Promise<void> {
      await db.prepare('UPDATE occurrence SET status = ?, completed_at = ? WHERE id = ?').run(
        status,
        completedAt,
        id
      )
    },

    async setJustifiedSkip(id: number, skip: boolean, reason: string | null): Promise<void> {
      await db.prepare('UPDATE occurrence SET justified_skip = ?, skip_reason = ? WHERE id = ?').run(
        boolToInt(skip),
        reason,
        id
      )
    },

    async setProvision(
      id: number,
      state: ProvisionState,
      googleTaskId: string | null,
      etag: string | null,
      createdByApp: boolean
    ): Promise<void> {
      await db.prepare(
        `UPDATE occurrence SET provision_state = ?, google_task_id = ?, etag = ?,
                               created_by_app = ?, last_modified = ?
          WHERE id = ?`
      ).run(state, googleTaskId, etag, boolToInt(createdByApp), new Date().toISOString(), id)
    },

    async setProvisionState(id: number, state: ProvisionState): Promise<void> {
      await db.prepare('UPDATE occurrence SET provision_state = ? WHERE id = ?').run(state, id)
    },

    // ---- calendar mirror (reminder delivery only; never a completion source) ----

    async setEvent(id: number, eventId: string | null, etag: string | null): Promise<void> {
      await db.prepare('UPDATE occurrence SET google_event_id = ?, event_etag = ? WHERE id = ?').run(
        eventId,
        etag,
        id
      )
    },

    /** Scheduled occurrences with no mirrored event yet. */
    async listUnmirrored(from: LocalDate, to: LocalDate): Promise<Occurrence[]> {
      const rows = (await db
        .prepare(
          `SELECT o.* FROM occurrence o
             JOIN habit h ON h.id = o.habit_id
            WHERE o.google_event_id IS NULL
              AND o.deleted_at IS NULL
              AND h.active = 1
              AND o.date BETWEEN ? AND ?
            ORDER BY o.date, o.scheduled_time`
        )
        .all(from, to)) as OccurrenceRow[]
      return rows.map(toOccurrence)
    },

    async listMirrored(from: LocalDate, to: LocalDate): Promise<Occurrence[]> {
      const rows = (await db
        .prepare(
          `SELECT * FROM occurrence
            WHERE google_event_id IS NOT NULL AND date BETWEEN ? AND ?`
        )
        .all(from, to)) as OccurrenceRow[]
      return rows.map(toOccurrence)
    },

    async setReminderSent(id: number, at: string): Promise<void> {
      await db.prepare('UPDATE occurrence SET reminder_sent_at = ? WHERE id = ?').run(at, id)
    },

    /** Reschedule a single day without touching the habit's own recurrence. */
    async reschedule(id: number, date: LocalDate, time: string): Promise<void> {
      await db.prepare('UPDATE occurrence SET date = ?, scheduled_time = ? WHERE id = ?').run(
        date,
        time,
        id
      )
    },

    /**
     * A task deleted in Google marks the occurrence deleted; the row and every record
     * derived from it survive, so historical analytics are never rewritten.
     */
    async softDelete(id: number): Promise<void> {
      await db.prepare('UPDATE occurrence SET deleted_at = ? WHERE id = ?').run(
        new Date().toISOString(),
        id
      )
    },

    /** Future occurrences the app created that a schedule change has orphaned. */
    async listOrphanedAfter(habitId: number, fromDate: LocalDate, keep: LocalDate[]): Promise<Occurrence[]> {
      const rows = (await db
        .prepare(
          `SELECT * FROM occurrence
            WHERE habit_id = ? AND date >= ? AND deleted_at IS NULL AND status = 'pending'`
        )
        .all(habitId, fromDate)) as OccurrenceRow[]
      const keepSet = new Set(keep)
      return rows.map(toOccurrence).filter((o) => !keepSet.has(o.date))
    },

    async hardDelete(id: number): Promise<void> {
      await db.prepare('DELETE FROM occurrence WHERE id = ?').run(id)
    },

    /** Distinct dates that have any occurrence — used to bound recompute passes. */
    async earliestDate(): Promise<LocalDate | null> {
      const r = (await db.prepare('SELECT MIN(date) AS d FROM occurrence').get()) as { d: string | null }
      return r?.d ?? null
    }
  }
}

export type OccurrenceRepo = ReturnType<typeof occurrenceRepo>
