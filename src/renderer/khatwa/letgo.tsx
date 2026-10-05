import { useEffect, useState } from 'react'
import { ChevronLeft, ChevronRight, Compass, Lightbulb, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import {
  LETGO_FEELINGS,
  TRIGGER_CONTEXTS,
  type GoalView,
  type GuideInsight,
  type LetGoCheckin,
  type LetGoDraft,
  type LetGoFeeling,
  type LetGoView,
  type LetGoWeight,
  type Tool,
  type TriggerContext
} from '@shared/types'
import { addDays } from '../lib/format'
import { dayMonth, today } from '../lib/khatwa'
import { useShell } from './nav'
import { Alert, Btn, Field, IconBtn, Modal, Stamp } from './ui'

export const WEIGHT_LABEL: Record<LetGoWeight, string> = { light: 'Light weight', medium: 'Medium weight', heavy: 'Heavy weight' }
export const WEIGHT_TONE: Record<LetGoWeight, 'laurel' | 'plain' | 'ochre-solid'> = { light: 'laurel', medium: 'plain', heavy: 'ochre-solid' }

export const CONTEXT_LABEL: Record<TriggerContext, string> = {
  morning: 'Morning',
  work: 'Work / study',
  evening: 'Evening',
  before_sleep: 'Before sleep',
  boredom: 'Boredom',
  stress: 'Stress',
  other: 'Other'
}

export const FEELING_LABEL: Record<LetGoFeeling, string> = {
  stressed: 'Stressed',
  bored: 'Bored',
  tired: 'Tired',
  lonely: 'Lonely',
  overwhelmed: 'Overwhelmed',
  frustrated: 'Frustrated',
  other: 'Something else'
}

const ALTERNATIVE_IDEAS = ['Read', 'Walk', 'Journal', 'Sleep', 'Work on my mountain']
const NEED_IDEAS = ['Rest without screens', 'Real disconnection', 'Emotional relief', 'Physical movement', 'Company']

function Chips<T extends string>({ options, labels, value, onChange }: { options: readonly T[]; labels?: Record<T, string>; value: T[]; onChange: (v: T[]) => void }) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((o) => {
        const on = value.includes(o)
        return (
          <button type="button" key={o} className={`kh-chip ${on ? 'is-on' : ''}`} aria-pressed={on} onClick={() => onChange(on ? value.filter((x) => x !== o) : [...value, o])}>
            {labels ? labels[o] : o}
          </button>
        )
      })}
    </div>
  )
}

/** Suggestion chips that fill a free-text field — the text stays the user's to change. */
function Suggest({ ideas, onPick }: { ideas: string[]; onPick: (v: string) => void }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {ideas.map((i) => (
        <button type="button" key={i} className="kh-chip !py-1 !text-[12px]" onClick={() => onPick(i)}>
          + {i}
        </button>
      ))}
    </div>
  )
}

// ---------------------------------------------------------------- create / edit

