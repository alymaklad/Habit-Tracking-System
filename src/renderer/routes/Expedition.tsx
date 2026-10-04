import { useEffect, useMemo, useState } from 'react'
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  Clock,
  Compass,
  ExternalLink,
  Feather,
  Hash,
  Hourglass,
  Mountain,
  NotebookPen,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X
} from 'lucide-react'
import type { AiStatus, GoalDraftInput, SavedGoalDraft, GoalPlan, GoalPlanProgress, GoalSession, GoalView } from '@shared/types'
import MindMap from '../components/MindMap'
import { useTick } from '../hooks/useData'
import { addDays, duration } from '../lib/format'
import { dayMonth, daysBetween, monthYear, moveMilestone, plural, roman, time12, today } from '../lib/khatwa'
import { TrailMap } from '../khatwa/charts'
import { GripVertical, Save } from 'lucide-react'
import { useShell } from '../khatwa/nav'
import { Page } from '../khatwa/Page'
import { Alert, Btn, DaysPicker, Dot, Eyebrow, IconBtn, Stamp } from '../khatwa/ui'

type Step = 'describe' | 'planning' | 'ready' | 'review'

const HORIZONS: { label: string; days: number }[] = [
  { label: '6 months', days: 182 },
  { label: '1 year', days: 365 },
  { label: '15 months', days: 456 },
  { label: '3 years', days: 1095 }
]

const DISCIPLINE_IDEAS = ['Daily practice', 'Reading & study', 'Hands-on projects', 'Weekly reflection', 'Physical energy', 'Teaching others']

function composeDescription(text: string, anchors: string[]): string | null {
  const body = text.trim()
  const extra = anchors.length ? `Supporting disciplines to anchor: ${anchors.join(', ')}.` : ''
  const all = [body, extra].filter(Boolean).join('\n\n')
  return all || null
}

function weeklyMinutes(plan: GoalPlan): number {
  return plan.sessions.reduce((s, x) => s + x.days.length * x.targetMinutes, 0)
}

// ------------------------------------------------------------ describe

