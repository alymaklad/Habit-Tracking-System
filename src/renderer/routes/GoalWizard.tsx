import { useEffect, useState } from 'react'
import type {
  GoalDraftInput,
  GoalMilestone,
  GoalPlan,
  GoalPlanProgress,
  GoalSession
} from '@shared/types'
import Icon from '../components/Icon'
import MindMap from '../components/MindMap'
import { Button, Card, CardTitle, Field, Label } from '../components/ui'
import { addDays, duration, toLocalDate } from '../lib/format'

const DAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']

const PHASE_LABEL: Record<GoalPlanProgress['phase'], string> = {
  researching: 'Researching the goal',
  drafting: 'Drafting the plan',
  reviewing: 'Reviewing the draft',
  revising: 'Revising'
}

type Step = 'describe' | 'planning' | 'review'

const blank = (): GoalDraftInput => ({
  title: '',
  description: null,
  targetDate: addDays(toLocalDate(new Date()), 56),
  weeklyMinutesBudget: 180
})

function ErrorBox({ text }: { text: string }) {
  return (
    <div
      style={{
        border: '1px solid var(--bad)',
        background: 'color-mix(in oklab, var(--bad) 12%, transparent)',
        padding: '10px 13px',
        fontSize: 12,
        color: 'var(--bad)',
        textWrap: 'pretty'
      }}
    >
      {text}
    </div>
  )
}

