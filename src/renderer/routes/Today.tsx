import { useEffect, useMemo, useState } from 'react'
import {
  BookOpen,
  ChevronDown,
  Clock,
  Ellipsis,
  Flame,
  Mountain,
  Pause,
  Play,
  Plus,
  Sunset,
  Trash2,
  X
} from 'lucide-react'
import type { DashboardCard, GoalView, Habit, LetGoView, TodoGroup, TodoView } from '@shared/types'
import emblem from '../assets/emblem-large.png'
import { useData, useTick } from '../hooks/useData'
import { duration } from '../lib/format'
import { firstName, greeting, longDate, time12, toMinutes, today } from '../lib/khatwa'
import { useShell } from '../khatwa/nav'
import { CheckInModal } from '../khatwa/letgo'
import { Page, SectionHead } from '../khatwa/Page'
import { Alert, Btn, CheckBox, Dot, LoadError, Loading, Ring, Stamp } from '../khatwa/ui'

type Everything = {
  todos: TodoView
  habits: Habit[]
  goals: GoalView[]
  consistency: number | null
  weekBars: { label: string; value: number; isToday: boolean }[]
  streak: number
  letGos: LetGoView[]
}

function elapsedSeconds(card: DashboardCard, now: number): number {
  if (!card.timerRunning || !card.timerStartedAt) return 0
  return Math.max(0, Math.floor((now - new Date(card.timerStartedAt).getTime()) / 1000))
}

function clockFace(seconds: number): string {
  const h = Math.floor(seconds / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const s = seconds % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

/** Where the step sits against the clock, in the design's quiet voice. */
function windowLabel(card: DashboardCard, nowMinutes: number): string {
  if (card.timerRunning) return 'Session in progress'
  const delta = toMinutes(card.scheduledTime) - nowMinutes
  if (delta > 60) return `Opens in ${duration(delta)}`
  if (delta > 0) return 'Approaching focal window'
  if (delta > -card.targetMinutes) return 'Present focal window'
  return `Waiting since ${time12(card.scheduledTime)}`
}

function originStamp(card: DashboardCard): { text: string; tone: 'laurel' | 'plain' | 'ochre' } | null {
  if (card.status === 'skipped') return { text: 'Rested', tone: 'plain' }
  if (card.status !== 'complete' && card.status !== 'partial') return null
  if (card.origin === 'timer') return { text: 'Verified', tone: 'laurel' }
  if (card.origin === 'manual') return { text: 'Done', tone: 'plain' }
  if (card.origin === 'assumed') return { text: 'Assumed', tone: 'ochre' }
  return { text: 'Done', tone: 'plain' }
}

function checkState(card: DashboardCard): 'done' | 'partial' | 'missed' | 'open' {
  if (card.status === 'complete') return 'done'
  if (card.status === 'partial') return 'partial'
  if (card.status === 'missed') return 'missed'
  return 'open'
}

/** Secondary actions for one step: its sub-steps, hand-logged minutes and a rest day. */
function StepTools({ card, group, onBusy }: { card: DashboardCard; group: TodoGroup | undefined; onBusy: (b: boolean) => void }) {
  const [draft, setDraft] = useState('')
  const [minutes, setMinutes] = useState('')
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null)
    onBusy(true)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      onBusy(false)
    }
  }

  const items = (group?.items ?? []).filter((i) => !i.dropped)

  return (
    <div className="flex flex-col gap-4 pt-3 pl-[42px]">
      {error ? <Alert>{error}</Alert> : null}
      <div className="flex flex-col gap-1.5">
        <span className="t-stamp text-ink-4">Steps in this habit</span>
        {items.length === 0 ? <span className="t-caption italic font-serif !text-[13px]">No sub-steps yet — finishing every step also completes the habit.</span> : null}
        {items.map((item) => (
          <div key={item.id} className="flex items-center gap-2.5 group">
            <CheckBox small state={item.done ? 'done' : 'open'} label={item.done ? 'Mark step open' : 'Mark step done'} onClick={() => void run(() => window.api.todo.setDone(item.id, !item.done))} />
            <span className={`text-[13.5px] flex-1 ${item.done ? 'line-through text-ink-4' : ''}`}>{item.title}</span>
            <button className="opacity-0 group-hover:opacity-100 text-ink-4 hover:text-[var(--error)]" title="Remove step" aria-label="Remove step" onClick={() => void run(() => window.api.todo.remove(item.id))}>
              <X size={13} />
            </button>
          </div>
        ))}
        <form
          className="flex items-center gap-2 mt-1"
          onSubmit={(e) => {
            e.preventDefault()
            const title = draft.trim()
            if (!title) return
            setDraft('')
            void run(() => window.api.todo.addSubtask(card.occurrenceId, title))
          }}
        >
          <Plus size={14} className="text-ink-4" />
          <input className="kh-input !text-[13.5px] !py-1" placeholder="Add a step to this habit…" value={draft} onChange={(e) => setDraft(e.target.value)} />
        </form>
      </div>
      <div className="flex flex-wrap items-end gap-3">
        <form
          className="flex items-end gap-2"
          onSubmit={(e) => {
            e.preventDefault()
            const n = Number(minutes)
            if (!Number.isFinite(n) || n <= 0) return
            setMinutes('')
            void run(() => window.api.timer.addManual(card.occurrenceId, Math.round(n)))
          }}
        >
          <label className="kh-field !gap-1">
            <span className="kh-field-label !text-[10.5px]">Log minutes by hand</span>
            <input className="kh-input !w-28 !text-[13.5px] !py-1" type="number" min={1} placeholder="e.g. 25" value={minutes} onChange={(e) => setMinutes(e.target.value)} />
          </label>
          <Btn size="sm" kind="ruled" type="submit" disabled={!minutes}>
            Log
          </Btn>
        </form>
        {card.status === 'skipped' ? (
          <Btn size="sm" kind="soft" onClick={() => void run(() => window.api.occurrence.setSkip(card.occurrenceId, false, null))}>
            Take up this step again
          </Btn>
        ) : card.status !== 'complete' ? (
          <Btn size="sm" kind="soft" title="A justified rest carries no penalty" onClick={() => void run(() => window.api.occurrence.setSkip(card.occurrenceId, true, 'Rest day'))}>
            Rest today, without penalty
          </Btn>
        ) : null}
      </div>
    </div>
  )
}

