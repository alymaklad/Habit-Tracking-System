import type {
  AchievementView,
  AiProvider,
  AccountStatus,
  LetGoDraftResult,
  LetGoPlan,
  LetGoPlanInput,
  AccountUser,
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
  Attachment,
  GoalObstacle,
  GoalView,
  GuideInsight,
  SavedGoalDraft,
  Habit,
  HabitDetailView,
  JournalDraft,
  JournalEntry,
  LetGoCheckinInput,
  LetGoDraft,
  LetGoView,
  Tool,
  ToolDraft,
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
 * The complete surface the UI may call. In the browser it is implemented by
 * `src/renderer/lib/webApi.ts`, which turns each call into a POST to `/api/rpc/<channel>`.
 * The UI never holds a database handle and never sees an OAuth token.
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
    habitDetail(habitId: number): Promise<HabitDetailView | null>
  }

  todo: {
    /** `goalId` files the item as one of that mountain's milestones. */
    addManual(title: string, date?: LocalDate, goalId?: number): Promise<number>
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

  letGo: {
    list(): Promise<LetGoView[]>
    get(id: number): Promise<LetGoView | null>
    create(draft: LetGoDraft): Promise<LetGoView>
    update(id: number, draft: LetGoDraft): Promise<void>
    /** One answer per day; answering again replaces it. Future days are refused. */
    checkIn(id: number, date: LocalDate, input: LetGoCheckinInput): Promise<void>
    clearCheckIn(id: number, date: LocalDate): Promise<void>
    leaveBehind(id: number, vow: string | null): Promise<void>
    pickUpAgain(id: number): Promise<void>
    remove(id: number): Promise<void>
  }

  journal: {
    list(): Promise<JournalEntry[]>
    /** null creates; a monthly entry for a month that already has one updates it. */
    save(id: number | null, draft: JournalDraft): Promise<JournalEntry>
    remove(id: number): Promise<void>
  }

  attachments: {
    /** Uploads files, unlinked until an entry is saved with their ids. null opens a file picker. */
    import(files: File[] | null): Promise<Attachment[]>
    /** Removes a file not yet saved on an entry. */
    discard(id: number): Promise<void>
    setCaption(id: number, caption: string | null): Promise<void>
    /** Opens a file in a new tab. */
    open(attachment: Attachment): Promise<void>
  }

  tools: {
    list(): Promise<Tool[]>
    save(id: number | null, draft: ToolDraft): Promise<Tool>
    remove(id: number): Promise<void>
  }

  guide: {
    list(): Promise<GuideInsight[]>
    dismiss(key: string): Promise<void>
  }

  goals: {
    /** The goal wizard put aside mid-way, if any. */
    draft(): Promise<SavedGoalDraft | null>
    saveDraft(draft: SavedGoalDraft | null): Promise<void>
    list(): Promise<GoalView[]>
    get(id: number): Promise<GoalView | null>
    /** Runs the planning loop; progress arrives on `on.goalProgress`. Nothing is saved. */
    draftPlan(input: GoalDraftInput): Promise<GoalDraftResult>
    commit(input: GoalDraftInput, plan: GoalPlan): Promise<GoalView>
    close(id: number, outcome: 'achieved' | 'abandoned'): Promise<void>
    reopen(id: number): Promise<void>
    updatePlan(id: number, patch: { mindMap?: MindMapNode[]; resources?: GoalResource[]; obstacles?: GoalObstacle[] }): Promise<void>
    remove(id: number): Promise<void>
  }

  /** Planning, with the AI planner, how to let a habit go. */
  letGoPlan: {
    draft(input: LetGoPlanInput): Promise<LetGoDraftResult>
    save(input: LetGoPlanInput, plan: LetGoPlan): Promise<LetGoView>
  }

  account: {
    status(): Promise<AccountStatus>
    signUp(name: string, email: string, password: string): Promise<AccountUser>
    signIn(email: string, password: string): Promise<AccountUser>
    signInWithGoogle(): Promise<AccountUser>
    signOut(): Promise<void>
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
    /** Once per page load: settles the time zone and brings the schedule up to today. */
    start(): Promise<void>
    /** The open app's heartbeat: delivers due reminders and syncs when the interval has passed. */
    tick(): Promise<{ sync: SyncStatus; nextReminderAt: string | null }>
  }

  /** Events the server streams back while a call runs. Each returns an unsubscribe function. */
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
