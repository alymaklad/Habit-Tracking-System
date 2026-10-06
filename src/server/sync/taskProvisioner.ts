import type { LocalDate, Occurrence } from '@shared/types'
import { addDays, parseGoogleDue, toGoogleDue } from '../domain/time'
import { buildNotes, habitIdFromNotes, normaliseTitle } from './taskMapping'
import type { TasksClient, GoogleTask } from '../google/tasksClient'
import type { HabitRepo } from '../persistence/habitRepo'
import type { OccurrenceRepo } from '../persistence/occurrenceRepo'
import type { SettingsRepo } from '../persistence/settingsRepo'
import type { SyncRepo } from '../persistence/syncRepo'

export const DEFAULT_LIST_TITLE = 'Habits'
const TASKLIST_FLAG = 'tasklistId'
const TASKLIST_NAME_FLAG = 'tasklistName'

/**
 * Creates the Google task that stands behind each scheduled occurrence, so a habit can
 * be ticked from a phone.
 *
 * The Tasks API does not accept a client-supplied id, so "create exactly once" cannot
 * be expressed as an idempotency key. Three defences stand in for one:
 *
 *   1. `occurrence.google_task_id` is UNIQUE and `(habit_id, date)` is UNIQUE;
 *   2. before creating anything, an ADOPTION pass claims a matching task that already
 *      exists — by marker, or by normalised title and due date;
 *   3. `provision_state` records the in-flight window, and `reconcile()` re-runs the
 *      adoption pass at startup to claim orphans left by a crash mid-create.
 */
