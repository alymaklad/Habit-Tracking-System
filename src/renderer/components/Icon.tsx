interface Props {
  name: keyof typeof PATHS
  size?: number
  color?: string
  strokeWidth?: number
}

/**
 * Stroke icons on a 24px grid, drawn inline so they scale and recolour with the
 * surrounding text. No emoji — the design calls for a tool, not a toy.
 */
const PATHS = {
  dashboard: (
    <>
      <rect x="3" y="3" width="7" height="7" />
      <rect x="14" y="3" width="7" height="7" />
      <rect x="3" y="14" width="7" height="7" />
      <rect x="14" y="14" width="7" height="7" />
    </>
  ),
  habits: (
    <>
      <path d="M9 6h11M9 12h11M9 18h11" />
      <path d="M4 6l1.2 1.2L7.5 5" />
      <path d="M4 12l1.2 1.2L7.5 10" />
      <path d="M4 18l1.2 1.2L7.5 16" />
    </>
  ),
  calendar: (
    <>
      <rect x="3" y="5" width="18" height="16" />
      <path d="M3 10h18M8 3v4M16 3v4" />
    </>
  ),
  progress: (
    <>
      <path d="M3 20h18" />
      <path d="M6 20V11M11 20V5M16 20v-6M21 20v-9" />
    </>
  ),
  leaderboard: (
    <>
      <path d="M7 4h10v5a5 5 0 0 1-10 0V4Z" />
      <path d="M7 6H4v1a3 3 0 0 0 3 3M17 6h3v1a3 3 0 0 1-3 3" />
      <path d="M10 20h4M12 14v6" />
    </>
  ),
  achievements: (
    <>
      <circle cx="12" cy="9" r="5" />
      <path d="M8.5 13.5 7 21l5-2.5L17 21l-1.5-7.5" />
    </>
  ),
  challenges: (
    <>
      <circle cx="12" cy="12" r="8" />
      <circle cx="12" cy="12" r="3.5" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.6v2.2M12 19.2v2.2M21.4 12h-2.2M4.8 12H2.6M18.6 5.4l-1.6 1.6M7 17l-1.6 1.6M18.6 18.6 17 17M7 7 5.4 5.4" />
    </>
  ),
  performance: (
    <>
      <path d='M3 17l5.5-5.5 3.5 3.5L21 6' />
      <path d='M15 6h6v6' />
    </>
  ),
  todo: (
    <>
      <rect x='3' y='4' width='7' height='7' rx='1' />
      <path d='M4.6 7.4 6 8.8 8.6 5.6' />
      <path d='M13 6h8M13 12h8M13 18h8' />
      <rect x='3' y='14' width='7' height='7' rx='1' />
    </>
  ),
  flame: <path d="M12 3c.7 2.6 2.4 3.6 3.4 5.2A6 6 0 1 1 6 12c0-2.4 1.6-3.6 2.4-5.2.6 1 1.2 1.5 2 1.8C10.2 6.4 10.8 4.6 12 3Z" />,
  play: <path d="M8 5.5v13l11-6.5Z" />,
  stop: <rect x="7" y="7" width="10" height="10" />,
  check: <path d="M4 12.5 9.5 18 20 6.5" />,
  chevronRight: <path d="M9 5l7 7-7 7" />,
  chevronLeft: <path d="M15 5l-7 7 7 7" />,
  close: <path d="M6 6l12 12M18 6 6 18" />,
  warning: (
    <>
      <path d="M12 3.5 22 20H2Z" />
      <path d="M12 10v4.5M12 17.2v.1" />
    </>
  ),
  lock: (
    <>
      <rect x="4" y="10" width="16" height="11" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </>
  ),
  bell: (
    <>
      <path d="M18 8a6 6 0 1 0-12 0c0 7-3 8-3 8h18s-3-1-3-8Z" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
    </>
  ),
  users: (
    <>
      <circle cx="9" cy="8" r="3.4" />
      <path d="M2.6 20a6.4 6.4 0 0 1 12.8 0" />
      <path d="M16 5.2a3.4 3.4 0 0 1 0 6.6M17.5 20a6.4 6.4 0 0 0-2.2-4.85" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11a8 8 0 1 0-.6 4" />
      <path d="M20 4v7h-7" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  skip: (
    <>
      <path d="M5 12h14" />
      <path d="M14 7l5 5-5 5" />
    </>
  )
} as const

export default function Icon({ name, size = 16, color = 'currentColor', strokeWidth = 1.7 }: Props) {
  const filled = name === 'play' || name === 'stop'
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={filled ? color : 'none'}
      stroke={filled ? 'none' : color}
      strokeWidth={strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      {PATHS[name]}
    </svg>
  )
}
