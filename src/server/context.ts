import { join } from 'node:path'
import type { AiProvider, AiStatus, SyncStatus, ToastMessage } from '@shared/types'
import type { Db } from './persistence/db'
import { habitRepo } from './persistence/habitRepo'
import { occurrenceRepo } from './persistence/occurrenceRepo'
import { logRepo } from './persistence/logRepo'
import { recordRepo } from './persistence/recordRepo'
import { settingsRepo } from './persistence/settingsRepo'
import { syncRepo } from './persistence/syncRepo'
import { todoRepo } from './persistence/todoRepo'
import { goalRepo } from './persistence/goalRepo'
import { letGoRepo } from './persistence/letGoRepo'
import { journalRepo } from './persistence/journalRepo'
import { reflectService } from './application/reflectService'
import { blobConfigured, blobStore, diskStore, type AttachmentStore } from './platform/attachmentStore'
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
import { open, seal } from './platform/secretBox'
import { tokenVault } from './google/tokenVault'
import { authService, type AuthCredentials } from './google/authService'
import { letGoPlanner } from './ai/letGoPlanner'
import { letGoPlanService } from './application/letGoPlanService'
import { tasksClient } from './google/tasksClient'
import { calendarClient } from './google/calendarClient'
import { taskProvisioner } from './sync/taskProvisioner'
import { taskSyncer } from './sync/taskSyncer'
import { eventMirror } from './sync/eventMirror'
import { syncOrchestrator } from './sync/syncOrchestrator'
import { ACHIEVEMENTS } from './domain/achievements'

/** What a request can hear back while it runs; the HTTP layer streams these to the browser. */
export interface ContextEvents {
  syncStatus?: (status: SyncStatus) => void
  toast?: (message: ToastMessage) => void
  /** A notification for the browser to show (the web's stand-in for a native toast). */
  notify?: (title: string, body: string) => void
}

export interface ContextOptions {
  /** A database connection already pointed at this account's schema. */
  db: Db
  /** The account's schema name; also the folder its files live under. */
  schema: string
  events?: ContextEvents
  /** Overrides for tests; production reads the environment. */
  googleClient?: AuthCredentials | null
  files?: AttachmentStore
}

const AI_KEY_PURPOSE = 'ai-key'

/**
 * Wires the application graph for ONE account, for the length of one request.
 *
 * Dependencies point one way: persistence ← domain ← application ← sync, with Google
 * behind its own clients. Nothing here knows about HTTP, which is what lets the engine,
 * sync and notification tests run against an in-memory Postgres.
 */
