import { useState } from 'react'
import type { DashboardCard } from '@shared/types'
import Screen from '../components/Screen'
import Icon from '../components/Icon'
import { Bar, Button, Empty, ErrorState, Loading, Ring, Tier } from '../components/ui'
import { useData, useTick } from '../hooks/useData'
import { dayLabel, duration, STATUS_COLOR, STATUS_LABEL } from '../lib/format'

/**
 * Live elapsed minutes while a timer runs, so the card ticks upward between fetches.
 *
 * `loggedMinutes` is only accurate as of the moment it was fetched. Adding the time
 * since the timer started to the SETTLED minutes keeps the figure moving every second
 * without double-counting the elapsed portion the server already included.
 */
function liveMinutes(card: DashboardCard, now: number): number {
  if (!card.timerRunning || !card.timerStartedAt) return card.loggedMinutes
  const elapsed = Math.max(0, Math.floor((now - new Date(card.timerStartedAt).getTime()) / 60000))
  return card.closedMinutes + elapsed
}

/**
 * Elapsed seconds on the running timer.
 *
 * Minutes alone are not enough feedback: at minute granularity the card sits
 * completely still for the first 60 seconds after you press Start, which reads as a
 * dead button. The seconds readout moves immediately.
 */
function liveSeconds(card: DashboardCard, now: number): number {
  if (!card.timerRunning || !card.timerStartedAt) return 0
  const elapsed = Math.max(0, Math.floor((now - new Date(card.timerStartedAt).getTime()) / 1000))
  return card.closedMinutes * 60 + elapsed
}

function clockLabel(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600)
  const m = Math.floor((totalSeconds % 3600) / 60)
  const s = totalSeconds % 60
  const pad = (n: number): string => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

function HabitRow({ card, now }: { card: DashboardCard; now: number }) {
  const [busy, setBusy] = useState(false)
  const minutes = liveMinutes(card, now)
  const seconds = liveSeconds(card, now)
  const color = card.timerRunning ? 'var(--accent)' : STATUS_COLOR[card.status]
  const done = card.status === 'complete'

  // While running, drive the ring from SECONDS so it creeps up continuously instead of
  // jumping once a minute.
  const percent =
    card.targetMinutes > 0
      ? Math.min(
          100,
          Math.round(
            ((card.timerRunning ? seconds / 60 : minutes) / card.targetMinutes) * 100
          )
        )
      : 0

  // A running timer is its own status. Showing the stored status here meant the card
  // read "Not started" for the entire first quarter of a session.
  const statusLabel = card.timerRunning ? 'Running' : STATUS_LABEL[card.status]

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        background: 'var(--panel)',
        border: `1px solid ${card.timerRunning ? 'var(--accent)' : 'var(--line)'}`,
        boxShadow: card.timerRunning
          ? '0 0 0 1px var(--accent), 0 6px 22px -8px var(--accent)'
          : 'none',
        padding: '16px 18px',
        display: 'flex',
        alignItems: 'center',
        gap: 18,
        minWidth: 0,
        transition: 'border-color .2s ease, box-shadow .2s ease'
      }}
    >
      <Ring percent={percent} color={color}>
        <span className="num" style={{ fontSize: 17, color }}>
          {percent}
        </span>
      </Ring>

      <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 7, minWidth: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <span
            className="display"
            style={{
              fontSize: 18,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis'
            }}
          >
            {card.name}
          </span>
          <Tier level={card.difficultyLevel} />
          {card.origin === 'assumed' ? (
            <span
              title="Ticked in Google without a timer run — credited at target"
              style={{
                fontSize: 9,
                letterSpacing: '0.08em',
                color: 'var(--faint)',
                border: '1px solid var(--line)',
                padding: '1px 5px',
                flexShrink: 0
              }}
            >
              ASSUMED
            </span>
          ) : null}
        </div>

        <span
          style={{
            fontSize: 11,
            color: 'var(--faint)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {card.scheduledTime} · {card.timerRunning ? clockLabel(seconds) : duration(minutes)} of{' '}
          {duration(card.targetMinutes)} · {statusLabel}
        </span>

        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <Icon
              name="flame"
              size={12}
              color={card.streak > 0 ? 'var(--gold)' : 'var(--faint)'}
              strokeWidth={1.8}
            />
            <span
              className="num"
              style={{ fontSize: 12, color: card.streak > 0 ? 'var(--gold)' : 'var(--faint)' }}
            >
              {card.streak}
            </span>
          </span>
          <span className="num" style={{ fontSize: 12, color: 'var(--accent)' }}>
            +{card.xpReward} XP
          </span>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 7, flexShrink: 0 }}>
        {!done ? (
          <Button
            kind={card.timerRunning ? 'solid' : 'ghost'}
            disabled={busy}
            title={card.timerRunning ? 'Stop the timer' : 'Start the timer'}
            onClick={() =>
              void act(() =>
                card.timerRunning
                  ? window.api.timer.stop(card.occurrenceId)
                  : window.api.timer.start(card.occurrenceId)
              )
            }
          >
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name={card.timerRunning ? 'stop' : 'play'} size={11} />
              {card.timerRunning ? clockLabel(seconds) : 'START'}
            </span>
          </Button>
        ) : null}

        <Button
          kind={done ? 'ghost' : 'solid'}
          disabled={busy}
          title={done ? 'Mark as not done' : 'Mark complete'}
          onClick={() => void act(() => window.api.occurrence.setCompleted(card.occurrenceId, !done))}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="check" size={11} strokeWidth={2.4} />
            {done ? 'UNDO' : 'DONE'}
          </span>
        </Button>
      </div>
    </div>
  )
}

