import type { LocalDate } from '@shared/types'
import { parseGoogleDue, toGoogleDue } from '../domain/time'
import { habitIdFromNotes, normaliseTitle } from './taskMapping'
import type { GoogleTask, TasksClient } from '../google/tasksClient'
import type { HabitRepo } from '../persistence/habitRepo'
import type { OccurrenceRepo } from '../persistence/occurrenceRepo'
import type { LogRepo } from '../persistence/logRepo'
import type { SyncRepo } from '../persistence/syncRepo'
import { tx, type Db } from '../persistence/db'

/** Overlap re-requested on every pull, so a change at the boundary is never skipped. */
export const OVERLAP_MS = 5 * 60_000

export interface PullResult {
  pulled: number
  applied: number
  affected: LocalDate[]
}

/**
 * Pulls changes from Google Tasks and pushes queued local changes back.
 *
 * The Tasks API has no sync token, so incremental pulls filter on `updatedMin`. Two
 * details keep that honest:
 *   - the watermark is re-requested with a five-minute overlap, and
 *   - it advances from the maximum `updated` the SERVER returned, never the local
 *     clock, so a skewed workstation cannot skip changes.
 */
export function taskSyncer(deps: {
  db: Db
  habits: HabitRepo
  occurrences: OccurrenceRepo
  logs: LogRepo
  sync: SyncRepo
  tasks: TasksClient
}) {
  const { db, habits, occurrences, logs, sync, tasks } = deps

  /** Resolve an incoming task to a local occurrence, claiming it when unambiguous. */
  function resolve(task: GoogleTask): { occurrenceId: number } | null {
    // 1. Definitive: we already know this task.
    const known = occurrences.getByGoogleTaskId(task.id)
    if (known) return { occurrenceId: known.id }

    const due = parseGoogleDue(task.due)
    if (!due) return null

    // 2. Our own marker survives the user renaming the task.
    const markerHabitId = habitIdFromNotes(task.notes)
    if (markerHabitId !== null) {
      const occ = occurrences.getByHabitDate(markerHabitId, due)
      if (occ && !occ.googleTaskId) {
        occurrences.setProvision(occ.id, 'created', task.id, task.etag ?? null, false)
        return { occurrenceId: occ.id }
      }
      if (occ?.googleTaskId === task.id) return { occurrenceId: occ.id }
    }

    // 3. Last resort: normalised title against an active habit on that date.
    const title = normaliseTitle(task.title)
    if (!title) return null
    const habit = habits.listActive().find((h) => normaliseTitle(h.name) === title)
    if (!habit) return null

    const occ = occurrences.getByHabitDate(habit.id, due)
    if (occ && !occ.googleTaskId) {
      occurrences.setProvision(occ.id, 'created', task.id, task.etag ?? null, false)
      return { occurrenceId: occ.id }
    }
    return occ ? { occurrenceId: occ.id } : null
  }

  /**
   * Apply one incoming task.
   *
   * Returns the date it touched and whether anything actually CHANGED. The distinction
   * matters because the five-minute overlap deliberately re-delivers tasks that are
   * already up to date — counting those as changes would make every idle sync look
   * busy in the status panel.
   */
  function apply(task: GoogleTask): { date: LocalDate; changed: boolean } | null {
    const hit = resolve(task)
    if (!hit) return null

    const occ = occurrences.get(hit.occurrenceId)
    if (!occ) return null

    // A task deleted in Google retires the occurrence but never rewrites history.
    if (task.deleted) {
      if (occ.deletedAt !== null) return { date: occ.date, changed: false }
      occurrences.softDelete(occ.id)
      sync.log('info', `"${task.title}" was deleted in Google — history kept`)
      return { date: occ.date, changed: true }
    }

    let changed = false

    // The user may have moved the task to another day in Google.
    const due = parseGoogleDue(task.due)
    if (due && due !== occ.date) {
      if (occurrences.getByHabitDate(occ.habitId, due)) {
        // That day already has an occurrence for this habit; moving would collide with
        // the (habit_id, date) uniqueness. Leave both alone and say so.
        sync.log(
          'warn',
          `"${task.title}" was moved to ${due}, which already has an occurrence — left on ${occ.date}`
        )
      } else {
        occurrences.reschedule(occ.id, due, occ.scheduledTime)
        changed = true
      }
    }

    if (task.status === 'completed') {
      const completedAt = task.completed ?? new Date().toISOString()
      if (occ.completedAt === null) {
        occurrences.setStatus(occ.id, 'complete', completedAt)
        changed = true
      }
      // Ticked in Google with no measured time: credit the target and badge it
      // `assumed`, so hours-improvement figures stay honest about their provenance.
      const measured = logs.totalFor(occ.id)
      if (measured.minutes === 0) {
        logs.setAssumed(occ.habitId, occ.id, occ.targetMinutes, completedAt)
        changed = true
      }
    } else if (occ.completedAt !== null) {
      // Un-ticked in Google. Drop the assumed credit but keep anything measured —
      // the recompute then lowers the score on its own.
      occurrences.setStatus(occ.id, 'pending', null)
      logs.clearAssumed(occ.id)
      sync.log('info', `"${task.title}" was un-ticked in Google — points recalculated`)
      changed = true
    }

    return { date: due ?? occ.date, changed }
  }

  return {
    resolve,

    async pull(tasklistId: string): Promise<PullResult> {
      const stored = sync.watermark(tasklistId)
      const since = stored ? new Date(new Date(stored).getTime() - OVERLAP_MS).toISOString() : null

      const incoming = await tasks.listChangedTasks(tasklistId, since)
      if (incoming.length === 0) {
        return { pulled: 0, applied: 0, affected: [] }
      }

      const affected = new Set<LocalDate>()
      let applied = 0

      tx(db, () => {
        for (const task of incoming) {
          const result = apply(task)
          if (result?.changed) {
            affected.add(result.date)
            applied++
          }
        }

        // Advance from the server's own timestamps, never Date.now().
        let maxUpdated = stored
        for (const t of incoming) {
          if (t.updated && (!maxUpdated || t.updated > maxUpdated)) maxUpdated = t.updated
        }
        if (maxUpdated) sync.setWatermark(tasklistId, maxUpdated)
      })

      return { pulled: incoming.length, applied, affected: [...affected].sort() }
    },

    /**
     * Drain queued local changes to Google.
     *
     * Conflict rule: if the remote task changed after the local op was queued, the
     * remote wins and the op is dropped with a log line. Nothing is silently
     * overwritten — the next pull brings the remote state in.
     */
    async push(tasklistId: string): Promise<{ pushed: number; conflicts: number }> {
      const queue = sync.queued()
      let pushed = 0
      let conflicts = 0

      for (const op of queue) {
        try {
          if (op.kind === 'patch') {
            const taskId = String(op.payload.taskId ?? '')
            if (!taskId) {
              sync.dequeue(op.id)
              continue
            }

            const remote = await tasks.getTask(tasklistId, taskId)
            if (remote.updated && remote.updated > op.createdAt) {
              conflicts++
              sync.log(
                'warn',
                `"${remote.title}" changed in Google after your local edit — Google kept, local change dropped`
              )
              sync.dequeue(op.id)
              continue
            }

            const status = op.payload.status === 'completed' ? 'completed' : 'needsAction'
            await tasks.patchTask(tasklistId, taskId, {
              status,
              completed: status === 'completed' ? String(op.payload.completed ?? '') || undefined : null
            })
            pushed++
            sync.dequeue(op.id)
          } else if (op.kind === 'delete') {
            const taskId = String(op.payload.taskId ?? '')
            if (taskId) await tasks.deleteTask(tasklistId, taskId)
            pushed++
            sync.dequeue(op.id)
          } else if (op.kind === 'create') {
            // Creation is owned by the provisioner; a stale create op is discarded.
            sync.dequeue(op.id)
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          sync.failOp(op.id, message)
          // Stop on the first failure: the rest will be retried next cycle, in order.
          break
        }
      }

      return { pushed, conflicts }
    },

    /**
     * Queue a local completion change for the next push. `now` is injectable so the
     * conflict comparison can be tested against a controlled server clock.
     */
    enqueueStatus(occurrenceId: number, completed: boolean, now: Date = new Date()): void {
      const occ = occurrences.get(occurrenceId)
      if (!occ?.googleTaskId) return
      sync.enqueue(
        'patch',
        occurrenceId,
        {
          taskId: occ.googleTaskId,
          status: completed ? 'completed' : 'needsAction',
          completed: completed ? now.toISOString() : null
        },
        now
      )
    },

    /** Queue a per-occurrence reschedule so Google's due date follows. */
    enqueueReschedule(occurrenceId: number, date: LocalDate): void {
      const occ = occurrences.get(occurrenceId)
      if (!occ?.googleTaskId) return
      sync.enqueue('patch', occurrenceId, {
        taskId: occ.googleTaskId,
        due: toGoogleDue(date),
        status: occ.completedAt ? 'completed' : 'needsAction'
      })
    }
  }
}

export type TaskSyncer = ReturnType<typeof taskSyncer>
