import { contextBridge, ipcRenderer, webUtils } from 'electron'
import {
  PUSH_CHANNELS,
  type GoalPlanProgress,
  type SyncStatus,
  type ToastMessage
} from '../shared/types'
import type { HabitApi } from '../shared/api'

/**
 * The only bridge between the renderer and the main process.
 *
 * `contextIsolation` is on and `nodeIntegration` is off, so this is the renderer's
 * entire capability surface: a fixed list of channels, each returning plain data. No
 * `ipcRenderer` is exposed, so the renderer cannot invent a channel of its own.
 */
const invoke = <T>(channel: string, ...args: unknown[]): Promise<T> =>
  ipcRenderer.invoke(channel, ...args) as Promise<T>

function subscribe<T>(channel: string, cb: (payload: T) => void): () => void {
  const listener = (_event: Electron.IpcRendererEvent, payload: T): void => cb(payload)
  ipcRenderer.on(channel, listener)
  return () => ipcRenderer.removeListener(channel, listener)
}

const api: HabitApi = {
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
    import: (paths) => invoke('attachments:import', paths),
    discard: (id) => invoke('attachments:discard', id),
    setCaption: (id, caption) => invoke('attachments:setCaption', id, caption),
    open: (id) => invoke('attachments:open', id),
    // A dropped File only carries its path on this side of the bridge.
    pathForFile: (file) => webUtils.getPathForFile(file)
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
    signUp: (name, email, password) => invoke('account:signUp', name, email, password),
    signIn: (email, password) => invoke('account:signIn', email, password),
    signInWithGoogle: () => invoke('account:signInWithGoogle'),
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
    connect: () => invoke('google:connect'),
    disconnect: () => invoke('google:disconnect'),
    syncNow: () => invoke('google:syncNow')
  },

  push: {
    test: () => invoke('push:test')
  },

  app: {
    openExternal: (url) => invoke('app:openExternal', url),
    version: () => invoke('app:version')
  },

  on: {
    syncStatus: (cb) => subscribe<SyncStatus>(PUSH_CHANNELS.syncStatus, cb),
    dataChanged: (cb) => subscribe<void>(PUSH_CHANNELS.dashboard, () => cb()),
    toast: (cb) => subscribe<ToastMessage>(PUSH_CHANNELS.toast, cb),
    goalProgress: (cb) => subscribe<GoalPlanProgress>(PUSH_CHANNELS.goalProgress, cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
