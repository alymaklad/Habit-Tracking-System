import { useState } from 'react'
import { ChevronLeft, ChevronRight, TrendingDown, TrendingUp } from 'lucide-react'
import type { PerformanceView, ProgressView } from '@shared/types'
import { useData } from '../hooks/useData'
import { addDays, duration, saturdayOf } from '../lib/format'
import { dayMonth, today } from '../lib/khatwa'
import { InkLine } from '../khatwa/charts'
import { useShell } from '../khatwa/nav'
import { Page, PageHead } from '../khatwa/Page'
import { Bar, Dot, IconBtn, LoadError, Loading, Ring, Stamp } from '../khatwa/ui'

function Trend({ title, series, format, note }: { title: string; series: { label: string; value: number }[]; format: (v: number) => string; note?: string }) {
  const last = series[series.length - 1]?.value ?? 0
  return (
    <section className="kh-sheet p-5 flex flex-col gap-2 min-w-0">
      <div className="flex items-baseline justify-between gap-3">
        <span className="t-stamp !text-[10.5px] text-ink-3">{title}</span>
        <span className="font-serif text-[22px] t-num">{format(last)}</span>
      </div>
      {series.length > 1 ? <InkLine values={series.map((p) => p.value)} labels={series.map((p) => `Week of the ${p.label}`)} format={format} height={96} mark={series.length - 1} /> : <span className="t-italic !text-[14px] py-6">Two weeks of record are needed for a line.</span>}
      {note ? <span className="t-caption">{note}</span> : null}
    </section>
  )
}

