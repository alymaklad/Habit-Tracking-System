import type { OccurrenceStatus, SyncConnectionState } from '@shared/types'

export function duration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m}m`
  const h = Math.floor(m / 60)
  const rest = m % 60
  return rest === 0 ? `${h}h` : `${h}h ${String(rest).padStart(2, '0')}m`
}

export function relative(iso: string | null, now = Date.now()): string {
  if (!iso) return 'never'
  const ms = now - new Date(iso).getTime()
  if (ms < 0) return 'just now'
  const s = Math.floor(ms / 1000)
  if (s < 45) return 'just now'
  const m = Math.floor(s / 60)
  if (m < 60) return `${Math.max(m, 1)}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export function countdown(iso: string | null, now = Date.now()): string {
  if (!iso) return '—'
  const ms = new Date(iso).getTime() - now
  if (ms <= 0) return 'due now'
  const m = Math.floor(ms / 60000)
  if (m < 1) return '< 1m'
  if (m < 60) return `${m}m`
  return `${Math.floor(m / 60)}h`
}

export function clock(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
}

export function dayLabel(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'long',
    day: 'numeric',
    month: 'long'
  })
}

export function shortDay(date: string): string {
  return new Date(`${date}T12:00:00`).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric'
  })
}

export const STATUS_COLOR: Record<OccurrenceStatus, string> = {
  complete: 'var(--ok)',
  partial: 'var(--gold)',
  missed: 'var(--bad)',
  skipped: 'var(--faint)',
  pending: 'var(--faint)'
}

export const STATUS_LABEL: Record<OccurrenceStatus, string> = {
  complete: 'Completed',
  partial: 'In progress',
  missed: 'Missed',
  skipped: 'Skipped',
  pending: 'Not started'
}

export const SYNC_LABEL: Record<SyncConnectionState, string> = {
  connected: 'Connected',
  syncing: 'Syncing…',
  offline: 'Offline',
  needs_reauth: 'Google connection expired',
  disconnected: 'Not connected'
}

export const SYNC_COLOR: Record<SyncConnectionState, string> = {
  connected: 'var(--ok)',
  syncing: 'var(--accent)',
  offline: 'var(--gold)',
  needs_reauth: 'var(--bad)',
  disconnected: 'var(--faint)'
}

/** Local `YYYY-MM-DD` for a Date, without going through UTC. */
export function toLocalDate(d: Date): string {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

export function addDays(date: string, n: number): string {
  const d = new Date(`${date}T12:00:00`)
  d.setDate(d.getDate() + n)
  return toLocalDate(d)
}

export function mondayOf(date: string): string {
  const d = new Date(`${date}T12:00:00`)
  const wd = (d.getDay() + 6) % 7
  d.setDate(d.getDate() - wd)
  return toLocalDate(d)
}

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

export function describeRecurrence(r: { kind: string; days?: number[]; n?: number }): string {
  if (r.kind === 'everyN') return r.n === 1 ? 'Daily' : `Every ${r.n} days`
  const days = [...(r.days ?? [])].sort((a, b) => a - b)
  if (days.length === 7) return 'Daily'
  if (days.length === 5 && days.every((d) => d <= 5)) return 'Mon–Fri'
  if (days.length === 2 && days[0] === 6 && days[1] === 7) return 'Weekends'
  return days.map((d) => DAY_NAMES[d - 1]).join('/')
}
