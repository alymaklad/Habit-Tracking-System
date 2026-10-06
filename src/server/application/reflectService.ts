import {
  LETGO_FEELINGS,
  MOODS,
  TRIGGER_CONTEXTS,
  type Attachment,
  type GoalView,
  type GuideInsight,
  type JournalDraft,
  type JournalEntry,
  type LetGoCheckinInput,
  type LetGoDraft,
  type LetGoView,
  type LocalDate,
  type Tool,
  type ToolDraft
} from '@shared/types'
import { DATE_RE, todayIn } from '../domain/time'
import { alternativeCounts, ceremonyReady, feelingPatterns, letGoStats } from '../domain/letGo'
import { guideInsights } from '../domain/guide'
import type { GoalRepo } from '../persistence/goalRepo'
import type { JournalRepo } from '../persistence/journalRepo'
import type { LetGoRepo } from '../persistence/letGoRepo'
import type { SettingsRepo } from '../persistence/settingsRepo'
import { MAX_ATTACHMENT_BYTES, mimeFor, type AttachmentStore, type StoredFile } from '../platform/attachmentStore'

/** What the browser reports after uploading a file under the name the server gave it. */
export interface UploadedFile {
  storedName: string
  originalName: string
}

const WEIGHTS = ['light', 'medium', 'heavy'] as const
const KINDS = ['free', 'daily', 'deep', 'monthly'] as const
const STEPS = ['yes', 'little', 'not_today'] as const

const text = (v: string | null | undefined): string | null => {
  const t = v?.trim()
  return t ? t : null
}

function date(d: string, what: string): LocalDate {
  if (!DATE_RE.test(d)) throw new Error(`${what} must be a date`)
  return d
}

/**
 * Let Go, the Journal, Tools and the Guide: the reflective half of the climb. Nothing here
 * scores or awards XP — these records exist for the user to understand themselves.
 */
