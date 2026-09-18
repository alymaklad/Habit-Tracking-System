// Contract shared by the main process, the preload bridge and the renderer.
// Nothing here may import from either side — it is types and constants only.

/** Calendar date in the user's timezone, `YYYY-MM-DD`. Never an instant. */
export type LocalDate = string
/** Clock time in the user's timezone, `HH:MM`. */
export type LocalTime = string
/** RFC 3339 / ISO 8601 instant in UTC. */
export type Iso = string

// ---------------------------------------------------------------- habits

export type Recurrence =
  /** `days` are ISO weekday numbers, Monday = 1 … Sunday = 7. */
  | { kind: 'weekly'; days: number[] }
  /** Every `n` days counting from `anchor`. */
  | { kind: 'everyN'; n: number; anchor: LocalDate }

export interface Habit {
  id: number
  name: string
  description: string | null
  notes: string | null
  recurrence: Recurrence
  scheduledTime: LocalTime
  targetMinutes: number
  baselineMinutes: number
  difficultyLevel: number
  /** Minutes before `scheduledTime` to notify. `null` inherits the global default. */
  reminderLeadMinutes: number | null
  colorKey: string
  googleTasklistId: string | null
  active: boolean
  /** The goal whose plan created this habit, if any. */
  goalId: number | null
  createdAt: Iso
}

export type HabitDraft = Omit<Habit, 'id' | 'createdAt'>

// ------------------------------------------------------------ occurrences

export type OccurrenceStatus =
  | 'pending'
  | 'partial'
  | 'complete'
  | 'missed'
  /** Deliberately skipped; suppresses the unjustified-skip penalty. */
  | 'skipped'

export type ProvisionState = 'none' | 'creating' | 'created' | 'failed'

export interface Occurrence {
  id: number
  habitId: number
  date: LocalDate
  scheduledTime: LocalTime
  targetMinutes: number
  status: OccurrenceStatus
  completedAt: Iso | null
  justifiedSkip: boolean
  skipReason: string | null
  googleTaskId: string | null
  /** Mirrored calendar event that carries the mobile reminder, if enabled. */
  googleEventId: string | null
  provisionState: ProvisionState
  createdByApp: boolean
  deletedAt: Iso | null
  reminderSentAt: Iso | null
}

/** How the logged minutes for an occurrence were obtained. */
export type TimeLogOrigin =
  /** Measured by the in-app timer. */
  | 'timer'
  /** Typed in by the user after the fact. */
  | 'manual'
  /** Ticked in Google with no timer run — credited at target and badged. */
  | 'assumed'

export interface TimeLog {
  id: number
  habitId: number
  occurrenceId: number | null
  startedAt: Iso
  endedAt: Iso | null
  minutes: number
  origin: TimeLogOrigin
}

// ------------------------------------------------------------- scoring

export interface ScoringConfig {
  fullCompletion: number
  partialCompletion: number
  skipped: number
  unjustifiedSkip: number
  beatWeeklyTarget: number
  worstDayCompletion: number
  sevenDayConsistency: number
  /** Fraction of target that counts as partial rather than not-started, 0–1. */
  partialThreshold: number
}

export const DEFAULT_SCORING: ScoringConfig = {
  fullCompletion: 2,
  partialCompletion: 1,
  skipped: 0,
  unjustifiedSkip: -1,
  beatWeeklyTarget: 5,
  worstDayCompletion: 3,
  sevenDayConsistency: 10,
  partialThreshold: 0.25
}

export interface DailyRecord {
  habitId: number
  date: LocalDate
  status: OccurrenceStatus
  points: number
  xp: number
  durationMinutes: number
  targetMinutes: number
  origin: TimeLogOrigin | null
}

export interface WeeklyRecord {
  weekStart: LocalDate
  totalPoints: number
  completionRate: number
  totalMinutes: number
  improvementPercentage: number | null
  xp: number
}

// -------------------------------------------------------- gamification

export interface LevelInfo {
  level: number
  title: string
  currentXp: number
  levelFloor: number
  levelCeiling: number
  xpToNext: number
  progress: number
}

