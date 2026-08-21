import { app, ipcMain, shell } from 'electron'
import type { AppSettings, HabitDraft, LocalDate } from '@shared/types'
import type { AppContext } from '../context'

/**
 * IPC surface. Every channel is registered explicitly — the renderer can reach exactly
 * these and nothing else. Handlers are thin: they validate, delegate to a service, and
 * return a plain serialisable value.
 */
export function registerIpc(ctx: AppContext, notifyDataChanged: () => void): void {
  const handle = <T extends unknown[], R>(
    channel: string,
    fn: (...args: T) => R | Promise<R>
  ): void => {
    ipcMain.handle(channel, async (_event, ...args) => fn(...(args as T)))
  }

  /** Run a mutation, then tell the renderer to refetch. */
  const mutate = <T extends unknown[], R>(
    channel: string,
    fn: (...args: T) => R | Promise<R>
  ): void => {
    handle(channel, async (...args: T) => {
      const result = await fn(...args)
      notifyDataChanged()
      return result
    })
  }

  // ------------------------------------------------------------- habits

  handle('habits:list', () => ctx.habits.list())
  handle('habits:get', (id: number) => ctx.habits.get(id))
  mutate('habits:create', (draft: HabitDraft) => ctx.habits.create(draft))
  mutate('habits:update', async (id: number, draft: HabitDraft) => {
    const { habit, orphaned } = ctx.habits.update(id, draft)
    // Retire the Google tasks a narrowed schedule orphaned, best-effort.
    if (orphaned.length > 0) {
      void ctx.provisioner.removeOrphans(orphaned).catch(() => undefined)
    }
    return habit
  })
  mutate('habits:setActive', (id: number, active: boolean) => ctx.habits.setActive(id, active))

  // --------------------------------------------------------- occurrence

  mutate('occurrence:setCompleted', (occurrenceId: number, completed: boolean) => {
    const id = ctx.habits.setCompleted(occurrenceId, completed)
    // Queue the matching Google patch; it flushes on the next sync, or when the
    // connection returns if we are offline.
    if (id !== null) ctx.syncer.enqueueStatus(id, completed)
  })

  mutate('occurrence:setSkip', (occurrenceId: number, skip: boolean, reason: string | null) =>
    ctx.habits.setJustifiedSkip(occurrenceId, skip, reason)
  )

  mutate('occurrence:reschedule', (occurrenceId: number, date: LocalDate, time: string) => {
    ctx.habits.reschedule(occurrenceId, date, time)
    ctx.syncer.enqueueReschedule(occurrenceId, date)
    void ctx.mirror.update(occurrenceId).catch(() => undefined)
  })

  // -------------------------------------------------------------- timer

  mutate('timer:start', (occurrenceId: number) => {
    ctx.habits.startTimer(occurrenceId)
    ctx.reminders.rearm()
  })
  mutate('timer:stop', (occurrenceId: number) => ctx.habits.stopTimer(occurrenceId))
  mutate('timer:addManual', (occurrenceId: number, minutes: number) =>
    ctx.habits.addManualMinutes(occurrenceId, minutes)
  )

  // -------------------------------------------------------------- views

  handle('view:dashboard', () => ctx.views.dashboard())
  handle('view:calendarRange', (from: LocalDate, to: LocalDate) =>
    ctx.views.calendarRange(from, to)
  )
  handle('view:calendarMonth', (anchor: LocalDate) => ctx.views.calendarMonth(anchor))
  handle('view:progress', (weeks?: number) => ctx.views.progress(weeks ?? 8))
  handle('view:performance', (anchor?: LocalDate) => ctx.views.performance(anchor))
  handle('view:weeklyReview', (anchor?: LocalDate) => ctx.views.weeklyReview(anchor))
  handle('view:achievements', () => ctx.views.achievements())
  handle('view:personalRecords', () => ctx.views.personalRecords())
  handle('view:proposals', () => ctx.views.proposals())

  mutate('proposal:accept', (id: number) => ctx.habits.acceptProposal(id))
  mutate('proposal:reject', (id: number) => ctx.habits.rejectProposal(id))

  // ----------------------------------------------------------- settings

  handle('settings:get', () => ctx.repos.settings.all())
  mutate('settings:save', async (patch: Partial<AppSettings>) => {
    const before = ctx.repos.settings.all()
    const next = ctx.repos.settings.save(patch)

    if (before.syncIntervalMinutes !== next.syncIntervalMinutes) {
      ctx.orchestrator.setIntervalMinutes(next.syncIntervalMinutes)
    }
    if (before.startWithWindows !== next.startWithWindows) {
      app.setLoginItemSettings({ openAtLogin: next.startWithWindows, openAsHidden: true })
    }
    // Turning the calendar mirror off should clean up after itself rather than leave
    // orphaned reminder events firing on the user's phone forever.
    if (before.calendarMirrorEnabled && !next.calendarMirrorEnabled) {
      const horizon = ctx.schedule.horizon()
      void ctx.mirror.removeAll(horizon.from, horizon.to).catch(() => undefined)
    }
    ctx.reminders.rearm()
    return next
  })

  mutate('settings:recomputeAll', () => ctx.engine.rebuildAll())

  // ------------------------------------------------------------- google

  handle('google:status', () => ctx.orchestrator.status())
  handle('google:hasCredentials', () => ctx.hasCredentials())
  mutate('google:setCredentials', (clientId: string, clientSecret: string | null) =>
    ctx.setCredentials(clientId, clientSecret)
  )

  handle('google:connect', async () => {
    try {
      await ctx.auth.connect()
      await ctx.orchestrator.runNow('manual')
      notifyDataChanged()
      return { ok: true as const }
    } catch (err) {
      return { ok: false as const, error: err instanceof Error ? err.message : String(err) }
    }
  })

  mutate('google:disconnect', async () => {
    await ctx.auth.disconnect()
    ctx.orchestrator.markDisconnected()
  })

  handle('google:syncNow', () => ctx.orchestrator.runNow('manual'))

  handle('push:test', () => ctx.push.test())

  // ---------------------------------------------------------------- app

  handle('app:openExternal', async (url: string) => {
    // Only ever hand the OS an http(s) URL from our own UI.
    if (/^https?:\/\//i.test(url)) await shell.openExternal(url)
  })
  handle('app:version', () => app.getVersion())
}
