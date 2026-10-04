import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import { CalendarDays, CircleCheck, Search, TriangleAlert, X } from 'lucide-react'
import type { AppSettings, SyncStatus, ToastMessage } from '@shared/types'
import { SyncDetailsPanel } from './components/SyncStatus'
import { useData } from './hooks/useData'
import { initial } from './lib/khatwa'
import Rail from './khatwa/Rail'
import Palette from './khatwa/Palette'
import { CRUMBS, railKey, ShellContext, type Route, type RouteName, type Shell } from './khatwa/nav'
import Today from './routes/Today'
import Journey from './routes/Journey'
import Mountains from './routes/Mountains'
import MountainDetail from './routes/MountainDetail'
import Expedition from './routes/Expedition'
import Me from './routes/Me'
import Habits from './routes/Habits'
import CalendarRoute from './routes/Calendar'
import WeeklyReviewRoute from './routes/WeeklyReview'
import Achievements from './routes/Achievements'
import Settings from './routes/Settings'
import Todo from './routes/Todo'
import Progress from './routes/Progress'
import HabitDetail from './routes/HabitDetail'
import LetGo from './routes/LetGo'
import Ceremony from './routes/Ceremony'
import Journal from './routes/Journal'
import ActiveSession from './khatwa/ActiveSession'

type Toast = ToastMessage & { id: number }

