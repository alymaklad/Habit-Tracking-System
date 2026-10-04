import type {
  LetGoBehavior,
  LetGoCheckin,
  LetGoCheckinInput,
  LetGoDraft,
  LetGoFeeling,
  LetGoStatus,
  LetGoWeight,
  LocalDate,
  TriggerContext
} from '@shared/types'
import type { Db } from './db'

interface LetGoRow {
  id: number
  title: string
  trigger_contexts_json: string
  trigger_notes: string | null
  replacement: string | null
  goal_id: number | null
  weight: string
  status: string
  started_on: string
  left_behind_at: string | null
  vow: string | null
  created_at: string
}

interface CheckinRow {
  id: number
  letgo_id: number
  date: string
  resisted: number
  feelings_json: string
  trigger: string | null
  need: string | null
  alternative: string | null
  note: string | null
  created_at: string
}

function parseList<T>(text: string): T[] {
  try {
    const v = JSON.parse(text) as unknown
    return Array.isArray(v) ? (v as T[]) : []
  } catch {
    return []
  }
}

function toBehavior(r: LetGoRow): LetGoBehavior {
  return {
    id: r.id,
    title: r.title,
    triggerContexts: parseList<TriggerContext>(r.trigger_contexts_json),
    triggerNotes: r.trigger_notes,
    replacement: r.replacement,
    goalId: r.goal_id,
    weight: r.weight as LetGoWeight,
    status: r.status as LetGoStatus,
    startedOn: r.started_on,
    leftBehindAt: r.left_behind_at,
    vow: r.vow,
    createdAt: r.created_at
  }
}

function toCheckin(r: CheckinRow): LetGoCheckin {
  return {
    id: r.id,
    letGoId: r.letgo_id,
    date: r.date,
    resisted: r.resisted === 1,
    feelings: parseList<LetGoFeeling>(r.feelings_json),
    trigger: r.trigger,
    need: r.need,
    alternative: r.alternative,
    note: r.note,
    createdAt: r.created_at
  }
}

export function letGoRepo(db: Db) {
  const params = (d: LetGoDraft) => ({
    title: d.title,
    trigger_contexts_json: JSON.stringify(d.triggerContexts),
    trigger_notes: d.triggerNotes,
    replacement: d.replacement,
    goal_id: d.goalId,
    weight: d.weight,
    started_on: d.startedOn
  })

  return {
    list(): LetGoBehavior[] {
      const rows = db
        .prepare("SELECT * FROM letgo ORDER BY CASE status WHEN 'carrying' THEN 0 ELSE 1 END, id")
        .all() as LetGoRow[]
      return rows.map(toBehavior)
    },

    get(id: number): LetGoBehavior | null {
      const row = db.prepare('SELECT * FROM letgo WHERE id = ?').get(id) as LetGoRow | undefined
      return row ? toBehavior(row) : null
    },

    create(d: LetGoDraft, at: string): LetGoBehavior {
      const info = db
        .prepare(
          `INSERT INTO letgo (title, trigger_contexts_json, trigger_notes, replacement, goal_id, weight, started_on, created_at)
           VALUES (@title, @trigger_contexts_json, @trigger_notes, @replacement, @goal_id, @weight, @started_on, @created_at)`
        )
        .run({ ...params(d), created_at: at })
      return this.get(Number(info.lastInsertRowid))!
    },

    update(id: number, d: LetGoDraft): void {
      db.prepare(
        `UPDATE letgo SET title = @title, trigger_contexts_json = @trigger_contexts_json, trigger_notes = @trigger_notes,
                replacement = @replacement, goal_id = @goal_id, weight = @weight, started_on = @started_on
          WHERE id = @id`
      ).run({ ...params(d), id })
    },

    setStatus(id: number, status: LetGoStatus, at: string | null, vow?: string | null): void {
      if (vow === undefined) db.prepare('UPDATE letgo SET status = ?, left_behind_at = ? WHERE id = ?').run(status, at, id)
      else db.prepare('UPDATE letgo SET status = ?, left_behind_at = ?, vow = ? WHERE id = ?').run(status, at, vow, id)
    },

    remove(id: number): void {
      db.prepare('DELETE FROM letgo WHERE id = ?').run(id)
    },

    checkins(letGoId: number): LetGoCheckin[] {
      const rows = db.prepare('SELECT * FROM letgo_checkin WHERE letgo_id = ? ORDER BY date').all(letGoId) as CheckinRow[]
      return rows.map(toCheckin)
    },

    allCheckins(): LetGoCheckin[] {
      return (db.prepare('SELECT * FROM letgo_checkin ORDER BY date').all() as CheckinRow[]).map(toCheckin)
    },

    /** One answer per behaviour per day; answering again replaces the earlier one. */
    putCheckin(letGoId: number, date: LocalDate, input: LetGoCheckinInput, at: string): void {
      db.prepare(
        `INSERT INTO letgo_checkin (letgo_id, date, resisted, feelings_json, trigger, need, alternative, note, created_at)
         VALUES (@letgo_id, @date, @resisted, @feelings_json, @trigger, @need, @alternative, @note, @created_at)
         ON CONFLICT (letgo_id, date) DO UPDATE SET
           resisted = excluded.resisted, feelings_json = excluded.feelings_json, trigger = excluded.trigger,
           need = excluded.need, alternative = excluded.alternative, note = excluded.note`
      ).run({
        letgo_id: letGoId,
        date,
        resisted: input.resisted ? 1 : 0,
        feelings_json: JSON.stringify(input.feelings),
        trigger: input.trigger,
        need: input.need,
        alternative: input.alternative,
        note: input.note,
        created_at: at
      })
    },

    clearCheckin(letGoId: number, date: LocalDate): void {
      db.prepare('DELETE FROM letgo_checkin WHERE letgo_id = ? AND date = ?').run(letGoId, date)
    }
  }
}

export type LetGoRepo = ReturnType<typeof letGoRepo>
