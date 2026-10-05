import { useState } from 'react'
import { ArrowRight, Compass, Flag, Mountain, Plus, Save } from 'lucide-react'
import type { GoalView, PerformanceView } from '@shared/types'
import emblem from '../assets/emblem-large.png'
import { useData } from '../hooks/useData'
import { currentMilestone, dayMonth, daysBetween, goalProgress, monthYear, plural, today } from '../lib/khatwa'
import { TrailMap, type TrailObstacle, type Waypoint } from '../khatwa/charts'
import { useShell } from '../khatwa/nav'
import { Page } from '../khatwa/Page'
import { Bar, Btn, Dot, Eyebrow, LoadError, Loading, Stamp } from '../khatwa/ui'

/** Obstacles placed on their stretch of the drawn trail; one guarding a vanished waypoint moves to the summit climb. */
export function obstaclesOf(goal: GoalView): TrailObstacle[] {
  const live = goal.milestones.filter((m) => !m.dropped).sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'))
  return goal.obstacles.map((o) => {
    const idx = o.nearMilestoneId === null ? -1 : live.findIndex((m) => m.id === o.nearMilestoneId)
    return { key: o.id, title: o.title, note: o.note, passed: o.passed, segment: idx === -1 ? live.length : idx }
  })
}

export function waypointsOf(goal: GoalView): Waypoint[] {
  const live = goal.milestones.filter((m) => !m.dropped).sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999'))
  const current = currentMilestone(goal)
  return live.map((m) => ({
    key: m.id,
    title: m.title,
    caption: m.date ? dayMonth(m.date) : undefined,
    state: m.done ? 'done' : m.id === current?.id ? 'current' : 'upcoming'
  }))
}

