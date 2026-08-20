import type { ReactNode } from 'react'

/** Shared page chrome: title bar plus a scrolling body. */
export default function Screen({
  title,
  subtitle,
  actions,
  children,
  scroll = true
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  scroll?: boolean
}) {
  return (
    <>
      <header
        style={{
          flexShrink: 0,
          padding: '20px 26px 18px',
          borderBottom: '1px solid var(--line)',
          background: 'var(--panel)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 30
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: 3, minWidth: 0 }}>
          <span className="display" style={{ fontSize: 24, lineHeight: 1 }}>
            {title}
          </span>
          {subtitle ? <span className="label">{subtitle}</span> : null}
        </div>
        {actions}
      </header>

      <div
        style={{
          flexGrow: 1,
          minHeight: 0,
          overflowY: scroll ? 'auto' : 'hidden',
          overflowX: 'hidden',
          display: 'flex',
          flexDirection: 'column'
        }}
      >
        {children}
      </div>
    </>
  )
}
