import type {
  AchievementView,
  AppSettings,
  CalendarBlock,
  CalendarMonthDay,
  DashboardView,
  DifficultyProposal,
  Habit,
  HabitDraft,
  LocalDate,
  PerformanceView,
  PersonalRecordView,
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
    weeklyReview(anchor?: LocalDate): Promise<WeeklyReview | null>
    achievements(): Promise<AchievementView[]>
    personalRecords(): Promise<PersonalRecordView[]>
    proposals(): Promise<DifficultyProposal[]>
  }

  proposal: {
    accept(id: number): Promise<void>
    reject(id: number): Promise<void>
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
  }
}

declare global {
  interface Window {
    api: HabitApi
  }
}