export function taskProvisioner(deps: {
  habits: HabitRepo
  occurrences: OccurrenceRepo
  settings: SettingsRepo
  sync: SyncRepo
  tasks: TasksClient
}) {
  const { habits, occurrences, settings, sync, tasks } = deps

  async function resolveTasklistId(): Promise<string> {
    const stored = await settings.getFlag<string | null>(TASKLIST_FLAG, null)
    if (stored) return stored

    const lists = await tasks.listTaskLists()
    const existing = lists.find((l) => l.title === DEFAULT_LIST_TITLE)
    const list = existing ?? (await tasks.createTaskList(DEFAULT_LIST_TITLE))

    await settings.setFlag(TASKLIST_FLAG, list.id)
    await settings.setFlag(TASKLIST_NAME_FLAG, list.title)
    await sync.log('info', `Using Google Tasks list "${list.title}"`)
    return list.id
  }

  async function tasklistName(): Promise<string | null> {
    return settings.getFlag<string | null>(TASKLIST_NAME_FLAG, null)
  }

  /** Index of the tasks already present in a date window, for adoption. */
  async function adoptionIndex(tasklistId: string, from: LocalDate, to: LocalDate) {
    // dueMax is exclusive of the following day's tasks only if we pad it by one.
    const existing = await tasks.listTasksDueBetween(
      tasklistId,
      toGoogleDue(from),
      toGoogleDue(addDays(to, 1))
    )

    const byMarker = new Map<string, GoogleTask>()
    const byTitle = new Map<string, GoogleTask>()

    for (const t of existing) {
      if (t.deleted) continue
      const due = parseGoogleDue(t.due)
      if (!due) continue
      const habitId = habitIdFromNotes(t.notes)
      if (habitId !== null) byMarker.set(`${habitId}|${due}`, t)
      const title = normaliseTitle(t.title)
      if (title) byTitle.set(`${title}|${due}`, t)
    }

    return { byMarker, byTitle }
  }

  async function provisionOne(
    tasklistId: string,
    occ: Occurrence,
    index: Awaited<ReturnType<typeof adoptionIndex>>
  ): Promise<'adopted' | 'created' | 'skipped'> {
    const habit = await habits.get(occ.habitId)
    if (!habit) return 'skipped'

    // 1. Adopt anything that already represents this habit on this day.
    const adopted =
      index.byMarker.get(`${occ.habitId}|${occ.date}`) ??
      index.byTitle.get(`${normaliseTitle(habit.name)}|${occ.date}`)

    if (adopted) {
      // Another occurrence may already own it — the UNIQUE index is the backstop.
      const claimed = await occurrences.getByGoogleTaskId(adopted.id)
      if (!claimed || claimed.id === occ.id) {
        await occurrences.setProvision(occ.id, 'created', adopted.id, adopted.etag ?? null, false)
        return 'adopted'
      }
    }

    // 2. Otherwise create it, marking the in-flight window first so a crash here is
    //    recoverable by reconcile() rather than producing a duplicate next run.
    await occurrences.setProvisionState(occ.id, 'creating')
    try {
      const created = await tasks.createTask(tasklistId, {
        title: habit.name,
        notes: buildNotes(habit, occ.scheduledTime),
        due: toGoogleDue(occ.date)
      })
      await occurrences.setProvision(occ.id, 'created', created.id, created.etag ?? null, true)
      index.byMarker.set(`${occ.habitId}|${occ.date}`, created)
      return 'created'
    } catch (err) {
      // Deliberately leave the state as `creating`. We cannot know whether the task
      // reached Google before the failure, and `creating` is the honest record of that
      // ambiguity — it keeps the row out of the create queue until `reconcile()` has
      // looked for an orphan. Marking it `failed` here would send the next run
      // straight back to createTask and produce the duplicate this guards against.
      throw err
    }
  }

  return {
    resolveTasklistId,
    tasklistName,

    async setTasklist(id: string, name: string): Promise<void> {
      await settings.setFlag(TASKLIST_FLAG, id)
      await settings.setFlag(TASKLIST_NAME_FLAG, name)
    },

    /**
     * Claim tasks a previous run created but never recorded. Runs at startup, before
     * any provisioning, so a crash mid-create costs an extra lookup rather than a
     * duplicate task in the user's list.
     */
    async reconcile(from: LocalDate, to: LocalDate): Promise<number> {
      const stranded = (await occurrences.listInRange(from, to)).filter((o) => o.provisionState === 'creating' && o.googleTaskId === null)
      if (stranded.length === 0) return 0

      const tasklistId = await resolveTasklistId()
      const index = await adoptionIndex(tasklistId, from, to)

      let adopted = 0
      for (const occ of stranded) {
        const habit = await habits.get(occ.habitId)
        if (!habit) continue
        const match =
          index.byMarker.get(`${occ.habitId}|${occ.date}`) ??
          index.byTitle.get(`${normaliseTitle(habit.name)}|${occ.date}`)
        if (match && !(await occurrences.getByGoogleTaskId(match.id))) {
          await occurrences.setProvision(occ.id, 'created', match.id, match.etag ?? null, true)
          adopted++
        } else {
          // Nothing to adopt: put it back in the queue to be created normally.
          await occurrences.setProvisionState(occ.id, 'none')
        }
      }

      if (adopted > 0) {
        await sync.log('warn', `Adopted ${adopted} orphaned Google task(s) left by a previous run`)
      }
      return adopted
    },

    /** Ensure every scheduled occurrence in the window has a Google task. */
    async provision(from: LocalDate, to: LocalDate): Promise<{ created: number; adopted: number }> {
      const pending = await occurrences.listUnprovisioned(from, to)
      if (pending.length === 0) return { created: 0, adopted: 0 }

      const tasklistId = await resolveTasklistId()
      const index = await adoptionIndex(tasklistId, from, to)

      let created = 0
      let adopted = 0
      for (const occ of pending) {
        const outcome = await provisionOne(tasklistId, occ, index)
        if (outcome === 'created') created++
        else if (outcome === 'adopted') adopted++
      }

      if (created || adopted) {
        await sync.log('info', `Provisioned ${created} new task(s), adopted ${adopted}`)
      }
      return { created, adopted }
    },

    /**
     * Remove future tasks a schedule change orphaned. Only tasks THIS APP created are
     * ever deleted — anything the user made themselves is left alone.
     */
    async removeOrphans(occurrenceIds: number[]): Promise<number> {
      if (occurrenceIds.length === 0) return 0
      const tasklistId = await resolveTasklistId()

      let removed = 0
      for (const id of occurrenceIds) {
        const occ = await occurrences.get(id)
        if (!occ?.googleTaskId || !occ.createdByApp) continue
        try {
          await tasks.deleteTask(tasklistId, occ.googleTaskId)
          removed++
        } catch {
          // Already gone in Google is a fine outcome; the local row still goes.
        }
        await occurrences.hardDelete(id)
      }
      if (removed) await sync.log('info', `Removed ${removed} task(s) no longer scheduled`)
      return removed
    }
  }
}

export type TaskProvisioner = ReturnType<typeof taskProvisioner>
