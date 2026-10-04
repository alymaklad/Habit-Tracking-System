import { createContext, useContext } from 'react'
import type { AppSettings, LevelInfo } from '@shared/types'

export type Route =
  | { name: 'today' }
  | { name: 'journey' }
  | { name: 'mountains' }
  | { name: 'mountain'; id: number }
  | { name: 'expedition'; resume?: boolean }
  | { name: 'me' }
  | { name: 'habits'; edit?: number | 'new' }
  | { name: 'habit'; id: number }
  | { name: 'todo' }
  | { name: 'calendar' }
  | { name: 'progress' }
  | { name: 'review' }
  | { name: 'achievements' }
  | { name: 'letgo'; id?: number; create?: boolean }
  | { name: 'ceremony'; id: number }
  | { name: 'journal'; prompt?: string; goalId?: number | null; letGoId?: number | null; kind?: 'free' | 'daily' | 'deep' }
  | { name: 'settings' }

export type RouteName = Route['name']

/** Which rail entry lights up for a route — detail pages belong to their parent. */
export function railKey(route: Route): RouteName {
  if (route.name === 'mountain' || route.name === 'expedition') return 'mountains'
  if (route.name === 'habit') return 'habits'
  if (route.name === 'ceremony') return 'letgo'
  return route.name
}

export const CRUMBS: Record<RouteName, [string, string]> = {
  today: ['Field folio & records', 'Today'],
  journey: ['Field folio & records', 'Journey'],
  mountains: ['Field folio & records', 'The Mountains'],
  mountain: ['The Mountains', 'Trail detail'],
  expedition: ['Field folio & records', 'New expedition'],
  me: ['Desk / current folio', 'Me'],
  habits: ['Desk / current folio', 'Habits'],
  habit: ['Habits', 'Rhythm detail'],
  todo: ['Desk / current folio', 'To-do'],
  calendar: ['Desk / current folio', 'Calendar'],
  progress: ['Desk / current folio', 'Progress'],
  review: ['Desk / current folio', 'Weekly review'],
  achievements: ['Desk / current folio', 'Achievements'],
  letgo: ['Inner work', 'Let go · the backpack'],
  ceremony: ['Let go', 'Leave-behind ceremony'],
  journal: ['Inner work', 'Journal · the inner compass'],
  settings: ['Desk / current folio', 'Settings']
}

export interface Shell {
  navigate: (route: Route) => void
  settings: AppSettings | null
  level: LevelInfo | null
  toast: (kind: 'info' | 'success' | 'warn' | 'error', title: string, body?: string) => void
  /** Opens the distraction-free session view for a running or about-to-run occurrence. */
  openSession: (occurrenceId: number) => void
}

export const ShellContext = createContext<Shell | null>(null)

export function useShell(): Shell {
  const shell = useContext(ShellContext)
  if (!shell) throw new Error('useShell outside the app shell')
  return shell
}
