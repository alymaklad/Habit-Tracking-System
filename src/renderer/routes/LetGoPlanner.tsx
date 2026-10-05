import { useEffect, useState } from 'react'
import { ArrowLeft, ArrowRight, Hourglass, Plus, RefreshCw, Sparkles, Trash2, X } from 'lucide-react'
import {
  TRIGGER_CONTEXTS,
  type AiStatus,
  type GoalPlanProgress,
  type GoalSession,
  type LetGoPlan,
  type LetGoPlanInput,
  type LetGoWeight
} from '@shared/types'
import { useTick } from '../hooks/useData'
import { duration } from '../lib/format'
import { plural } from '../lib/khatwa'
import { CONTEXT_LABEL, WEIGHT_LABEL } from '../khatwa/letgo'
import { useShell } from '../khatwa/nav'
import { Page, PageHead } from '../khatwa/Page'
import { Alert, Btn, DaysPicker, Field, IconBtn } from '../khatwa/ui'

type Step = 'describe' | 'planning' | 'review'

const clean = (err: unknown): string =>
  err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '') : String(err)

const PHASE_TEXT: Record<GoalPlanProgress['phase'], string> = {
  researching: 'Getting started',
  drafting: 'Writing a first plan',
  reviewing: 'Checking the plan',
  revising: 'Improving the plan'
}

