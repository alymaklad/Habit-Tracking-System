import { useEffect, useState } from 'react'
import type { Habit, HabitDraft } from '@shared/types'
import Screen from '../components/Screen'
import Icon from '../components/Icon'
import { Button, Card, CardTitle, Empty, Field, Label, Tier } from '../components/ui'
import { useData } from '../hooks/useData'
import { describeRecurrence, duration } from '../lib/format'

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

const blank = (): HabitDraft => ({
  name: '',
  description: null,
  notes: null,
  recurrence: { kind: 'weekly', days: [1, 2, 3, 4, 5] },
  scheduledTime: '18:00',
  targetMinutes: 60,
  baselineMinutes: 60,
  difficultyLevel: 1,
  reminderLeadMinutes: null,
  colorKey: 'violet',
  googleTasklistId: null,
  goalId: null,
  active: true
})

const toDraft = (h: Habit): HabitDraft => ({
  name: h.name,
  description: h.description,
  notes: h.notes,
  recurrence: h.recurrence,
  scheduledTime: h.scheduledTime,
  targetMinutes: h.targetMinutes,
  baselineMinutes: h.baselineMinutes,
  difficultyLevel: h.difficultyLevel,
  reminderLeadMinutes: h.reminderLeadMinutes,
  colorKey: h.colorKey,
  googleTasklistId: h.googleTasklistId,
  goalId: h.goalId,
  active: h.active
})

