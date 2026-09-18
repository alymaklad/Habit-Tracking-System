import type {
  AchievementView,
  AiProvider,
  AiStatus,
  AppSettings,
  CalendarBlock,
  CalendarMonthDay,
  DashboardView,
  DifficultyProposal,
  GoalDraftInput,
  GoalDraftResult,
  GoalPlan,
  GoalPlanProgress,
  GoalResource,
  GoalView,
  Habit,
  HabitDraft,
  LocalDate,
  MindMapNode,
  PerformanceView,
  PersonalRecordView,
  TodoView,
  ProgressView,
  SyncStatus,
  ToastMessage,
  WeeklyReview
} from './types'

/**
 * The complete surface the renderer may call. The preload bridge exposes exactly this
 * and nothing more — the renderer has no Node access, no database handle and never
 * sees an OAuth token.
 */
export interface HabitApi {
  habits: {
    list(): Promise<Habit[]>
    get(id: number): Promise<Habit | null>
    create(draft: HabitDraft): Promise<Habit>
    update(id: number, draft: HabitDraft): Promise<Habit>
    setActive(id: number, active: boolean): Promise<void>
  }

  occurrence: {
    setCompleted(occurrenceId: number, completed: boolean): Promise<void>
    setSkip(occurrenceId: number, skip: boolean, reason: string | null): Promise<void>
    reschedule(occurrenceId: number, date: LocalDate, time: string): Promise<void>
  }

  timer: {
    start(occurrenceId: number): Promise<void>
    stop(occurrenceId: number): Promise<number>
    addManual(occurrenceId: number, minutes: number): Promise<void>
  }

  view: {
    dashboard(): Promise<DashboardView>
    calendarRange(from: LocalDate, to: LocalDate): Promise<CalendarBlock[]>
    calendarMonth(anchor: LocalDate): Promise<CalendarMonthDay[]>
    progress(weeks?: number): Promise<ProgressView>
    performance(anchor?: LocalDate): Promise<PerformanceView>
    todos(anchor?: LocalDate): Promise<TodoView>
    weeklyReview(anchor?: LocalDate): Promise<WeeklyReview | null>
    achievements(): Promise<AchievementView[]>
    personalRecords(): Promise<PersonalRecordView[]>
    proposals(): Promise<DifficultyProposal[]>
  }

  todo: {
    addManual(title: string, date?: LocalDate): Promise<number>
    addSubtask(occurrenceId: number, title: string): Promise<number>
    setDone(id: number, done: boolean): Promise<void>
    rename(id: number, title: string): Promise<void>
    drop(id: number): Promise<void>
    remove(id: number): Promise<void>
    reschedule(id: number, date: LocalDate): Promise<void>
    templatesFor(habitId: number): Promise<{ id: number; title: string; position: number }[]>
    setTemplates(habitId: number, titles: string[]): Promise<void>
  }

  proposal: {
    accept(id: number): Promise<void>
    reject(id: number): Promise<void>
  }

  goals: {
    list(): Promise<GoalView[]>
    get(id: number): Promise<GoalView | null>
    /** Runs the planning loop; progress arrives on `on.goalProgress`. Nothing is saved. */
    draftPlan(input: GoalDraftInput): Promise<GoalDraftResult>
    commit(input: GoalDraftInput, plan: GoalPlan): Promise<GoalView>
    close(id: number, outcome: 'achieved' | 'abandoned'): Promise<void>
    reopen(id: number): Promise<void>
    updatePlan(id: number, patch: { mindMap?: MindMapNode[]; resources?: GoalResource[] }): Promise<void>
    remove(id: number): Promise<void>
  }

  ai: {
    status(): Promise<AiStatus>
    setProvider(provider: AiProvider): Promise<void>
    setCredentials(provider: AiProvider, apiKey: string | null, model: string | null): Promise<void>
  }

  settings: {
    get(): Promise<AppSettings>
    save(patch: Partial<AppSettings>): Promise<AppSettings>
    recomputeAll(): Promise<void>
  }

  google: {
    status(): Promise<SyncStatus>
    hasCredentials(): Promise<boolean>
    setCredentials(clientId: string, clientSecret: string | null): Promise<void>
    connect(): Promise<{ ok: boolean; error?: string }>
    disconnect(): Promise<void>
    syncNow(): Promise<SyncStatus>
  }

  push: {
    test(): Promise<boolean>
  }

  app: {
    openExternal(url: string): Promise<void>
    version(): Promise<string>
  }

  /** Main-process pushes. Each returns an unsubscribe function. */
  on: {
    syncStatus(cb: (status: SyncStatus) => void): () => void
    dataChanged(cb: () => void): () => void
    toast(cb: (message: ToastMessage) => void): () => void
    goalProgress(cb: (progress: GoalPlanProgress) => void): () => void
  }
}

declare global {
  interface Window {
    api: HabitApi
  }
}
