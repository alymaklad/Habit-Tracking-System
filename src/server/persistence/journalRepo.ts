import type { Attachment, JournalDraft, JournalEntry, JournalKind, Mood, StepToward, Tool, ToolDraft } from '@shared/types'
import type { Db } from './db'

export interface ImportedFile {
  storedName: string
  originalName: string
  mime: string
  size: number
}

interface EntryRow {
  id: number
  date: string
  kind: string
  title: string | null
  body: string
  mood: string | null
  step_toward: string | null
  prompts_json: string
  tags_json: string
  goal_id: number | null
  letgo_id: number | null
  created_at: string
  updated_at: string
}

interface AttachmentRow {
  id: number
  journal_id: number | null
  stored_name: string
  original_name: string
  mime: string
  size: number
  caption: string | null
  created_at: string
}

/** Same-origin, so the session cookie authorises `<img src>` and downloads alike. */
export const attachmentUrl = (storedName: string): string => `/api/files/${storedName}`

function toAttachment(r: AttachmentRow): Attachment {
  return {
    id: r.id,
    journalId: r.journal_id,
    originalName: r.original_name,
    mime: r.mime,
    size: r.size,
    caption: r.caption,
    isImage: r.mime.startsWith('image/'),
    url: attachmentUrl(r.stored_name),
    createdAt: r.created_at
  }
}

interface ToolRow {
  id: number
  title: string
  description: string | null
  goal_id: number | null
  habit_id: number | null
  created_at: string
}

function parse<T>(text: string, fallback: T): T {
  try {
    return JSON.parse(text) as T
  } catch {
    return fallback
  }
}

function toEntry(r: EntryRow, attachments: Attachment[] = []): JournalEntry {
  return {
    attachments,
    id: r.id,
    date: r.date,
    kind: r.kind as JournalKind,
    title: r.title,
    body: r.body,
    mood: r.mood as Mood | null,
    stepToward: r.step_toward as StepToward | null,
    prompts: parse<Record<string, string>>(r.prompts_json, {}),
    tags: parse<string[]>(r.tags_json, []),
    goalId: r.goal_id,
    letGoId: r.letgo_id,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  }
}

function toTool(r: ToolRow): Tool {
  return { id: r.id, title: r.title, description: r.description, goalId: r.goal_id, habitId: r.habit_id, createdAt: r.created_at }
}

