import { app, ipcMain, shell } from 'electron'
import {
  PUSH_CHANNELS,
  type AiProvider,
  type AppSettings,
  type GoalDraftInput,
  type GoalPlan,
  type GoalResource,
  type HabitDraft,
  type LocalDate,
  type MindMapNode
} from '@shared/types'
import type { AppContext } from '../context'

/**
 * IPC surface. Every channel is registered explicitly — the renderer can reach exactly
 * these and nothing else. Handlers are thin: they validate, delegate to a service, and
 * return a plain serialisable value.
 */
export function registerIpc(
  ctx: AppContext,
  notifyDataChanged: () => void,
  push: (channel: string, payload?: unknown) => void = () => undefined
): void {
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
    // Retire what a narrowed schedule orphaned — the Google task AND the mirrored
    // calendar reminder, best-effort.
    if (orphaned.length > 0) {
      void ctx.cleanupOrphanedOccurrences(orphaned).catch(() => undefined)
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
  handle('view:todos', (anchor?: LocalDate) => ctx.views.todoView(anchor))
  handle('view:weeklyReview', (anchor?: LocalDate) => ctx.views.weeklyReview(anchor))
  handle('view:achievements', () => ctx.views.achievements())
  handle('view:personalRecords', () => ctx.views.personalRecords())
  handle('view:proposals', () => ctx.views.proposals())

  // ------------------------------------------------------------- to-do

  mutate('todo:addManual', (title: string, date?: LocalDate) => ctx.todos.addManual(title, date))
  mutate('todo:addSubtask', (occurrenceId: number, title: string) =>
    ctx.todos.addSubtask(occurrenceId, title)
  )

  mutate('todo:setDone', (id: number, done: boolean) => {
    const item = ctx.repos.todos.get(id)
    ctx.todos.setDone(id, done)
    // Finishing the last step completes the habit itself, and that has to reach Google
    // like any other completion — otherwise the phone and the app disagree.
    if (item?.occurrenceId != null) {
      const occ = ctx.repos.occurrences.get(item.occurrenceId)
      if (occ?.googleTaskId) ctx.syncer.enqueueStatus(occ.id, occ.completedAt !== null)
    }
  })

  mutate('todo:rename', (id: number, title: string) => ctx.todos.rename(id, title))
  mutate('todo:drop', (id: number) => ctx.todos.drop(id))
  mutate('todo:remove', (id: number) => ctx.todos.remove(id))
  mutate('todo:reschedule', (id: number, date: LocalDate) => ctx.todos.reschedule(id, date))
  handle('todo:templatesFor', (habitId: number) => ctx.todos.templatesFor(habitId))
  mutate('todo:setTemplates', (habitId: number, titles: string[]) => {
    ctx.todos.setTemplates(habitId, titles)
    const horizon = ctx.schedule.horizon()
    ctx.todos.applyTemplatesInRange(horizon.from, horizon.to)
  })

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

  // -------------------------------------------------------------- goals

  handle('goals:list', () => ctx.goals.list())
  handle('goals:get', (id: number) => ctx.goals.get(id))
  // Not a mutation: nothing is written until the user approves the draft. Progress is
  // pushed so the wizard can name the phase instead of showing a bare spinner.
  handle('goals:draftPlan', (input: GoalDraftInput) =>
    ctx.goals.draftPlan(input, (progress) => push(PUSH_CHANNELS.goalProgress, progress))
  )
  mutate('goals:commit', (input: GoalDraftInput, plan: GoalPlan) => ctx.goals.commit(input, plan))
  mutate('goals:close', (id: number, outcome: 'achieved' | 'abandoned') => ctx.goals.close(id, outcome))
  mutate('goals:reopen', (id: number) => ctx.goals.reopen(id))
  mutate('goals:updatePlan', (id: number, patch: { mindMap?: MindMapNode[]; resources?: GoalResource[] }) =>
    ctx.goals.updatePlan(id, patch)
  )
  mutate('goals:remove', (id: number) => ctx.goals.remove(id))

  // ----------------------------------------------------------------- ai

  handle('ai:status', () => ctx.aiStatus())
  mutate('ai:setProvider', (provider: AiProvider) => ctx.setAiProvider(provider))
  mutate('ai:setCredentials', (provider: AiProvider, apiKey: string | null, model: string | null) =>
    ctx.setAiCredentials(provider, apiKey, model)
  )

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
