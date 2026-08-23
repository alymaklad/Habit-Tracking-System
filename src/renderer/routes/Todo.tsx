import { useState } from 'react'
import type { TodoGroup, TodoItem } from '@shared/types'
import Screen from '../components/Screen'
import Icon from '../components/Icon'
import { Bar, Button, Card, CardTitle, ErrorState, Label, Loading } from '../components/ui'
import { useData } from '../hooks/useData'
import { addDays, toLocalDate } from '../lib/format'

function Checkbox({ done, onToggle }: { done: boolean; onToggle: () => void }) {
  return (
    <button
      onClick={onToggle}
      role="checkbox"
      aria-checked={done}
      style={{
        width: 18,
        height: 18,
        flexShrink: 0,
        border: `1px solid ${done ? 'var(--ok)' : 'var(--line)'}`,
        background: done ? 'var(--ok)' : 'transparent',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background .12s ease, border-color .12s ease'
      }}
    >
      {done ? <Icon name="check" size={11} color="var(--accent-ink)" strokeWidth={3} /> : null}
    </button>
  )
}

function Row({ item, onChanged }: { item: TodoItem; onChanged: () => void }) {
  const [busy, setBusy] = useState(false)

  const act = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    try {
      await fn()
      onChanged()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 11,
        padding: '9px 12px',
        background: item.done ? 'transparent' : 'var(--panel)',
        border: `1px solid ${item.overdue ? 'var(--bad)' : 'var(--line)'}`,
        opacity: item.done ? 0.55 : 1,
        minWidth: 0
      }}
    >
      <Checkbox
        done={item.done}
        onToggle={() => void act(() => window.api.todo.setDone(item.id, !item.done))}
      />

      <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span
          style={{
            fontSize: 13,
            textDecoration: item.done ? 'line-through' : 'none',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}
        >
          {item.title}
        </span>

        {item.carried > 0 || item.overdue ? (
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {item.carried > 0 ? (
              <span
                style={{ fontSize: 9.5, letterSpacing: '0.06em', color: 'var(--gold)' }}
                title="Pushed forward without being finished"
              >
                CARRIED {item.carried}D
              </span>
            ) : null}
            {item.overdue && !item.done ? (
              <span style={{ fontSize: 9.5, letterSpacing: '0.06em', color: 'var(--bad)' }}>
                OVERDUE
              </span>
            ) : null}
          </span>
        ) : null}
      </div>

      {/* The time is deliberately not repeated per row — the group header carries it,
          and printing it on every step just adds noise. */}
      <button
        disabled={busy}
        title={item.kind === 'manual' ? 'Delete' : 'Drop this step'}
        onClick={() =>
          void act(() =>
            item.kind === 'manual' ? window.api.todo.remove(item.id) : window.api.todo.drop(item.id)
          )
        }
        style={{ color: 'var(--faint)', flexShrink: 0, padding: 2 }}
      >
        <Icon name="close" size={13} strokeWidth={2} />
      </button>
    </div>
  )
}

