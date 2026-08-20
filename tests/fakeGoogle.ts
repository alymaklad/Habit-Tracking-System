import type { GoogleTask, GoogleTaskList, TasksClient } from '@main/google/tasksClient'

/**
 * An in-memory stand-in for Google Tasks.
 *
 * It reproduces the behaviours the sync design actually depends on:
 *  - server-assigned ids (the API accepts no client-supplied id)
 *  - `due` stored date-only, exactly as the API does
 *  - a server-side `updated` timestamp that drives the watermark
 *  - `updatedMin` filtering, and deleted/completed tasks still being returned
 */
export class FakeGoogle {
  private tasks = new Map<string, GoogleTask>()
  private lists = new Map<string, GoogleTaskList>()
  private seq = 0
  private clock = new Date('2026-08-20T20:00:00.000Z').getTime()

  /** Fails the next N calls of any kind, to exercise retry and crash paths. */
  failNextCreates = 0
  createCalls = 0

  constructor() {
    this.lists.set('list-habits', { id: 'list-habits', title: 'Habits' })
  }

  private tick(): string {
    this.clock += 1000
    return new Date(this.clock).toISOString()
  }

  advanceClock(ms: number): void {
    this.clock += ms
  }

  now(): string {
    return new Date(this.clock).toISOString()
  }

  /** Simulates the user ticking the task in the Google Tasks app. */
  completeInGoogle(taskId: string): void {
    const t = this.tasks.get(taskId)
    if (!t) throw new Error(`no such task ${taskId}`)
    const at = this.tick()
    this.tasks.set(taskId, { ...t, status: 'completed', completed: at, updated: at })
  }

  uncompleteInGoogle(taskId: string): void {
    const t = this.tasks.get(taskId)
    if (!t) throw new Error(`no such task ${taskId}`)
    const at = this.tick()
    this.tasks.set(taskId, { ...t, status: 'needsAction', completed: null, updated: at })
  }

  deleteInGoogle(taskId: string): void {
    const t = this.tasks.get(taskId)
    if (!t) throw new Error(`no such task ${taskId}`)
    this.tasks.set(taskId, { ...t, deleted: true, updated: this.tick() })
  }

  renameInGoogle(taskId: string, title: string): void {
    const t = this.tasks.get(taskId)
    if (!t) throw new Error(`no such task ${taskId}`)
    this.tasks.set(taskId, { ...t, title, updated: this.tick() })
  }

  rescheduleInGoogle(taskId: string, due: string): void {
    const t = this.tasks.get(taskId)
    if (!t) throw new Error(`no such task ${taskId}`)
    this.tasks.set(taskId, { ...t, due, updated: this.tick() })
  }

  /** A task the user created by hand, with no app marker. */
  seedUserTask(title: string, due: string): GoogleTask {
    const id = `user-${++this.seq}`
    const task: GoogleTask = {
      id,
      title,
      notes: null,
      status: 'needsAction',
      due: `${due.slice(0, 10)}T00:00:00.000Z`,
      completed: null,
      updated: this.tick(),
      etag: `etag-${id}`
    }
    this.tasks.set(id, task)
    return task
  }

  all(): GoogleTask[] {
    return [...this.tasks.values()]
  }

  live(): GoogleTask[] {
    return this.all().filter((t) => !t.deleted)
  }

  countTitled(title: string): number {
    return this.live().filter((t) => t.title === title).length
  }

  client(): TasksClient {
    const self = this
    return {
      async listTaskLists() {
        return [...self.lists.values()]
      },

      async createTaskList(title: string) {
        const id = `list-${++self.seq}`
        const list = { id, title }
        self.lists.set(id, list)
        return list
      },

      async listChangedTasks(_tasklistId: string, updatedMin: string | null) {
        return self
          .all()
          .filter((t) => !updatedMin || (t.updated ?? '') >= updatedMin)
          .sort((a, b) => (a.updated ?? '').localeCompare(b.updated ?? ''))
      },

      async listTasksDueBetween(_tasklistId: string, dueMin: string, dueMax: string) {
        const lo = dueMin.slice(0, 10)
        const hi = dueMax.slice(0, 10)
        return self.live().filter((t) => {
          const d = (t.due ?? '').slice(0, 10)
          return d >= lo && d <= hi
        })
      },

      async getTask(_tasklistId: string, taskId: string) {
        const t = self.tasks.get(taskId)
        if (!t) throw new Error(`404 no such task ${taskId}`)
        return t
      },

      async createTask(_tasklistId, task) {
        self.createCalls++
        if (self.failNextCreates > 0) {
          self.failNextCreates--
          // The task IS created server-side, then the response is lost — exactly the
          // crash window that would otherwise produce a duplicate.
          const id = `task-${++self.seq}`
          self.tasks.set(id, {
            id,
            title: task.title,
            notes: task.notes ?? null,
            status: 'needsAction',
            due: task.due ? `${task.due.slice(0, 10)}T00:00:00.000Z` : null,
            completed: null,
            updated: self.tick(),
            etag: `etag-${id}`
          })
          throw new Error('simulated network failure after create')
        }

        const id = `task-${++self.seq}`
        const created: GoogleTask = {
          id,
          title: task.title,
          notes: task.notes ?? null,
          status: 'needsAction',
          // The API discards the time portion of `due`.
          due: task.due ? `${task.due.slice(0, 10)}T00:00:00.000Z` : null,
          completed: null,
          updated: self.tick(),
          etag: `etag-${id}`
        }
        self.tasks.set(id, created)
        return created
      },

      async patchTask(_tasklistId, taskId, patch) {
        const t = self.tasks.get(taskId)
        if (!t) throw new Error(`404 no such task ${taskId}`)
        const next: GoogleTask = {
          ...t,
          ...(patch.title !== undefined ? { title: patch.title } : {}),
          ...(patch.notes !== undefined ? { notes: patch.notes } : {}),
          ...(patch.due !== undefined
            ? { due: patch.due ? `${patch.due.slice(0, 10)}T00:00:00.000Z` : null }
            : {}),
          ...(patch.status !== undefined ? { status: patch.status } : {}),
          ...(patch.completed !== undefined ? { completed: patch.completed } : {}),
          updated: self.tick()
        }
        self.tasks.set(taskId, next)
        return next
      },

      async deleteTask(_tasklistId, taskId) {
        const t = self.tasks.get(taskId)
        if (t) self.tasks.set(taskId, { ...t, deleted: true, updated: self.tick() })
      }
    }
  }
}