export default function App() {
  const [route, setRoute] = useState<Route>({ name: 'today' })
  const [status, setStatus] = useState<SyncStatus | null>(null)
  const [syncOpen, setSyncOpen] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [toasts, setToasts] = useState<Toast[]>([])
  const [session, setSession] = useState<number | null>(null)

  const { data: dashboard } = useData(() => window.api.view.dashboard(), [])
  const { data: settings, refetch: refetchSettings } = useData<AppSettings>(() => window.api.settings.get(), [])

  const pushToast = useCallback((message: ToastMessage) => {
    const id = Date.now() + Math.random()
    setToasts((t) => [...t, { ...message, id }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5200)
  }, [])

  // The main process owns sync state and pushes it; the renderer never polls Google.
  useEffect(() => {
    void window.api.google.status().then(setStatus)
    return window.api.on.syncStatus(setStatus)
  }, [])

  useEffect(() => window.api.on.toast(pushToast), [pushToast])

  // Theme is a document-level attribute so the token blocks switch wholesale.
  useEffect(() => {
    if (!settings) return
    const root = document.documentElement
    const resolve = (): string => {
      if (settings.theme !== 'system') return settings.theme
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
    }
    root.setAttribute('data-theme', resolve())
    root.setAttribute('data-reduce-motion', String(settings.reduceMotion))
    if (settings.theme !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = (): void => root.setAttribute('data-theme', resolve())
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [settings])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((o) => !o)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const navigate = useCallback((next: Route) => {
    setRoute(next)
    setSyncOpen(false)
    document.querySelector('.kh-scroll')?.scrollTo({ top: 0 })
  }, [])

  const reconnect = useCallback(async () => {
    const result = await window.api.google.connect()
    if (!result.ok) pushToast({ kind: 'error', title: 'Could not connect to Google', body: result.error })
    setSyncOpen(false)
  }, [pushToast])

  const shell = useMemo<Shell>(
    () => ({
      navigate,
      settings: settings ?? null,
      level: dashboard?.level ?? null,
      toast: (kind, title, body) => pushToast({ kind, title, body }),
      openSession: setSession
    }),
    [navigate, settings, dashboard?.level, pushToast]
  )

  const displayName = settings?.displayName ?? ''

  const screen: ReactElement = (() => {
    switch (route.name) {
      case 'today':
        return <Today />
      case 'journey':
        return <Journey />
      case 'mountains':
        return <Mountains />
      case 'mountain':
        return <MountainDetail id={route.id} />
      case 'expedition':
        return <Expedition resume={route.resume} />
      case 'me':
        return <Me />
      case 'habits':
        return <Habits edit={route.edit} />
      case 'calendar':
        return <CalendarRoute />
      case 'review':
        return <WeeklyReviewRoute />
      case 'achievements':
        return <Achievements />
      case 'habit':
        return <HabitDetail id={route.id} />
      case 'todo':
        return <Todo />
      case 'progress':
        return <Progress />
      case 'letgo':
        return <LetGo id={route.id} create={route.create} />
      case 'ceremony':
        return <Ceremony id={route.id} />
      case 'journal':
        return <Journal prompt={route.prompt} goalId={route.goalId} letGoId={route.letGoId} kind={route.kind} />
      case 'settings':
        return <Settings status={status} onSettingsChanged={refetchSettings} />
    }
  })()

  const [crumbA, crumbB] = CRUMBS[route.name]
  const todayLabel = new Date().toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' })

  return (
    <ShellContext.Provider value={shell}>
      <div className="kh-app">
        <Rail
          active={railKey(route)}
          onNavigate={(key: RouteName) => navigate({ name: key } as Route)}
          level={dashboard?.level ?? null}
          displayName={displayName}
          status={status}
          onOpenSync={() => setSyncOpen((o) => !o)}
        />

        <div className="kh-main">
          <header className="kh-header">
            <div className="kh-crumbs">
              <span className="truncate">{crumbA}</span>
              <span className="text-ink-4">/</span>
              <b className="truncate">{crumbB}</b>
            </div>
            <button className="kh-search" onClick={() => setPaletteOpen(true)}>
              <Search size={15} />
              <span>Search the folio…</span>
              <kbd>Ctrl K</kbd>
            </button>
            <span className="kh-header-date">
              <CalendarDays size={15} />
              {todayLabel}
            </span>
            <button className="kh-monogram !w-9 !h-9 !text-[15px] after:hidden" onClick={() => navigate({ name: 'me' })} title="Me">
              {initial(displayName)}
            </button>
          </header>

          <main className="kh-scroll" key={'id' in route && route.id !== undefined ? `${route.name}-${route.id}` : route.name}>
            {screen}
          </main>
        </div>

        {syncOpen && status ? (
          <>
            <div onClick={() => setSyncOpen(false)} className="fixed inset-0 z-40" aria-hidden="true" />
            <SyncDetailsPanel
              status={status}
              onClose={() => setSyncOpen(false)}
              onSyncNow={() => void window.api.google.syncNow().then(setStatus)}
              onReconnect={() => void reconnect()}
              onSettings={() => navigate({ name: 'settings' })}
            />
          </>
        ) : null}

        {session !== null ? (
          <ActiveSession
            occurrenceId={session}
            onClose={() => setSession(null)}
            onNavigateMountain={(id) => {
              setSession(null)
              navigate({ name: 'mountain', id })
            }}
          />
        ) : null}

        {paletteOpen ? <Palette onClose={() => setPaletteOpen(false)} onGo={navigate} /> : null}

        {toasts.length > 0 ? (
          <div className="kh-toasts" aria-live="polite">
            {toasts.map((t) => (
              <div key={t.id} className={`kh-toast kh-rise ${t.kind === 'error' ? 'is-error' : t.kind === 'warn' ? 'is-warn' : ''}`}>
                {t.kind === 'error' || t.kind === 'warn' ? (
                  <TriangleAlert size={16} className={`mt-0.5 shrink-0 ${t.kind === 'error' ? 'text-[var(--error)]' : 'text-[var(--ochre-deep)]'}`} />
                ) : (
                  <CircleCheck size={16} className="mt-0.5 shrink-0 text-laurel" />
                )}
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <span className="text-[14px] font-semibold">{t.title}</span>
                  {t.body ? <span className="text-[13px] leading-5 text-ink-3 [text-wrap:pretty]">{t.body}</span> : null}
                </div>
                <button className="text-ink-4 hover:text-ink" aria-label="Dismiss" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
                  <X size={14} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </ShellContext.Provider>
  )
}
