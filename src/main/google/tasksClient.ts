import { z } from 'zod'
import { ReauthRequired, type AuthService } from './authService'

const BASE = 'https://tasks.googleapis.com/tasks/v1'

/**
 * Google Tasks API v1.
 *
 * Every response is validated before it reaches the database — a shape change or an
 * error page must never be written in as if it were data.
 *
 * Two API facts drive the sync design and are worth restating here:
 *  - `due` is DATE-ONLY. The API discards the time portion, and a task's time of day
 *    can be neither read nor written. Time and duration live in the app.
 *  - There is no sync token and no watch/push mechanism, so incremental pulls use
 *    `updatedMin` and the app polls.
 */

export const TaskSchema = z.object({
  id: z.string(),
  etag: z.string().optional(),
  title: z.string().optional().default(''),
  notes: z.string().nullish(),
  status: z.enum(['needsAction', 'completed']).optional().default('needsAction'),
  due: z.string().nullish(),
  completed: z.string().nullish(),
  updated: z.string().optional(),
  deleted: z.boolean().optional(),
  hidden: z.boolean().optional(),
  parent: z.string().optional(),
  webViewLink: z.string().optional()
})
export type GoogleTask = z.infer<typeof TaskSchema>

const TaskListSchema = z.object({
  id: z.string(),
  title: z.string().optional().default(''),
  updated: z.string().optional()
})
export type GoogleTaskList = z.infer<typeof TaskListSchema>

const TasksPageSchema = z.object({
  items: z.array(TaskSchema).optional().default([]),
  nextPageToken: z.string().optional()
})

const ListsPageSchema = z.object({
  items: z.array(TaskListSchema).optional().default([]),
  nextPageToken: z.string().optional()
})

export class GoogleApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly retryable: boolean
  ) {
    super(message)
    this.name = 'GoogleApiError'
  }
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export function tasksClient(deps: { auth: AuthService; maxRetries?: number }) {
  const { auth } = deps
  const maxRetries = deps.maxRetries ?? 4

  async function request(
    path: string,
    init: { method?: string; query?: Record<string, string | undefined>; body?: unknown } = {}
  ): Promise<unknown> {
    const url = new URL(BASE + path)
    for (const [k, v] of Object.entries(init.query ?? {})) {
      if (v !== undefined) url.searchParams.set(k, v)
    }

    let attempt = 0
    for (;;) {
      const token = await auth.accessToken()
      const res = await fetch(url, {
        method: init.method ?? 'GET',
        headers: {
          authorization: `Bearer ${token}`,
          ...(init.body ? { 'content-type': 'application/json' } : {})
        },
        ...(init.body ? { body: JSON.stringify(init.body) } : {})
      })

      if (res.ok) {
        return res.status === 204 ? {} : await res.json()
      }

      const text = await res.text()

      if (res.status === 401) {
        // The access token was refused despite being fresh — the grant is gone.
        throw new ReauthRequired()
      }

      const retryable = res.status === 429 || res.status >= 500
      if (!retryable || attempt >= maxRetries) {
        throw new GoogleApiError(res.status, `${res.status} ${text.slice(0, 300)}`, retryable)
      }

      // Honour Retry-After when Google sends it; otherwise exponential backoff with
      // jitter so many clients do not retry in lockstep.
      const retryAfter = Number(res.headers.get('retry-after'))
      const backoff = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : Math.min(30_000, 2 ** attempt * 500) + Math.random() * 400
      await sleep(backoff)
      attempt++
    }
  }

  return {
    async listTaskLists(): Promise<GoogleTaskList[]> {
      const out: GoogleTaskList[] = []
      let pageToken: string | undefined
      do {
        const page = ListsPageSchema.parse(
          await request('/users/@me/lists', { query: { maxResults: '100', pageToken } })
        )
        out.push(...page.items)
        pageToken = page.nextPageToken
      } while (pageToken)
      return out
    },

    async createTaskList(title: string): Promise<GoogleTaskList> {
      return TaskListSchema.parse(
        await request('/users/@me/lists', { method: 'POST', body: { title } })
      )
    },

    /**
     * Incremental pull. `updatedMin` is the only change filter the API offers, and the
     * flags matter: without `showCompleted`/`showHidden` a completed task simply
     * vanishes from the response, which would look like a deletion.
     */
    async listChangedTasks(
      tasklistId: string,
      updatedMin: string | null
    ): Promise<GoogleTask[]> {
      const out: GoogleTask[] = []
      let pageToken: string | undefined
      do {
        const page = TasksPageSchema.parse(
          await request(`/lists/${encodeURIComponent(tasklistId)}/tasks`, {
            query: {
              maxResults: '100',
              showCompleted: 'true',
              showHidden: 'true',
              showDeleted: 'true',
              updatedMin: updatedMin ?? undefined,
              pageToken
            }
          })
        )
        out.push(...page.items)
        pageToken = page.nextPageToken
      } while (pageToken)
      return out
    },

    /** Tasks due within a date window — used by the adoption pass before creating. */
    async listTasksDueBetween(
      tasklistId: string,
      dueMin: string,
      dueMax: string
    ): Promise<GoogleTask[]> {
      const out: GoogleTask[] = []
      let pageToken: string | undefined
      do {
        const page = TasksPageSchema.parse(
          await request(`/lists/${encodeURIComponent(tasklistId)}/tasks`, {
            query: {
              maxResults: '100',
              showCompleted: 'true',
              showHidden: 'true',
              dueMin,
              dueMax,
              pageToken
            }
          })
        )
        out.push(...page.items)
        pageToken = page.nextPageToken
      } while (pageToken)
      return out
    },

    async getTask(tasklistId: string, taskId: string): Promise<GoogleTask> {
      return TaskSchema.parse(
        await request(
          `/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`
        )
      )
    },

    async createTask(
      tasklistId: string,
      task: { title: string; notes?: string; due?: string }
    ): Promise<GoogleTask> {
      return TaskSchema.parse(
        await request(`/lists/${encodeURIComponent(tasklistId)}/tasks`, {
          method: 'POST',
          body: task
        })
      )
    },

    async patchTask(
      tasklistId: string,
      taskId: string,
      patch: Partial<Pick<GoogleTask, 'title' | 'notes' | 'due' | 'status'>> & {
        completed?: string | null
      }
    ): Promise<GoogleTask> {
      return TaskSchema.parse(
        await request(
          `/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`,
          { method: 'PATCH', body: patch }
        )
      )
    },

    async deleteTask(tasklistId: string, taskId: string): Promise<void> {
      await request(
        `/lists/${encodeURIComponent(tasklistId)}/tasks/${encodeURIComponent(taskId)}`,
        { method: 'DELETE' }
      )
    }
  }
}

export type TasksClient = ReturnType<typeof tasksClient>