function Primary({ goal, perf, index }: { goal: GoalView; perf: PerformanceView | null; index: number }) {
  const { navigate } = useShell()
  const now = today()
  const onMountain = Math.max(0, daysBetween(goal.createdAt.slice(0, 10), now))
  const step = currentMilestone(goal)
  const progress = goalProgress(goal)
  const byHabit = new Map((perf?.habits ?? []).map((h) => [h.habitId, h]))

  return (
    <div className="grid gap-6 min-[1150px]:grid-cols-[minmax(0,1fr)_320px]">
      <section className="kh-sheet p-7 min-w-0 flex flex-col gap-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <Stamp tone="laurel">Main mountain</Stamp>
              <span className="text-[13px] text-ink-4">Mountain {index + 1}</span>
            </div>
            <h2 className="t-hero !text-[44px] !leading-[52px] m-0 [text-wrap:balance]">{goal.title}</h2>
            {goal.description ? <p className="font-serif text-[17px] leading-[27px] text-ink-2 m-0 max-w-[620px] [text-wrap:pretty]">“{goal.description}”</p> : null}
          </div>
          <div className="kh-card px-4 py-3 flex flex-col gap-2 min-w-[190px]">
            <span className="t-stamp !text-[10.5px] text-ink-4">Milestones</span>
            <span className="text-[14px]">
              {goal.milestonesDone} cleared · {goal.milestonesTotal - goal.milestonesDone} ahead
            </span>
            <div className="flex gap-1">
              {goal.milestones
                .filter((m) => !m.dropped)
                .map((m) => (
                  <span key={m.id} className="h-1.5 flex-1 rounded-full" style={{ background: m.done ? 'var(--laurel)' : m.id === step?.id ? 'var(--ochre)' : 'var(--rule)' }} />
                ))}
            </div>
          </div>
        </div>
        {goal.milestones.length > 0 ? (
          <TrailMap
            waypoints={waypointsOf(goal)}
            obstacles={obstaclesOf(goal)}
            summit={goal.title}
            summitCaption={goal.targetDate ? `Target ${monthYear(goal.targetDate)}` : undefined}
            height={440}
            compact={goal.milestones.length > 6}
          />
        ) : (
          <div className="kh-empty">This mountain has no milestones yet. Open it to add some.</div>
        )}
      </section>

      <aside className="flex flex-col gap-5 min-w-0">
        <div className="kh-sheet p-6 flex flex-col gap-5">
          <div className="flex items-start justify-between gap-3">
            <span className="t-stamp text-[var(--ochre-deep)]">Active mountain</span>
            {goal.targetDate ? (
              <span className="text-right">
                <span className="t-stamp text-ink-4 block">Target</span>
                <span className="text-[14px]">{monthYear(goal.targetDate)}</span>
              </span>
            ) : null}
          </div>
          <h3 className="font-serif text-[26px] leading-[32px] m-0 [text-wrap:balance]">{goal.title}</h3>
          <hr className="kh-rule" />
          <div className="flex items-baseline justify-between">
            <span className="text-[13px] text-ink-3">Progress</span>
            <span className="font-serif text-[22px] text-laurel t-num">{Math.round(progress * 100)}% done</span>
          </div>
          <Bar value={progress} />
          <div className="grid grid-cols-2 gap-3 t-caption !text-[12.5px]">
            <span>{plural(onMountain, 'day')} on the mountain</span>
            <span className="text-right">{goal.daysToTarget === null ? 'No end date' : goal.daysToTarget >= 0 ? `${plural(goal.daysToTarget, 'day')} to target` : `${plural(-goal.daysToTarget, 'day')} past target`}</span>
          </div>

          <div className="kh-card p-4 flex flex-col gap-2">
            <span className="flex items-center gap-2 t-stamp text-[var(--ochre-deep)]">
              <Dot /> Current step
            </span>
            {step ? (
              <>
                <span className="text-[14.5px] font-semibold leading-[21px] [text-wrap:pretty]">{step.title}</span>
                {step.date ? (
                  <span className="t-caption">
                    Due {dayMonth(step.date)} · {daysBetween(now, step.date) >= 0 ? `in ${plural(daysBetween(now, step.date), 'day')}` : `${plural(-daysBetween(now, step.date), 'day')} overdue`}
                  </span>
                ) : null}
              </>
            ) : (
              <span className="text-[14px] text-ink-3">Every milestone is reached. Mark the goal reached when you get there.</span>
            )}
          </div>

          <div className="flex flex-col gap-3">
            <div className="flex items-baseline justify-between">
              <span className="t-stamp text-ink-3">Contributing daily habits</span>
              <span className="t-caption">{goal.habits.filter((h) => h.active).length} active</span>
            </div>
            {goal.habits.length === 0 ? <span className="t-caption">No habits are tied to this mountain.</span> : null}
            {goal.habits.map((h) => {
              const week = byHabit.get(h.id)
              return (
                <button key={h.id} className="kh-card p-3.5 flex items-center gap-3 text-left hover:border-[var(--rule)]" onClick={() => navigate({ name: 'habits', edit: h.id })}>
                  <span className="w-8 h-8 rounded-lg grid place-items-center bg-[var(--laurel-wash)] text-laurel shrink-0">
                    <Compass size={15} />
                  </span>
                  <span className="flex flex-col flex-1 min-w-0">
                    <span className={`text-[13.5px] font-semibold truncate ${h.active ? '' : 'text-ink-4'}`}>{h.name}</span>
                    <span className="t-caption">{h.active ? (h.streak > 0 ? `${h.streak}-day streak` : 'Streak not yet begun') : 'Paused'}</span>
                  </span>
                  {week ? (
                    <span className="font-serif text-[16px] t-num text-[var(--ochre-deep)]">
                      {week.completed}/{week.scheduled}
                    </span>
                  ) : null}
                </button>
              )
            })}
          </div>

          <Btn kind="laurel" size="lg" onClick={() => navigate({ name: 'mountain', id: goal.id })}>
            Open mountain trail detail <ArrowRight size={16} />
          </Btn>
        </div>
      </aside>
    </div>
  )
}

