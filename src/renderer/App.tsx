import { useCallback, useEffect, useState, type ReactElement } from 'react'
import type { AppSettings, SyncStatus, ToastMessage } from '@shared/types'
import Sidebar, { type Route } from './components/Sidebar'
import { SyncDetailsPanel } from './components/SyncStatus'
import { useData } from './hooks/useData'
import Dashboard from './routes/Dashboard'
import Habits from './routes/Habits'
import CalendarRoute from './routes/Calendar'
import Progress from './routes/Progress'
import Achievements from './routes/Achievements'
import Settings from './routes/Settings'
import { Leaderboard, Challenges } from './routes/PhaseThree'

export default function App() {
  const [route, setRoute] = useState<Route>('dashboard')
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [syncOpen, setSyncOpen] = useState(false)
  const [toasts, setToasts] = useState<(ToastMessage & { id: number })[]>([])

  const { data: dashboard } = useData(() => window.api.view.dashboard(), [])
  const { data: settings, refetch: refetchSettings } = useData<AppSettings>(
    () => window.api.settings.get(),
    []
  )

  // The main process owns sync state and pushes it; the renderer never polls Google.
  useEffect(() => {
    void window.api.google.status().then(setStatus)
    return window.api.on.syncStatus(setStatus)
  }, [])

  useEffect(
    () =>
      window.api.on.toast((message) => {
        const id = Date.now() + Math.random()
        setToasts((t) => [...t, { ...message, id }])
        setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000)
      }),
    []
  )

  // Theme is a document-level attribute so the CSS token blocks switch wholesale.
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    const resolve = (): string => {
      if (settings.theme !== 'system') return settings.theme
      return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
    }
    root.setAttribute('data-theme', resolve())
    root.setAttribute('data-reduce-motion', String(settings.reduceMotion))

    if (settings.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: light)')
    const onChange = (): void => root.setAttribute('data-theme', resolve())
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [settings])

  const reconnect = useCallback(async () => {
    const result = await window.api.google.connect()
    if (!result.ok) {
      setToasts((t) => [
        ...t,
        { id: Date.now(), kind: 'error', title: 'Could not connect', body: result.error }
      ])
    }
    setSyncOpen(false)
  }, [])

  const screens: Record<Route, ReactElement> = {
    dashboard: <Dashboard />,
    habits: <Habits />,
    calendar: <CalendarRoute />,
    progress: <Progress />,
    achievements: <Achievements />,
    leaderboard: <Leaderboard />,
    challenges: <Challenges />,
    settings: <Settings status={status} onSettingsChanged={refetchSettings} />
  }

  return (
    <div style={{ height: '100%', display: 'flex', position: 'relative', overflow: 'hidden' }}>
      <Sidebar
        route={route}
        onNavigate={setRoute}
        level={dashboard?.level ?? null}
        status={status}
        onOpenSync={() => setSyncOpen((o) => !o)}
      />

      <main style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        {screens[route]}
      </main>

      {syncOpen && status ? (
        <>
          <div
            onClick={() => setSyncOpen(false)}
            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
            aria-hidden="true"
          />
          <SyncDetailsPanel
            status={status}
            onClose={() => setSyncOpen(false)}
            onSyncNow={() => void window.api.google.syncNow().then(setStatus)}
            onReconnect={() => void reconnect()}
            onSettings={() => {
              setRoute('settings')
              setSyncOpen(false)
            }}
          />
        </>
      ) : null}

      {toasts.length > 0 ? (
        <div
          style={{
            position: 'fixed',
            right: 20,
            bottom: 20,
            zIndex: 60,
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
        >
          {toasts.map((t) => (
            <div
              key={t.id}
              className="rise"
              style={{
                minWidth: 260,
                maxWidth: 360,
                padding: '12px 15px',
                background: 'var(--panel)',
                borderLeft: `2px solid ${
                  t.kind === 'error'
                    ? 'var(--bad)'
                    : t.kind === 'warn'
                      ? 'var(--gold)'
                      : t.kind === 'success'
                        ? 'var(--ok)'
                        : 'var(--accent)'
                }`,
                border: '1px solid var(--line)',
                boxShadow: '0 14px 40px -12px rgba(0,0,0,.6)'
              }}
            >
              <div className="display" style={{ fontSize: 13 }}>
                {t.title}
              </div>
              {t.body ? (
                <div style={{ fontSize: 11.5, color: 'var(--dim)', marginTop: 3, textWrap: 'pretty' }}>
                  {t.body}
                </div>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}