function StepRow({
  card,
  goalTitle,
  group,
  now,
  onToggle,
  onTimer,
  busy
}: {
  card: DashboardCard
  goalTitle: string | undefined
  group: TodoGroup | undefined
  now: number
  onToggle: () => void
  onTimer: () => void
  busy: boolean
}) {
  const [open, setOpen] = useState(false)
  const [toolsBusy, setToolsBusy] = useState(false)
  const done = card.status === 'complete'
  const stamp = originStamp(card)
  const steps = group ? `${group.done}/${group.total} steps` : null

  return (
    <div className={`kh-row !block ${done ? 'is-done' : ''} ${card.timerRunning ? 'is-live' : ''}`}>
      <div className="flex items-center gap-4">
        <CheckBox state={checkState(card)} disabled={busy || toolsBusy} onClick={onToggle} label={done ? `Reopen ${card.name}` : `Mark ${card.name} complete`} />
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <div className="flex items-center gap-2.5 flex-wrap">
            <span className={`text-[15px] font-semibold leading-6 ${card.status === 'skipped' ? 'text-ink-4' : ''}`}>{card.name}</span>
            {stamp ? <Stamp tone={stamp.tone} className="!text-[10.5px] !py-0.5">{stamp.text}</Stamp> : null}
          </div>
          <div className="kh-meta">
            <span className="inline-flex items-center gap-1.5">
              <Clock size={13} /> {time12(card.scheduledTime)}
            </span>
            <span>
              {duration(card.timerRunning ? card.closedMinutes + elapsedSeconds(card, now) / 60 : card.loggedMinutes)} of {duration(card.targetMinutes)}
            </span>
            {card.streak > 0 ? <span className="text-[var(--ochre-deep)]">Streak: {card.streak} {card.streak === 1 ? 'day' : 'days'}</span> : null}
            {goalTitle ? <span className="inline-flex items-center gap-1 text-laurel"><Mountain size={12} /> {goalTitle}</span> : null}
            {steps ? <span>{steps}</span> : null}
          </div>
        </div>
        {card.timerRunning ? (
          <span className="font-serif text-[20px] t-num text-[var(--ochre-deep)]">{clockFace(elapsedSeconds(card, now))}</span>
        ) : null}
        {!done && card.status !== 'skipped' ? (
          <Btn size="sm" kind={card.timerRunning ? 'ochre' : 'soft'} disabled={busy} onClick={onTimer}>
            {card.timerRunning ? <Pause size={13} /> : <Play size={13} />}
            {card.timerRunning ? 'Pause' : 'Start'}
          </Btn>
        ) : null}
        <button className="kh-icon-btn" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Steps, minutes and rest" aria-label={`More for ${card.name}`}>
          <ChevronDown size={16} className={`transition-transform ${open ? 'rotate-180' : ''}`} />
        </button>
      </div>
      {open ? <StepTools card={card} group={group} onBusy={setToolsBusy} /> : null}
    </div>
  )
}

