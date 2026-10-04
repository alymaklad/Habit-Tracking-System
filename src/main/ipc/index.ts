import { app, dialog, ipcMain, shell } from 'electron'
import { ATTACHMENT_EXTENSIONS } from '../platform/attachmentStore'
import {
  PUSH_CHANNELS,
  type AiProvider,
  type AppSettings,
  type GoalDraftInput,
  type GoalPlan,
  type GoalObstacle,
  type GoalResource,
  type SavedGoalDraft,
  type HabitDraft,
  type LocalDate,
  type MindMapNode,
  type JournalDraft,
  type LetGoCheckinInput,
  type LetGoDraft,
  type ToolDraft
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
  handle('view:habitDetail', (habitId: number) => ctx.views.habitDetail(habitId))

  // ------------------------------------------------------ let go & journal

  handle('letGo:list', () => ctx.reflect.letGoList())
  handle('letGo:get', (id: number) => ctx.reflect.letGoGet(id))
  mutate('letGo:create', (draft: LetGoDraft) => ctx.reflect.letGoCreate(draft))
  mutate('letGo:update', (id: number, draft: LetGoDraft) => ctx.reflect.letGoUpdate(id, draft))
  mutate('letGo:checkIn', (id: number, date: LocalDate, input: LetGoCheckinInput) => ctx.reflect.checkIn(id, date, input))
  mutate('letGo:clearCheckIn', (id: number, date: LocalDate) => ctx.reflect.clearCheckIn(id, date))
  mutate('letGo:leaveBehind', (id: number, vow: string | null) => ctx.reflect.leaveBehind(id, vow))
  mutate('letGo:pickUpAgain', (id: number) => ctx.reflect.pickUpAgain(id))
  mutate('letGo:remove', (id: number) => ctx.reflect.letGoRemove(id))

  handle('journal:list', () => ctx.reflect.journalList())
  mutate('journal:save', (id: number | null, draft: JournalDraft) => ctx.reflect.journalSave(id, draft))
  mutate('journal:remove', (id: number) => ctx.reflect.journalRemove(id))

  // Imported files stay unlinked (and invisible elsewhere) until their entry is saved,
  // so importing is not a data change the other screens need to hear about.
  handle('attachments:import', async (paths: string[] | null) => {
    let chosen = paths
    if (!chosen) {
      const r = await dialog.showOpenDialog({
        title: 'Add to the journal',
        properties: ['openFile', 'multiSelections'],
        filters: [
          { name: 'Photos and documents', extensions: ATTACHMENT_EXTENSIONS },
          { name: 'Photos', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp'] }
        ]
      })
      if (r.canceled) return []
      chosen = r.filePaths
    }
    return ctx.reflect.importAttachments(chosen.slice(0, 12))
  })
  handle('attachments:discard', (id: number) => ctx.reflect.discardAttachment(id))
  mutate('attachments:setCaption', (id: number, caption: string | null) => ctx.reflect.setCaption(id, caption))
  handle('attachments:open', async (id: number) => {
    const p = ctx.reflect.attachmentPath(id)
    if (!p) throw new Error('That file is no longer attached')
    const failed = await shell.openPath(p)
    if (failed) throw new Error(failed)
  })

  handle('tools:list', () => ctx.reflect.tools())
  mutate('tools:save', (id: number | null, draft: ToolDraft) => ctx.reflect.toolSave(id, draft))
  mutate('tools:remove', (id: number) => ctx.reflect.toolRemove(id))

  handle('guide:list', () => ctx.reflect.guide())
  mutate('guide:dismiss', (key: string) => ctx.reflect.dismissInsight(key))

  // ------------------------------------------------------------- to-do

  mutate('todo:addManual', (title: string, date?: LocalDate, goalId?: number) =>
    ctx.todos.addManual(title, date, new Date(), { goalId: goalId ?? null })
  )
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
  handle('goals:draft', () => ctx.goals.draft())
  mutate('goals:saveDraft', (draft: SavedGoalDraft | null) => ctx.goals.saveDraft(draft))
  mutate('goals:updatePlan', (id: number, patch: { mindMap?: MindMapNode[]; resources?: GoalResource[]; obstacles?: GoalObstacle[] }) =>
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