export function createContext(opts: ContextOptions) {
  const { db } = opts
  const events = opts.events ?? {}

  const habits = habitRepo(db)
  const occurrences = occurrenceRepo(db)
  const logs = logRepo(db)
  const records = recordRepo(db)
  const settings = settingsRepo(db)
  const sync = syncRepo(db)
  const todos = todoRepo(db)
  const goals = goalRepo(db)
  const letGo = letGoRepo(db)
  const journal = journalRepo(db)

  const schedule = scheduleService({ db, habits, occurrences, settings })
  const engine = recomputeService({ db, habits, occurrences, logs, records, settings })
  const habitsApi = habitService({ db, habits, occurrences, logs, records, settings, schedule, engine })
  const todosApi = todoService({ db, todos, occurrences, settings, habits: habitsApi })

  // ------------------------------------------------------------------ AI

  // A key pasted into Settings wins over the server's environment. Keys and models are
  // stored per provider so switching back and forth does not lose either; keys are
  // sealed, since they are spendable credentials.
  const ENV_KEY: Record<AiProvider, string | undefined> = {
    anthropic: process.env.ANTHROPIC_API_KEY,
    groq: process.env.GROQ_API_KEY
  }

  async function aiProvider(): Promise<AiProvider> {
    const stored = await settings.getFlag<string | null>('aiProvider', null)
    if (isProvider(stored)) return stored
    // With no choice made, use whichever provider the server has a key for.
    return !ENV_KEY.anthropic && ENV_KEY.groq ? 'groq' : 'anthropic'
  }

  async function aiApiKey(provider: AiProvider): Promise<string | null> {
    const sealed = await settings.getFlag<string | null>(`aiKey:${provider}`, null)
    const own = sealed ? open(AI_KEY_PURPOSE, sealed) : null
    return own ?? ENV_KEY[provider] ?? null
  }

  async function aiModel(provider: AiProvider): Promise<string> {
    return (await settings.getFlag<string | null>(`aiModel:${provider}`, null)) ?? PROVIDERS[provider].defaultModel
  }

  async function aiStatus(): Promise<AiStatus> {
    const provider = await aiProvider()
    return {
      provider,
      ready: (await aiApiKey(provider)) !== null,
      providers: await Promise.all(
        PROVIDER_IDS.map(async (id) => ({
          id,
          label: PROVIDERS[id].label,
          hasKey: (await aiApiKey(id)) !== null,
          model: await aiModel(id),
          defaultModel: PROVIDERS[id].defaultModel,
          keyPlaceholder: PROVIDERS[id].keyPlaceholder,
          note: PROVIDERS[id].note
        }))
      )
    }
  }

  /** The configured AI provider; throws a readable error when it has no key yet. */
  async function aiClient() {
    const provider = await aiProvider()
    const apiKey = await aiApiKey(provider)
    if (!apiKey) throw new Error(`Add a ${PROVIDERS[provider].label} API key in Settings to make a plan.`)
    return PROVIDERS[provider].create(apiKey, await aiModel(provider))
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
    planner: async () => anthropicGoalPlanner({ ai: await aiClient() })
  })

  const files =
    opts.files ?? (blobConfigured() ? blobStore(opts.schema) : diskStore(join(process.cwd(), '.data', 'attachments', opts.schema)))

  const reflect = reflectService({
    letGo,
    journal,
    goals,
    settings,
    files,
    goalViews: () => goalsApi.list()
  })

  const letGoPlans = letGoPlanService({
    db,
    settings,
    habits: habitsApi,
    reflect,
    planningContext: (now) => goalsApi.planningContext(now),
    planner: async () => letGoPlanner({ ai: await aiClient() })
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
    config: async () => (await settings.all()).push,
    log: (m) => sync.log('warn', m)
  })

  const notifications = notificationService({
    settings: () => settings.all(),
    push,
    toast: (title, body) => {
      events.notify?.(title, body)
    },
    log: (m) => sync.log('info', m)
  })

  const reminders = reminderScheduler({ habits, occurrences, settings, notifications })

  // ------------------------------------------------------------- Google

  const vault = tokenVault(sync)

  function credentials(): AuthCredentials | null {
    if (opts.googleClient !== undefined) return opts.googleClient
    const clientId = process.env.GOOGLE_CLIENT_ID || ''
    const clientSecret = process.env.GOOGLE_CLIENT_SECRET || undefined
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
   * `google_event_id`, and `provisioner.removeOrphans` hard-deletes that row.
   */
  async function cleanupOrphanedOccurrences(occurrenceIds: number[]): Promise<void> {
    if (occurrenceIds.length === 0) return
    for (const id of occurrenceIds) {
      await mirror.remove(id).catch(() => undefined)
    }
    await provisioner.removeOrphans(occurrenceIds).catch(() => undefined)
  }

  const orchestrator = syncOrchestrator({
    db,
    auth,
    provisioner,
    syncer,
    mirror,
    schedule,
    engine,
    settings,
    sync,
    onStatusChange: events.syncStatus,
    onAchievements: async (keys) => {
      for (const key of keys) {
        const def = ACHIEVEMENTS.find((a) => a.key === key)
        if (def) await notifications.achievementUnlocked(def.name)
      }
    }
  })

  /**
   * Once per account: settle the time zone from the browser. Then, cheaply on every
   * session start, make sure the schedule reaches the horizon and unfinished to-dos
   * follow the user into today.
   */
  async function bootstrap(timezone: string | null): Promise<void> {
    if (!(await settings.getFlag<boolean>('bootstrapped', false))) {
      await settings.save({ timezone: validTimezone(timezone) ?? 'UTC' })
      await settings.setFlag('bootstrapped', true)
    }
    await schedule.expandHorizon()
    const horizon = await schedule.horizon()
    await engine.refresh(horizon.from, horizon.to)
    await todosApi.carryForward()
    await todosApi.applyTemplatesInRange(horizon.from, horizon.to)
  }

  return {
    repos: { habits, occurrences, logs, records, settings, sync, todos, goals, letGo, journal },
    schedule,
    engine,
    habits: habitsApi,
    todos: todosApi,
    goals: goalsApi,
    letGoPlans,
    reflect,
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

    aiStatus,

    /** Whether AI calls run on a key this account pasted in (not the server's own). */
    async aiUsesOwnKey(): Promise<boolean> {
      const sealed = await settings.getFlag<string | null>(`aiKey:${await aiProvider()}`, null)
      return Boolean(sealed && open(AI_KEY_PURPOSE, sealed))
    },

    async setAiProvider(provider: AiProvider): Promise<void> {
      if (!isProvider(provider)) throw new Error('Unknown AI provider')
      await settings.setFlag('aiProvider', provider)
    },

    async setAiCredentials(provider: AiProvider, apiKey: string | null, model: string | null): Promise<void> {
      if (!isProvider(provider)) throw new Error('Unknown AI provider')
      const key = apiKey?.trim()
      await settings.setFlag(`aiKey:${provider}`, key ? seal(AI_KEY_PURPOSE, key) : null)
      await settings.setFlag(`aiModel:${provider}`, model?.trim() || null)
    }
  }
}

export type AppContext = ReturnType<typeof createContext>

export function validTimezone(tz: string | null | undefined): string | null {
  if (!tz) return null
  try {
    new Intl.DateTimeFormat('en', { timeZone: tz })
    return tz
  } catch {
    return null
  }
}