function MarginNotes({ todos }: { todos: TodoView }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const manual = todos.items.filter((i) => i.kind === 'manual' && !i.dropped)

  const run = (fn: () => Promise<unknown>): void => {
    setError(null)
    fn().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  return (
    <div className="flex flex-col gap-1">
      {error ? <Alert>{error}</Alert> : null}
      {todos.avoidance.map((a) => (
        <div key={a.todoId} className="kh-alert is-ochre !text-[13px] mb-2">
          <Flame size={15} className="shrink-0 mt-0.5" />
          <span className="[text-wrap:pretty]">{a.message}</span>
        </div>
      ))}
      <div className="kh-ruled-list">
        {manual.map((item) => (
          <div key={item.id} className="flex items-start gap-3 group">
            <CheckBox small state={item.done ? 'done' : 'open'} label={item.done ? 'Reopen note' : 'Mark note done'} onClick={() => run(() => window.api.todo.setDone(item.id, !item.done))} />
            <div className="flex flex-col flex-1 min-w-0 -mt-0.5">
              <span className={`font-serif text-[16px] leading-6 [text-wrap:pretty] ${item.done ? 'line-through text-ink-4' : ''}`}>{item.title}</span>
              {item.carried > 0 && !item.done ? <span className="t-caption text-[var(--ochre-deep)]">Carried forward {item.carried} {item.carried === 1 ? 'day' : 'days'}</span> : null}
            </div>
            <button className="opacity-0 group-hover:opacity-100 text-ink-4 hover:text-[var(--error)] mt-1" title="Set aside" aria-label="Set aside" onClick={() => run(() => window.api.todo.drop(item.id))}>
              <Trash2 size={13} />
            </button>
          </div>
        ))}
      </div>
      <form
        className="flex items-center gap-2 mt-2"
        onSubmit={(e) => {
          e.preventDefault()
          const title = draft.trim()
          if (!title) return
          setDraft('')
          run(() => window.api.todo.addManual(title, todos.date))
        }}
      >
        <span className="text-ink-4 font-serif">—</span>
        <input className="kh-input !font-serif !text-[16px] !py-1.5" placeholder="Add a to-do for today…" value={draft} onChange={(e) => setDraft(e.target.value)} />
      </form>
      {manual.length === 0 && todos.suggestions.length > 0 ? (
        <div className="mt-3 flex flex-col gap-1.5">
          <span className="t-stamp text-ink-4">Perhaps</span>
          {todos.suggestions.slice(0, 3).map((s) => (
            <button key={s.title} className="text-left group" onClick={() => run(() => window.api.todo.addManual(s.title, todos.date))} title={s.reason}>
              <span className="font-serif italic text-[14.5px] text-ink-3 group-hover:text-ink">+ {s.title}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export default function Today() {
  const { navigate, settings, openSession } = useShell()
  const [checkIn, setCheckIn] = useState<LetGoView | null>(null)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const dash = useData(() => window.api.view.dashboard(), [])
  const rest = useData<Everything>(async () => {
    const [todos, habits, goals, perf, review, letGos] = await Promise.all([
      window.api.view.todos(),
      window.api.habits.list(),
      window.api.goals.list(),
      window.api.view.performance(),
      window.api.view.weeklyReview(),
      window.api.letGo.list()
    ])
    const scheduled = perf.days.reduce((s, d) => s + (d.inPeriod ? d.scheduled : 0), 0)
    const completed = perf.days.reduce((s, d) => s + (d.inPeriod ? d.completed : 0), 0)
    return {
      todos,
      habits,
      goals,
      consistency: scheduled > 0 ? completed / scheduled : null,
      weekBars: perf.days.map((d) => ({
        label: new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' }),
        value: d.scheduled > 0 ? d.completed / d.scheduled : 0,
        isToday: d.date === today()
      })),
      streak: review?.streak ?? 0,
      letGos
    }
  }, [])

  const cards = dash.data?.cards ?? []
  const anyRunning = cards.some((c) => c.timerRunning)
  useTick(anyRunning ? 1000 : 30_000)
  const now = Date.now()
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes()

  const next = cards.find((c) => c.timerRunning) ?? cards.find((c) => c.status === 'pending' || c.status === 'partial') ?? null
  const done = cards.filter((c) => c.status === 'complete').length
  const habitsById = useMemo(() => new Map((rest.data?.habits ?? []).map((h) => [h.id, h])), [rest.data?.habits])
  const goalsById = useMemo(() => new Map((rest.data?.goals ?? []).map((g) => [g.id, g])), [rest.data?.goals])
  const groupsByOcc = useMemo(
    () => new Map((rest.data?.todos.groups ?? []).filter((g) => g.occurrenceId !== null).map((g) => [g.occurrenceId as number, g])),
    [rest.data?.todos.groups]
  )
  const nextGoal = next ? goalsById.get(habitsById.get(next.habitId)?.goalId ?? -1) : undefined
  const nextHabit = next ? habitsById.get(next.habitId) : undefined

  const act = async (card: DashboardCard, fn: () => Promise<unknown>): Promise<void> => {
    setBusyId(card.occurrenceId)
    setActionError(null)
    try {
      await fn()
    } catch (err) {
      setActionError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusyId(null)
    }
  }
  const toggleTimer = (card: DashboardCard): Promise<void> =>
    act(card, () => (card.timerRunning ? window.api.timer.stop(card.occurrenceId) : window.api.timer.start(card.occurrenceId)))
  const toggleDone = (card: DashboardCard): Promise<void> =>
    act(card, () => window.api.occurrence.setCompleted(card.occurrenceId, card.status !== 'complete'))

  // Space starts or pauses the next step, as the design's key hint promises.
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.code !== 'Space' || !next || busyId !== null) return
      const t = e.target as HTMLElement | null
      if (t && (t.closest('input, textarea, select, button, [contenteditable]') || document.querySelector('.kh-overlay'))) return
      e.preventDefault()
      void toggleTimer(next)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  if (dash.error) return <Page><LoadError message={dash.error} onRetry={dash.refetch} /></Page>
  if (!dash.data) return <Page><Loading label="Loading today…" /></Page>

  const d = dash.data
  const name = firstName(settings?.displayName ?? '')
  const dayOfYear = Math.floor((new Date(`${d.date}T12:00:00`).getTime() - new Date(`${d.date.slice(0, 4)}-01-01T12:00:00`).getTime()) / 86_400_000) + 1
  const isFriday = new Date(`${d.date}T12:00:00`).getDay() === 5
  const daysToReview = (5 - new Date(`${d.date}T12:00:00`).getDay() + 7) % 7

  return (
    <Page>
      <header className="flex flex-wrap items-end justify-between gap-6 mb-9">
        <div className="flex flex-col gap-3">
          <h1 className="t-hero m-0">
            {greeting()}
            {name ? `, ${name}` : ''}.
          </h1>
          <span className="font-serif text-[19px] text-ink-3">{longDate(d.date)}</span>
        </div>
        <div className="kh-sheet flex items-center gap-4 px-5 py-4">
          <Ring value={cards.length ? done / cards.length : 0} size={48}>
            <span className="font-serif text-[13px] t-num">
              {done}/{cards.length}
            </span>
          </Ring>
          <div className="flex flex-col">
            <span className="text-[15px] font-semibold">
              {done} of {cards.length} steps completed
            </span>
            <span className="text-[12.5px] text-[var(--ochre-deep)] inline-flex items-center gap-1.5">
              <Flame size={13} />
              {(rest.data?.streak ?? 0) > 0 ? `${rest.data?.streak}-day streak` : `${d.dayPoints} of ${d.dayPointsMax} points today`}
            </span>
          </div>
        </div>
      </header>

      {actionError ? <div className="mb-5"><Alert>{actionError}</Alert></div> : null}

      {next ? (
        <section className="kh-card kh-tape is-ochre relative overflow-hidden px-8 py-7 mb-11">
          <svg className="absolute -right-10 -top-16 opacity-60 pointer-events-none" width="300" height="300" viewBox="0 0 300 300" aria-hidden="true">
            <circle cx="150" cy="150" r="118" fill="none" stroke="var(--rule)" />
            <circle cx="150" cy="150" r="146" fill="none" stroke="var(--rule)" strokeDasharray="3 5" />
          </svg>
          <div className="relative flex flex-wrap items-center justify-between gap-8">
            <div className="flex flex-col gap-3 min-w-0 flex-1 basis-[420px]">
              <div className="flex items-center gap-3 flex-wrap">
                <Stamp tone="ochre-solid">Your next step</Stamp>
                <span className="inline-flex items-center gap-2 text-[13px] text-ink-3">
                  <Dot /> {windowLabel(next, nowMinutes)}
                </span>
              </div>
              <h2 className="t-h1 !text-[34px] !leading-[42px] m-0">{next.name}</h2>
              <div className="kh-meta !text-[14.5px]">
                <span className="inline-flex items-center gap-1.5">
                  <Clock size={15} /> {time12(next.scheduledTime)}
                </span>
                <span>{duration(next.targetMinutes)} dedicated session</span>
                {next.loggedMinutes > 0 ? <span>{duration(next.loggedMinutes)} logged</span> : null}
              </div>
              {nextGoal ? (
                <button className="self-start kh-chip !border-[var(--laurel)] !text-laurel hover:!bg-[var(--laurel-wash)]" onClick={() => navigate({ name: 'mountain', id: nextGoal.id })}>
                  <Mountain size={14} /> Moves you toward: <b className="font-semibold">{nextGoal.title}</b>
                </button>
              ) : null}
              {nextHabit?.notes || nextHabit?.description ? (
                <p className="font-serif text-[17px] leading-[27px] text-ink-2 m-0 max-w-[620px] [text-wrap:pretty]">“{nextHabit.notes ?? nextHabit.description}”</p>
              ) : null}
            </div>
            <div className="flex flex-col items-stretch gap-3 min-w-[230px]">
              {next.timerRunning ? (
                <span className="text-center font-serif text-[40px] leading-none t-num text-[var(--ochre-deep)]">{clockFace(elapsedSeconds(next, now))}</span>
              ) : null}
              <Btn
                kind="ochre"
                size="lg"
                disabled={busyId === next.occurrenceId}
                onClick={() => (next.timerRunning ? openSession(next.occurrenceId) : void toggleTimer(next).then(() => openSession(next.occurrenceId)))}
              >
                <Play size={16} fill="currentColor" />
                <span className="tracking-[0.06em]">{next.timerRunning ? 'OPEN SESSION' : 'START SESSION'}</span>
                {next.timerRunning ? null : <kbd>Space</kbd>}
              </Btn>
              {next.timerRunning ? (
                <Btn kind="soft" disabled={busyId === next.occurrenceId} onClick={() => void toggleTimer(next)}>
                  <Pause size={14} /> Pause the clock
                </Btn>
              ) : null}
              <Btn kind="soft" disabled={busyId === next.occurrenceId} onClick={() => void toggleDone(next)}>
                Mark step complete
              </Btn>
            </div>
          </div>
        </section>
      ) : cards.length > 0 ? (
        <section className="kh-card px-8 py-7 mb-11 flex flex-wrap items-center justify-between gap-6">
          <div className="flex flex-col gap-2">
            <Stamp tone="laurel">All done for today</Stamp>
            <h2 className="t-h1 m-0">The day’s trail is walked.</h2>
            <p className="t-italic m-0">You earned {d.dayPoints} points today. Rest is part of the climb.</p>
          </div>
          <Btn kind="ruled" onClick={() => navigate({ name: 'review' })}>
            <BookOpen size={15} /> Open the weekly review
          </Btn>
        </section>
      ) : null}

      <div className="grid gap-10 min-[1100px]:grid-cols-[minmax(0,1.45fr)_minmax(300px,1fr)]">
        <section className="min-w-0">
          <SectionHead
            title="Today’s habits"
            meta={`${done} of ${cards.length} completed`}
            action={
              <Btn kind="ghost" onClick={() => navigate({ name: 'habits', edit: 'new' })}>
                <Plus size={14} /> New habit
              </Btn>
            }
          />
          {cards.length === 0 ? (
            <div className="kh-empty">
              <span className="t-h2 text-ink">No steps are scheduled for today.</span>
              <span className="max-w-[420px]">Add a habit, or choose a mountain and let the planner suggest your habits.</span>
              <div className="flex gap-3 mt-2">
                <Btn kind="laurel" onClick={() => navigate({ name: 'habits', edit: 'new' })}>
                  Add a habit
                </Btn>
                <Btn kind="ruled" onClick={() => navigate({ name: 'expedition' })}>
                  Choose a mountain
                </Btn>
              </div>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {cards.map((card) => (
                <StepRow
                  key={card.occurrenceId}
                  card={card}
                  goalTitle={goalsById.get(habitsById.get(card.habitId)?.goalId ?? -1)?.title}
                  group={groupsByOcc.get(card.occurrenceId)}
                  now={now}
                  busy={busyId === card.occurrenceId}
                  onToggle={() => void toggleDone(card)}
                  onTimer={() => void toggleTimer(card)}
                />
              ))}
            </div>
          )}

          {rest.data ? (
            <div className="kh-card flex items-center gap-4 px-5 py-4 mt-5">
              <span className="w-10 h-10 rounded-lg bg-[var(--laurel-wash)] text-laurel grid place-items-center shrink-0">
                <Flame size={18} />
              </span>
              <div className="flex flex-col flex-1 min-w-0">
                <span className="text-[14px] font-semibold">This week so far</span>
                <span className="t-caption">
                  {rest.data.consistency === null ? 'Nothing scheduled yet this week' : `${Math.round(rest.data.consistency * 100)}% of this week’s scheduled steps completed`}
                </span>
              </div>
              <div className="flex items-end gap-1.5 h-9" aria-label="Completion by day this week">
                {rest.data.weekBars.map((b, i) => (
                  <span key={i} className="flex flex-col items-center gap-1" title={`${Math.round(b.value * 100)}%`}>
                    <span
                      className="w-[9px] rounded-[2px]"
                      style={{
                        height: `${Math.max(3, b.value * 28)}px`,
                        background: b.isToday ? 'var(--ochre)' : b.value > 0 ? 'var(--laurel-deep)' : 'var(--rule)'
                      }}
                    />
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </section>

        <aside className="min-w-0 flex flex-col gap-6">
          <div className="flex items-start justify-between gap-4">
            <h2 className="t-h2 m-0 [text-wrap:balance]">Notes &amp; to-dos</h2>
            <span className="t-stamp text-ink-4 text-right shrink-0">
              Day
              <br />
              {dayOfYear}
            </span>
          </div>

          <div className="kh-card kh-tape px-6 pt-7 pb-6">
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <span className="t-stamp text-[var(--ochre-deep)]">Today’s to-dos</span>
              <span className="t-caption">{rest.data ? `${rest.data.todos.manualTotal} notes` : ''}</span>
            </div>
            {rest.error ? <Alert>{rest.error}</Alert> : rest.data ? <MarginNotes todos={rest.data.todos} /> : <Loading label="Loading…" />}
          </div>

          <div className="kh-sheet overflow-hidden flex items-center gap-4 p-4">
            <img src={emblem} alt="" className="w-[88px] h-[88px] rounded-full object-cover mix-blend-multiply shrink-0 dark:mix-blend-normal" />
            <div className="flex flex-col gap-1 min-w-0">
              <span className="t-stamp text-ink-4">Today’s points</span>
              <span className="font-serif text-[30px] leading-9 t-num">
                {d.dayPoints}
                <span className="text-[16px] text-ink-4"> / {d.dayPointsMax} points</span>
              </span>
              <span className="t-caption">
                Level {d.level.level} · {d.level.title} — {d.level.xpToNext} XP to the next level
              </span>
            </div>
          </div>

          {rest.data && rest.data.letGos.some((l) => l.status === 'carrying') ? (
            <div className="kh-sheet p-5 flex flex-col gap-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className="text-[14px] font-semibold">The evening inventory</span>
                <button className="t-caption hover:underline" onClick={() => navigate({ name: 'letgo' })}>
                  Open the backpack →
                </button>
              </div>
              {rest.data.letGos
                .filter((l) => l.status === 'carrying')
                .map((l) => (
                  <div key={l.id} className="flex items-center gap-3">
                    <span className="flex-1 min-w-0 flex flex-col">
                      <span className="text-[14px] truncate">{l.title}</span>
                      <span className="t-caption">{l.today ? (l.today.resisted ? 'Left behind today' : 'Returned today — noted') : `${l.stats.currentStreak}-day stillness · not recorded yet`}</span>
                    </span>
                    <Btn size="sm" kind={l.today ? 'soft' : 'laurel'} onClick={() => setCheckIn(l)}>
                      {l.today ? 'Change' : 'Record'}
                    </Btn>
                  </div>
                ))}
            </div>
          ) : null}

          <button className="kh-sheet text-left flex gap-4 p-5 hover:border-[var(--rule)]" onClick={() => navigate({ name: 'review' })}>
            <span className="w-10 h-10 rounded-full bg-[var(--ochre-wash)] text-[var(--ochre-deep)] grid place-items-center shrink-0">
              <Sunset size={18} />
            </span>
            <span className="flex flex-col gap-1">
              <span className="flex items-center gap-2">
                <span className="text-[14px] font-semibold">Weekly review</span>
                <Stamp tone={isFriday ? 'laurel' : 'plain'} className="!text-[10px] !py-0">
                  {isFriday ? 'Ready' : 'Locked'}
                </Stamp>
              </span>
              <span className="text-[13.5px] leading-[21px] text-ink-3 [text-wrap:pretty]">
                {isFriday
                  ? 'The week ends tonight. Look back on it and plan next week.'
                  : `The weekly review opens on Friday — ${daysToReview} ${daysToReview === 1 ? 'day' : 'days'} from now. Your week runs Saturday to Friday.`}
              </span>
            </span>
          </button>

          <div className="kh-docket flex items-center gap-3 px-5 py-4">
            <BookOpen size={17} className="text-ink-3" />
            <span className="flex flex-col flex-1 min-w-0">
              <span className="text-[14px]">Your data</span>
              <span className="t-caption">Saved on this computer, and works offline</span>
            </span>
            <span className="t-stamp !text-[10.5px] text-ink-4">Local</span>
          </div>
        </aside>
      </div>

      {cards.some((c) => c.status === 'skipped') ? (
        <p className="t-caption mt-6 flex items-center gap-2">
          <Ellipsis size={14} /> Rested steps carry no penalty and keep your streak honest.
        </p>
      ) : null}
      {checkIn ? <CheckInModal item={checkIn} date={today()} onClose={() => setCheckIn(null)} /> : null}
    </Page>
  )
}