export interface AchievementView {
  key: string
  name: string
  description: string
  unlockedAt: Iso | null
  /** 0–1 toward unlocking; 1 once unlocked. */
  progress: number
  progressLabel: string
}

export interface PersonalRecordView {
  kind: string
  label: string
  value: string
  achievedOn: LocalDate | null
}

export interface StreakInfo {
  current: number
  longest: number
}

// ------------------------------------------------------------ dashboard

export interface DashboardCard {
  habitId: number
  occurrenceId: number
  name: string
  difficultyLevel: number
  scheduledTime: LocalTime
  targetMinutes: number
  loggedMinutes: number
  /** Minutes from FINISHED logs only, excluding any timer still running. */
  closedMinutes: number
  percent: number
  status: OccurrenceStatus
  origin: TimeLogOrigin | null
  xpReward: number
  streak: number
  timerRunning: boolean
  timerStartedAt: Iso | null
  googleTaskId: string | null
}

export interface DashboardView {
  date: LocalDate
  cards: DashboardCard[]
  dayPoints: number
  dayPointsMax: number
  level: LevelInfo
  weekLabel: string
}

// ----------------------------------------------------------------- sync

export type SyncConnectionState =
  | 'disconnected'
  | 'connected'
  | 'syncing'
  | 'offline'
  | 'needs_reauth'

export interface SyncLogEntry {
  at: Iso
  level: 'info' | 'warn' | 'error'
  message: string
}

/** Everything the actionable sync-status control and its details panel render from. */
export interface SyncStatus {
  state: SyncConnectionState
  account: string | null
  tasklistName: string | null
  lastSyncAt: Iso | null
  nextSyncAt: Iso | null
  intervalMinutes: number
  horizonDays: number
  provisionedCount: number
  pulledCount: number
  pushedCount: number
  queuedCount: number
  consecutiveFailures: number
  lastError: string | null
  recent: SyncLogEntry[]
}

// ------------------------------------------------------------- settings

export type ThemeMode = 'dark' | 'light' | 'system'

/**
 * How a notification reaches the user.
 *
 * `toast` is a native Windows notification — desktop only, it cannot reach a phone.
 * `calendar` mirrors the occurrence into the app's own Google calendar with a popup
 * reminder, which the Google Calendar mobile app delivers as a real timed push. This
 * exists because a Google Task carries no time, and a date-only task fires no timed
 * notification on mobile.
 * `push` posts to an ntfy-style relay topic, for nudges that have no calendar
 * equivalent — streak alive, weekly review ready, challenge alerts.
 */
export type NotificationChannel = 'toast' | 'calendar' | 'push'

export interface PushRelayConfig {
  enabled: boolean
  /** Base URL of the relay, e.g. https://ntfy.sh or a self-hosted instance. */
  server: string
  /** Topic name. Treat it as a secret: anyone who knows it can post to it. */
  topic: string
}

export interface AppSettings {
  timezone: string
  theme: ThemeMode
  syncIntervalMinutes: number
  provisionHorizonDays: number
  startWithWindows: boolean
  minimiseToTray: boolean
  reduceMotion: boolean
  notificationsEnabled: boolean
  notifyUpcoming: boolean
  notifyCompletion: boolean
  notifyStreak: boolean
  notifyWeeklyReview: boolean
  defaultReminderLeadMinutes: number
  /** Points to aim for each week. 0 means no target has been set yet. */
  weeklyPointsTarget: number
  /** Which channels each notification kind may use. */
  channels: NotificationChannel[]
  /** Mirror occurrences into the app's own Google calendar for mobile reminders. */
  calendarMirrorEnabled: boolean
  push: PushRelayConfig
  scoring: ScoringConfig
}

// -------------------------------------------------------- weekly review

export interface WeeklyReview {
  weekStart: LocalDate
  weekLabel: string
  totalMinutes: number
  previousMinutes: number
  improvementPercentage: number | null
  tasksCompleted: number
  tasksScheduled: number
  consistency: number
  xp: number
  points: number
  bestHabit: { name: string; completionRate: number } | null
  weakestHabit: { name: string; completionRate: number } | null
  streak: number
  analysis: string[]
  recommendations: string[]
}

