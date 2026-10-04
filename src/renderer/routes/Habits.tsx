import { useMemo, useState } from 'react'
import { Clock, Flame, Mountain, Pencil, Play, Sprout, Target, Timer } from 'lucide-react'
import type { CalendarBlock, DashboardView, DifficultyProposal, GoalView, Habit } from '@shared/types'
import emblem from '../assets/emblem-large.png'
import { useData } from '../hooks/useData'
import { addDays, describeRecurrence, duration, saturdayOf } from '../lib/format'
import { dayMonth, isScheduledOn, plural, sessionsPerWeek, time12, today, weekDates, weekdayShort } from '../lib/khatwa'
import { DotMatrix } from '../khatwa/charts'
import HabitEditor from '../khatwa/HabitEditor'
import { useShell } from '../khatwa/nav'
import { Page } from '../khatwa/Page'
import { Alert, Bar, Btn, Dot, Eyebrow, IconBtn, LoadError, Loading, Ring, Stamp } from '../khatwa/ui'

type Data = {
  habits: Habit[]
  goals: GoalView[]
  proposals: DifficultyProposal[]
  dash: DashboardView
  blocks: CalendarBlock[]
  weeks: string[]
}

type Stats = { streak: number; consistency: number | null; weekDone: number; weekPlanned: number }

const WEEKS = 8

/** Weight of an occurrence toward consistency; pending and future days do not count yet. */
function weight(b: CalendarBlock, now: string): number | null {
  if (b.status === 'complete') return 1
  if (b.status === 'partial') return 0.5
  if (b.status === 'skipped') return null
  if (b.status === 'pending' && b.date >= now) return null
  return 0
}

function statsFor(habit: Habit, blocks: CalendarBlock[], dash: DashboardView, weekStart: string, now: string): Stats {
  const mine = blocks.filter((b) => b.habitId === habit.id).sort((a, b) => b.date.localeCompare(a.date))
  const card = dash.cards.find((c) => c.habitId === habit.id)
  let streak = 0
  if (card) streak = card.streak
  else {
    for (const b of mine) {
      if (b.date > now) continue
      if (b.status === 'complete') streak++
      else if (b.status === 'skipped' || (b.status === 'pending' && b.date === now)) continue
      else break
    }
  }
  const recent = mine.filter((b) => b.date >= addDays(now, -27))
  const weights = recent.map((b) => weight(b, now)).filter((w): w is number => w !== null)
  const week = mine.filter((b) => b.date >= weekStart)
  return {
    streak,
    consistency: weights.length ? weights.reduce((s, w) => s + w, 0) / weights.length : null,
    weekDone: week.filter((b) => b.status === 'complete').length,
    weekPlanned: Math.max(week.length, sessionsPerWeek(habit))
  }
}

function nextOccurrence(habit: Habit, now: string): string | null {
  for (let i = 1; i <= 30; i++) {
    const d = addDays(now, i)
    if (isScheduledOn(habit, d)) return d
  }
  return null
}

