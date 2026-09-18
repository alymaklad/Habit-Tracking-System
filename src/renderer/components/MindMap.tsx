import { useMemo } from 'react'
import type { MindMapNode } from '@shared/types'

interface Placed {
  node: MindMapNode
  x: number
  y: number
  depth: number
  width: number
}

const NODE_H = 26
const LEVEL_GAP = 150
const ROW_GAP = 10
const PAD = 14
const CHAR_W = 6.4

function textWidth(s: string): number {
  return Math.min(180, Math.max(48, s.length * CHAR_W + 18))
}

/**
 * Left-to-right tree: the root at the left edge, children fanning out by depth, each
 * subtree given the vertical room its leaves need. No library — the app draws its own
 * charts, and a goal's mind map is rarely more than a few dozen nodes.
 */
function layout(nodes: MindMapNode[]): { placed: Placed[]; edges: [Placed, Placed][]; w: number; h: number } {
  const byParent = new Map<string | null, MindMapNode[]>()
  for (const n of nodes) {
    const list = byParent.get(n.parentId) ?? []
    list.push(n)
    byParent.set(n.parentId, list)
  }
  const roots = byParent.get(null) ?? []
  const placed: Placed[] = []
  const edges: [Placed, Placed][] = []
  let cursor = PAD

  const seen = new Set<string>()
  function place(node: MindMapNode, depth: number, parent: Placed | null): Placed {
    if (seen.has(node.id)) {
      const p: Placed = { node, x: PAD + depth * LEVEL_GAP, y: cursor, depth, width: textWidth(node.title) }
      cursor += NODE_H + ROW_GAP
      return p
    }
    seen.add(node.id)
    const children = byParent.get(node.id) ?? []
    const self: Placed = { node, x: PAD + depth * LEVEL_GAP, y: 0, depth, width: textWidth(node.title) }
    if (children.length === 0) {
      self.y = cursor
      cursor += NODE_H + ROW_GAP
    } else {
      const kids = children.map((c) => place(c, depth + 1, self))
      self.y = (kids[0]!.y + kids[kids.length - 1]!.y) / 2
    }
    placed.push(self)
    if (parent) edges.push([parent, self])
    return self
  }

  for (const r of roots) place(r, 0, null)

  const maxDepth = placed.reduce((m, p) => Math.max(m, p.depth), 0)
  const w = PAD * 2 + maxDepth * LEVEL_GAP + 180
  const h = Math.max(cursor, NODE_H + PAD * 2)
  return { placed, edges, w, h }
}

export default function MindMap({ nodes, height = 260 }: { nodes: MindMapNode[]; height?: number }) {
  const { placed, edges, w, h } = useMemo(() => layout(nodes), [nodes])

  if (nodes.length === 0) {
    return (
      <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>No mind map for this goal.</span>
    )
  }

  return (
    <div style={{ overflow: 'auto', maxHeight: height, border: '1px solid var(--line)', background: 'var(--bg)' }}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} style={{ display: 'block' }}>
        {edges.map(([a, b]) => {
          const x1 = a.x + a.width
          const y1 = a.y + NODE_H / 2
          const x2 = b.x
          const y2 = b.y + NODE_H / 2
          const mx = (x1 + x2) / 2
          return (
            <path
              key={`${a.node.id}->${b.node.id}`}
              d={`M${x1} ${y1} C${mx} ${y1}, ${mx} ${y2}, ${x2} ${y2}`}
              fill="none"
              stroke="var(--line)"
              strokeWidth={1.2}
            />
          )
        })}
        {placed.map((p) => {
          const root = p.depth === 0
          return (
            <g key={p.node.id} transform={`translate(${p.x}, ${p.y})`}>
              <rect
                width={p.width}
                height={NODE_H}
                fill={root ? 'var(--accent)' : 'var(--panel)'}
                stroke={root ? 'var(--accent)' : 'var(--line)'}
              />
              <text
                x={9}
                y={NODE_H / 2 + 4}
                fontSize={11}
                fill={root ? 'var(--accent-ink)' : 'var(--fg)'}
                fontFamily="inherit"
              >
                {p.node.title.length > 26 ? `${p.node.title.slice(0, 25)}…` : p.node.title}
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
