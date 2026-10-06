import type {
  AiProvider,
  AppSettings,
  GoalDraftInput,
  GoalObstacle,
  GoalPlan,
  GoalResource,
  HabitDraft,
  JournalDraft,
  LetGoCheckinInput,
  LetGoDraft,
  LetGoPlan,
  LetGoPlanInput,
  LocalDate,
  MindMapNode,
  RpcEvent,
  SavedGoalDraft,
  ToolDraft
} from '@shared/types'
import type { AppContext } from '../context'
import type { UploadedFile } from '../application/reflectService'
import { blobConfigured, newStoredName } from '../platform/attachmentStore'

/**
 * The RPC surface: the same channels the desktop app's IPC had, each one a thin call
 * into a service. Every channel is listed explicitly — a request can reach exactly
 * these and nothing else.
 *
 * `mutates` channels tell the browser to refetch when they finish (`dataChanged`).
 * `ai` channels are rate-limited when they run on the server's own API key.
 */

export interface RpcEnv {
  /** The account's schema; uploads go under a folder of the same name. */
  schema: string
  emit: (e: RpcEvent) => void
  /** Runs after the response is sent (Vercel `waitUntil`); for best-effort clean-up. */
  later: (work: Promise<unknown>) => void
}

// Arguments arrive as JSON; each handler names the shape it expects.
type Handler = (ctx: AppContext, args: any, env: RpcEnv) => unknown

interface Channel {
  run: Handler
  mutates?: boolean
  ai?: boolean
}

const q = (run: Handler): Channel => ({ run })
const m = (run: Handler): Channel => ({ run, mutates: true })