function Editor({
  habit,
  onSaved,
  onCancel
}: {
  habit: Habit | null
  onSaved: () => void
  onCancel: () => void
}) {
  const [draft, setDraft] = useState<HabitDraft>(habit ? toDraft(habit) : blank())
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    setDraft(habit ? toDraft(habit) : blank())
    setError(null)
  }, [habit])

  const days = draft.recurrence.kind === 'weekly' ? draft.recurrence.days : []

  const toggleDay = (d: number): void => {
    if (draft.recurrence.kind !== 'weekly') return
    const next = days.includes(d) ? days.filter((x) => x !== d) : [...days, d]
    setDraft({ ...draft, recurrence: { kind: 'weekly', days: next.sort((a, b) => a - b) } })
  }

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (habit) await window.api.habits.update(habit.id, draft)
      else await window.api.habits.create(draft)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <span className="display" style={{ fontSize: 21 }}>
          {habit ? habit.name || 'Habit' : 'New habit'}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          {habit ? (
            <Button
              onClick={() => void window.api.habits.setActive(habit.id, !habit.active).then(onSaved)}
            >
              {habit.active ? 'PAUSE' : 'RESUME'}
            </Button>
          ) : (
            <Button onClick={onCancel}>CANCEL</Button>
          )}
          <Button kind="solid" disabled={busy} onClick={() => void save()}>
            SAVE
          </Button>
        </div>
      </div>

      {error ? (
        <div
          style={{
            border: '1px solid var(--bad)',
            background: 'color-mix(in oklab, var(--bad) 12%, transparent)',
            padding: '10px 13px',
            fontSize: 12,
            color: 'var(--bad)'
          }}
        >
          {error}
        </div>
      ) : null}

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
        <Field label="Habit name">
          <input
            value={draft.name}
            placeholder="Study AI"
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
        </Field>
        <Field label="Time of day" hint="The app owns this — a Google Task cannot store a time">
          <input
            type="time"
            value={draft.scheduledTime}
            onChange={(e) => setDraft({ ...draft, scheduledTime: e.target.value })}
          />
        </Field>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        <Label>Repeats on</Label>
        <div style={{ display: 'flex', gap: 5 }}>
          {DAYS.map((d, i) => {
            const day = i + 1
            const on = days.includes(day)
            return (
              <button
                key={day}
                onClick={() => toggleDay(day)}
                className="display"
                style={{
                  width: 34,
                  height: 32,
                  fontSize: 12,
                  border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`,
                  background: on ? 'var(--accent)' : 'transparent',
                  color: on ? 'var(--accent-ink)' : 'var(--faint)'
                }}
              >
                {d}
              </button>
            )
          })}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 14 }}>
        <Field label="Target (minutes)">
          <input
            type="number"
            min={1}
            value={draft.targetMinutes}
            onChange={(e) => setDraft({ ...draft, targetMinutes: Number(e.target.value) })}
          />
        </Field>
        <Field label="Baseline (minutes)" hint="Where the difficulty ladder starts">
          <input
            type="number"
            min={1}
            value={draft.baselineMinutes}
            onChange={(e) => setDraft({ ...draft, baselineMinutes: Number(e.target.value) })}
          />
        </Field>
        <Field label="Reminder (minutes before)" hint="Blank uses the global default">
          <input
            type="number"
            min={0}
            value={draft.reminderLeadMinutes ?? ''}
            placeholder="30"
            onChange={(e) =>
              setDraft({
                ...draft,
                reminderLeadMinutes: e.target.value === '' ? null : Number(e.target.value)
              })
            }
          />
        </Field>
      </div>

      <Field label="Notes">
        <textarea
          rows={3}
          value={draft.notes ?? ''}
          onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })}
        />
      </Field>
    </div>
  )
}

export default function Habits() {
  const { data: habits, refetch } = useData(() => window.api.habits.list(), [])
  const { data: proposals } = useData(() => window.api.view.proposals(), [])
  const [selected, setSelected] = useState<number | 'new' | null>(null)

  const list = habits ?? []
  const active = list.filter((h) => h.active).length
  const current = selected === 'new' ? null : (list.find((h) => h.id === selected) ?? null)
  const showEditor = selected !== null

  return (
    <Screen
      title="Habits"
      subtitle={`${list.length} habit${list.length === 1 ? '' : 's'} · ${active} active`}
      actions={
        <Button kind="solid" onClick={() => setSelected('new')}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <Icon name="plus" size={12} strokeWidth={2.2} />
            NEW HABIT
          </span>
        </Button>
      }
      scroll={false}
    >
      <div style={{ flexGrow: 1, display: 'flex', minHeight: 0 }}>
        <div
          style={{
            width: 372,
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
            <span style={{ fontSize: 12, color: 'var(--faint)', lineHeight: 1.6 }}>
              No habits yet. Create one to start — the schedule and every statistic work
              offline, with or without Google.
            </span>
          ) : null}

          {list.map((h) => {
            const on = h.id === selected
            return (
              <button
                key={h.id}
                onClick={() => setSelected(h.id)}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 13,
                  padding: '13px 15px',
                  textAlign: 'left',
                  background: on ? 'var(--panel2)' : 'var(--panel)',
                  border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`,
                  opacity: h.active ? 1 : 0.55
                }}
              >
                <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                    <span className="display" style={{ fontSize: 16 }}>
                      {h.name}
                    </span>
                    <Tier level={h.difficultyLevel} />
                    {!h.active ? (
                      <span
                        style={{
                          fontSize: 9,
                          letterSpacing: '0.1em',
                          color: 'var(--faint)',
                          border: '1px solid var(--line)',
                          padding: '1px 5px'
                        }}
                      >
                        PAUSED
                      </span>
                    ) : null}
                  </span>
                  <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>
                    {describeRecurrence(h.recurrence)} · {h.scheduledTime} ·{' '}
                    {duration(h.targetMinutes)}
                  </span>
                </span>
              </button>
            )
          })}
        </div>

        <div style={{ flexGrow: 1, overflowY: 'auto', minWidth: 0 }}>
          {showEditor ? (
            <>
              <Editor
                habit={current}
                onSaved={() => {
                  refetch()
                  setSelected(null)
                }}
                onCancel={() => setSelected(null)}
              />

              {current && (proposals ?? []).some((p) => p.habitId === current.id) ? (
                <div style={{ padding: '0 24px 24px' }}>
                  {(proposals ?? [])
                    .filter((p) => p.habitId === current.id)
                    .map((p) => (
                      <Card key={p.id} accent="var(--gold)" style={{ display: 'flex', gap: 15, alignItems: 'center' }}>
                        <Icon name="achievements" size={22} color="var(--gold)" strokeWidth={1.6} />
                        <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 3 }}>
                          <CardTitle>Difficulty suggestion</CardTitle>
                          <span style={{ fontSize: 11, color: 'var(--dim)', textWrap: 'pretty' }}>
                            {p.rationale}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
                          <Button onClick={() => void window.api.proposal.reject(p.id)}>DISMISS</Button>
                          <Button kind="gold" onClick={() => void window.api.proposal.accept(p.id)}>
                            APPLY
                          </Button>
                        </div>
                      </Card>
                    ))}
                </div>
              ) : null}
            </>
          ) : (
            <Empty
              title="Select a habit"
              body="Pick one from the list to edit its schedule, target and difficulty — or create a new one."
            />
          )}
        </div>
      </div>
    </Screen>
  )
}
