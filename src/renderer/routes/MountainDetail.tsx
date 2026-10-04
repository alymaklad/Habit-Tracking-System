import { useState } from 'react'
import {
  ArrowLeft,
  Check,
  ExternalLink,
  Flag,
  Mountain,
  Pencil,
  Plus,
  RotateCcw,
  Search,
  Trash2,
  TriangleAlert,
  X
} from 'lucide-react'
import type { CalendarBlock, GoalObstacle, GoalView, GuideInsight, Habit, LetGoView, PerformanceView, Tool } from '@shared/types'
import MindMap from '../components/MindMap'
import { useData } from '../hooks/useData'
import { describeRecurrence, duration, saturdayOf } from '../lib/format'
import { currentMilestone, dayMonth, daysBetween, goalProgress, isoWeekday, monthYear, plural, roman, today, weekDates } from '../lib/khatwa'
import { TrailMap } from '../khatwa/charts'
import { obstaclesOf, waypointsOf } from './Mountains'
import { FreedomDots, GuideCard, ToolsPanel, WEIGHT_LABEL, WEIGHT_TONE } from '../khatwa/letgo'
import { useShell } from '../khatwa/nav'
import { Page } from '../khatwa/Page'
import { Alert, Btn, CheckBox, Eyebrow, IconBtn, LoadError, Loading, Modal, Stamp } from '../khatwa/ui'

type Data = {
  goal: GoalView | null
  letGos: LetGoView[]
  tools: Tool[]
  guide: GuideInsight[]
  goals: GoalView[]
  habits: Habit[]
  perf: PerformanceView
  blocks: CalendarBlock[]
  week: string[]
}

const WEEK_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

