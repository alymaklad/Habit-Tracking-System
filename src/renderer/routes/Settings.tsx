import { useEffect, useState } from 'react'
import type { AiStatus, AppSettings, NotificationChannel, SyncStatus, ThemeMode } from '@shared/types'
import Screen from '../components/Screen'
import Icon from '../components/Icon'
import { Button, Card, CardTitle, ErrorState, Field, Label, Loading, Toggle } from '../components/ui'
import { useData } from '../hooks/useData'
import { SYNC_COLOR, SYNC_LABEL } from '../lib/format'
import { useShell } from '../khatwa/nav'

const SCORING_ROWS: [keyof AppSettings['scoring'], string, boolean][] = [
  ['fullCompletion', 'Full completion', true],
  ['partialCompletion', 'Partial completion', true],
  ['skipped', 'Justified skip', true],
  ['unjustifiedSkip', 'Missed', true],
  ['beatWeeklyTarget', 'Beat weekly target', false],
  ['worstDayCompletion', 'Worst-day completion', false],
  ['sevenDayConsistency', '7-day consistency', false]
]

function Segmented<T extends string>({
  value,
  options,
  onChange
}: {
  value: T
  options: readonly T[]
  onChange: (v: T) => void
}) {
  return (
    <div className="kh-segmented">
      {options.map((o) => (
        <button key={o} onClick={() => onChange(o)} className={value === o ? 'is-on' : ''}>
          {o[0]!.toUpperCase() + o.slice(1)}
        </button>
      ))}
    </div>
  )
}

function Row({
  title,
  hint,
  children
}: {
  title: string
  hint?: string
  children: React.ReactNode
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 14,
        paddingTop: 12,
        borderTop: '1px solid var(--line)'
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 14 }}>{title}</span>
        {hint ? <span style={{ fontSize: 12, color: 'var(--faint)' }}>{hint}</span> : null}
      </div>
      {children}
    </div>
  )
}

/**
 * Bring-your-own key per provider, same shape as the Google client id: pasted here,
 * stored as a settings flag, never shown back once saved. Keys and models are kept per
 * provider, so switching between them loses nothing.
 */
function AiProviderCard() {
  const [status, setStatus] = useState<AiStatus | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [editing, setEditing] = useState(false)

  const load = (): void => {
    void window.api.ai.status().then(setStatus)
  }
  useEffect(load, [])

  const current = status?.providers.find((p) => p.id === status.provider) ?? null
  const currentId = current?.id
  const currentModel = current?.model

  useEffect(() => {
    if (currentModel !== undefined) setModel(currentModel)
  }, [currentId, currentModel])

  const showForm = editing || current?.hasKey === false

  return (
    <Card
      accent={status?.ready ? 'var(--ok)' : 'var(--line)'}
      style={{ display: 'flex', flexDirection: 'column', gap: 13 }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <CardTitle>AI planner</CardTitle>
        {status ? (
          <span
            className="display"
            style={{ fontSize: 11, letterSpacing: '0.1em', color: status.ready ? 'var(--ok)' : 'var(--faint)' }}
          >
            {status.ready ? 'READY' : 'NO KEY'}
          </span>
        ) : null}
      </div>

      <span style={{ fontSize: 11.5, lineHeight: 1.55, color: 'var(--dim)', textWrap: 'pretty' }}>
        The Goals wizard drafts plans with an LLM using your own API key. Calls are billed to your
        account with that provider, not to this app — a full draft is a handful of requests. Keys are
        stored locally and only ever sent to the provider they belong to.
      </span>

      {status ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <Label>Provider</Label>
          <div style={{ display: 'flex' }}>
            {status.providers.map((p, i) => {
              const on = p.id === status.provider
              return (
                <button
                  key={p.id}
                  onClick={async () => {
                    await window.api.ai.setProvider(p.id)
                    setEditing(false)
                    setApiKey('')
                    load()
                  }}
                  className="display"
                  style={{
                    padding: '6px 13px',
                    fontSize: 10.5,
                    letterSpacing: '0.1em',
                    marginLeft: i ? -1 : 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 7,
                    border: `1px solid ${on ? 'var(--accent)' : 'var(--line)'}`,
                    background: on ? 'var(--accent)' : 'transparent',
                    color: on ? 'var(--accent-ink)' : 'var(--dim)'
                  }}
                >
                  {p.label.toUpperCase()}
                  <span
                    title={p.hasKey ? 'Key saved' : 'No key'}
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: '50%',
                      background: p.hasKey ? 'var(--ok)' : 'var(--line)'
                    }}
                  />
                </button>
              )
            })}
          </div>
        </div>
      ) : null}

      {current ? (
        showForm ? (
          <>
            <Field label={`${current.label} API key`}>
              <input
                type="password"
                value={apiKey}
                placeholder={current.keyPlaceholder}
                onChange={(e) => setApiKey(e.target.value)}
                autoComplete="off"
              />
            </Field>
            <Field label="Model" hint={current.note}>
              <input value={model} placeholder={current.defaultModel} onChange={(e) => setModel(e.target.value)} />
            </Field>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button
                kind="solid"
                disabled={!apiKey.trim()}
                onClick={async () => {
                  await window.api.ai.setCredentials(current.id, apiKey, model || null)
                  setApiKey('')
                  setEditing(false)
                  load()
                }}
              >
                SAVE KEY
              </Button>
              {current.hasKey ? <Button onClick={() => setEditing(false)}>CANCEL</Button> : null}
            </div>
          </>
        ) : (
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
              <span style={{ fontSize: 13 }}>Ready to draft plans with {current.label}</span>
              <span className="num" style={{ fontSize: 10.5, color: 'var(--faint)', fontWeight: 400 }}>
                {current.model}
              </span>
            </div>
            <Button onClick={() => setEditing(true)}>CHANGE</Button>
            <Button
              kind="danger"
              onClick={async () => {
                await window.api.ai.setCredentials(current.id, null, null)
                load()
              }}
            >
              REMOVE
            </Button>
          </div>
        )
      ) : null}
    </Card>
  )
}

