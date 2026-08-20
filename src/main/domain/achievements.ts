import { formatDuration } from './time'

/** Everything the achievement rules are allowed to look at. Pure in, pure out. */
export interface AchievementStats {
  longestStreak: number
  currentStreak: number
  totalMinutes: number
  tasksCompleted: number
  perfectWeeks: number
  /** A week whose points beat the previous best. */
  beatOwnRecord: boolean
  /** Three consecutive completions after a gap of three or more missed days. */
  comeback: boolean
}

export interface AchievementDef {
  key: string
  name: string
  description: string
  /** 0–1 progress plus the label shown under the badge. */
  evaluate: (s: AchievementStats) => { progress: number; label: string }
}

const ratio = (have: number, need: number) => Math.min(1, need <= 0 ? 1 : have / need)

export const ACHIEVEMENTS: AchievementDef[] = [
  {
    key: 'streak_7',
    name: 'First 7-Day Streak',
    description: 'Complete a habit seven scheduled days in a row.',
    evaluate: (s) => ({
      progress: ratio(s.longestStreak, 7),
      label: s.longestStreak >= 7 ? 'Unlocked' : `${s.longestStreak} of 7 days`
    })
  },
  {
    key: 'hours_10',
    name: '10 Hours Studied',
    description: 'Log ten hours across all habits.',
    evaluate: (s) => ({
      progress: ratio(s.totalMinutes, 600),
      label: s.totalMinutes >= 600 ? 'Unlocked' : `${formatDuration(s.totalMinutes)} of 10h`
    })
  },
  {
    key: 'tasks_50',
    name: '50 Tasks Completed',
    description: 'Complete fifty scheduled habit occurrences.',
    evaluate: (s) => ({
      progress: ratio(s.tasksCompleted, 50),
      label: s.tasksCompleted >= 50 ? 'Unlocked' : `${s.tasksCompleted} of 50`
    })
  },
  {
    key: 'hours_100',
    name: '100 Hours Studied',
    description: 'Log one hundred hours across all habits.',
    evaluate: (s) => ({
      progress: ratio(s.totalMinutes, 6000),
      label: s.totalMinutes >= 6000 ? 'Unlocked' : `${formatDuration(s.totalMinutes)} of 100h`
    })
  },
  {
    key: 'perfect_week',
    name: 'Perfect Week',
    description: 'Complete every scheduled occurrence in a single week.',
    evaluate: (s) => ({
      progress: s.perfectWeeks > 0 ? 1 : 0,
      label: s.perfectWeeks > 0 ? `${s.perfectWeeks} so far` : 'Not yet'
    })
  },
  {
    key: 'streak_30',
    name: '30-Day Streak',
    description: 'Complete a habit thirty scheduled days in a row.',
    evaluate: (s) => ({
      progress: ratio(s.longestStreak, 30),
      label: s.longestStreak >= 30 ? 'Unlocked' : `${s.longestStreak} of 30 days`
    })
  },
  {
    key: 'beat_record',
    name: 'Beat Your Previous Record',
    description: 'Score more points in a week than in any week before it.',
    evaluate: (s) => ({
      progress: s.beatOwnRecord ? 1 : 0,
      label: s.beatOwnRecord ? 'Unlocked' : 'Not yet'
    })
  },
  {
    key: 'comeback',
    name: 'Comeback',
    description: 'Return from three or more missed days and complete three in a row.',
    evaluate: (s) => ({
      progress: s.comeback ? 1 : 0,
      label: s.comeback ? 'Unlocked' : 'Not yet'
    })
  }
]

export const ACHIEVEMENT_KEYS = ACHIEVEMENTS.map((a) => a.key)

/** Which achievements the stats currently satisfy. Unlock timestamps live in the DB. */
export function earnedKeys(stats: AchievementStats): string[] {
  return ACHIEVEMENTS.filter((a) => a.evaluate(stats).progress >= 1).map((a) => a.key)
}

export const PERSONAL_RECORD_LABELS: Record<string, string> = {
  longest_streak: 'Longest streak',
  most_hours_week: 'Most hours in a week',
  most_points_week: 'Most points in a week',
  best_completion_rate: 'Highest completion rate',
  most_productive_day: 'Most productive day',
  most_improved_habit: 'Most improved habit'
}