function HabitCadence({ habit, blocks, perf, week }: { habit: Habit; blocks: CalendarBlock[]; perf: PerformanceView; week: string[] }) {
  const { navigate } = useShell()
  const mine = blocks.filter((b) => b.habitId === habit.id)
  const byWeekday = new Map(mine.map((b) => [isoWeekday(b.date), b]))
  const stats = perf.habits.find((h) => h.habitId === habit.id)
  const scheduledDays = new Set(week.map(isoWeekday).filter((d) => mine.some((b) => isoWeekday(b.date) === d)))
  return (
    <button className="kh-card p-4 flex flex-col gap-3 text-left hover:border-[var(--rule)]" onClick={() => navigate({ name: 'habits', edit: habit.id })}>
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2 min-w-0">
          <span className={`kh-dot ${habit.active ? 'is-laurel' : 'is-faint'}`} />
          <span className="text-[14px] font-semibold truncate">{habit.name}</span>
        </span>
        {stats ? <span className="t-stamp !text-[10.5px] text-[var(--ochre-deep)] shrink-0">{Math.round(stats.completionRate)}% consistency</span> : null}
      </div>
      <div className="flex items-center justify-between gap-3 t-caption !text-[12.5px]">
        <span>
          {describeRecurrence(habit.recurrence)} · {duration(habit.targetMinutes)}
        </span>
        {stats ? (
          <span>
            {stats.completed}/{stats.scheduled} this week
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {WEEK_LETTERS.map((letter, i) => {
          const b = byWeekday.get(i + 1)
          const done = b?.status === 'complete'
          const partial = b?.status === 'partial'
          return (
            <span
              key={i}
              className="h-6 rounded-[4px] grid place-items-center text-[10.5px] font-semibold"
              style={{
                background: done ? 'var(--laurel-deep)' : partial ? 'var(--ochre-tint)' : scheduledDays.has(i + 1) ? 'var(--docket)' : 'transparent',
                color: done ? 'var(--on-solid)' : 'var(--ink-4)',
                border: scheduledDays.has(i + 1) ? 'none' : '1px dashed var(--rule)'
              }}
              title={b ? `${b.date}: ${b.status}` : 'Not scheduled'}
            >
              {done ? <Check size={12} strokeWidth={3} /> : letter}
            </span>
          )
        })}
      </div>
    </button>
  )
}

function WaypointEditor({
  goalId,
  initial,
  onClose
}: {
  goalId: number
  initial: { id: number; title: string; date: string | null } | null
  onClose: () => void
}) {
  const [title, setTitle] = useState(initial?.title ?? '')
  const [date, setDate] = useState(initial?.date ?? today())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (initial) {
        if (title.trim() !== initial.title) await window.api.todo.rename(initial.id, title.trim())
        if (date !== initial.date) await window.api.todo.reschedule(initial.id, date)
      } else {
        await window.api.todo.addManual(title.trim(), date, goalId)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} label={initial ? 'Edit waypoint' : 'Append a waypoint'} width={520}>
      <form
        className="p-7 flex flex-col gap-5"
        onSubmit={(e) => {
          e.preventDefault()
          if (title.trim()) void save()
        }}
      >
        <div className="flex items-center justify-between">
          <h2 className="t-h2 m-0">{initial ? 'Edit waypoint' : 'Append a waypoint along the ridge'}</h2>
          <IconBtn title="Close" onClick={onClose}>
            <X size={16} />
          </IconBtn>
        </div>
        {error ? <Alert>{error}</Alert> : null}
        <label className="kh-field">
          <span className="kh-field-label">Waypoint</span>
          <input className="kh-input is-display" autoFocus value={title} placeholder="Finish unit one" onChange={(e) => setTitle(e.target.value)} />
        </label>
        <label className="kh-field">
          <span className="kh-field-label">Reach it by</span>
          <input className="kh-input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          <span className="kh-field-hint">It appears in Today’s margin on this date, and carries forward until it is cleared.</span>
        </label>
        <div className="flex justify-end gap-3">
          <Btn kind="soft" onClick={onClose}>
            Cancel
          </Btn>
          <Btn kind="laurel" type="submit" disabled={busy || !title.trim()}>
            {initial ? 'Save waypoint' : 'Pin waypoint'}
          </Btn>
        </div>
      </form>
    </Modal>
  )
}

/** Things standing in the way, each placed on the stretch of trail before a waypoint. */
function ObstaclesPanel({ goal, closed }: { goal: GoalView; closed: boolean }) {
  const [title, setTitle] = useState('')
  const [near, setNear] = useState<string>('')
  const [error, setError] = useState<string | null>(null)
  const live = goal.milestones.filter((m) => !m.dropped).sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'))
  const nearLabel = (id: number | null): string => (id === null ? 'on the final climb' : `on the trail before “${live.find((m) => m.id === id)?.title ?? 'a waypoint'}”`)

  const save = (obstacles: GoalObstacle[]): void => {
    setError(null)
    window.api.goals.updatePlan(goal.id, { obstacles }).catch((err: unknown) => setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err)))
  }
  const change = (id: string, patch: Partial<GoalObstacle>): void => save(goal.obstacles.map((o) => (o.id === id ? { ...o, ...patch } : o)))

  return (
    <section className="kh-sheet p-6 flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="t-h2 m-0">What stands in the way</h2>
        <p className="m-0 t-italic !text-[14.5px]">Name it and it becomes terrain — mist on a stretch of the trail you can plan a way through.</p>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {goal.obstacles.length === 0 ? <span className="text-[14px] text-ink-3">Nothing named yet. Fear of starting, not knowing what to learn next, an evening that keeps getting away — whatever slows this climb.</span> : null}
      <ul className="m-0 p-0 list-none flex flex-col gap-3">
        {goal.obstacles.map((o) => (
          <li key={o.id} className={`rounded-[10px] px-4 py-3 flex flex-col gap-2 border ${o.passed ? 'bg-[var(--sheet)] border-[var(--rule-soft)]' : 'bg-[var(--slate-wash)] border-transparent'}`}>
            <div className="flex items-start gap-3">
              <CheckBox small state={o.passed ? 'done' : 'open'} label={o.passed ? `Mark ${o.title} as still ahead` : `Mark ${o.title} as passed`} onClick={() => change(o.id, { passed: !o.passed })} disabled={closed} />
              <div className="flex flex-col flex-1 min-w-0 -mt-0.5">
                <span className={`font-serif text-[18px] leading-6 ${o.passed ? 'line-through text-ink-4' : 'text-[var(--slate)]'}`}>{o.title}</span>
                <span className="t-caption">{o.passed ? 'Passed' : 'Lies'} {nearLabel(o.nearMilestoneId)}</span>
              </div>
              {!closed ? (
                <IconBtn title={`Remove ${o.title}`} onClick={() => save(goal.obstacles.filter((x) => x.id !== o.id))}>
                  <X size={14} />
                </IconBtn>
              ) : null}
            </div>
            <input
              className="kh-input !text-[14px] !py-1 !font-serif !italic ml-[30px] !w-[calc(100%-30px)]"
              placeholder="How I’ll pass it…"
              defaultValue={o.note ?? ''}
              disabled={closed}
              aria-label={`How you will pass ${o.title}`}
              onBlur={(e) => {
                const note = e.target.value.trim() || null
                if (note !== o.note) change(o.id, { note })
              }}
            />
          </li>
        ))}
      </ul>
      {!closed ? (
        <form
          className="flex flex-wrap items-end gap-3 pt-3 border-t border-[var(--rule)]"
          onSubmit={(e) => {
            e.preventDefault()
            const t = title.trim()
            if (!t) return
            save([...goal.obstacles, { id: `o${Date.now().toString(36)}`, title: t, note: null, nearMilestoneId: near ? Number(near) : null, passed: false }])
            setTitle('')
          }}
        >
          <label className="kh-field flex-1 min-w-[200px]">
            <span className="kh-field-label">Something in the way</span>
            <input className="kh-input" value={title} placeholder="Fear of starting" onChange={(e) => setTitle(e.target.value)} />
          </label>
          <label className="kh-field">
            <span className="kh-field-label">Where it lies</span>
            <select className="kh-select !w-[220px]" value={near} onChange={(e) => setNear(e.target.value)}>
              {live.map((m) => (
                <option key={m.id} value={m.id}>
                  Before {m.title.length > 28 ? `${m.title.slice(0, 27)}…` : m.title}
                </option>
              ))}
              <option value="">On the final climb</option>
            </select>
          </label>
          <Btn kind="ruled" type="submit" disabled={!title.trim()}>
            Put it on the map
          </Btn>
        </form>
      ) : null}
    </section>
  )
}