function Describe({
  title,
  setTitle,
  story,
  setStory,
  target,
  setTarget,
  minutes,
  setMinutes,
  anchors,
  setAnchors,
  active,
  ai,
  error,
  onBegin,
  onCancel,
  onSaveDraft,
  pending,
  onResume,
  onDiscardPending
}: {
  onSaveDraft: () => void
  pending: SavedGoalDraft | null
  onResume: () => void
  onDiscardPending: () => void
  title: string
  setTitle: (v: string) => void
  story: string
  setStory: (v: string) => void
  target: string | null
  setTarget: (v: string | null) => void
  minutes: number
  setMinutes: (v: number) => void
  anchors: string[]
  setAnchors: (v: string[]) => void
  active: GoalView[]
  ai: AiStatus | null
  error: string | null
  onBegin: () => void
  onCancel: () => void
}) {
  const { navigate, account, accountsEnabled } = useShell()
  const guest = accountsEnabled && !account
  const [anchorDraft, setAnchorDraft] = useState('')
  const now = today()
  const horizonDays = target ? daysBetween(now, target) : null
  const hours = minutes / 60
  const perDay = Math.round(minutes / 7)
  const provider = ai?.providers.find((p) => p.id === ai.provider)

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-6 mb-8">
        <div className="flex flex-col gap-4 max-w-[760px]">
          <Eyebrow>
            <span className="w-6 h-6 rounded-full bg-[var(--ochre-wash)] grid place-items-center text-[11px]">{String(active.length + 1).padStart(2, '0')}</span>
            Expedition inception <span className="is-quiet">/ Carta no. {String(active.length + 1).padStart(2, '0')} · Charting a new peak</span>
          </Eyebrow>
          <h1 className="t-hero m-0">Choose Your Mountain</h1>
          <p className="t-italic !text-[18px] !leading-[29px] m-0 [text-wrap:pretty]">
            “A major transformation requires a dedicated peak. The mountain is not a casual ambition; it is the deliberate distance between who you are today and the life you yearn to inhabit.”
          </p>
        </div>
        <Stamp className="!py-2 !px-3.5">
          <Compass size={14} /> Solitary ascent · vellum record
        </Stamp>
      </header>

      <section className="kh-card kh-tape px-10 py-9 flex flex-col gap-10">
        {pending ? (
          <div className="kh-docket px-5 py-4 flex flex-wrap items-center gap-4">
            <Save size={17} className="text-ink-3" />
            <span className="flex-1 min-w-[240px] text-[14.5px]">
              You set aside <b className="font-semibold">{pending.title || 'an unnamed mountain'}</b> on {dayMonth(pending.savedAt.slice(0, 10))}
              {pending.plan ? ', with its trail already drawn.' : '.'}
            </span>
            <Btn kind="laurel" size="sm" onClick={onResume}>
              Continue that draft
            </Btn>
            <Btn kind="ghost" onClick={onDiscardPending}>
              Discard it
            </Btn>
          </div>
        ) : null}
        {error ? <Alert>{error}</Alert> : null}
        {ai && !ai.ready ? (
          guest ? (
            <Alert tone="ochre">
              The planner isn’t available to guests in this version yet. Create an account to use it with your own AI key.
            </Alert>
          ) : (
            <Alert tone="ochre">
              The cartographer needs {provider ? `${/^[aeiou]/i.test(provider.label) ? 'an' : 'a'} ${provider.label}` : 'an'} API key before it can chart a trail.{' '}
              <button className="underline font-semibold" onClick={() => navigate({ name: 'settings' })}>
                Add one in Settings → AI planner
              </button>
              .
            </Alert>
          )
        ) : null}

        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="m-0 flex items-baseline gap-3">
              <span className="t-stamp text-[var(--ochre-deep)]">Phase I</span>
              <span className="t-h1 !text-[28px]">What do you want to achieve?</span>
            </h2>
            <span className="t-italic !text-[13px]">The summit definition</span>
          </div>
          <input className="kh-input is-well is-display" value={title} placeholder="Become an AI engineer" onChange={(e) => setTitle(e.target.value)} autoFocus />
          <span className="kh-field-hint">Name the singular destination clearly. Avoid diffuse tasks; aim for an identity shift or a lasting body of craft.</span>
        </div>

        <div className="flex flex-col gap-3">
          <div className="flex items-baseline justify-between gap-4">
            <h2 className="m-0 flex items-baseline gap-3">
              <span className="t-stamp text-[var(--ochre-deep)]">Phase II</span>
              <span className="t-h2">Tell Khatwa a little more about this horizon</span>
            </h2>
            <span className="t-stamp text-ink-4">Marginalia &amp; reason</span>
          </div>
          <textarea
            className="kh-textarea"
            rows={4}
            value={story}
            placeholder="Where you are starting from, what you have tried, the constraints of your days, what draws you to this peak…"
            onChange={(e) => setStory(e.target.value)}
          />
          <span className="kh-field-hint flex items-center gap-2 italic font-serif !text-[13px]">
            <Feather size={13} /> This intention will serve as your guiding compass during seasons of low motivation.
          </span>
        </div>

        <div className="flex flex-col gap-4">
          <h2 className="m-0 flex items-baseline gap-3">
            <span className="t-stamp text-[var(--ochre-deep)]">Phase III</span>
            <span className="t-h2">Parameters of the trail</span>
          </h2>
          <div className="grid gap-5 min-[980px]:grid-cols-2">
            <div className="kh-sheet p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="t-stamp text-ink-3 flex items-center gap-2">
                  <CalendarDays size={14} /> Summit horizon
                </span>
                {horizonDays !== null ? (
                  <Stamp tone="laurel" className="!text-[10px]">
                    {horizonDays < 120 ? 'Sprint pace' : horizonDays < 400 ? 'Steady pace' : 'Mastery pace'}
                  </Stamp>
                ) : null}
              </div>
              <div className="flex flex-col gap-1">
                <span className="font-serif text-[26px] leading-8">{target ? monthYear(target) : 'An open horizon'}</span>
                <span className="t-italic !text-[13.5px]">
                  {horizonDays !== null ? `About ${Math.max(1, Math.round(horizonDays / 30))} months of ascent` : 'No fixed date — the plan paces itself'}
                </span>
              </div>
              <div className="flex flex-wrap gap-2">
                {HORIZONS.map((h) => {
                  const date = addDays(now, h.days)
                  return (
                    <button key={h.label} className={`kh-chip ${target === date ? 'is-on' : ''}`} onClick={() => setTarget(date)}>
                      {h.label}
                    </button>
                  )
                })}
                <button className={`kh-chip ${target === null ? 'is-on' : ''}`} onClick={() => setTarget(null)}>
                  Open
                </button>
              </div>
              <label className="kh-field">
                <span className="kh-field-label !text-[10.5px]">Or a precise date</span>
                <input className="kh-input" type="date" min={addDays(now, 1)} value={target ?? ''} onChange={(e) => setTarget(e.target.value || null)} />
              </label>
            </div>

            <div className="kh-sheet p-5 flex flex-col gap-4">
              <div className="flex items-center justify-between">
                <span className="t-stamp text-ink-3 flex items-center gap-2">
                  <Clock size={14} /> Weekly focus allocation
                </span>
                <span className="font-serif text-[34px] leading-none t-num">
                  {Number.isInteger(hours) ? hours : hours.toFixed(1)}
                  <span className="font-sans text-[12px] text-ink-3 ml-1.5 tracking-[0.08em]">HOURS / WK</span>
                </span>
              </div>
              <input className="kh-range" type="range" min={60} max={1200} step={30} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} aria-label="Hours per week" />
              <div className="flex justify-between t-stamp !text-[10px] text-ink-4">
                <span>1h light trail</span>
                <span>10h steady ascent</span>
                <span>20h ridge sprint</span>
              </div>
              <div className="kh-docket p-3.5 flex items-start gap-3">
                <Hourglass size={17} className="text-[var(--ochre-deep)] mt-0.5 shrink-0" />
                <span className="text-[13.5px] leading-5 text-ink-2">
                  <b className="font-semibold">Deliberate focus pace:</b> about {duration(perDay)} a day, or a few longer blocks — the cartographer arranges it around the habits you already keep.
                </span>
              </div>
            </div>
          </div>
        </div>

        <div className="kh-sheet p-5 flex flex-col gap-3">
          <div className="flex items-center justify-between gap-4">
            <span className="t-stamp text-ink-3 flex items-center gap-2">
              <Hash size={14} /> Supporting disciplines &amp; field anchors
            </span>
            <span className="t-caption">Tell the cartographer which crafts to build around</span>
          </div>
          <div className="flex flex-wrap gap-2">
            {anchors.map((a) => (
              <span key={a} className="kh-chip is-on">
                {a}
                <button aria-label={`Remove ${a}`} onClick={() => setAnchors(anchors.filter((x) => x !== a))}>
                  <X size={13} />
                </button>
              </span>
            ))}
            {DISCIPLINE_IDEAS.filter((d) => !anchors.includes(d)).map((d) => (
              <button key={d} className="kh-chip" onClick={() => setAnchors([...anchors, d])}>
                <Plus size={13} /> {d}
              </button>
            ))}
            <form
              className="inline-flex"
              onSubmit={(e) => {
                e.preventDefault()
                const v = anchorDraft.trim()
                if (v && !anchors.includes(v)) setAnchors([...anchors, v])
                setAnchorDraft('')
              }}
            >
              <input className="kh-input !w-44 !text-[13px] !py-1" placeholder="Your own…" value={anchorDraft} onChange={(e) => setAnchorDraft(e.target.value)} />
            </form>
          </div>
        </div>

        <div className="kh-docket p-5 flex items-center gap-5">
          <span className="w-12 h-12 rounded-xl grid place-items-center bg-[var(--ochre-deep)] text-[var(--on-solid)] relative shrink-0">
            <Mountain size={20} />
            <span className="absolute -right-1.5 -bottom-1.5 w-5 h-5 rounded-full bg-[var(--laurel-deep)] text-[var(--on-solid)] text-[11px] grid place-items-center">{active.length + 1}</span>
          </span>
          <div className="flex flex-col gap-2 min-w-0">
            <span className="flex items-center gap-3">
              <span className="t-stamp text-[var(--ochre-deep)]">The law of limited ridges</span>
              <span className="t-stamp !text-[10.5px] text-ink-4">Folio advisory</span>
            </span>
            <span className="text-[14.5px] text-ink-2 [text-wrap:pretty]">
              A meaningful life has room for three or four true summits at once. This commitment would become your {active.length + 1}
              {['st', 'nd', 'rd'][active.length] ?? 'th'} active mountain{active.length ? ' alongside:' : '.'}
            </span>
            {active.length ? (
              <div className="flex flex-wrap gap-2">
                {active.map((g, i) => (
                  <span key={g.id} className="kh-stamp is-outline !normal-case !tracking-normal !font-normal italic !text-[12.5px]">
                    {i + 1}. {g.title}
                  </span>
                ))}
                <span className="kh-stamp is-ochre !normal-case !tracking-normal !font-normal italic !text-[12.5px]">
                  {active.length + 1}. {title.trim() || 'This new peak'} (new)
                </span>
              </div>
            ) : null}
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-4 pt-2">
          <Btn kind="ghost" onClick={onCancel}>
            <ArrowLeft size={15} /> Discard or return to Mountains
          </Btn>
          <Btn kind="ruled" disabled={!title.trim()} onClick={onSaveDraft}>
            <Save size={15} /> Save draft
          </Btn>
          <div className="flex items-center gap-5">
            <span className="t-italic !text-[13px]">Ready to record into your journal?</span>
            <Btn kind="ochre" size="lg" disabled={!title.trim() || ai?.ready === false} onClick={onBegin}>
              Begin the climb <ArrowRight size={17} />
            </Btn>
          </div>
        </div>
      </section>
    </>
  )
}