export function journalRepo(db: Db) {
  const params = (d: JournalDraft) => ({
    date: d.date,
    kind: d.kind,
    title: d.title,
    body: d.body,
    mood: d.mood,
    step_toward: d.stepToward,
    prompts_json: JSON.stringify(d.prompts),
    tags_json: JSON.stringify(d.tags),
    goal_id: d.goalId,
    letgo_id: d.letGoId
  })

  return {
    async list(): Promise<JournalEntry[]> {
      const byEntry = new Map<number, Attachment[]>()
      for (const a of ((await db.prepare('SELECT * FROM attachment WHERE journal_id IS NOT NULL ORDER BY id').all()) as AttachmentRow[]).map(toAttachment)) {
        byEntry.set(a.journalId!, [...(byEntry.get(a.journalId!) ?? []), a])
      }
      return ((await db.prepare('SELECT * FROM journal_entry ORDER BY date DESC, id DESC').all()) as EntryRow[]).map((r) => toEntry(r, byEntry.get(r.id) ?? []))
    },

    async get(id: number): Promise<JournalEntry | null> {
      const row = (await db.prepare('SELECT * FROM journal_entry WHERE id = ?').get(id)) as EntryRow | undefined
      return row ? toEntry(row, (await this.attachmentsFor(id))) : null
    },

    async monthly(monthStart: string): Promise<JournalEntry | null> {
      const row = (await db.prepare("SELECT * FROM journal_entry WHERE kind = 'monthly' AND date = ?").get(monthStart)) as EntryRow | undefined
      return row ? toEntry(row, (await this.attachmentsFor(row.id))) : null
    },

    // ------------------------------------------------------- attachments

    async attachmentsFor(journalId: number): Promise<Attachment[]> {
      return ((await db.prepare('SELECT * FROM attachment WHERE journal_id = ? ORDER BY id').all(journalId)) as AttachmentRow[]).map(toAttachment)
    },

    async attachment(id: number): Promise<(Attachment & { storedName: string }) | null> {
      const row = (await db.prepare('SELECT * FROM attachment WHERE id = ?').get(id)) as AttachmentRow | undefined
      return row ? { ...toAttachment(row), storedName: row.stored_name } : null
    },

    async attachmentByStoredName(storedName: string): Promise<Attachment | null> {
      const row = (await db.prepare('SELECT * FROM attachment WHERE stored_name = ?').get(storedName)) as AttachmentRow | undefined
      return row ? toAttachment(row) : null
    },

    async insertAttachment(file: ImportedFile, at: string): Promise<Attachment> {
      const info = await db
        .prepare('INSERT INTO attachment (journal_id, stored_name, original_name, mime, size, created_at) VALUES (NULL, ?, ?, ?, ?, ?) RETURNING id')
        .run(file.storedName, file.originalName, file.mime, file.size, at)
      return (await this.attachment(Number(info.lastInsertRowid)))!
    },

    /** Links unattached (or already-own) files to an entry; files belonging to another entry are left alone. */
    async linkAttachments(journalId: number, ids: number[]): Promise<void> {
      const link = db.prepare('UPDATE attachment SET journal_id = ? WHERE id = ? AND (journal_id IS NULL OR journal_id = ?)')
      for (const id of ids) await link.run(journalId, id, journalId)
    },

    /** Stored names of an entry's files that are not in `keep`, for the caller to delete. */
    async attachmentsNotIn(journalId: number, keep: number[]): Promise<{ id: number; storedName: string }[]> {
      const keepSet = new Set(keep)
      return ((await db.prepare('SELECT id, stored_name FROM attachment WHERE journal_id = ?').all(journalId)) as { id: number; stored_name: string }[])
        .filter((r) => !keepSet.has(r.id))
        .map((r) => ({ id: r.id, storedName: r.stored_name }))
    },

    async storedNamesFor(journalId: number): Promise<string[]> {
      return ((await db.prepare('SELECT stored_name FROM attachment WHERE journal_id = ?').all(journalId)) as { stored_name: string }[]).map((r) => r.stored_name)
    },

    async unlinkedBefore(iso: string): Promise<{ id: number; storedName: string }[]> {
      return ((await db.prepare('SELECT id, stored_name FROM attachment WHERE journal_id IS NULL AND created_at < ?').all(iso)) as { id: number; stored_name: string }[]).map(
        (r) => ({ id: r.id, storedName: r.stored_name })
      )
    },

    async deleteAttachment(id: number): Promise<void> {
      await db.prepare('DELETE FROM attachment WHERE id = ?').run(id)
    },

    async setCaption(id: number, caption: string | null): Promise<void> {
      await db.prepare('UPDATE attachment SET caption = ? WHERE id = ?').run(caption, id)
    },

    async create(d: JournalDraft, at: string): Promise<JournalEntry> {
      const info = await db
        .prepare(
          `INSERT INTO journal_entry (date, kind, title, body, mood, step_toward, prompts_json, tags_json, goal_id, letgo_id, created_at, updated_at)
           VALUES (@date, @kind, @title, @body, @mood, @step_toward, @prompts_json, @tags_json, @goal_id, @letgo_id, @at, @at) RETURNING id`
        )
        .run({ ...params(d), at })
      return (await this.get(Number(info.lastInsertRowid)))!
    },

    async update(id: number, d: JournalDraft, at: string): Promise<void> {
      await db.prepare(
        `UPDATE journal_entry SET date = @date, kind = @kind, title = @title, body = @body, mood = @mood,
                step_toward = @step_toward, prompts_json = @prompts_json, tags_json = @tags_json,
                goal_id = @goal_id, letgo_id = @letgo_id, updated_at = @at
          WHERE id = @id`
      ).run({ ...params(d), at, id })
    },

    async remove(id: number): Promise<void> {
      await db.prepare('DELETE FROM journal_entry WHERE id = ?').run(id)
    },

    async tools(): Promise<Tool[]> {
      return ((await db.prepare('SELECT * FROM tool ORDER BY id').all()) as ToolRow[]).map(toTool)
    },

    async createTool(d: ToolDraft, at: string): Promise<Tool> {
      const info = await db
        .prepare('INSERT INTO tool (title, description, goal_id, habit_id, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id')
        .run(d.title, d.description, d.goalId, d.habitId, at)
      return toTool((await db.prepare('SELECT * FROM tool WHERE id = ?').get(Number(info.lastInsertRowid))) as ToolRow)
    },

    async updateTool(id: number, d: ToolDraft): Promise<void> {
      await db.prepare('UPDATE tool SET title = ?, description = ?, goal_id = ?, habit_id = ? WHERE id = ?').run(
        d.title,
        d.description,
        d.goalId,
        d.habitId,
        id
      )
    },

    async removeTool(id: number): Promise<void> {
      await db.prepare('DELETE FROM tool WHERE id = ?').run(id)
    }
  }
}

export type JournalRepo = ReturnType<typeof journalRepo>
