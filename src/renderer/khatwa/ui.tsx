import { useEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Check, CircleCheck, TriangleAlert, X } from 'lucide-react'

type Tone = 'plain' | 'ochre' | 'ochre-solid' | 'laurel' | 'laurel-solid' | 'slate' | 'outline'

export function Stamp({ children, tone = 'plain', className = '' }: { children: ReactNode; tone?: Tone; className?: string }) {
  return <span className={`kh-stamp ${tone === 'plain' ? '' : `is-${tone}`} ${className}`}>{children}</span>
}

export function Eyebrow({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`kh-eyebrow ${className}`}>{children}</div>
}

export function Dot({ tone = 'ochre' }: { tone?: 'ochre' | 'laurel' | 'slate' | 'faint' }) {
  return <span className={`kh-dot ${tone === 'ochre' ? '' : `is-${tone}`}`} />
}

type BtnKind = 'ochre' | 'laurel' | 'ruled' | 'soft' | 'ghost' | 'danger'

export function Btn({
  children,
  kind = 'soft',
  size,
  onClick,
  disabled,
  title,
  className = '',
  type = 'button'
}: {
  children: ReactNode
  kind?: BtnKind
  size?: 'sm' | 'lg'
  onClick?: () => void
  disabled?: boolean
  title?: string
  className?: string
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      title={title}
      disabled={disabled}
      onClick={onClick}
      className={`kh-btn is-${kind} ${size ? `is-${size}` : ''} ${className}`}
    >
      {children}
    </button>
  )
}

export function IconBtn({
  children,
  onClick,
  title,
  disabled
}: {
  children: ReactNode
  onClick?: () => void
  title: string
  disabled?: boolean
}) {
  return (
    <button className="kh-icon-btn" onClick={onClick} title={title} aria-label={title} disabled={disabled}>
      {children}
    </button>
  )
}

export function Field({
  label,
  hint,
  children,
  aside
}: {
  label: ReactNode
  hint?: ReactNode
  children: ReactNode
  aside?: ReactNode
}) {
  return (
    <label className="kh-field">
      <span className="flex items-baseline justify-between gap-3">
        <span className="kh-field-label">{label}</span>
        {aside}
      </span>
      {children}
      {hint ? <span className="kh-field-hint">{hint}</span> : null}
    </label>
  )
}

