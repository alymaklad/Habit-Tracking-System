import type { Iso, LocalDate, TimeLog, TimeLogOrigin } from '@shared/types'
import type { Db } from './db'

interface LogRow {
  id: number
  habit_id: number
  occurrence_id: number | null
  started_at: string
  ended_at: string | null
  minutes: number
  origin: string
}

const toLog = (r: LogRow): TimeLog => ({
  id: r.id,
  habitId: r.habit_id,
  occurrenceId: r.occurrence_id,
  startedAt: r.started_at,
  endedAt: r.ended_at,
  minutes: r.minutes,
  origin: r.origin as TimeLogOrigin
})

export function logRepo(db: Db) {
  return {
    /** Start a timer. Any timer already running for this occurrence is closed first. */
    start(habitId: number, occurrenceId: number, at: Iso): TimeLog {
      db.prepare(
        `UPDATE time_log SET ended_at = ?, minutes = 0
          WHERE occurrence_id = ? AND ended_at IS NULL`
      ).run(at, occurrenceId)
      const info = db
        .prepare(
          `INSERT INTO time_log (habit_id, occurrence_id, started_at, ended_at, minutes, origin)
           VALUES (?, ?, ?, NULL, 0, 'timer')`
        )
        .run(habitId, occurrenceId, at)
      return this.get(Number(info.lastInsertRowid))!
    },

    stop(occurrenceId: number, at: Iso): number {
      const open = db
        .prepare(
          'SELECT * FROM time_log WHERE occurrence_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1'
        )
        .get(occurrenceId) as LogRow | undefined
      if (!open) return 0
      const minutes = Math.max(
        0,
        Math.round((new Date(at).getTime() - new Date(open.started_at).getTime()) / 60000)
      )
      db.prepare('UPDATE time_log SET ended_at = ?, minutes = ? WHERE id = ?').run(
        at,
        minutes,
        open.id
      )
      return minutes
    },

    /** Replace any `assumed` entry for an occurrence — used when Google reports a tick. */
    setAssumed(habitId: number, occurrenceId: number, minutes: number, at: Iso): void {
      db.prepare(
        "DELETE FROM time_log WHERE occurrence_id = ? AND origin = 'assumed'"
      ).run(occurrenceId)
      if (minutes <= 0) return
      db.prepare(
        `INSERT INTO time_log (habit_id, occurrence_id, started_at, ended_at, minutes, origin)
         VALUES (?, ?, ?, ?, ?, 'assumed')`
      ).run(habitId, occurrenceId, at, at, minutes)
    },

    clearAssumed(occurrenceId: number): void {
      db.prepare("DELETE FROM time_log WHERE occurrence_id = ? AND origin = 'assumed'").run(
        occurrenceId
      )
    },

    addManual(habitId: number, occurrenceId: number, minutes: number, at: Iso): void {
      db.prepare(
        `INSERT INTO time_log (habit_id, occurrence_id, started_at, ended_at, minutes, origin)
         VALUES (?, ?, ?, ?, ?, 'manual')`
      ).run(habitId, occurrenceId, at, at, minutes)
    },

    get(id: number): TimeLog | null {
      const r = db.prepare('SELECT * FROM time_log WHERE id = ?').get(id) as LogRow | undefined
      return r ? toLog(r) : null
    },

    runningFor(occurrenceId: number): TimeLog | null {
      const r = db
        .prepare(
          'SELECT * FROM time_log WHERE occurrence_id = ? AND ended_at IS NULL ORDER BY id DESC LIMIT 1'
        )
        .get(occurrenceId) as LogRow | undefined
      return r ? toLog(r) : null
    },

    anyRunning(): TimeLog | null {
      const r = db
        .prepare('SELECT * FROM time_log WHERE ended_at IS NULL ORDER BY id DESC LIMIT 1')
        .get() as LogRow | undefined
      return r ? toLog(r) : null
    },

    /**
     * Minutes logged against an occurrence, plus how they were obtained. A running
     * timer contributes its elapsed time so the dashboard ticks upward live.
     */
    totalFor(occurrenceId: number, now: Date = new Date()): {
      minutes: number
      origin: TimeLogOrigin | null
    } {
      const rows = db
        .prepare('SELECT * FROM time_log WHERE occurrence_id = ?')
        .all(occurrenceId) as LogRow[]
      if (rows.length === 0) return { minutes: 0, origin: null }

      let minutes = 0
      let sawTimer = false
      let sawManual = false
      let sawAssumed = false

      for (const r of rows) {
        if (r.ended_at === null) {
          minutes += Math.max(
            0,
            Math.floor((now.getTime() - new Date(r.started_at).getTime()) / 60000)
          )
          sawTimer = true
        } else {
          minutes += r.minutes
          if (r.origin === 'timer') sawTimer = true
          else if (r.origin === 'manual') sawManual = true
          else if (r.origin === 'assumed') sawAssumed = true
        }
      }

      // Measured minutes outrank assumed ones when reporting provenance.
      const origin: TimeLogOrigin | null = sawTimer
        ? 'timer'
        : sawManual
          ? 'manual'
          : sawAssumed
            ? 'assumed'
            : null
      return { minutes, origin }
    },

    /** Minutes per occurrence across a date range, for recompute and charts. */
    totalsInRange(from: LocalDate, to: LocalDate, now: Date = new Date()) {
      const rows = db
        .prepare(
          `SELECT t.* FROM time_log t
             JOIN occurrence o ON o.id = t.occurrence_id
            WHERE o.date BETWEEN ? AND ?`
        )
        .all(from, to) as LogRow[]

      const acc = new Map<number, { minutes: number; origins: Set<TimeLogOrigin> }>()
      for (const r of rows) {
        if (r.occurrence_id === null) continue
        let e = acc.get(r.occurrence_id)
        if (!e) {
          e = { minutes: 0, origins: new Set() }
          acc.set(r.occurrence_id, e)
        }
        if (r.ended_at === null) {
          e.minutes += Math.max(
            0,
            Math.floor((now.getTime() - new Date(r.started_at).getTime()) / 60000)
          )
          e.origins.add('timer')
        } else {
          e.minutes += r.minutes
          e.origins.add(r.origin as TimeLogOrigin)
        }
      }

      const out = new Map<number, { minutes: number; origin: TimeLogOrigin | null }>()
      for (const [id, e] of acc) {
        const origin: TimeLogOrigin | null = e.origins.has('timer')
          ? 'timer'
          : e.origins.has('manual')
            ? 'manual'
            : e.origins.has('assumed')
              ? 'assumed'
              : null
        out.set(id, { minutes: e.minutes, origin })
      }
      return out
    }
  }
}

export type LogRepo = ReturnType<typeof logRepo>