export default function Settings({
  status,
  onSettingsChanged
}: {
  status: SyncStatus | null
  onSettingsChanged: () => void
}) {
  const { data, error, refetch } = useData(() => window.api.settings.get(), [])
  const [local, setLocal] = useState<AppSettings | null>(null)
  const [hasCreds, setHasCreds] = useState(true)
  const { account, signOut } = useShell()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)

  useEffect(() => setLocal(data), [data])
  useEffect(() => {
    void window.api.google.hasCredentials().then(setHasCreds)
  }, [])

  if (error) return (<Screen title="Settings"><ErrorState message={error} onRetry={refetch} /></Screen>)
  if (!local) return (<Screen title="Settings"><Loading /></Screen>)

  const save = async (patch: Partial<AppSettings>): Promise<void> => {
    setLocal({ ...local, ...patch } as AppSettings)
    await window.api.settings.save(patch)
    refetch()
    onSettingsChanged()
  }

  const toggleChannel = (c: NotificationChannel): void => {
    const next = local.channels.includes(c)
      ? local.channels.filter((x) => x !== c)
      : [...local.channels, c]
    void save({ channels: next })
  }

  const connected = status && status.state !== 'disconnected'

  return (
    <Screen title="Settings" subtitle="Folio · sync · notifications · scoring">
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(380px, 1fr))',
          gap: 20,
          alignItems: 'start'
        }}
      >
        {/* ------------------------------------------------ profile */}
        <Card style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <CardTitle>Your folio</CardTitle>
          <Field label="Your name" hint="Used in greetings and on your Me page. Leave blank to go unnamed.">
            <input
              className="kh-input is-display"
              defaultValue={local.displayName}
              placeholder="Aly"
              onBlur={(e) => {
                const next = e.target.value.trim()
                if (next !== local.displayName) void save({ displayName: next })
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
              }}
            />
          </Field>
        </Card>

        {/* ------------------------------------------------ account */}
        {account ? (
          <Card style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
            <CardTitle>Your account</CardTitle>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                <span style={{ fontSize: 13 }}>{account.name ?? account.email}</span>
                {account.name ? <span style={{ fontSize: 11.5, color: 'var(--faint)' }}>{account.email}</span> : null}
              </div>
              <Button kind="danger" onClick={() => void signOut()}>
                SIGN OUT
              </Button>
            </div>
          </Card>
        ) : null}

        {/* ------------------------------------------------ Google */}
        <Card
          accent={
            status?.state === 'needs_reauth'
              ? 'var(--bad)'
              : connected
                ? 'var(--ok)'
                : 'var(--line)'
          }
          style={{ display: 'flex', flexDirection: 'column', gap: 13 }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <CardTitle>Google Calendar</CardTitle>
            {status ? (
              <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span
                  style={{
                    width: 6,
                    height: 6,
                    background: SYNC_COLOR[status.state],
                    borderRadius: '50%'
                  }}
                />
                <span
                  className="display"
                  style={{ fontSize: 11, letterSpacing: '0.1em', color: SYNC_COLOR[status.state] }}
                >
                  {SYNC_LABEL[status.state].toUpperCase()}
                </span>
              </span>
            ) : null}
          </div>

          {!hasCreds ? (
            <span style={{ fontSize: 11.5, lineHeight: 1.55, color: 'var(--dim)', textWrap: 'pretty' }}>
              Google linking is not set up in this build. Add the app’s Google client to <code>.env</code> and
              rebuild — see docs/GOOGLE_SETUP.md.
            </span>
          ) : (
            <>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 2, minWidth: 0 }}>
                  <span style={{ fontSize: 13 }}>
                    {status?.account ?? (connected ? 'Connected' : 'Not connected')}
                  </span>
                  <span style={{ fontSize: 10.5, color: 'var(--faint)' }}>
                    {status?.tasklistName ? `Google Tasks · list "${status.tasklistName}"` : 'Google Tasks'}
                  </span>
                </div>
                {connected ? (
                  <Button
                    kind="danger"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      await window.api.google.disconnect()
                      setBusy(false)
                    }}
                  >
                    UNLINK
                  </Button>
                ) : (
                  <Button
                    kind="solid"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true)
                      setMessage(null)
                      const r = await window.api.google.connect()
                      if (!r.ok) setMessage(r.error ?? 'Connection failed')
                      setBusy(false)
                    }}
                  >
                    LINK GOOGLE CALENDAR
                  </Button>
                )}
              </div>

              {message ? (
                <span style={{ fontSize: 11.5, color: 'var(--bad)', textWrap: 'pretty' }}>{message}</span>
              ) : null}

              <div
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--line)',
                  padding: '11px 13px',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 5
                }}
              >
                <Label>Permissions requested</Label>
                <span className="num" style={{ fontSize: 11.5, color: 'var(--dim)', fontWeight: 400 }}>
                  .../auth/tasks — read and update your tasks
                </span>
                <span className="num" style={{ fontSize: 11.5, color: 'var(--dim)', fontWeight: 400 }}>
                  .../auth/calendar.app.created — a calendar this app creates
                </span>
                <span style={{ fontSize: 10.5, lineHeight: 1.5, color: 'var(--faint)', textWrap: 'pretty' }}>
                  This app cannot see your existing calendars, mail, contacts or files.
                  Disconnecting revokes the token and keeps all of your habit history.
                </span>
              </div>
            </>
          )}
        </Card>

        {/* -------------------------------------------------- AI */}
        <AiProviderCard />

        {/* ------------------------------------------------ sync */}
        <Card style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <CardTitle>Synchronisation</CardTitle>

          <Field label={`Check Google every ${local.syncIntervalMinutes} minutes`}>
            <input
              type="range"
              min={1}
              max={60}
              value={local.syncIntervalMinutes}
              onChange={(e) => void save({ syncIntervalMinutes: Number(e.target.value) })}
              style={{ padding: 0, border: 'none', background: 'transparent', accentColor: 'var(--accent)' }}
            />
          </Field>

          <Row title="Create tasks ahead" hint="How far in advance tasks appear in Google">
            <input
              type="number"
              min={1}
              max={30}
              value={local.provisionHorizonDays}
              onChange={(e) => void save({ provisionHorizonDays: Number(e.target.value) })}
              style={{ width: 80 }}
            />
          </Row>

          <span style={{ fontSize: 10.5, lineHeight: 1.5, color: 'var(--faint)', textWrap: 'pretty' }}>
            Google Tasks offers no push notifications of any kind, so changes are picked up on
            this interval rather than instantly.
          </span>

          <Button onClick={() => void window.api.settings.recomputeAll()}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <Icon name="refresh" size={12} strokeWidth={2} />
              RECOMPUTE ALL STATISTICS
            </span>
          </Button>
        </Card>

        {/* ------------------------------------------------ notifications */}
        <Card style={{ display: 'flex', flexDirection: 'column', gap: 13 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
              <Icon name="bell" size={16} color="var(--dim)" />
              <CardTitle>Notifications</CardTitle>
            </span>
            <Toggle
              on={local.notificationsEnabled}
              onChange={(v) => void save({ notificationsEnabled: v })}
            />
          </div>

          <Label>Where they are delivered</Label>

          <Row title="Windows toast" hint="Desktop only — cannot reach a phone">
            <Toggle on={local.channels.includes('toast')} onChange={() => toggleChannel('toast')} />
          </Row>

          <Row
            title="Google Calendar reminder"
            hint="Mirrors each habit as a timed event so your phone rings"
          >
            <Toggle
              on={local.channels.includes('calendar')}
              onChange={() => {
                toggleChannel('calendar')
                void save({ calendarMirrorEnabled: !local.channels.includes('calendar') })
              }}
            />
          </Row>

          <Row title="Push relay" hint="For streaks and reviews, which a calendar cannot express">
            <Toggle on={local.channels.includes('push')} onChange={() => toggleChannel('push')} />
          </Row>

          {local.channels.includes('push') ? (
            <div
              style={{
                background: 'var(--bg)',
                border: '1px solid var(--line)',
                padding: '11px 13px',
                display: 'flex',
                flexDirection: 'column',
                gap: 9
              }}
            >
              <Field label="Relay server">
                <input
                  value={local.push.server}
                  onChange={(e) => void save({ push: { ...local.push, server: e.target.value } })}
                />
              </Field>
              <Field
                label="Topic"
                hint="Treat this as a secret — anyone who knows it can post to it. Use something long and random."
              >
                <input
                  value={local.push.topic}
                  placeholder="habit-league-7f3a91c4"
                  onChange={(e) =>
                    void save({ push: { ...local.push, topic: e.target.value, enabled: true } })
                  }
                />
              </Field>
              <Button
                onClick={async () => {
                  const ok = await window.api.push.test()
                  setMessage(ok ? 'Test notification sent.' : 'Could not reach the relay.')
                }}
              >
                SEND TEST
              </Button>
            </div>
          ) : null}

          <div style={{ height: 1, background: 'var(--line)' }} />
          <Label>What you are notified about</Label>

          <Row title="Upcoming habit" hint={`${local.defaultReminderLeadMinutes} minutes before`}>
            <Toggle on={local.notifyUpcoming} onChange={(v) => void save({ notifyUpcoming: v })} />
          </Row>
          <Row title="Completion">
            <Toggle on={local.notifyCompletion} onChange={(v) => void save({ notifyCompletion: v })} />
          </Row>
          <Row title="Streak">
            <Toggle on={local.notifyStreak} onChange={(v) => void save({ notifyStreak: v })} />
          </Row>
          <Row title="Weekly review">
            <Toggle
              on={local.notifyWeeklyReview}
              onChange={(v) => void save({ notifyWeeklyReview: v })}
            />
          </Row>
          <Row title="Default reminder lead" hint="Minutes before a habit starts">
            <input
              type="number"
              min={0}
              max={240}
              value={local.defaultReminderLeadMinutes}
              onChange={(e) => void save({ defaultReminderLeadMinutes: Number(e.target.value) })}
              style={{ width: 80 }}
            />
          </Row>
        </Card>

        {/* ------------------------------------------------ scoring */}
        <Card style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <CardTitle>Scoring</CardTitle>
          <Row title="Weekly points target" hint="0 turns the target off. Tracked on the Calendar and in the Weekly Review.">
            <input
              type="number"
              min={0}
              value={local.weeklyPointsTarget}
              onChange={(e) => void save({ weeklyPointsTarget: Number(e.target.value) })}
              style={{ width: 80 }}
            />
          </Row>
          {SCORING_ROWS.map(([key, label], i) => (
            <div
              key={key}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                ...(i === 4 ? { marginTop: 6, paddingTop: 11, borderTop: '1px solid var(--line)' } : {})
              }}
            >
              <span style={{ fontSize: 12, color: i < 4 ? 'var(--fg)' : 'var(--dim)' }}>{label}</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
                <button
                  onClick={() =>
                    void save({ scoring: { ...local.scoring, [key]: local.scoring[key] - 1 } })
                  }
                  style={stepper}
                >
                  −
                </button>
                <span
                  className="num"
                  style={{
                    fontSize: 16,
                    width: 34,
                    textAlign: 'center',
                    color:
                      local.scoring[key] > 0
                        ? 'var(--ok)'
                        : local.scoring[key] < 0
                          ? 'var(--bad)'
                          : 'var(--faint)'
                  }}
                >
                  {local.scoring[key] > 0 ? `+${local.scoring[key]}` : local.scoring[key]}
                </span>
                <button
                  onClick={() =>
                    void save({ scoring: { ...local.scoring, [key]: local.scoring[key] + 1 } })
                  }
                  style={stepper}
                >
                  +
                </button>
              </div>
            </div>
          ))}
        </Card>

        {/* ------------------------------------------------ appearance */}
        <Card style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <CardTitle>Appearance</CardTitle>
            <Segmented<ThemeMode>
              value={local.theme}
              options={['light', 'dark', 'system'] as const}
              onChange={(v) => void save({ theme: v })}
            />
          </div>
          <Row title="Start with Windows">
            <Toggle on={local.startWithWindows} onChange={(v) => void save({ startWithWindows: v })} />
          </Row>
          <Row title="Minimise to system tray" hint="Keeps background sync running when closed">
            <Toggle on={local.minimiseToTray} onChange={(v) => void save({ minimiseToTray: v })} />
          </Row>
          <Row title="Reduce animation">
            <Toggle on={local.reduceMotion} onChange={(v) => void save({ reduceMotion: v })} />
          </Row>
        </Card>
      </div>
    </Screen>
  )
}

const stepper: React.CSSProperties = {
  width: 26,
  height: 26,
  borderRadius: 6,
  border: '1px solid var(--line)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  color: 'var(--faint)',
  fontSize: 13
}