export default function Progress() {
  const { navigate } = useShell()
  const [anchor, setAnchor] = useState(saturdayOf(today()))
  const { data, error, refetch } = useData<{ progress: ProgressView; perf: PerformanceView }>(async () => {
    const [progress, perf] = await Promise.all([window.api.view.progress(8), window.api.view.performance(anchor)])
    return { progress, perf }
  }, [anchor])

  if (error) return <Page><LoadError message={error} onRetry={refetch} /></Page>
  if (!data) return <Page><Loading label="Drawing the trend lines…" /></Page>

  const { progress: p, perf } = data
  const inProgress = anchor === saturdayOf(today())
  const maxDay = Math.max(1, ...perf.days.map((d) => d.points))

  return (
    <Page>
      <PageHead
        eyebrow={
          <>
            Progress <Dot /> <span className="is-quiet">Eight weeks of trends · the week’s league ledger</span>
          </>
        }
        title="Progress & Performance"
        lede="Simple lines, honestly drawn. Assumed minutes — ticked in Google without a timer — are counted at target and badged where they appear."
      />

      <div className="grid gap-4 mb-10 grid-cols-[repeat(auto-fit,minmax(250px,1fr))]">
        <Trend title="Hours per week" series={p.hoursPerWeek} format={(v) => `${v}h`} note={p.improvementPercentage !== null ? `${p.improvementPercentage >= 0 ? '+' : ''}${Math.round(p.improvementPercentage)}% on the week before · ${p.totalHours}h in all` : `${p.totalHours}h in all`} />
        <Trend title="Completion rate" series={p.completionPerWeek} format={(v) => `${Math.round(v)}%`} />
        <Trend title="Points per week" series={p.pointsPerWeek} format={(v) => String(v)} />
        <Trend title="Average difficulty" series={p.difficultySeries} format={(v) => `T${v.toFixed(1)}`} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-4 mb-5">
        <div className="flex flex-col gap-1">
          <span className="t-stamp text-ink-3">League ledger</span>
          <h2 className="t-h1 !text-[28px] m-0">{perf.weekLabel}</h2>
        </div>
        <span className="flex items-center gap-2">
          {inProgress ? <Stamp tone="ochre">In progress</Stamp> : null}
          <IconBtn title="Previous week" onClick={() => setAnchor(addDays(anchor, -7))}>
            <ChevronLeft size={16} />
          </IconBtn>
          <IconBtn title="Next week" disabled={inProgress} onClick={() => setAnchor(addDays(anchor, 7))}>
            <ChevronRight size={16} />
          </IconBtn>
        </span>
      </div>

      <div className="grid gap-5 mb-8 min-[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
        <section className="kh-card p-6 flex items-center gap-6">
          <Ring value={perf.weeklyTarget ? perf.targetProgress : 0} size={104} stroke={6} tone={perf.targetMet ? 'laurel' : 'ochre'}>
            <span className="font-serif text-[22px] t-num">{perf.totalPoints}</span>
          </Ring>
          <div className="flex flex-col gap-1.5 min-w-0">
            <span className="text-[17px] font-semibold">{perf.weeklyTarget ? `${perf.totalPoints} of ${perf.weeklyTarget} points` : `${perf.totalPoints} points`}</span>
            <span className="t-caption !text-[13px]">
              {perf.basePoints} from the days · {perf.bonusPoints} in bonuses
              {perf.pointsDelta !== null ? ` · ${perf.pointsDelta >= 0 ? '+' : ''}${Math.round(perf.pointsDelta)}% on last week` : ''}
            </span>
            <span className="t-caption !text-[13px]">
              {perf.weeklyTarget
                ? perf.targetMet
                  ? 'Target met.'
                  : `${perf.pointsToTarget} points still to reach the target.`
                : `No target set — about ${perf.suggestedTarget} would mean every scheduled step kept.`}
              {perf.targetStreak ? ` ${perf.targetStreak} weeks in a row on target.` : ''}
            </span>
            <span className="flex gap-1.5 mt-1" aria-label="Recent weeks against the target">
              {perf.recentWeeks.map((w) => (
                <span
                  key={w.weekStart}
                  title={`${w.weekLabel}: ${w.points}${w.target ? ` / ${w.target}` : ''}${w.inProgress ? ' (in progress)' : w.met ? ' — met' : ''}`}
                  className="w-5 h-5 rounded-full grid place-items-center text-[9px]"
                  style={{ background: w.inProgress ? 'var(--ochre-tint)' : w.met ? 'var(--laurel-deep)' : 'var(--docket)', color: w.met ? 'var(--on-solid)' : 'var(--ink-4)' }}
                >
                  {w.met ? '✓' : w.inProgress ? '·' : ''}
                </span>
              ))}
            </span>
          </div>
        </section>

        <section className="kh-sheet p-6">
          <span className="t-stamp !text-[10.5px] text-ink-3">Day by day</span>
          <div className="grid grid-cols-7 gap-2 mt-4 items-end">
            {perf.days.map((d) => (
              <div key={d.date} className="flex flex-col items-center gap-1.5" title={`${d.date}: ${d.points} points, ${d.completed}/${d.scheduled} steps, ${duration(d.minutes)}`}>
                <span className="text-[11px] t-num" style={{ color: d.delta === null ? 'var(--ink-4)' : d.delta >= 0 ? 'var(--laurel)' : 'var(--ochre-deep)' }}>
                  {d.delta === null ? '' : `${d.delta >= 0 ? '+' : ''}${d.delta}`}
                </span>
                <span className="w-full rounded-[3px]" style={{ height: `${Math.max(4, (Math.max(0, d.points) / maxDay) * 90)}px`, background: d.date === perf.bestDay?.date ? 'var(--laurel-deep)' : d.date === perf.worstDay?.date ? 'var(--ochre-tint)' : d.points > 0 ? 'var(--laurel)' : 'var(--docket)' }} />
                <span className="font-serif text-[15px] t-num">{d.points}</span>
                <span className="t-stamp !text-[9.5px] text-ink-4">{new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short' })}</span>
              </div>
            ))}
          </div>
          <div className="flex flex-wrap gap-5 mt-4 t-caption !text-[12.5px]">
            {perf.bestDay && perf.bestDay.points > 0 ? <span>Best day: {dayMonth(perf.bestDay.date)} · {perf.bestDay.points} pts</span> : null}
            {perf.worstDay && perf.worstDay.date !== perf.bestDay?.date && perf.worstDay.scheduled > 0 ? <span>Weakest day: {dayMonth(perf.worstDay.date)} · {perf.worstDay.points} pts</span> : null}
          </div>
        </section>
      </div>

      <div className="grid gap-5 min-[1100px]:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
        <section className="kh-card p-6">
          <span className="t-stamp !text-[10.5px] text-ink-3">Habits ranked by completion</span>
          {perf.habits.length === 0 ? <p className="t-italic mt-3">Nothing was scheduled this week.</p> : null}
          <div className="flex flex-col mt-3 divide-y divide-[var(--rule)]">
            {perf.habits.map((h, i) => (
              <button key={h.habitId} className="flex items-center gap-4 py-3 text-left hover:bg-[var(--sheet)] px-1" onClick={() => navigate({ name: 'habit', id: h.habitId })}>
                <span className="font-serif text-[14px] text-ink-4 w-5">{i + 1}</span>
                <span className="flex flex-col flex-1 min-w-0">
                  <span className="text-[14.5px] font-semibold truncate">{h.name}</span>
                  <span className="t-caption">
                    {h.completed}/{h.scheduled} kept · {duration(h.minutes)} · {h.points} pts
                  </span>
                </span>
                <span className="w-28">
                  <Bar value={h.completionRate / 100} thin />
                </span>
                <span className="w-12 text-right font-serif t-num">{Math.round(h.completionRate)}%</span>
                <span className="w-16 text-right text-[12px] flex items-center justify-end gap-1" style={{ color: h.trend === null ? 'var(--ink-4)' : h.trend >= 0 ? 'var(--laurel)' : 'var(--ochre-deep)' }}>
                  {h.trend === null ? '—' : h.trend >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                  {h.trend === null ? '' : `${h.trend >= 0 ? '+' : ''}${Math.round(h.trend)}`}
                </span>
              </button>
            ))}
          </div>
        </section>

        <section className="kh-sheet p-6">
          <div className="flex items-baseline justify-between">
            <span className="t-stamp !text-[10.5px] text-ink-3">Month in points</span>
            <span className="t-caption">{perf.monthPoints} points</span>
          </div>
          <div className="grid grid-cols-7 gap-1.5 mt-4">
            {perf.monthGrid.slice(0, 7).map((d) => (
              <span key={d.date} className="t-stamp !text-[9.5px] text-ink-4 text-center">
                {new Date(`${d.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'narrow' })}
              </span>
            ))}
            {perf.monthGrid.map((d) => {
              const v = perf.peakDayPoints ? Math.max(0, d.points) / perf.peakDayPoints : 0
              return (
                <span
                  key={d.date}
                  title={`${d.date}: ${d.points} points`}
                  className="aspect-square rounded-[4px] grid place-items-center text-[10px] t-num"
                  style={{ background: d.points > 0 ? `color-mix(in srgb, var(--laurel-deep) ${Math.round(20 + v * 80)}%, var(--sheet))` : 'var(--docket)', color: v > 0.5 ? 'var(--on-solid)' : 'var(--ink-4)', opacity: d.inPeriod ? 1 : 0.35 }}
                >
                  {Number(d.date.slice(8))}
                </span>
              )
            })}
          </div>
        </section>
      </div>
    </Page>
  )
}