export interface DifficultyProposal {
  id: number
  habitId: number
  habitName: string
  weekStart: LocalDate
  currentTarget: number
  proposedTarget: number
  completionRate: number
  rationale: string
  state: 'pending' | 'accepted' | 'rejected'
}

// ------------------------------------------------------------ progress

export interface SeriesPoint {
  label: string
  value: number
}

export interface ProgressView {
  hoursPerWeek: SeriesPoint[]
  completionPerWeek: SeriesPoint[]
  pointsPerWeek: SeriesPoint[]
  streakSeries: SeriesPoint[]
  difficultySeries: SeriesPoint[]
  totalHours: number
  improvementPercentage: number | null
}

// ---------------------------------------------------------------- to-do

export type TodoKind = 'manual' | 'subtask'

export interface TodoItem {
  id: number
  kind: TodoKind
  title: string
  notes: string | null
  done: boolean
  dropped: boolean
  /** Manual items: the day it sits on. */
  date: LocalDate | null
  /** Days it has been pushed forward without being finished. */
  carried: number
  overdue: boolean
  /** Subtasks: the habit and occurrence they belong to. */
  habitId: number | null
  habitName: string | null
  occurrenceId: number | null
  scheduledTime: LocalTime | null
}

export interface TodoGroup {
  /** null for the standalone manual group. */
  habitId: number | null
  habitName: string | null
  occurrenceId: number | null
  scheduledTime: LocalTime | null
  /** Whether the habit itself is already complete. */
  habitComplete: boolean
  items: TodoItem[]
  done: number
  total: number
}

export interface TodoSuggestion {
  title: string
  reason: string
}

export interface TodoAvoidance {
  todoId: number
  title: string
  carried: number
  message: string
}

export interface TodoView {
  date: LocalDate
  /** Everything for the day, already ordered by urgency. */
  items: TodoItem[]
  /** The same items grouped: one group per habit with steps, plus manual items. */
  groups: TodoGroup[]
  manualDone: number
  manualTotal: number
  subtaskDone: number
  subtaskTotal: number
  carriedCount: number
  suggestions: TodoSuggestion[]
  avoidance: TodoAvoidance[]
}

// ------------------------------------------------------------ performance

export interface PerformanceDay {
  date: LocalDate
  /** ISO weekday, Monday = 1 … Sunday = 7. */
  weekday: number
  inPeriod: boolean
  points: number
  xp: number
  minutes: number
  completed: number
  scheduled: number
  /** Change in points against the previous day that had anything scheduled. */
  delta: number | null
}

export interface PerformanceHabit {
  habitId: number
  name: string
  difficultyLevel: number
  points: number
  xp: number
  minutes: number
  completed: number
  partial: number
  missed: number
  scheduled: number
  completionRate: number
  /** Change in completion rate against the previous week, in percentage points. */
  trend: number | null
}

export interface WeekVerdict {
  weekStart: LocalDate
  weekLabel: string
  points: number
  target: number
  met: boolean
  /** The week still in progress cannot have failed yet. */
  inProgress: boolean
}

export interface PerformanceView {
  weekStart: LocalDate
  weekLabel: string

  /** Daily points plus weekly bonuses — the figure the league actually scores. */
  totalPoints: number
  /** Sum of the day scores alone, before bonuses. */
  basePoints: number
  bonusPoints: number
  previousWeekPoints: number
  /** Percentage change against the previous week, or null with nothing to compare. */
  pointsDelta: number | null

  /** Monday to Sunday of the selected week. */
  days: PerformanceDay[]
  bestDay: PerformanceDay | null
  worstDay: PerformanceDay | null

  /** Every active habit that had something scheduled, best first. */
  habits: PerformanceHabit[]
  best: PerformanceHabit | null
  weakest: PerformanceHabit | null

  /** Points aimed for this week. 0 when no target is set. */
  weeklyTarget: number
  /** What the target would be if every scheduled occurrence were completed. */
  suggestedTarget: number
  targetMet: boolean
  /** Points still needed; 0 once the target is met. */
  pointsToTarget: number
  /** 0–1 toward the target, capped at 1. */
  targetProgress: number
  /** Recent weeks judged against the target, oldest first. */
  recentWeeks: WeekVerdict[]
  /** Consecutive completed weeks that met the target, most recent backwards. */
  targetStreak: number

