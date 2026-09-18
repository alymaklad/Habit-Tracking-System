import type { AiProvider, AiStatus, SyncStatus, ToastMessage } from '@shared/types'
import { openDatabase } from './persistence/db'
import { habitRepo } from './persistence/habitRepo'
import { occurrenceRepo } from './persistence/occurrenceRepo'
import { logRepo } from './persistence/logRepo'
import { recordRepo } from './persistence/recordRepo'
import { settingsRepo } from './persistence/settingsRepo'
import { syncRepo } from './persistence/syncRepo'
import { todoRepo } from './persistence/todoRepo'
import { goalRepo } from './persistence/goalRepo'
import { scheduleService } from './application/scheduleService'
import { recomputeService } from './application/recomputeService'
import { habitService } from './application/habitService'
import { todoService } from './application/todoService'
import { goalService } from './application/goalService'
import { anthropicGoalPlanner } from './ai/goalPlanner'
import { isProvider, PROVIDER_IDS, PROVIDERS } from './ai/providers'
import { viewService } from './application/viewService'
import { notificationService } from './application/notificationService'
import { reminderScheduler } from './application/reminderScheduler'
import { pushRelay } from './platform/pushRelay'
import { tokenVault } from './google/tokenVault'
import { authService, type AuthCredentials } from './google/authService'
import { tasksClient } from './google/tasksClient'
import { calendarClient } from './google/calendarClient'
import { taskProvisioner } from './sync/taskProvisioner'
import { taskSyncer } from './sync/taskSyncer'
import { eventMirror } from './sync/eventMirror'
import { syncOrchestrator } from './sync/syncOrchestrator'
import { ACHIEVEMENTS } from './domain/achievements'

export interface ContextOptions {
  dbPath: string
  /** Fires a native OS notification. Injected so the app layer stays testable. */
  toast: (title: string, body: string) => void
  onSyncStatus: (status: SyncStatus) => void
  onToast: (message: ToastMessage) => void
  onDataChanged: () => void
}

/**
 * Wires the whole application graph.
 *
 * Dependencies point one way: persistence ← domain ← application ← sync, with Google
 * behind its own clients. Nothing in the application layer imports Electron, which is
 * what lets the engine, sync and notification tests run headless.
 */
