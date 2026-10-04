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
import type { AttachmentStore } from '../platform/attachmentStore'

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
  goalViews: () => GoalView[]
}) {
  const { letGo, journal, goals, settings, files } = deps
  const today = (now: Date = new Date()): LocalDate => todayIn(settings.timezone(), now)

  function cleanLetGo(d: LetGoDraft): LetGoDraft {
    const title = d.title?.trim()
    if (!title) throw new Error('Name what you want to leave behind')
    if (!WEIGHTS.includes(d.weight)) throw new Error('Unknown weight')
    if (d.goalId !== null && !goals.get(d.goalId)) throw new Error('That mountain no longer exists')
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

  function view(id: number, now: Date = new Date()): LetGoView | null {
    const b = letGo.get(id)
    if (!b) return null
    const checkins = letGo.checkins(id)
    const t = today(now)
    const stats = letGoStats(checkins, b.startedOn, t)
    return {
      ...b,
      goalTitle: b.goalId !== null ? (goals.get(b.goalId)?.title ?? null) : null,
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

    letGoList(now: Date = new Date()): LetGoView[] {
      return letGo.list().map((b) => view(b.id, now)!)
    },

    letGoGet(id: number, now: Date = new Date()): LetGoView | null {
      return view(id, now)
    },

    letGoCreate(d: LetGoDraft): LetGoView {
      const b = letGo.create(cleanLetGo(d), new Date().toISOString())
      return view(b.id)!
    },

    letGoUpdate(id: number, d: LetGoDraft): void {
      if (!letGo.get(id)) throw new Error('That behaviour no longer exists')
      letGo.update(id, cleanLetGo(d))
    },

    checkIn(id: number, day: LocalDate, input: LetGoCheckinInput, now: Date = new Date()): void {
      const b = letGo.get(id)
      if (!b) throw new Error('That behaviour no longer exists')
      date(day, 'The check-in date')
      if (day > today(now)) throw new Error('A day that has not happened yet cannot be recorded')
      const feelings = [...new Set(input.feelings ?? [])].filter((f) => (LETGO_FEELINGS as readonly string[]).includes(f))
      letGo.putCheckin(
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

    clearCheckIn(id: number, day: LocalDate): void {
      letGo.clearCheckin(id, date(day, 'The check-in date'))
    },

    /** Symbolic: the behaviour moves to the cairn, but tracking can carry on. */
    leaveBehind(id: number, vow: string | null): void {
      const b = letGo.get(id)
      if (!b) throw new Error('That behaviour no longer exists')
      letGo.setStatus(id, 'left_behind', new Date().toISOString(), text(vow))
    },

    /** "You noticed it. You can continue." — history is untouched. */
    pickUpAgain(id: number): void {
      if (!letGo.get(id)) throw new Error('That behaviour no longer exists')
      letGo.setStatus(id, 'carrying', null)
    },

    letGoRemove(id: number): void {
      letGo.remove(id)
    },

    // ----------------------------------------------------------- journal

    journalList(): JournalEntry[] {
      return journal.list()
    },

    journalSave(id: number | null, d: JournalDraft): JournalEntry {
      const clean = cleanJournal(d)
      const at = new Date().toISOString()
      // A month keeps a single reflection page; writing it again updates that page.
      const existing = id ?? (clean.kind === 'monthly' ? (journal.monthly(clean.date)?.id ?? null) : null)
      let entryId: number
      if (existing !== null) {
        if (!journal.get(existing)) throw new Error('That entry no longer exists')
        journal.update(existing, clean, at)
        entryId = existing
      } else {
        entryId = journal.create(clean, at).id
      }
      if (d.attachmentIds !== undefined) {
        // Files taken off the entry are gone for good; the rest are linked to it.
        for (const gone of journal.attachmentsNotIn(entryId, d.attachmentIds)) {
          files.remove(gone.storedName)
          journal.deleteAttachment(gone.id)
        }
        journal.linkAttachments(entryId, d.attachmentIds)
      }
      return journal.get(entryId)!
    },

    journalRemove(id: number): void {
      for (const name of journal.storedNamesFor(id)) files.remove(name)
      journal.remove(id)
    },

    // ------------------------------------------------------- attachments

    /** Copies files in, unlinked, so the composer can preview them before the entry is saved. */
    importAttachments(paths: string[]): Attachment[] {
      const at = new Date().toISOString()
      return paths.map((p) => journal.insertAttachment(files.import(p), at))
    },

    setCaption(id: number, caption: string | null): void {
      if (!journal.attachment(id)) throw new Error('That file is no longer attached')
      journal.setCaption(id, text(caption))
    },

    /** Removes a file that is not yet part of a saved entry — the composer’s “remove”. */
    discardAttachment(id: number): void {
      const a = journal.attachment(id)
      if (!a) return
      if (a.journalId !== null) throw new Error('Remove it by editing its entry')
      files.remove(a.storedName)
      journal.deleteAttachment(id)
    },

    /** For the private protocol: a path only when the name is one of our stored files. */
    storedFilePath(storedName: string): string | null {
      return files.pathFor(storedName)
    },

    attachmentPath(id: number): string | null {
      const a = journal.attachment(id)
      return a ? files.pathFor(a.storedName) : null
    },

    /** Files imported for an entry that was never saved. */
    sweepAttachments(now: Date = new Date()): number {
      const stale = journal.unlinkedBefore(new Date(now.getTime() - 24 * 3_600_000).toISOString())
      for (const s of stale) {
        files.remove(s.storedName)
        journal.deleteAttachment(s.id)
      }
      return stale.length
    },

    // ------------------------------------------------------------- tools

    tools(): Tool[] {
      return journal.tools()
    },

    toolSave(id: number | null, d: ToolDraft): Tool {
      const clean = cleanTool(d)
      if (id === null) return journal.createTool(clean, new Date().toISOString())
      journal.updateTool(id, clean)
      return journal.tools().find((t) => t.id === id)!
    },

    toolRemove(id: number): void {
      journal.removeTool(id)
    },

    // ------------------------------------------------------------- guide

    guide(now: Date = new Date()): GuideInsight[] {
      const dismissed = new Set(settings.getFlag<string[]>('guideDismissed', []))
      return guideInsights({
        letGos: this.letGoList(now),
        journal: journal.list(),
        goals: deps.goalViews(),
        tools: journal.tools(),
        today: today(now)
      }).filter((i) => !dismissed.has(i.key))
    },

    dismissInsight(key: string): void {
      const dismissed = settings.getFlag<string[]>('guideDismissed', [])
      if (!dismissed.includes(key)) settings.setFlag('guideDismissed', [...dismissed, key].slice(-200))
    }
  }
}

export type ReflectService = ReturnType<typeof reflectService>
