import type { ReactNode } from 'react'
import { Flag, Tent } from 'lucide-react'
import { roman } from '../lib/khatwa'

type Pt = { x: number; y: number }

/** The Bézier control points of stretch i (pts[i] → pts[i + 1]) of a Catmull-Rom spline. */
function controls(pts: Pt[], i: number): [Pt, Pt] {
  const p0 = pts[i - 1] ?? pts[i]!
  const p1 = pts[i]!
  const p2 = pts[i + 1]!
  const p3 = pts[i + 2] ?? p2
  return [
    { x: p1.x + (p2.x - p0.x) / 6, y: p1.y + (p2.y - p0.y) / 6 },
    { x: p2.x - (p3.x - p1.x) / 6, y: p2.y - (p3.y - p1.y) / 6 }
  ]
}

/** The point a fraction t along stretch i of the drawn curve, and the direction of travel there. */
export function pointOnTrail(pts: Pt[], i: number, t: number): { at: Pt; angle: number } {
  const a = pts[i]!
  const b = pts[i + 1]!
  const [c1, c2] = controls(pts, i)
  const u = 1 - t
  const at = {
    x: u * u * u * a.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * b.x,
    y: u * u * u * a.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * b.y
  }
  const dx = 3 * u * u * (c1.x - a.x) + 6 * u * t * (c2.x - c1.x) + 3 * t * t * (b.x - c2.x)
  const dy = 3 * u * u * (c1.y - a.y) + 6 * u * t * (c2.y - c1.y) + 3 * t * t * (b.y - c2.y)
  return { at, angle: (Math.atan2(dy, dx) * 180) / Math.PI }
}

/** A Catmull-Rom spline through the points, as a cubic Bézier path; `stretches` draws only the first few. */
function smoothPath(pts: Pt[], stretches = pts.length - 1): string {
  if (pts.length === 0) return ''
  if (pts.length === 1) return `M${pts[0]!.x},${pts[0]!.y}`
  let d = `M${pts[0]!.x},${pts[0]!.y}`
  for (let i = 0; i < Math.min(stretches, pts.length - 1); i++) {
    const p2 = pts[i + 1]!
    const [c1, c2] = controls(pts, i)
    d += ` C${c1.x.toFixed(1)},${c1.y.toFixed(1)} ${c2.x.toFixed(1)},${c2.y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`
  }
  return d
}

/**
 * Something in the way, placed on a stretch of trail: segment k runs from base camp
 * (k = 0 starts at the foot) up to waypoint k; segment n is the final climb to the summit.
 */
export type TrailObstacle = {
  key: string
  title: string
  note?: string | null
  segment: number
  passed: boolean
}

export type Waypoint = {
  key: string | number
  title: string
  caption?: ReactNode
  state: 'done' | 'current' | 'upcoming'
}

const W = 1000
const H = 600

/**
 * The trail drawn up a mountain: base camp at the foot, the summit at the peak, one
 * waypoint per milestone in between. The walked part of the trail is inked solid; the
 * rest is still a pencilled dash.
 */
