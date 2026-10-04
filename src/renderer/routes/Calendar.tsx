import { useMemo, useState } from 'react'
import { Check, ChevronLeft, ChevronRight, Clock, Droplet, GripVertical, Mountain, Pencil, Play, Plus, X } from 'lucide-react'
import type { CalendarBlock, CalendarMonthDay, GoalView, PerformanceView, TodoView } from '@shared/types'
import { useData } from '../hooks/useData'
import { addDays, duration, saturdayOf, toLocalDate } from '../lib/format'
import { dayMonth, effectiveStatus, monthYear, plural, today, toMinutes, weekDates } from '../lib/khatwa'
import { useShell } from '../khatwa/nav'
import { Page } from '../khatwa/Page'
import { Alert, Btn, CheckBox, Dot, LoadError, Loading, Modal, Ring, Stamp } from '../khatwa/ui'

type WeekData = {
  blocks: CalendarBlock[]
  perf: PerformanceView
  month: CalendarMonthDay[]
  goals: GoalView[]
  notes: TodoView
}

function weekTitle(start: string): string {
  const a = new Date(`${start}T12:00:00`)
  const b = new Date(`${addDays(start, 6)}T12:00:00`)
  const month = (d: Date): string => d.toLocaleDateString(undefined, { month: 'long' })
  if (a.getMonth() === b.getMonth()) return `${month(a)} ${a.getDate()} – ${b.getDate()}, ${b.getFullYear()}`
  const tail = a.getFullYear() === b.getFullYear() ? '' : `, ${a.getFullYear()}`
  return `${month(a)} ${a.getDate()}${tail} – ${month(b)} ${b.getDate()}, ${b.getFullYear()}`
}

function Block({
  block,
  now,
  isNext,
  onToggle,
  onStart,
  busy
}: {
  block: CalendarBlock
  now: string
  isNext: boolean
  onToggle: () => void
  onStart: () => void
  busy: boolean
}) {
  const status = effectiveStatus(block, now)
  const done = status === 'complete'
  const future = block.date > now
  const movable = !done && block.date >= now
  return (
    <div
      draggable={movable}
      onDragStart={(e) => {
        e.dataTransfer.setData('text/plain', String(block.occurrenceId))
        e.dataTransfer.effectAllowed = 'move'
      }}
      className={`rounded-lg px-2 py-2 flex flex-col gap-1 text-left min-w-0 overflow-hidden ${
        isNext
          ? 'bg-[var(--card)] ring-1 ring-[var(--ochre)] shadow-[var(--shadow-rest)]'
          : done
            ? 'bg-[var(--docket)]'
            : status === 'missed'
              ? 'bg-[var(--error-wash)]/60 border border-dashed border-[var(--rule)]'
              : 'bg-[var(--card)] border border-[var(--rule-soft)]'
      } ${movable ? 'cursor-grab active:cursor-grabbing' : ''}`}
    >
      <div className="flex items-center justify-between gap-1">
        <span className={`font-serif text-[12px] t-num ${isNext ? 'text-[var(--ochre-deep)] font-semibold' : 'text-ink-3'}`}>{block.scheduledTime}</span>
        {isNext ? (
          <span className="flex items-center gap-1 text-[11px] text-[var(--ochre-deep)]">
            <Dot /> Next
          </span>
        ) : (
          <button
            className={`w-5 h-5 shrink-0 rounded-full grid place-items-center ${done ? 'bg-[var(--laurel)] text-[var(--on-solid)]' : 'border border-[var(--ink-4)] text-transparent hover:text-ink-4'} disabled:opacity-40`}
            onClick={onToggle}
            disabled={busy || future}
            title={future ? 'Future days cannot be marked yet' : done ? 'Mark as not done' : 'Mark as done'}
            aria-label={done ? `Mark ${block.name} not done` : `Mark ${block.name} done`}
          >
            <Check size={11} strokeWidth={3} />
          </button>
        )}
      </div>
      <span className={`text-[12.5px] leading-[16px] font-medium [overflow-wrap:anywhere] ${done ? 'line-through text-ink-4' : ''}`}>{block.name}</span>
      <span className="text-[11.5px] text-ink-4">{duration(block.targetMinutes)}{status === 'missed' ? ' · missed' : status === 'skipped' ? ' · rested' : status === 'partial' ? ' · partial' : ''}</span>
      {isNext ? (
        <div className="flex gap-1.5 mt-1">
          <button className="kh-btn is-ochre is-sm !px-2 !py-1 !text-[11px] flex-1" disabled={busy} onClick={onStart}>
            <Play size={11} /> {block.timerRunning ? 'Running' : 'Begin step'}
          </button>
          <button className="kh-btn is-soft is-sm !px-2 !py-1" disabled={busy} onClick={onToggle} title="Mark as done" aria-label={`Mark ${block.name} done`}>
            <Check size={12} />
          </button>
        </div>
      ) : null}
    </div>
  )
}

