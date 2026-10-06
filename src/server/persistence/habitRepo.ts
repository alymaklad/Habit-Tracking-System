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
  const selectAll = db.prepare('SELECT * FROM habit ORDER BY active DESC, lower(name), name')
  const selectActive = db.prepare(
    'SELECT * FROM habit WHERE active = 1 ORDER BY scheduled_time, lower(name), name'
  )
  const selectOne = db.prepare('SELECT * FROM habit WHERE id = ?')

  const insert = db.prepare(`
    INSERT INTO habit (name, description, notes, recurrence, scheduled_time, target_minutes,
                       baseline_minutes, difficulty_level, reminder_lead_minutes, color_key,
                       google_tasklist_id, active, goal_id, created_at)
    VALUES (@name, @description, @notes, @recurrence, @scheduled_time, @target_minutes,
            @baseline_minutes, @difficulty_level, @reminder_lead_minutes, @color_key,
            @google_tasklist_id, @active, @goal_id, @created_at)
    RETURNING id
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
    async list(includeInactive = true): Promise<Habit[]> {
      const rows = (await (includeInactive ? selectAll : selectActive).all()) as HabitRow[]
      return rows.map(toHabit)
    },

    async listActive(): Promise<Habit[]> {
      return ((await selectActive.all()) as HabitRow[]).map(toHabit)
    },

    async listByGoal(goalId: number): Promise<Habit[]> {
      const rows = (await db
        .prepare('SELECT * FROM habit WHERE goal_id = ? ORDER BY scheduled_time, lower(name), name')
        .all(goalId)) as HabitRow[]
      return rows.map(toHabit)
    },

    async get(id: number): Promise<Habit | null> {
      const row = (await selectOne.get(id)) as HabitRow | undefined
      return row ? toHabit(row) : null
    },

    async create(draft: HabitDraft): Promise<Habit> {
      const info = await insert.run({ ...params(draft), created_at: new Date().toISOString() })
      return (await this.get(Number(info.lastInsertRowid)))!
    },

    async update(id: number, draft: HabitDraft): Promise<Habit> {
      await update.run({ ...params(draft), id })
      return (await this.get(id))!
    },

    async setActive(id: number, active: boolean): Promise<void> {
      await db.prepare('UPDATE habit SET active = ? WHERE id = ?').run(boolToInt(active), id)
    },

    async setDifficulty(id: number, level: number, targetMinutes: number): Promise<void> {
      await db.prepare('UPDATE habit SET difficulty_level = ?, target_minutes = ? WHERE id = ?').run(
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
    async remove(id: number): Promise<void> {
      await db.prepare('DELETE FROM habit WHERE id = ?').run(id)
    }
  }
}

export type HabitRepo = ReturnType<typeof habitRepo>
