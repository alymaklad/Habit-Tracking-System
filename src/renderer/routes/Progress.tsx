import type { SeriesPoint } from '@shared/types'
import Screen from '../components/Screen'
import { Button, Card, CardTitle, Empty, Label } from '../components/ui'
import { useData } from '../hooks/useData'
import { duration } from '../lib/format'

function Bars({ points, color }: { points: SeriesPoint[]; color: string }) {
  const max = Math.max(...points.map((p) => p.value), 1) * 1.15
  const w = 300
  const h = 96
  const bw = w / Math.max(points.length, 1)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} style={{ width: '100%', height: 96 }} preserveAspectRatio="none">
      {points.map((p, i) => {
        const bh = Math.max((p.value / max) * h, 2)
        return (
          <rect
            key={p.label + i}
            x={i * bw + bw * 0.18}
            y={h - bh}
            width={bw * 0.64}
            height={bh}
            fill={i === points.length - 1 ? color : 'var(--panel2)'}
          />
        )
      })}
    </svg>
  )
}

function Line({ points, color, max }: { points: SeriesPoint[]; color: string; max: number }) {
  if (points.length < 2) return <Bars points={points} color={color} />
  const w = 300
  const h = 88
  const step = w / (points.length - 1)
  const path = points
    .map((p, i) => `${i ? 'L' : 'M'}${(i * step).toFixed(1)} ${(h - (p.value / max) * h).toFixed(1)}`)
    .join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h + 8}`} style={{ width: '100%', height: 96 }} preserveAspectRatio="none">
      <path d={`${path} L${w} ${h} L0 ${h} Z`} fill={`color-mix(in oklab, ${color} 16%, transparent)`} />
      <path d={path} fill="none" stroke={color} strokeWidth={2} />
    </svg>
  )
}

function Chart({
  title,
  headline,
  footer,
  children
}: {
  title: string
  headline: string
  footer: string
  children: React.ReactNode
}) {
  return (
    <Card style={{ display: 'flex', flexDirection: 'column', gap: 11, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 10 }}>
        <CardTitle>{title}</CardTitle>
        <span className="num" style={{ fontSize: 13, color: 'var(--ok)' }}>
          {headline}
        </span>
      </div>
      {children}
      <span className="label">{footer}</span>
    </Card>
  )
}

export default function Progress() {
  const { data } = useData(() => window.api.view.progress(8), [])
  const { data: review } = useData(() => window.api.view.weeklyReview(), [])

  if (!data) return null

  const hasData = data.hoursPerWeek.length > 0

  if (!hasData) {
    return (
      <Screen title="Progress" subtitle="Last 8 weeks">
        <Empty
          title="Nothing to chart yet"
          body="Complete a few habits and the weekly figures start building. Improvement is measured week over week, so the first comparison appears after your second week."
        />
      </Screen>
    )
  }

  const improvement = data.improvementPercentage
  const delta =
    improvement === null
      ? '—'
      : `${improvement >= 0 ? '+' : ''}${Math.round(improvement * 10) / 10}%`

  return (
    <Screen title="Progress" subtitle={`Last ${data.hoursPerWeek.length} weeks · all habits`}>
      <div style={{ padding: '18px 24px', display: 'flex', gap: 16, minHeight: 0, alignItems: 'flex-start' }}>
        <div
          style={{
            flexGrow: 1,
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
            gap: 14,
            minWidth: 0
          }}
        >
          <Chart
            title="Hours per week"
            headline={delta}
            footer={`${data.totalHours}h logged in total`}
          >
            <Bars points={data.hoursPerWeek} color="var(--accent)" />
          </Chart>

          <Chart
            title="Completion rate"
            headline={`${data.completionPerWeek.at(-1)?.value ?? 0}%`}
            footer="Completed of scheduled, per week"
          >
            <Line points={data.completionPerWeek} color="var(--ok)" max={100} />
          </Chart>

          <Chart
            title="Points per week"
            headline={String(data.pointsPerWeek.at(-1)?.value ?? 0)}
            footer="Including weekly bonuses"
          >
            <Bars points={data.pointsPerWeek} color="var(--gold)" />
          </Chart>

          <Chart
            title="Difficulty level"
            headline={String(Math.round((data.difficultySeries.at(-1)?.value ?? 1) * 10) / 10)}
            footer="Average tier across active habits"
          >
            <Line
              points={data.difficultySeries}
              color="var(--gold)"
              max={Math.max(...data.difficultySeries.map((p) => p.value), 3) * 1.2}
            />
          </Chart>
        </div>

        {review ? (
          <div style={{ width: 300, flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 14 }}>
            <Card accent="var(--accent)" style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
              <CardTitle>Week {review.weekNumber} review</CardTitle>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                {(
                  [
                    ['Total time', duration(review.totalMinutes), 'var(--fg)'],
                    ['Previous week', duration(review.previousMinutes), 'var(--dim)'],
                    [
                      'Improvement',
                      review.improvementPercentage === null
                        ? '—'
                        : `${review.improvementPercentage >= 0 ? '+' : ''}${Math.round(review.improvementPercentage * 10) / 10}%`,
                      review.improvementPercentage !== null && review.improvementPercentage >= 0
                        ? 'var(--ok)'
                        : 'var(--bad)'
                    ],
                    ['Tasks completed', `${review.tasksCompleted} / ${review.tasksScheduled}`, 'var(--fg)'],
                    ['Consistency', `${Math.round(review.consistency)}%`, 'var(--fg)'],
                    ['XP earned', String(review.xp), 'var(--accent)']
                  ] as [string, string, string][]
                ).map(([k, v, c]) => (
                  <div
                    key={k}
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      paddingBottom: 7,
                      borderBottom: '1px solid var(--line)'
                    }}
                  >
                    <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>{k}</span>
                    <span className="num" style={{ fontSize: 16, color: c }}>
                      {v}
                    </span>
                  </div>
                ))}
              </div>

              {review.bestHabit || review.weakestHabit ? (
                <div style={{ display: 'flex', gap: 10 }}>
                  {review.bestHabit ? (
                    <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <Label>Best</Label>
                      <span className="display" style={{ fontSize: 14, color: 'var(--ok)' }}>
                        {review.bestHabit.name} {Math.round(review.bestHabit.completionRate)}%
                      </span>
                    </div>
                  ) : null}
                  {review.weakestHabit ? (
                    <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2 }}>
                      <Label>Weakest</Label>
                      <span className="display" style={{ fontSize: 14, color: 'var(--bad)' }}>
                        {review.weakestHabit.name} {Math.round(review.weakestHabit.completionRate)}%
                      </span>
                    </div>
                  ) : null}
                </div>
              ) : null}
            </Card>

            <Card style={{ background: 'var(--panel2)', display: 'flex', flexDirection: 'column', gap: 9 }}>
              <Label>Automated analysis</Label>
              {review.analysis.map((line, i) => (
                <span key={i} style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--dim)', textWrap: 'pretty' }}>
                  {line}
                </span>
              ))}
              <div style={{ height: 1, background: 'var(--line)', margin: '3px 0' }} />
              <Label>Recommendation</Label>
              {review.recommendations.map((line, i) => (
                <span key={i} style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--fg)', textWrap: 'pretty' }}>
                  {line}
                </span>
              ))}
            </Card>
          </div>
        ) : (
          <div style={{ width: 300, flexShrink: 0 }}>
            <Card style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
              <CardTitle>Weekly review</CardTitle>
              <span style={{ fontSize: 12, lineHeight: 1.55, color: 'var(--dim)', textWrap: 'pretty' }}>
                Your first review appears once a full week has passed, so there is a previous
                week to compare against.
              </span>
              <Button onClick={() => void window.api.settings.recomputeAll()}>RECOMPUTE</Button>
            </Card>
          </div>
        )}
      </div>
    </Screen>
  )
}