/** A thin progress ring, as drawn in pencil around a count. */
export function Ring({
  value,
  size = 44,
  stroke = 3,
  tone = 'laurel',
  children
}: {
  value: number
  size?: number
  stroke?: number
  tone?: 'laurel' | 'ochre'
  children?: ReactNode
}) {
  const r = (size - stroke) / 2
  const c = 2 * Math.PI * r
  const v = Math.max(0, Math.min(1, value))
  return (
    <span className="relative inline-grid place-items-center shrink-0" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="absolute inset-0 -rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--rule)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={tone === 'laurel' ? 'var(--laurel)' : 'var(--ochre-deep)'}
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`}
          style={{ transition: 'stroke-dasharray .5s ease' }}
        />
      </svg>
      <span className="relative">{children}</span>
    </span>
  )
}

export function Bar({ value, tone = 'laurel', thin }: { value: number; tone?: 'laurel' | 'ochre' | 'slate'; thin?: boolean }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100)
  return (
    <div className={`kh-bar ${tone === 'laurel' ? '' : `is-${tone}`} ${thin ? 'is-thin' : ''}`} role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span style={{ width: `${pct}%` }} />
    </div>
  )
}

export function CheckBox({
  state,
  onClick,
  disabled,
  round,
  small,
  label
}: {
  state: 'done' | 'partial' | 'missed' | 'open'
  onClick?: () => void
  disabled?: boolean
  round?: boolean
  small?: boolean
  label: string
}) {
  const cls = `kh-check ${round && state === 'open' ? 'is-round' : ''} ${state === 'open' ? '' : `is-${state}`} ${small ? 'is-sm' : ''}`
  return (
    <button className={cls} onClick={onClick} disabled={disabled} aria-label={label} aria-pressed={state === 'done'} title={label}>
      {state === 'done' ? <Check size={small ? 12 : 15} strokeWidth={2.6} /> : state === 'missed' ? <X size={small ? 11 : 13} strokeWidth={2.4} /> : state === 'partial' ? <span className="text-[11px] font-bold">½</span> : null}
    </button>
  )
}

export function Empty({ title, body, action }: { title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="kh-empty">
      <span className="t-h2 text-ink">{title}</span>
      {body ? <span className="max-w-[440px] text-[14px] leading-[22px]">{body}</span> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}

export function Alert({ children, tone = 'error' }: { children: ReactNode; tone?: 'error' | 'ochre' | 'laurel' }) {
  return (
    <div className={`kh-alert ${tone === 'error' ? '' : `is-${tone}`}`} role={tone === 'error' ? 'alert' : 'status'}>
      {tone === 'laurel' ? <CircleCheck size={16} className="mt-[2px] shrink-0" /> : <TriangleAlert size={16} className="mt-[2px] shrink-0" />}
      <div className="min-w-0 [text-wrap:pretty]">{children}</div>
    </div>
  )
}

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <div className="flex items-center gap-3 py-16 justify-center text-ink-3">
      <span className="kh-dot kh-breathe" />
      <span className="t-italic">{label}</span>
    </div>
  )
}

export function LoadError({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="kh-sheet p-7 flex flex-col gap-3 items-start">
      <span className="t-h2">This page could not be opened.</span>
      <span className="text-ink-3 [text-wrap:pretty]">{message}</span>
      {onRetry ? (
        <Btn kind="ochre" onClick={onRetry}>
          Try again
        </Btn>
      ) : null}
    </div>
  )
}

export function Modal({
  children,
  onClose,
  width = 680,
  label
}: {
  children: ReactNode
  onClose: () => void
  width?: number
  label: string
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  // Portalled to the body: a page's entrance animation keeps a transform in effect, which
  // would otherwise become the containing block and clip the fixed overlay to the page.
  return createPortal(
    <div className="kh-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="kh-modal kh-rise" style={{ width: `min(${width}px, 100%)` }} role="dialog" aria-modal="true" aria-label={label}>
        {children}
      </div>
    </div>,
    document.body
  )
}

const WEEKDAY_LETTERS = ['M', 'T', 'W', 'T', 'F', 'S', 'S']
const WEEKDAY_NAMES = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday']

/** ISO weekday picker, Monday = 1 … Sunday = 7. */
export function DaysPicker({ days, onChange }: { days: number[]; onChange: (days: number[]) => void }) {
  return (
    <div className="kh-days" role="group" aria-label="Repeats on">
      {WEEKDAY_LETTERS.map((letter, i) => {
        const day = i + 1
        const on = days.includes(day)
        return (
          <button
            type="button"
            key={day}
            className={on ? 'is-on' : ''}
            aria-pressed={on}
            title={WEEKDAY_NAMES[i]}
            onClick={() => onChange(on ? days.filter((d) => d !== day) : [...days, day].sort((a, b) => a - b))}
          >
            {letter}
          </button>
        )
      })}
    </div>
  )
}

/** A figure with its caption, as on a ledger page. */
export function Figure({
  label,
  value,
  unit,
  note,
  tone = 'ink'
}: {
  label: ReactNode
  value: ReactNode
  unit?: ReactNode
  note?: ReactNode
  tone?: 'ink' | 'laurel' | 'ochre'
}) {
  const color = tone === 'laurel' ? 'text-laurel' : tone === 'ochre' ? 'text-[var(--ochre-deep)]' : 'text-ink'
  return (
    <div className="flex flex-col gap-1 min-w-0">
      <span className="t-stamp text-ink-3">{label}</span>
      <span className={`font-serif text-[30px] leading-[36px] t-num ${color}`}>
        {value}
        {unit ? <span className="ml-1.5 font-sans text-[13px] text-ink-3">{unit}</span> : null}
      </span>
      {note ? <span className="t-caption [text-wrap:pretty]">{note}</span> : null}
    </div>
  )
}

export function Seal({ earned, children, tone = 'ochre' }: { earned: boolean; children: ReactNode; tone?: 'ochre' | 'laurel' }) {
  return <span className={`kh-seal ${earned ? (tone === 'laurel' ? 'is-laurel' : 'is-earned') : ''}`}>{children}</span>
}

/** Small tick used in lists. */
export function Tick() {
  return <Check size={13} strokeWidth={2.4} className="text-laurel" />
}