function StepModal({ date, onClose }: { date: string; onClose: () => void }) {
  const [title, setTitle] = useState('')
  const [day, setDay] = useState(date)
  const [error, setError] = useState<string | null>(null)
  return (
    <Modal onClose={onClose} label="Schedule an intentional step" width={500}>
      <form
        className="p-7 flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (!title.trim()) return
          window.api.todo
            .addManual(title.trim(), day)
            .then(onClose)
            .catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="t-h2 m-0">Schedule an intentional step</h2>
          <button type="button" className="kh-icon-btn" onClick={onClose} aria-label="Close">
            <X size={16} />
          </button>
        </div>
        {error ? <Alert>{error}</Alert> : null}
        <label className="kh-field">
          <span className="kh-field-label">The step</span>
          <input className="kh-input is-display" autoFocus value={title} placeholder="Export the benchmark results" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="kh-field">
          <span className="kh-field-label">On</span>
          <input className="kh-input" type="date" value={day} onChange={(e) => setDay(e.target.value)} />
          <span className="kh-field-hint">A one-off step lives in that day’s margin and carries forward until done. For something that repeats, plant a habit instead.</span>
        </label>
        <div className="flex justify-end gap-3">
          <Btn kind="soft" onClick={onClose}>
            Cancel
          </Btn>
          <Btn kind="laurel" type="submit" disabled={!title.trim()}>
            Pin to the day
          </Btn>
        </div>
      </form>
    </Modal>
  )
}