function Group({ group, onChanged }: { group: TodoGroup; onChanged: () => void }) {
  const [adding, setAdding] = useState('')
  const isHabit = group.habitId !== null
  const pct = group.total > 0 ? (group.done / group.total) * 100 : 0

  const submit = async (): Promise<void> => {
    const title = adding.trim()
    if (!title) return
    setAdding('')
    if (isHabit && group.occurrenceId !== null) {
      await window.api.todo.addSubtask(group.occurrenceId, title)
    } else {
      await window.api.todo.addManual(title)
    }
    onChanged()
  }

  return (
    <Card
      accent={isHabit && group.habitComplete ? 'var(--ok)' : 'var(--line)'}
      style={{ display: 'flex', flexDirection: 'column', gap: 11, minWidth: 0 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0 }}>
          <CardTitle>{isHabit ? group.habitName : 'One-off tasks'}</CardTitle>
          {isHabit && group.scheduledTime ? (
            <span className="num" style={{ fontSize: 11, color: 'var(--faint)' }}>
              {group.scheduledTime}
            </span>
          ) : null}
          {isHabit && group.habitComplete ? (
            <span
              className="display"
              style={{
                fontSize: 9,
                letterSpacing: '0.1em',
                color: 'var(--ok)',
                border: '1px solid var(--ok)',
                padding: '1px 5px'
              }}
            >
              HABIT DONE
            </span>
          ) : null}
        </div>
        <span className="num" style={{ fontSize: 13, color: 'var(--dim)' }}>
          {group.done}/{group.total}
        </span>
      </div>

      <Bar value={pct} color={group.done === group.total ? 'var(--ok)' : 'var(--accent)'} height={3} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {group.items.map((item) => (
          <Row key={item.id} item={item} onChanged={onChanged} />
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={adding}
          placeholder={isHabit ? 'Add a step…' : 'Add a task…'}
          onChange={(e) => setAdding(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit()
          }}
        />
        <Button onClick={() => void submit()} disabled={!adding.trim()}>
          ADD
        </Button>
      </div>

      {isHabit ? (
        <span style={{ fontSize: 10.5, lineHeight: 1.5, color: 'var(--faint)', textWrap: 'pretty' }}>
          Ticking every step marks {group.habitName} complete. Un-ticking one reopens it and takes
          the points back.
        </span>
      ) : null}
    </Card>
  )
}

export default function Todo() {
  const { data, error, loading, refetch } = useData(() => window.api.view.todos(), [])
  const [draft, setDraft] = useState('')

  if (error) {
    return (
      <Screen title="To-do">
        <ErrorState message={error} onRetry={refetch} />
      </Screen>
    )
  }
  if (loading && !data) {
    return (
      <Screen title="To-do">
        <Loading />
      </Screen>
    )
  }
  if (!data) return null

  const add = async (): Promise<void> => {
    const title = draft.trim()
    if (!title) return
    setDraft('')
    await window.api.todo.addManual(title)
    refetch()
  }

  const totalDone = data.manualDone + data.subtaskDone
  const total = data.manualTotal + data.subtaskTotal

  return (
    <Screen
      title="To-do"
      subtitle={`${data.date} · ${totalDone} of ${total} done${
        data.carriedCount > 0 ? ` · ${data.carriedCount} carried` : ''
      }`}
      actions={
        <div style={{ display: 'flex', gap: 8, flexGrow: 1, maxWidth: 420 }}>
          <input
            value={draft}
            placeholder="Add a task and press Enter…"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void add()
            }}
          />
          <Button kind="solid" onClick={() => void add()} disabled={!draft.trim()}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="plus" size={12} strokeWidth={2.2} />
              ADD
            </span>
          </Button>
        </div>
      }
    >
      <div style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* ------------------------------------------ what you keep avoiding */}
        {data.avoidance.length > 0 ? (
          <Card accent="var(--gold)" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <Icon name="warning" size={16} color="var(--gold)" strokeWidth={1.8} />
              <CardTitle>Keeps getting pushed back</CardTitle>
            </div>
            {data.avoidance.map((a) => (
              <div
                key={a.todoId}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '10px 12px',
                  background: 'var(--bg)',
                  border: '1px solid var(--line)',
                  flexWrap: 'wrap'
                }}
              >
                <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 180 }}>
                  <span style={{ fontSize: 12.5 }}>{a.title}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--faint)', textWrap: 'pretty' }}>
                    {a.message}
                  </span>
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <Button
                    onClick={async () => {
                      await window.api.todo.reschedule(a.todoId, addDays(toLocalDate(new Date()), 7))
                      refetch()
                    }}
                  >
                    NEXT WEEK
                  </Button>
                  <Button
                    kind="danger"
                    onClick={async () => {
                      await window.api.todo.drop(a.todoId)
                      refetch()
                    }}
                  >
                    DROP IT
                  </Button>
                </div>
              </div>
            ))}
          </Card>
        ) : null}

        {/* ------------------------------------------------------ suggestions */}
        {data.suggestions.length > 0 ? (
          <Card style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <Label>Suggested from your history</Label>
            {data.suggestions.map((s) => (
              <div
                key={s.title}
                style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}
              >
                <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 180 }}>
                  <span style={{ fontSize: 12.5 }}>{s.title}</span>
                  <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>{s.reason}</span>
                </div>
                <Button
                  kind="solid"
                  onClick={async () => {
                    await window.api.todo.addManual(s.title)
                    refetch()
                  }}
                >
                  ADD
                </Button>
              </div>
            ))}
          </Card>
        ) : null}

        {/* ----------------------------------------------------------- groups */}
        {data.groups.length === 0 ? (
          <Card style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <CardTitle>Nothing on the list</CardTitle>
            <span style={{ fontSize: 12, lineHeight: 1.6, color: 'var(--dim)', textWrap: 'pretty' }}>
              Add a one-off task above, or break a habit into steps — tick every step and the habit
              itself is marked complete. Unfinished tasks follow you into tomorrow rather than being
              quietly lost.
            </span>
          </Card>
        ) : (
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(400px, 1fr))',
              gap: 14,
              alignItems: 'start'
            }}
          >
            {data.groups.map((g) => (
              <Group key={g.occurrenceId ?? 'manual'} group={g} onChanged={refetch} />
            ))}
          </div>
        )}

        <span style={{ fontSize: 10.5, lineHeight: 1.5, color: 'var(--faint)', textWrap: 'pretty' }}>
          One-off tasks are tracked separately and never affect your points, XP or level — those
          measure habit improvement against a target, and anything you can type and tick instantly
          would make them meaningless. Habit steps do count, through the habit they belong to.
        </span>
      </div>
    </Screen>
  )
}