export function LetGoForm({ initial, goals, onClose, onSaved }: { initial: LetGoView | null; goals: GoalView[]; onClose: () => void; onSaved?: (id: number) => void }) {
  const [d, setD] = useState<LetGoDraft>(
    initial
      ? {
          title: initial.title,
          triggerContexts: initial.triggerContexts,
          triggerNotes: initial.triggerNotes,
          replacement: initial.replacement,
          goalId: initial.goalId,
          weight: initial.weight,
          startedOn: initial.startedOn
        }
      : { title: '', triggerContexts: [], triggerNotes: null, replacement: null, goalId: goals.find((g) => g.status === 'active')?.id ?? null, weight: 'medium', startedOn: today() }
  )
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      if (initial) {
        await window.api.letGo.update(initial.id, d)
        onSaved?.(initial.id)
      } else {
        const v = await window.api.letGo.create(d)
        onSaved?.(v.id)
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal onClose={onClose} label={initial ? 'Edit what you are carrying' : 'Add something to let go'} width={700}>
      <form
        className="flex flex-col"
        onSubmit={(e) => {
          e.preventDefault()
          if (d.title.trim()) void save()
        }}
      >
        <div className="flex items-start justify-between gap-4 px-8 pt-7 pb-5 border-b border-[var(--rule)]">
          <div className="flex flex-col gap-1">
            <span className="t-stamp text-[var(--ochre-deep)]">{initial ? 'Re-weigh this item' : 'Into the backpack'}</span>
            <h2 className="t-h1 !text-[28px] m-0">What are you ready to leave behind?</h2>
          </div>
          <IconBtn title="Close" onClick={onClose}>
            <X size={17} />
          </IconBtn>
        </div>
        <div className="px-8 py-6 flex flex-col gap-6 max-h-[62vh] overflow-y-auto">
          {error ? <Alert>{error}</Alert> : null}
          <Field label="The behaviour">
            <input className="kh-input is-display" autoFocus value={d.title} placeholder="Late-night scrolling" onChange={(e) => setD({ ...d, title: e.target.value })} />
          </Field>
          <div className="flex flex-col gap-2">
            <span className="kh-field-label">When does it usually happen?</span>
            <Chips options={TRIGGER_CONTEXTS} labels={CONTEXT_LABEL} value={d.triggerContexts} onChange={(v) => setD({ ...d, triggerContexts: v })} />
          </div>
          <Field label="What usually triggers it?" hint="Optional — whatever you notice, in your own words">
            <textarea className="kh-textarea" rows={2} value={d.triggerNotes ?? ''} placeholder="A long day, a hard bug, lying in bed with the phone…" onChange={(e) => setD({ ...d, triggerNotes: e.target.value })} />
          </Field>
          <Field label="What would you like to do instead?">
            <input className="kh-input" value={d.replacement ?? ''} placeholder="Read a paper book" onChange={(e) => setD({ ...d, replacement: e.target.value })} />
          </Field>
          <Suggest ideas={ALTERNATIVE_IDEAS} onPick={(v) => setD({ ...d, replacement: v })} />
          <div className="grid gap-6 grid-cols-[1fr_auto]">
            <Field label="Which mountain does this help?">
              <select className="kh-select" value={d.goalId ?? ''} onChange={(e) => setD({ ...d, goalId: e.target.value ? Number(e.target.value) : null })}>
                <option value="">No particular mountain</option>
                {goals
                  .filter((g) => g.status === 'active' || g.id === d.goalId)
                  .map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
              </select>
            </Field>
            <Field label="Tracking since">
              <input className="kh-input !w-[160px]" type="date" max={today()} value={d.startedOn} onChange={(e) => setD({ ...d, startedOn: e.target.value })} />
            </Field>
          </div>
          <div className="flex flex-col gap-2">
            <span className="kh-field-label">How heavy does it feel?</span>
            <div className="kh-segmented self-start">
              {(['light', 'medium', 'heavy'] as const).map((w) => (
                <button type="button" key={w} className={d.weight === w ? 'is-on' : ''} onClick={() => setD({ ...d, weight: w })}>
                  {w[0]!.toUpperCase() + w.slice(1)}
                </button>
              ))}
            </div>
            <span className="kh-field-hint">A feeling, not a measurement. You can re-weigh it any time.</span>
          </div>
        </div>
        <div className="flex justify-end gap-3 px-8 py-5 border-t border-[var(--rule)] bg-[var(--sheet)] rounded-b-[14px]">
          <Btn kind="soft" onClick={onClose}>
            Cancel
          </Btn>
          <Btn kind="laurel" type="submit" disabled={busy || !d.title.trim()}>
            {initial ? 'Save' : 'Put it in my backpack'}
          </Btn>
        </div>
      </form>
    </Modal>
  )
}

// -------------------------------------------------------------------- check-in

export function CheckInModal({ item, date, onClose }: { item: LetGoView; date: string; onClose: () => void }) {
  const existing = item.checkins.find((c) => c.date === date) ?? null
  const [resisted, setResisted] = useState<boolean | null>(existing ? existing.resisted : null)
  const [feelings, setFeelings] = useState<LetGoFeeling[]>(existing?.feelings ?? [])
  const [trigger, setTrigger] = useState(existing?.trigger ?? '')
  const [need, setNeed] = useState(existing?.need ?? '')
  const [alternative, setAlternative] = useState(existing?.alternative ?? item.replacement ?? '')
  const [note, setNote] = useState(existing?.note ?? '')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const isToday = date === today()

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const ideas = [...new Set([item.replacement, ...item.alternatives.map((a) => a.text)].filter((x): x is string => !!x))].slice(0, 5)

  return (
    <Modal onClose={onClose} label={`Check in: ${item.title}`} width={640}>
      <div className="flex flex-col">
        <div className="flex items-start justify-between gap-4 px-8 pt-7 pb-5 border-b border-[var(--rule)]">
          <div className="flex flex-col gap-1">
            <span className="t-stamp text-[var(--ochre-deep)]">{isToday ? 'The evening inventory' : `Recording ${dayMonth(date)}`}</span>
            <h2 className="t-h1 !text-[28px] m-0">{item.title}</h2>
          </div>
          <IconBtn title="Close" onClick={onClose}>
            <X size={17} />
          </IconBtn>
        </div>
        <div className="px-8 py-6 flex flex-col gap-5 max-h-[64vh] overflow-y-auto">
          {error ? <Alert>{error}</Alert> : null}
          <span className="t-h2">Did you leave this behind {isToday ? 'today' : 'that day'}?</span>
          <div className="grid grid-cols-2 gap-3">
            <button type="button" className={`rounded-[10px] p-4 text-left flex flex-col gap-1 border ${resisted === true ? 'bg-[var(--laurel-wash)] border-[var(--laurel)]' : 'bg-[var(--sheet)] border-[var(--rule-soft)]'}`} onClick={() => setResisted(true)} aria-pressed={resisted === true}>
              <span className="text-[16px] font-semibold flex items-center gap-2">
                <X size={16} className="text-laurel" strokeWidth={3} /> Yes, I left it behind
              </span>
              <span className="t-caption">A day you chose differently.</span>
            </button>
            <button type="button" className={`rounded-[10px] p-4 text-left flex flex-col gap-1 border ${resisted === false ? 'bg-[var(--ochre-wash)] border-[var(--ochre)]' : 'bg-[var(--sheet)] border-[var(--rule-soft)]'}`} onClick={() => setResisted(false)} aria-pressed={resisted === false}>
              <span className="text-[16px] font-semibold flex items-center gap-2">
                <RotateCcw size={15} className="text-[var(--ochre-deep)]" /> It returned
              </span>
              <span className="t-caption">Nothing is reset. Every free day still counts.</span>
            </button>
          </div>

          {resisted === true ? (
            <div className="flex flex-col gap-4 kh-rise">
              <Field label="What helped instead?" hint="Optional — the Guide notices what works for you over time">
                <input className="kh-input" value={alternative} placeholder="Read a paper book" onChange={(e) => setAlternative(e.target.value)} />
              </Field>
              {ideas.length ? <Suggest ideas={ideas} onPick={setAlternative} /> : null}
            </div>
          ) : null}

          {resisted === false ? (
            <div className="flex flex-col gap-5 kh-rise">
              <div className="kh-sheet p-5 flex flex-col gap-1">
                <span className="t-h2">The habit returned. Let’s understand what happened.</span>
                <span className="t-italic !text-[15px]">Everything below is optional. The weight is not reset — you are learning the terrain of your mind.</span>
              </div>
              <div className="flex flex-col gap-2">
                <span className="kh-field-label">What were you feeling?</span>
                <Chips options={LETGO_FEELINGS} labels={FEELING_LABEL} value={feelings} onChange={setFeelings} />
              </div>
              <Field label="What happened before the urge?">
                <textarea className="kh-textarea" rows={2} value={trigger} placeholder="Finished late, head buzzing…" onChange={(e) => setTrigger(e.target.value)} />
              </Field>
              <Field label="What did you actually need in that moment?">
                <input className="kh-input" value={need} placeholder="Rest without screens" onChange={(e) => setNeed(e.target.value)} />
              </Field>
              <Suggest ideas={NEED_IDEAS} onPick={setNeed} />
            </div>
          ) : null}

          {resisted !== null ? (
            <Field label="Note" hint="A short note, if you like">
              <textarea className="kh-textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
          ) : null}
        </div>
        <div className="flex items-center justify-between gap-3 px-8 py-5 border-t border-[var(--rule)] bg-[var(--sheet)] rounded-b-[14px]">
          {existing ? (
            <Btn kind="ghost" disabled={busy} onClick={() => void run(() => window.api.letGo.clearCheckIn(item.id, date))}>
              Clear this day
            </Btn>
          ) : (
            <span />
          )}
          <div className="flex gap-3">
            <Btn kind="soft" onClick={onClose}>
              Cancel
            </Btn>
            <Btn
              kind="laurel"
              disabled={busy || resisted === null}
              onClick={() =>
                void run(() => window.api.letGo.checkIn(item.id, date, { resisted: resisted!, feelings, trigger, need, alternative, note }))
              }
            >
              Stamp {isToday ? 'today' : 'the day'}
            </Btn>
          </div>
        </div>
      </div>
    </Modal>
  )
}

// --------------------------------------------------------------- freedom views

type DayState = 'free' | 'returned' | 'open' | 'future' | 'before'

export function dayState(item: LetGoView, date: string, now = today()): DayState {
  if (date > now) return 'future'
  if (date < item.startedOn) return 'before'
  const c = item.checkins.find((x) => x.date === date)
  if (!c) return 'open'
  return c.resisted ? 'free' : 'returned'
}

/** The last N days as ink dots — green X for free, a soft ochre dot when it returned. */
export function FreedomDots({ item, days = 24 }: { item: LetGoView; days?: number }) {
  const now = today()
  const dates = Array.from({ length: days }, (_, i) => addDays(now, i - days + 1))
  return (
    <div className="flex flex-wrap gap-1.5" role="img" aria-label={`Last ${days} days: ${item.checkins.filter((c) => dates.includes(c.date) && c.resisted).length} free`}>
      {dates.map((d) => {
        const s = dayState(item, d, now)
        return (
          <span
            key={d}
            title={`${dayMonth(d)}: ${s === 'free' ? 'left behind' : s === 'returned' ? 'returned' : s === 'before' ? 'before tracking' : 'not recorded'}`}
            className="w-3.5 h-3.5 rounded-full grid place-items-center"
            style={{
              background: s === 'free' ? 'var(--laurel-deep)' : s === 'returned' ? 'var(--ochre-tint)' : 'transparent',
              border: s === 'open' || s === 'before' ? '1px dashed var(--rule)' : 'none'
            }}
          />
        )
      })}
    </div>
  )
}

export function GreenXMonth({ item, onPick }: { item: LetGoView; onPick: (date: string) => void }) {
  const now = today()
  const [month, setMonth] = useState(now.slice(0, 7))
  useEffect(() => setMonth(now.slice(0, 7)), [item.id, now])
  const first = new Date(`${month}-01T12:00:00`)
  const lead = (first.getDay() + 6) % 7 // Monday first
  const len = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate()
  const cells = Array.from({ length: lead + len }, (_, i) => (i < lead ? null : `${month}-${String(i - lead + 1).padStart(2, '0')}`))
  const shift = (n: number): void => {
    const d = new Date(`${month}-15T12:00:00`)
    d.setMonth(d.getMonth() + n)
    setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`)
  }
  const inMonth = item.checkins.filter((c) => c.date.startsWith(month))
  const free = inMonth.filter((c) => c.resisted).length

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-baseline gap-3">
          <span className="font-serif text-[30px] leading-9">{first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</span>
        </div>
        <span className="flex gap-1">
          <IconBtn title="Previous month" onClick={() => shift(-1)}>
            <ChevronLeft size={16} />
          </IconBtn>
          <IconBtn title="Next month" onClick={() => shift(1)} disabled={month >= now.slice(0, 7)}>
            <ChevronRight size={16} />
          </IconBtn>
        </span>
      </div>
      <div className="flex items-center gap-3">
        <Stamp tone="laurel">{inMonth.length ? `${Math.round((free / inMonth.length) * 100)}% freedom rate` : 'Nothing recorded'}</Stamp>
        <span className="text-[13px] text-ink-3">
          {free} of {inMonth.length} recorded days free
        </span>
      </div>
      <div className="grid grid-cols-7 gap-1.5">
        {['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].map((d) => (
          <span key={d} className="t-stamp !text-[10px] text-ink-4 text-center pb-1">
            {d}
          </span>
        ))}
        {cells.map((d, i) => {
          if (!d) return <span key={`b${i}`} />
          const s = dayState(item, d, now)
          const disabled = s === 'future' || s === 'before'
          const label = `${dayMonth(d)}: ${s === 'free' ? 'left behind' : s === 'returned' ? 'returned, noted' : s === 'future' ? 'not yet' : s === 'before' ? 'before tracking began' : 'not recorded'}`
          return (
            <button
              key={d}
              disabled={disabled}
              onClick={() => onPick(d)}
              title={label}
              aria-label={label}
              className={`relative aspect-square rounded-md flex flex-col p-1.5 text-left ${disabled ? 'opacity-40' : 'hover:ring-1 hover:ring-[var(--laurel)]'} ${
                s === 'free' ? 'bg-[var(--laurel-wash)]' : s === 'returned' ? 'bg-[var(--ochre-wash)]' : 'bg-[var(--sheet)]'
              } ${d === now ? 'ring-2 ring-[var(--ochre)]' : ''}`}
            >
              <span className="text-[10.5px] text-ink-4 t-num">{d.slice(8)}</span>
              <span className="flex-1 grid place-items-center">
                {s === 'free' ? <X size={20} strokeWidth={2.4} className="text-[var(--laurel-deep)]" /> : s === 'returned' ? <span className="w-2 h-2 rounded-full bg-[var(--ochre-deep)]" /> : d === now ? <span className="t-stamp !text-[9px] text-[var(--ochre-deep)]">today</span> : null}
              </span>
            </button>
          )
        })}
      </div>
      <div className="flex flex-wrap gap-5 t-caption">
        <span className="flex items-center gap-1.5">
          <X size={13} className="text-laurel" strokeWidth={2.6} /> Left behind
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-full bg-[var(--ochre-deep)]" /> Returned, noted — never reset
        </span>
        <span className="flex items-center gap-1.5">
          <span className="w-3 h-3 rounded-sm bg-[var(--sheet)] border border-[var(--rule)]" /> Not recorded
        </span>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------ the guide

export function GuideCard({ insight, onAct }: { insight: GuideInsight; onAct?: () => void }) {
  const { navigate, toast } = useShell()
  const [busy, setBusy] = useState(false)

  const act = async (): Promise<void> => {
    const a = insight.action
    if (!a) return
    setBusy(true)
    try {
      if (a.kind === 'add-tool') {
        await window.api.tools.save(null, { title: a.title, description: null, goalId: a.goalId, habitId: null })
        toast('success', 'Kept as one of your tools', a.title)
      } else if (a.kind === 'open-letgo') navigate({ name: 'letgo', id: a.id })
      else if (a.kind === 'ceremony') navigate({ name: 'ceremony', id: a.id })
      else if (a.kind === 'open-mountain') navigate({ name: 'mountain', id: a.id })
      else if (a.kind === 'write') navigate({ name: 'journal', prompt: a.prompt, goalId: a.goalId })
      onAct?.()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="kh-docket p-5 flex gap-4">
      <span className="w-10 h-10 rounded-xl grid place-items-center bg-[var(--card)] text-[var(--ochre-deep)] shrink-0">
        <Lightbulb size={18} />
      </span>
      <div className="flex flex-col gap-2 min-w-0">
        <span className="flex items-center gap-2 flex-wrap">
          <span className="text-[16px] font-semibold">Your Guide noticed</span>
          <span className="t-stamp !text-[10px] text-ink-4">From what you logged</span>
        </span>
        <p className="m-0 font-serif text-[16.5px] leading-[26px] text-ink-2 [text-wrap:pretty]">{insight.observation}</p>
        <span className="t-caption">{insight.evidence}</span>
        <span className="flex flex-wrap items-center gap-4 mt-1">
          {insight.action ? (
            <button className="text-[13px] font-semibold text-[var(--ochre-deep)] hover:underline disabled:opacity-50" disabled={busy} onClick={() => void act()}>
              {insight.action.label} →
            </button>
          ) : null}
          <button className="text-[13px] text-ink-4 hover:text-ink" onClick={() => void window.api.guide.dismiss(insight.key)}>
            Not now
          </button>
        </span>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------- tools

export function ToolsPanel({ tools, goals, goalId, title = 'What helps me climb' }: { tools: Tool[]; goals: GoalView[]; goalId?: number; title?: string }) {
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const shown = goalId === undefined ? tools : tools.filter((t) => t.goalId === goalId || t.goalId === null)
  const goalTitle = (id: number | null): string | null => (id === null ? null : (goals.find((g) => g.id === id)?.title ?? null))

  const run = (fn: () => Promise<unknown>): void => {
    setError(null)
    fn().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-baseline justify-between gap-3">
        <span className="t-h3 flex items-center gap-2">
          <Compass size={17} className="text-laurel" /> {title}
        </span>
        <span className="t-caption">{shown.length} tools</span>
      </div>
      {error ? <Alert>{error}</Alert> : null}
      {shown.length === 0 ? <span className="t-italic !text-[14px]">Routines, places and small rituals that make the next step easier.</span> : null}
      {shown.map((t) => (
        <div key={t.id} className="kh-card px-4 py-3 flex items-center gap-3 group">
          <span className="w-2 h-2 rounded-full bg-[var(--laurel)] shrink-0" />
          <span className="flex flex-col min-w-0 flex-1">
            <span className="text-[14px] font-semibold truncate">{t.title}</span>
            {goalTitle(t.goalId) && goalId === undefined ? <span className="t-caption truncate">Helps: {goalTitle(t.goalId)}</span> : null}
          </span>
          <span className="opacity-0 group-hover:opacity-100">
            <IconBtn title={`Remove ${t.title}`} onClick={() => run(() => window.api.tools.remove(t.id))}>
              <Trash2 size={13} />
            </IconBtn>
          </span>
        </div>
      ))}
      <form
        className="flex items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault()
          const title_ = draft.trim()
          if (!title_) return
          setDraft('')
          run(() => window.api.tools.save(null, { title: title_, description: null, goalId: goalId ?? null, habitId: null }))
        }}
      >
        <Plus size={14} className="text-ink-4" />
        <input className="kh-input !text-[14px] !py-1.5" placeholder="Add something that helps — morning routine, phone outside the bedroom…" value={draft} onChange={(e) => setDraft(e.target.value)} />
      </form>
    </div>
  )
}

export function lastCheckin(item: LetGoView): LetGoCheckin | null {
  return item.checkins[item.checkins.length - 1] ?? null
}