export default function CalendarRoute() {
  const { navigate } = useShell()
  const now = today()
  const [start, setStart] = useState(saturdayOf(now))
  const [view, setView] = useState<'week' | 'month'>('week')
  const [selected, setSelected] = useState(now)
  const [busy, setBusy] = useState<number | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [dropTarget, setDropTarget] = useState<string | null>(null)
  const days = weekDates(start)

  const { data, error: loadError, refetch } = useData<WeekData>(async () => {
    const [blocks, perf, month, goals, notes] = await Promise.all([
      window.api.view.calendarRange(days[0]!, days[6]!),
      window.api.view.performance(start),
      window.api.view.calendarMonth(selected),
      window.api.goals.list(),
      window.api.view.todos(selected)
    ])
    return { blocks, perf, month, goals, notes }
  }, [start, selected])

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarBlock[]>()
    for (const d of days) m.set(d, [])
    for (const b of data?.blocks ?? []) m.get(b.date)?.push(b)
    for (const list of m.values()) list.sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime))
    return m
  }, [data?.blocks, days])

  const act = async (id: number, fn: () => Promise<unknown>): Promise<void> => {
    setBusy(id)
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(null)
    }
  }

  const shiftWeek = (n: number): void => {
    const next = addDays(start, n * 7)
    setStart(next)
    setSelected(next <= now && now <= addDays(next, 6) ? now : next)
  }
  const shiftMonth = (n: number): void => {
    const d = new Date(`${selected.slice(0, 7)}-01T12:00:00`)
    d.setMonth(d.getMonth() + n)
    const first = toLocalDate(d)
    setSelected(first)
    setStart(saturdayOf(first))
  }
  const goTo = (date: string): void => {
    setStart(saturdayOf(date))
    setSelected(date)
    setView('week')
  }

  if (loadError) return <Page><LoadError message={loadError} onRetry={refetch} /></Page>
  if (!data) return <Page><Loading label="Turning to this week’s pages…" /></Page>

  const planned = data.blocks.reduce((s, b) => s + b.targetMinutes, 0)
  const logged = data.perf.days.reduce((s, d) => s + d.minutes, 0)
  const scheduled = data.perf.days.reduce((s, d) => s + d.scheduled, 0)
  const completed = data.perf.days.reduce((s, d) => s + d.completed, 0)
  const primary = data.goals.find((g) => g.status === 'active')
  const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes()
  const todayBlocks = byDay.get(now) ?? []
  const nextToday =
    todayBlocks.find((b) => b.timerRunning) ??
    todayBlocks.find((b) => (b.status === 'pending' || b.status === 'partial') && toMinutes(b.scheduledTime) + b.targetMinutes >= nowMinutes) ??
    todayBlocks.find((b) => b.status === 'pending' || b.status === 'partial')
  const weekIndex = Math.ceil((new Date(`${start}T12:00:00`).getTime() - new Date(`${start.slice(0, 4)}-01-01T12:00:00`).getTime()) / (7 * 86_400_000)) + 1
  const manual = data.notes.items.filter((i) => i.kind === 'manual' && !i.dropped)

  const footerFor = (date: string, list: CalendarBlock[]): { text: string; tone: string } => {
    if (list.length === 0) return { text: 'Uncluttered', tone: 'text-ink-4' }
    if (date === now) return { text: 'Present hour', tone: 'text-[var(--ochre-deep)]' }
    if (date > now) return { text: 'Planned', tone: 'text-ink-4' }
    const missed = list.filter((b) => effectiveStatus(b, now) === 'missed').length
    if (missed) return { text: `${missed} missed`, tone: 'text-[var(--error)]' }
    return { text: 'Done', tone: 'text-laurel' }
  }

  return (
    <Page>
      <section className="kh-sheet p-6 mb-7 flex flex-wrap items-center gap-6">
        <div className="flex flex-col gap-3 flex-1 min-w-[320px]">
          <div className="flex items-center gap-2">
            <button className="kh-icon-btn !bg-[var(--docket)]" onClick={() => (view === 'week' ? shiftWeek(-1) : shiftMonth(-1))} aria-label="Previous">
              <ChevronLeft size={16} />
            </button>
            <button className="kh-icon-btn !bg-[var(--docket)]" onClick={() => (view === 'week' ? shiftWeek(1) : shiftMonth(1))} aria-label="Next">
              <ChevronRight size={16} />
            </button>
            <Btn kind="soft" size="sm" onClick={() => goTo(now)}>
              Today
            </Btn>
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <h1 className="t-hero !text-[40px] !leading-[46px] m-0 text-[var(--laurel-deep)]">{view === 'week' ? weekTitle(start) : monthYear(selected)}</h1>
            <Stamp tone="ochre" className="mb-1.5">
              {view === 'week' ? `Week ${weekIndex} folio` : 'Month overview'}
            </Stamp>
          </div>
          <span className="t-italic !text-[14px]">Saturday to Friday · drag a step to another day to move it · tick past days to record them honestly</span>
        </div>
        <div className="kh-segmented">
          <button className={view === 'week' ? 'is-on' : ''} onClick={() => setView('week')}>
            Week view
          </button>
          <button className={view === 'month' ? 'is-on' : ''} onClick={() => setView('month')}>
            Month overview
          </button>
        </div>
        <Btn kind="laurel" size="lg" onClick={() => setAdding(true)}>
          <Pencil size={15} /> Schedule intentional step
        </Btn>
      </section>

      {error ? <div className="mb-5"><Alert>{error}</Alert></div> : null}

      <div className="grid gap-4 mb-7 grid-cols-[repeat(auto-fit,minmax(210px,1fr))]">
        <div className="kh-sheet p-4 flex items-center gap-4">
          <span className="w-12 h-12 rounded-xl grid place-items-center bg-[var(--laurel-wash)] text-laurel shrink-0">
            <Clock size={20} />
          </span>
          <span className="flex flex-col">
            <span className="t-stamp !text-[10.5px] text-ink-4">Weekly allocation</span>
            <span className="text-[22px] font-semibold t-num">
              {(logged / 60).toFixed(1)} <span className="text-[13px] font-normal text-ink-3">/ {(planned / 60).toFixed(1)} hrs planned</span>
            </span>
          </span>
        </div>
        <div className="kh-sheet p-4 flex items-center gap-4">
          <span className="w-12 h-12 rounded-xl grid place-items-center bg-[var(--ochre-wash)] text-[var(--ochre-deep)] shrink-0">
            <Droplet size={20} />
          </span>
          <span className="flex flex-col">
            <span className="t-stamp !text-[10.5px] text-ink-4">Rhythm cadence</span>
            <span className="text-[22px] font-semibold text-[var(--ochre-deep)] t-num">
              {scheduled ? `${Math.round((completed / scheduled) * 100)}%` : '—'} <span className="text-[13px] font-normal text-ink-3">completed in sync</span>
            </span>
          </span>
        </div>
        <button className="kh-sheet p-4 flex items-center gap-4 text-left" onClick={() => primary && navigate({ name: 'mountain', id: primary.id })} disabled={!primary}>
          <span className="w-12 h-12 rounded-xl grid place-items-center bg-[var(--slate-wash)] text-slate shrink-0">
            <Mountain size={20} />
          </span>
          <span className="flex flex-col min-w-0">
            <span className="t-stamp !text-[10.5px] text-ink-4">Primary mountain</span>
            <span className="text-[16px] font-semibold truncate">{primary?.title ?? 'None chosen yet'}</span>
          </span>
        </button>
        <div className="kh-sheet p-4 flex items-center justify-between gap-4">
          <span className="flex flex-col">
            <span className="t-stamp !text-[10.5px] text-ink-4">Points target</span>
            <span className="t-italic !text-[13.5px]">
              {data.perf.weeklyTarget ? `${data.perf.totalPoints} of ${data.perf.weeklyTarget} points` : `${data.perf.totalPoints} points · no target set`}
            </span>
          </span>
          <Ring value={data.perf.weeklyTarget ? data.perf.targetProgress : 0} size={52} stroke={4}>
            <span className="font-serif text-[12.5px]">{data.perf.weeklyTarget ? `${Math.round(data.perf.targetProgress * 100)}%` : '—'}</span>
          </Ring>
        </div>
      </div>

      <div className="grid gap-6 min-[1500px]:grid-cols-[minmax(0,1fr)_300px]">
        {view === 'week' ? (
          <section className="kh-card p-5 min-w-0">
            <div className="flex items-center justify-between mb-4 px-1">
              <span className="t-stamp text-ink-2 flex items-center gap-2">
                <Dot /> Seven rhythms strip
              </span>
              <span className="t-italic !text-[13px] flex items-center gap-1.5">
                <GripVertical size={13} /> Drag open steps between days
              </span>
            </div>
            <div className="grid grid-cols-7 gap-2 min-w-0">
              {days.map((d) => {
                const list = byDay.get(d) ?? []
                const isToday = d === now
                const foot = footerFor(d, list)
                const wd = new Date(`${d}T12:00:00`)
                return (
                  <div
                    key={d}
                    onDragOver={(e) => {
                      if (d < now) return
                      e.preventDefault()
                      setDropTarget(d)
                    }}
                    onDragLeave={() => setDropTarget((t) => (t === d ? null : t))}
                    onDrop={(e) => {
                      e.preventDefault()
                      setDropTarget(null)
                      const id = Number(e.dataTransfer.getData('text/plain'))
                      const block = data.blocks.find((b) => b.occurrenceId === id)
                      if (!block || block.date === d || d < now) return
                      void act(id, () => window.api.occurrence.reschedule(id, d, block.scheduledTime))
                    }}
                    className={`rounded-lg flex flex-col min-h-[440px] min-w-0 ${isToday ? 'bg-[var(--ochre-wash)] ring-1 ring-[var(--ochre-tint)]' : 'bg-[var(--sheet)]'} ${dropTarget === d ? 'ring-2 !ring-[var(--laurel)]' : ''}`}
                  >
                    <button className={`flex items-baseline justify-between px-2.5 pt-2.5 pb-2 border-b ${isToday ? 'border-[var(--ochre-tint)]' : 'border-[var(--rule-soft)]'}`} onClick={() => setSelected(d)}>
                      <span className={`t-stamp !text-[10.5px] ${isToday ? 'text-[var(--ochre-deep)]' : 'text-ink-4'}`}>
                        {wd.toLocaleDateString(undefined, { weekday: 'short' })}
                        {isToday ? ' · today' : ''}
                      </span>
                      <span className={`font-serif text-[20px] ${isToday ? 'text-[var(--ochre-deep)]' : d === selected ? 'text-laurel underline decoration-dotted' : ''}`}>{wd.getDate()}</span>
                    </button>
                    <div className="flex flex-col gap-1.5 p-1.5 flex-1">
                      {list.map((b) => (
                        <Block
                          key={b.occurrenceId}
                          block={b}
                          now={now}
                          isNext={nextToday?.occurrenceId === b.occurrenceId}
                          busy={busy === b.occurrenceId}
                          onToggle={() => void act(b.occurrenceId, () => window.api.occurrence.setCompleted(b.occurrenceId, b.status !== 'complete'))}
                          onStart={() =>
                            void act(b.occurrenceId, () => (b.timerRunning ? window.api.timer.stop(b.occurrenceId) : window.api.timer.start(b.occurrenceId)))
                          }
                        />
                      ))}
                    </div>
                    <span className={`t-stamp !text-[10px] text-center py-2.5 ${foot.tone}`}>{foot.text}</span>
                  </div>
                )
              })}
            </div>
          </section>
        ) : (
          <section className="kh-card p-5 min-w-0">
            <div className="grid grid-cols-7 gap-2 mb-2">
              {data.month.slice(0, 7).map((c) => (
                <span key={c.date} className="t-stamp !text-[10.5px] text-ink-4 text-center">
                  {new Date(`${c.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}
                </span>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-2">
              {data.month.map((c) => {
                const rate = c.scheduled ? (c.complete + c.partial * 0.5) / c.scheduled : 0
                return (
                  <button
                    key={c.date}
                    onClick={() => goTo(c.date)}
                    className={`rounded-lg p-2.5 min-h-[86px] text-left flex flex-col gap-2 ${c.inMonth ? 'bg-[var(--sheet)] hover:bg-[var(--docket)]' : 'opacity-40'} ${c.date === now ? 'ring-1 ring-[var(--ochre)]' : ''}`}
                  >
                    <span className={`font-serif text-[17px] ${c.date === now ? 'text-[var(--ochre-deep)]' : ''}`}>{Number(c.date.slice(8))}</span>
                    {c.scheduled ? (
                      <>
                        <span className="flex flex-wrap gap-1">
                          {Array.from({ length: c.complete }, (_, i) => (
                            <span key={`c${i}`} className="w-2 h-2 rounded-full bg-[var(--laurel-deep)]" />
                          ))}
                          {Array.from({ length: c.partial }, (_, i) => (
                            <span key={`p${i}`} className="w-2 h-2 rounded-full bg-[var(--ochre)]" />
                          ))}
                          {Array.from({ length: c.missed }, (_, i) => (
                            <span key={`m${i}`} className="w-2 h-2 rounded-full border border-[var(--error)]" />
                          ))}
                          {Array.from({ length: Math.max(0, c.scheduled - c.complete - c.partial - c.missed) }, (_, i) => (
                            <span key={`o${i}`} className="w-2 h-2 rounded-full bg-[var(--rule)]" />
                          ))}
                        </span>
                        <span className="t-caption mt-auto">{c.date <= now ? `${Math.round(rate * 100)}%` : plural(c.scheduled, 'step')}</span>
                      </>
                    ) : null}
                  </button>
                )
              })}
            </div>
          </section>
        )}

        <aside className="grid gap-5 min-w-0 content-start grid-cols-[repeat(auto-fit,minmax(280px,1fr))] min-[1500px]:grid-cols-1">
          <div className="kh-card p-5">
            <div className="flex items-baseline justify-between mb-3">
              <span className="t-stamp text-ink-2">{monthYear(selected)}</span>
              <span className="t-italic !text-[12.5px]">Tap a day</span>
            </div>
            <div className="grid grid-cols-7 gap-y-1 text-center">
              {data.month.slice(0, 7).map((c) => (
                <span key={c.date} className="text-[11px] text-ink-4 py-1">
                  {new Date(`${c.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}
                </span>
              ))}
              {data.month.map((c) => (
                <button
                  key={c.date}
                  onClick={() => goTo(c.date)}
                  className={`mx-auto w-8 h-8 rounded-full text-[13px] t-num relative ${
                    c.date === now ? 'bg-[var(--ochre-deep)] text-[var(--on-solid)] font-semibold' : c.date === selected ? 'ring-1 ring-[var(--laurel)]' : ''
                  } ${c.inMonth ? '' : 'text-ink-4 opacity-50'} hover:bg-[var(--docket)]`}
                >
                  {Number(c.date.slice(8))}
                  {c.scheduled && c.date !== now ? (
                    <span
                      className="absolute left-1/2 -translate-x-1/2 bottom-0.5 w-1 h-1 rounded-full"
                      style={{ background: c.missed ? 'var(--error)' : c.complete === c.scheduled ? 'var(--laurel)' : 'var(--rule)' }}
                    />
                  ) : null}
                </button>
              ))}
            </div>
          </div>

          <div className="kh-card p-5 flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <span className="t-h3">{selected === now ? 'Today’s margin' : `Margin · ${dayMonth(selected)}`}</span>
              <span className="t-caption">{plural(manual.filter((i) => !i.done).length, 'waiting', 'waiting')}</span>
            </div>
            <span className="t-caption [text-wrap:pretty]">One-off steps pinned to this day. Unfinished ones carry forward.</span>
            {manual.length === 0 ? <span className="t-italic !text-[13.5px]">Nothing pinned here.</span> : null}
            {manual.map((item) => (
              <div key={item.id} className="kh-docket px-3 py-2.5 flex items-start gap-2.5">
                <CheckBox
                  small
                  state={item.done ? 'done' : 'open'}
                  label={item.done ? 'Reopen' : 'Mark done'}
                  onClick={() => void act(item.id, () => window.api.todo.setDone(item.id, !item.done))}
                />
                <span className={`text-[13.5px] leading-5 flex-1 ${item.done ? 'line-through text-ink-4' : ''}`}>{item.title}</span>
              </div>
            ))}
            <Btn kind="soft" size="sm" onClick={() => setAdding(true)}>
              <Plus size={14} /> Draft a new intent
            </Btn>
          </div>
        </aside>
      </div>

      {adding ? <StepModal date={selected} onClose={() => setAdding(false)} /> : null}
    </Page>
  )
}
