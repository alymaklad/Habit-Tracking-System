import { useEffect, useMemo, useRef, useState } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Award,
  Backpack,
  BookOpen,
  ChartSpline,
  ListChecks,
  NotebookPen,
  CalendarDays,
  CircleCheckBig,
  Compass,
  Mountain,
  Plus,
  Search,
  SlidersHorizontal,
  Sun,
  UserRound
} from 'lucide-react'
import type { GoalView, Habit } from '@shared/types'
import { describeRecurrence } from '../lib/format'
import { time12 } from '../lib/khatwa'
import type { Route } from './nav'

type Entry = { id: string; label: string; hint: string; icon: LucideIcon; route: Route; kind: string }

const PAGES: Entry[] = [
  { id: 'p-today', label: 'Today', hint: 'What am I doing now?', icon: Sun, route: { name: 'today' }, kind: 'Page' },
  { id: 'p-journey', label: 'Journey', hint: 'Where have I been?', icon: Compass, route: { name: 'journey' }, kind: 'Page' },
  { id: 'p-mountains', label: 'Mountains', hint: 'Where am I going?', icon: Mountain, route: { name: 'mountains' }, kind: 'Page' },
  { id: 'p-me', label: 'Me', hint: 'Who am I becoming?', icon: UserRound, route: { name: 'me' }, kind: 'Page' },
  { id: 'p-habits', label: 'Habits', hint: 'Your habits', icon: CircleCheckBig, route: { name: 'habits' }, kind: 'Page' },
  { id: 'p-calendar', label: 'Calendar', hint: 'The week and the month', icon: CalendarDays, route: { name: 'calendar' }, kind: 'Page' },
  { id: 'p-todo', label: 'To-do', hint: 'Manual items and habit steps', icon: ListChecks, route: { name: 'todo' }, kind: 'Page' },
  { id: 'p-progress', label: 'Progress', hint: 'Charts and weekly points', icon: ChartSpline, route: { name: 'progress' }, kind: 'Page' },
  { id: 'p-letgo', label: 'Let Go', hint: 'What am I carrying?', icon: Backpack, route: { name: 'letgo' }, kind: 'Page' },
  { id: 'p-journal', label: 'Journal', hint: 'What am I learning?', icon: NotebookPen, route: { name: 'journal' }, kind: 'Page' },
  { id: 'p-review', label: 'Weekly Review', hint: 'Look back on your week', icon: BookOpen, route: { name: 'review' }, kind: 'Page' },
  { id: 'p-ach', label: 'Achievements', hint: 'Achievements and records', icon: Award, route: { name: 'achievements' }, kind: 'Page' },
  { id: 'p-settings', label: 'Settings', hint: 'Google, AI planner, scoring', icon: SlidersHorizontal, route: { name: 'settings' }, kind: 'Page' },
  { id: 'a-habit', label: 'Add a habit', hint: 'Create a new habit', icon: Plus, route: { name: 'habits', edit: 'new' }, kind: 'Action' },
  { id: 'a-letgo', label: 'Add something to let go', hint: 'Put it in the backpack', icon: Plus, route: { name: 'letgo', create: true }, kind: 'Action' },
  { id: 'a-reflect', label: 'Write a reflection', hint: 'Open the journal', icon: Plus, route: { name: 'journal', kind: 'free' }, kind: 'Action' },
  { id: 'a-daily', label: 'Daily check-in', hint: 'How am I feeling today?', icon: Plus, route: { name: 'journal', kind: 'daily' }, kind: 'Action' },
  { id: 'a-mountain', label: 'Choose a new mountain', hint: 'Plan a goal with the AI cartographer', icon: Plus, route: { name: 'expedition' }, kind: 'Action' }
]

export default function Palette({ onClose, onGo }: { onClose: () => void; onGo: (route: Route) => void }) {
  const [query, setQuery] = useState('')
  const [cursor, setCursor] = useState(0)
  const [habits, setHabits] = useState<Habit[]>([])
  const [goals, setGoals] = useState<GoalView[]>([])
  const input = useRef<HTMLInputElement>(null)

  useEffect(() => {
    input.current?.focus()
    void window.api.habits.list().then(setHabits).catch(() => undefined)
    void window.api.goals.list().then(setGoals).catch(() => undefined)
  }, [])

  const entries = useMemo(() => {
    const all: Entry[] = [
      ...PAGES,
      ...goals.map<Entry>((g) => ({
        id: `g-${g.id}`,
        label: g.title,
        hint: g.status === 'active' ? 'Active mountain' : g.status === 'achieved' ? 'Summit reached' : 'Set aside',
        icon: Mountain,
        route: { name: 'mountain', id: g.id },
        kind: 'Mountain'
      })),
      ...habits.map<Entry>((h) => ({
        id: `h-${h.id}`,
        label: h.name,
        hint: `${describeRecurrence(h.recurrence)} · ${time12(h.scheduledTime)}${h.active ? '' : ' · paused'}`,
        icon: CircleCheckBig,
        route: { name: 'habit', id: h.id },
        kind: 'Habit'
      }))
    ]
    const q = query.trim().toLowerCase()
    if (!q) return all.slice(0, 11)
    return all.filter((e) => `${e.label} ${e.hint} ${e.kind}`.toLowerCase().includes(q)).slice(0, 14)
  }, [query, habits, goals])

  useEffect(() => setCursor(0), [query])

  const go = (entry: Entry | undefined): void => {
    if (!entry) return
    onGo(entry.route)
    onClose()
  }

  return (
    <div className="kh-overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="kh-palette kh-rise" role="dialog" aria-modal="true" aria-label="Search">
        <div className="relative">
          <Search size={17} className="absolute left-[18px] top-1/2 -translate-y-1/2 text-ink-4" />
          <input
            ref={input}
            value={query}
            placeholder="Search habits, mountains and pages…"
            className="!pl-12"
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose()
              else if (e.key === 'ArrowDown') {
                e.preventDefault()
                setCursor((c) => Math.min(entries.length - 1, c + 1))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setCursor((c) => Math.max(0, c - 1))
              } else if (e.key === 'Enter') go(entries[cursor])
            }}
          />
        </div>
        <div className="max-h-[420px] overflow-y-auto py-2">
          {entries.length === 0 ? (
            <div className="px-5 py-6 t-italic">Nothing matches “{query}”.</div>
          ) : (
            entries.map((e, i) => {
              const Icon = e.icon
              return (
                <button key={e.id} className={`kh-palette-item ${i === cursor ? 'is-on' : ''}`} onMouseEnter={() => setCursor(i)} onClick={() => go(e)}>
                  <Icon size={16} className="text-ink-3 shrink-0" />
                  <span className="flex flex-col min-w-0 flex-1">
                    <span className="text-[14px] truncate">{e.label}</span>
                    <span className="t-caption truncate">{e.hint}</span>
                  </span>
                  <span className="kh-stamp !text-[10px]">{e.kind}</span>
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