// ------------------------------------------------------------ planning

const STAGES: { key: string; title: string; body: string }[] = [
  { key: 'researching', title: 'Understanding your destination', body: 'Researching the peak: what the craft asks of you, the curricula people follow, and resources worth trusting.' },
  { key: 'drafting', title: 'Designing your milestones & ridge camps', body: 'Drafting waypoints and weekly rhythms that fit around the habits you already keep, inside your weekly allocation.' },
  { key: 'reviewing', title: 'The Intervenor’s review', body: 'An independent reviewer checks the draft for schedule collisions, an honest pace and links that actually resolve.' },
  { key: 'yours', title: 'Reviewing the route & first step', body: 'The finished map comes back to you to edit before anything is written into your folio.' }
]

function Planning({ progress, input, ai, startedAt }: { progress: GoalPlanProgress | null; input: GoalDraftInput; ai: AiStatus | null; startedAt: number }) {
  useTick(1000)
  const elapsed = Math.floor((Date.now() - startedAt) / 1000)
  const phase = progress?.phase ?? 'researching'
  const activeIndex = phase === 'researching' ? 0 : phase === 'reviewing' ? 2 : 1
  const provider = ai?.providers.find((p) => p.id === ai.provider)
  const months = input.targetDate ? Math.max(1, Math.round(daysBetween(today(), input.targetDate) / 30)) : null
  const waitLeft = progress?.waitingUntil ? Math.max(0, Math.ceil((progress.waitingUntil - Date.now()) / 1000)) : 0

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-6 mb-9">
        <div className="flex flex-col gap-3">
          <Eyebrow>
            <Dot /> Expedition inception <span className="is-quiet">/ Architectural synthesis</span>
          </Eyebrow>
          <div className="flex items-end gap-6 flex-wrap">
            <h1 className="t-hero !text-[56px] !leading-[60px] m-0 text-[var(--laurel-deep)]">Building Your Trail</h1>
            <span className="t-italic pb-2">— cartographic drafting in progress</span>
          </div>
        </div>
        <div className="kh-docket px-5 py-4 flex items-center gap-4 max-w-[420px]">
          <Mountain size={22} className="text-[var(--ochre-deep)] shrink-0" />
          <span className="flex flex-col">
            <span className="t-stamp text-[var(--ochre-deep)]">Target summit pinned</span>
            <span className="text-[15px] [text-wrap:balance]">
              {input.title}
              {input.targetDate ? ` · ${monthYear(input.targetDate)}` : ''} · {duration(input.weeklyMinutesBudget ?? 0)}/wk
            </span>
          </span>
        </div>
      </header>

      <div className="grid gap-7 min-[1100px]:grid-cols-[minmax(0,1fr)_380px]">
        <section className="kh-card p-8 flex flex-col gap-7">
          <div className="flex items-center justify-between gap-4">
            <span className="t-stamp text-[var(--laurel-deep)] flex items-center gap-2.5">
              <NotebookPen size={17} /> Live cartography progression
            </span>
            <span className="font-serif text-[12.5px] tracking-[0.1em] text-ink-4 t-num">{Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} elapsed</span>
          </div>
          {STAGES.map((s, i) => {
            const state = i < activeIndex ? 'done' : i === activeIndex ? 'active' : 'waiting'
            return (
              <div key={s.key} className={`flex gap-4 ${state === 'active' ? 'kh-sheet !bg-[var(--ochre-wash)] p-5 -mx-2' : ''} ${state === 'waiting' ? 'opacity-45' : ''}`}>
                <span
                  className={`w-9 h-9 rounded-full grid place-items-center shrink-0 ${
                    state === 'done' ? 'bg-[var(--laurel)] text-[var(--on-solid)]' : state === 'active' ? 'bg-[var(--ochre-deep)] text-[var(--on-solid)]' : 'border-2 border-[var(--rule)]'
                  }`}
                >
                  {state === 'done' ? <Check size={17} strokeWidth={2.6} /> : state === 'active' ? <span className="w-3 h-3 rounded-full bg-[var(--on-solid)] kh-breathe" /> : null}
                </span>
                <div className="flex flex-col gap-1.5 min-w-0">
                  <span className="flex items-center gap-3 flex-wrap">
                    <span className="text-[19px] font-semibold leading-7">{s.title}</span>
                    {state === 'done' ? <Stamp tone="laurel" className="!text-[10.5px]">Complete</Stamp> : state === 'active' ? <span className="t-stamp !text-[11px] text-[var(--ochre-deep)]">Active synthesis</span> : null}
                  </span>
                  <span className="text-[14.5px] leading-[23px] text-ink-3 [text-wrap:pretty]">{s.body}</span>
                  {state === 'active' && waitLeft > 0 ? (
                    <span className="kh-docket mt-2 px-3.5 py-2.5 flex items-center gap-3 text-[13px] text-ink-2" role="status">
                      <Hourglass size={15} className="text-[var(--ochre-deep)] shrink-0" />
                      <span>
                        {provider?.label ?? 'The AI provider'} is busy — trying again in <b className="t-num">{waitLeft} s</b>. Free accounts get a set amount of AI time each minute.
                      </span>
                    </span>
                  ) : null}
                  {state === 'active' && progress && progress.iteration > 1 ? (
                    <span className="kh-docket mt-2 px-3.5 py-2.5 flex items-center gap-3 text-[13px] italic font-serif text-ink-2">
                      <RefreshCw size={15} className="text-[var(--ochre-deep)] kh-spin shrink-0" />
                      Revising trail density — attempt {progress.iteration} of {progress.maxIterations}. The reviewer sent the last draft back.
                    </span>
                  ) : null}
                </div>
              </div>
            )
          })}
          <div className="flex items-center gap-3 pt-2">
            <span className="kh-btn is-laurel pointer-events-none">
              <span className="kh-dot kh-breathe" /> Synthesizing trail architecture…
            </span>
            <span className="t-caption max-w-[300px]">The cartographer can’t be interrupted mid-draft — you can change everything on the next page.</span>
          </div>
        </section>

        <aside className="flex flex-col gap-5">
          <div className="kh-sheet p-5 flex flex-col gap-4">
            <span className="t-stamp text-ink-3 flex items-center gap-2">
              <Compass size={15} /> Topographic schematic · <span className="text-[var(--ochre-deep)]">drafting</span>
            </span>
            <svg viewBox="0 0 320 200" className="w-full rounded-lg bg-[var(--card)]" aria-hidden="true">
              {[40, 80, 120, 160].map((y) => (
                <path key={y} d={`M0,${y} C80,${y - 14} 160,${y + 12} 320,${y - 8}`} fill="none" stroke="var(--rule)" strokeDasharray="2 5" />
              ))}
              <path
                d="M40,178 C90,160 110,130 150,122 S220,80 250,58 S282,30 292,22"
                fill="none"
                stroke="var(--ochre-deep)"
                strokeWidth="2"
                strokeDasharray="5 5"
                style={{ ['--len' as string]: 420, strokeDashoffset: 0, animation: 'kh-draw 2.4s ease-out infinite alternate' }}
              />
              {[
                [40, 178],
                [150, 122],
                [250, 58],
                [292, 22]
              ].map(([x, y], i) => (
                <circle key={i} cx={x} cy={y} r={i === activeIndex ? 5 : 3.5} fill={i < activeIndex ? 'var(--laurel)' : i === activeIndex ? 'var(--ochre-deep)' : 'var(--rule)'} />
              ))}
            </svg>
            <span className="t-stamp !text-[10.5px] text-ink-4 flex items-center gap-2">
              <Dot /> Phase: {phase}
            </span>
          </div>

          <div className="kh-sheet p-5 flex flex-col gap-3">
            <span className="t-stamp text-[var(--ochre-deep)] flex items-center gap-2">
              <NotebookPen size={15} /> Planner marginalia memo
            </span>
            <p className="font-serif text-[17px] leading-[27px] m-0 text-ink-2 [text-wrap:pretty]">
              “Every draft is checked twice: once by plain arithmetic against your existing schedule, and once by a reviewer that sees only the finished map — never the drafter’s reasoning.”
            </p>
            <span className="t-caption">
              Charting with {provider?.label ?? 'the configured planner'}
              {provider ? ` · ${provider.model}` : ''}
            </span>
          </div>
        </aside>
      </div>

      <div className="grid gap-4 mt-7 grid-cols-[repeat(auto-fit,minmax(200px,1fr))]">
        <div className="kh-docket p-5 flex flex-col gap-1">
          <span className="t-stamp text-ink-4">Ascent horizon</span>
          <span className="text-[24px] font-semibold">{months ? `${months} months` : 'Open'}</span>
          <span className="t-italic !text-[13px]">{input.targetDate ? `${dayMonth(today())} → ${monthYear(input.targetDate)}` : 'No fixed summit date'}</span>
        </div>
        <div className="kh-docket p-5 flex flex-col gap-1">
          <span className="t-stamp text-ink-4">Rhythm buffer</span>
          <span className="text-[24px] font-semibold text-[var(--ochre-deep)]">{duration(input.weeklyMinutesBudget ?? 0)}/wk</span>
          <span className="t-italic !text-[13px]">The plan must stay inside this</span>
        </div>
        <div className="kh-docket p-5 flex flex-col gap-1">
          <span className="t-stamp text-ink-4">Review passes</span>
          <span className="text-[24px] font-semibold text-slate">{progress ? `${progress.iteration} of ${progress.maxIterations}` : '—'}</span>
          <span className="t-italic !text-[13px]">Bounded, so it never loops forever</span>
        </div>
      </div>
    </>
  )
}