export default function Dashboard() {
  // Re-render each second so a running timer's minutes stay honest on screen.
  useTick(1000)
  const now = Date.now()
  const { data, error, loading, refetch } = useData(() => window.api.view.dashboard(), [])

  if (error) return (<Screen title="Today"><ErrorState message={error} onRetry={refetch} /></Screen>)
  if (loading && !data) return (<Screen title="Today"><Loading /></Screen>)
  if (!data) return null

  const level = data.level
  const pct = Math.round(level.progress * 100)

  return (
    <Screen
      title={dayLabel(data.date)}
      subtitle={`${data.weekLabel} · Day score ${data.dayPoints} / ${data.dayPointsMax}`}
      actions={
        <div style={{ flexGrow: 1, maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <span className="label">
              Level {level.level} → {level.level + 1}
            </span>
            <span className="num" style={{ fontSize: 12, color: 'var(--dim)' }}>
              {level.xpToNext.toLocaleString()} XP TO GO
            </span>
          </div>
          <div style={{ display: 'flex', gap: 2, height: 8 }}>
            {Array.from({ length: 20 }, (_, i) => (
              <div
                key={i}
                style={{
                  flexGrow: 1,
                  background: i < Math.round(pct / 5) ? 'var(--accent)' : 'var(--panel2)',
                  transition: 'background .3s ease'
                }}
              />
            ))}
          </div>
        </div>
      }
    >
      {data.cards.length === 0 ? (
        <Empty
          title="Nothing scheduled today"
          body="Create a habit and set which days it runs on. The app expands the schedule automatically and, once Google is connected, puts a matching task in your list each day."
        />
      ) : (
        <div
          style={{
            padding: '20px 26px',
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(430px, 1fr))',
            gap: 14,
            alignContent: 'start'
          }}
        >
          {data.cards.map((card) => (
            <HabitRow key={card.occurrenceId} card={card} now={now} />
          ))}

          <div
            style={{
              background: 'var(--panel2)',
              border: '1px dashed var(--line)',
              padding: '16px 18px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              gap: 9
            }}
          >
            <span className="label">Today</span>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
              <span className="num" style={{ fontSize: 26, color: 'var(--accent)' }}>
                {data.dayPoints}
              </span>
              <span style={{ fontSize: 12, color: 'var(--faint)' }}>
                of {data.dayPointsMax} points ·{' '}
                {data.cards.filter((c) => c.status === 'complete').length} of {data.cards.length}{' '}
                complete
              </span>
            </div>
            <Bar
              value={
                data.dayPointsMax > 0
                  ? (Math.max(0, data.dayPoints) / data.dayPointsMax) * 100
                  : 0
              }
              color="var(--accent)"
              height={3}
            />
          </div>
        </div>
      )}
    </Screen>
  )
}
