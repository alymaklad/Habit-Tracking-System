import type { LocalDate } from '@shared/types'
import type { TodoFacts, TodoKind } from '../domain/todo'
import { boolToInt, intToBool, type Db } from './db'

interface TodoRow {
  id: number
  kind: string
  title: string
  notes: string | null
  date: string | null
  created_on: string | null
  occurrence_id: number | null
  habit_id: number | null
  position: number
  done: number
  completed_at: string | null
  dropped_at: string | null
  created_at: string
}

export interface TodoRecord extends TodoFacts {
  notes: string | null
  occurrenceId: number | null
  completedAt: string | null
}

function toRecord(r: TodoRow, scheduledTime: string | null = null): TodoRecord {
  return {
    id: r.id,
    kind: r.kind as TodoKind,
    title: r.title,
    notes: r.notes,
    done: intToBool(r.done),
    dropped: r.dropped_at !== null,
    date: r.date,
    createdOn: r.created_on,
    scheduledTime,
    habitId: r.habit_id,
    occurrenceId: r.occurrence_id,
    position: r.position,
    completedAt: r.completed_at
  }
}

export function todoRepo(db: Db) {
  return {
    // ------------------------------------------------------------ manual

    async addManual(
      title: string,
      date: LocalDate,
      notes: string | null = null,
      goalId: number | null = null
    ): Promise<number> {
      const next = (await db
        .prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM todo WHERE date = ?')
        .get(date)) as { p: number }
      const info = await db
        .prepare(
          `INSERT INTO todo (kind, title, notes, date, created_on, position, goal_id, created_at)
           VALUES ('manual', ?, ?, ?, ?, ?, ?, ?) RETURNING id`
        )
        .run(title.trim(), notes, date, date, next.p, goalId, new Date().toISOString())
      return Number(info.lastInsertRowid)
    },

    /** Milestones a goal created, in due-date order, including finished and dropped ones. */
    async listByGoal(goalId: number): Promise<TodoRecord[]> {
      const rows = (await db
        .prepare("SELECT * FROM todo WHERE kind = 'manual' AND goal_id = ? ORDER BY date, position, id")
        .all(goalId)) as TodoRow[]
      return rows.map((r) => toRecord(r))
    },

    /** Manual items sitting on a date, plus subtasks of that date's occurrences. */
    async listForDate(date: LocalDate): Promise<TodoRecord[]> {
      const manual = (await db
        .prepare("SELECT * FROM todo WHERE kind = 'manual' AND date = ? ORDER BY position, id")
        .all(date)) as TodoRow[]

      const subtasks = (await db
        .prepare(
          `SELECT t.*, o.scheduled_time AS sched
             FROM todo t
             JOIN occurrence o ON o.id = t.occurrence_id
            WHERE t.kind = 'subtask' AND o.date = ? AND o.deleted_at IS NULL
            ORDER BY o.scheduled_time, t.position, t.id`
        )
        .all(date)) as (TodoRow & { sched: string })[]

      return [
        ...manual.map((r) => toRecord(r)),
        ...subtasks.map((r) => toRecord(r, r.sched))
      ]
    },

    /** Unfinished manual items left on days before `today`. */
    async listStragglers(today: LocalDate): Promise<TodoRecord[]> {
      const rows = (await db
        .prepare(
          `SELECT * FROM todo
            WHERE kind = 'manual' AND done = 0 AND dropped_at IS NULL AND date < ?
            ORDER BY date, position`
        )
        .all(today)) as TodoRow[]
      return rows.map((r) => toRecord(r))
    },

    /** Move an item onto a new day, leaving `created_on` alone so carrying is visible. */
    async carryTo(id: number, date: LocalDate): Promise<void> {
      await db.prepare("UPDATE todo SET date = ? WHERE id = ? AND kind = 'manual'").run(date, id)
    },

    /** Every manual title ever added, for the suggestion detector. */
    async history(limit = 400): Promise<{ title: string; date: LocalDate }[]> {
      return (await db
        .prepare(
          `SELECT title, created_on AS date FROM todo
            WHERE kind = 'manual' AND created_on IS NOT NULL
            ORDER BY id DESC LIMIT ?`
        )
        .all(limit)) as { title: string; date: LocalDate }[]
    },

    // ---------------------------------------------------------- subtasks

    async addSubtask(occurrenceId: number, habitId: number, title: string): Promise<number> {
      const next = (await db
        .prepare('SELECT COALESCE(MAX(position), 0) + 1 AS p FROM todo WHERE occurrence_id = ?')
        .get(occurrenceId)) as { p: number }
      const info = await db
        .prepare(
          `INSERT INTO todo (kind, title, occurrence_id, habit_id, position, created_at)
           VALUES ('subtask', ?, ?, ?, ?, ?) RETURNING id`
        )
        .run(title.trim(), occurrenceId, habitId, next.p, new Date().toISOString())
      return Number(info.lastInsertRowid)
    },

    async listSubtasks(occurrenceId: number): Promise<TodoRecord[]> {
      const rows = (await db
        .prepare(
          "SELECT * FROM todo WHERE kind = 'subtask' AND occurrence_id = ? ORDER BY position, id"
        )
        .all(occurrenceId)) as TodoRow[]
      return rows.map((r) => toRecord(r))
    },

    async hasSubtasks(occurrenceId: number): Promise<boolean> {
      const r = (await db
        .prepare(
          "SELECT COUNT(*) n FROM todo WHERE kind = 'subtask' AND occurrence_id = ? AND dropped_at IS NULL"
        )
        .get(occurrenceId)) as { n: number }
      return r.n > 0
    },

    // ------------------------------------------------------ templates

    async templatesFor(habitId: number): Promise<{ id: number; title: string; position: number }[]> {
      return (await db
        .prepare(
          'SELECT id, title, position FROM habit_subtask_template WHERE habit_id = ? ORDER BY position, id'
        )
        .all(habitId)) as { id: number; title: string; position: number }[]
    },

    async setTemplates(habitId: number, titles: string[]): Promise<void> {
      await db.prepare('DELETE FROM habit_subtask_template WHERE habit_id = ?').run(habitId)
      const insert = db.prepare(
        'INSERT INTO habit_subtask_template (habit_id, title, position) VALUES (?, ?, ?)'
      )
      const clean = titles.map((t) => t.trim()).filter(Boolean)
      for (const [i, title] of clean.entries()) await insert.run(habitId, title, i + 1)
    },

    /** Apply a habit's template to an occurrence that has no subtasks yet. */
    async applyTemplate(occurrenceId: number, habitId: number): Promise<number> {
      if (await this.hasSubtasks(occurrenceId)) return 0
      const templates = await this.templatesFor(habitId)
      for (const t of templates) await this.addSubtask(occurrenceId, habitId, t.title)
      return templates.length
    },

    // -------------------------------------------------------- mutation

    async get(id: number): Promise<TodoRecord | null> {
      const r = (await db.prepare('SELECT * FROM todo WHERE id = ?').get(id)) as TodoRow | undefined
      return r ? toRecord(r) : null
    },

    async setDone(id: number, done: boolean, at: string): Promise<void> {
      await db.prepare('UPDATE todo SET done = ?, completed_at = ? WHERE id = ?').run(
        boolToInt(done),
        done ? at : null,
        id
      )
    },

    async setTitle(id: number, title: string): Promise<void> {
      await db.prepare('UPDATE todo SET title = ? WHERE id = ?').run(title.trim(), id)
    },

    async drop(id: number, at: string): Promise<void> {
      await db.prepare('UPDATE todo SET dropped_at = ? WHERE id = ?').run(at, id)
    },

    async restore(id: number): Promise<void> {
      await db.prepare('UPDATE todo SET dropped_at = NULL WHERE id = ?').run(id)
    },

    async remove(id: number): Promise<void> {
      await db.prepare('DELETE FROM todo WHERE id = ?').run(id)
    },

    async countOpen(date: LocalDate): Promise<{ open: number; done: number }> {
      const r = (await db
        .prepare(
          `SELECT
             SUM(CASE WHEN done = 0 THEN 1 ELSE 0 END) AS open,
             SUM(CASE WHEN done = 1 THEN 1 ELSE 0 END) AS done
           FROM todo
          WHERE kind = 'manual' AND date = ? AND dropped_at IS NULL`
        )
        .get(date)) as { open: number | null; done: number | null }
      return { open: r.open ?? 0, done: r.done ?? 0 }
    }
  }
}

export type TodoRepo = ReturnType<typeof todoRepo>