function HabitCard({
  habit,
  goal,
  stats,
  dash,
  onEdit
}: {
  habit: Habit
  goal: GoalView | undefined
  stats: Stats
  dash: DashboardView
  onEdit: () => void
}) {
  const { navigate } = useShell()
  const now = today()
  const card = dash.cards.find((c) => c.habitId === habit.id)
  const done = card?.status === 'complete'
  const next = card ? null : nextOccurrence(habit, now)
  const weekPct = stats.weekPlanned ? stats.weekDone / stats.weekPlanned : 0

  return (
    <article className="kh-card flex flex-col overflow-hidden">
      <div className="p-6 flex flex-col gap-4 flex-1">
        <div className="flex items-start justify-between gap-3">
          {goal ? (
            <button className="kh-stamp !normal-case !tracking-normal !font-sans !font-medium !text-[12px] hover:!bg-[var(--rule-soft)]" onClick={() => navigate({ name: 'mountain', id: goal.id })}>
              <Mountain size={13} /> Mountain: <b className="font-semibold">{goal.title}</b>
            </button>
          ) : (
            <Stamp className="!normal-case !tracking-normal !font-sans !font-medium !text-[12px]">
              <Sprout size={13} /> Unanchored (personal cultivation)
            </Stamp>
          )}
          <span className="flex items-center gap-1">
            <IconBtn title={`Edit ${habit.name}`} onClick={onEdit}>
              <Pencil size={14} />
            </IconBtn>
          </span>
        </div>
        <div className="flex flex-col gap-1">
          <button className="text-left hover:underline decoration-[var(--rule)] underline-offset-4" onClick={() => navigate({ name: 'habit', id: habit.id })} title="Open the rhythm’s record">
            <h3 className="font-serif text-[23px] leading-[30px] m-0 [text-wrap:balance]">{habit.name}</h3>
          </button>
          <span className="font-serif italic text-[13.5px] text-ink-3">
            {describeRecurrence(habit.recurrence)} · {time12(habit.scheduledTime)} · Target: {duration(habit.targetMinutes)}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="kh-docket px-4 py-3 flex items-center gap-3">
            <Flame size={19} className="text-[var(--ochre-deep)] shrink-0" />
            <span className="flex flex-col">
              <span className="t-stamp !text-[10px] text-ink-4">Current streak</span>
              <span className="text-[17px] font-semibold">{plural(stats.streak, 'day')}</span>
            </span>
          </div>
          <div className="kh-docket px-4 py-3 flex items-center gap-3">
            <Target size={19} className="text-laurel shrink-0" />
            <span className="flex flex-col">
              <span className="t-stamp !text-[10px] text-ink-4">Consistency</span>
              <span className="text-[17px] font-semibold">{stats.consistency === null ? '—' : `${Math.round(stats.consistency * 100)}%`}</span>
            </span>
          </div>
        </div>
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between t-caption !text-[12px]">
            <span>
              Weekly target ({stats.weekDone} / {plural(stats.weekPlanned, 'session')})
            </span>
            <span>{Math.round(weekPct * 100)}%</span>
          </div>
          <Bar value={weekPct} tone={weekPct >= 1 ? 'ochre' : 'laurel'} />
        </div>
      </div>
      <div className={`flex items-center justify-between gap-3 px-6 py-3 text-[13px] ${done ? 'bg-[var(--laurel-wash)]' : 'bg-[var(--sheet)]'}`}>
        {card ? (
          done ? (
            <>
              <span className="flex items-center gap-2 text-laurel">
                <Timer size={14} /> Completed today · {duration(card.loggedMinutes)}
              </span>
              <span className="t-stamp !text-[10.5px] text-laurel">Stamped &amp; inked ✓</span>
            </>
          ) : (
            <>
              <span className="flex items-center gap-2 text-ink-2">
                <Clock size={14} /> Scheduled for <b className="font-semibold">{time12(card.scheduledTime)}</b> today
              </span>
              <Btn kind="laurel" size="sm" onClick={() => navigate({ name: 'today' })}>
                <Play size={13} /> Go to today
              </Btn>
            </>
          )
        ) : (
          <span className="flex items-center gap-2 text-ink-3">
            <Clock size={14} /> {next ? `Next on ${weekdayShort(next)} ${dayMonth(next)}` : 'Nothing scheduled in the next month'}
          </span>
        )}
      </div>
    </article>
  )
}

