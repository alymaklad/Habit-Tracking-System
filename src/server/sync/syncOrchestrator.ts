import type { LocalDate, SyncConnectionState, SyncStatus } from '@shared/types'
import { ReauthRequired } from '../google/authService'
import type { AuthService } from '../google/authService'
import type { TaskProvisioner } from './taskProvisioner'
import type { TaskSyncer } from './taskSyncer'
import type { EventMirror } from './eventMirror'
import type { ScheduleService } from '../application/scheduleService'
import type { RecomputeService } from '../application/recomputeService'
import type { SettingsRepo } from '../persistence/settingsRepo'
import type { SyncRepo } from '../persistence/syncRepo'
import type { Db } from '../persistence/db'

/**
 * Runs one sync cycle: expand the schedule, provision tasks, mirror reminders, push
 * queued changes, pull Google's changes, recompute.
 *
 * There is no process that lives between requests, so nothing here keeps a timer.
 * A cycle runs when the open app asks for one (`runIfDue` on a light interval, `runNow`
 * from the Sync button) and from the daily cron for everyone else. What the next
 * request needs to know — the last outcome, the counters, the back-off — is stored with
 * the account. A Postgres advisory lock keeps two requests (or a request and the cron)
 * from syncing the same account at once.
 */

export type SyncTrigger = 'startup' | 'interval' | 'focus' | 'manual' | 'resume' | 'network' | 'cron'

const MAX_BACKOFF_MULTIPLIER = 8
const STATE_FLAG = 'syncRuntime'

interface Runtime {
  state: Exclude<SyncConnectionState, 'disconnected' | 'syncing'>
  lastRunAt: string | null
  backoff: number
  tasklistId: string | null
  counters: { provisioned: number; pulled: number; pushed: number }
}

const FRESH: Runtime = { state: 'connected', lastRunAt: null, backoff: 1, tasklistId: null, counters: { provisioned: 0, pulled: 0, pushed: 0 } }

