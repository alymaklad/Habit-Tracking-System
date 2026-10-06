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
  /** What the app calls the user. Empty means no name is used. */
  displayName: string
  timezone: string
  theme: ThemeMode
  syncIntervalMinutes: number
  provisionHorizonDays: number
  reduceMotion: boolean
  notificationsEnabled: boolean
  notifyUpcoming: boolean
  notifyCompletion: boolean
  notifyStreak: boolean
  notifyWeeklyReview: boolean
  defaultReminderLeadMinutes: number
  /** Points to aim for each week. 0 means no target has been set yet. */
  weeklyPointsTarget: number
  /** The first-time tour has been finished or skipped. */
  tourDone: boolean
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

/** The goal wizard put aside mid-way, to be picked up again from the Mountains page. */
export interface SavedGoalDraft {
  title: string
  story: string
  targetDate: LocalDate | null
  weeklyMinutes: number
  anchors: string[]
  plan: GoalPlan | null
  warnings: string[]
  /** What the planner adjusted on its own; absent on drafts saved before it existed. */
  notes?: string[]
  iterations: number
  savedAt: Iso
}

/** Which phase of the planning loop is running — shown in the wizard. */
export type GoalPlanPhase = 'researching' | 'drafting' | 'reviewing' | 'revising'

export interface GoalPlanProgress {
  phase: GoalPlanPhase
  iteration: number
  maxIterations: number
  /** Set while the provider is rate-limiting: when the next try goes out (epoch ms). */
  waitingUntil?: number | null
}

/** What the user tells the planner about a habit they want to stop. */
export interface LetGoPlanInput {
  /** The habit, in their words: "Late-night scrolling". */
  title: string
  /** When it happens, what it gives them, why they want to stop. */
  description: string | null
  /** Time per week they can give the replacement habits. */
  weeklyMinutesBudget: number | null
}

/** Something that makes letting go easier: a change to their surroundings, or a plan for the urge. */
export interface LetGoSupport {
  title: string
  description: string | null
}

/** The planner's suggestion for letting a habit go. Saving it creates the Let Go item, the replacement habits and the supports. */
export interface LetGoPlan {
  summary: string
  triggerContexts: TriggerContext[]
  /** When and why it tends to happen, in plain words. */
  triggerNotes: string | null
  /** What to do instead when the urge comes. */
  replacement: string
  weight: LetGoWeight
  /** Replacement habits, scheduled like any other habit. */
  sessions: GoalSession[]
  supports: LetGoSupport[]
}

export interface LetGoDraftResult {
  plan: LetGoPlan
  iterations: number
  warnings: string[]
  notes: string[]
}