// ---------------------------------------------------------------- ready

function Ready({
  plan,
  input,
  warnings,
  notes,
  iterations,
  onReview,
  onRechart
}: {
  plan: GoalPlan
  input: GoalDraftInput
  warnings: string[]
  notes: string[]
  iterations: number
  onReview: () => void
  onRechart: () => void
}) {
  const weekly = weeklyMinutes(plan)
  const months = input.targetDate ? Math.max(1, Math.round(daysBetween(today(), input.targetDate) / 30)) : null
  const weeks = input.targetDate ? Math.max(1, Math.round(daysBetween(today(), input.targetDate) / 7)) : null
  const milestones = [...plan.milestones].sort((a, b) => a.dueDate.localeCompare(b.dueDate))

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-6 mb-8">
        <div className="flex flex-col gap-3 max-w-[760px]">
          <Eyebrow>
            <Dot /> Expedition inception / cartography complete
          </Eyebrow>
          <h1 className="t-hero m-0">Your Mountain is Ready.</h1>
          <p className="font-serif text-[19px] leading-[29px] text-ink-2 m-0 [text-wrap:pretty]">{plan.summary}</p>
        </div>
        <div className="kh-sheet px-5 py-4 flex items-center gap-4">
          <span className="flex flex-col">
            <span className="t-stamp !text-[10.5px] text-ink-4">Projected summit</span>
            <span className="text-[19px] font-semibold">{input.targetDate ? monthYear(input.targetDate) : 'Open horizon'}</span>
          </span>
          <span className="w-11 h-11 rounded-lg grid place-items-center bg-[var(--ochre-tint)] text-[var(--ochre-deep)]">
            <Mountain size={20} />
          </span>
        </div>
      </header>

      {warnings.length > 0 || notes.length > 0 ? (
        <div className="mb-6 flex flex-col gap-3">
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

      <section className="kh-card p-6 mb-7">
        <div className="flex items-center gap-3 mb-4 flex-wrap">
          <Stamp className="!text-[11px]">Quadrant {roman(Math.max(1, milestones.length))} — {milestones.length} waypoints</Stamp>
          <span className="t-italic !text-[13px]">{warnings.length > 0 ? `Checked over ${plural(iterations, 'draft')}` : iterations === 1 ? 'Accepted on the first draft' : `Accepted after ${iterations} drafts`}</span>
        </div>
        {milestones.length > 0 ? (
          <TrailMap
            waypoints={milestones.map((m, i) => ({ key: i, title: m.title, caption: dayMonth(m.dueDate), state: i === 0 ? 'current' : 'upcoming' }))}
            summit={input.title}
            summitCaption={input.targetDate ? `Target horizon: ${monthYear(input.targetDate)}` : undefined}
            height={480}
            compact={milestones.length > 6}
          />
        ) : (
          <div className="kh-empty">The plan has no milestones — add some on the next page.</div>
        )}
        <div className="flex flex-wrap gap-6 mt-4 t-stamp !text-[10.5px] text-ink-4">
          <span className="flex items-center gap-2">
            <span className="w-5 border-t-2 border-dashed border-[var(--ochre)]" /> Chartered trail
          </span>
          <span className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full border-2 border-[var(--laurel)]" /> Waypoints
          </span>
          <span className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-[var(--ochre-deep)]" /> You begin here
          </span>
        </div>
      </section>

      <div className="grid gap-6 min-[1100px]:grid-cols-[minmax(0,1fr)_340px]">
        <section className="kh-sheet p-6 flex flex-col gap-5">
          <div className="flex items-start justify-between gap-4">
            <span className="flex flex-col">
              <span className="t-stamp text-ink-4">Expedition specification</span>
              <span className="t-h2">Ascent profile: {input.title}</span>
            </span>
            <Stamp tone="ochre">{warnings.length > 0 ? 'Check before sealing' : 'Vetted route'}</Stamp>
          </div>
          <div className="kh-docket grid grid-cols-2 min-[800px]:grid-cols-4 gap-5 p-5">
            <div className="flex flex-col">
              <span className="t-stamp !text-[10.5px] text-ink-4">Duration</span>
              <span className="font-serif text-[21px]">{months ? `${months} months` : 'Open'}</span>
              <span className="t-caption">{input.targetDate ? `Through ${monthYear(input.targetDate)}` : 'Paced by habit'}</span>
            </div>
            <div className="flex flex-col">
              <span className="t-stamp !text-[10.5px] text-ink-4">Waypoints</span>
              <span className="font-serif text-[21px]">{plural(milestones.length, 'milestone')}</span>
              <span className="t-caption">Progressive rigor</span>
            </div>
            <div className="flex flex-col">
              <span className="t-stamp !text-[10.5px] text-ink-4">Weekly tempo</span>
              <span className="font-serif text-[21px]">{duration(weekly)} / wk</span>
              <span className="t-caption">{plural(plan.sessions.length, 'daily habit')}</span>
            </div>
            <div className="flex flex-col">
              <span className="t-stamp !text-[10.5px] text-ink-4">Climb energy</span>
              <span className="font-serif text-[21px] text-[var(--ochre-deep)]">{weeks ? `~${Math.round((weekly * weeks) / 60)} hours` : '—'}</span>
              <span className="t-caption">Deep deliberate work</span>
            </div>
          </div>
          <div className="flex flex-col gap-2">
            <span className="t-stamp !text-[10.5px] text-ink-4">The {plan.sessions.length} disciplines anchoring this summit</span>
            <div className="flex flex-wrap gap-2">
              {plan.sessions.map((s, i) => (
                <span key={i} className="kh-chip">
                  <Dot tone="laurel" /> {s.name} · {duration(s.targetMinutes)} × {s.days.length}/wk
                </span>
              ))}
            </div>
          </div>
        </section>

        <aside className="kh-card p-6 flex flex-col gap-5">
          <div className="flex items-center justify-between">
            <span className="t-stamp text-[var(--ochre-deep)]">Expedition seal</span>
            <span className="t-stamp !text-[10.5px] text-ink-4">Unsealed</span>
          </div>
          <h2 className="t-h2 m-0">Commit to the ascent</h2>
          <p className="m-0 text-[14.5px] leading-[23px] text-ink-2 [text-wrap:pretty]">
            Sealing this chart creates its weekly habits and dated waypoints in your folio. Nothing is written until you seal it on the next page.
          </p>
          <Btn kind="ochre" size="lg" onClick={onReview}>
            Review your trail &amp; habits <ArrowRight size={16} />
          </Btn>
          <Btn kind="soft" onClick={onRechart}>
            <SlidersHorizontal size={15} /> Re-chart route &amp; parameters
          </Btn>
        </aside>
      </div>
    </>
  )
}

// --------------------------------------------------------------- review

function SessionCard({ session, onChange, onRemove }: { session: GoalSession; onChange: (s: GoalSession) => void; onRemove: () => void }) {
  return (
    <div className="kh-card p-4 flex flex-col gap-3">
      <div className="flex items-start gap-3">
        <input className="kh-input !text-[16px] !font-semibold flex-1" value={session.name} onChange={(e) => onChange({ ...session, name: e.target.value })} aria-label="Habit name" />
        <Stamp tone="ochre" className="!text-[10.5px] mt-2">{session.days.length}× / week</Stamp>
        <IconBtn title="Remove this habit" onClick={onRemove}>
          <Trash2 size={14} />
        </IconBtn>
      </div>
      <div className="flex flex-wrap items-end gap-4">
        <DaysPicker days={session.days} onChange={(days) => onChange({ ...session, days })} />
        <label className="kh-field !w-[120px]">
          <span className="kh-field-label !text-[10px]">Time</span>
          <input className="kh-input !text-[14px]" type="time" value={session.scheduledTime} onChange={(e) => onChange({ ...session, scheduledTime: e.target.value })} />
        </label>
        <label className="kh-field !w-[100px]">
          <span className="kh-field-label !text-[10px]">Minutes</span>
          <input className="kh-input !text-[14px]" type="number" min={5} value={session.targetMinutes} onChange={(e) => onChange({ ...session, targetMinutes: Number(e.target.value) })} />
        </label>
      </div>
      {session.rationale ? <span className="t-italic !text-[13.5px] [text-wrap:pretty]">{session.rationale}</span> : null}
    </div>
  )
}

function Review({
  plan,
  setPlan,
  input,
  busy,
  error,
  onSeal,
  onRedraft,
  onBack,
  onSaveDraft
}: {
  onSaveDraft: () => void
  plan: GoalPlan
  setPlan: (p: GoalPlan) => void
  input: GoalDraftInput
  busy: boolean
  error: string | null
  onSeal: () => void
  onRedraft: () => void
  onBack: () => void
}) {
  const weekly = weeklyMinutes(plan)
  const over = input.weeklyMinutesBudget ? weekly > input.weeklyMinutesBudget : false
  const first = useMemo(() => {
    const byDay = [...plan.sessions].filter((s) => s.days.length).sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime))
    return byDay[0] ?? null
  }, [plan.sessions])
  const invalid = plan.sessions.length === 0 || plan.sessions.some((s) => !s.name.trim() || s.days.length === 0 || s.targetMinutes <= 0)
  const [armed, setArmed] = useState<number | null>(null)
  const [dragging, setDragging] = useState<number | null>(null)
  const [overIndex, setOverIndex] = useState<number | null>(null)
  const [moved, setMoved] = useState<number | null>(null)
  const [announce, setAnnounce] = useState('')

  const move = (from: number, to: number): void => {
    if (to < 0 || to >= plan.milestones.length || from === to) return
    const title = plan.milestones[from]!.title
    setPlan({ ...plan, milestones: moveMilestone(plan.milestones, from, to) })
    setMoved(to)
    setAnnounce(`${title} moved to camp ${to + 1} of ${plan.milestones.length}`)
    window.setTimeout(() => setMoved((m) => (m === to ? null : m)), 700)
  }

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-6 mb-8">
        <div className="flex flex-col gap-3 max-w-[760px]">
          <Eyebrow>
            <Stamp className="!text-[11px]">Expedition inception</Stamp> <span className="is-quiet">/</span> Trail verification &amp; first step
          </Eyebrow>
          <h1 className="t-hero m-0">Review Your Trail</h1>
          <p className="t-italic !text-[17px] m-0">Refine your waypoints, daily habits, and field pack before sealing this mountain into your active folio.</p>
        </div>
        <div className="kh-docket px-4 py-3 flex items-center gap-3">
          <Mountain size={18} />
          <span className="t-stamp text-ink-2">
            {input.title}
            {input.targetDate ? ` · ${monthYear(input.targetDate)}` : ''}
          </span>
        </div>
      </header>

      {error ? <div className="mb-6"><Alert>{error}</Alert></div> : null}

      <div className="grid gap-7 min-[1100px]:grid-cols-[minmax(320px,0.85fr)_minmax(0,1.15fr)]">
        <section className="kh-sheet p-6 flex flex-col gap-3 min-w-0">
          <div className="flex items-center justify-between mb-1">
            <span className="t-stamp text-ink-2">Topographic itinerary</span>
            <span className="t-caption">{plural(plan.milestones.length, 'camp')}</span>
          </div>
          {plan.milestones.length ? (
            <div className="rounded-[10px] overflow-hidden mb-1">
              <TrailMap
                waypoints={plan.milestones.map((m, i) => ({ key: i, title: m.title || 'Untitled camp', state: i === 0 ? 'current' : 'upcoming' }))}
                summit={input.title}
                height={250}
                compact
              />
            </div>
          ) : null}
          <p className="m-0 t-caption !text-[12.5px]">Drag a camp by its handle to move it up or down the ridge. Dates keep climbing in order — a camp takes the date of the place it lands.</p>
          <span className="sr-only" aria-live="polite">
            {announce}
          </span>
          <ol className="m-0 p-0 list-none flex flex-col gap-3" onDragLeave={(e) => e.currentTarget === e.target && setOverIndex(null)}>
          {plan.milestones.map((m, i) => (
            <li
              key={i}
              draggable={armed === i}
              onDragStart={(e) => {
                e.dataTransfer.effectAllowed = 'move'
                e.dataTransfer.setData('text/plain', String(i))
                setDragging(i)
              }}
              onDragEnd={() => {
                setDragging(null)
                setOverIndex(null)
                setArmed(null)
              }}
              onDragOver={(e) => {
                if (dragging === null) return
                e.preventDefault()
                setOverIndex(i)
              }}
              onDrop={(e) => {
                e.preventDefault()
                if (dragging !== null) move(dragging, i)
                setDragging(null)
                setOverIndex(null)
                setArmed(null)
              }}
              className={`relative rounded-[10px] p-3.5 flex gap-3 transition-[background,opacity,box-shadow] duration-300 ${i === plan.milestones.length - 1 ? 'bg-[var(--ochre-wash)]' : 'bg-[var(--card)] border border-[var(--rule-soft)]'} ${dragging === i ? 'opacity-40' : ''} ${moved === i ? '!bg-[var(--laurel-wash)]' : ''} ${overIndex === i && dragging !== null && dragging !== i ? (dragging < i ? 'shadow-[inset_0_-3px_0_var(--laurel)]' : 'shadow-[inset_0_3px_0_var(--laurel)]') : ''}`}
            >
              <button
                type="button"
                className="self-center -ml-1 w-6 h-9 grid place-items-center rounded text-ink-4 hover:text-ink hover:bg-[var(--docket)] cursor-grab active:cursor-grabbing"
                aria-label={`Move ${m.title || 'this camp'} — drag, or use the up and down arrow keys`}
                title="Drag to reorder · arrow keys move it"
                onMouseDown={() => setArmed(i)}
                onMouseUp={() => setArmed(null)}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
                    e.preventDefault()
                    const to = e.key === 'ArrowUp' ? i - 1 : i + 1
                    move(i, to)
                    // Keep the keyboard on the camp being moved.
                    window.requestAnimationFrame(() => (document.querySelectorAll<HTMLButtonElement>('[data-camp-handle]')[to] ?? null)?.focus())
                  }
                }}
                data-camp-handle
              >
                <GripVertical size={16} />
              </button>
              <span className="w-7 h-7 rounded-full grid place-items-center shrink-0 bg-[var(--laurel-deep)] text-[var(--on-solid)] font-serif text-[12px] mt-1">{String(i + 1).padStart(2, '0')}</span>
              <div className="flex flex-col gap-1.5 flex-1 min-w-0">
                <input
                  className="kh-input !text-[14.5px] !font-semibold !py-1"
                  value={m.title}
                  aria-label="Waypoint"
                  onChange={(e) => setPlan({ ...plan, milestones: plan.milestones.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })}
                />
                <div className="flex items-center gap-3">
                  <input
                    className="kh-input !text-[13px] !py-1 !w-[150px]"
                    type="date"
                    value={m.dueDate}
                    aria-label="Due date"
                    onChange={(e) => setPlan({ ...plan, milestones: plan.milestones.map((x, j) => (j === i ? { ...x, dueDate: e.target.value } : x)) })}
                  />
                  {m.description ? <span className="t-caption truncate">{m.description}</span> : null}
                </div>
              </div>
              <IconBtn title="Remove waypoint" onClick={() => setPlan({ ...plan, milestones: plan.milestones.filter((_, j) => j !== i) })}>
                <X size={14} />
              </IconBtn>
            </li>
          ))}
          </ol>
          <button
            className="kh-docket py-3 flex items-center justify-center gap-2 text-[14px] hover:bg-[var(--rule-soft)]"
            onClick={() =>
              setPlan({
                ...plan,
                milestones: [...plan.milestones, { title: 'New waypoint', dueDate: input.targetDate ?? addDays(today(), 14), description: null }]
              })
            }
          >
            <Plus size={15} /> Append waypoint along the ridge
          </button>
          {plan.mindMap.length > 0 ? (
            <div className="mt-3 flex flex-col gap-2">
              <span className="t-stamp !text-[10.5px] text-ink-4">The cartographer’s sketch</span>
              <div className="rounded-lg overflow-hidden bg-[var(--card)]">
                <MindMap nodes={plan.mindMap} height={220} />
              </div>
            </div>
          ) : null}
        </section>

        <div className="flex flex-col gap-7 min-w-0">
          {first ? (
            <section className="kh-card kh-tape is-ochre p-7 flex flex-col gap-4">
              <div className="flex items-center justify-between gap-3 flex-wrap">
                <span className="t-stamp text-[var(--ochre-deep)] flex items-center gap-2">
                  <Dot /> Your first step toward the summit
                </span>
                <Stamp tone="ochre-solid">{time12(first.scheduledTime)}</Stamp>
              </div>
              <h2 className="t-h1 !text-[28px] m-0">{first.name}</h2>
              <p className="m-0 text-[15px] leading-6 text-ink-2">
                Moves you toward: <b className="text-laurel font-semibold">{input.title}</b>
                {first.rationale ? ` — ${first.rationale}` : ''}
              </p>
              <div className="kh-docket p-4 flex flex-wrap gap-x-6 gap-y-2 text-[13.5px]">
                <span className="flex items-center gap-2">
                  <Clock size={15} /> {duration(first.targetMinutes)} allocated
                </span>
                <span className="flex items-center gap-2">
                  <CalendarDays size={15} /> {plural(first.days.length, 'day')} a week
                </span>
              </div>
            </section>
          ) : null}

          <section className="kh-sheet p-6 flex flex-col gap-3">
            <div className="flex items-center justify-between gap-3">
              <span className="t-stamp text-ink-2">
                Rhythmic harness <span className="text-ink-4">· contributing habits</span>
              </span>
              <span className={`text-[13px] ${over ? 'text-[var(--error)]' : 'text-ink-3'}`}>
                {duration(weekly)} / wk{input.weeklyMinutesBudget ? ` of ${duration(input.weeklyMinutesBudget)}` : ''}
              </span>
            </div>
            {plan.sessions.map((s, i) => (
              <SessionCard
                key={i}
                session={s}
                onChange={(next) => setPlan({ ...plan, sessions: plan.sessions.map((x, j) => (j === i ? next : x)) })}
                onRemove={() => setPlan({ ...plan, sessions: plan.sessions.filter((_, j) => j !== i) })}
              />
            ))}
            <button
              className="kh-docket py-3 flex items-center justify-center gap-2 text-[14px] hover:bg-[var(--rule-soft)]"
              onClick={() => setPlan({ ...plan, sessions: [...plan.sessions, { name: 'New habit', days: [1, 3, 5], scheduledTime: '18:00', targetMinutes: 30, rationale: null }] })}
            >
              <Plus size={15} /> Add contributing habit
            </button>
          </section>

          <section className="kh-sheet p-6 flex flex-col gap-3">
            <div className="flex items-center justify-between">
              <span className="t-stamp text-ink-2">
                Field pack <span className="text-ink-4">· curated companions</span>
              </span>
              <span className="t-caption">Links are fetched and verified before you see them</span>
            </div>
            {plan.resources.length === 0 ? <span className="t-caption">No resources suggested.</span> : null}
            <div className="grid gap-3 min-[900px]:grid-cols-2">
              {plan.resources.map((r, i) => (
                <div key={i} className="kh-card p-4 flex gap-3">
                  <span className="w-9 h-9 rounded-md grid place-items-center bg-[var(--docket)] text-ink-3 shrink-0">{r.url ? <ExternalLink size={15} /> : <Search size={15} />}</span>
                  <div className="flex flex-col gap-1 min-w-0 flex-1">
                    <span className="text-[14px] font-semibold leading-5">{r.title}</span>
                    <span className="t-caption [text-wrap:pretty]">{r.note}</span>
                    <span className="flex items-center gap-2">
                      <Stamp tone="ochre" className="!text-[10px] !py-0">{r.type}</Stamp>
                      {r.url ? (
                        <button className="text-[12px] text-laurel hover:underline" onClick={() => void window.api.app.openExternal(r.url!)}>
                          Open
                        </button>
                      ) : null}
                    </span>
                  </div>
                  <IconBtn title="Remove from the field pack" onClick={() => setPlan({ ...plan, resources: plan.resources.filter((_, j) => j !== i) })}>
                    <X size={14} />
                  </IconBtn>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>

      <footer className="flex flex-wrap items-center justify-between gap-4 mt-10">
        <Btn kind="ghost" onClick={onBack}>
          <ArrowLeft size={15} /> Back to the map
        </Btn>
        <div className="flex items-center gap-3">
          {invalid ? <span className="t-caption text-[var(--error)]">Every habit needs a name, at least one day and a duration.</span> : null}
          <Btn kind="soft" disabled={busy} onClick={onRedraft}>
            <Sparkles size={15} /> Re-draft with the cartographer
          </Btn>
          <Btn kind="ruled" disabled={busy} onClick={onSaveDraft}>
            <Save size={15} /> Save draft
          </Btn>
          <Btn kind="laurel" size="lg" disabled={busy || invalid} onClick={onSeal}>
            Take your first step <ArrowRight size={17} />
          </Btn>
        </div>
      </footer>
    </>
  )
}

// ---------------------------------------------------------------- wizard

export default function Expedition({ resume }: { resume?: boolean }) {
  const { navigate, toast, requireAccount } = useShell()
  const [step, setStep] = useState<Step>('describe')
  const [title, setTitle] = useState('')
  const [story, setStory] = useState('')
  const [target, setTarget] = useState<string | null>(addDays(today(), 182))
  const [minutes, setMinutes] = useState(300)
  const [anchors, setAnchors] = useState<string[]>([])
  const [plan, setPlan] = useState<GoalPlan | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [notes, setNotes] = useState<string[]>([])
  const [iterations, setIterations] = useState(0)
  const [progress, setProgress] = useState<GoalPlanProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [ai, setAi] = useState<AiStatus | null>(null)
  const [active, setActive] = useState<GoalView[]>([])
  const [startedAt, setStartedAt] = useState(Date.now())
  const [pending, setPending] = useState<SavedGoalDraft | null>(null)

  const restore = (d: SavedGoalDraft): void => {
    setTitle(d.title)
    setStory(d.story)
    setTarget(d.targetDate)
    setMinutes(d.weeklyMinutes)
    setAnchors(d.anchors)
    setPlan(d.plan)
    setWarnings(d.warnings)
    setNotes(d.notes ?? [])
    setIterations(d.iterations)
    setPending(null)
    setStep(d.plan ? 'review' : 'describe')
  }

  useEffect(() => {
    void window.api.goals
      .draft()
      .then((d) => {
        if (!d) return
        if (resume) restore(d)
        else setPending(d)
      })
      .catch(() => undefined)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resume])

  const saveDraft = async (): Promise<void> => {
    try {
      await window.api.goals.saveDraft({ title, story, targetDate: target, weeklyMinutes: minutes, anchors, plan, warnings, notes, iterations, savedAt: '' })
      toast('success', 'Draft saved', 'Pick it up again from the Mountains page.')
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    }
  }

  useEffect(() => {
    void window.api.ai.status().then(setAi).catch(() => undefined)
    void window.api.goals.list().then((g) => setActive(g.filter((x) => x.status === 'active'))).catch(() => undefined)
  }, [])
  useEffect(() => window.api.on.goalProgress(setProgress), [])

  const input: GoalDraftInput = {
    title: title.trim(),
    description: composeDescription(story, anchors),
    targetDate: target,
    weeklyMinutesBudget: minutes
  }

  const draft = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    setProgress(null)
    setStartedAt(Date.now())
    setStep('planning')
    try {
      const result = await window.api.goals.draftPlan(input)
      setPlan(result.plan)
      setWarnings(result.warnings)
      setNotes(result.notes)
      setIterations(result.iterations)
      setStep('ready')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep('describe')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const seal = async (): Promise<void> => {
    if (!plan) return
    // Trying the planner needs no account; keeping what it made does.
    if (!(await requireAccount('Create an account to save your mountain', 'Your plan stays exactly as it is — it is saved the moment you are in.'))) return
    setError(null)
    setBusy(true)
    try {
      const goal = await window.api.goals.commit(input, plan)
      // The draft has become a real mountain.
      await window.api.goals.saveDraft(null)
      toast('success', 'The mountain is sealed into your folio.', `${plural(plan.sessions.length, 'habit')} and ${plural(plan.milestones.length, 'waypoint')} were created.`)
      navigate({ name: 'mountain', id: goal.id })
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
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
          target={target}
          setTarget={setTarget}
          minutes={minutes}
          setMinutes={setMinutes}
          anchors={anchors}
          setAnchors={setAnchors}
          active={active}
          ai={ai}
          error={error}
          onBegin={() => void draft()}
          onCancel={() => navigate({ name: 'mountains' })}
          onSaveDraft={() => void saveDraft()}
          pending={pending}
          onResume={() => pending && restore(pending)}
          onDiscardPending={() => void window.api.goals.saveDraft(null).then(() => setPending(null))}
        />
      ) : null}
      {step === 'planning' ? <Planning progress={progress} input={input} ai={ai} startedAt={startedAt} /> : null}
      {step === 'ready' && plan ? <Ready plan={plan} input={input} warnings={warnings} notes={notes} iterations={iterations} onReview={() => setStep('review')} onRechart={() => setStep('describe')} /> : null}
      {step === 'review' && plan ? (
        <Review plan={plan} setPlan={setPlan} input={input} busy={busy} error={error} onSeal={() => void seal()} onRedraft={() => void draft()} onBack={() => setStep('ready')} onSaveDraft={() => void saveDraft()} />
      ) : null}
    </Page>
  )
}