export const CHANNELS: Record<string, Channel> = {
  // ------------------------------------------------------------- habits
  'habits:list': q((ctx) => ctx.habits.list()),
  'habits:get': q((ctx, [id]: [number]) => ctx.habits.get(id)),
  'habits:create': m((ctx, [draft]: [HabitDraft]) => ctx.habits.create(draft)),
  'habits:update': m(async (ctx, [id, draft]: [number, HabitDraft], env) => {
    const { habit, orphaned } = await ctx.habits.update(id, draft)
    // Retire what a narrowed schedule orphaned — the Google task AND the mirrored
    // calendar reminder, best-effort.
    if (orphaned.length > 0) env.later(ctx.cleanupOrphanedOccurrences(orphaned))
    return habit
  }),
  'habits:setActive': m((ctx, [id, active]: [number, boolean]) => ctx.habits.setActive(id, active)),

  // --------------------------------------------------------- occurrence
  'occurrence:setCompleted': m(async (ctx, [occurrenceId, completed]: [number, boolean]) => {
    const id = await ctx.habits.setCompleted(occurrenceId, completed)
    // Queue the matching Google patch; it flushes on the next sync.
    if (id !== null) await ctx.syncer.enqueueStatus(id, completed)
  }),
  'occurrence:setSkip': m((ctx, [occurrenceId, skip, reason]: [number, boolean, string | null]) =>
    ctx.habits.setJustifiedSkip(occurrenceId, skip, reason)
  ),
  'occurrence:reschedule': m(async (ctx, [occurrenceId, date, time]: [number, LocalDate, string], env) => {
    await ctx.habits.reschedule(occurrenceId, date, time)
    await ctx.syncer.enqueueReschedule(occurrenceId, date)
    env.later(ctx.mirror.update(occurrenceId).catch(() => undefined))
  }),

  // -------------------------------------------------------------- timer
  'timer:start': m((ctx, [occurrenceId]: [number]) => ctx.habits.startTimer(occurrenceId)),
  'timer:stop': m((ctx, [occurrenceId]: [number]) => ctx.habits.stopTimer(occurrenceId)),
  'timer:addManual': m((ctx, [occurrenceId, minutes]: [number, number]) => ctx.habits.addManualMinutes(occurrenceId, minutes)),

  // -------------------------------------------------------------- views
  'view:dashboard': q((ctx) => ctx.views.dashboard()),
  'view:calendarRange': q((ctx, [from, to]: [LocalDate, LocalDate]) => ctx.views.calendarRange(from, to)),
  'view:calendarMonth': q((ctx, [anchor]: [LocalDate]) => ctx.views.calendarMonth(anchor)),
  'view:progress': q((ctx, [weeks]: [number | undefined]) => ctx.views.progress(weeks ?? 8)),
  'view:performance': q((ctx, [anchor]: [LocalDate | undefined]) => ctx.views.performance(anchor)),
  'view:todos': q((ctx, [anchor]: [LocalDate | undefined]) => ctx.views.todoView(anchor)),
  'view:weeklyReview': q((ctx, [anchor]: [LocalDate | undefined]) => ctx.views.weeklyReview(anchor)),
  'view:achievements': q((ctx) => ctx.views.achievements()),
  'view:personalRecords': q((ctx) => ctx.views.personalRecords()),
  'view:proposals': q((ctx) => ctx.views.proposals()),
  'view:habitDetail': q((ctx, [habitId]: [number]) => ctx.views.habitDetail(habitId)),

  // ------------------------------------------------------ let go & journal
  'letGo:list': q((ctx) => ctx.reflect.letGoList()),
  'letGo:get': q((ctx, [id]: [number]) => ctx.reflect.letGoGet(id)),
  'letGo:create': m((ctx, [draft]: [LetGoDraft]) => ctx.reflect.letGoCreate(draft)),
  'letGo:update': m((ctx, [id, draft]: [number, LetGoDraft]) => ctx.reflect.letGoUpdate(id, draft)),
  'letGo:checkIn': m((ctx, [id, date, input]: [number, LocalDate, LetGoCheckinInput]) => ctx.reflect.checkIn(id, date, input)),
  'letGo:clearCheckIn': m((ctx, [id, date]: [number, LocalDate]) => ctx.reflect.clearCheckIn(id, date)),
  'letGo:leaveBehind': m((ctx, [id, vow]: [number, string | null]) => ctx.reflect.leaveBehind(id, vow)),
  'letGo:pickUpAgain': m((ctx, [id]: [number]) => ctx.reflect.pickUpAgain(id)),
  'letGo:remove': m((ctx, [id]: [number]) => ctx.reflect.letGoRemove(id)),

  'journal:list': q((ctx) => ctx.reflect.journalList()),
  'journal:save': m((ctx, [id, draft]: [number | null, JournalDraft]) => ctx.reflect.journalSave(id, draft)),
  'journal:remove': m((ctx, [id]: [number]) => ctx.reflect.journalRemove(id)),

  // Uploaded files stay unlinked (and invisible elsewhere) until their entry is saved,
  // so registering them is not a data change the other screens need to hear about.
  /** Fresh names for files the browser is about to upload, and how to upload them. */
  'attachments:prepare': q((_ctx, [names]: [string[]], env) =>
    (names ?? []).slice(0, 12).map((originalName) => {
      const storedName = newStoredName(String(originalName))
      return blobConfigured()
        ? { originalName, storedName, mode: 'blob' as const, pathname: `${env.schema}/${storedName}` }
        : { originalName, storedName, mode: 'local' as const, pathname: `/api/files/local/${storedName}` }
    })
  ),
  'attachments:register': q((ctx, [uploads]: [UploadedFile[]]) => ctx.reflect.registerAttachments(uploads ?? [])),
  'attachments:discard': q((ctx, [id]: [number]) => ctx.reflect.discardAttachment(id)),
  'attachments:setCaption': m((ctx, [id, caption]: [number, string | null]) => ctx.reflect.setCaption(id, caption)),

  'tools:list': q((ctx) => ctx.reflect.tools()),
  'tools:save': m((ctx, [id, draft]: [number | null, ToolDraft]) => ctx.reflect.toolSave(id, draft)),
  'tools:remove': m((ctx, [id]: [number]) => ctx.reflect.toolRemove(id)),

  'guide:list': q((ctx) => ctx.reflect.guide()),
  'guide:dismiss': m((ctx, [key]: [string]) => ctx.reflect.dismissInsight(key)),

  // ------------------------------------------------------------- to-do
  'todo:addManual': m((ctx, [title, date, goalId]: [string, LocalDate | undefined, number | undefined]) =>
    ctx.todos.addManual(title, date, new Date(), { goalId: goalId ?? null })
  ),
  'todo:addSubtask': m((ctx, [occurrenceId, title]: [number, string]) => ctx.todos.addSubtask(occurrenceId, title)),
  'todo:setDone': m(async (ctx, [id, done]: [number, boolean]) => {
    const item = await ctx.repos.todos.get(id)
    await ctx.todos.setDone(id, done)
    // Finishing the last step completes the habit itself, and that has to reach Google
    // like any other completion — otherwise the phone and the app disagree.
    if (item?.occurrenceId != null) {
      const occ = await ctx.repos.occurrences.get(item.occurrenceId)
      if (occ?.googleTaskId) await ctx.syncer.enqueueStatus(occ.id, occ.completedAt !== null)
    }
  }),
  'todo:rename': m((ctx, [id, title]: [number, string]) => ctx.todos.rename(id, title)),
  'todo:drop': m((ctx, [id]: [number]) => ctx.todos.drop(id)),
  'todo:remove': m((ctx, [id]: [number]) => ctx.todos.remove(id)),
  'todo:reschedule': m((ctx, [id, date]: [number, LocalDate]) => ctx.todos.reschedule(id, date)),
  'todo:templatesFor': q((ctx, [habitId]: [number]) => ctx.todos.templatesFor(habitId)),
  'todo:setTemplates': m(async (ctx, [habitId, titles]: [number, string[]]) => {
    await ctx.todos.setTemplates(habitId, titles)
    const horizon = await ctx.schedule.horizon()
    await ctx.todos.applyTemplatesInRange(horizon.from, horizon.to)
  }),

  'proposal:accept': m((ctx, [id]: [number]) => ctx.habits.acceptProposal(id)),
  'proposal:reject': m((ctx, [id]: [number]) => ctx.habits.rejectProposal(id)),

  // ----------------------------------------------------------- settings
  'settings:get': q((ctx) => ctx.repos.settings.all()),
  'settings:save': m(async (ctx, [patch]: [Partial<AppSettings>], env) => {
    const before = await ctx.repos.settings.all()
    const next = await ctx.repos.settings.save(patch)
    if (before.syncIntervalMinutes !== next.syncIntervalMinutes) {
      await ctx.orchestrator.setIntervalMinutes(next.syncIntervalMinutes)
    }
    // Turning the calendar mirror off should clean up after itself rather than leave
    // orphaned reminder events firing on the user's phone forever.
    if (before.calendarMirrorEnabled && !next.calendarMirrorEnabled) {
      const horizon = await ctx.schedule.horizon()
      env.later(ctx.mirror.removeAll(horizon.from, horizon.to).catch(() => undefined))
    }
    return next
  }),
  'settings:recomputeAll': m((ctx) => ctx.engine.rebuildAll()),

  // -------------------------------------------------------------- goals
  'goals:list': q((ctx) => ctx.goals.list()),
  'goals:get': q((ctx, [id]: [number]) => ctx.goals.get(id)),
  // Not a mutation: nothing is written until the user approves the draft. Progress is
  // streamed so the wizard can name the phase instead of showing a bare spinner.
  'goals:draftPlan': {
    ai: true,
    run: (ctx, [input]: [GoalDraftInput], env) => ctx.goals.draftPlan(input, (data) => env.emit({ event: 'goalProgress', data }))
  },
  'goals:commit': m((ctx, [input, plan]: [GoalDraftInput, GoalPlan]) => ctx.goals.commit(input, plan)),
  'goals:close': m((ctx, [id, outcome]: [number, 'achieved' | 'abandoned']) => ctx.goals.close(id, outcome)),
  'goals:reopen': m((ctx, [id]: [number]) => ctx.goals.reopen(id)),
  'goals:draft': q((ctx) => ctx.goals.draft()),
  'goals:saveDraft': m((ctx, [draft]: [SavedGoalDraft | null]) => ctx.goals.saveDraft(draft)),
  'goals:updatePlan': m(
    (ctx, [id, patch]: [number, { mindMap?: MindMapNode[]; resources?: GoalResource[]; obstacles?: GoalObstacle[] }]) =>
      ctx.goals.updatePlan(id, patch)
  ),
  'goals:remove': m((ctx, [id]: [number]) => ctx.goals.remove(id)),

  'letGoPlan:draft': {
    ai: true,
    run: (ctx, [input]: [LetGoPlanInput], env) => ctx.letGoPlans.draft(input, (data) => env.emit({ event: 'goalProgress', data }))
  },
  'letGoPlan:save': m((ctx, [input, plan]: [LetGoPlanInput, LetGoPlan]) => ctx.letGoPlans.save(input, plan)),

  // ----------------------------------------------------------------- ai
  'ai:status': q((ctx) => ctx.aiStatus()),
  'ai:setProvider': m((ctx, [provider]: [AiProvider]) => ctx.setAiProvider(provider)),
  'ai:setCredentials': m((ctx, [provider, apiKey, model]: [AiProvider, string | null, string | null]) =>
    ctx.setAiCredentials(provider, apiKey, model)
  ),

  // ------------------------------------------------------------- google
  'google:status': q((ctx) => ctx.orchestrator.status()),
  'google:hasCredentials': q((ctx) => ctx.hasCredentials()),
  'google:disconnect': m(async (ctx) => {
    await ctx.auth.disconnect()
    await ctx.orchestrator.markDisconnected()
  }),
  'google:syncNow': m((ctx) => ctx.orchestrator.runNow('manual')),

  /**
   * The open app's heartbeat, about once a minute: deliver reminders that are due and
   * run a sync cycle when the interval has passed. Replaces the desktop app's timers.
   */
  'app:tick': q(async (ctx, _args, env) => {
    await ctx.reminders.fireDue()
    const before = (await ctx.orchestrator.status()).lastSyncAt
    const status = await ctx.orchestrator.runIfDue('interval')
    if (status.lastSyncAt !== before) env.emit({ event: 'dataChanged' })
    return { sync: status, nextReminderAt: await ctx.reminders.nextDueAt() }
  }),

  'push:test': q((ctx) => ctx.push.test()),

  /** Once per page load: settle the time zone, extend the schedule, carry to-dos forward. */
  'app:start': q((ctx, [timezone]: [string | null]) => ctx.bootstrap(timezone ?? null))
}

/** What a guest (not signed in) may call: the planner, against an empty read-only schema. */
export const GUEST_CHANNELS: Record<string, Channel> = {
  'ai:status': CHANNELS['ai:status']!,
  'goals:list': q(() => []),
  'goals:draft': q(() => null),
  // A guest's draft lives in the page until they sign in; there is nowhere to keep it.
  'goals:saveDraft': q(() => undefined),
  'goals:draftPlan': CHANNELS['goals:draftPlan']!
}
