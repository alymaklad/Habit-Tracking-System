import type { Goal, GoalResource, GoalStatus, MindMapNode } from '@shared/types'
import type { Db } from './db'

interface GoalRow {
  id: number
  title: string
  description: string | null
  target_date: string | null
  weekly_minutes_budget: number | null
  status: string
  mind_map_json: string
  resources_json: string
  created_at: string
  closed_at: string | null
}

function parseJson<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

function toGoal(r: GoalRow): Goal {
  return {
    id: r.id,
    title: r.title,
    description: r.description,
    targetDate: r.target_date,
    weeklyMinutesBudget: r.weekly_minutes_budget,
    status: r.status as GoalStatus,
    mindMap: parseJson<MindMapNode[]>(r.mind_map_json, []),
    resources: parseJson<GoalResource[]>(r.resources_json, []),
    createdAt: r.created_at,
    closedAt: r.closed_at
  }
}

export interface GoalInsert {
  title: string
  description: string | null
  targetDate: string | null
  weeklyMinutesBudget: number | null
  mindMap: MindMapNode[]
  resources: GoalResource[]
}

export function goalRepo(db: Db) {
  const selectAll = db.prepare(
    `SELECT * FROM goal
      ORDER BY CASE status WHEN 'active' THEN 0 ELSE 1 END, target_date IS NULL, target_date, id DESC`
  )
  const selectOne = db.prepare('SELECT * FROM goal WHERE id = ?')

  const insert = db.prepare(`
    INSERT INTO goal (title, description, target_date, weekly_minutes_budget, status,
                      mind_map_json, resources_json, created_at)
    VALUES (@title, @description, @target_date, @weekly_minutes_budget, 'active',
            @mind_map_json, @resources_json, @created_at)
  `)

  return {
    list(): Goal[] {
      return (selectAll.all() as GoalRow[]).map(toGoal)
    },

    get(id: number): Goal | null {
      const row = selectOne.get(id) as GoalRow | undefined
      return row ? toGoal(row) : null
    },

    create(draft: GoalInsert): Goal {
      const info = insert.run({
        title: draft.title.trim(),
        description: draft.description,
        target_date: draft.targetDate,
        weekly_minutes_budget: draft.weeklyMinutesBudget,
        mind_map_json: JSON.stringify(draft.mindMap),
        resources_json: JSON.stringify(draft.resources),
        created_at: new Date().toISOString()
      })
      return this.get(Number(info.lastInsertRowid))!
    },

    setStatus(id: number, status: GoalStatus, at: string | null): void {
      db.prepare('UPDATE goal SET status = ?, closed_at = ? WHERE id = ?').run(status, at, id)
    },

    setPlanJson(id: number, patch: { mindMap?: MindMapNode[]; resources?: GoalResource[] }): void {
      if (patch.mindMap !== undefined) {
        db.prepare('UPDATE goal SET mind_map_json = ? WHERE id = ?').run(JSON.stringify(patch.mindMap), id)
      }
      if (patch.resources !== undefined) {
        db.prepare('UPDATE goal SET resources_json = ? WHERE id = ?').run(
          JSON.stringify(patch.resources),
          id
        )
      }
    },

    /** Removes the goal row only; habits and to-dos keep their history with `goal_id` cleared. */
    remove(id: number): void {
      db.prepare('DELETE FROM goal WHERE id = ?').run(id)
    }
  }
}

export type GoalRepo = ReturnType<typeof goalRepo>
