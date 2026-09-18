import type { Habit, HabitDraft, Recurrence } from '@shared/types'
import { boolToInt, intToBool, type Db } from './db'

interface HabitRow {
  id: number
  name: string
  description: string | null
  notes: string | null
  recurrence: string
  scheduled_time: string
  target_minutes: number
  baseline_minutes: number
  difficulty_level: number
  reminder_lead_minutes: number | null
  color_key: string
  google_tasklist_id: string | null
  active: number
  goal_id: number | null
  created_at: string
}

function toHabit(r: HabitRow): Habit {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    notes: r.notes,
    recurrence: JSON.parse(r.recurrence) as Recurrence,
    scheduledTime: r.scheduled_time,
    targetMinutes: r.target_minutes,
    baselineMinutes: r.baseline_minutes,
    difficultyLevel: r.difficulty_level,
    reminderLeadMinutes: r.reminder_lead_minutes,
    colorKey: r.color_key,
    googleTasklistId: r.google_tasklist_id,
    active: intToBool(r.active),
    goalId: r.goal_id ?? null,
    createdAt: r.created_at
  }
}

export function habitRepo(db: Db) {
  const selectAll = db.prepare('SELECT * FROM habit ORDER BY active DESC, name COLLATE NOCASE')
  const selectActive = db.prepare(
    'SELECT * FROM habit WHERE active = 1 ORDER BY scheduled_time, name COLLATE NOCASE'
  )
  const selectOne = db.prepare('SELECT * FROM habit WHERE id = ?')

  const insert = db.prepare(`
    INSERT INTO habit (name, description, notes, recurrence, scheduled_time, target_minutes,
                       baseline_minutes, difficulty_level, reminder_lead_minutes, color_key,
                       google_tasklist_id, active, goal_id, created_at)
    VALUES (@name, @description, @notes, @recurrence, @scheduled_time, @target_minutes,
            @baseline_minutes, @difficulty_level, @reminder_lead_minutes, @color_key,
            @google_tasklist_id, @active, @goal_id, @created_at)
  `)

  const update = db.prepare(`
    UPDATE habit SET name = @name, description = @description, notes = @notes,
                     recurrence = @recurrence, scheduled_time = @scheduled_time,
                     target_minutes = @target_minutes, baseline_minutes = @baseline_minutes,
                     difficulty_level = @difficulty_level,
                     reminder_lead_minutes = @reminder_lead_minutes, color_key = @color_key,
                     google_tasklist_id = @google_tasklist_id, active = @active,
                     goal_id = @goal_id
     WHERE id = @id
  `)

  const params = (h: HabitDraft) => ({
    name: h.name,
    description: h.description,
    notes: h.notes,
    recurrence: JSON.stringify(h.recurrence),
    scheduled_time: h.scheduledTime,
    target_minutes: h.targetMinutes,
    baseline_minutes: h.baselineMinutes,
    difficulty_level: h.difficultyLevel,
    reminder_lead_minutes: h.reminderLeadMinutes,
    color_key: h.colorKey,
    google_tasklist_id: h.googleTasklistId,
    active: boolToInt(h.active),
    goal_id: h.goalId ?? null
  })

  return {
    list(includeInactive = true): Habit[] {
      const rows = (includeInactive ? selectAll : selectActive).all() as HabitRow[]
      return rows.map(toHabit)
    },

    listActive(): Habit[] {
      return (selectActive.all() as HabitRow[]).map(toHabit)
    },

    listByGoal(goalId: number): Habit[] {
      const rows = db
        .prepare('SELECT * FROM habit WHERE goal_id = ? ORDER BY scheduled_time, name COLLATE NOCASE')
        .all(goalId) as HabitRow[]
      return rows.map(toHabit)
    },

    get(id: number): Habit | null {
      const row = selectOne.get(id) as HabitRow | undefined
      return row ? toHabit(row) : null
    },

    create(draft: HabitDraft): Habit {
      const info = insert.run({ ...params(draft), created_at: new Date().toISOString() })
      return this.get(Number(info.lastInsertRowid))!
    },

    update(id: number, draft: HabitDraft): Habit {
      update.run({ ...params(draft), id })
      return this.get(id)!
    },

    setActive(id: number, active: boolean): void {
      db.prepare('UPDATE habit SET active = ? WHERE id = ?').run(boolToInt(active), id)
    },

    setDifficulty(id: number, level: number, targetMinutes: number): void {
      db.prepare('UPDATE habit SET difficulty_level = ?, target_minutes = ? WHERE id = ?').run(
        level,
        targetMinutes,
        id
      )
    },

    /**
     * Deleting a habit cascades to its occurrences and records, which destroys history.
     * The UI only ever offers "pause" (`setActive(false)`); this exists for the explicit
     * delete-my-data path.
     */
    remove(id: number): void {
      db.prepare('DELETE FROM habit WHERE id = ?').run(id)
    }
  }
}

export type HabitRepo = ReturnType<typeof habitRepo>