/** Plan, with the AI planner, how to let a habit go — then change anything before saving. */
export default function LetGoPlanner() {
  const { navigate, toast } = useShell()
  const [step, setStep] = useState<Step>('describe')
  const [title, setTitle] = useState('')
  const [story, setStory] = useState('')
  const [minutes, setMinutes] = useState(120)
  const [plan, setPlan] = useState<LetGoPlan | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [notes, setNotes] = useState<string[]>([])
  const [progress, setProgress] = useState<GoalPlanProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [ai, setAi] = useState<AiStatus | null>(null)

  useEffect(() => {
    void window.api.ai.status().then(setAi).catch(() => undefined)
  }, [])
  useEffect(() => window.api.on.goalProgress(setProgress), [])

  const input: LetGoPlanInput = { title: title.trim(), description: story.trim() || null, weeklyMinutesBudget: minutes }

  const draft = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    setProgress(null)
    setStep('planning')
    try {
      const result = await window.api.letGoPlan.draft(input)
      setPlan(result.plan)
      setWarnings(result.warnings)
      setNotes(result.notes)
      setStep('review')
    } catch (err) {
      setError(clean(err))
      setStep('describe')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const save = async (): Promise<void> => {
    if (!plan) return
    setError(null)
    setBusy(true)
    try {
      const item = await window.api.letGoPlan.save(input, plan)
      toast('success', 'Your plan is saved.', `${plural(plan.sessions.length, 'new habit')} added. Check in each evening on Let Go.`)
      navigate({ name: 'letgo', id: item.id })
    } catch (err) {
      setError(clean(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      {step === 'describe' ? (
        <Describe
          title={title}
          setTitle={setTitle}
          story={story}
          setStory={setStory}
          minutes={minutes}
          setMinutes={setMinutes}
          ai={ai}
          error={error}
          onCancel={() => navigate({ name: 'letgo' })}
          onPlan={() => void draft()}
        />
      ) : null}
      {step === 'planning' ? <Planning title={input.title} progress={progress} /> : null}
      {step === 'review' && plan ? (
        <Review
          title={input.title}
          plan={plan}
          setPlan={setPlan}
          warnings={warnings}
          notes={notes}
          busy={busy}
          error={error}
          onBack={() => setStep('describe')}
          onRedraft={() => void draft()}
          onSave={() => void save()}
        />
      ) : null}
    </Page>
  )
}

function Describe({
  title,
  setTitle,
  story,
  setStory,
  minutes,
  setMinutes,
  ai,
  error,
  onCancel,
  onPlan
}: {
  title: string
  setTitle: (v: string) => void
  story: string
  setStory: (v: string) => void
  minutes: number
  setMinutes: (v: number) => void
  ai: AiStatus | null
  error: string | null
  onCancel: () => void
  onPlan: () => void
}) {
  const { navigate } = useShell()
  const provider = ai?.providers.find((p) => p.id === ai.provider)
  return (
    <>
      <PageHead
        title="Plan to let a habit go"
        lede="Tell the planner about a habit you want to stop. It suggests what to do instead, new habits to fill the gap, and things that make it easier. You can change everything before it is saved."
      />
      <section className="kh-card p-7 flex flex-col gap-6 max-w-[760px]">
        {ai && !ai.ready ? (
          <Alert tone="ochre">
            The planner needs {provider ? `${/^[aeiou]/i.test(provider.label) ? 'an' : 'a'} ${provider.label}` : 'an'} API key first.{' '}
            <button className="underline font-semibold" onClick={() => navigate({ name: 'settings' })}>
              Add one in Settings → AI planner
            </button>
            .
          </Alert>
        ) : null}
        {error ? <Alert>{error}</Alert> : null}
        <Field label="What habit do you want to stop?">
          <input className="kh-input is-display" value={title} placeholder="Late-night scrolling" onChange={(e) => setTitle(e.target.value)} autoFocus />
        </Field>
        <Field label="When does it happen, and why do you want to stop?" hint="The more you say, the better the plan fits you.">
          <textarea
            className="kh-textarea"
            rows={4}
            value={story}
            placeholder="I scroll in bed for an hour most nights. I sleep badly and feel tired the next day."
            onChange={(e) => setStory(e.target.value)}
          />
        </Field>
        <Field label="Time per week for new habits" aside={<span className="font-serif text-[20px]">{duration(minutes)}</span>}>
          <input className="kh-range" type="range" min={30} max={600} step={15} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="Time per week for new habits" />
        </Field>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
          <Btn kind="ghost" onClick={onCancel}>
            <ArrowLeft size={15} /> Back to Let Go
          </Btn>
          <Btn kind="laurel" size="lg" disabled={!title.trim() || (ai !== null && !ai.ready)} onClick={onPlan}>
            Make my plan <ArrowRight size={17} />
          </Btn>
        </div>
      </section>
    </>
  )
}

function Planning({ title, progress }: { title: string; progress: GoalPlanProgress | null }) {
  useTick(1000)
  const waitLeft = progress?.waitingUntil ? Math.max(0, Math.ceil((progress.waitingUntil - Date.now()) / 1000)) : 0
  return (
    <>
      <PageHead title="Making your plan" lede={`For letting go of “${title}”. This takes about a minute.`} />
      <section className="kh-card p-7 flex flex-col gap-4 max-w-[760px]" role="status" aria-live="polite">
        <span className="flex items-center gap-3 text-[17px] font-semibold">
          <span className="kh-dot kh-breathe" /> {progress ? PHASE_TEXT[progress.phase] : PHASE_TEXT.drafting}
        </span>
        {progress && progress.iteration > 1 ? (
          <span className="flex items-center gap-2 text-[14px] text-ink-3">
            <RefreshCw size={14} className="kh-spin" /> Draft {progress.iteration} of {progress.maxIterations}: the checker asked for changes.
          </span>
        ) : null}
        {waitLeft > 0 ? (
          <span className="kh-docket px-3.5 py-2.5 flex items-center gap-3 text-[13px] text-ink-2">
            <Hourglass size={15} className="text-[var(--ochre-deep)] shrink-0" />
            The AI service is busy — trying again in <b className="t-num">{waitLeft} s</b>.
          </span>
        ) : null}
        <p className="m-0 text-[14px] text-ink-3">Each draft is checked against your current schedule, then by a separate reviewer.</p>
      </section>
    </>
  )
}

function Review({
  title,
  plan,
  setPlan,
  warnings,
  notes,
  busy,
  error,
  onBack,
  onRedraft,
  onSave
}: {
  title: string
  plan: LetGoPlan
  setPlan: (p: LetGoPlan) => void
  warnings: string[]
  notes: string[]
  busy: boolean
  error: string | null
  onBack: () => void
  onRedraft: () => void
  onSave: () => void
}) {
  const setSession = (i: number, patch: Partial<GoalSession>): void =>
    setPlan({ ...plan, sessions: plan.sessions.map((s, j) => (j === i ? { ...s, ...patch } : s)) })
  const invalid =
    !plan.replacement.trim() ||
    plan.triggerContexts.length === 0 ||
    plan.sessions.some((s) => !s.name.trim() || s.days.length === 0 || s.targetMinutes < 5)

  return (
    <>
      <PageHead title="Your plan" lede={plan.summary} />
      <p className="t-italic m-0 mb-6">Letting go of “{title}”</p>

      {warnings.length > 0 || notes.length > 0 ? (
        <div className="mb-6 flex flex-col gap-3 max-w-[900px]">
          {warnings.length > 0 ? (
            <Alert tone="ochre">
              <b className="font-semibold">Check {warnings.length === 1 ? 'this' : 'these'} before you save</b>
              <ul className="mt-1.5 mb-0 pl-5">
                {warnings.map((w, i) => (
                  <li key={i}>{w}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
          {notes.length > 0 ? (
            <Alert tone="laurel">
              <b className="font-semibold">Adjusted for you</b>
              <ul className="mt-1.5 mb-0 pl-5">
                {notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            </Alert>
          ) : null}
        </div>
      ) : null}

      <div className="grid gap-6 min-[1100px]:grid-cols-2">
        <section className="kh-card p-6 flex flex-col gap-5">
          <h2 className="t-h3 m-0">When it happens</h2>
          <div className="flex flex-wrap gap-2" role="group" aria-label="When it happens">
            {TRIGGER_CONTEXTS.map((c) => {
              const on = plan.triggerContexts.includes(c)
              return (
                <button
                  key={c}
                  type="button"
                  className={`kh-chip ${on ? 'is-on' : ''}`}
                  aria-pressed={on}
                  onClick={() => setPlan({ ...plan, triggerContexts: on ? plan.triggerContexts.filter((x) => x !== c) : [...plan.triggerContexts, c] })}
                >
                  {CONTEXT_LABEL[c]}
                </button>
              )
            })}
          </div>
          <Field label="In your words">
            <textarea className="kh-textarea" rows={2} value={plan.triggerNotes ?? ''} onChange={(e) => setPlan({ ...plan, triggerNotes: e.target.value || null })} />
          </Field>
          <Field label="When the urge comes, I will…">
            <input className="kh-input" value={plan.replacement} onChange={(e) => setPlan({ ...plan, replacement: e.target.value })} />
          </Field>
          <Field label="How hard will this be?">
            <select className="kh-input" value={plan.weight} onChange={(e) => setPlan({ ...plan, weight: e.target.value as LetGoWeight })}>
              {(Object.keys(WEIGHT_LABEL) as LetGoWeight[]).map((w) => (
                <option key={w} value={w}>
                  {WEIGHT_LABEL[w]}
                </option>
              ))}
            </select>
          </Field>
        </section>

        <section className="kh-card p-6 flex flex-col gap-4">
          <h2 className="t-h3 m-0">New habits to fill the gap</h2>
          {plan.sessions.map((s, i) => (
            <div key={i} className="kh-sheet p-4 flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <input className="kh-input flex-1" aria-label="Habit name" value={s.name} onChange={(e) => setSession(i, { name: e.target.value })} />
                <IconBtn title="Remove this habit" onClick={() => setPlan({ ...plan, sessions: plan.sessions.filter((_, j) => j !== i) })}>
                  <Trash2 size={15} />
                </IconBtn>
              </div>
              <DaysPicker days={s.days} onChange={(days) => setSession(i, { days })} />
              <div className="flex flex-wrap gap-4">
                <Field label="Time">
                  <input className="kh-input" type="time" value={s.scheduledTime} onChange={(e) => setSession(i, { scheduledTime: e.target.value })} />
                </Field>
                <Field label="Minutes">
                  <input className="kh-input w-24" type="number" min={5} value={s.targetMinutes} onChange={(e) => setSession(i, { targetMinutes: Number(e.target.value) })} />
                </Field>
              </div>
              {s.rationale ? <span className="t-caption">{s.rationale}</span> : null}
            </div>
          ))}
          <Btn
            kind="soft"
            onClick={() => setPlan({ ...plan, sessions: [...plan.sessions, { name: 'New habit', days: [1, 2, 3, 4, 5], scheduledTime: '21:00', targetMinutes: 15, rationale: null }] })}
          >
            <Plus size={15} /> Add a habit
          </Btn>
        </section>

        <section className="kh-card p-6 flex flex-col gap-4 min-[1100px]:col-span-2">
          <h2 className="t-h3 m-0">What helps</h2>
          {plan.supports.map((s, i) => (
            <div key={i} className="flex flex-wrap items-start gap-3">
              <input
                className="kh-input flex-1 min-w-[220px]"
                aria-label="What helps"
                value={s.title}
                onChange={(e) => setPlan({ ...plan, supports: plan.supports.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })}
              />
              <input
                className="kh-input flex-[2] min-w-[260px]"
                aria-label="Details"
                placeholder="Details (optional)"
                value={s.description ?? ''}
                onChange={(e) => setPlan({ ...plan, supports: plan.supports.map((x, j) => (j === i ? { ...x, description: e.target.value || null } : x)) })}
              />
              <IconBtn title="Remove" onClick={() => setPlan({ ...plan, supports: plan.supports.filter((_, j) => j !== i) })}>
                <X size={15} />
              </IconBtn>
            </div>
          ))}
          <Btn kind="soft" className="self-start" onClick={() => setPlan({ ...plan, supports: [...plan.supports, { title: '', description: null }] })}>
            <Plus size={15} /> Add something that helps
          </Btn>
        </section>
      </div>

      {error ? (
        <div className="mt-6">
          <Alert>{error}</Alert>
        </div>
      ) : null}

      <footer className="flex flex-wrap items-center justify-between gap-4 mt-8">
        <Btn kind="ghost" onClick={onBack}>
          <ArrowLeft size={15} /> Change what I told the planner
        </Btn>
        <span className="flex flex-wrap gap-3">
          <Btn kind="soft" disabled={busy} onClick={onRedraft}>
            <Sparkles size={15} /> Make a new draft
          </Btn>
          <Btn kind="laurel" size="lg" disabled={busy || invalid} onClick={onSave}>
            Save and start <ArrowRight size={17} />
          </Btn>
        </span>
      </footer>
    </>
  )
}
