import { useState } from 'react'
import type { PerformanceDay, PerformanceHabit, PerformanceView } from '@shared/types'
import Screen from '../components/Screen'
import Icon from '../components/Icon'
import { Bar, Button, Card, CardTitle, Empty, ErrorState, Label, Loading, Tier } from '../components/ui'
import { useData } from '../hooks/useData'
import { addDays, duration, saturdayOf, toLocalDate } from '../lib/format'

// Saturday-first, matching the backend's week anchor.
const WEEKDAYS = ['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri']

/** Maps an ISO weekday (1=Mon..7=Sun) to its column in the Saturday-first WEEKDAYS. */
function weekdayIndex(isoWeekday: number): number {
  return (isoWeekday - 6 + 7) % 7
}

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
              {WEEKDAYS[weekdayIndex(d.weekday)]}
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

/**
 * The weekly points target and the record of whether it was met.
 *
 * Past weeks are judged against the CURRENT target rather than one frozen per week —
 * the same principle as the scoring values, where changing a number re-prices history
 * so every week is measured on one consistent yardstick.
 */
function TargetCard({ data, onChanged }: { data: PerformanceView; onChanged: () => void }) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(String(data.weeklyTarget || data.suggestedTarget))

  const save = async (value: number): Promise<void> => {
    await window.api.settings.save({ weeklyPointsTarget: Math.max(0, Math.round(value)) })
    setEditing(false)
    onChanged()
  }

  if (data.weeklyTarget === 0 && !editing) {
    return (
      <Card style={{ display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap' }}>
        <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 4, minWidth: 200 }}>
          <CardTitle>No weekly target set</CardTitle>
          <span style={{ fontSize: 11.5, color: 'var(--dim)', textWrap: 'pretty' }}>
            Completing everything scheduled this week would score{' '}
            <span className="num" style={{ color: 'var(--accent)' }}>
              {data.suggestedTarget}
            </span>{' '}
            points. Aiming slightly under that leaves room for one bad day.
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={() => setEditing(true)}>SET MY OWN</Button>
          <Button kind="solid" onClick={() => void save(data.suggestedTarget)}>
            USE {data.suggestedTarget}
          </Button>
        </div>
      </Card>
    )
  }

  const met = data.targetMet
  const accent = met ? 'var(--ok)' : 'var(--accent)'

  return (
    <Card accent={met ? 'var(--ok)' : 'var(--line)'} style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 12 }}>
          <CardTitle>Weekly target</CardTitle>
          {met ? (
            <span
              className="display"
              style={{
                fontSize: 10,
                letterSpacing: '0.12em',
                color: 'var(--ok)',
                border: '1px solid var(--ok)',
                padding: '2px 8px'
              }}
            >
              ACHIEVED
            </span>
          ) : (
            <span style={{ fontSize: 11.5, color: 'var(--dim)' }}>
              {data.pointsToTarget} more to go
            </span>
          )}
        </div>

        {editing ? (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <input
              type="number"
              min={0}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              style={{ width: 90 }}
            />
            <Button kind="solid" onClick={() => void save(Number(draft))}>
              SAVE
            </Button>
            <Button onClick={() => setEditing(false)}>CANCEL</Button>
          </div>
        ) : (
          <div style={{ display: 'flex', gap: 10, alignItems: 'baseline' }}>
            <span className="num" style={{ fontSize: 24, color: accent }}>
              {data.totalPoints}
            </span>
            <span style={{ fontSize: 13, color: 'var(--faint)' }}>of {data.weeklyTarget}</span>
            <Button
              onClick={() => {
                setDraft(String(data.weeklyTarget))
                setEditing(true)
              }}
            >
              CHANGE
            </Button>
          </div>
        )}
      </div>

      <Bar value={data.targetProgress * 100} color={accent} height={6} />

      {data.recentWeeks.length > 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Label>Week by week</Label>
            {data.targetStreak > 0 ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                <Icon name="flame" size={12} color="var(--gold)" strokeWidth={1.8} />
                <span className="num" style={{ fontSize: 12, color: 'var(--gold)' }}>
                  {data.targetStreak} week{data.targetStreak === 1 ? '' : 's'} in a row
                </span>
              </span>
            ) : null}
          </div>

          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            {data.recentWeeks.map((w) => {
              const colour = w.inProgress
                ? 'var(--accent)'
                : w.met
                  ? 'var(--ok)'
                  : 'var(--bad)'
              return (
                <div
                  key={w.weekStart}
                  title={`${w.weekLabel} · ${w.points} of ${w.target} points · ${
                    w.inProgress ? 'in progress' : w.met ? 'met' : 'missed'
                  }`}
                  style={{
                    flexGrow: 1,
                    minWidth: 52,
                    padding: '7px 4px',
                    textAlign: 'center',
                    border: `1px solid ${colour}`,
                    background: w.inProgress
                      ? 'transparent'
                      : `color-mix(in oklab, ${colour} 18%, transparent)`,
                    borderStyle: w.inProgress ? 'dashed' : 'solid',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 2
                  }}
                >
                  <span className="num" style={{ fontSize: 13, color: colour }}>
                    {w.points}
                  </span>
                  <span style={{ fontSize: 9, letterSpacing: '0.06em', color: 'var(--faint)' }}>
                    {w.weekStart.slice(8)}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}
    </Card>
  )
}

export default function Performance() {
  const [anchor, setAnchor] = useState(() => toLocalDate(new Date()))
  const { data, error, loading, refetch } = useData(
    () => window.api.view.performance(anchor),
    [anchor]
  )

  if (error) {
    return (
      <Screen title="Performance">
        <ErrorState message={error} onRetry={refetch} />
      </Screen>
    )
  }
  if (loading && !data) {
    return (
      <Screen title="Performance">
        <Loading />
      </Screen>
    )
  }
  if (!data) return null

  const monthLabel = new Date(`${data.monthAnchor}T12:00:00`).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric'
  })

  // Only fall back to the empty state when there is genuinely nothing to show. With
  // habits scheduled but nothing completed yet, a zeroed week is far more useful than
  // a placeholder — it shows what is coming and what has already been missed.
  if (data.habits.length === 0 && !data.days.some((d) => d.scheduled > 0)) {
    return (
      <Screen title="Performance" subtitle={data.weekLabel}>
        <Empty
          title="Nothing scheduled this week"
          body="Create a habit and pick the days it runs on. This screen then fills in: the week's total, how each day moved against the one before it, which habit is carrying you and which is slipping."
        />
      </Screen>
    )
  }

  return (
    <Screen
      title="Performance"
      subtitle={data.weekLabel}
      actions={
        <div style={{ display: 'flex', gap: 6 }}>
          <Button onClick={() => setAnchor(addDays(anchor, -7))} title="Previous week">
            <Icon name="chevronLeft" size={12} strokeWidth={2.2} />
          </Button>
          <Button onClick={() => setAnchor(toLocalDate(new Date()))}>THIS WEEK</Button>
          <Button
            onClick={() => setAnchor(addDays(anchor, 7))}
            title="Next week"
            disabled={saturdayOf(anchor) >= saturdayOf(toLocalDate(new Date()))}
          >
            <Icon name="chevronRight" size={12} strokeWidth={2.2} />
          </Button>
        </div>
      }
    >
      <div style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* ------------------------------------------------ weekly target */}
        <TargetCard data={data} onChanged={refetch} />

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
                ? `${WEEKDAYS[weekdayIndex(data.bestDay.weekday)]} · ${data.bestDay.completed}/${data.bestDay.scheduled} complete`
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
                ? `${WEEKDAYS[weekdayIndex(data.worstDay.weekday)]} · ${data.worstDay.completed}/${data.worstDay.scheduled} complete`
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