export function TrailMap({
  waypoints,
  summit,
  summitCaption,
  base = 'Base camp',
  height = 520,
  compact,
  obstacles = []
}: {
  obstacles?: TrailObstacle[]
  waypoints: Waypoint[]
  summit: string
  summitCaption?: ReactNode
  base?: string
  height?: number
  compact?: boolean
}) {
  const n = waypoints.length
  const foot: Pt = { x: 250, y: 548 }
  const peak: Pt = { x: 560, y: 70 }
  const pts: Pt[] = waypoints.map((_, i) => {
    const t = (i + 1) / (n + 1)
    const y = foot.y - t * (foot.y - peak.y)
    const side = i % 2 === 0 ? -1 : 1
    const spread = 230 * (1 - t * 0.7)
    return {
      x: peak.x + side * spread * 0.85 + (1 - t) * (foot.x - peak.x) * 0.35,
      y
    }
  })
  const trail = [foot, ...pts, peak]
  // trail[i + 1] is waypoint i. Ink runs from the foot to the current waypoint.
  const current = waypoints.findIndex((w) => w.state !== 'done')
  const walked = trail.slice(0, (current === -1 ? n : current) + 2 - (current === -1 ? 1 : 0))
  const obstacleSpots = obstacles
    .filter((o) => o.segment >= 0 && o.segment <= n)
    .map((o, _i, all) => {
      // Several obstacles on one stretch spread along it rather than stacking.
      const same = all.filter((x) => x.segment === o.segment)
      const t = (same.indexOf(o) + 1) / (same.length + 1)
      return { o, t, ...pointOnTrail(trail, o.segment, t) }
    })
    // Numbered in the order a climber meets them.
    .sort((p, q) => p.o.segment - q.o.segment || p.t - q.t)
    .map((spot, i) => ({ ...spot, mark: roman(i + 1).toLowerCase() }))
  const summitLeft = n > 0 && (n - 1) % 2 === 1
  const pct = (p: Pt): { left: string; top: string } => ({
    left: `${(p.x / W) * 100}%`,
    top: `${(p.y / H) * 100}%`
  })

  return (
    <div className="w-full">
      <div className="relative w-full kh-dotgrid rounded-[10px] overflow-hidden" style={{ height }}>
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="absolute inset-0 w-full h-full" aria-hidden="true">
          {[140, 230, 320, 410, 500].map((y, i) => (
            <path key={y} d={`M-20,${y} C200,${y - 30 + i * 6} 420,${y + 24} 620,${y - 10} S900,${y + 18} 1020,${y - 6}`} fill="none" stroke="var(--rule)" strokeDasharray="2 6" />
          ))}
          <path d={`M40,${H} L${peak.x - 250},230 L${peak.x - 150},330 L${peak.x},${peak.y - 10} L${peak.x + 330},${H} Z`} fill="var(--docket)" opacity="0.75" />
          <path d={`M${peak.x + 120},${H} L${peak.x + 290},300 L${W + 40},${H} Z`} fill="var(--docket)" opacity="0.5" />
          <path d={`M${peak.x - 60},${peak.y + 110} L${peak.x},${peak.y - 10} L${peak.x + 70},${peak.y + 120}`} fill="none" stroke="var(--rule)" strokeWidth="2" />
          <path d={smoothPath(trail)} fill="none" stroke="var(--ochre)" strokeWidth="3" strokeDasharray="7 8" strokeLinecap="round" />
          {walked.length > 1 ? <path d={smoothPath(trail, walked.length - 1)} fill="none" stroke="var(--laurel)" strokeWidth="3.5" strokeLinecap="round" /> : null}
          {/* Each obstacle is a barrier laid across the trail, capped at both ends like a
              gate; the numbered marker sits over its middle. */}
          {obstacleSpots.map(({ o, at, angle }) => (
            <g key={o.key} transform={`translate(${at.x} ${at.y}) rotate(${angle})`} style={{ opacity: o.passed ? 0.4 : 1, transition: 'opacity .6s ease' }}>
              <path d="M0,-36 V36 M-8,-36 H8 M-8,36 H8" fill="none" stroke="var(--sheet)" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
              <path d="M0,-36 V36 M-8,-36 H8 M-8,36 H8" fill="none" stroke="var(--slate)" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" strokeDasharray={o.passed ? '5 7' : undefined} />
            </g>
          ))}
        </svg>

        <div className="absolute -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-1" style={pct(peak)}>
          <span className="w-9 h-9 rounded-full grid place-items-center bg-[var(--laurel-deep)] text-[var(--on-solid)] ring-4 ring-[var(--laurel-wash)]">
            <Flag size={16} />
          </span>
        </div>
        <div
          className="absolute -translate-y-1/2 kh-card px-4 py-2.5 max-w-[34%] z-10"
          style={
            // Waypoint labels alternate sides; keep the summit clear of the last one.
            summitLeft
              ? {
                  right: `${100 - (peak.x / W) * 100 + 3.5}%`,
                  top: `${(peak.y / H) * 100}%`
                }
              : {
                  left: `${(peak.x / W) * 100 + 3.5}%`,
                  top: `${(peak.y / H) * 100}%`
                }
          }
        >
          <div className="t-stamp text-[var(--ochre-deep)] !text-[10.5px]">The summit</div>
          <div className="font-serif text-[17px] leading-6 [text-wrap:balance]">{summit}</div>
          {summitCaption ? <div className="t-caption mt-0.5">{summitCaption}</div> : null}
        </div>

        <div className="absolute -translate-x-1/2 -translate-y-1/2" style={pct(foot)}>
          <span className="w-7 h-7 rounded-full grid place-items-center bg-[var(--card)] border border-[var(--rule)] text-ink-3">
            <Tent size={13} />
          </span>
        </div>
        <div
          className="absolute t-stamp !text-[10.5px] text-ink-4"
          style={{
            left: `${(foot.x / W) * 100 + 2.6}%`,
            top: `${(foot.y / H) * 100 - 2}%`
          }}
        >
          {base}
        </div>

        {/* The map is too tight for full names; each mist carries a mark, named in the key below. */}
        {obstacleSpots.map(({ o, at, mark }) => (
          <span
            key={o.key}
            className={`kh-mist-mark absolute -translate-x-1/2 -translate-y-1/2 ${o.passed ? 'is-passed' : ''}`}
            style={{
              left: `${(at.x / W) * 100}%`,
              top: `${(at.y / H) * 100}%`
            }}
            title={o.note ? `${o.title} — ${o.note}` : o.title}
          >
            {mark}
          </span>
        ))}

        {waypoints.map((w, i) => {
          const p = pts[i]!
          const left = i % 2 === 0
          return (
            <div key={w.key}>
              <span
                className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ${
                  w.state === 'done'
                    ? 'w-4 h-4 bg-[var(--laurel)] ring-4 ring-[var(--canvas)]'
                    : w.state === 'current'
                      ? 'w-6 h-6 bg-[var(--ochre-tint)] ring-4 ring-[var(--ochre-wash)] grid place-items-center'
                      : 'w-4 h-4 bg-[var(--card)] border-2 border-[var(--laurel)]'
                }`}
                style={pct(p)}
              >
                {w.state === 'current' ? <span className="block w-2.5 h-2.5 rounded-full bg-[var(--ochre-deep)]" /> : null}
              </span>
              <div
                className={`absolute -translate-y-1/2 ${w.state === 'current' ? 'kh-card' : 'kh-sheet'} px-3.5 py-2 ${compact ? 'max-w-[30%]' : 'max-w-[34%]'}`}
                style={
                  left
                    ? {
                        right: `${100 - (p.x / W) * 100 + 2.4}%`,
                        top: `${(p.y / H) * 100}%`
                      }
                    : {
                        left: `${(p.x / W) * 100 + 2.4}%`,
                        top: `${(p.y / H) * 100}%`
                      }
                }
              >
                {w.state === 'current' ? <div className="t-stamp text-[var(--ochre-deep)] !text-[10px]">You are here</div> : null}
                <div className={`text-[13.5px] leading-[19px] ${w.state === 'done' ? 'text-ink-3' : 'text-ink'} ${compact ? 'truncate' : '[text-wrap:balance]'}`}>{w.title}</div>
                {w.caption && !compact ? <div className="t-caption">{w.caption}</div> : null}
              </div>
            </div>
          )
        })}
      </div>
      {obstacleSpots.length ? (
        <ul className="flex flex-wrap gap-x-5 gap-y-1.5 mt-3 px-1" aria-label="What stands in the way, in trail order">
          {obstacleSpots.map(({ o, mark }) => (
            <li key={o.key} className="flex items-baseline gap-1.5 min-w-0">
              <span className={`kh-mist-mark is-inline ${o.passed ? 'is-passed' : ''}`} aria-hidden="true">
                {mark}
              </span>
              <span className={`font-serif italic text-[14px] leading-5 ${o.passed ? 'text-ink-4 line-through decoration-[var(--rule)]' : 'text-[var(--slate)]'}`}>
                {o.title}
                {o.passed ? <span className="sr-only"> (passed)</span> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

/**
 * A single smooth ink line over a faint wash — the "evolutionary arc" and "ascent profile"
 * charts. Values are plotted as given; `mark` rings one point in ochre.
 */
export function InkLine({
  values,
  labels,
  height = 180,
  mark,
  format = (v) => String(v),
  axisLabels
}: {
  values: number[]
  labels?: string[]
  height?: number
  mark?: number
  format?: (v: number) => string
  axisLabels?: [string, string]
}) {
  const w = 1000
  const h = 300
  const padX = 30
  const padTop = 30
  const padBottom = 30
  if (values.length === 0) return null
  const max = Math.max(...values, 1)
  const min = Math.min(...values, 0)
  const x = (i: number): number => (values.length === 1 ? w / 2 : padX + (i * (w - padX * 2)) / (values.length - 1))
  const y = (v: number): number => padTop + (1 - (v - min) / (max - min || 1)) * (h - padTop - padBottom)
  const pts = values.map((v, i) => ({ x: x(i), y: y(v) }))
  const line = smoothPath(pts)
  const area = `${line} L${pts[pts.length - 1]!.x},${h - padBottom} L${pts[0]!.x},${h - padBottom} Z`
  const gid = `ink-${values.length}-${Math.round(max)}`
  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${w} ${h}`}
        preserveAspectRatio="none"
        className="w-full block"
        style={{ height }}
        role="img"
        aria-label={labels ? labels.map((l, i) => `${l}: ${format(values[i]!)}`).join(', ') : undefined}
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0%" stopColor="var(--laurel)" stopOpacity="0.18" />
            <stop offset="100%" stopColor="var(--laurel)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={padX} x2={w - padX} y1={padTop + f * (h - padTop - padBottom)} y2={padTop + f * (h - padTop - padBottom)} stroke="var(--rule)" strokeDasharray="2 6" />
        ))}
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke="var(--laurel-deep)" strokeWidth="3" vectorEffect="non-scaling-stroke" />
      </svg>
      <div className="relative" style={{ marginTop: -height }}>
        <div className="relative w-full" style={{ height }}>
          {pts.map((p, i) => (
            <span
              key={i}
              title={labels ? `${labels[i]}: ${format(values[i]!)}` : format(values[i]!)}
              className={`absolute -translate-x-1/2 -translate-y-1/2 rounded-full ${
                i === mark ? 'w-3.5 h-3.5 bg-[var(--ochre-deep)] ring-4 ring-[var(--ochre-wash)]' : 'w-2.5 h-2.5 bg-[var(--laurel-deep)] ring-2 ring-[var(--card)]'
              }`}
              style={{
                left: `${(p.x / w) * 100}%`,
                top: `${(p.y / h) * height}px`
              }}
            />
          ))}
        </div>
      </div>
      {axisLabels ? (
        <div className="flex justify-between mt-2 t-stamp !text-[10.5px] text-ink-4">
          <span>{axisLabels[0]}</span>
          <span>{axisLabels[1]}</span>
        </div>
      ) : null}
    </div>
  )
}

