import { createContext, useContext } from 'react'
import type { AppSettings, LevelInfo, AccountUser } from '@shared/types'

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
  | { name: 'letgoPlan' }
  | { name: 'journal'; prompt?: string; goalId?: number | null; letGoId?: number | null; kind?: 'free' | 'daily' | 'deep' }
  | { name: 'settings' }

export type RouteName = Route['name']

/** Which rail entry lights up for a route — detail pages belong to their parent. */
export function railKey(route: Route): RouteName {
  if (route.name === 'mountain' || route.name === 'expedition') return 'mountains'
  if (route.name === 'habit') return 'habits'
  if (route.name === 'ceremony' || route.name === 'letgoPlan') return 'letgo'
  return route.name
}

export const CRUMBS: Record<RouteName, [string, string]> = {
  today: ['Main', 'Today'],
  journey: ['Main', 'Journey'],
  mountains: ['Main', 'Mountains'],
  mountain: ['The Mountains', 'Trail detail'],
  expedition: ['Mountains', 'New mountain'],
  me: ['Main', 'Me'],
  habits: ['Habits & progress', 'Habits'],
  habit: ['Habits', 'Habit details'],
  todo: ['Habits & progress', 'To-do'],
  calendar: ['Habits & progress', 'Calendar'],
  progress: ['Habits & progress', 'Progress'],
  review: ['Habits & progress', 'Weekly review'],
  achievements: ['Habits & progress', 'Achievements'],
  letgo: ['Reflection', 'Let Go'],
  letgoPlan: ['Let Go', 'Plan to let go'],
  ceremony: ['Let Go', 'Leaving it behind'],
  journal: ['Reflection', 'Journal'],
  settings: ['Settings', 'Settings']
}

export interface Shell {
  navigate: (route: Route) => void
  settings: AppSettings | null
  level: LevelInfo | null
  toast: (kind: 'info' | 'success' | 'warn' | 'error', title: string, body?: string) => void
  /** Opens the distraction-free session view for a running or about-to-run occurrence. */
  openSession: (occurrenceId: number) => void
  /** Who is signed in; null for a guest, or in a build without accounts. */
  account: AccountUser | null
  /** False in a build with no account service. */
  accountsEnabled: boolean
  /**
   * Resolves true once someone is signed in — asking a guest to sign in or create an
   * account first — and false if they back out. Always true in a build without accounts.
   */
  requireAccount: (reason: string, detail?: string, startWith?: 'sign-in' | 'sign-up') => Promise<boolean>
  signOut: () => Promise<void>
  /** Shows the first-time tour again. */
  startTour: () => void
}

export const ShellContext = createContext<Shell | null>(null)

export function useShell(): Shell {
  const shell = useContext(ShellContext)
  if (!shell) throw new Error('useShell outside the app shell')
  return shell
}
