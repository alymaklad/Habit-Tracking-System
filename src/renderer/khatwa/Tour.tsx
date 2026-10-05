import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Backpack, CalendarDays, CircleCheckBig, Mountain, Plus } from 'lucide-react'
import emblem from '../assets/emblem-large.png'
import wordmark from '../assets/wordmark-ar.png'
import type { Route } from './nav'

type Step = {
  key: string
  title: string
  body: ReactNode
  /** The `data-tour` marker to light up; none means a centred card over the dimmed app. */
  target?: string
  /** The screen to show behind this step. */
  route?: Route
}

const STEPS: Step[] = [
  { key: 'welcome', title: 'Welcome to Khatwa', body: null },
  {
    key: 'sidebar',
    title: 'Everything is in the sidebar',
    target: 'sidebar',
    route: { name: 'today' },
    body: (
      <>
        It has three parts. <b>Main</b> is your day, your past and your goals. <b>Habits &amp; progress</b> has the details. <b>Reflection</b> is for letting go and
        writing. Settings is at the bottom.
      </>
    )
  },
  {
    key: 'today',
    title: 'Start each day on Today',
    target: 'nav-today',
    route: { name: 'today' },
    body: 'It shows today’s habits and what to do next. Tick a habit when it’s done, or start a timed session. Your streak grows each day you keep going.'
  },
  {
    key: 'mountains',
    title: 'Mountains are your big goals',
    target: 'nav-mountains',
    route: { name: 'mountains' },
    body: 'Choose one, like “Learn Spanish”. The planner suggests milestones and weekly habits that fit your time. You can change everything before it’s saved.'
  },
  {
    key: 'habits',
    title: 'Habits & progress',
    target: 'group-habits',
    route: { name: 'habits' },
    body: 'Habits lists every habit. To-do is for one-off tasks. Calendar shows your week, and Progress and Weekly review show how it’s going.'
  },
  {
    key: 'reflection',
    title: 'Let go, and look back',
    target: 'group-reflection',
    route: { name: 'letgo' },
    body: 'Let Go helps you stop a habit you don’t want. You check in each evening, without guilt, and the planner can help you make a plan. Journal is for notes, photos and monthly memories.'
  },
  { key: 'ready', title: 'You’re ready', body: null }
]

const LAST = STEPS.length - 1

/** The tour's progress, drawn as the app's own trail: walked in laurel, "you are here" in ochre. */
function TrailProgress({ at }: { at: number }) {
  const pts = STEPS.map((_, i) => ({ x: 8 + i * 30, y: 34 - i * 4.4 }))
  const line = (to: number): string => pts.slice(0, to + 1).map((p, i) => `${i ? 'L' : 'M'}${p.x},${p.y}`).join(' ')
  return (
    <svg className="kh-tour-trail" viewBox="0 0 196 42" width="196" height="42" aria-hidden="true">
      <path d={line(LAST)} fill="none" stroke="var(--ochre)" strokeWidth="2" strokeDasharray="4 5" strokeLinecap="round" />
      {at > 0 ? <path d={line(at)} fill="none" stroke="var(--laurel)" strokeWidth="2.5" strokeLinecap="round" /> : null}
      {pts.map((p, i) =>
        i === at ? (
          <g key={i}>
            <circle cx={p.x} cy={p.y} r="8.5" fill="var(--ochre-wash)" />
            <circle cx={p.x} cy={p.y} r="4.5" fill="var(--ochre-deep)" />
          </g>
        ) : (
          <circle key={i} cx={p.x} cy={p.y} r="3.6" fill={i < at ? 'var(--laurel)' : 'var(--card)'} stroke="var(--laurel)" strokeWidth="1.5" />
        )
      )}
    </svg>
  )
}

/**
 * The first-time tour. Welcome and the last step are cards over the dimmed app; the steps
 * in between show the real screen with the part being explained lit up, so people learn
 * where things are, not what a picture of them looks like.
 */
