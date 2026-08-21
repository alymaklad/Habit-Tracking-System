import type { CSSProperties, ReactNode } from 'react'

export function Card({
  children,
  style,
  accent
}: {
  children: ReactNode
  style?: CSSProperties
  accent?: string
}) {
  return (
    <div
      style={{
        background: 'var(--panel)',
        border: `1px solid ${accent ?? 'var(--line)'}`,
        padding: '16px 18px',
        ...style
      }}
    >
      {children}
    </div>
  )
}

export function CardTitle({ children }: { children: ReactNode }) {
  return (
    <span className="display" style={{ fontSize: 15, letterSpacing: '0.03em' }}>
      {children}
    </span>
  )
}

export function Label({ children }: { children: ReactNode }) {
  return <span className="label">{children}</span>
}

type ButtonKind = 'solid' | 'ghost' | 'danger' | 'gold'

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
  const palette: Record<ButtonKind, CSSProperties> = {
    solid: { border: '1px solid var(--accent)', background: 'var(--accent)', color: 'var(--accent-ink)' },
    gold: { border: '1px solid var(--gold)', background: 'var(--gold)', color: 'var(--accent-ink)' },
    ghost: { border: '1px solid var(--line)', background: 'transparent', color: 'var(--dim)' },
    danger: { border: '1px solid var(--bad)', background: 'transparent', color: 'var(--bad)' }
  }
  return (
    <button
      title={title}
      onClick={onClick}
      disabled={disabled}
      className="display"
      style={{
        padding: '7px 13px',
        fontSize: 11.5,
        fontWeight: 600,
        letterSpacing: '0.1em',
        whiteSpace: 'nowrap',
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'filter .12s ease',
        ...palette[kind],
        ...style
      }}
      onMouseEnter={(e) => {
        if (!disabled) e.currentTarget.style.filter = 'brightness(1.15)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.filter = 'none'
      }}
    >
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
      style={{
        width: 34,
        height: 18,
        borderRadius: 9,
        flexShrink: 0,
        position: 'relative',
        background: on ? 'var(--accent)' : 'var(--panel2)',
        border: on ? '1px solid var(--accent)' : '1px solid var(--line)',
        transition: 'background .15s ease'
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 1,
          left: on ? 17 : 1,
          width: 14,
          height: 14,
          borderRadius: '50%',
          background: on ? 'var(--accent-ink)' : 'var(--faint)',
          transition: 'left .15s ease'
        }}
      />
    </button>
  )
}

/** Circular progress used on the habit cards. */
export function Ring({
  percent,
  color,
  size = 62,
  stroke = 5,
  children
}: {
  percent: number
  color: string
  size?: number
  stroke?: number
  children?: ReactNode
}) {
  const r = size / 2 - stroke / 2 - 1
  const c = 2 * Math.PI * r
  const filled = c * Math.min(1, Math.max(0, percent / 100))
  return (
    <div style={{ position: 'relative', width: size, height: size, flexShrink: 0 }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--panel2)" strokeWidth={stroke} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={stroke}
          strokeDasharray={`${filled.toFixed(2)} ${(c - filled).toFixed(2)}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: 'stroke-dasharray .4s ease' }}
        />
      </svg>
      <div
        style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center'
        }}
      >
        {children}
      </div>
    </div>
  )
}

export function Bar({ value, color = 'var(--accent)', height = 4 }: { value: number; color?: string; height?: number }) {
  return (
    <div style={{ height, background: 'var(--panel2)', overflow: 'hidden', width: '100%' }}>
      <div
        style={{
          width: `${Math.min(100, Math.max(0, value))}%`,
          height: '100%',
          background: color,
          transition: 'width .35s ease'
        }}
      />
    </div>
  )
}

export function Field({
  label,
  hint,
  children
}: {
  label: string
  hint?: string
  children: ReactNode
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, minWidth: 0 }}>
      <Label>{label}</Label>
      {children}
      {hint ? <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>{hint}</span> : null}
    </div>
  )
}

export function Tier({ level }: { level: number }) {
  return (
    <span
      className="display"
      style={{
        fontSize: 9.5,
        letterSpacing: '0.08em',
        color: 'var(--gold)',
        border: '1px solid var(--gold)',
        padding: '1px 5px',
        flexShrink: 0
      }}
    >
      T{level}
    </span>
  )
}

/**
 * Shown when a screen's data could not be loaded.
 *
 * This exists because the alternative — rendering nothing — is indistinguishable from
 * a screen that is genuinely empty, and hides the reason entirely.
 */
export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div
      style={{
        flexGrow: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40
      }}
    >
      <div
        style={{
          maxWidth: 480,
          display: 'flex',
          flexDirection: 'column',
          gap: 12,
          alignItems: 'center',
          textAlign: 'center'
        }}
      >
        <span className="display" style={{ fontSize: 18, color: 'var(--bad)' }}>
          This screen could not load
        </span>
        <span
          className="num"
          style={{
            fontSize: 11.5,
            fontWeight: 400,
            color: 'var(--dim)',
            background: 'var(--panel)',
            border: '1px solid var(--line)',
            padding: '10px 13px',
            textWrap: 'pretty',
            textAlign: 'left',
            width: '100%'
          }}
        >
          {message}
        </span>
        <span style={{ fontSize: 11.5, lineHeight: 1.55, color: 'var(--faint)', textWrap: 'pretty' }}>
          If the app was updated while it was open, restarting it usually fixes this.
        </span>
        {onRetry ? <Button onClick={onRetry}>TRY AGAIN</Button> : null}
      </div>
    </div>
  )
}

export function Loading() {
  return (
    <div
      style={{
        flexGrow: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        color: 'var(--faint)'
      }}
    >
      <span className="label">Loading…</span>
    </div>
  )
}

export function Empty({ title, body }: { title: string; body: string }) {
  return (
    <div
      style={{
        flexGrow: 1,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 40
      }}
    >
      <div style={{ maxWidth: 420, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <span className="display" style={{ fontSize: 18 }}>
          {title}
        </span>
        <span style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--dim)', textWrap: 'pretty' }}>
          {body}
        </span>
      </div>
    </div>
  )
}