  /** Six-week grid covering the selected month, for the points heatmap. */
  monthAnchor: LocalDate
  monthGrid: PerformanceDay[]
  monthPoints: number
  /** Highest single-day points in the grid — used to scale the heatmap. */
  peakDayPoints: number
}

// ---------------------------------------------------------- calendar

export interface CalendarBlock {
  occurrenceId: number
  habitId: number
  name: string
  date: LocalDate
  scheduledTime: LocalTime
  targetMinutes: number
  status: OccurrenceStatus
  timerRunning: boolean
}

export interface CalendarMonthDay {
  date: LocalDate
  inMonth: boolean
  scheduled: number
  complete: number
  partial: number
  missed: number
}

// ------------------------------------------------------------------ goals

export type GoalStatus = 'active' | 'achieved' | 'abandoned'

/** What the user types into the wizard. */
export interface GoalDraftInput {
  title: string
  description: string | null
  targetDate: LocalDate | null
  /** How much time per week they are willing to give it. */
  weeklyMinutesBudget: number | null
}

/** A recurring practice session the plan proposes; becomes a Habit on commit. */
export interface GoalSession {
  name: string
  /** ISO weekday numbers, Monday = 1 … Sunday = 7. */
  days: number[]
  scheduledTime: LocalTime
  targetMinutes: number
  rationale: string | null
}

/** A one-off checkpoint; becomes a manual to-do on commit. */
export interface GoalMilestone {
  title: string
  dueDate: LocalDate
  description: string | null
}

export interface MindMapNode {
  id: string
  parentId: string | null
  title: string
}

export interface GoalResource {
  title: string
  /** e.g. "course", "book", "podcast", "practice site". */
  type: string
  note: string
  /** Present only when the planner found a real page and the Intervenor confirmed it resolves. */
  url: string | null
}

export interface GoalPlan {
  summary: string
  sessions: GoalSession[]
  milestones: GoalMilestone[]
  mindMap: MindMapNode[]
  resources: GoalResource[]
}

/** Which phase of the planning loop is running — shown in the wizard. */
export type GoalPlanPhase = 'researching' | 'drafting' | 'reviewing' | 'revising'

export interface GoalPlanProgress {
  phase: GoalPlanPhase
  iteration: number
  maxIterations: number
}

export interface GoalDraftResult {
  plan: GoalPlan
  /** How many drafting passes it took. */
  iterations: number
  /** Anything the Intervenor could not resolve within the cap — shown to the user. */
  warnings: string[]
}

export type AiProvider = 'anthropic' | 'groq'

export interface AiProviderStatus {
  id: AiProvider
  label: string
  hasKey: boolean
  model: string
  defaultModel: string
  keyPlaceholder: string
  note: string
}

export interface AiStatus {
  /** Which provider the planner will use. */
  provider: AiProvider
  /** Whether that provider has a key, i.e. whether drafting can run at all. */
  ready: boolean
  providers: AiProviderStatus[]
}

export interface Goal {
  id: number
  title: string
  description: string | null
  targetDate: LocalDate | null
  weeklyMinutesBudget: number | null
  status: GoalStatus
  mindMap: MindMapNode[]
  resources: GoalResource[]
  createdAt: Iso
  closedAt: Iso | null
}

/** A goal with the things it spawned, for the Goals screen. */
export interface GoalView extends Goal {
  habits: { id: number; name: string; active: boolean; streak: number }[]
  milestones: { id: number; title: string; date: LocalDate | null; done: boolean; dropped: boolean }[]
  milestonesDone: number
  milestonesTotal: number
  daysToTarget: number | null
}

// ---------------------------------------------------------------- IPC

/** Channels the main process pushes to the renderer. */
export const PUSH_CHANNELS = {
  syncStatus: 'push:sync-status',
  dashboard: 'push:dashboard',
  toast: 'push:toast',
  goalProgress: 'push:goal-progress'
} as const

export interface ToastMessage {
  kind: 'info' | 'success' | 'warn' | 'error'
  title: string
  body?: string
}
