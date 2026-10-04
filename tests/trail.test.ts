import { describe, expect, it } from 'vitest'
import { moveMilestone } from '../src/renderer/lib/khatwa'

const camps = [
  { title: 'Base camp', dueDate: '2026-10-01', description: null },
  { title: 'Camp II', dueDate: '2026-11-01', description: null },
  { title: 'Camp III', dueDate: '2026-12-01', description: null }
]

describe('reordering camps on the review screen', () => {
  it('moves a camp and lets it take the date of the place it lands', () => {
    const next = moveMilestone(camps, 2, 0)
    expect(next.map((c) => c.title)).toEqual(['Camp III', 'Base camp', 'Camp II'])
    expect(next.map((c) => c.dueDate)).toEqual(['2026-10-01', '2026-11-01', '2026-12-01'])
  })

  it('keeps dates climbing even when they arrived out of order', () => {
    const shuffled = [camps[1]!, camps[0]!, camps[2]!]
    expect(moveMilestone(shuffled, 0, 1).map((c) => c.dueDate)).toEqual(['2026-10-01', '2026-11-01', '2026-12-01'])
  })

  it('ignores a move off either end', () => {
    expect(moveMilestone(camps, 0, -1)).toBe(camps)
    expect(moveMilestone(camps, 2, 3)).toBe(camps)
  })
})
