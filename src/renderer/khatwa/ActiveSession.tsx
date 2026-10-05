import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, Minimize2, Mountain, Pause, Play } from 'lucide-react'
import type { DashboardCard, GoalView, Habit, TodoGroup } from '@shared/types'
import { useData, useTick } from '../hooks/useData'
import { duration } from '../lib/format'
import { time12 } from '../lib/khatwa'
import { Alert, Btn, CheckBox, Ring } from './ui'

function clock(total: number): string {
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`
}

/** The one screen with nothing else on it: the step, the time, and the way back. */
export default function ActiveSession({ occurrenceId, onClose, onNavigateMountain }: { occurrenceId: number; onClose: () => void; onNavigateMountain: (id: number) => void }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { data } = useData<{ card: DashboardCard | null; habit: Habit | null; goal: GoalView | null; steps: TodoGroup | null }>(async () => {
    const [dash, habits, goals, todos] = await Promise.all([window.api.view.dashboard(), window.api.habits.list(), window.api.goals.list(), window.api.view.todos()])
    const card = dash.cards.find((c) => c.occurrenceId === occurrenceId) ?? null
    const habit = card ? (habits.find((h) => h.id === card.habitId) ?? null) : null
    return {
      card,
      habit,
      goal: habit?.goalId ? (goals.find((g) => g.id === habit.goalId) ?? null) : null,
      steps: todos.groups.find((g) => g.occurrenceId === occurrenceId) ?? null
    }
  }, [occurrenceId])
  useTick(1000)

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const card = data?.card
  const run = async (fn: () => Promise<unknown>, close = false): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      if (close) onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const seconds = card ? card.closedMinutes * 60 + (card.timerRunning && card.timerStartedAt ? Math.max(0, Math.floor((Date.now() - new Date(card.timerStartedAt).getTime()) / 1000)) : 0) : 0

  return createPortal(
    <div className="fixed inset-0 z-[60] bg-[var(--canvas)] flex flex-col kh-rise" role="dialog" aria-modal="true" aria-label="Active session">
      <div className="flex items-center justify-between px-10 py-6">
        <span className="t-stamp text-ink-3">Active session {card?.timerRunning ? '· the clock is running' : '· paused'}</span>
        <Btn kind="soft" size="sm" onClick={onClose}>
          <Minimize2 size={14} /> Back to the app
        </Btn>
      </div>
      <div className="flex-1 flex flex-col items-center justify-center gap-8 px-8 text-center">
        {!data ? (
          <span className="t-italic">Gathering the step…</span>
        ) : !card ? (
          <div className="flex flex-col items-center gap-4">
            <span className="t-h2">This step isn’t on today’s trail any more.</span>
            <Btn kind="ruled" onClick={onClose}>
              Back
            </Btn>
          </div>
        ) : (
          <>
            <span className="t-stamp text-[var(--ochre-deep)] !text-[14px]">{card.name}</span>
            <Ring value={card.targetMinutes ? seconds / 60 / card.targetMinutes : 0} size={300} stroke={5} tone={card.timerRunning ? 'ochre' : 'laurel'}>
              <span className="flex flex-col items-center gap-2">
                <span className="font-serif text-[58px] leading-none t-num tracking-tight">{clock(seconds)}</span>
                <span className="t-caption !text-[13px]">of {duration(card.targetMinutes)} · since {time12(card.scheduledTime)}</span>
              </span>
            </Ring>
            {error ? <Alert>{error}</Alert> : null}
            <div className="flex gap-3">
              <Btn kind={card.timerRunning ? 'ruled' : 'laurel'} size="lg" disabled={busy} onClick={() => void run(() => (card.timerRunning ? window.api.timer.stop(card.occurrenceId) : window.api.timer.start(card.occurrenceId)))}>
                {card.timerRunning ? <Pause size={17} /> : <Play size={17} />} {card.timerRunning ? 'Pause' : 'Resume'}
              </Btn>
              <Btn
                kind="ochre"
                size="lg"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    if (card.timerRunning) await window.api.timer.stop(card.occurrenceId)
                    await window.api.occurrence.setCompleted(card.occurrenceId, true)
                  }, true)
                }
              >
                <Check size={17} /> Complete
              </Btn>
            </div>
            {data.goal ? (
              <button className="kh-chip !border-[var(--laurel)] !text-laurel !py-2" onClick={() => onNavigateMountain(data.goal!.id)}>
                <Mountain size={14} /> Moves you toward: <b>{data.goal.title}</b>
              </button>
            ) : null}
            {data.steps && data.steps.items.length ? (
              <div className="flex flex-col gap-2 items-start text-left kh-sheet p-5 min-w-[320px]">
                <span className="t-stamp !text-[10.5px] text-ink-3">Steps within this session</span>
                {data.steps.items
                  .filter((i) => !i.dropped)
                  .map((i) => (
                    <span key={i.id} className="flex items-center gap-3">
                      <CheckBox small state={i.done ? 'done' : 'open'} label={i.done ? 'Mark open' : 'Mark done'} onClick={() => void run(() => window.api.todo.setDone(i.id, !i.done))} />
                      <span className={`text-[15px] ${i.done ? 'line-through text-ink-4' : ''}`}>{i.title}</span>
                    </span>
                  ))}
              </div>
            ) : null}
            {data.habit?.notes ? <p className="m-0 max-w-[560px] font-serif italic text-[18px] leading-[28px] text-ink-3">“{data.habit.notes}”</p> : null}
          </>
        )}
      </div>
    </div>,
    document.body
  )
}
