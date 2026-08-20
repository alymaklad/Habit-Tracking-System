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

/**
 * Drives the sync cycle and owns the state the actionable status control renders from.
 *
 * Polling is not a shortcut here — the Google Tasks API has no watch or push mechanism
 * of any kind, so an interval is the only available transport for the completion
 * signal the whole app depends on.
 */

export type SyncTrigger = 'startup' | 'interval' | 'focus' | 'manual' | 'resume' | 'network'

const MAX_BACKOFF_MULTIPLIER = 8

export function syncOrchestrator(deps: {
  auth: AuthService
  provisioner: TaskProvisioner
  syncer: TaskSyncer
  mirror: EventMirror
  schedule: ScheduleService
  engine: RecomputeService
  settings: SettingsRepo
  sync: SyncRepo
  onStatusChange?: (status: SyncStatus) => void
  onAchievements?: (keys: string[]) => void
  onCycleComplete?: () => void
}) {
  const { auth, provisioner, syncer, mirror, schedule, engine, settings, sync } = deps

  let state: SyncConnectionState = 'disconnected'
  let timer: NodeJS.Timeout | null = null
  let running = false
  let nextSyncAt: string | null = null
  let counters = { provisioned: 0, pulled: 0, pushed: 0 }
  let backoff = 1

  function intervalMs(): number {
    const minutes = Math.min(60, Math.max(1, settings.all().syncIntervalMinutes))
    return minutes * 60_000 * backoff
  }

  function status(): SyncStatus {
    const s = settings.all()
    return {
      state,
      account: auth.account(),
      tasklistName: provisioner.tasklistName(),
      lastSyncAt: sync.lastSuccessAnywhere(),
      nextSyncAt,
      intervalMinutes: s.syncIntervalMinutes,
      horizonDays: s.provisionHorizonDays,
      provisionedCount: counters.provisioned,
      pulledCount: counters.pulled,
      pushedCount: counters.pushed,
      queuedCount: sync.queuedCount(),
      consecutiveFailures: failures(),
      lastError: lastError(),
      recent: sync.recent(8)
    }
  }

  function failures(): number {
    const id = currentTasklistId
    return id ? (sync.state(id)?.failures ?? 0) : 0
  }

  function lastError(): string | null {
    const id = currentTasklistId
    return id ? (sync.state(id)?.last_error ?? null) : null
  }

  let currentTasklistId: string | null = null

  function setState(next: SyncConnectionState): void {
    if (state === next) return
    state = next
    deps.onStatusChange?.(status())
  }

  function emit(): void {
    deps.onStatusChange?.(status())
  }

  function scheduleNext(): void {
    if (timer) clearTimeout(timer)
    const ms = intervalMs()
    nextSyncAt = new Date(Date.now() + ms).toISOString()
    timer = setTimeout(() => void runNow('interval'), ms)
    timer.unref?.()
    emit()
  }

  /** Recompute the range a pull touched, plus the schedule horizon. */
  function refreshAffected(affected: LocalDate[], horizon: { from: LocalDate; to: LocalDate }) {
    const dates = [...affected, horizon.from, horizon.to].sort()
    const from = dates[0] ?? horizon.from
    const to = dates[dates.length - 1] ?? horizon.to
    const { newAchievements } = engine.refresh(from, to)
    if (newAchievements.length > 0) deps.onAchievements?.(newAchievements)
  }

  async function runNow(trigger: SyncTrigger): Promise<SyncStatus> {
    if (running) return status()

    if (!auth.isConnected()) {
      // Offline-first: the schedule and every derived figure still update without
      // Google. Only the tick-from-anywhere convenience is missing.
      const horizon = schedule.horizon()
      schedule.expandHorizon()
      refreshAffected([], horizon)
      setState('disconnected')
      return status()
    }

    running = true
    setState('syncing')

    try {
      const horizon = schedule.horizon()
      schedule.expandHorizon()

      const tasklistId = await provisioner.resolveTasklistId()
      currentTasklistId = tasklistId

      // Always reconcile before provisioning. A create that failed mid-flight leaves
      // its occurrence in `creating`, and only this pass can decide whether the task
      // reached Google. It costs one extra list call and early-returns when nothing is
      // stranded, so running it every cycle is cheaper than shipping a duplicate.
      await provisioner.reconcile(horizon.from, horizon.to)

      const provisioned = await provisioner.provision(horizon.from, horizon.to)

      // Mirror the timed reminder events. This is delivery only — it is never read
      // back, and a failure here must not fail the sync, so it is caught inside.
      await mirror.mirror(horizon.from, horizon.to)

      const pushed = await syncer.push(tasklistId)
      const pulled = await syncer.pull(tasklistId)

      counters = {
        provisioned: provisioned.created + provisioned.adopted,
        pulled: pulled.applied,
        pushed: pushed.pushed
      }

      if (pulled.applied || pushed.pushed || provisioned.created || provisioned.adopted) {
        sync.log(
          'info',
          `Sync (${trigger}): ${pulled.applied} change(s) in, ${pushed.pushed} out, ${provisioned.created + provisioned.adopted} task(s) provisioned`
        )
      }

      refreshAffected(pulled.affected, horizon)

      sync.markSuccess(tasklistId, new Date().toISOString())
      backoff = 1
      setState('connected')
    } catch (err) {
      if (err instanceof ReauthRequired) {
        setState('needs_reauth')
        sync.log('error', 'Google connection expired — reconnect to resume syncing')
      } else {
        const message = err instanceof Error ? err.message : String(err)
        if (currentTasklistId) sync.markFailure(currentTasklistId, message)
        sync.log('error', `Sync failed: ${message}`)
        // A failed cycle must never leave local data half-written; every write above
        // runs inside its own transaction, so there is nothing to unwind here.
        setState('offline')
        backoff = Math.min(MAX_BACKOFF_MULTIPLIER, backoff * 2)
      }
    } finally {
      running = false
      // Reminders are re-armed after every cycle: new occurrences may have appeared,
      // and a completion pulled from Google should cancel its own reminder.
      deps.onCycleComplete?.()
      scheduleNext()
    }

    return status()
  }

  return {
    status,
    emit,

    start(): void {
      void runNow('startup')
    },

    stop(): void {
      if (timer) clearTimeout(timer)
      timer = null
      nextSyncAt = null
    },

    runNow,

    /** Called when the window regains focus, the machine wakes, or the network returns. */
    nudge(trigger: SyncTrigger): void {
      void runNow(trigger)
    },

    setIntervalMinutes(minutes: number): void {
      settings.save({ syncIntervalMinutes: Math.min(60, Math.max(1, minutes)) })
      backoff = 1
      scheduleNext()
    },

    markDisconnected(): void {
      currentTasklistId = null
      counters = { provisioned: 0, pulled: 0, pushed: 0 }
      setState('disconnected')
    }
  }
}

export type SyncOrchestrator = ReturnType<typeof syncOrchestrator>