export function syncOrchestrator(deps: {
  db: Db
  auth: AuthService
  provisioner: TaskProvisioner
  syncer: TaskSyncer
  mirror: EventMirror
  schedule: ScheduleService
  engine: RecomputeService
  settings: SettingsRepo
  sync: SyncRepo
  onStatusChange?: (status: SyncStatus) => void
  onAchievements?: (keys: string[]) => void | Promise<void>
}) {
  const { db, auth, provisioner, syncer, mirror, schedule, engine, settings, sync } = deps
  let running = false

  const runtime = async (): Promise<Runtime> => ({ ...FRESH, ...(await settings.getFlag<Partial<Runtime>>(STATE_FLAG, {})) })
  const saveRuntime = (r: Runtime): Promise<void> => settings.setFlag(STATE_FLAG, r)

  async function intervalMs(backoff: number): Promise<number> {
    const minutes = Math.min(60, Math.max(1, (await settings.all()).syncIntervalMinutes))
    return minutes * 60_000 * backoff
  }

  async function status(): Promise<SyncStatus> {
    const s = await settings.all()
    const r = await runtime()
    const connected = await auth.isConnected()
    const st = r.tasklistId ? await sync.state(r.tasklistId) : undefined
    const next = connected && r.lastRunAt ? new Date(new Date(r.lastRunAt).getTime() + (await intervalMs(r.backoff))).toISOString() : null
    return {
      state: running ? 'syncing' : connected ? r.state : 'disconnected',
      account: await auth.account(),
      tasklistName: await provisioner.tasklistName(),
      lastSyncAt: await sync.lastSuccessAnywhere(),
      nextSyncAt: next,
      intervalMinutes: s.syncIntervalMinutes,
      horizonDays: s.provisionHorizonDays,
      provisionedCount: r.counters.provisioned,
      pulledCount: r.counters.pulled,
      pushedCount: r.counters.pushed,
      queuedCount: await sync.queuedCount(),
      consecutiveFailures: st?.failures ?? 0,
      lastError: st?.last_error ?? null,
      recent: await sync.recent(8)
    }
  }

  async function emit(): Promise<void> {
    if (deps.onStatusChange) deps.onStatusChange(await status())
  }

  async function refreshAffected(affected: LocalDate[], horizon: { from: LocalDate; to: LocalDate }): Promise<void> {
    const dates = [...affected, horizon.from, horizon.to].sort()
    const from = dates[0] ?? horizon.from
    const to = dates[dates.length - 1] ?? horizon.to
    const { newAchievements } = await engine.refresh(from, to)
    if (newAchievements.length > 0) await deps.onAchievements?.(newAchievements)
  }

  async function withLock<T>(fn: () => Promise<T>): Promise<T | null> {
    const got = (await db.prepare("SELECT pg_try_advisory_lock(hashtext(current_schema() || ':sync')) AS ok").get()) as { ok: boolean }
    if (!got.ok) return null
    try {
      return await fn()
    } finally {
      await db.prepare("SELECT pg_advisory_unlock(hashtext(current_schema() || ':sync'))").get()
    }
  }

  async function cycle(trigger: SyncTrigger): Promise<void> {
    const horizon = await schedule.horizon()
    await schedule.expandHorizon()

    if (!(await auth.isConnected())) {
      await refreshAffected([], horizon)
      return
    }

    const r = await runtime()
    running = true
    await emit()

    try {
      const tasklistId = await provisioner.resolveTasklistId()
      r.tasklistId = tasklistId

      // Claim anything a crashed earlier cycle created but never recorded, before
      // provisioning can create a duplicate.
      await provisioner.reconcile(horizon.from, horizon.to)
      const provisioned = await provisioner.provision(horizon.from, horizon.to)
      await mirror.mirror(horizon.from, horizon.to)

      // Push local intent first so a pull cannot clobber a fresh local tick.
      const pushed = await syncer.push(tasklistId)
      const pulled = await syncer.pull(tasklistId)

      r.counters = { provisioned: provisioned.created + provisioned.adopted, pulled: pulled.applied, pushed: pushed.pushed }

      if (pulled.applied || pushed.pushed || provisioned.created || provisioned.adopted) {
        await sync.log(
          'info',
          `Sync (${trigger}): ${pulled.applied} change(s) in, ${pushed.pushed} out, ${provisioned.created + provisioned.adopted} task(s) provisioned`
        )
      }

      await refreshAffected(pulled.affected, horizon)
      await sync.markSuccess(tasklistId, new Date().toISOString())
      r.backoff = 1
      r.state = 'connected'
    } catch (err) {
      if (err instanceof ReauthRequired) {
        r.state = 'needs_reauth'
        await sync.log('error', 'Google connection expired — reconnect to resume syncing')
      } else {
        const message = err instanceof Error ? err.message : String(err)
        if (r.tasklistId) await sync.markFailure(r.tasklistId, message)
        await sync.log('error', `Sync failed: ${message}`)
        r.state = 'offline'
        r.backoff = Math.min(MAX_BACKOFF_MULTIPLIER, r.backoff * 2)
      }
    } finally {
      running = false
      r.lastRunAt = new Date().toISOString()
      await saveRuntime(r)
    }
  }

  async function runNow(trigger: SyncTrigger): Promise<SyncStatus> {
    if (!running) await withLock(() => cycle(trigger))
    const s = await status()
    deps.onStatusChange?.(s)
    return s
  }

  return {
    status,
    runNow,

    /** Runs a cycle only when the interval (with back-off) has passed since the last one. */
    async runIfDue(trigger: SyncTrigger, now: Date = new Date()): Promise<SyncStatus> {
      const r = await runtime()
      const due = !r.lastRunAt || now.getTime() - new Date(r.lastRunAt).getTime() >= (await intervalMs(r.backoff))
      return due ? runNow(trigger) : status()
    },

    async setIntervalMinutes(minutes: number): Promise<void> {
      await settings.save({ syncIntervalMinutes: Math.min(60, Math.max(1, minutes)) })
      const r = await runtime()
      await saveRuntime({ ...r, backoff: 1 })
    },

    async markDisconnected(): Promise<void> {
      await saveRuntime({ ...FRESH })
      await emit()
    }
  }
}

export type SyncOrchestrator = ReturnType<typeof syncOrchestrator>
