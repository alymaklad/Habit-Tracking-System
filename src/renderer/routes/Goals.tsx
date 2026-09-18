import { useState } from 'react'
import type { GoalView } from '@shared/types'
import Screen from '../components/Screen'
import Icon from '../components/Icon'
import MindMap from '../components/MindMap'
import { Bar, Button, Card, CardTitle, Empty, ErrorState, Label, Loading } from '../components/ui'
import { useData } from '../hooks/useData'
import { dayLabel, duration } from '../lib/format'
import GoalWizard from './GoalWizard'

const STATUS_LABEL: Record<GoalView['status'], string> = {
  active: 'ACTIVE',
  achieved: 'ACHIEVED',
  abandoned: 'ABANDONED'
}
const STATUS_COLOR: Record<GoalView['status'], string> = {
  active: 'var(--accent)',
  achieved: 'var(--ok)',
  abandoned: 'var(--faint)'
}

function Detail({ goal, onChanged }: { goal: GoalView; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  const pct = goal.milestonesTotal > 0 ? (goal.milestonesDone / goal.milestonesTotal) * 100 : 0

  return (
    <div style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 0 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span className="display" style={{ fontSize: 21 }}>
              {goal.title}
            </span>
            <span
              className="display"
              style={{
                fontSize: 9.5,
                letterSpacing: '0.1em',
                color: STATUS_COLOR[goal.status],
                border: `1px solid ${STATUS_COLOR[goal.status]}`,
                padding: '1px 6px'
              }}
            >
              {STATUS_LABEL[goal.status]}
            </span>
          </span>
          <span className="label">
            {goal.targetDate
              ? goal.daysToTarget !== null && goal.daysToTarget >= 0
                ? `${goal.daysToTarget} days to ${dayLabel(goal.targetDate)}`
                : `Target was ${dayLabel(goal.targetDate)}`
              : 'No target date'}
            {goal.weeklyMinutesBudget ? ` · ${duration(goal.weeklyMinutesBudget)} per week` : ''}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          {goal.status === 'active' ? (
            <>
              <Button disabled={busy} onClick={() => void act(() => window.api.goals.close(goal.id, 'abandoned'))}>
                GIVE UP
              </Button>
              <Button kind="gold" disabled={busy} onClick={() => void act(() => window.api.goals.close(goal.id, 'achieved'))}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Icon name="check" size={11} strokeWidth={2.4} />
                  ACHIEVED
                </span>
              </Button>
            </>
          ) : (
            <Button disabled={busy} onClick={() => void act(() => window.api.goals.reopen(goal.id))}>
              REOPEN
            </Button>
          )}
          {confirmRemove ? (
            <>
              <Button onClick={() => setConfirmRemove(false)}>KEEP</Button>
              <Button kind="danger" disabled={busy} onClick={() => void act(() => window.api.goals.remove(goal.id))}>
                REMOVE GOAL
              </Button>
            </>
          ) : (
            <Button kind="danger" disabled={busy} onClick={() => setConfirmRemove(true)} title="Removes the goal; its habits and to-dos stay">
              <Icon name="close" size={11} strokeWidth={2.2} />
            </Button>
          )}
        </div>
      </div>

      {goal.description ? (
        <span style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--dim)', textWrap: 'pretty' }}>{goal.description}</span>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 14 }}>
        <Card style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <CardTitle>Milestones</CardTitle>
            <span className="num" style={{ fontSize: 13, color: 'var(--accent)' }}>
              {goal.milestonesDone} / {goal.milestonesTotal}
            </span>
          </div>
          <Bar value={pct} height={3} />
          {goal.milestones.length === 0 ? (
            <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>No milestones.</span>
          ) : null}
          {goal.milestones.map((m) => (
            <div
              key={m.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                paddingTop: 8,
                borderTop: '1px solid var(--line)',
                opacity: m.dropped ? 0.45 : 1
              }}
            >
              <button
                onClick={() => void act(() => window.api.todo.setDone(m.id, !m.done))}
                disabled={busy || m.dropped}
                title={m.done ? 'Mark not done' : 'Mark done'}
                style={{
                  width: 16,
                  height: 16,
                  flexShrink: 0,
                  border: `1px solid ${m.done ? 'var(--ok)' : 'var(--line)'}`,
                  background: m.done ? 'var(--ok)' : 'transparent',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center'
                }}
              >
                {m.done ? <Icon name="check" size={10} color="var(--accent-ink)" strokeWidth={2.6} /> : null}
              </button>
              <span
                style={{
                  flexGrow: 1,
                  fontSize: 12.5,
                  textDecoration: m.done || m.dropped ? 'line-through' : 'none',
                  color: m.done ? 'var(--dim)' : 'var(--fg)'
                }}
              >
                {m.title}
              </span>
              <span className="num" style={{ fontSize: 10.5, color: 'var(--faint)' }}>
                {m.date ? dayLabel(m.date) : ''}
              </span>
            </div>
          ))}
        </Card>

        <Card style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <CardTitle>Sessions</CardTitle>
          <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>
            Ordinary habits — edit their schedule under Habits, tick them off on the Dashboard.
          </span>
          {goal.habits.map((h) => (
            <div
              key={h.id}
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                paddingTop: 8,
                borderTop: '1px solid var(--line)',
                opacity: h.active ? 1 : 0.5
              }}
            >
              <span style={{ flexGrow: 1, fontSize: 12.5 }}>{h.name}</span>
              {!h.active ? (
                <span style={{ fontSize: 9, letterSpacing: '0.1em', color: 'var(--faint)', border: '1px solid var(--line)', padding: '1px 5px' }}>
                  PAUSED
                </span>
              ) : null}
              <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <Icon name="flame" size={12} color={h.streak > 0 ? 'var(--gold)' : 'var(--faint)'} strokeWidth={1.8} />
                <span className="num" style={{ fontSize: 12, color: h.streak > 0 ? 'var(--gold)' : 'var(--faint)' }}>
                  {h.streak}
                </span>
              </span>
            </div>
          ))}
        </Card>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Label>Mind map</Label>
        <MindMap nodes={goal.mindMap} height={300} />
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Label>Resources</Label>
        {goal.resources.length === 0 ? (
          <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>No resources.</span>
        ) : null}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 10 }}>
          {goal.resources.map((r, i) => (
            <div
              key={i}
              style={{ border: '1px solid var(--line)', background: 'var(--panel)', padding: '9px 12px', display: 'flex', flexDirection: 'column', gap: 3 }}
            >
              <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span className="display" style={{ fontSize: 13 }}>
                  {r.title}
                </span>
                <span style={{ fontSize: 9, letterSpacing: '0.08em', color: 'var(--faint)', border: '1px solid var(--line)', padding: '1px 5px' }}>
                  {r.type.toUpperCase()}
                </span>
              </span>
              <span style={{ fontSize: 11.5, color: 'var(--dim)', textWrap: 'pretty' }}>{r.note}</span>
              {r.url ? (
                <button
                  onClick={() => void window.api.app.openExternal(r.url!)}
                  style={{ alignSelf: 'flex-start', fontSize: 11, color: 'var(--accent)', textDecoration: 'underline', wordBreak: 'break-all', textAlign: 'left' }}
                >
                  {r.url}
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

export default function Goals() {
  const { data, error, loading, refetch } = useData(() => window.api.goals.list(), [])
  const [selected, setSelected] = useState<number | 'new' | null>(null)

  if (error) return (<Screen title="Goals"><ErrorState message={error} onRetry={refetch} /></Screen>)
  if (loading && !data) return (<Screen title="Goals"><Loading /></Screen>)

  const list = data ?? []
  const active = list.filter((g) => g.status === 'active').length
  const current = selected === 'new' ? null : (list.find((g) => g.id === selected) ?? null)

  return (
    <Screen
      title="Goals"
      subtitle={`${list.length} goal${list.length === 1 ? '' : 's'} · ${active} active`}
      actions={
        <Button kind="solid" onClick={() => setSelected('new')}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="plus" size={12} strokeWidth={2.2} />
            NEW GOAL
          </span>
        </Button>
      }
      scroll={false}
    >
      <div style={{ flexGrow: 1, display: 'flex', minHeight: 0 }}>
        <div
          style={{
            width: 340,
            flexShrink: 0,
            borderRight: '1px solid var(--line)',
            overflowY: 'auto',
            padding: 18,
            display: 'flex',
            flexDirection: 'column',
            gap: 8
          }}
        >
          {list.length === 0 ? (
            <span style={{ fontSize: 12, color: 'var(--faint)', lineHeight: 1.6, textWrap: 'pretty' }}>
              No goals yet. Describe something you want to achieve and the planner will turn it into
              habits, milestones and a reading list.
            </span>
          ) : null}
          {list.map((g) => {
            const on = g.id === selected
            const pct = g.milestonesTotal > 0 ? (g.milestonesDone / g.milestonesTotal) * 100 : 0
            return (
              <button
                key={g.id}
                onClick={() => setSelected(g.id)}
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 7,
                  padding: '13px 15px',
                  textAlign: 'left',
                  background: on ? 'var(--panel2)' : 'var(--panel)',
                  border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`,
                  opacity: g.status === 'active' ? 1 : 0.6
                }}
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                  <span className="display" style={{ fontSize: 15, flexGrow: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {g.title}
                  </span>
                  <span className="display" style={{ fontSize: 9, letterSpacing: '0.1em', color: STATUS_COLOR[g.status] }}>
                    {STATUS_LABEL[g.status]}
                  </span>
                </span>
                <Bar value={pct} height={3} color={STATUS_COLOR[g.status]} />
                <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>
                  {g.milestonesDone}/{g.milestonesTotal} milestones · {g.habits.length} session{g.habits.length === 1 ? '' : 's'}
                  {g.daysToTarget !== null && g.status === 'active' ? ` · ${g.daysToTarget}d left` : ''}
                </span>
              </button>
            )
          })}
        </div>

        <div style={{ flexGrow: 1, overflowY: 'auto', minWidth: 0 }}>
          {selected === 'new' ? (
            <GoalWizard
              onDone={() => {
                refetch()
                setSelected(null)
              }}
              onCancel={() => setSelected(null)}
            />
          ) : current ? (
            <Detail
              goal={current}
              onChanged={() => {
                refetch()
                if (!list.some((g) => g.id === current.id)) setSelected(null)
              }}
            />
          ) : (
            <Empty
              title="Pick a goal"
              body="Select one on the left to see its milestones, sessions, mind map and resources — or start a new one."
            />
          )}
        </div>
      </div>
    </Screen>
  )
}
