import type { Attachment, JournalDraft, JournalEntry, JournalKind, Mood, StepToward, Tool, ToolDraft } from '@shared/types'
import type { ImportedFile } from '../platform/attachmentStore'
import type { Db } from './db'

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

export const ATTACHMENT_SCHEME = 'khatwa-file'

function toAttachment(r: AttachmentRow): Attachment {
  return {
    id: r.id,
    journalId: r.journal_id,
    originalName: r.original_name,
    mime: r.mime,
    size: r.size,
    caption: r.caption,
    isImage: r.mime.startsWith('image/'),
    url: `${ATTACHMENT_SCHEME}://attachment/${r.stored_name}`,
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
    list(): JournalEntry[] {
      const byEntry = new Map<number, Attachment[]>()
      for (const a of (db.prepare('SELECT * FROM attachment WHERE journal_id IS NOT NULL ORDER BY id').all() as AttachmentRow[]).map(toAttachment)) {
        byEntry.set(a.journalId!, [...(byEntry.get(a.journalId!) ?? []), a])
      }
      return (db.prepare('SELECT * FROM journal_entry ORDER BY date DESC, id DESC').all() as EntryRow[]).map((r) => toEntry(r, byEntry.get(r.id) ?? []))
    },

    get(id: number): JournalEntry | null {
      const row = db.prepare('SELECT * FROM journal_entry WHERE id = ?').get(id) as EntryRow | undefined
      return row ? toEntry(row, this.attachmentsFor(id)) : null
    },

    monthly(monthStart: string): JournalEntry | null {
      const row = db.prepare("SELECT * FROM journal_entry WHERE kind = 'monthly' AND date = ?").get(monthStart) as EntryRow | undefined
      return row ? toEntry(row, this.attachmentsFor(row.id)) : null
    },

    // ------------------------------------------------------- attachments

    attachmentsFor(journalId: number): Attachment[] {
      return (db.prepare('SELECT * FROM attachment WHERE journal_id = ? ORDER BY id').all(journalId) as AttachmentRow[]).map(toAttachment)
    },

    attachment(id: number): (Attachment & { storedName: string }) | null {
      const row = db.prepare('SELECT * FROM attachment WHERE id = ?').get(id) as AttachmentRow | undefined
      return row ? { ...toAttachment(row), storedName: row.stored_name } : null
    },

    insertAttachment(file: ImportedFile, at: string): Attachment {
      const info = db
        .prepare('INSERT INTO attachment (journal_id, stored_name, original_name, mime, size, created_at) VALUES (NULL, ?, ?, ?, ?, ?)')
        .run(file.storedName, file.originalName, file.mime, file.size, at)
      return this.attachment(Number(info.lastInsertRowid))!
    },

    /** Links unattached (or already-own) files to an entry; files belonging to another entry are left alone. */
    linkAttachments(journalId: number, ids: number[]): void {
      const link = db.prepare('UPDATE attachment SET journal_id = ? WHERE id = ? AND (journal_id IS NULL OR journal_id = ?)')
      for (const id of ids) link.run(journalId, id, journalId)
    },

    /** Stored names of an entry's files that are not in `keep`, for the caller to delete. */
    attachmentsNotIn(journalId: number, keep: number[]): { id: number; storedName: string }[] {
      const keepSet = new Set(keep)
      return (db.prepare('SELECT id, stored_name FROM attachment WHERE journal_id = ?').all(journalId) as { id: number; stored_name: string }[])
        .filter((r) => !keepSet.has(r.id))
        .map((r) => ({ id: r.id, storedName: r.stored_name }))
    },

    storedNamesFor(journalId: number): string[] {
      return (db.prepare('SELECT stored_name FROM attachment WHERE journal_id = ?').all(journalId) as { stored_name: string }[]).map((r) => r.stored_name)
    },

    unlinkedBefore(iso: string): { id: number; storedName: string }[] {
      return (db.prepare('SELECT id, stored_name FROM attachment WHERE journal_id IS NULL AND created_at < ?').all(iso) as { id: number; stored_name: string }[]).map(
        (r) => ({ id: r.id, storedName: r.stored_name })
      )
    },

    deleteAttachment(id: number): void {
      db.prepare('DELETE FROM attachment WHERE id = ?').run(id)
    },

    setCaption(id: number, caption: string | null): void {
      db.prepare('UPDATE attachment SET caption = ? WHERE id = ?').run(caption, id)
    },

    create(d: JournalDraft, at: string): JournalEntry {
      const info = db
        .prepare(
          `INSERT INTO journal_entry (date, kind, title, body, mood, step_toward, prompts_json, tags_json, goal_id, letgo_id, created_at, updated_at)
           VALUES (@date, @kind, @title, @body, @mood, @step_toward, @prompts_json, @tags_json, @goal_id, @letgo_id, @at, @at)`
        )
        .run({ ...params(d), at })
      return this.get(Number(info.lastInsertRowid))!
    },

    update(id: number, d: JournalDraft, at: string): void {
      db.prepare(
        `UPDATE journal_entry SET date = @date, kind = @kind, title = @title, body = @body, mood = @mood,
                step_toward = @step_toward, prompts_json = @prompts_json, tags_json = @tags_json,
                goal_id = @goal_id, letgo_id = @letgo_id, updated_at = @at
          WHERE id = @id`
      ).run({ ...params(d), at, id })
    },

    remove(id: number): void {
      db.prepare('DELETE FROM journal_entry WHERE id = ?').run(id)
    },

    tools(): Tool[] {
      return (db.prepare('SELECT * FROM tool ORDER BY id').all() as ToolRow[]).map(toTool)
    },

    createTool(d: ToolDraft, at: string): Tool {
      const info = db
        .prepare('INSERT INTO tool (title, description, goal_id, habit_id, created_at) VALUES (?, ?, ?, ?, ?)')
        .run(d.title, d.description, d.goalId, d.habitId, at)
      return toTool(db.prepare('SELECT * FROM tool WHERE id = ?').get(Number(info.lastInsertRowid)) as ToolRow)
    },

    updateTool(id: number, d: ToolDraft): void {
      db.prepare('UPDATE tool SET title = ?, description = ?, goal_id = ?, habit_id = ? WHERE id = ?').run(
        d.title,
        d.description,
        d.goalId,
        d.habitId,
        id
      )
    },

    removeTool(id: number): void {
      db.prepare('DELETE FROM tool WHERE id = ?').run(id)
    }
  }
}

export type JournalRepo = ReturnType<typeof journalRepo>
