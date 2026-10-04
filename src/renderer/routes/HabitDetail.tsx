import { useState } from 'react'
import { ArrowLeft, Flame, Mountain, Pause, Pencil, Play, Timer } from 'lucide-react'
import type { GoalView, HabitDetailView, OccurrenceStatus, TimeLogOrigin } from '@shared/types'
import { useData } from '../hooks/useData'
import { describeRecurrence, duration } from '../lib/format'
import { dayMonth, effectiveStatus, time12, weekdayShort } from '../lib/khatwa'
import HabitEditor from '../khatwa/HabitEditor'
import { useShell } from '../khatwa/nav'
import { Page } from '../khatwa/Page'
import { Alert, Btn, Eyebrow, LoadError, Loading, Stamp } from '../khatwa/ui'

const STATUS: Record<OccurrenceStatus, [string, string]> = {
  complete: ['Kept', 'var(--laurel-deep)'],
  partial: ['Partial', 'var(--ochre)'],
  missed: ['Missed', 'var(--ink-4)'],
  skipped: ['Rested', 'var(--slate)'],
  pending: ['Open', 'var(--rule)']
}
const ORIGIN: Record<TimeLogOrigin, string> = { timer: 'timer', manual: 'typed in', assumed: 'assumed' }

export default function HabitDetail({ id }: { id: number }) {
  const { navigate } = useShell()
  const [editing, setEditing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { data, error: loadError, refetch } = useData<{ d: HabitDetailView | null; goals: GoalView[] }>(async () => {
    const [d, goals] = await Promise.all([window.api.view.habitDetail(id), window.api.goals.list()])
    return { d, goals }
  }, [id])

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (loadError) return <Page><LoadError message={loadError} onRetry={refetch} /></Page>
  if (!data) return <Page><Loading label="Reading the rhythm’s record…" /></Page>
  const d = data.d
  if (!d) {
    return (
      <Page>
        <div className="kh-empty">
          <span className="t-h2 text-ink">This habit is no longer in the folio.</span>
          <Btn kind="ruled" onClick={() => navigate({ name: 'habits' })}>
            Back to habits
          </Btn>
        </div>
      </Page>
    )
  }

  const h = d.habit
  const goal = data.goals.find((g) => g.id === h.goalId)
  const maxWeek = Math.max(1, ...d.weeks.map((w) => w.scheduled))
  const kept = d.weeks.reduce((s, w) => s + w.completed, 0)
  const planned = d.weeks.reduce((s, w) => s + w.scheduled, 0)

  return (
    <Page>
      <button className="flex items-center gap-2 text-[15px] text-[var(--ochre-deep)] mb-5 hover:underline" onClick={() => navigate({ name: 'habits' })}>
        <ArrowLeft size={16} /> Back to habits &amp; rhythms
      </button>

      <header className="flex flex-wrap items-end justify-between gap-6 mb-9">
        <div className="flex flex-col gap-3 min-w-0">
          <Eyebrow>
            Rhythm record <span className="is-quiet">/ {h.active ? 'active' : 'paused — history kept'}</span>
          </Eyebrow>
          <h1 className="t-hero !text-[44px] !leading-[52px] m-0">{h.name}</h1>
          <span className="font-serif italic text-[16px] text-ink-3">
            {describeRecurrence(h.recurrence)} · {time12(h.scheduledTime)} · target {duration(h.targetMinutes)} · baseline {duration(h.baselineMinutes)} · tier {h.difficultyLevel}
          </span>
          {goal ? (
            <button className="kh-chip self-start !border-[var(--laurel)] !text-laurel" onClick={() => navigate({ name: 'mountain', id: goal.id })}>
              <Mountain size={13} /> Moves you toward: <b>{goal.title}</b>
            </button>
          ) : null}
        </div>
        <div className="flex gap-2">
          <Btn kind="soft" onClick={() => void run(() => window.api.habits.setActive(h.id, !h.active))}>
            {h.active ? <Pause size={14} /> : <Play size={14} />} {h.active ? 'Pause' : 'Resume'}
          </Btn>
          <Btn kind="laurel" onClick={() => setEditing(true)}>
            <Pencil size={14} /> Edit rhythm
          </Btn>
        </div>
      </header>

      {error ? <div className="mb-6"><Alert>{error}</Alert></div> : null}

      {d.proposal ? (
        <section className="kh-card kh-tape is-ochre p-6 mb-8 flex flex-wrap items-center gap-6">
          <div className="flex flex-col gap-2 flex-1 min-w-[300px]">
            <Stamp tone="ochre-solid" className="self-start">Adaptive suggestion</Stamp>
            <p className="m-0 font-serif text-[19px] leading-[28px]">
              You kept this rhythm on {Math.round(d.proposal.completionRate)}% of its days. Consider {d.proposal.proposedTarget > d.proposal.currentTarget ? 'increasing' : 'easing'} {duration(d.proposal.currentTarget)} → {duration(d.proposal.proposedTarget)}.
            </p>
            <span className="t-caption">{d.proposal.rationale} Nothing changes unless you accept.</span>
          </div>
          <div className="flex gap-2">
            <Btn kind="soft" onClick={() => void run(() => window.api.proposal.reject(d.proposal!.id))}>
              Dismiss
            </Btn>
            <Btn kind="ochre" onClick={() => void run(() => window.api.proposal.accept(d.proposal!.id))}>
              Accept
            </Btn>
          </div>
        </section>
      ) : null}

      <div className="grid gap-4 mb-8 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <div className="kh-sheet p-5 flex flex-col gap-1">
          <span className="t-stamp !text-[10.5px] text-ink-4 flex items-center gap-1.5">
            <Flame size={13} /> Current streak
          </span>
          <span className="font-serif text-[32px] leading-10">{d.streak.current}</span>
          <span className="t-caption">longest {d.streak.longest}</span>
        </div>
        <div className="kh-sheet p-5 flex flex-col gap-1">
          <span className="t-stamp !text-[10.5px] text-ink-4 flex items-center gap-1.5">
            <Timer size={13} /> Time invested · 12 weeks
          </span>
          <span className="font-serif text-[32px] leading-10">{duration(d.totalMinutes)}</span>
          <span className="t-caption">{d.assumedMinutes ? `${duration(d.assumedMinutes)} of it assumed (ticked in Google, no timer)` : 'all measured or typed in'}</span>
        </div>
        <div className="kh-sheet p-5 flex flex-col gap-1">
          <span className="t-stamp !text-[10.5px] text-ink-4">Kept</span>
          <span className="font-serif text-[32px] leading-10">
            {kept}
            <span className="text-[16px] text-ink-4"> / {planned}</span>
          </span>
          <span className="t-caption">{planned ? `${Math.round((kept / planned) * 100)}% of scheduled days` : 'nothing scheduled yet'}</span>
        </div>
      </div>

      <div className="grid gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <section className="kh-card p-6">
          <span className="t-stamp !text-[10.5px] text-ink-3">Weekly trend · Saturday to Friday</span>
          <div className="flex items-end gap-2 h-[150px] mt-5">
            {d.weeks.map((w) => (
              <div key={w.weekStart} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end" title={`Week of ${dayMonth(w.weekStart)}: ${w.completed}/${w.scheduled} kept, ${duration(w.minutes)}`}>
                <div className="w-full flex flex-col justify-end rounded-[3px] bg-[var(--docket)]" style={{ height: `${(w.scheduled / maxWeek) * 110}px` }}>
                  <div className="w-full rounded-[3px] bg-[var(--laurel-deep)]" style={{ height: `${w.scheduled ? (w.completed / w.scheduled) * 100 : 0}%` }} />
                </div>
                <span className="text-[9.5px] text-ink-4 t-num">{w.weekStart.slice(5).replace('-', '/')}</span>
              </div>
            ))}
          </div>
          <span className="t-caption block mt-3">Pale: scheduled · ink: kept</span>
        </section>

        <section className="kh-sheet p-6">
          <span className="t-stamp !text-[10.5px] text-ink-3">Recent sessions</span>
          <div className="flex flex-col mt-3 divide-y divide-[var(--rule)] max-h-[360px] overflow-y-auto">
            {d.history.length === 0 ? <span className="t-italic py-4">No sessions recorded yet.</span> : null}
            {d.history.slice(0, 30).map((day) => {
              const st = effectiveStatus(day)
              const [label, color] = STATUS[st]
              return (
                <div key={day.date} className="flex items-center gap-3 py-2.5">
                  <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: color }} />
                  <span className="w-24 text-[13.5px]">
                    {weekdayShort(day.date)} {dayMonth(day.date)}
                  </span>
                  <span className="flex-1 text-[13.5px]">{label}</span>
                  <span className="text-[13px] t-num">{day.minutes ? duration(day.minutes) : '—'}</span>
                  {day.origin ? (
                    <Stamp tone={day.origin === 'assumed' ? 'ochre' : 'plain'} className="!text-[9.5px] !py-0 w-20 justify-center">
                      {ORIGIN[day.origin]}
                    </Stamp>
                  ) : (
                    <span className="w-20" />
                  )}
                </div>
              )
            })}
          </div>
        </section>
      </div>

      {h.notes ? (
        <section className="kh-docket p-6 mt-6">
          <span className="t-stamp !text-[10.5px] text-ink-3">Margin notes</span>
          <p className="m-0 mt-2 font-serif text-[17px] leading-[27px] text-ink-2 whitespace-pre-wrap">{h.notes}</p>
        </section>
      ) : null}

      {editing ? <HabitEditor habit={h} goals={data.goals} onClose={() => setEditing(false)} /> : null}
    </Page>
  )
}