export default function Mountains() {
  const { navigate } = useShell()
  const [picked, setPicked] = useState<number | null>(null)
  const { data, error, refetch } = useData(async () => {
    const [goals, perf, draft] = await Promise.all([window.api.goals.list(), window.api.view.performance(), window.api.goals.draft()])
    return { goals, perf, draft }
  }, [])

  if (error) return <Page><LoadError message={error} onRetry={refetch} /></Page>
  if (!data) return <Page><Loading label="Loading your mountains…" /></Page>

  const active = data.goals.filter((g) => g.status === 'active')
  const closed = data.goals.filter((g) => g.status !== 'active')
  const primary = active.find((g) => g.id === picked) ?? active[0] ?? null
  const others = active.filter((g) => g.id !== primary?.id)

  return (
    <Page>
      <header className="flex flex-wrap items-center gap-x-8 gap-y-4 mb-9">
        <div className="flex items-end gap-4">
          <h1 className="t-hero m-0">The Mountains</h1>
          <span className="t-italic pb-1.5">Where am I going?</span>
        </div>
        <div className="ml-auto">
          <Btn kind="ochre" onClick={() => navigate({ name: 'expedition' })}>
            <Plus size={16} /> Choose a new mountain
          </Btn>
        </div>
      </header>

      {data.draft ? (
        <section className="kh-docket mb-8 px-6 py-5 flex flex-wrap items-center gap-5">
          <Save size={20} className="text-ink-3" />
          <div className="flex flex-col flex-1 min-w-[260px]">
            <span className="font-serif text-[20px] leading-7">{data.draft.title || 'An unnamed mountain'}</span>
            <span className="text-[13.5px] text-ink-3">
              Set aside on {dayMonth(data.draft.savedAt.slice(0, 10))}
              {data.draft.plan ? ` with a plan: ${plural(data.draft.plan.milestones.length, 'milestone')}, ${plural(data.draft.plan.sessions.length, 'habit')}.` : ', before the trail was drawn.'}
            </span>
          </div>
          <Btn kind="laurel" onClick={() => navigate({ name: 'expedition', resume: true })}>
            Continue the draft
          </Btn>
          <Btn kind="ghost" onClick={() => void window.api.goals.saveDraft(null)}>
            Discard it
          </Btn>
        </section>
      ) : null}

      {primary ? (
        <Primary goal={primary} perf={data.perf} index={data.goals.indexOf(primary)} />
      ) : (
        <section className="kh-sheet p-10 grid gap-8 items-center min-[900px]:grid-cols-[260px_1fr]">
          <img src={emblem} alt="" className="w-[240px] h-[240px] rounded-full object-cover mix-blend-multiply dark:mix-blend-normal mx-auto" />
          <div className="flex flex-col gap-4 items-start">
            <Eyebrow>No mountain yet</Eyebrow>
            <h2 className="t-h1 m-0">Every journey begins with a step.</h2>
            <p className="t-italic m-0 [text-wrap:pretty]">
              Name a big goal. The AI planner looks into it, suggests milestones and habits that fit around the ones you already have, and lets you change everything before it is saved.
            </p>
            <Btn kind="ochre" size="lg" onClick={() => navigate({ name: 'expedition' })}>
              Choose your first mountain <ArrowRight size={16} />
            </Btn>
          </div>
        </section>
      )}

      {others.length > 0 ? (
        <section className="mt-12">
          <h2 className="t-h2 mb-4">Your other mountains</h2>
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(280px,1fr))]">
            {others.map((g) => (
              <button key={g.id} className="kh-card p-5 text-left flex flex-col gap-3 hover:border-[var(--rule)]" onClick={() => setPicked(g.id)}>
                <div className="flex items-center justify-between">
                  <Stamp className="!text-[10.5px]">
                    <Mountain size={12} /> Mountain
                  </Stamp>
                  {g.targetDate ? <span className="t-caption">{monthYear(g.targetDate)}</span> : null}
                </div>
                <span className="font-serif text-[20px] leading-7 [text-wrap:balance]">{g.title}</span>
                <Bar value={goalProgress(g)} thin />
                <span className="t-caption">
                  {g.milestonesDone} of {g.milestonesTotal} milestones · {plural(g.habits.filter((h) => h.active).length, 'habit')}
                </span>
              </button>
            ))}
          </div>
        </section>
      ) : null}

      {active.length > 0 ? (
        <section className="mt-10 kh-docket p-6 flex items-center gap-5">
          <span className="w-12 h-12 rounded-xl grid place-items-center bg-[var(--ochre-deep)] text-[var(--on-solid)] relative shrink-0">
            <Mountain size={20} />
            <span className="absolute -right-1.5 -bottom-1.5 w-5 h-5 rounded-full bg-[var(--laurel-deep)] text-[var(--on-solid)] text-[11px] grid place-items-center">{active.length}</span>
          </span>
          <div className="flex flex-col gap-1">
            <span className="t-stamp text-[var(--ochre-deep)]">Keep it to a few</span>
            <span className="text-[14.5px] text-ink-2 [text-wrap:pretty]">
              Most people can work on three or four big goals at once. You are climbing {plural(active.length, 'mountain')}
              {active.length > 4 ? '. Think about pausing one, so the others get your best time.' : '.'}
            </span>
          </div>
        </section>
      ) : null}

      {closed.length > 0 ? (
        <section className="mt-12">
          <h2 className="t-h2 mb-4">Summits reached &amp; paths set aside</h2>
          <div className="flex flex-col gap-2">
            {closed.map((g) => (
              <button key={g.id} className="kh-row text-left" onClick={() => navigate({ name: 'mountain', id: g.id })}>
                <Flag size={16} className={g.status === 'achieved' ? 'text-laurel' : 'text-ink-4'} />
                <span className="flex-1 font-serif text-[17px]">{g.title}</span>
                <Stamp tone={g.status === 'achieved' ? 'laurel' : 'plain'}>{g.status === 'achieved' ? 'Summit reached' : 'Set aside'}</Stamp>
                {g.closedAt ? <span className="t-caption w-24 text-right">{dayMonth(g.closedAt.slice(0, 10))}</span> : null}
              </button>
            ))}
          </div>
        </section>
      ) : null}
    </Page>
  )
}
