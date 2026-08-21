import { useState } from 'react'
import type { PerformanceDay, PerformanceHabit } from '@shared/types'
import Screen from '../components/Screen'
import Icon from '../components/Icon'
import { Bar, Button, Card, CardTitle, Empty, Label, Tier } from '../components/ui'
import { useData } from '../hooks/useData'
import { addDays, duration, mondayOf, toLocalDate } from '../lib/format'

const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']

/** Signed number with an explicit sign, so a gain never reads as a bare figure. */
function signed(n: number): string {
  return n > 0 ? `+${n}` : String(n)
}

function DeltaBadge({ value, suffix = '' }: { value: number | null; suffix?: string }) {
  if (value === null) {
    return (
      <span style={{ fontSize: 11, color: 'var(--faint)' }} title="Nothing to compare against yet">
        —
      </span>
    )
  }
  const flat = Math.abs(value) < 0.05
  const color = flat ? 'var(--faint)' : value > 0 ? 'var(--ok)' : 'var(--bad)'
  return (
    <span
      className="num"
      style={{ fontSize: 12, color, display: 'inline-flex', alignItems: 'center', gap: 3 }}
    >
      {flat ? '±0' : `${value > 0 ? '▲' : '▼'} ${Math.abs(Math.round(value * 10) / 10)}`}
      {suffix}
    </span>
  )
}

/**
 * Points can be negative — a missed day scores −1 — so the day chart has a zero line
 * with bars growing up or down from it, rather than a floor at zero which would hide
 * exactly the days worth noticing.
 */
function DayChart({ days }: { days: PerformanceDay[] }) {
  const values = days.map((d) => d.points)
  const max = Math.max(1, ...values)
  const min = Math.min(0, ...values)
  const span = max - min || 1
  const H = 120
  const zeroY = (max / span) * H

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ position: 'relative', height: H, display: 'flex', gap: 6 }}>
        {/* zero line */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            top: zeroY,
            borderTop: '1px dashed var(--line)',
            pointerEvents: 'none'
          }}
        />
        {days.map((d) => {
          const positive = d.points >= 0
          const height = (Math.abs(d.points) / span) * H
          const color =
            d.scheduled === 0
              ? 'var(--line)'
              : d.points > 0
                ? 'var(--accent)'
                : d.points < 0
                  ? 'var(--bad)'
                  : 'var(--faint)'
          return (
            <div
              key={d.date}
              title={`${d.date} · ${signed(d.points)} points · ${d.completed}/${d.scheduled} complete`}
              style={{ flexGrow: 1, position: 'relative', height: H }}
            >
              <div
                style={{
                  position: 'absolute',
                  left: '18%',
                  right: '18%',
                  top: positive ? zeroY - height : zeroY,
                  height: Math.max(height, d.scheduled === 0 ? 2 : 3),
                  background: color,
                  transition: 'height .3s ease, top .3s ease'
                }}
              />
            </div>
          )
        })}
      </div>

      <div style={{ display: 'flex', gap: 6 }}>
        {days.map((d) => (
          <div
            key={d.date}
            style={{
              flexGrow: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 3
            }}
          >
            <span className="num" style={{ fontSize: 13, color: d.scheduled === 0 ? 'var(--faint)' : 'var(--fg)' }}>
              {d.scheduled === 0 ? '·' : signed(d.points)}
            </span>
            <span style={{ fontSize: 9.5, letterSpacing: '0.08em', color: 'var(--faint)' }}>
              {WEEKDAYS[d.weekday - 1]}
            </span>
            <DeltaBadge value={d.delta} />
          </div>
        ))}
      </div>
    </div>
  )
}

function HabitRow({ habit, rank }: { habit: PerformanceHabit; rank: 'best' | 'weakest' | null }) {
  const accent = rank === 'best' ? 'var(--ok)' : rank === 'weakest' ? 'var(--bad)' : 'var(--line)'
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        padding: '11px 14px',
        background: 'var(--panel)',
        border: `1px solid ${accent}`,
        minWidth: 0
      }}
    >
      <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 5, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            className="display"
            style={{ fontSize: 15, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
          >
            {habit.name}
          </span>
          <Tier level={habit.difficultyLevel} />
          {rank ? (
            <span
              className="display"
              style={{
                fontSize: 9,
                letterSpacing: '0.1em',
                color: accent,
                border: `1px solid ${accent}`,
                padding: '1px 5px'
              }}
            >
              {rank === 'best' ? 'BEST' : 'WEAKEST'}
            </span>
          ) : null}
        </div>
        <Bar
          value={habit.completionRate}
          color={rank === 'weakest' ? 'var(--bad)' : rank === 'best' ? 'var(--ok)' : 'var(--accent)'}
          height={3}
        />
        <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>
          {habit.completed}/{habit.scheduled} complete
          {habit.partial > 0 ? ` · ${habit.partial} partial` : ''}
          {habit.missed > 0 ? ` · ${habit.missed} missed` : ''} · {duration(habit.minutes)}
        </span>
      </div>

      <div style={{ textAlign: 'right', flexShrink: 0, display: 'flex', flexDirection: 'column', gap: 2 }}>
        <span className="num" style={{ fontSize: 19 }}>
          {Math.round(habit.completionRate)}%
        </span>
        <DeltaBadge value={habit.trend} suffix="pt" />
      </div>

      <div style={{ width: 54, textAlign: 'right', flexShrink: 0 }}>
        <span className="num" style={{ fontSize: 17, color: habit.points < 0 ? 'var(--bad)' : 'var(--accent)' }}>
          {signed(habit.points)}
        </span>
      </div>
    </div>
  )
}