export default function Tour({
  onNavigate,
  onFinish
}: {
  onNavigate: (route: Route) => void
  /** `then`: where to go after the last step, when the person picked a first action. */
  onFinish: (then?: Route) => void
}) {
  const [i, setI] = useState(0)
  const [rect, setRect] = useState<DOMRect | null>(null)
  const nextRef = useRef<HTMLButtonElement>(null)
  const step = STEPS[i]!

  // Show the screen this step talks about.
  useEffect(() => {
    if (step.route) onNavigate(step.route)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [i])

  // Find what to light up; the screen may still be rendering, so look again briefly.
  useLayoutEffect(() => {
    if (!step.target) {
      setRect(null)
      return
    }
    const find = (): void => {
      const el = document.querySelector(`[data-tour="${step.target}"]`)
      setRect(el ? el.getBoundingClientRect() : null)
    }
    find()
    const t1 = setTimeout(find, 80)
    const t2 = setTimeout(find, 300)
    window.addEventListener('resize', find)
    return () => {
      clearTimeout(t1)
      clearTimeout(t2)
      window.removeEventListener('resize', find)
    }
  }, [step.target, i])

  useEffect(() => {
    nextRef.current?.focus()
  }, [i])

  const next = useCallback(() => (i === LAST ? onFinish() : setI(i + 1)), [i, onFinish])
  const back = useCallback(() => setI((x) => Math.max(0, x - 1)), [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onFinish()
      else if (e.key === 'ArrowRight') next()
      else if (e.key === 'ArrowLeft') back()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [next, back, onFinish])

  // Beside the lit area when there is one (the sidebar is on the left), else centred.
  const PAD = 8
  const cardStyle: React.CSSProperties | undefined = rect
    ? {
        left: Math.min(rect.right + 28, window.innerWidth - 440),
        top: Math.max(24, Math.min(rect.top + Math.min(rect.height, 240) / 2 - 150, window.innerHeight - 380))
      }
    : undefined

  const footer = (
    <div className="kh-tour-foot">
      {i < LAST ? (
        <button type="button" className="kh-btn is-ghost" onClick={() => onFinish()}>
          Skip the tour
        </button>
      ) : (
        <span />
      )}
      <span className="flex gap-2">
        {i > 0 ? (
          <button type="button" className="kh-btn is-soft" onClick={back}>
            Back
          </button>
        ) : null}
        <button ref={nextRef} type="button" className="kh-btn is-laurel" onClick={next}>
          {i === 0 ? 'Start the tour' : i === LAST ? 'Start using Khatwa' : 'Next'}
        </button>
      </span>
    </div>
  )

  return createPortal(
    <div className="kh-tour" role="dialog" aria-modal="true" aria-labelledby="kh-tour-title">
      {rect ? (
        <div
          className="kh-tour-hole"
          style={{ top: rect.top - PAD, left: rect.left - PAD, width: rect.width + PAD * 2, height: rect.height + PAD * 2 }}
          aria-hidden="true"
        />
      ) : (
        <div className="kh-tour-dim" aria-hidden="true" />
      )}

      <section className={`kh-tour-card ${rect ? 'is-beside' : 'is-centred'} ${i === 0 || i === LAST ? 'is-wide' : ''}`} style={cardStyle} key={step.key}>
        <div className="kh-tour-progress">
          <TrailProgress at={i} />
          <span className="t-caption">
            Step {i + 1} of {STEPS.length}
          </span>
        </div>

        {i === 0 ? (
          <div className="kh-tour-brand">
            <img src={emblem} alt="" />
            <img src={wordmark} alt="Khatwa" className="kh-tour-wordmark" />
          </div>
        ) : null}

        <h2 id="kh-tour-title" className="kh-tour-title">
          {step.title}
        </h2>

        {i === 0 ? (
          <>
            <p className="kh-tour-body">Khatwa helps you reach big goals through small daily steps. This short tour shows you around. It takes about a minute.</p>
            <ul className="kh-tour-ideas">
              <li>
                <Mountain size={18} />
                <span>
                  <b>Mountains</b> are your big goals, turned into milestones and weekly habits.
                </span>
              </li>
              <li>
                <CircleCheckBig size={18} />
                <span>
                  <b>Habits</b> are small steps you repeat. You tick them off each day.
                </span>
              </li>
              <li>
                <Backpack size={18} />
                <span>
                  <b>Let Go</b> is for habits you want to stop, with a kind check-in each evening.
                </span>
              </li>
            </ul>
          </>
        ) : i === LAST ? (
          <>
            <p className="kh-tour-body">A good first step is one of these. You can replay this tour any time in Settings.</p>
            <div className="kh-tour-actions">
              <button type="button" onClick={() => onFinish({ name: 'expedition' })}>
                <Mountain size={18} />
                <span>
                  <b>Choose your first mountain</b>
                  <span>Let the planner turn a big goal into steps.</span>
                </span>
              </button>
              <button type="button" onClick={() => onFinish({ name: 'habits', edit: 'new' })}>
                <Plus size={18} />
                <span>
                  <b>Add a habit</b>
                  <span>Start with one small thing you want to do each day.</span>
                </span>
              </button>
              <button type="button" onClick={() => onFinish({ name: 'settings' })}>
                <CalendarDays size={18} />
                <span>
                  <b>Link Google Calendar</b>
                  <span>Get reminders on your phone.</span>
                </span>
              </button>
            </div>
          </>
        ) : (
          <p className="kh-tour-body">{step.body}</p>
        )}

        {footer}
      </section>
    </div>,
    document.body
  )
}
