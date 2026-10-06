import { upload } from '@vercel/blob/client'
import type { HabitApi } from '@shared/api'
import type { Attachment, GoalPlanProgress, RpcLine, SyncStatus, ToastMessage } from '@shared/types'

/**
 * `window.api` in the browser: every call is a POST to `/api/rpc/<channel>`.
 *
 * The server answers with newline-delimited JSON — events while the call runs (sync
 * status, AI planning progress, notifications, "data changed"), then one result or
 * error. Events go to the same listeners the desktop app's IPC pushes used to reach, so
 * the screens did not have to change.
 */

type Listener<T> = (payload: T) => void
const listeners = {
  syncStatus: new Set<Listener<SyncStatus>>(),
  dataChanged: new Set<Listener<void>>(),
  toast: new Set<Listener<ToastMessage>>(),
  goalProgress: new Set<Listener<GoalPlanProgress>>()
}

function subscribe<T>(set: Set<Listener<T>>, cb: Listener<T>): () => void {
  set.add(cb)
  return () => set.delete(cb)
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message)
  }
}

/** Fired when the server says the session is gone, so the app can show the welcome screen. */
export const SIGNED_OUT_EVENT = 'khatwa:signed-out'

function notify(title: string, body: string): void {
  // A system notification when the user allowed them and is looking elsewhere;
  // otherwise the app's own toast.
  if (typeof Notification !== 'undefined' && Notification.permission === 'granted' && document.visibilityState === 'hidden') {
    new Notification(title, { body, icon: '/favicon.png' })
    return
  }
  for (const cb of listeners.toast) cb({ kind: 'info', title, body })
}

function dispatch(line: RpcLine): void {
  if (!('event' in line)) return
  switch (line.event) {
    case 'syncStatus':
      for (const cb of listeners.syncStatus) cb(line.data)
      break
    case 'toast':
      for (const cb of listeners.toast) cb(line.data)
      break
    case 'goalProgress':
      for (const cb of listeners.goalProgress) cb(line.data)
      break
    case 'notify':
      notify(line.data.title, line.data.body)
      break
    case 'dataChanged':
      for (const cb of listeners.dataChanged) cb()
      break
  }
}