/** Past weeks as columns of ink dots — the "dot-matrix chronology". */
export function DotMatrix({ weeks }: { weeks: { label: string; value: number | null; current?: boolean }[] }) {
  return (
    <div className="grid gap-2" style={{ gridTemplateColumns: `repeat(${weeks.length}, minmax(0, 1fr))` }}>
      {weeks.map((w, i) => {
        const v = w.value ?? 0
        const dots = [v >= 0.34, v >= 0.67, v >= 0.95]
        return (
          <div
            key={i}
            className={`flex flex-col items-center gap-2.5 py-3 rounded-lg ${w.current ? 'bg-[var(--ochre-wash)] ring-1 ring-[var(--ochre-tint)]' : 'bg-[var(--sheet)]'}`}
          >
            <span className={`t-stamp !text-[10px] ${w.current ? 'text-[var(--ochre-deep)]' : 'text-ink-4'}`}>{w.current ? 'Current' : w.label}</span>
            {dots.map((on, j) => (
              <span
                key={j}
                className="w-3 h-3 rounded-full"
                style={{
                  background: on ? (w.current ? 'var(--ochre)' : 'var(--laurel-deep)') : w.value === null ? 'var(--rule-soft)' : 'var(--laurel-tint)'
                }}
              />
            ))}
            <span className="text-[12px] t-num text-ink-3">{w.value === null ? '—' : `${Math.round(v * 100)}%`}</span>
          </div>
        )
      })}
    </div>
  )
}