function SessionEditor({
  session,
  onChange,
  onRemove
}: {
  session: GoalSession
  onChange: (s: GoalSession) => void
  onRemove: () => void
}) {
  const toggleDay = (d: number): void => {
    const next = session.days.includes(d) ? session.days.filter((x) => x !== d) : [...session.days, d]
    onChange({ ...session, days: next.sort((a, b) => a - b) })
  }
  return (
    <div
      style={{
        border: '1px solid var(--line)',
        background: 'var(--panel)',
        padding: '12px 14px',
        display: 'flex',
        flexDirection: 'column',
        gap: 10
      }}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 110px auto', gap: 10, alignItems: 'end' }}>
        <Field label="Session">
          <input value={session.name} onChange={(e) => onChange({ ...session, name: e.target.value })} />
        </Field>
        <Field label="Time">
          <input
            type="time"
            value={session.scheduledTime}
            onChange={(e) => onChange({ ...session, scheduledTime: e.target.value })}
          />
        </Field>
        <Field label="Minutes">
          <input
            type="number"
            min={5}
            value={session.targetMinutes}
            onChange={(e) => onChange({ ...session, targetMinutes: Number(e.target.value) })}
          />
        </Field>
        <Button kind="danger" onClick={onRemove} title="Remove this session">
          <Icon name="close" size={11} strokeWidth={2.2} />
        </Button>
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <div style={{ display: 'flex', gap: 4 }}>
          {DAYS.map((d, i) => {
            const day = i + 1
            const on = session.days.includes(day)
            return (
              <button
                key={day}
                onClick={() => toggleDay(day)}
                className="display"
                style={{
                  width: 30,
                  height: 28,
                  fontSize: 11,
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
        {session.rationale ? (
          <span style={{ fontSize: 10.5, color: 'var(--faint)', textWrap: 'pretty' }}>{session.rationale}</span>
        ) : null}
      </div>
    </div>
  )
}

function MilestoneEditor({
  milestone,
  onChange,
  onRemove
}: {
  milestone: GoalMilestone
  onChange: (m: GoalMilestone) => void
  onRemove: () => void
}) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '130px 1fr auto', gap: 10, alignItems: 'center' }}>
      <input
        type="date"
        value={milestone.dueDate}
        onChange={(e) => onChange({ ...milestone, dueDate: e.target.value })}
      />
      <input value={milestone.title} onChange={(e) => onChange({ ...milestone, title: e.target.value })} />
      <Button kind="danger" onClick={onRemove} title="Remove this milestone">
        <Icon name="close" size={11} strokeWidth={2.2} />
      </Button>
    </div>
  )
}

export default function GoalWizard({ onDone, onCancel }: { onDone: () => void; onCancel: () => void }) {
  const [step, setStep] = useState<Step>('describe')
  const [input, setInput] = useState<GoalDraftInput>(blank)
  const [plan, setPlan] = useState<GoalPlan | null>(null)
  const [warnings, setWarnings] = useState<string[]>([])
  const [iterations, setIterations] = useState(0)
  const [progress, setProgress] = useState<GoalPlanProgress | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [providerLabel, setProviderLabel] = useState('')

  useEffect(() => {
    void window.api.ai.status().then((s) => {
      setHasKey(s.ready)
      setProviderLabel(s.providers.find((p) => p.id === s.provider)?.label ?? '')
    })
  }, [])

  useEffect(() => window.api.on.goalProgress(setProgress), [])

  const draft = async (): Promise<void> => {
    setError(null)
    setBusy(true)
    setProgress(null)
    setStep('planning')
    try {
      const result = await window.api.goals.draftPlan(input)
      setPlan(result.plan)
      setWarnings(result.warnings)
      setIterations(result.iterations)
      setStep('review')
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
      setStep('describe')
    } finally {
      setBusy(false)
      setProgress(null)
    }
  }

  const commit = async (): Promise<void> => {
    if (!plan) return
    setError(null)
    setBusy(true)
    try {
      await window.api.goals.commit(input, plan)
      onDone()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  const weeklyTotal = plan ? plan.sessions.reduce((s, x) => s + x.days.length * x.targetMinutes, 0) : 0

  return (
    <div style={{ padding: '18px 24px', display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
          <span className="display" style={{ fontSize: 21 }}>
            {step === 'review' ? input.title : 'New goal'}
          </span>
          <span className="label">
            {step === 'describe' ? 'Step 1 · Describe it' : step === 'planning' ? 'Step 2 · Drafting' : 'Step 3 · Review and approve'}
          </span>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <Button onClick={onCancel} disabled={busy}>
            CANCEL
          </Button>
          {step === 'describe' ? (
            <Button kind="solid" disabled={busy || !input.title.trim() || hasKey === false} onClick={() => void draft()}>
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <Icon name="sparkle" size={12} />
                DRAFT A PLAN
              </span>
            </Button>
          ) : null}
          {step === 'review' ? (
            <>
              <Button disabled={busy} onClick={() => void draft()}>
                REGENERATE
              </Button>
              <Button kind="solid" disabled={busy || !plan || plan.sessions.length === 0} onClick={() => void commit()}>
                CREATE HABITS
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {error ? <ErrorBox text={error} /> : null}

      {hasKey === false ? (
        <ErrorBox text={`Add ${providerLabel ? `a ${providerLabel}` : 'an'} API key under Settings → AI planner before drafting a plan.`} />
      ) : null}

      {step === 'describe' ? (
        <>
          <Field label="What do you want to achieve?">
            <input
              value={input.title}
              placeholder="Hold a basic conversation in Spanish"
              onChange={(e) => setInput({ ...input, title: e.target.value })}
            />
          </Field>
          <Field
            label="Anything the planner should know"
            hint="Where you are starting from, what you have tried, constraints, what motivates you"
          >
            <textarea
              rows={4}
              value={input.description ?? ''}
              onChange={(e) => setInput({ ...input, description: e.target.value || null })}
            />
          </Field>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 14 }}>
            <Field label="Target date" hint="Leave blank for an open-ended goal">
              <input
                type="date"
                value={input.targetDate ?? ''}
                onChange={(e) => setInput({ ...input, targetDate: e.target.value || null })}
              />
            </Field>
            <Field label="Time per week (minutes)" hint="The plan will stay inside this">
              <input
                type="number"
                min={15}
                step={15}
                value={input.weeklyMinutesBudget ?? ''}
                onChange={(e) =>
                  setInput({ ...input, weeklyMinutesBudget: e.target.value === '' ? null : Number(e.target.value) })
                }
              />
            </Field>
          </div>
          <span style={{ fontSize: 11.5, lineHeight: 1.55, color: 'var(--faint)', textWrap: 'pretty' }}>
            The planner researches the goal, drafts sessions and milestones around your existing habits,
            then reviews its own draft before you see it. You can edit everything before anything is
            created.
          </span>
        </>
      ) : null}

      {step === 'planning' ? (
        <Card style={{ display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'flex-start' }}>
          <CardTitle>{progress ? PHASE_LABEL[progress.phase] : 'Starting'}</CardTitle>
          <span style={{ fontSize: 12, color: 'var(--dim)' }}>
            {progress
              ? progress.iteration > 1
                ? `Attempt ${progress.iteration} of ${progress.maxIterations} — the reviewer sent the last draft back.`
                : 'This takes a minute or so: research, a draft, then an independent review.'
              : 'Contacting the planner…'}
          </span>
          <div style={{ display: 'flex', gap: 6 }}>
            {(['researching', 'drafting', 'reviewing'] as const).map((p) => {
              const active = progress?.phase === p || (progress?.phase === 'revising' && p === 'drafting')
              const done =
                progress &&
                ['researching', 'drafting', 'reviewing'].indexOf(
                  progress.phase === 'revising' ? 'drafting' : progress.phase
                ) > ['researching', 'drafting', 'reviewing'].indexOf(p)
              return (
                <span
                  key={p}
                  className="display"
                  style={{
                    fontSize: 10,
                    letterSpacing: '0.1em',
                    padding: '4px 9px',
                    border: `1px solid ${active ? 'var(--accent)' : done ? 'var(--ok)' : 'var(--line)'}`,
                    color: active ? 'var(--accent)' : done ? 'var(--ok)' : 'var(--faint)'
                  }}
                >
                  {p.toUpperCase()}
                </span>
              )
            })}
          </div>
        </Card>
      ) : null}

      {step === 'review' && plan ? (
        <>
          {warnings.length > 0 ? (
            <div
              style={{
                border: '1px solid var(--gold)',
                background: 'color-mix(in oklab, var(--gold) 10%, transparent)',
                padding: '10px 13px',
                display: 'flex',
                flexDirection: 'column',
                gap: 4
              }}
            >
              <Label>The reviewer could not settle these — check them yourself</Label>
              {warnings.map((w, i) => (
                <span key={i} style={{ fontSize: 11.5, color: 'var(--fg)', textWrap: 'pretty' }}>
                  {w}
                </span>
              ))}
            </div>
          ) : null}

          <Card style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 12.5, lineHeight: 1.6, textWrap: 'pretty' }}>{plan.summary}</span>
            <span className="label">
              {iterations === 1 ? 'Accepted on the first draft' : `Accepted after ${iterations} drafts`} ·{' '}
              {duration(weeklyTotal)} per week
              {input.weeklyMinutesBudget ? ` of ${duration(input.weeklyMinutesBudget)} budgeted` : ''}
            </span>
          </Card>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Label>Sessions — each becomes a habit</Label>
              <Button
                onClick={() =>
                  setPlan({
                    ...plan,
                    sessions: [
                      ...plan.sessions,
                      { name: 'New session', days: [1, 3, 5], scheduledTime: '18:00', targetMinutes: 30, rationale: null }
                    ]
                  })
                }
              >
                ADD
              </Button>
            </div>
            {plan.sessions.map((s, i) => (
              <SessionEditor
                key={i}
                session={s}
                onChange={(next) => setPlan({ ...plan, sessions: plan.sessions.map((x, j) => (j === i ? next : x)) })}
                onRemove={() => setPlan({ ...plan, sessions: plan.sessions.filter((_, j) => j !== i) })}
              />
            ))}
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <Label>Milestones — each becomes a to-do on its date</Label>
              <Button
                onClick={() =>
                  setPlan({
                    ...plan,
                    milestones: [
                      ...plan.milestones,
                      { title: 'New milestone', dueDate: input.targetDate ?? addDays(toLocalDate(new Date()), 14), description: null }
                    ]
                  })
                }
              >
                ADD
              </Button>
            </div>
            {plan.milestones.map((m, i) => (
              <MilestoneEditor
                key={i}
                milestone={m}
                onChange={(next) => setPlan({ ...plan, milestones: plan.milestones.map((x, j) => (j === i ? next : x)) })}
                onRemove={() => setPlan({ ...plan, milestones: plan.milestones.filter((_, j) => j !== i) })}
              />
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))', gap: 14 }}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
              <Label>Mind map</Label>
              <MindMap nodes={plan.mindMap} />
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 0 }}>
              <Label>Resources</Label>
              {plan.resources.length === 0 ? (
                <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>No resources suggested.</span>
              ) : null}
              {plan.resources.map((r, i) => (
                <div
                  key={i}
                  style={{
                    border: '1px solid var(--line)',
                    background: 'var(--panel)',
                    padding: '9px 12px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 3
                  }}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className="display" style={{ fontSize: 13 }}>
                      {r.title}
                    </span>
                    <span
                      style={{
                        fontSize: 9,
                        letterSpacing: '0.08em',
                        color: 'var(--faint)',
                        border: '1px solid var(--line)',
                        padding: '1px 5px'
                      }}
                    >
                      {r.type.toUpperCase()}
                    </span>
                  </span>
                  <span style={{ fontSize: 11.5, color: 'var(--dim)', textWrap: 'pretty' }}>{r.note}</span>
                  {r.url ? (
                    <button
                      onClick={() => void window.api.app.openExternal(r.url!)}
                      style={{ alignSelf: 'flex-start', fontSize: 11, color: 'var(--accent)', textDecoration: 'underline' }}
                    >
                      {r.url}
                    </button>
                  ) : (
                    <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>No verified link — search for it</span>
                  )}
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </div>
  )
}
