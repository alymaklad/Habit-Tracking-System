import type { LocalDate } from '@shared/types'
import { subtasksSayComplete } from '../domain/todo'
import { todayIn } from '../domain/time'
import { tx, type Db } from '../persistence/db'
import type { OccurrenceRepo } from '../persistence/occurrenceRepo'
import type { SettingsRepo } from '../persistence/settingsRepo'
import type { TodoRepo } from '../persistence/todoRepo'
import type { HabitService } from './habitService'

/**
 * The to-do list.
 *
 * Two kinds of entry, one lifecycle:
 *   manual   — a standalone item that carries forward until done or dropped
 *   subtask  — a step of one habit occurrence; finishing every step completes it
 *
 * Manual items deliberately score nothing. The league measures habit improvement
 * against a target, and anything you can type and tick in two seconds would make XP
 * farmable — so to-dos get their own counter and never touch your level.
 */
export function todoService(deps: {
  db: Db
  todos: TodoRepo
  occurrences: OccurrenceRepo
  settings: SettingsRepo
  habits: HabitService
}) {
  const { db, todos, occurrences, settings, habits } = deps

  const today = (now: Date = new Date()): LocalDate => todayIn(settings.timezone(), now)

  /**
   * Reconcile a habit occurrence against its subtasks.
   *
   * Symmetric on purpose: finishing the last step completes the habit, and un-ticking
   * a step takes that completion back. Anything else would let a half-finished habit
   * keep credit it no longer deserves — the same principle the scoring engine follows
   * by recomputing rather than incrementing.
   *
   * An occurrence with no subtasks is left entirely alone, so the Done button, the
   * timer and a tick in Google all keep working as before.
   */
  function reconcileOccurrence(occurrenceId: number, now: Date = new Date()): void {
    const occ = occurrences.get(occurrenceId)
    if (!occ) return

    const verdict = subtasksSayComplete(todos.listSubtasks(occurrenceId))
    if (verdict === null) return

    const alreadyComplete = occ.completedAt !== null
    if (verdict && !alreadyComplete) {
      habits.setCompleted(occurrenceId, true, now)
    } else if (!verdict && alreadyComplete) {
      habits.setCompleted(occurrenceId, false, now)
    }
  }

  return {
    reconcileOccurrence,

    // ------------------------------------------------------------ manual

    addManual(
      title: string,
      date?: LocalDate,
      now: Date = new Date(),
      opts: { notes?: string | null; goalId?: number | null } = {}
    ): number {
      const trimmed = title.trim()
      if (!trimmed) throw new Error('A to-do needs a title')
      return todos.addManual(trimmed, date ?? today(now), opts.notes ?? null, opts.goalId ?? null)
    },

    /**
     * Move unfinished manual items onto today.
     *
     * Runs on startup and whenever the day rolls over. `created_on` is left untouched,
     * which is what makes "carried 3 days" derivable rather than guessed — and what
     * feeds the avoidance flags.
     */
    carryForward(now: Date = new Date()): number {
      const target = today(now)
      return tx(db, () => {
        const stragglers = todos.listStragglers(target)
        for (const item of stragglers) todos.carryTo(item.id, target)
        return stragglers.length
      })
    },

    // ---------------------------------------------------------- subtasks

    addSubtask(occurrenceId: number, title: string, now: Date = new Date()): number {
      const trimmed = title.trim()
      if (!trimmed) throw new Error('A step needs a title')
      const occ = occurrences.get(occurrenceId)
      if (!occ) throw new Error('No such occurrence')

      return tx(db, () => {
        const id = todos.addSubtask(occurrenceId, occ.habitId, trimmed)
        // Adding an unfinished step to a completed habit reopens it: the habit is no
        // longer done by its own definition.
        reconcileOccurrence(occurrenceId, now)
        return id
      })
    },

    /** Seed an occurrence from its habit's template, if it has one and no steps yet. */
    applyTemplate(occurrenceId: number): number {
      const occ = occurrences.get(occurrenceId)
      if (!occ) return 0
      return todos.applyTemplate(occurrenceId, occ.habitId)
    },

    setTemplates(habitId: number, titles: string[]): void {
      todos.setTemplates(habitId, titles)
    },

    templatesFor(habitId: number) {
      return todos.templatesFor(habitId)
    },

    /** Apply templates across the scheduled horizon, so future days arrive with steps. */
    applyTemplatesInRange(from: LocalDate, to: LocalDate): number {
      return tx(db, () => {
        let applied = 0
        for (const occ of occurrences.listInRange(from, to)) {
          if (occ.completedAt) continue
          applied += todos.applyTemplate(occ.id, occ.habitId)
        }
        return applied
      })
    },

    // -------------------------------------------------------- mutation

    setDone(id: number, done: boolean, now: Date = new Date()): void {
      const item = todos.get(id)
      if (!item) return

      tx(db, () => {
        todos.setDone(id, done, now.toISOString())
        if (item.kind === 'subtask' && item.occurrenceId !== null) {
          reconcileOccurrence(item.occurrenceId, now)
        }
      })
    },

    rename(id: number, title: string): void {
      if (!title.trim()) throw new Error('A to-do needs a title')
      todos.setTitle(id, title)
    },

    /** Give up on an item without pretending it was done. */
    drop(id: number, now: Date = new Date()): void {
      const item = todos.get(id)
      if (!item) return
      tx(db, () => {
        todos.drop(id, now.toISOString())
        // A dropped step no longer blocks the habit from being complete.
        if (item.kind === 'subtask' && item.occurrenceId !== null) {
          reconcileOccurrence(item.occurrenceId, now)
        }
      })
    },

    restore(id: number, now: Date = new Date()): void {
      const item = todos.get(id)
      if (!item) return
      tx(db, () => {
        todos.restore(id)
        if (item.kind === 'subtask' && item.occurrenceId !== null) {
          reconcileOccurrence(item.occurrenceId, now)
        }
      })
    },

    remove(id: number, now: Date = new Date()): void {
      const item = todos.get(id)
      if (!item) return
      tx(db, () => {
        todos.remove(id)
        if (item.kind === 'subtask' && item.occurrenceId !== null) {
          reconcileOccurrence(item.occurrenceId, now)
        }
      })
    },

    /** Push a manual item to a specific day, e.g. from the avoidance prompt. */
    reschedule(id: number, date: LocalDate): void {
      const item = todos.get(id)
      if (!item || item.kind !== 'manual') return
      todos.carryTo(id, date)
    }
  }
}

export type TodoService = ReturnType<typeof todoService>
