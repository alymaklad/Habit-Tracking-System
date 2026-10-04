import { useState } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight, Compass, Flame, Mountain, SlidersHorizontal, Sprout, TriangleAlert, Wind } from 'lucide-react'
import type { DifficultyProposal, GoalView, Habit, PerformanceView, WeeklyReview } from '@shared/types'
import { useData } from '../hooks/useData'
import { addDays, duration, saturdayOf } from '../lib/format'
import { dayMonth, roman, today } from '../lib/khatwa'
import { useShell } from '../khatwa/nav'
import { Page } from '../khatwa/Page'
import { Alert, Bar, Btn, Dot, Eyebrow, LoadError, Loading, Stamp } from '../khatwa/ui'

type Data = {
  review: WeeklyReview | null
  perf: PerformanceView
  proposals: DifficultyProposal[]
  goals: GoalView[]
  habits: Habit[]
}

const TONES = ['var(--laurel-deep)', 'var(--ochre-deep)', 'var(--slate)', 'var(--laurel)', 'var(--ochre)']

function season(date: string): string {
  const m = Number(date.slice(5, 7))
  if (m <= 2 || m === 12) return 'Winter'
  if (m <= 5) return 'Spring'
  if (m <= 8) return 'Summer'
  return 'Autumn'
}

function Inquiry({ numeral, question, tag, tagTone, lines, empty, icon }: { numeral: string; question: string; tag: string; tagTone: string; lines: string[]; empty: string; icon: React.ReactNode }) {
  return (
    <article className="kh-card kh-tape p-7 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <h3 className="m-0 flex items-center gap-3">
          <span className="w-7 h-7 rounded-full grid place-items-center bg-[var(--docket)] font-serif text-[12px]">{numeral}</span>
          <span className="font-serif text-[21px] font-normal">{question}</span>
        </h3>
        <span className={`t-stamp !text-[10.5px] ${tagTone}`}>{tag}</span>
      </div>
      <div className="kh-docket px-5 py-4 flex flex-col gap-2">
        {lines.length ? (
          lines.map((l, i) => (
            <p key={i} className="m-0 font-serif italic text-[17px] leading-[27px] text-ink-2 [text-wrap:pretty]">
              {l}
            </p>
          ))
        ) : (
          <p className="m-0 t-italic">{empty}</p>
        )}
        <span className="t-caption flex items-center gap-2 mt-1">
          {icon} Read from the week’s record by the cadence engine
        </span>
      </div>
    </article>
  )
}