function MonthHeatmap({ grid, peak }: { grid: PerformanceDay[]; peak: number }) {
  const today = toLocalDate(new Date())

  const shade = (d: PerformanceDay): string => {
    if (!d.inPeriod || d.scheduled === 0) return 'transparent'
    if (d.points < 0) return `color-mix(in oklab, var(--bad) ${Math.min(70, 30 + Math.abs(d.points) * 15)}%, transparent)`
    if (d.points === 0) return 'var(--panel2)'
    const intensity = peak > 0 ? Math.round((d.points / peak) * 70) + 20 : 40
    return `color-mix(in oklab, var(--accent) ${intensity}%, transparent)`
  }

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
      {WEEKDAYS.map((d) => (
        <div key={d} className="label" style={{ textAlign: 'center', paddingBottom: 4 }}>
          {d}
        </div>
      ))}
      {grid.map((d) => {
        const isToday = d.date === today
        return (
          <div
            key={d.date}
            title={
              d.scheduled === 0
                ? `${d.date} · nothing scheduled`
                : `${d.date} · ${signed(d.points)} points · ${d.completed}/${d.scheduled} complete · ${duration(d.minutes)}`
            }
            style={{
              aspectRatio: '1',
              minHeight: 44,
              padding: 6,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              background: shade(d),
              border: `1px solid ${isToday ? 'var(--accent)' : 'var(--line)'}`,
              opacity: d.inPeriod ? 1 : 0.25
            }}
          >
            <span
              className="num"
              style={{ fontSize: 10, color: isToday ? 'var(--accent)' : 'var(--faint)', fontWeight: 400 }}
            >
              {Number(d.date.slice(8))}
            </span>
            {d.inPeriod && d.scheduled > 0 ? (
              <span
                className="num"
                style={{ fontSize: 13, color: d.points < 0 ? 'var(--bad)' : 'var(--fg)', textAlign: 'right' }}
              >
                {signed(d.points)}
              </span>
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

export default function Performance() {
  const [anchor, setAnchor] = useState(() => toLocalDate(new Date()))
  const { data } = useData(() => window.api.view.performance(anchor), [anchor])

  if (!data) return null

  const hasAnything = data.days.some((d) => d.scheduled > 0) || data.habits.length > 0
  const monthLabel = new Date(`${data.monthAnchor}T12:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric'
  })

  if (!hasAnything) {
    return (
      <Screen title="Performance" subtitle={`Week ${data.weekNumber}`}>
        <Empty
          title="No points scored yet"
          body="Complete a habit and this fills in: the week's total, how each day moved against the one before it, which habit is carrying you and which is slipping."
        />
      </Screen>
    )
  }

  return (
    <Screen
      title="Performance"
      subtitle={`Week ${data.weekNumber} · ${data.weekStart} to ${addDays(data.weekStart, 6)}`}
      actions={
        <div style={{ display: 'flex', gap: 6 }}>
          <Button onClick={() => setAnchor(addDays(anchor, -7))} title="Previous week">
            <Icon name="chevronLeft" size={12} strokeWidth={2.2} />
          </Button>
          <Button onClick={() => setAnchor(toLocalDate(new Date()))}>THIS WEEK</Button>
          <Button
            onClick={() => setAnchor(addDays(anchor, 7))}
            title="Next week"
            disabled={mondayOf(anchor) >= mondayOf(toLocalDate(new Date()))}
          >
            <Icon name="chevronRight" size={12} strokeWidth={2.2} />
          </Button>
        </div>
      }
    >
      <div style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* ---------------------------------------------- headline totals */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
            gap: 14
          }}
        >
          <Card accent="var(--accent)" style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <Label>Total points this week</Label>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
              <span
                className="num"
                style={{ fontSize: 38, lineHeight: 1, color: data.totalPoints < 0 ? 'var(--bad)' : 'var(--accent)' }}
              >
                {data.totalPoints}
              </span>
              <DeltaBadge value={data.pointsDelta} suffix="%" />
            </div>
            <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>
              {data.basePoints} from days
              {data.bonusPoints !== 0 ? ` · ${signed(data.bonusPoints)} bonus` : ' · no bonuses yet'}
            </span>
          </Card>

          <Card style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <Label>Previous week</Label>
            <span className="num" style={{ fontSize: 38, lineHeight: 1, color: 'var(--dim)' }}>
              {data.previousWeekPoints}
            </span>
            <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>
              {data.pointsDelta === null
                ? 'Nothing to compare against yet'
                : data.pointsDelta >= 0
                  ? 'You are ahead of last week'
                  : 'You are behind last week'}
            </span>
          </Card>

          <Card style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <Label>Best day</Label>
            <span className="num" style={{ fontSize: 38, lineHeight: 1, color: 'var(--ok)' }}>
              {data.bestDay ? signed(data.bestDay.points) : '—'}
            </span>
            <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>
              {data.bestDay
                ? `${WEEKDAYS[data.bestDay.weekday - 1]} · ${data.bestDay.completed}/${data.bestDay.scheduled} complete`
                : 'Nothing scheduled'}
            </span>
          </Card>

          <Card style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <Label>Weakest day</Label>
            <span
              className="num"
              style={{
                fontSize: 38,
                lineHeight: 1,
                color: data.worstDay && data.worstDay.points < 0 ? 'var(--bad)' : 'var(--gold)'
              }}
            >
              {data.worstDay ? signed(data.worstDay.points) : '—'}
            </span>
            <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>
              {data.worstDay
                ? `${WEEKDAYS[data.worstDay.weekday - 1]} · ${data.worstDay.completed}/${data.worstDay.scheduled} complete`
                : 'Nothing scheduled'}
            </span>
          </Card>
        </div>

        {/* ------------------------------------------- day-by-day movement */}
        <Card style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <CardTitle>Points through the week</CardTitle>
            <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>
              The arrow under each day is its change against the previous scheduled day
            </span>
          </div>
          <DayChart days={data.days} />
        </Card>

        {/* ------------------------------------------------ habit ranking */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: 16 }}>
          <Card style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
              <CardTitle>Habits this week</CardTitle>
              <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>
                Ranked by completion rate
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {data.habits.map((h) => (
                <HabitRow
                  key={h.habitId}
                  habit={h}
                  rank={
                    data.best?.habitId === h.habitId
                      ? 'best'
                      : data.weakest?.habitId === h.habitId
                        ? 'weakest'
                        : null
                  }
                />
              ))}
            </div>

            <span style={{ fontSize: 10.5, lineHeight: 1.5, color: 'var(--faint)', textWrap: 'pretty' }}>
              Ranked on completion rate rather than raw points, so a habit scheduled every day
              does not outrank a twice-weekly one it actually lost to on consistency. Justified
              skips are left out of the denominator entirely.
            </span>
          </Card>

          {/* ------------------------------------------- month heatmap */}
          <Card style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <CardTitle>{monthLabel}</CardTitle>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span className="num" style={{ fontSize: 15, color: 'var(--accent)' }}>
                  {signed(data.monthPoints)}
                </span>
                <div style={{ display: 'flex', gap: 4 }}>
                  <Button
                    onClick={() => setAnchor(addDays(data.monthAnchor, -28))}
                    title="Previous month"
                  >
                    <Icon name="chevronLeft" size={11} strokeWidth={2.2} />
                  </Button>
                  <Button
                    onClick={() => setAnchor(addDays(data.monthAnchor, 28))}
                    title="Next month"
                  >
                    <Icon name="chevronRight" size={11} strokeWidth={2.2} />
                  </Button>
                </div>
              </div>
            </div>

            <MonthHeatmap grid={data.monthGrid} peak={data.peakDayPoints} />

            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <Label>Points per day</Label>
              {[
                ['var(--bad)', 'Negative'],
                ['var(--panel2)', 'Zero'],
                ['color-mix(in oklab, var(--accent) 40%, transparent)', 'Some'],
                ['color-mix(in oklab, var(--accent) 90%, transparent)', 'Peak']
              ].map(([c, t]) => (
                <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 11, height: 11, background: c, border: '1px solid var(--line)' }} />
                  <span style={{ fontSize: 10.5, color: 'var(--dim)' }}>{t}</span>
                </span>
              ))}
            </div>
          </Card>
        </div>
      </div>
    </Screen>
  )
}
