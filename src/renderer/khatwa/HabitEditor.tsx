import { useEffect, useState } from 'react'
import { Pause, Play, Plus, X } from 'lucide-react'
import type { GoalView, Habit, HabitDraft } from '@shared/types'
import { duration } from '../lib/format'
import { today } from '../lib/khatwa'
import { Alert, Btn, DaysPicker, Field, IconBtn, Modal } from './ui'

const blank = (): HabitDraft => ({
  name: '',
  description: null,
  notes: null,
  recurrence: { kind: 'weekly', days: [1, 2, 3, 4, 5] },
  scheduledTime: '18:00',
  targetMinutes: 30,
  baselineMinutes: 30,
  difficultyLevel: 1,
  reminderLeadMinutes: null,
  colorKey: 'laurel',
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

export default function HabitEditor({
  habit,
  goals,
  onClose
}: {
  habit: Habit | null
  goals: GoalView[]
  onClose: () => void
}) {
  const [draft, setDraft] = useState<HabitDraft>(habit ? toDraft(habit) : blank())
  const [steps, setSteps] = useState<string[]>([])
  const [stepDraft, setStepDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!habit) return
    void window.api.todo
      .templatesFor(habit.id)
      .then((t) => setSteps(t.sort((a, b) => a.position - b.position).map((x) => x.title)))
      .catch(() => undefined)
  }, [habit])

  const weekly = draft.recurrence.kind === 'weekly'
  const days = draft.recurrence.kind === 'weekly' ? draft.recurrence.days : []

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const saved = habit ? await window.api.habits.update(habit.id, draft) : await window.api.habits.create(draft)
      await window.api.todo.setTemplates(saved.id, steps)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const setActive = async (active: boolean): Promise<void> => {
    if (!habit) return
    setBusy(true)
    try {
      await window.api.habits.setActive(habit.id, active)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const invalid = !draft.name.trim() || (weekly && days.length === 0) || draft.targetMinutes <= 0

  return (
    <Modal onClose={onClose} label={habit ? `Edit ${habit.name}` : 'Plant a new habit'} width={720}>
      <form
        className="flex flex-col"
        onSubmit={(e) => {
          e.preventDefault()
          if (!invalid) void save()
        }}
      >
        <div className="flex items-start justify-between gap-4 px-8 pt-7 pb-5 border-b border-[var(--rule)]">
          <div className="flex flex-col gap-1">
            <span className="t-stamp text-[var(--ochre-deep)]">{habit ? 'Tend this rhythm' : 'Plant a new habit rhythm'}</span>
            <h2 className="t-h1 !text-[28px] m-0">{habit ? habit.name || 'Untitled rhythm' : 'A small deliberate step'}</h2>
          </div>
          <IconBtn title="Close" onClick={onClose}>
            <X size={17} />
          </IconBtn>
        </div>

        <div className="px-8 py-6 flex flex-col gap-6 max-h-[62vh] overflow-y-auto">
          {error ? <Alert>{error}</Alert> : null}

          <Field label="The habit">
            <input className="kh-input is-display" autoFocus={!habit} value={draft.name} placeholder="Morning German practice" onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </Field>

          <div className="grid gap-6 grid-cols-[1fr_auto]">
            <div className="flex flex-col gap-2">
              <span className="kh-field-label">Rhythm</span>
              <div className="kh-segmented self-start">
                <button type="button" className={weekly ? 'is-on' : ''} onClick={() => setDraft({ ...draft, recurrence: { kind: 'weekly', days: days.length ? days : [1, 2, 3, 4, 5] } })}>
                  Chosen weekdays
                </button>
                <button
                  type="button"
                  className={!weekly ? 'is-on' : ''}
                  onClick={() => setDraft({ ...draft, recurrence: { kind: 'everyN', n: draft.recurrence.kind === 'everyN' ? draft.recurrence.n : 2, anchor: today() } })}
                >
                  Every few days
                </button>
              </div>
              {draft.recurrence.kind === 'weekly' ? (
                <DaysPicker days={days} onChange={(d) => setDraft({ ...draft, recurrence: { kind: 'weekly', days: d } })} />
              ) : (
                <label className="flex items-center gap-3 text-[14px]">
                  Every
                  <input
                    className="kh-input !w-20 text-center"
                    type="number"
                    min={1}
                    max={30}
                    value={draft.recurrence.n}
                    onChange={(e) => draft.recurrence.kind === 'everyN' && setDraft({ ...draft, recurrence: { ...draft.recurrence, n: Math.max(1, Number(e.target.value)) } })}
                  />
                  days
                </label>
              )}
            </div>
            <Field label="Time of day" hint="Google Tasks cannot hold a time — Khatwa keeps it">
              <input className="kh-input !w-[150px]" type="time" value={draft.scheduledTime} onChange={(e) => setDraft({ ...draft, scheduledTime: e.target.value })} />
            </Field>
          </div>

          <div className="grid gap-6 grid-cols-3">
            <Field label="Target" aside={<span className="t-caption">{duration(draft.targetMinutes)}</span>}>
              <input className="kh-input" type="number" min={1} value={draft.targetMinutes} onChange={(e) => setDraft({ ...draft, targetMinutes: Number(e.target.value) })} />
            </Field>
            <Field label="Baseline" hint="Where the difficulty ladder starts">
              <input className="kh-input" type="number" min={1} value={draft.baselineMinutes} onChange={(e) => setDraft({ ...draft, baselineMinutes: Number(e.target.value) })} />
            </Field>
            <Field label="Reminder" hint="Minutes before · blank uses the default">
              <input
                className="kh-input"
                type="number"
                min={0}
                placeholder="30"
                value={draft.reminderLeadMinutes ?? ''}
                onChange={(e) => setDraft({ ...draft, reminderLeadMinutes: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </Field>
          </div>

          <Field label="Moves you toward" hint="Tie the habit to a mountain, or keep it as personal cultivation">
            <select className="kh-select" value={draft.goalId ?? ''} onChange={(e) => setDraft({ ...draft, goalId: e.target.value ? Number(e.target.value) : null })}>
              <option value="">Unanchored — personal cultivation</option>
              {goals
                .filter((g) => g.status === 'active' || g.id === draft.goalId)
                .map((g) => (
                  <option key={g.id} value={g.id}>
                    {g.title}
                  </option>
                ))}
            </select>
          </Field>

          <div className="flex flex-col gap-2">
            <span className="kh-field-label">Default steps within this rhythm</span>
            <span className="kh-field-hint">Added to each new day of the habit. Finishing every step completes the habit.</span>
            {steps.map((s, i) => (
              <div key={`${s}-${i}`} className="flex items-center gap-2">
                <span className="font-serif text-ink-4 w-5 text-right">{i + 1}.</span>
                <input className="kh-input !py-1.5 !text-[14px] flex-1" value={s} onChange={(e) => setSteps(steps.map((x, j) => (j === i ? e.target.value : x)))} />
                <IconBtn title="Remove step" onClick={() => setSteps(steps.filter((_, j) => j !== i))}>
                  <X size={14} />
                </IconBtn>
              </div>
            ))}
            <div className="flex items-center gap-2">
              <Plus size={14} className="text-ink-4 ml-1.5" />
              <input
                className="kh-input !py-1.5 !text-[14px] flex-1"
                placeholder="Add a default step…"
                value={stepDraft}
                onChange={(e) => setStepDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault()
                    const v = stepDraft.trim()
                    if (v) setSteps([...steps, v])
                    setStepDraft('')
                  }
                }}
              />
            </div>
          </div>

          <Field label="Margin notes" hint="Shown under the step on Today — a line of intention, or what to do first">
            <textarea className="kh-textarea" rows={3} value={draft.notes ?? ''} onChange={(e) => setDraft({ ...draft, notes: e.target.value || null })} />
          </Field>
        </div>

        <div className="flex items-center justify-between gap-3 px-8 py-5 border-t border-[var(--rule)] bg-[var(--sheet)] rounded-b-[14px]">
          {habit ? (
            <Btn kind="soft" disabled={busy} onClick={() => void setActive(!habit.active)}>
              {habit.active ? <Pause size={14} /> : <Play size={14} />}
              {habit.active ? 'Pause this rhythm' : 'Resume this rhythm'}
            </Btn>
          ) : (
            <span />
          )}
          <div className="flex gap-3">
            <Btn kind="soft" onClick={onClose}>
              Cancel
            </Btn>
            <Btn kind="laurel" type="submit" disabled={busy || invalid}>
              {habit ? 'Save rhythm' : 'Plant this habit'}
            </Btn>
          </div>
        </div>
      </form>
    </Modal>
  )
}
