import Screen from '../components/Screen'
import Icon from '../components/Icon'
import { Label } from '../components/ui'

/**
 * Honest placeholders. Both screens stay in the navigation so it matches the finished
 * product, but they say plainly that they are not built and why, rather than showing
 * invented friends and fabricated scores.
 */
function Placeholder({
  title,
  icon,
  lead,
  points
}: {
  title: string
  icon: 'users' | 'challenges'
  lead: string
  points: string[]
}) {
  return (
    <Screen title={title} subtitle="Not built yet · phase 3">
      <div
        style={{
          flexGrow: 1,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '30px 60px'
        }}
      >
        <div
          style={{
            maxWidth: 560,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 20,
            textAlign: 'center'
          }}
        >
          <div style={{ position: 'relative', width: 84, height: 92 }}>
            <svg width="84" height="92" viewBox="0 0 42 46" fill="none">
              <path
                d="M21 1.5 39.5 12v22L21 44.5 2.5 34V12Z"
                fill="var(--panel)"
                stroke="var(--line)"
                strokeWidth="1.5"
              />
            </svg>
            <div
              style={{
                position: 'absolute',
                inset: 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center'
              }}
            >
              <Icon name={icon} size={34} color="var(--faint)" strokeWidth={1.4} />
            </div>
          </div>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 9, alignItems: 'center' }}>
            <span className="display" style={{ fontSize: 26 }}>
              {title}
            </span>
            <span
              style={{
                fontSize: 10,
                letterSpacing: '0.16em',
                textTransform: 'uppercase',
                color: 'var(--accent)',
                border: '1px solid var(--accent)',
                padding: '3px 10px'
              }}
            >
              Phase 3
            </span>
          </div>

          <span style={{ fontSize: 13, lineHeight: 1.6, color: 'var(--dim)', textWrap: 'pretty' }}>
            {lead}
          </span>

          <div
            style={{
              width: '100%',
              background: 'var(--panel)',
              border: '1px solid var(--line)',
              padding: '18px 22px',
              display: 'flex',
              flexDirection: 'column',
              gap: 11,
              textAlign: 'left'
            }}
          >
            <Label>What will land here</Label>
            {points.map((p) => (
              <div key={p} style={{ display: 'flex', alignItems: 'flex-start', gap: 10 }}>
                <span
                  style={{
                    width: 5,
                    height: 5,
                    background: 'var(--accent)',
                    marginTop: 6,
                    flexShrink: 0
                  }}
                />
                <span style={{ fontSize: 12, lineHeight: 1.5, color: 'var(--dim)', textWrap: 'pretty' }}>
                  {p}
                </span>
              </div>
            ))}
          </div>

          <span style={{ fontSize: 11, lineHeight: 1.55, color: 'var(--faint)', textWrap: 'pretty' }}>
            Your Google Tasks content never leaves this device. Only the figures you explicitly
            choose to share would ever be sent.
          </span>
        </div>
      </div>
    </Screen>
  )
}

export function Leaderboard() {
  return (
    <Placeholder
      title="Leaderboard"
      icon="users"
      lead="Friend groups and shared leaderboards need a server to sync between people, so they come after the Google synchronisation is proven reliable."
      points={[
        'Create a group, generate an invite code, and share a weekly leaderboard with friends.',
        'Five separate rankings — hours, consistency, improvement, streak and XP — so someone aiming at 10 hours a week can still win against someone aiming at 30.',
        'Per-field privacy switches: share XP and completion percentage while keeping habit names and task contents entirely private.'
      ]}
    />
  )
}

export function Challenges() {
  return (
    <Placeholder
      title="Challenges"
      icon="challenges"
      lead="Weekly challenges are scored against the same group data as the leaderboard, so they arrive together with it."
      points={[
        'Most Hours, Most Consistent, Biggest Improvement and Streak Battle, each running for one week.',
        'Scored on improvement against your own previous week, not on raw totals, so a challenge stays winnable at any target size.',
        'Opt in per challenge — sitting one out costs nothing and does not affect your own streaks or XP.'
      ]}
    />
  )
}
