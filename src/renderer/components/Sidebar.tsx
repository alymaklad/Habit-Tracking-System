import type { LevelInfo, SyncStatus } from '@shared/types'
import Icon from './Icon'
import { SyncStatusControl } from './SyncStatus'

export type Route =
  | 'dashboard'
  | 'habits'
  | 'calendar'
  | 'progress'
  | 'leaderboard'
  | 'achievements'
  | 'challenges'
  | 'settings'

const NAV: { key: Route; label: string; icon: Parameters<typeof Icon>[0]['name']; phase3?: boolean }[] =
  [
    { key: 'dashboard', label: 'Dashboard', icon: 'dashboard' },
    { key: 'habits', label: 'Habits', icon: 'habits' },
    { key: 'calendar', label: 'Calendar', icon: 'calendar' },
    { key: 'progress', label: 'Progress', icon: 'progress' },
    { key: 'leaderboard', label: 'Leaderboard', icon: 'leaderboard', phase3: true },
    { key: 'achievements', label: 'Achievements', icon: 'achievements' },
    { key: 'challenges', label: 'Challenges', icon: 'challenges', phase3: true },
    { key: 'settings', label: 'Settings', icon: 'settings' }
  ]

export default function Sidebar({
  route,
  onNavigate,
  level,
  status,
  onOpenSync
}: {
  route: Route
  onNavigate: (r: Route) => void
  level: LevelInfo | null
  status: SyncStatus | null
  onOpenSync: () => void
}) {
  return (
    <nav
      style={{
        width: 202,
        flexShrink: 0,
        background: 'var(--panel)',
        borderRight: '1px solid var(--line)',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      {/* Rank badge — level and lifetime XP, always visible. */}
      <div
        style={{
          padding: '22px 18px 20px',
          display: 'flex',
          alignItems: 'center',
          gap: 13,
          borderBottom: '1px solid var(--line)'
        }}
      >
        <div style={{ position: 'relative', width: 42, height: 46, flexShrink: 0 }}>
          <svg width="42" height="46" viewBox="0 0 42 46" fill="none">
            <path
              d="M21 1.5 39.5 12v22L21 44.5 2.5 34V12Z"
              fill="var(--panel2)"
              stroke="var(--accent)"
              strokeWidth="1.5"
            />
          </svg>
          <span
            className="num"
            style={{
              position: 'absolute',
              inset: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: 21,
              color: 'var(--accent)',
              paddingBottom: 1
            }}
          >
            {level?.level ?? 1}
          </span>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
          <span className="display" style={{ fontSize: 16 }}>
            {level?.title ?? 'Beginner'}
          </span>
          <span className="label">{(level?.currentXp ?? 0).toLocaleString()} XP</span>
        </div>
      </div>

      <div style={{ padding: '12px 10px', display: 'flex', flexDirection: 'column', gap: 2, flexGrow: 1 }}>
        {NAV.map((item) => {
          const on = item.key === route
          return (
            <button
              key={item.key}
              onClick={() => onNavigate(item.key)}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                padding: '9px 11px',
                background: on ? 'var(--panel2)' : 'transparent',
                borderLeft: `2px solid ${on ? 'var(--accent)' : 'transparent'}`,
                color: on ? 'var(--fg)' : item.phase3 ? 'var(--faint)' : 'var(--dim)',
                textAlign: 'left',
                transition: 'background .12s ease'
              }}
              onMouseEnter={(e) => {
                if (!on) e.currentTarget.style.background = 'color-mix(in oklab, var(--panel2) 55%, transparent)'
              }}
              onMouseLeave={(e) => {
                if (!on) e.currentTarget.style.background = 'transparent'
              }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
                <Icon name={item.icon} size={15} color={on ? 'var(--accent)' : 'currentColor'} />
                <span style={{ fontWeight: on ? 600 : 400 }}>{item.label}</span>
              </span>
              {item.phase3 ? (
                <span
                  className="display"
                  style={{
                    fontSize: 9,
                    letterSpacing: '0.1em',
                    color: 'var(--faint)',
                    border: '1px solid var(--line)',
                    padding: '1px 5px'
                  }}
                >
                  P3
                </span>
              ) : null}
            </button>
          )
        })}
      </div>

      {status ? <SyncStatusControl status={status} onOpen={onOpenSync} /> : null}
    </nav>
  )
}