async function invoke<T>(channel: string, ...args: unknown[]): Promise<T> {
  // Trailing `undefined`s would arrive as nulls and defeat the server's defaults.
  while (args.length && args[args.length - 1] === undefined) args.pop()
  const res = await fetch(`/api/rpc/${channel}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json', 'x-khatwa': '1' },
    body: JSON.stringify(args)
  })
  if (!res.body) throw new ApiError(`The server did not answer (${res.status}).`, res.status)

  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''
  let outcome: { result: unknown } | { error: { message: string; status: number } } | null = null
  for (;;) {
    const { value, done } = await reader.read()
    if (value) buffer += value
    let nl: number
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const text = buffer.slice(0, nl).trim()
      buffer = buffer.slice(nl + 1)
      if (!text) continue
      const line = JSON.parse(text) as RpcLine
      if ('result' in line || 'error' in line) outcome = line
      else dispatch(line)
    }
    if (done) break
  }

  if (!outcome) throw new ApiError(`The connection closed before an answer arrived (${res.status}).`, res.status)
  if ('error' in outcome) {
    if (outcome.error.status === 401) window.dispatchEvent(new Event(SIGNED_OUT_EVENT))
    throw new ApiError(outcome.error.message, outcome.error.status)
  }
  return outcome.result as T
}

/** Leaves the page for a server route that redirects through Google and back. */
function navigateAway(path: string): Promise<never> {
  window.location.assign(path)
  return new Promise(() => undefined)
}

const ACCEPT = '.png,.jpg,.jpeg,.gif,.webp,.pdf,.txt,.md,.docx,.xlsx,.pptx'

function pickFiles(): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    input.accept = ACCEPT
    input.onchange = () => resolve([...(input.files ?? [])])
    input.oncancel = () => resolve([])
    input.click()
  })
}

interface Prepared {
  originalName: string
  storedName: string
  mode: 'blob' | 'local'
  pathname: string
}

async function uploadFiles(files: File[]): Promise<Attachment[]> {
  if (files.length === 0) return []
  const plans = await invoke<Prepared[]>('attachments:prepare', files.map((f) => f.name))
  await Promise.all(
    plans.map(async (p, i) => {
      const file = files[i]!
      if (p.mode === 'blob') {
        // Straight from the browser to private storage; the server only hands out a
        // token for this exact name in this account's folder.
        await upload(p.pathname, file, {
          access: 'private',
          handleUploadUrl: '/api/files/token',
          headers: { 'x-khatwa': '1' },
          contentType: file.type || undefined
        })
      } else {
        const res = await fetch(p.pathname, { method: 'PUT', body: file, headers: { 'x-khatwa': '1' }, credentials: 'same-origin' })
        if (!res.ok) throw new ApiError(`${file.name} could not be uploaded (${res.status}).`, res.status)
      }
    })
  )
  return invoke('attachments:register', plans.map((p) => ({ storedName: p.storedName, originalName: p.originalName })))
}

let config: Promise<{ version: string; google: boolean; uploads: 'blob' | 'local' }> | null = null
const appConfig = () => (config ??= fetch('/api/config').then((r) => r.json()))

export const webApi: HabitApi = {
  habits: {
    list: () => invoke('habits:list'),
    get: (id) => invoke('habits:get', id),
    create: (draft) => invoke('habits:create', draft),
    update: (id, draft) => invoke('habits:update', id, draft),
    setActive: (id, active) => invoke('habits:setActive', id, active)
  },

  occurrence: {
    setCompleted: (id, completed) => invoke('occurrence:setCompleted', id, completed),
    setSkip: (id, skip, reason) => invoke('occurrence:setSkip', id, skip, reason),
    reschedule: (id, date, time) => invoke('occurrence:reschedule', id, date, time)
  },

  timer: {
    start: (id) => invoke('timer:start', id),
    stop: (id) => invoke('timer:stop', id),
    addManual: (id, minutes) => invoke('timer:addManual', id, minutes)
  },

  view: {
    dashboard: () => invoke('view:dashboard'),
    calendarRange: (from, to) => invoke('view:calendarRange', from, to),
    calendarMonth: (anchor) => invoke('view:calendarMonth', anchor),
    progress: (weeks) => invoke('view:progress', weeks),
    performance: (anchor) => invoke('view:performance', anchor),
    todos: (anchor) => invoke('view:todos', anchor),
    weeklyReview: (anchor) => invoke('view:weeklyReview', anchor),
    achievements: () => invoke('view:achievements'),
    personalRecords: () => invoke('view:personalRecords'),
    proposals: () => invoke('view:proposals'),
    habitDetail: (habitId) => invoke('view:habitDetail', habitId)
  },

  todo: {
    addManual: (title, date, goalId) => invoke('todo:addManual', title, date, goalId),
    addSubtask: (occurrenceId, title) => invoke('todo:addSubtask', occurrenceId, title),
    setDone: (id, done) => invoke('todo:setDone', id, done),
    rename: (id, title) => invoke('todo:rename', id, title),
    drop: (id) => invoke('todo:drop', id),
    remove: (id) => invoke('todo:remove', id),
    reschedule: (id, date) => invoke('todo:reschedule', id, date),
    templatesFor: (habitId) => invoke('todo:templatesFor', habitId),
    setTemplates: (habitId, titles) => invoke('todo:setTemplates', habitId, titles)
  },

  proposal: {
    accept: (id) => invoke('proposal:accept', id),
    reject: (id) => invoke('proposal:reject', id)
  },

  letGo: {
    list: () => invoke('letGo:list'),
    get: (id) => invoke('letGo:get', id),
    create: (draft) => invoke('letGo:create', draft),
    update: (id, draft) => invoke('letGo:update', id, draft),
    checkIn: (id, date, input) => invoke('letGo:checkIn', id, date, input),
    clearCheckIn: (id, date) => invoke('letGo:clearCheckIn', id, date),
    leaveBehind: (id, vow) => invoke('letGo:leaveBehind', id, vow),
    pickUpAgain: (id) => invoke('letGo:pickUpAgain', id),
    remove: (id) => invoke('letGo:remove', id)
  },

  journal: {
    list: () => invoke('journal:list'),
    save: (id, draft) => invoke('journal:save', id, draft),
    remove: (id) => invoke('journal:remove', id)
  },

  attachments: {
    import: async (files) => uploadFiles(files ?? (await pickFiles())),
    discard: (id) => invoke('attachments:discard', id),
    setCaption: (id, caption) => invoke('attachments:setCaption', id, caption),
    open: async (attachment) => {
      window.open(attachment.url, '_blank', 'noopener')
    }
  },

  tools: {
    list: () => invoke('tools:list'),
    save: (id, draft) => invoke('tools:save', id, draft),
    remove: (id) => invoke('tools:remove', id)
  },

  guide: {
    list: () => invoke('guide:list'),
    dismiss: (key) => invoke('guide:dismiss', key)
  },

  goals: {
    draft: () => invoke('goals:draft'),
    saveDraft: (draft) => invoke('goals:saveDraft', draft),
    list: () => invoke('goals:list'),
    get: (id) => invoke('goals:get', id),
    draftPlan: (input) => invoke('goals:draftPlan', input),
    commit: (input, plan) => invoke('goals:commit', input, plan),
    close: (id, outcome) => invoke('goals:close', id, outcome),
    reopen: (id) => invoke('goals:reopen', id),
    updatePlan: (id, patch) => invoke('goals:updatePlan', id, patch),
    remove: (id) => invoke('goals:remove', id)
  },

  letGoPlan: {
    draft: (input) => invoke('letGoPlan:draft', input),
    save: (input, plan) => invoke('letGoPlan:save', input, plan)
  },

  account: {
    status: () => invoke('account:status'),
    signUp: async (name, email, password) => {
      const user = await invoke<Awaited<ReturnType<HabitApi['account']['signUp']>>>('account:signUp', name, email, password)
      for (const cb of listeners.dataChanged) cb()
      return user
    },
    signIn: async (email, password) => {
      const user = await invoke<Awaited<ReturnType<HabitApi['account']['signIn']>>>('account:signIn', email, password)
      for (const cb of listeners.dataChanged) cb()
      return user
    },
    signInWithGoogle: () => navigateAway('/api/auth/google/start'),
    signOut: () => invoke('account:signOut')
  },

  ai: {
    status: () => invoke('ai:status'),
    setProvider: (provider) => invoke('ai:setProvider', provider),
    setCredentials: (provider, apiKey, model) => invoke('ai:setCredentials', provider, apiKey, model)
  },

  settings: {
    get: () => invoke('settings:get'),
    save: (patch) => invoke('settings:save', patch),
    recomputeAll: () => invoke('settings:recomputeAll')
  },

  google: {
    status: () => invoke('google:status'),
    hasCredentials: () => invoke('google:hasCredentials'),
    connect: () => navigateAway('/api/google/connect'),
    disconnect: () => invoke('google:disconnect'),
    syncNow: () => invoke('google:syncNow')
  },

  push: {
    test: () => invoke('push:test')
  },

  app: {
    openExternal: async (url) => {
      // Only ever open an http(s) URL from our own UI.
      if (/^https?:\/\//i.test(url)) window.open(url, '_blank', 'noopener,noreferrer')
    },
    version: async () => (await appConfig()).version,
    start: async () => {
      await invoke('app:start', Intl.DateTimeFormat().resolvedOptions().timeZone || null)
      for (const cb of listeners.dataChanged) cb()
    },
    tick: async () => {
      const r = await invoke<{ sync: SyncStatus; nextReminderAt: string | null }>('app:tick')
      for (const cb of listeners.syncStatus) cb(r.sync)
      return r
    }
  },

  on: {
    syncStatus: (cb) => subscribe(listeners.syncStatus, cb),
    dataChanged: (cb) => subscribe(listeners.dataChanged, cb),
    toast: (cb) => subscribe(listeners.toast, cb),
    goalProgress: (cb) => subscribe(listeners.goalProgress, cb)
  }
}

window.api = webApi