export function reflectService(deps: {
  letGo: LetGoRepo
  journal: JournalRepo
  goals: GoalRepo
  settings: SettingsRepo
  files: AttachmentStore
  goalViews: () => Promise<GoalView[]>
}) {
  const { letGo, journal, goals, settings, files } = deps
  const today = async (now: Date = new Date()): Promise<LocalDate> => todayIn(await settings.timezone(), now)

  async function cleanLetGo(d: LetGoDraft): Promise<LetGoDraft> {
    const title = d.title?.trim()
    if (!title) throw new Error('Name what you want to leave behind')
    if (!WEIGHTS.includes(d.weight)) throw new Error('Unknown weight')
    if (d.goalId !== null && !(await goals.get(d.goalId))) throw new Error('That mountain no longer exists')
    return {
      title,
      triggerContexts: [...new Set(d.triggerContexts)].filter((c) => (TRIGGER_CONTEXTS as readonly string[]).includes(c)),
      triggerNotes: text(d.triggerNotes),
      replacement: text(d.replacement),
      goalId: d.goalId,
      weight: d.weight,
      startedOn: date(d.startedOn, 'The start date')
    }
  }

  async function view(id: number, now: Date = new Date()): Promise<LetGoView | null> {
    const b = await letGo.get(id)
    if (!b) return null
    const checkins = await letGo.checkins(id)
    const t = await today(now)
    const stats = letGoStats(checkins, b.startedOn, t)
    return {
      ...b,
      goalTitle: b.goalId !== null ? ((await goals.get(b.goalId))?.title ?? null) : null,
      stats,
      checkins,
      today: checkins.find((c) => c.date === t) ?? null,
      feelings: feelingPatterns(checkins),
      alternatives: alternativeCounts(checkins),
      ceremonyReady: ceremonyReady(stats, b.status)
    }
  }

  function cleanJournal(d: JournalDraft): JournalDraft {
    if (!KINDS.includes(d.kind)) throw new Error('Unknown kind of entry')
    if (d.mood !== null && !MOODS.includes(d.mood)) throw new Error('Unknown mood')
    if (d.stepToward !== null && !STEPS.includes(d.stepToward)) throw new Error('Unknown answer')
    const prompts = Object.fromEntries(Object.entries(d.prompts ?? {}).map(([k, v]) => [k, v.trim()]).filter(([, v]) => v))
    const body = d.body?.trim() ?? ''
    const entry: JournalDraft = {
      date: date(d.date, 'The entry date'),
      kind: d.kind,
      title: text(d.title),
      body,
      mood: d.mood,
      stepToward: d.stepToward,
      prompts,
      tags: [...new Set((d.tags ?? []).map((t) => t.trim().replace(/^#/, '').toLowerCase()).filter(Boolean))],
      goalId: d.goalId,
      letGoId: d.letGoId
    }
    if (entry.kind === 'monthly') entry.date = `${entry.date.slice(0, 7)}-01`
    if (!body && Object.keys(prompts).length === 0 && entry.mood === null && entry.stepToward === null && !(d.attachmentIds ?? []).length) {
      throw new Error('There is nothing written yet')
    }
    return entry
  }

  function cleanTool(d: ToolDraft): ToolDraft {
    const title = d.title?.trim()
    if (!title) throw new Error('Name what helps you climb')
    return { title, description: text(d.description), goalId: d.goalId, habitId: d.habitId }
  }

  return {
    // ------------------------------------------------------------ let go

    async letGoList(now: Date = new Date()): Promise<LetGoView[]> {
      const views = await Promise.all((await letGo.list()).map((b) => view(b.id, now)))
      return views.filter((v): v is LetGoView => v !== null)
    },

    letGoGet(id: number, now: Date = new Date()): Promise<LetGoView | null> {
      return view(id, now)
    },

    async letGoCreate(d: LetGoDraft): Promise<LetGoView> {
      const b = await letGo.create(await cleanLetGo(d), new Date().toISOString())
      return (await view(b.id))!
    },

    async letGoUpdate(id: number, d: LetGoDraft): Promise<void> {
      if (!(await letGo.get(id))) throw new Error('That behaviour no longer exists')
      await letGo.update(id, await cleanLetGo(d))
    },

    async checkIn(id: number, day: LocalDate, input: LetGoCheckinInput, now: Date = new Date()): Promise<void> {
      const b = await letGo.get(id)
      if (!b) throw new Error('That behaviour no longer exists')
      date(day, 'The check-in date')
      if (day > (await today(now))) throw new Error('A day that has not happened yet cannot be recorded')
      const feelings = [...new Set(input.feelings ?? [])].filter((f) => (LETGO_FEELINGS as readonly string[]).includes(f))
      await letGo.putCheckin(
        id,
        day,
        {
          resisted: !!input.resisted,
          // A free day has no urge to explain; keep only what belongs to each answer.
          feelings: input.resisted ? [] : feelings,
          trigger: input.resisted ? null : text(input.trigger),
          need: input.resisted ? null : text(input.need),
          alternative: input.resisted ? text(input.alternative) : null,
          note: text(input.note)
        },
        new Date().toISOString()
      )
    },

    async clearCheckIn(id: number, day: LocalDate): Promise<void> {
      await letGo.clearCheckin(id, date(day, 'The check-in date'))
    },

    /** Symbolic: the behaviour moves to the cairn, but tracking can carry on. */
    async leaveBehind(id: number, vow: string | null): Promise<void> {
      const b = await letGo.get(id)
      if (!b) throw new Error('That behaviour no longer exists')
      await letGo.setStatus(id, 'left_behind', new Date().toISOString(), text(vow))
    },

    /** "You noticed it. You can continue." — history is untouched. */
    async pickUpAgain(id: number): Promise<void> {
      if (!(await letGo.get(id))) throw new Error('That behaviour no longer exists')
      await letGo.setStatus(id, 'carrying', null)
    },

    async letGoRemove(id: number): Promise<void> {
      await letGo.remove(id)
    },

    // ----------------------------------------------------------- journal

    journalList(): Promise<JournalEntry[]> {
      return journal.list()
    },

    async journalSave(id: number | null, d: JournalDraft): Promise<JournalEntry> {
      const clean = cleanJournal(d)
      const at = new Date().toISOString()
      // A month keeps a single reflection page; writing it again updates that page.
      const existing = id ?? (clean.kind === 'monthly' ? ((await journal.monthly(clean.date))?.id ?? null) : null)
      let entryId: number
      if (existing !== null) {
        if (!(await journal.get(existing))) throw new Error('That entry no longer exists')
        await journal.update(existing, clean, at)
        entryId = existing
      } else {
        entryId = (await journal.create(clean, at)).id
      }
      if (d.attachmentIds !== undefined) {
        // Files taken off the entry are gone for good; the rest are linked to it.
        for (const gone of await journal.attachmentsNotIn(entryId, d.attachmentIds)) {
          await files.remove(gone.storedName)
          await journal.deleteAttachment(gone.id)
        }
        await journal.linkAttachments(entryId, d.attachmentIds)
      }
      return (await journal.get(entryId))!
    },

    async journalRemove(id: number): Promise<void> {
      for (const name of await journal.storedNamesFor(id)) await files.remove(name)
      await journal.remove(id)
    },

    // ------------------------------------------------------- attachments

    /**
     * Records files the browser has just uploaded, unlinked, so the composer can preview
     * them before the entry is saved. Each one must really be in this account's store.
     */
    async registerAttachments(uploads: UploadedFile[]): Promise<Attachment[]> {
      const at = new Date().toISOString()
      const out: Attachment[] = []
      for (const u of uploads.slice(0, 12)) {
        const mime = mimeFor(u.storedName)
        if (!mime) throw new Error(`${u.originalName} can’t be attached — use an image, PDF, text or Office file.`)
        const size = await files.size(u.storedName)
        if (size === null) throw new Error(`${u.originalName} did not finish uploading. Try again.`)
        if (size > MAX_ATTACHMENT_BYTES) {
          await files.remove(u.storedName)
          throw new Error(`${u.originalName} is larger than 25 MB.`)
        }
        const name = u.originalName.trim().slice(0, 200) || u.storedName
        out.push(await journal.insertAttachment({ storedName: u.storedName, originalName: name, mime, size }, at))
      }
      return out
    },

    async setCaption(id: number, caption: string | null): Promise<void> {
      if (!(await journal.attachment(id))) throw new Error('That file is no longer attached')
      await journal.setCaption(id, text(caption))
    },

    /** Removes a file that is not yet part of a saved entry — the composer’s “remove”. */
    async discardAttachment(id: number): Promise<void> {
      const a = await journal.attachment(id)
      if (!a) return
      if (a.journalId !== null) throw new Error('Remove it by editing its entry')
      await files.remove(a.storedName)
      await journal.deleteAttachment(id)
    },

    /** The file behind `/api/files/<name>` — only when it is one of this account's attachments. */
    async readAttachment(storedName: string): Promise<(StoredFile & { originalName: string }) | null> {
      const a = await journal.attachmentByStoredName(storedName)
      if (!a) return null
      const file = await files.read(storedName)
      return file ? { ...file, originalName: a.originalName } : null
    },

    /** Files imported for an entry that was never saved. */
    async sweepAttachments(now: Date = new Date()): Promise<number> {
      const stale = await journal.unlinkedBefore(new Date(now.getTime() - 24 * 3_600_000).toISOString())
      for (const s of stale) {
        await files.remove(s.storedName)
        await journal.deleteAttachment(s.id)
      }
      return stale.length
    },

    // ------------------------------------------------------------- tools

    tools(): Promise<Tool[]> {
      return journal.tools()
    },

    async toolSave(id: number | null, d: ToolDraft): Promise<Tool> {
      const clean = cleanTool(d)
      if (id === null) return journal.createTool(clean, new Date().toISOString())
      await journal.updateTool(id, clean)
      return (await journal.tools()).find((t) => t.id === id)!
    },

    async toolRemove(id: number): Promise<void> {
      await journal.removeTool(id)
    },

    // ------------------------------------------------------------- guide

    async guide(now: Date = new Date()): Promise<GuideInsight[]> {
      const dismissed = new Set(await settings.getFlag<string[]>('guideDismissed', []))
      return guideInsights({
        letGos: await this.letGoList(now),
        journal: await journal.list(),
        goals: await deps.goalViews(),
        tools: await journal.tools(),
        today: await today(now)
      }).filter((i) => !dismissed.has(i.key))
    },

    async dismissInsight(key: string): Promise<void> {
      const dismissed = await settings.getFlag<string[]>('guideDismissed', [])
      if (!dismissed.includes(key)) await settings.setFlag('guideDismissed', [...dismissed, key].slice(-200))
    }
  }
}

export type ReflectService = ReturnType<typeof reflectService>