export function createContext(opts: ContextOptions) {
  const db = openDatabase(opts.dbPath)

  const habits = habitRepo(db)
  const occurrences = occurrenceRepo(db)
  const logs = logRepo(db)
  const records = recordRepo(db)
  const settings = settingsRepo(db)
  const sync = syncRepo(db)
  const todos = todoRepo(db)
  const goals = goalRepo(db)

  const schedule = scheduleService({ db, habits, occurrences, settings })
  const engine = recomputeService({ db, habits, occurrences, logs, records, settings })
  const habitsApi = habitService({ db, habits, occurrences, logs, records, settings, schedule, engine })
  const todosApi = todoService({ db, todos, occurrences, settings, habits: habitsApi })

  // ------------------------------------------------------------------ AI

  // Same bring-your-own-key shape as the Google client id: a value pasted into Settings
  // wins over the build-time environment. Keys and models are stored per provider so
  // switching back and forth does not lose either.
  const ENV_KEY: Record<AiProvider, string | undefined> = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    groq: process.env.GROQ_API_KEY
  }

  function aiProvider(): AiProvider {
    const stored = settings.getFlag<string | null>('aiProvider', null)
    return isProvider(stored) ? stored : 'anthropic'
  }

  function aiApiKey(provider: AiProvider): string | null {
    // `anthropicApiKey` predates per-provider keys; keep reading it.
    const legacy = provider === 'anthropic' ? settings.getFlag<string | null>('anthropicApiKey', null) : null
    return settings.getFlag<string | null>(`aiKey:${provider}`, null) ?? legacy ?? ENV_KEY[provider] ?? null
  }

  function aiModel(provider: AiProvider): string {
    const legacy = provider === 'anthropic' ? settings.getFlag<string | null>('aiModel', null) : null
    return settings.getFlag<string | null>(`aiModel:${provider}`, null) ?? legacy ?? PROVIDERS[provider].defaultModel
  }

  function aiStatus(): AiStatus {
    const provider = aiProvider()
    return {
      provider,
      ready: aiApiKey(provider) !== null,
      providers: PROVIDER_IDS.map((id) => ({
        id,
        label: PROVIDERS[id].label,
        hasKey: aiApiKey(id) !== null,
        model: aiModel(id),
        defaultModel: PROVIDERS[id].defaultModel,
        keyPlaceholder: PROVIDERS[id].keyPlaceholder,
        note: PROVIDERS[id].note
      }))
    }
  }

  const goalsApi = goalService({
    db,
    goals,
    habitRepo: habits,
    todoRepo: todos,
    settings,
    habits: habitsApi,
    todos: todosApi,
    engine,
    planner: () => {
      const provider = aiProvider()
      const apiKey = aiApiKey(provider)
      if (!apiKey) throw new Error(`Add a ${PROVIDERS[provider].label} API key in Settings to draft a plan.`)
      return anthropicGoalPlanner({ ai: PROVIDERS[provider].create(apiKey, aiModel(provider)) })
    }
  })

  const views = viewService({
    habits,
    occurrences,
    logs,
    records,
    settings,
    todos,
    engine,
    runningOccurrenceId: () => habitsApi.runningOccurrenceId()
  })

  const push = pushRelay({
    config: () => settings.all().push,
    log: (m) => sync.log('warn', m)
  })

  const notifications = notificationService({
    settings: () => settings.all(),
    push,
    toast: opts.toast,
    log: (m) => sync.log('info', m)
  })

  const reminders = reminderScheduler({ habits, occurrences, settings, notifications })

  // ------------------------------------------------------------- Google

  const vault = tokenVault(sync)

  function credentials(): AuthCredentials | null {
    // A client id pasted into Settings wins over the build-time environment, so a user
    // can bring their own Cloud project without rebuilding.
    const stored = settings.getFlag<string | null>('googleClientId', null)
    const storedSecret = settings.getFlag<string | null>('googleClientSecret', null)
    const clientId = stored ?? process.env.GOOGLE_CLIENT_ID ?? ''
    const clientSecret = storedSecret ?? process.env.GOOGLE_CLIENT_SECRET ?? undefined
    if (!clientId) return null
    return clientSecret ? { clientId, clientSecret } : { clientId }
  }

  const auth = authService({ vault, sync, credentials })
  const tasks = tasksClient({ auth })
  const calendar = calendarClient({ auth })

  const provisioner = taskProvisioner({ habits, occurrences, settings, sync, tasks })
  const syncer = taskSyncer({ db, habits, occurrences, logs, sync, tasks })
  const mirror = eventMirror({ habits, occurrences, settings, sync, calendar })

  /**
   * Fully retires occurrences a narrowed schedule orphaned — both halves of what was
   * provisioned for them, not just the Google Task.
   *
   * The calendar event has to go FIRST: it is looked up by the occurrence's own
   * `google_event_id`, and `provisioner.removeOrphans` hard-deletes that row. Deleting
   * the task after the row is gone would silently find nothing to clean up.
   */
  async function cleanupOrphanedOccurrences(occurrenceIds: number[]): Promise<void> {
    if (occurrenceIds.length === 0) return
    for (const id of occurrenceIds) {
      await mirror.remove(id).catch(() => undefined)
    }
    await provisioner.removeOrphans(occurrenceIds).catch(() => undefined)
  }

  const orchestrator = syncOrchestrator({
    auth,
    provisioner,
    syncer,
    mirror,
    schedule,
    engine,
    settings,
    sync,
    onStatusChange: opts.onSyncStatus,
    onAchievements: (keys) => {
      for (const key of keys) {
        const def = ACHIEVEMENTS.find((a) => a.key === key)
        if (def) void notifications.achievementUnlocked(def.name)
      }
    },
    onCycleComplete: () => {
      reminders.rearm()
      opts.onDataChanged()
    }
  })

  /** Seed the first run so an empty app still has a schedule and settings. */
  function bootstrap(): void {
    if (!settings.getFlag<boolean>('bootstrapped', false)) {
      settings.save({ timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC' })
      settings.setFlag('bootstrapped', true)
    }
    schedule.expandHorizon()
    const horizon = schedule.horizon()
    engine.refresh(horizon.from, horizon.to)
    // Unfinished to-dos follow you into today rather than being quietly lost, and new
    // occurrences arrive carrying whatever steps their habit defines.
    todosApi.carryForward()
    todosApi.applyTemplatesInRange(horizon.from, horizon.to)
    reminders.rearm()
  }

  return {
    // The database handle deliberately stays inside the context: everything outside
    // goes through a repository or a service.
    repos: { habits, occurrences, logs, records, settings, sync, todos, goals },
    schedule,
    engine,
    habits: habitsApi,
    todos: todosApi,
    goals: goalsApi,
    views,
    notifications,
    reminders,
    push,
    auth,
    vault,
    provisioner,
    syncer,
    mirror,
    orchestrator,
    credentials,
    bootstrap,
    cleanupOrphanedOccurrences,

    hasCredentials(): boolean {
      return credentials() !== null
    },

    setCredentials(clientId: string, clientSecret: string | null): void {
      settings.setFlag('googleClientId', clientId.trim() || null)
      settings.setFlag('googleClientSecret', clientSecret?.trim() || null)
    },

    aiStatus,

    setAiProvider(provider: AiProvider): void {
      if (!isProvider(provider)) throw new Error('Unknown AI provider')
      settings.setFlag('aiProvider', provider)
    },

    setAiCredentials(provider: AiProvider, apiKey: string | null, model: string | null): void {
      if (!isProvider(provider)) throw new Error('Unknown AI provider')
      settings.setFlag(`aiKey:${provider}`, apiKey?.trim() || null)
      settings.setFlag(`aiModel:${provider}`, model?.trim() || null)
      if (provider === 'anthropic') {
        // Clear the pre-provider flags so removing the key really removes it.
        settings.setFlag('anthropicApiKey', null)
        settings.setFlag('aiModel', null)
      }
    },

    dispose(): void {
      orchestrator.stop()
      reminders.stop()
      // Close any timer that is still running so its minutes are not lost on quit.
      const running = logs.anyRunning()
      if (running?.occurrenceId) logs.stop(running.occurrenceId, new Date().toISOString())
      db.close()
    }
  }
}

export type AppContext = ReturnType<typeof createContext>
