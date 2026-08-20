import Screen from '../components/Screen'
import Icon from '../components/Icon'
import { Bar, Card, CardTitle, Label } from '../components/ui'
import { useData } from '../hooks/useData'

export default function Achievements() {
  const { data: achievements } = useData(() => window.api.view.achievements(), [])
  const { data: records } = useData(() => window.api.view.personalRecords(), [])

  const list = achievements ?? []
  const unlocked = list.filter((a) => a.unlockedAt).length
  const pct = list.length ? Math.round((unlocked / list.length) * 100) : 0

  return (
    <Screen
      title="Achievements"
      subtitle={`${unlocked} of ${list.length} unlocked`}
      scroll={false}
    >
      <div style={{ flexGrow: 1, display: 'flex', minHeight: 0 }}>
        <div style={{ flexGrow: 1, padding: '18px 24px', overflowY: 'auto', minWidth: 0 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginBottom: 14,
              gap: 20
            }}
          >
            <Label>{unlocked} of {list.length} unlocked</Label>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: 240 }}>
              <Bar value={pct} color="var(--gold)" />
              <span className="num" style={{ fontSize: 12, color: 'var(--gold)' }}>
                {pct}%
              </span>
            </div>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
              gap: 12
            }}
          >
            {list.map((a) => {
              const on = a.unlockedAt !== null
              const color = on ? 'var(--gold)' : 'var(--faint)'
              return (
                <div
                  key={a.key}
                  title={a.description}
                  style={{
                    background: on ? 'var(--panel)' : 'var(--panel2)',
                    border: `1px solid ${on ? 'var(--gold)' : 'var(--line)'}`,
                    padding: '16px 14px',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 9,
                    textAlign: 'center',
                    opacity: on ? 1 : 0.62
                  }}
                >
                  <div style={{ position: 'relative', width: 46, height: 50 }}>
                    <svg width="46" height="50" viewBox="0 0 42 46" fill="none">
                      <path
                        d="M21 1.5 39.5 12v22L21 44.5 2.5 34V12Z"
                        fill={on ? 'color-mix(in oklab, var(--gold) 16%, transparent)' : 'transparent'}
                        stroke={on ? 'var(--gold)' : 'var(--line)'}
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
                      <Icon name={on ? 'achievements' : 'lock'} size={19} color={color} />
                    </div>
                  </div>

                  <span className="display" style={{ fontSize: 13, lineHeight: 1.15 }}>
                    {a.name}
                  </span>
                  <span style={{ fontSize: 10, color: 'var(--faint)' }}>{a.progressLabel}</span>

                  {!on && a.progress > 0 ? (
                    <div style={{ width: '100%' }}>
                      <Bar value={a.progress * 100} color="var(--gold)" height={3} />
                    </div>
                  ) : null}
                </div>
              )
            })}
          </div>
        </div>

        <div
          style={{
            width: 314,
            flexShrink: 0,
            borderLeft: '1px solid var(--line)',
            padding: '18px 20px',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 14
          }}
        >
          <CardTitle>Personal records</CardTitle>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {(records ?? []).map((r) => (
              <Card key={r.kind} style={{ padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                <Label>{r.label}</Label>
                <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                  <span className="num" style={{ fontSize: 19 }}>
                    {r.value}
                  </span>
                  {r.achievedOn ? (
                    <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>{r.achievedOn}</span>
                  ) : null}
                </div>
              </Card>
            ))}
          </div>
        </div>
      </div>
    </Screen>
  )
}