export interface GoalDraftResult {
  plan: GoalPlan
  /** How many drafting passes it took. */
  iterations: number
  /** What is still wrong and the user should check — worded for the user. */
  warnings: string[]
  /** What the planner already fixed on its own (shortened sessions, dropped links). */
  notes: string[]
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

/** The person signed in to their Khatwa account. */
export interface AccountUser {
  id: string
  email: string
  name: string | null
  image: string | null
}

export interface AccountStatus {
  /** False when this build has no account service set up (a development build). */
  configured: boolean
  user: AccountUser | null
  /** The service could not be reached; `user` is the last one known. */
  offline: boolean
}

export interface AiStatus {
  /** Which provider the planner will use. */
  provider: AiProvider
  /** Whether that provider has a key, i.e. whether drafting can run at all. */
  ready: boolean
  providers: AiProviderStatus[]
}

/**
 * Something standing in the way of a mountain — fear of starting, uncertainty about what
 * to learn. Drawn on the trail near the waypoint it guards; never an enemy, only terrain.
 */
export interface GoalObstacle {
  id: string
  title: string
  /** How the user means to pass it, if they know. */
  note: string | null
  /** The waypoint (milestone to-do id) it guards, sitting on the stretch just before it; null for the final climb to the summit. */
  nearMilestoneId: number | null
  passed: boolean
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
  obstacles: GoalObstacle[]
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

// ------------------------------------------------------------- habit detail

export interface HabitHistoryDay {
  date: LocalDate
  status: OccurrenceStatus
  minutes: number
  origin: TimeLogOrigin | null
  points: number
}

export interface HabitWeek {
  weekStart: LocalDate
  scheduled: number
  completed: number
  minutes: number
}

export interface HabitDetailView {
  habit: Habit
  streak: StreakInfo
  /** Most recent first, up to twelve weeks back. */
  history: HabitHistoryDay[]
  /** Oldest first, Saturday-to-Friday weeks. */
  weeks: HabitWeek[]
  totalMinutes: number
  totalCompleted: number
  /** Minutes credited without a timer or typed entry — shown separately so figures stay honest. */
  assumedMinutes: number
  proposal: DifficultyProposal | null
}

// ------------------------------------------------------------------ let go

/** Symbolic weight — never a fake number of kilograms. */
export type LetGoWeight = 'light' | 'medium' | 'heavy'
export type LetGoStatus = 'carrying' | 'left_behind'

export const TRIGGER_CONTEXTS = ['morning', 'work', 'evening', 'before_sleep', 'boredom', 'stress', 'other'] as const
export type TriggerContext = (typeof TRIGGER_CONTEXTS)[number]

export const LETGO_FEELINGS = ['stressed', 'bored', 'tired', 'lonely', 'overwhelmed', 'frustrated', 'other'] as const
export type LetGoFeeling = (typeof LETGO_FEELINGS)[number]

export interface LetGoDraft {
  title: string
  triggerContexts: TriggerContext[]
  triggerNotes: string | null
  /** What the user would like to do instead. */
  replacement: string | null
  goalId: number | null
  weight: LetGoWeight
  startedOn: LocalDate
}

export interface LetGoBehavior extends LetGoDraft {
  id: number
  status: LetGoStatus
  leftBehindAt: Iso | null
  /** The words the user wrote at the leave-behind ceremony, if any. */
  vow: string | null
  createdAt: Iso
}

export interface LetGoCheckinInput {
  /** true: left behind today. false: the behavior returned. */
  resisted: boolean
  feelings: LetGoFeeling[]
  trigger: string | null
  need: string | null
  alternative: string | null
  note: string | null
}

export interface LetGoCheckin extends LetGoCheckinInput {
  id: number
  letGoId: number
  date: LocalDate
  createdAt: Iso
}

export interface LetGoStats {
  /** Days since tracking started, today included. */
  daysCarried: number
  daysTracked: number
  daysFree: number
  /** daysFree / daysTracked, 0–1. A returned day lowers it; it never resets it. */
  freedomRate: number
  currentStreak: number
  bestStreak: number
}

export interface LetGoView extends LetGoBehavior {
  goalTitle: string | null
  stats: LetGoStats
  /** Every check-in, oldest first. */
  checkins: LetGoCheckin[]
  today: LetGoCheckin | null
  /** Feelings named on days it returned, most frequent first. */
  feelings: { feeling: LetGoFeeling; count: number; share: number }[]
  /** Alternatives logged on free days, most frequent first. */
  alternatives: { text: string; count: number }[]
  /** Enough tracked days at a steady freedom rate to offer the ceremony. */
  ceremonyReady: boolean
}

// ------------------------------------------------------------------ tools

export interface ToolDraft {
  title: string
  description: string | null
  goalId: number | null
  habitId: number | null
}

export interface Tool extends ToolDraft {
  id: number
  createdAt: Iso
}

// ---------------------------------------------------------------- journal

export type JournalKind = 'free' | 'daily' | 'deep' | 'monthly'
export const MOODS = ['good', 'okay', 'low', 'stressed', 'exhausted'] as const
export type Mood = (typeof MOODS)[number]
export type StepToward = 'yes' | 'little' | 'not_today'

/** A file the user added to a journal entry, copied into the app's own folder. */
export interface Attachment {
  id: number
  journalId: number | null
  originalName: string
  mime: string
  size: number
  caption: string | null
  isImage: boolean
  /** Served by the app's private protocol; only ever points inside its own attachments folder. */
  url: string
  createdAt: Iso
}

export interface JournalDraft {
  date: LocalDate
  kind: JournalKind
  title: string | null
  body: string
  mood: Mood | null
  stepToward: StepToward | null
  /** Answers keyed by prompt id, for daily, deep and monthly reflections. */
  prompts: Record<string, string>
  tags: string[]
  goalId: number | null
  letGoId: number | null
  /** Attachments to keep on this entry; any previously linked and missing here are deleted. */
  attachmentIds?: number[]
}

export interface JournalEntry extends Omit<JournalDraft, 'attachmentIds'> {
  id: number
  attachments: Attachment[]
  createdAt: Iso
  updatedAt: Iso
}

// ------------------------------------------------------------------ guide

/**
 * An observation drawn only from what the user logged. It states counts and leaves
 * the meaning to them — no diagnosis, no claimed certainty.
 */
export interface GuideInsight {
  key: string
  observation: string
  evidence: string
  action:
    | { kind: 'add-tool'; label: string; title: string; goalId: number | null }
    | { kind: 'open-letgo'; label: string; id: number }
    | { kind: 'open-mountain'; label: string; id: number }
    | { kind: 'ceremony'; label: string; id: number }
    | { kind: 'write'; label: string; prompt: string; goalId: number | null }
    | null
}

// ---------------------------------------------------------------- IPC

/**
 * What `/api/rpc/<channel>` streams back, one JSON object per line: any number of
 * events while the call runs, then exactly one `result` or `error`.
 */
export type RpcEvent =
  | { event: 'syncStatus'; data: SyncStatus }
  | { event: 'toast'; data: ToastMessage }
  | { event: 'goalProgress'; data: GoalPlanProgress }
  /** A notification for the browser to show, if the user allowed them. */
  | { event: 'notify'; data: { title: string; body: string } }
  | { event: 'dataChanged' }

export type RpcLine = RpcEvent | { result: unknown } | { error: { message: string; status: number } }

export interface ToastMessage {
  kind: 'info' | 'success' | 'warn' | 'error'
  title: string
  body?: string
}