export default function MountainDetail({ id }: { id: number }) {
  const { navigate, toast } = useShell()
  const [editing, setEditing] = useState<{ id: number; title: string; date: string | null } | 'new' | null>(null)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { data, error: loadError, refetch } = useData<Data>(async () => {
    const start = saturdayOf(today())
    const week = weekDates(start)
    const [goal, habits, perf, blocks, letGos, tools, guide, goals] = await Promise.all([
      window.api.goals.get(id),
      window.api.habits.list(),
      window.api.view.performance(),
      window.api.view.calendarRange(week[0]!, week[6]!),
      window.api.letGo.list(),
      window.api.tools.list(),
      window.api.guide.list(),
      window.api.goals.list()
    ])
    return { goal, habits, perf, blocks, week, letGos, tools, guide, goals }
  }, [id])

  const run = async (fn: () => Promise<unknown>, done?: string): Promise<void> => {
    setError(null)
    try {
      await fn()
      if (done) toast('success', done)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  if (loadError) return <Page><LoadError message={loadError} onRetry={refetch} /></Page>
  if (!data) return <Page><Loading label="Reading the ascent log…" /></Page>
  const goal = data.goal
  if (!goal) {
    return (
      <Page>
        <div className="kh-empty">
          <span className="t-h2 text-ink">This mountain is no longer in the folio.</span>
          <Btn kind="ruled" onClick={() => navigate({ name: 'mountains' })}>
            Back to the mountains
          </Btn>
        </div>
      </Page>
    )
  }

  const live = goal.milestones.filter((m) => !m.dropped).sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'))
  const current = currentMilestone(goal)
  const currentIndex = current ? live.findIndex((m) => m.id === current.id) : live.length - 1
  const progress = goalProgress(goal)
  const goalHabits = data.habits.filter((h) => h.goalId === goal.id)
  const closed = goal.status !== 'active'
  const carried = data.letGos.filter((l) => l.goalId === goal.id)
  const carriedIds = new Set(carried.map((l) => l.id))
  const mountainInsights = data.guide.filter((g) => {
    const m = /^(letgo-feeling|letgo-alternative|ceremony):(d+)/.exec(g.key)
    if (m) return carriedIds.has(Number(m[2]))
    return g.action?.kind === 'open-mountain' && g.action.id === goal.id
  })
  const now = today()

  return (
    <Page>
      <button className="flex items-center gap-2 text-[15px] text-[var(--ochre-deep)] mb-5 hover:underline" onClick={() => navigate({ name: 'mountains' })}>
        <ArrowLeft size={16} /> Back to the mountain range
      </button>

      <header className="flex flex-wrap items-end justify-between gap-8 mb-10 pb-8 border-b border-[var(--rule)]">
        <div className="flex flex-col gap-3 min-w-0 max-w-[720px]">
          <Eyebrow>
            Ascent log · No. {String(goal.id).padStart(2, '0')} <span className="is-quiet">/ {closed ? (goal.status === 'achieved' ? 'Summit reached' : 'Path set aside') : 'Major peak ascent'}</span>
          </Eyebrow>
          <h1 className="t-hero !text-[44px] !leading-[52px] m-0 [text-wrap:balance]">{goal.title}</h1>
          {goal.description ? <p className="t-italic m-0 [text-wrap:pretty]">{goal.description}</p> : null}
        </div>
        <div className="kh-sheet flex items-center gap-6 px-6 py-4">
          <div className="flex flex-col">
            <span className="t-stamp !text-[10.5px] text-ink-4">Ascended</span>
            <span className="font-serif text-[28px] leading-9 t-num">{Math.round(progress * 100)}%</span>
          </div>
          <div className="w-px self-stretch bg-[var(--rule)]" />
          <div className="flex flex-col">
            <span className="t-stamp !text-[10.5px] text-ink-4">Horizon target</span>
            <span className="text-[17px] leading-6">{goal.targetDate ? monthYear(goal.targetDate) : 'Open-ended'}</span>
          </div>
          <span className={`font-serif text-[13px] tracking-[0.12em] uppercase px-2 py-1 border-2 border-dashed rounded-md -rotate-6 ${closed ? 'text-laurel border-[var(--laurel)]' : 'text-[var(--ochre-deep)] border-[var(--ochre)]'}`}>
            {goal.status === 'achieved' ? 'Summit' : goal.status === 'abandoned' ? 'Rested' : `Stage ${roman(Math.max(1, currentIndex + 1))}`}
          </span>
        </div>
      </header>

      {error ? <div className="mb-6"><Alert>{error}</Alert></div> : null}

      <div className="grid gap-8 min-[1150px]:grid-cols-[minmax(0,1.35fr)_minmax(320px,1fr)]">
        <div className="flex flex-col gap-8 min-w-0">
          {live.length ? (
            <section className="kh-card p-5">
              <div className="flex items-center justify-between gap-4 mb-4 px-1">
                <h2 className="t-h3 m-0 flex items-center gap-2">
                  <Mountain size={17} /> The trail
                </h2>
                <span className="t-caption">
                  {goal.milestonesDone} of {goal.milestonesTotal} waypoints cleared
                  {goal.obstacles.length ? ` · ${goal.obstacles.filter((o) => !o.passed).length} obstacles ahead` : ''}
                </span>
              </div>
              <TrailMap
                waypoints={waypointsOf(goal)}
                obstacles={obstaclesOf(goal)}
                summit={goal.title}
                summitCaption={goal.targetDate ? `Target ${monthYear(goal.targetDate)}` : undefined}
                height={460}
                compact={live.length > 6}
              />
            </section>
          ) : null}

          <section className="kh-sheet p-6">
            <div className="flex items-center justify-between gap-4 mb-5">
              <h2 className="t-h2 m-0">Waypoints &amp; ridge camps</h2>
              <span className="t-stamp text-ink-4">{closed ? 'Ascent closed' : 'Ascent in progress'}</span>
            </div>

            <ol className="relative flex flex-col gap-3 m-0 p-0 list-none">
              <span className="absolute left-[15px] top-4 bottom-4 w-px bg-[var(--rule)]" aria-hidden="true" />
              {live.map((m) => {
                const isCurrent = m.id === current?.id
                const overdue = !m.done && m.date !== null && m.date < now
                return (
                  <li key={m.id} className="relative flex gap-4 group">
                    <span className="relative z-10 bg-[var(--sheet)] py-1">
                      <CheckBox round state={m.done ? 'done' : 'open'} label={m.done ? `Reopen ${m.title}` : `Mark ${m.title} reached`} onClick={() => void run(() => window.api.todo.setDone(m.id, !m.done))} />
                    </span>
                    <div className={`flex-1 min-w-0 rounded-[10px] px-4 py-3 ${isCurrent ? 'kh-card ring-1 ring-[var(--ochre-tint)]' : 'bg-[var(--card)] border border-[var(--rule-soft)]'}`}>
                      {isCurrent ? (
                        <div className="flex items-center gap-2 mb-1">
                          <Stamp tone="ochre-solid" className="!text-[10px]">Current waypoint</Stamp>
                        </div>
                      ) : null}
                      <div className="flex items-start justify-between gap-3">
                        <span className={`${isCurrent ? 'font-serif text-[20px] leading-7' : 'text-[14.5px] leading-[21px]'} ${m.done ? 'text-ink-4 line-through' : ''} [text-wrap:pretty]`}>{m.title}</span>
                        <span className="flex items-center gap-1 shrink-0">
                          {m.date ? <Stamp tone={m.done ? 'laurel' : overdue ? 'ochre' : 'outline'} className="!text-[10.5px]">{dayMonth(m.date)}</Stamp> : null}
                          <span className="opacity-0 group-hover:opacity-100 flex">
                            <IconBtn title="Edit waypoint" onClick={() => setEditing({ id: m.id, title: m.title, date: m.date })}>
                              <Pencil size={13} />
                            </IconBtn>
                            <IconBtn title="Set waypoint aside" onClick={() => void run(() => window.api.todo.drop(m.id))}>
                              <Trash2 size={13} />
                            </IconBtn>
                          </span>
                        </span>
                      </div>
                      {isCurrent && overdue ? (
                        <div className="mt-3 flex items-start gap-2 text-[13px] text-[var(--ochre-deep)]">
                          <TriangleAlert size={14} className="mt-0.5 shrink-0" /> This waypoint was due {plural(daysBetween(m.date!, now), 'day')} ago. Re-date it honestly rather than let it linger.
                        </div>
                      ) : null}
                    </div>
                  </li>
                )
              })}
              <li className="relative flex gap-4">
                <span className="relative z-10 bg-[var(--sheet)] py-1">
                  <span className={`w-[26px] h-[26px] rounded-md grid place-items-center ${goal.status === 'achieved' ? 'bg-[var(--laurel)] text-[var(--on-solid)]' : 'bg-[var(--ochre-wash)] text-[var(--ochre-deep)] border border-[var(--ochre-tint)]'}`}>
                    <Flag size={13} />
                  </span>
                </span>
                <div className="flex-1 rounded-[10px] px-4 py-3 bg-[var(--ochre-wash)] border border-[var(--ochre-tint)] flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-col">
                    <span className="t-stamp text-[var(--ochre-deep)] !text-[10.5px]">The summit</span>
                    <span className="font-serif text-[18px]">{goal.title}</span>
                  </div>
                  {goal.targetDate ? <span className="t-stamp text-[var(--ochre-deep)]">Target: {monthYear(goal.targetDate)}</span> : null}
                </div>
              </li>
            </ol>

            {!closed ? (
              <button className="mt-5 w-full kh-docket py-3 flex items-center justify-center gap-2 text-[14px] hover:bg-[var(--rule-soft)]" onClick={() => setEditing('new')}>
                <Plus size={15} /> Append a waypoint along the ridge
              </button>
            ) : null}
          </section>

          <ObstaclesPanel goal={goal} closed={closed} />
        </div>

        <aside className="flex flex-col gap-6 min-w-0">
          <section className="kh-sheet p-5 flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="t-h3 m-0">Contributing habits &amp; daily rhythms</h2>
              <span className="t-stamp !text-[10.5px] text-ink-4">This week</span>
            </div>
            {goalHabits.length === 0 ? <span className="t-caption">No habits are tied to this mountain.</span> : null}
            {goalHabits.map((h) => (
              <HabitCadence key={h.id} habit={h} blocks={data.blocks} perf={data.perf} week={data.week} />
            ))}
          </section>

          {goal.mindMap.length > 0 ? (
            <section className="kh-sheet p-5 flex flex-col gap-3">
              <h2 className="t-h3 m-0">The cartographer’s sketch</h2>
              <div className="rounded-lg overflow-hidden bg-[var(--card)]">
                <MindMap nodes={goal.mindMap} height={240} />
              </div>
            </section>
          ) : null}

          <section className="kh-sheet p-5 flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <h2 className="t-h3 m-0">Resources &amp; field pack</h2>
              <span className="t-caption">{plural(goal.resources.length, 'anchor')}</span>
            </div>
            {goal.resources.length === 0 ? <span className="t-caption">No resources were pinned to this mountain.</span> : null}
            {goal.resources.map((r, i) => (
              <div key={`${r.title}-${i}`} className="kh-card p-3.5 flex items-start gap-3 group">
                <span className="w-8 h-8 rounded-md grid place-items-center bg-[var(--docket)] text-ink-3 shrink-0">
                  {r.url ? <ExternalLink size={14} /> : <Search size={14} />}
                </span>
                <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                  <span className="text-[14px] font-semibold leading-5">{r.title}</span>
                  <span className="t-caption [text-wrap:pretty]">{r.note}</span>
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1">
                    <Stamp className="!text-[10px] !py-0">{r.type}</Stamp>
                    {r.url ? (
                      <button className="text-[12.5px] text-laurel hover:underline" onClick={() => void window.api.app.openExternal(r.url!)}>
                        Open the verified page
                      </button>
                    ) : (
                      <span className="text-[12px] text-ink-4">No verified link — search for it</span>
                    )}
                  </span>
                </div>
                <span className="opacity-0 group-hover:opacity-100">
                  <IconBtn title="Remove from the field pack" onClick={() => void run(() => window.api.goals.updatePlan(goal.id, { resources: goal.resources.filter((_, j) => j !== i) }))}>
                    <X size={14} />
                  </IconBtn>
                </span>
              </div>
            ))}
          </section>
        </aside>
      </div>

      <section className="mt-12">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-5">
          <div className="flex flex-col gap-1">
            <span className="t-stamp text-[var(--ochre-deep)]">The ascent &amp; pack ledger</span>
            <h2 className="t-h1 !text-[28px] m-0">What carries you up, and what weighs you down</h2>
          </div>
          <span className="t-italic !text-[13px]">The mountain stays the same. The pack is yours to lighten.</span>
        </div>
        <div className="grid gap-6 min-[1100px]:grid-cols-2">
          <div className="kh-sheet p-6 flex flex-col gap-5">
            <ToolsPanel tools={data.tools} goals={data.goals} goalId={goal.id} title="What carries you upward" />
            {goalHabits.filter((h) => h.active).length ? (
              <div className="flex flex-col gap-2 pt-4 border-t border-[var(--rule)]">
                <span className="t-stamp !text-[10.5px] text-ink-3">Upward rhythms</span>
                {goalHabits
                  .filter((h) => h.active)
                  .map((h) => {
                    const st = data.perf.habits.find((x) => x.habitId === h.id)
                    return (
                      <button key={h.id} className="flex items-center justify-between gap-3 text-left py-1.5" onClick={() => navigate({ name: 'habit', id: h.id })}>
                        <span className="text-[14px]">{h.name}</span>
                        <span className="t-caption">{st ? `${st.completed}/${st.scheduled} this week · ${Math.round(st.completionRate)}%` : describeRecurrence(h.recurrence)}</span>
                      </button>
                    )
                  })}
              </div>
            ) : null}
          </div>
          <div className="kh-sheet p-6 flex flex-col gap-4">
            <div className="flex items-baseline justify-between gap-3">
              <span className="t-h3">What is carried in your backpack</span>
              <Btn kind="ghost" onClick={() => navigate({ name: 'letgo', create: true })}>
                <Plus size={13} /> Add
              </Btn>
            </div>
            {carried.length === 0 ? (
              <span className="t-italic !text-[14px]">Nothing in the backpack is tied to this mountain. If something makes this climb harder, you can name it — without shame.</span>
            ) : (
              carried.map((l) => (
                <button key={l.id} className="kh-card p-4 flex flex-col gap-3 text-left hover:border-[var(--rule)]" onClick={() => navigate({ name: 'letgo', id: l.id })}>
                  <span className="flex items-center justify-between gap-2">
                    <Stamp tone={WEIGHT_TONE[l.weight]} className="!text-[10px]">{l.status === 'left_behind' ? 'Left at the cairn' : WEIGHT_LABEL[l.weight]}</Stamp>
                    <span className="t-caption">
                      {l.stats.daysFree}/{l.stats.daysTracked} days free{l.stats.daysTracked ? ` · ${Math.round(l.stats.freedomRate * 100)}%` : ''}
                    </span>
                  </span>
                  <span className="font-serif text-[20px] leading-6">{l.title}</span>
                  <FreedomDots item={l} />
                  {l.replacement ? <span className="t-caption">Instead: <i className="font-serif text-[13.5px]">{l.replacement}</i></span> : null}
                </button>
              ))
            )}
          </div>
        </div>
        {mountainInsights.length ? (
          <div className="flex flex-col gap-4 mt-6">
            {mountainInsights.map((g) => (
              <GuideCard key={g.key} insight={g} />
            ))}
          </div>
        ) : null}
      </section>

      <footer className="kh-docket mt-10 p-5 flex flex-wrap items-center gap-4">
        <span className="flex flex-col flex-1 min-w-[260px]">
          <span className="text-[14px]">“A mountain is climbed step by step, not by leap.”</span>
          <span className="t-caption">
            On this mountain since {dayMonth(goal.createdAt.slice(0, 10))}
            {goal.closedAt ? ` · closed ${dayMonth(goal.closedAt.slice(0, 10))}` : ''}
          </span>
        </span>
        {closed ? (
          <Btn kind="ruled" onClick={() => void run(() => window.api.goals.reopen(goal.id), 'The ascent is open again — its habits are back in rhythm.')}>
            <RotateCcw size={15} /> Reopen this ascent
          </Btn>
        ) : (
          <>
            <Btn kind="soft" onClick={() => void run(() => window.api.goals.close(goal.id, 'abandoned'), 'Path set aside. Its habits are paused; their history is kept.')}>
              Set this path aside
            </Btn>
            <Btn kind="laurel" onClick={() => void run(() => window.api.goals.close(goal.id, 'achieved'), 'Summit reached. The seal is pressed.')}>
              <Flag size={15} /> Mark the summit reached
            </Btn>
          </>
        )}
        <IconBtn title="Delete this mountain" onClick={() => setConfirmDelete(true)}>
          <Trash2 size={15} />
        </IconBtn>
      </footer>

      {editing ? <WaypointEditor goalId={goal.id} initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} /> : null}

      {confirmDelete ? (
        <Modal onClose={() => setConfirmDelete(false)} label="Delete this mountain" width={480}>
          <div className="p-7 flex flex-col gap-4">
            <h2 className="t-h2 m-0">Delete “{goal.title}”?</h2>
            <p className="m-0 text-ink-2 [text-wrap:pretty]">
              The mountain and its map are removed. Its habits and waypoints stay in your folio with their full history — they simply stop belonging to this mountain.
            </p>
            <div className="flex justify-end gap-3">
              <Btn kind="soft" onClick={() => setConfirmDelete(false)}>
                Keep it
              </Btn>
              <Btn
                kind="danger"
                onClick={() =>
                  void run(async () => {
                    await window.api.goals.remove(goal.id)
                    navigate({ name: 'mountains' })
                  }, 'Mountain deleted. Its habits and history remain.')
                }
              >
                Delete the mountain
              </Btn>
            </div>
          </div>
        </Modal>
      ) : null}
    </Page>
  )
}