export default function Habits({ edit }: { edit?: number | 'new' }) {
  const [editing, setEditing] = useState<number | 'new' | null>(edit ?? null)
  const [error, setError] = useState<string | null>(null)
  const { data, error: loadError, refetch } = useData<Data>(async () => {
    const now = today()
    const thisWeek = saturdayOf(now)
    const firstWeek = addDays(thisWeek, -(WEEKS - 1) * 7)
    const [habits, goals, proposals, dash, blocks] = await Promise.all([
      window.api.habits.list(),
      window.api.goals.list(),
      window.api.view.proposals(),
      window.api.view.dashboard(),
      window.api.view.calendarRange(firstWeek, addDays(thisWeek, 6))
    ])
    return { habits, goals, proposals, dash, blocks, weeks: Array.from({ length: WEEKS }, (_, i) => addDays(firstWeek, i * 7)) }
  }, [])

  const now = today()
  const weekStart = saturdayOf(now)
  const goalsById = useMemo(() => new Map((data?.goals ?? []).map((g) => [g.id, g])), [data?.goals])
  const stats = useMemo(() => {
    const m = new Map<number, Stats>()
    if (data) for (const h of data.habits) m.set(h.id, statsFor(h, data.blocks, data.dash, weekStart, now))
    return m
  }, [data, weekStart, now])

  if (loadError) return <Page><LoadError message={loadError} onRetry={refetch} /></Page>
  if (!data) return <Page><Loading label="Laying out the rhythms…" /></Page>

  const active = data.habits.filter((h) => h.active)
  const paused = data.habits.filter((h) => !h.active)
  const pending = data.proposals.filter((p) => p.state === 'pending')
  const allWeights = data.blocks.filter((b) => b.date >= addDays(now, -27)).map((b) => weight(b, now)).filter((w): w is number => w !== null)
  const overall = allWeights.length ? allWeights.reduce((s, w) => s + w, 0) / allWeights.length : null
  const matrix = data.weeks.map((ws, i) => {
    const days = new Set(weekDates(ws))
    const ws2 = data.blocks.filter((b) => days.has(b.date)).map((b) => weight(b, now)).filter((w): w is number => w !== null)
    return { label: dayMonth(ws), value: ws2.length ? ws2.reduce((s, w) => s + w, 0) / ws2.length : null, current: i === data.weeks.length - 1 }
  })
  const anchored = new Set(active.map((h) => h.goalId).filter((g): g is number => g !== null && goalsById.get(g)?.status === 'active'))

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Page>
      <header className="flex flex-wrap items-end justify-between gap-8 mb-9">
        <div className="flex flex-col gap-3 max-w-[600px]">
          <Eyebrow>
            Folio IV · Rhythms <Dot /> <span className="is-quiet">Ascension pace ledger</span>
          </Eyebrow>
          <h1 className="t-hero !text-[44px] !leading-[52px] m-0">Habits &amp; Daily Rhythms</h1>
          <p className="t-italic !text-[17px] m-0">The small deliberate steps that move the mountains.</p>
        </div>
        <div className="flex flex-col items-end gap-4">
          <div className="kh-sheet flex gap-8 px-6 py-4">
            <div className="flex flex-col">
              <span className="t-stamp !text-[10.5px] text-ink-4">Active rhythms</span>
              <span className="font-serif text-[26px] leading-8">
                {active.length} <span className="font-sans text-[12px] text-ink-4">disciplines</span>
              </span>
            </div>
            <div className="flex flex-col">
              <span className="t-stamp !text-[10.5px] text-ink-4">Overall consistency</span>
              <span className="font-serif text-[26px] leading-8 text-[var(--ochre-deep)]">
                {overall === null ? '—' : `${Math.round(overall * 100)}%`} <span className="font-sans text-[12px] text-ink-4">last 4 weeks</span>
              </span>
            </div>
          </div>
          <Btn kind="laurel" onClick={() => setEditing('new')}>
            <Sprout size={16} /> Plant new habit rhythm
          </Btn>
        </div>
      </header>

      {error ? <div className="mb-6"><Alert>{error}</Alert></div> : null}

      <section className="kh-sheet p-6 mb-8 flex flex-wrap items-center gap-7">
        <img src={emblem} alt="" className="w-[150px] h-[110px] rounded-lg object-cover mix-blend-multiply dark:mix-blend-normal" />
        <div className="flex flex-col gap-2 flex-1 min-w-[280px]">
          <span className="flex items-center gap-3">
            <Stamp tone="laurel">Rhythm cadence</Stamp>
            <span className="t-caption">Week of {dayMonth(weekStart)}</span>
          </span>
          <p className="m-0 text-[16px] leading-[26px] text-ink-2 [text-wrap:pretty]">
            Habits are not chains of obligation; they are trail markers laid in the morning mist. Every recorded stroke builds the terrace on which your future summit rests.
          </p>
        </div>
        <Ring value={overall ?? 0} size={92} stroke={5}>
          <span className="font-serif text-[22px] t-num">{overall === null ? '—' : `${Math.round(overall * 100)}%`}</span>
        </Ring>
      </section>

      {pending.map((p) => (
        <section key={p.id} className="kh-card kh-tape is-ochre p-7 mb-8 flex flex-wrap items-center gap-8">
          <div className="flex flex-col gap-3 flex-1 min-w-[320px]">
            <span className="flex items-center gap-3 flex-wrap">
              <Stamp tone="ochre-solid">{p.proposedTarget > p.currentTarget ? 'Adaptive recommendation · rise' : 'Adaptive recommendation · ease'}</Stamp>
              <span className="t-caption">Detected by the cadence engine · week of {dayMonth(p.weekStart)}</span>
            </span>
            <p className="font-serif text-[22px] leading-[31px] m-0 [text-wrap:pretty]">
              “You completed <b className="font-semibold">{p.habitName}</b> on <span className="text-[var(--ochre-deep)]">{Math.round(p.completionRate)}%</span> of its days.{' '}
              {p.proposedTarget > p.currentTarget ? 'Your momentum is ready for higher elevation.”' : 'A gentler target will keep the rhythm alive.”'}
            </p>
            <div className="kh-docket px-4 py-3 text-[14px] text-ink-2 [text-wrap:pretty]">
              <b className="font-semibold">Suggested adjustment:</b> target {duration(p.currentTarget)} → {duration(p.proposedTarget)}. {p.rationale}
            </div>
          </div>
          <div className="flex flex-col gap-2.5 min-w-[220px]">
            <Btn kind="ochre" onClick={() => void act(() => window.api.proposal.accept(p.id))}>
              Review &amp; apply adjustment
            </Btn>
            <Btn kind="soft" onClick={() => void act(() => window.api.proposal.reject(p.id))}>
              Keep current cadence
            </Btn>
          </div>
        </section>
      ))}

      <div className="flex items-center justify-between mb-5">
        <h2 className="t-h3 m-0 flex items-center gap-2">
          <Sprout size={18} /> Current active disciplines
        </h2>
        <span className="t-stamp text-ink-4">Order by: time of day</span>
      </div>

      {active.length === 0 ? (
        <div className="kh-empty mb-10">
          <span className="t-h2 text-ink">Your first step starts here.</span>
          <span className="max-w-[420px]">A habit is one small, repeatable step. Plant one here, or choose a mountain and let the cartographer draft several at once.</span>
          <Btn kind="laurel" onClick={() => setEditing('new')}>
            Create a habit
          </Btn>
        </div>
      ) : (
        <div className="grid gap-5 grid-cols-[repeat(auto-fill,minmax(360px,1fr))] mb-12">
          {[...active]
            .sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime))
            .map((h) => (
              <HabitCard key={h.id} habit={h} goal={h.goalId !== null ? goalsById.get(h.goalId) : undefined} stats={stats.get(h.id)!} dash={data.dash} onEdit={() => setEditing(h.id)} />
            ))}
        </div>
      )}

      <section className="kh-sheet p-7 mb-8">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div className="flex flex-col gap-1">
            <span className="t-stamp text-ink-3">Dot-matrix chronology</span>
            <h2 className="t-h2 m-0">Weekly rhythm adherence (past {WEEKS} weeks)</h2>
            <span className="t-caption">Each column is a Saturday-to-Friday week; three ink dots mark a third, two thirds and a full week kept.</span>
          </div>
          <div className="flex items-center gap-5 t-caption">
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--rule-soft)]" /> No record
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--laurel-tint)]" /> Unmet
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-full bg-[var(--laurel-deep)]" /> Kept
            </span>
          </div>
        </div>
        <DotMatrix weeks={matrix} />
      </section>

      {paused.length > 0 ? (
        <section className="mb-8">
          <h2 className="t-h3 mb-3">Resting rhythms</h2>
          <div className="flex flex-col gap-2">
            {paused.map((h) => (
              <div key={h.id} className="kh-row">
                <span className="flex-1 flex flex-col">
                  <span className="text-[15px] text-ink-3">{h.name}</span>
                  <span className="t-caption">
                    {describeRecurrence(h.recurrence)} · {duration(h.targetMinutes)} · paused, history kept
                  </span>
                </span>
                <Btn size="sm" kind="soft" onClick={() => void act(() => window.api.habits.setActive(h.id, true))}>
                  Resume
                </Btn>
                <IconBtn title={`Edit ${h.name}`} onClick={() => setEditing(h.id)}>
                  <Pencil size={14} />
                </IconBtn>
              </div>
            ))}
          </div>
        </section>
      ) : null}

      <section className="kh-docket p-6 flex flex-wrap items-center gap-5">
        <span className="w-12 h-12 rounded-xl grid place-items-center bg-[var(--laurel-wash)] text-laurel">
          <Sprout size={22} />
        </span>
        <span className="flex flex-col flex-1 min-w-[240px]">
          <span className="text-[17px] font-semibold">Terrace habit ecology</span>
          <span className="text-[14px] text-ink-3">
            {plural(active.length, 'active habit')} support {plural(anchored.size, 'mountain pathway')}
            {active.length - active.filter((h) => h.goalId !== null).length > 0 ? `, with ${active.length - active.filter((h) => h.goalId !== null).length} kept for personal cultivation` : ''}.
          </span>
        </span>
        <span className="t-stamp text-ink-3 flex items-center gap-2">
          Weekly load: {duration(active.reduce((s, h) => s + h.targetMinutes * sessionsPerWeek(h), 0))}
          <Dot tone="laurel" />
        </span>
      </section>

      {editing !== null ? (
        <HabitEditor
          habit={editing === 'new' ? null : (data.habits.find((h) => h.id === editing) ?? null)}
          goals={data.goals}
          onClose={() => setEditing(null)}
        />
      ) : null}
    </Page>
  )
}