export default function WeeklyReviewRoute() {
  const { navigate } = useShell()
  const now = today()
  const [anchor, setAnchor] = useState(saturdayOf(now))
  const [error, setError] = useState<string | null>(null)
  const { data, error: loadError, refetch } = useData<Data>(async () => {
    const [review, perf, proposals, goals, habits] = await Promise.all([
      window.api.view.weeklyReview(anchor),
      window.api.view.performance(anchor),
      window.api.view.proposals(),
      window.api.goals.list(),
      window.api.habits.list()
    ])
    return { review, perf, proposals, goals, habits }
  }, [anchor])

  if (loadError) return <Page><LoadError message={loadError} onRetry={refetch} /></Page>
  if (!data) return <Page><Loading label="Opening the week’s ledger…" /></Page>

  const { review, perf } = data
  const inProgress = anchor === saturdayOf(now)
  const weekEnd = addDays(anchor, 6)
  const weekNo = Math.ceil((new Date(`${anchor}T12:00:00`).getTime() - new Date(`${anchor.slice(0, 4)}-01-01T12:00:00`).getTime()) / (7 * 86_400_000)) + 1
  const maxDay = Math.max(1, ...perf.days.map((d) => d.minutes))
  const habitGoal = new Map(data.habits.map((h) => [h.id, h.goalId]))
  const goalTitle = new Map(data.goals.map((g) => [g.id, g.title]))
  const byMountain = new Map<string, number>()
  for (const h of perf.habits) {
    const g = habitGoal.get(h.habitId)
    const key = g !== null && g !== undefined ? (goalTitle.get(g) ?? 'A closed mountain') : 'Personal cultivation'
    byMountain.set(key, (byMountain.get(key) ?? 0) + h.minutes)
  }
  const contributions = [...byMountain.entries()].sort((a, b) => b[1] - a[1])
  const totalContribution = contributions.reduce((s, [, m]) => s + m, 0)
  const pending = data.proposals.filter((p) => p.state === 'pending')

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  const weekday = (date: string): string => new Date(`${date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'long' })
  const change = review?.improvementPercentage ?? null
  const went: string[] = []
  if (review && change !== null && change > 0) went.push(`Time on the trail rose ${Math.round(change)}%, from ${duration(review.previousMinutes)} to ${duration(review.totalMinutes)}.`)
  if (review?.bestHabit && review.bestHabit.completionRate > 0) went.push(`${review.bestHabit.name} held a ${Math.round(review.bestHabit.completionRate)}% cadence — the steadiest rhythm of the week.`)
  if (perf.bestDay && perf.bestDay.points > 0) went.push(`${weekday(perf.bestDay.date)} was the strongest day: ${perf.bestDay.completed} of ${perf.bestDay.scheduled} steps, ${perf.bestDay.points} points.`)
  const hard: string[] = []
  if (review && change !== null && change < 0) hard.push(`Time on the trail fell ${Math.round(-change)}%, from ${duration(review.previousMinutes)} to ${duration(review.totalMinutes)}.`)
  if (review && review.totalMinutes === 0 && review.tasksScheduled > 0) hard.push(`No time was logged against ${review.tasksScheduled} scheduled steps.`)
  if (review?.weakestHabit && review.weakestHabit.completionRate < 70 && review.weakestHabit.name !== review.bestHabit?.name)
    hard.push(`${review.weakestHabit.name} slipped to ${Math.round(review.weakestHabit.completionRate)}% — the rhythm most in need of care.`)
  if (perf.worstDay && perf.worstDay.scheduled > 0 && perf.worstDay.date !== perf.bestDay?.date)
    hard.push(`${weekday(perf.worstDay.date)} was the heaviest day: ${perf.worstDay.completed} of ${perf.worstDay.scheduled} steps kept.`)

  return (
    <Page>
      <header className="flex flex-wrap items-start justify-between gap-8 mb-9">
        <div className="flex flex-col gap-3 max-w-[720px]">
          <Eyebrow>
            <Dot /> Folio N° {weekNo} · {season(anchor)} ledger <span className="is-quiet">/ {inProgress ? 'Week in progress' : 'Archival entry'}</span>
          </Eyebrow>
          <h1 className="t-hero !text-[44px] !leading-[52px] m-0">
            Weekly Field Review · <em className="text-ink-3">Week {weekNo}</em>
          </h1>
          <p className="t-italic !text-[17px] m-0">“A deliberate pause before setting the next week’s steps.”</p>
        </div>
        <div className="flex items-center gap-4">
          <span className={`w-[86px] h-[86px] rounded-xl grid place-items-center text-center -rotate-3 ${inProgress ? 'bg-[var(--docket)]' : 'bg-[var(--ochre-wash)] ring-1 ring-[var(--ochre-tint)]'}`}>
            <span className="flex flex-col leading-tight">
              <span className="t-stamp !text-[10px] text-[var(--ochre-deep)]">{inProgress ? 'Open' : 'Closed'}</span>
              <span className="font-serif text-[28px]">{weekNo}</span>
              <span className="t-stamp !text-[9.5px] text-ink-4">{roman(Number(anchor.slice(5, 7)))} · {anchor.slice(0, 4)}</span>
            </span>
          </span>
          <span className="flex flex-col gap-1">
            <span className="text-[15px] font-semibold">
              {dayMonth(anchor)} – {dayMonth(weekEnd)}
            </span>
            <span className="t-caption">Saturday to Friday</span>
            <span className="flex gap-1 mt-1">
              <button className="kh-icon-btn !w-8 !h-8 !bg-[var(--docket)]" aria-label="Previous week" onClick={() => setAnchor(addDays(anchor, -7))}>
                <ChevronLeft size={15} />
              </button>
              <button className="kh-icon-btn !w-8 !h-8 !bg-[var(--docket)]" aria-label="Next week" disabled={inProgress} onClick={() => setAnchor(addDays(anchor, 7))}>
                <ChevronRight size={15} />
              </button>
            </span>
          </span>
        </div>
      </header>

      {error ? <div className="mb-6"><Alert>{error}</Alert></div> : null}

      {!review ? (
        <div className="kh-empty mb-10">
          <span className="t-h2 text-ink">Nothing was recorded this week.</span>
          <span>Once habits are scheduled and kept, the week’s ledger fills itself.</span>
        </div>
      ) : (
        <>
          <div className="grid gap-5 mb-10 min-[1050px]:grid-cols-3">
            <section className="kh-sheet p-6 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <span className="t-stamp text-ink-2">01 / Intentional duration</span>
                {review.improvementPercentage !== null ? (
                  <Stamp tone={review.improvementPercentage >= 0 ? 'ochre-solid' : 'plain'} className="!text-[10.5px]">
                    {review.improvementPercentage >= 0 ? '+' : ''}
                    {Math.round(review.improvementPercentage)}% vs prev
                  </Stamp>
                ) : null}
              </div>
              <span className="font-serif text-[46px] leading-[52px] text-[var(--laurel-deep)] t-num">{duration(review.totalMinutes)}</span>
              <span className="t-caption !text-[13px]">Prior week logged {duration(review.previousMinutes)} across your rhythms.</span>
              <div className="flex items-end gap-2 h-[70px] mt-auto">
                {perf.days.map((d) => (
                  <span key={d.date} className="flex-1 flex flex-col items-center gap-1.5" title={`${d.date}: ${duration(d.minutes)}`}>
                    <span
                      className="w-full rounded-[3px]"
                      style={{
                        height: `${Math.max(4, (d.minutes / maxDay) * 48)}px`,
                        background: d.date === now ? 'var(--ochre-deep)' : d.minutes > 0 ? 'var(--laurel-deep)' : 'var(--docket)'
                      }}
                    />
                    <span className="t-stamp !text-[9.5px] text-ink-4">{new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</span>
                  </span>
                ))}
              </div>
            </section>

            <section className="kh-sheet p-6 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <span className="t-stamp text-ink-2">02 / Trail completion</span>
                <span className="t-italic !text-[13px]">
                  {review.tasksCompleted} of {review.tasksScheduled} steps
                </span>
              </div>
              <span className="font-serif text-[46px] leading-[52px] t-num">
                {Math.round(review.consistency)}%<span className="font-sans text-[18px] text-laurel ml-1">yield</span>
              </span>
              <span className="t-caption !text-[13px]">
                {review.points} points and {review.xp} XP pressed into the week.
              </span>
              <div className="mt-auto flex flex-col gap-3">
                <Bar value={review.consistency / 100} />
                <div className="flex justify-between items-center text-[13px]">
                  <span className="flex items-center gap-2">
                    <Flame size={14} className="text-[var(--ochre-deep)]" /> Longest stride
                  </span>
                  <span className="font-serif text-[var(--ochre-deep)]">{review.streak}-day rhythm</span>
                </div>
              </div>
            </section>

            <section className="kh-sheet p-6 flex flex-col gap-4">
              <div className="flex items-start justify-between gap-3">
                <span className="t-stamp text-ink-2">03 / Mountain contribution</span>
                <Mountain size={16} className="text-ink-4" />
              </div>
              <span className="t-italic !text-[13px]">Elevation breakdown</span>
              {contributions.length === 0 ? <span className="t-caption">No time was logged against any rhythm.</span> : null}
              <div className="flex flex-col gap-3">
                {contributions.map(([name, minutes], i) => (
                  <div key={name} className="flex flex-col gap-1.5">
                    <div className="flex justify-between gap-3 text-[13.5px]">
                      <span className="flex items-center gap-2 min-w-0">
                        <span className="w-2 h-2 rounded-full shrink-0" style={{ background: TONES[i % TONES.length] }} />
                        <span className="truncate">{name}</span>
                      </span>
                      <span className="font-serif text-[13px] text-[var(--ochre-deep)] shrink-0">
                        {duration(minutes)} ({totalContribution ? Math.round((minutes / totalContribution) * 100) : 0}%)
                      </span>
                    </div>
                    <div className="kh-bar is-thin">
                      <span style={{ width: `${totalContribution ? (minutes / totalContribution) * 100 : 0}%`, background: TONES[i % TONES.length] }} />
                    </div>
                  </div>
                ))}
              </div>
              <span className="t-italic !text-[12.5px] mt-auto text-right">Total tracked: {duration(totalContribution)}</span>
            </section>
          </div>

          <section className="kh-card p-6 mb-10 flex flex-wrap items-center gap-8">
            <div className="flex flex-col gap-1 min-w-[220px]">
              <span className="t-stamp text-ink-3">League ledger</span>
              <span className="font-serif text-[30px] leading-9 t-num">
                {perf.totalPoints}
                <span className="text-[16px] text-ink-4">{perf.weeklyTarget ? ` / ${perf.weeklyTarget} points` : ' points'}</span>
              </span>
              <span className="t-caption">
                {perf.basePoints} from the days · {perf.bonusPoints} in weekly bonuses
                {perf.pointsDelta !== null ? ` · ${perf.pointsDelta >= 0 ? '+' : ''}${Math.round(perf.pointsDelta)}% on last week` : ''}
              </span>
            </div>
            <div className="flex-1 min-w-[260px] flex flex-col gap-2">
              {perf.weeklyTarget ? (
                <>
                  <Bar value={perf.targetProgress} tone={perf.targetMet ? 'laurel' : 'ochre'} />
                  <span className="t-caption">
                    {perf.targetMet ? 'Target met — the bonus is pressed in.' : `${perf.pointsToTarget} points still to reach the week’s target.`}
                    {perf.targetStreak > 0 ? ` ${perf.targetStreak} weeks in a row on target.` : ''}
                  </span>
                </>
              ) : (
                <span className="t-caption">
                  No weekly points target is set. A target of about {perf.suggestedTarget} would mean every scheduled step kept —{' '}
                  <button className="underline" onClick={() => navigate({ name: 'settings' })}>
                    set one in Settings
                  </button>
                  .
                </span>
              )}
            </div>
            {perf.recentWeeks.length ? (
              <div className="flex items-end gap-1.5" aria-label="Recent weeks against the target">
                {perf.recentWeeks.map((w) => (
                  <span
                    key={w.weekStart}
                    title={`${w.weekLabel}: ${w.points}${w.target ? ` / ${w.target}` : ''}`}
                    className="w-4 h-4 rounded-full"
                    style={{ background: w.inProgress ? 'var(--ochre-tint)' : w.met ? 'var(--laurel-deep)' : 'var(--docket)', border: w.met || w.inProgress ? 'none' : '1px solid var(--rule)' }}
                  />
                ))}
              </div>
            ) : null}
          </section>

          <div className="flex items-end justify-between gap-4 mb-5">
            <div className="flex flex-col gap-1">
              <span className="t-stamp text-ink-3">Qualitative audit</span>
              <h2 className="t-h1 !text-[28px] m-0">The Three Inquiries</h2>
            </div>
            <span className="t-italic !text-[13px]">Preserve honest ink over polished fiction</span>
          </div>
          <div className="flex flex-col gap-6 mb-10">
            <Inquiry
              numeral="I"
              question="What went well this cycle?"
              tag="Morning momentum"
              tagTone="text-ink-3"
              lines={went}
              empty="No rhythm stood out yet this week."
              icon={<Sprout size={13} />}
            />
            <Inquiry
              numeral="II"
              question="What was difficult or heavy?"
              tag="Energy misalignment"
              tagTone="text-[var(--ochre-deep)]"
              lines={hard}
              empty="Nothing weighed heavily — or nothing has been recorded yet."
              icon={<TriangleAlert size={13} />}
            />
            <Inquiry
              numeral="III"
              question="What concrete change will I commit to next week?"
              tag="Adjustment"
              tagTone="text-ink-3"
              lines={review.recommendations}
              empty="Keep the current cadence — no change is called for."
              icon={<Wind size={13} />}
            />
          </div>
        </>
      )}

      {pending.map((p) => (
        <section key={p.id} className="kh-docket p-6 mb-6 flex flex-wrap items-center gap-6">
          <div className="flex flex-col gap-2 flex-1 min-w-[320px]">
            <span className="t-stamp text-ink-3 flex items-center gap-2">
              <SlidersHorizontal size={14} /> Observed rhythm pattern
            </span>
            <span className="text-[19px] font-semibold [text-wrap:balance]">
              {p.habitName} holds a {Math.round(p.completionRate)}% cadence.
            </span>
            <span className="text-[14.5px] text-ink-2 [text-wrap:pretty]">
              {p.rationale} Would you like to {p.proposedTarget > p.currentTarget ? 'gently expand' : 'ease'} the session from <b>{duration(p.currentTarget)} → {duration(p.proposedTarget)}</b>, or keep the steady current rhythm?
            </span>
          </div>
          <div className="flex gap-3">
            <Btn kind="soft" onClick={() => void act(() => window.api.proposal.reject(p.id))}>
              Keep {duration(p.currentTarget)}
            </Btn>
            <Btn kind="laurel" onClick={() => void act(() => window.api.proposal.accept(p.id))}>
              {p.proposedTarget > p.currentTarget ? 'Expand' : 'Ease'} to {duration(p.proposedTarget)}
            </Btn>
          </div>
        </section>
      ))}

      <footer className="flex flex-wrap items-center justify-between gap-4 pt-4 border-t border-[var(--rule)]">
        <span className="t-italic !text-[13px] flex items-center gap-2">
          <Compass size={14} /> The ledger is recomputed from the record — a late tick still counts, honestly.
        </span>
        <Btn kind="ochre" onClick={() => navigate({ name: 'journey' })}>
          Open the Journey board <ArrowRight size={15} />
        </Btn>
      </footer>
    </Page>
  )
}
