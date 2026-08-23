import { contextBridge, ipcRenderer } from 'electron'
import { PUSH_CHANNELS, type SyncStatus, type ToastMessage } from '../shared/types'
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
    proposals: () => invoke('view:proposals')
  },

  todo: {
    addManual: (title, date) => invoke('todo:addManual', title, date),
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

  settings: {
    get: () => invoke('settings:get'),
    save: (patch) => invoke('settings:save', patch),
    recomputeAll: () => invoke('settings:recomputeAll')
  },

  google: {
    status: () => invoke('google:status'),
    hasCredentials: () => invoke('google:hasCredentials'),
    setCredentials: (clientId, clientSecret) =>
      invoke('google:setCredentials', clientId, clientSecret),
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
    toast: (cb) => subscribe<ToastMessage>(PUSH_CHANNELS.toast, cb)
  }
}

contextBridge.exposeInMainWorld('api', api)
