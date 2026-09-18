import { useState } from 'react'
import Screen from '../components/Screen'
import Icon from '../components/Icon'
import { Button, Label } from '../components/ui'
import { useData } from '../hooks/useData'
import { addDays, duration, saturdayOf, STATUS_COLOR, toLocalDate } from '../lib/format'

const HOUR_FROM = 6
const HOUR_TO = 23
const PX_PER_HOUR = 34

/**
 * The week grid places each habit at its real time, sized by its duration target.
 *
 * This is the view Google Calendar could not have given us: a Google Task carries no
 * time of day and no duration, so it can only ever appear as an untimed line. Because
 * the app owns both, a block can be positioned and sized properly.
 */
export default function CalendarRoute() {
  const [anchor, setAnchor] = useState(() => toLocalDate(new Date()))
  const [view, setView] = useState<'week' | 'month'>('week')
  const [busy, setBusy] = useState<Set<number>>(new Set())

  const toggle = async (occurrenceId: number, done: boolean): Promise<void> => {
    setBusy((prev) => new Set(prev).add(occurrenceId))
    try {
      await window.api.occurrence.setCompleted(occurrenceId, !done)
    } finally {
      setBusy((prev) => {
        const next = new Set(prev)
        next.delete(occurrenceId)
        return next
      })
    }
  }

  const weekStart = saturdayOf(anchor)
  const weekEnd = addDays(weekStart, 6)
  const today = toLocalDate(new Date())

  const { data: blocks } = useData(
    () => window.api.view.calendarRange(addDays(weekStart, -7), addDays(weekEnd, 7)),
    [weekStart]
  )
  const { data: month } = useData(() => window.api.view.calendarMonth(anchor), [anchor.slice(0, 7)])

  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  const hours = Array.from({ length: HOUR_TO - HOUR_FROM + 1 }, (_, i) => HOUR_FROM + i)

  const shift = (n: number): void => setAnchor(addDays(anchor, view === 'week' ? n * 7 : n * 30))

  return (
    <Screen
      title="Calendar"
      subtitle={
        view === 'week'
          ? `${weekStart} – ${weekEnd}`
          : new Date(`${anchor}T12:00:00`).toLocaleDateString(undefined, {
              month: 'long',
              year: 'numeric'
            })
      }
      actions={
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <div style={{ display: 'flex' }}>
            {(['week', 'month'] as const).map((v, i) => (
              <button
                key={v}
                onClick={() => setView(v)}
                className="display"
                style={{
                  padding: '6px 15px',
                  fontSize: 11,
                  letterSpacing: '0.1em',
                  marginLeft: i ? -1 : 0,
                  border: `1px solid ${view === v ? 'var(--accent)' : 'var(--line)'}`,
                  background: view === v ? 'var(--accent)' : 'transparent',
                  color: view === v ? 'var(--accent-ink)' : 'var(--dim)'
                }}
              >
                {v.toUpperCase()}
              </button>
            ))}
          </div>
          <div style={{ display: 'flex', gap: 6 }}>
            <Button onClick={() => shift(-1)} title="Previous">
              <Icon name="chevronLeft" size={12} strokeWidth={2.2} />
            </Button>
            <Button onClick={() => setAnchor(today)}>TODAY</Button>
            <Button onClick={() => shift(1)} title="Next">
              <Icon name="chevronRight" size={12} strokeWidth={2.2} />
            </Button>
          </div>
        </div>
      }
      scroll={false}
    >
      {view === 'month' ? (
        <div style={{ padding: '18px 26px', display: 'flex', flexDirection: 'column', gap: 10, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))', gap: 4 }}>
            {['Sat', 'Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri'].map((d) => (
              <div key={d} className="label" style={{ textAlign: 'center', paddingBottom: 6 }}>
                {d}
              </div>
            ))}
            {(month ?? []).map((cell) => {
              const isToday = cell.date === today
              return (
                <div
                  key={cell.date}
                  style={{
                    minHeight: 78,
                    padding: 8,
                    border: `1px solid ${isToday ? 'var(--accent)' : 'var(--line)'}`,
                    background: isToday
                      ? 'color-mix(in oklab, var(--accent) 12%, transparent)'
                      : cell.inMonth
                        ? 'var(--panel)'
                        : 'transparent',
                    opacity: cell.inMonth ? 1 : 0.4,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 6
                  }}
                >
                  <span
                    className="num"
                    style={{ fontSize: 12, color: isToday ? 'var(--accent)' : 'var(--dim)' }}
                  >
                    {Number(cell.date.slice(8))}
                  </span>
                  {cell.scheduled > 0 ? (
                    <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
                      {Array.from({ length: cell.complete }, (_, i) => (
                        <span key={`c${i}`} style={dot('var(--ok)')} />
                      ))}
                      {Array.from({ length: cell.partial }, (_, i) => (
                        <span key={`p${i}`} style={dot('var(--gold)')} />
                      ))}
                      {Array.from({ length: cell.missed }, (_, i) => (
                        <span key={`m${i}`} style={dot('var(--bad)')} />
                      ))}
                      {Array.from(
                        { length: Math.max(0, cell.scheduled - cell.complete - cell.partial - cell.missed) },
                        (_, i) => (
                          <span key={`s${i}`} style={dot('var(--line)')} />
                        )
                      )}
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>
      ) : (
        <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
          <div style={{ flexShrink: 0, display: 'flex', borderBottom: '1px solid var(--line)', paddingLeft: 48 }}>
            {days.map((d) => (
              <div
                key={d}
                style={{
                  flexGrow: 1,
                  padding: '8px 0',
                  textAlign: 'center',
                  borderRight: '1px solid var(--line)',
                  background:
                    d === today ? 'color-mix(in oklab, var(--accent) 10%, transparent)' : 'transparent'
                }}
              >
                <span
                  className="display"
                  style={{ fontSize: 11, color: d === today ? 'var(--accent)' : 'var(--dim)' }}
                >
                  {new Date(`${d}T12:00:00`).toLocaleDateString(undefined, {
                    weekday: 'short',
                    day: 'numeric'
                  })}
                </span>
              </div>
            ))}
          </div>

          <div style={{ flexGrow: 1, overflowY: 'auto', display: 'flex' }}>
            <div style={{ width: 48, flexShrink: 0 }}>
              {hours.map((h) => (
                <div
                  key={h}
                  style={{
                    height: PX_PER_HOUR,
                    display: 'flex',
                    justifyContent: 'flex-end',
                    paddingRight: 7
                  }}
                >
                  <span
                    className="num"
                    style={{ fontSize: 9.5, color: 'var(--faint)', transform: 'translateY(-5px)' }}
                  >
                    {String(h).padStart(2, '0')}:00
                  </span>
                </div>
              ))}
            </div>

            <div style={{ flexGrow: 1, display: 'flex', position: 'relative' }}>
              <div style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                {hours.map((h) => (
                  <div key={h} style={{ height: PX_PER_HOUR, borderTop: '1px solid var(--line)' }} />
                ))}
              </div>

              {days.map((d) => (
                <div
                  key={d}
                  style={{
                    flexGrow: 1,
                    position: 'relative',
                    borderRight: '1px solid var(--line)',
                    background:
                      d === today ? 'color-mix(in oklab, var(--accent) 6%, transparent)' : 'transparent'
                  }}
                >
                  {(blocks ?? [])
                    .filter((b) => b.date === d)
                    .map((b) => {
                      const [hh, mm] = b.scheduledTime.split(':').map(Number)
                      const top = ((hh ?? 0) - HOUR_FROM + (mm ?? 0) / 60) * PX_PER_HOUR
                      const height = Math.max(14, (b.targetMinutes / 60) * PX_PER_HOUR - 2)
                      const done = b.status === 'complete'
                      const color = b.timerRunning ? 'var(--accent)' : STATUS_COLOR[b.status]
                      const isBusy = busy.has(b.occurrenceId)
                      return (
                        <div
                          key={b.occurrenceId}
                          role="button"
                          title={`${b.name} · ${b.scheduledTime} · ${duration(b.targetMinutes)} · click to ${done ? 'undo' : 'mark complete'}`}
                          onClick={() => !isBusy && void toggle(b.occurrenceId, done)}
                          style={{
                            position: 'absolute',
                            left: 2,
                            right: 2,
                            top: Math.max(0, top),
                            height,
                            overflow: 'hidden',
                            padding: '2px 5px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 4,
                            borderLeft: `2px solid ${color}`,
                            background: `color-mix(in oklab, ${color} 20%, transparent)`,
                            color,
                            boxShadow: b.timerRunning ? '0 0 14px -4px var(--accent)' : 'none',
                            cursor: isBusy ? 'default' : 'pointer',
                            opacity: isBusy ? 0.5 : 1
                          }}
                        >
                          {done ? <Icon name="check" size={9} strokeWidth={2.4} /> : null}
                          <span
                            className="display"
                            style={{ fontSize: 10, whiteSpace: 'nowrap', letterSpacing: '0.04em' }}
                          >
                            {b.name}
                          </span>
                        </div>
                      )
                    })}
                </div>
              ))}
            </div>
          </div>

          <div
            style={{
              flexShrink: 0,
              padding: '10px 26px',
              borderTop: '1px solid var(--line)',
              display: 'flex',
              gap: 18,
              alignItems: 'center'
            }}
          >
            <Label>Legend</Label>
            {[
              ['var(--ok)', 'Completed'],
              ['var(--gold)', 'Partial'],
              ['var(--bad)', 'Missed'],
              ['var(--accent)', 'Running'],
              ['var(--faint)', 'Scheduled']
            ].map(([c, t]) => (
              <span key={t} style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                <span style={{ width: 9, height: 9, background: c }} />
                <span style={{ fontSize: 11, color: 'var(--dim)' }}>{t}</span>
              </span>
            ))}
          </div>
        </div>
      )}
    </Screen>
  )
}

const dot = (color: string): React.CSSProperties => ({
  width: 5,
  height: 5,
  borderRadius: '50%',
  background: color,
  display: 'inline-block'
})
