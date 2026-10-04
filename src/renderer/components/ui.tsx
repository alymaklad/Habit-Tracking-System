import type { CSSProperties, ReactNode } from 'react'

/*
  The primitives the Settings screen and sync panel were built on, re-voiced for Khatwa.
  New screens use `khatwa/ui` directly; these keep the older call sites unchanged.
*/

export function Card({ children, style, accent }: { children: ReactNode; style?: CSSProperties; accent?: string }) {
  return (
    <div
      className="kh-card"
      style={{
        padding: '22px 24px',
        ...(accent && accent !== 'var(--line)' ? { borderColor: accent, boxShadow: `var(--shadow-rest), inset 3px 0 0 ${accent}` } : {}),
        ...style
      }}
    >
      {children}
    </div>
  )
}

export function CardTitle({ children }: { children: ReactNode }) {
  return <span className="t-h2">{children}</span>
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="label">{children}</span>
}

type ButtonKind = 'solid' | 'ghost' | 'danger' | 'gold'

const KIND: Record<ButtonKind, string> = {
  solid: 'is-laurel',
  gold: 'is-ochre',
  ghost: 'is-soft',
  danger: 'is-danger'
}

export function Button({
  children,
  onClick,
  kind = 'ghost',
  disabled,
  style,
  title
}: {
  children: ReactNode
  onClick?: () => void
  kind?: ButtonKind
  disabled?: boolean
  style?: CSSProperties
  title?: string
}) {
  return (
    <button title={title} onClick={onClick} disabled={disabled} className={`kh-btn is-sm ${KIND[kind]}`} style={style}>
      {children}
    </button>
  )
}

export function Toggle({ on, onChange }: { on: boolean; onChange: (next: boolean) => void }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className="shrink-0 relative rounded-full transition-colors"
      style={{
        width: 40,
        height: 22,
        background: on ? 'var(--laurel)' : 'var(--docket)',
        boxShadow: on ? 'none' : 'var(--inset)'
      }}
    >
      <span
        className="absolute rounded-full transition-[left]"
        style={{
          top: 3,
          left: on ? 21 : 3,
          width: 16,
          height: 16,
          background: on ? 'var(--on-solid)' : 'var(--card)',
          boxShadow: '0 1px 2px rgba(36,33,29,.25)'
        }}
      />
    </button>
  )
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="kh-field">
      <span className="kh-field-label">{label}</span>
      {children}
      {hint ? <span className="kh-field-hint">{hint}</span> : null}
    </div>
  )
}

/**
 * Shown when a screen's data could not be loaded — rendering nothing would be
 * indistinguishable from a screen that is genuinely empty.
 */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="kh-sheet p-7 flex flex-col gap-3 items-start">
      <span className="t-h2 text-[var(--error)]">This page could not be opened.</span>
      <span className="text-ink-3 [text-wrap:pretty]">{message}</span>
      <span className="t-caption">If the app was updated while it was open, restarting it usually fixes this.</span>
      {onRetry ? (
        <button className="kh-btn is-ochre" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  )
}

export function Loading() {
  return (
    <div className="flex items-center gap-3 py-16 justify-center">
      <span className="kh-dot kh-breathe" />
      <span className="t-italic">Opening the folio…</span>
    </div>
  )
}
