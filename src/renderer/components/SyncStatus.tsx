import { useState } from 'react'
import type { SyncStatus } from '@shared/types'
import Icon from './Icon'
import { Button, Label } from './ui'
import { countdown, relative, clock, SYNC_COLOR, SYNC_LABEL } from '../lib/format'
import { useTick } from '../hooks/useData'

/**
 * The sync status is a control, not a label.
 *
 * It states the connection, when it last ran and when it runs next, and opens a details
 * panel on click. When Google revokes the token — which it does every seven days while
 * the OAuth consent screen is in Testing — it becomes an actionable Reconnect.
 */
export function SyncStatusControl({
  status,
  onOpen
}: {
  status: SyncStatus
  onOpen: () => void
}) {
  useTick(15_000)

  if (status.state === 'needs_reauth') {
    return (
      <button
        onClick={onOpen}
        style={{
          width: '100%',
          textAlign: 'left',
          padding: '12px 14px',
          borderTop: '1px solid var(--bad)',
          background: 'color-mix(in oklab, var(--bad) 13%, transparent)',
          display: 'flex',
          flexDirection: 'column',
          gap: 9
        }}
      >
        <span style={{ display: 'flex', alignItems: 'flex-start', gap: 8 }}>
          <Icon name="warning" size={14} color="var(--bad)" strokeWidth={1.8} />
          <span style={{ fontSize: 11.5, lineHeight: 1.35, color: 'var(--bad)' }}>
            Google connection expired
          </span>
        </span>
        <span
          className="display"
          style={{
            display: 'block',
            textAlign: 'center',
            padding: '6px 0',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.1em',
            border: '1px solid var(--bad)',
            background: 'var(--bad)',
            color: 'var(--accent-ink)'
          }}
        >
          RECONNECT
        </span>
      </button>
    )
  }

  const sub: string[] =
    status.state === 'syncing'
      ? ['Checking Google Tasks']
      : status.state === 'disconnected'
        ? ['Working offline', 'Everything still tracked']
        : status.state === 'offline'
          ? [
              `Last sync ${relative(status.lastSyncAt)}`,
              status.queuedCount > 0 ? `${status.queuedCount} change(s) queued` : 'Will retry shortly'
            ]
          : [`Last sync ${relative(status.lastSyncAt)}`, `Next sync ${countdown(status.nextSyncAt)}`]

  return (
    <button
      onClick={onOpen}
      title="Open sync details"
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '11px 14px',
        borderTop: '1px solid var(--line)',
        display: 'flex',
        alignItems: 'center',
        gap: 9,
        color: 'var(--faint)'
      }}
      onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--panel2)')}
      onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
    >
      <span
        className={status.state === 'syncing' ? 'spin' : undefined}
        style={{
          width: 7,
          height: 7,
          borderRadius: '50%',
          flexShrink: 0,
          background: status.state === 'syncing' ? 'transparent' : SYNC_COLOR[status.state],
          border: status.state === 'syncing' ? '1.5px solid var(--accent)' : 'none',
          borderTopColor: status.state === 'syncing' ? 'transparent' : undefined
        }}
      />
      <span style={{ flexGrow: 1, display: 'flex', flexDirection: 'column', gap: 1, minWidth: 0 }}>
        <span
          style={{
            fontSize: 11.5,
            color: status.state === 'connected' ? 'var(--fg)' : SYNC_COLOR[status.state]
          }}
        >
          {SYNC_LABEL[status.state]}
        </span>
        {sub.map((line) => (
          <span key={line} style={{ fontSize: 9.5, color: 'var(--faint)' }}>
            {line}
          </span>
        ))}
      </span>
      <Icon name="chevronRight" size={13} strokeWidth={2} />
    </button>
  )
}

// ------------------------------------------------------------- details

export function SyncDetailsPanel({
  status,
  onClose,
  onSyncNow,
  onReconnect,
  onSettings
}: {
  status: SyncStatus
  onClose: () => void
  onSyncNow: () => void
  onReconnect: () => void
  onSettings: () => void
}) {
  const [busy, setBusy] = useState(false)
  useTick(10_000)

  const expired = status.state === 'needs_reauth'

  const rows: [string, string, string?][] = expired
    ? [
        ['Last successful sync', relative(status.lastSyncAt), 'var(--bad)'],
        ['Failed attempts', String(status.consecutiveFailures)],
        ['Queued changes', `${status.queuedCount} waiting`, status.queuedCount ? 'var(--gold)' : undefined]
      ]
    : [
        ['Last sync', status.lastSyncAt ? `${clock(status.lastSyncAt)} · ${relative(status.lastSyncAt)}` : 'never'],
        ['Next sync', status.nextSyncAt ? `${clock(status.nextSyncAt)} · ${countdown(status.nextSyncAt)}` : '—', 'var(--accent)'],
        ['Interval', `Every ${status.intervalMinutes} minutes`],
        ['Task list', status.tasklistName ?? '—'],
        ['Created ahead', `${status.horizonDays} days`]
      ]

  return (
    <div
      className="rise"
      style={{
        position: 'absolute',
        left: 210,
        bottom: 16,
        width: 320,
        zIndex: 50,
        background: 'var(--panel)',
        border: `1px solid ${expired ? 'var(--bad)' : 'var(--line)'}`,
        boxShadow: '0 18px 50px -14px rgba(0,0,0,.65)',
        display: 'flex',
        flexDirection: 'column'
      }}
    >
      <div
        style={{
          padding: '14px 17px',
          borderBottom: '1px solid var(--line)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between'
        }}
      >
        <span className="display" style={{ fontSize: 15, letterSpacing: '0.03em' }}>
          Sync details
        </span>
        <button onClick={onClose} aria-label="Close">
          <Icon name="close" size={14} color="var(--faint)" strokeWidth={2} />
        </button>
      </div>

      <div style={{ padding: '14px 17px', display: 'flex', flexDirection: 'column', gap: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <span
            style={{
              width: 7,
              height: 7,
              borderRadius: '50%',
              background: SYNC_COLOR[status.state],
              flexShrink: 0
            }}
          />
          <span style={{ fontSize: 12.5, color: 'var(--fg)' }}>
            {status.account ? `${SYNC_LABEL[status.state]} · ${status.account}` : SYNC_LABEL[status.state]}
          </span>
        </div>

        {expired ? (
          <span style={{ fontSize: 11.5, lineHeight: 1.55, color: 'var(--dim)', textWrap: 'pretty' }}>
            Google revoked the stored token. This happens every 7 days while your OAuth consent
            screen is still in <span style={{ color: 'var(--fg)' }}>Testing</span> — switching it to{' '}
            <span style={{ color: 'var(--fg)' }}>In production</span> stops it.
          </span>
        ) : null}

        <div style={{ display: 'flex', flexDirection: 'column' }}>
          {rows.map(([k, v, color]) => (
            <div
              key={k}
              style={{
                display: 'flex',
                alignItems: 'baseline',
                justifyContent: 'space-between',
                gap: 10,
                padding: '7px 0',
                borderBottom: '1px solid var(--line)'
              }}
            >
              <span style={{ fontSize: 11, color: 'var(--faint)' }}>{k}</span>
              <span className="num" style={{ fontSize: 13, color: color ?? 'var(--fg)' }}>
                {v}
              </span>
            </div>
          ))}
        </div>

        {!expired ? (
          <div style={{ display: 'flex', gap: 8 }}>
            {[
              [status.pulledCount, 'PULLED'],
              [status.pushedCount, 'PUSHED'],
              [status.queuedCount, 'QUEUED']
            ].map(([n, t]) => (
              <div
                key={t as string}
                style={{
                  flexGrow: 1,
                  background: 'var(--bg)',
                  border: '1px solid var(--line)',
                  padding: '9px 0',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: 2
                }}
              >
                <span className="num" style={{ fontSize: 18 }}>
                  {n as number}
                </span>
                <span style={{ fontSize: 8.5, letterSpacing: '0.12em', color: 'var(--faint)' }}>
                  {t as string}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {status.recent.length > 0 ? (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <Label>Recent activity</Label>
            {status.recent.slice(0, 5).map((entry, i) => (
              <div key={`${entry.at}-${i}`} style={{ display: 'flex', gap: 9, alignItems: 'baseline' }}>
                <span
                  className="num"
                  style={{ fontSize: 10, color: 'var(--faint)', width: 36, flexShrink: 0 }}
                >
                  {clock(entry.at)}
                </span>
                <span
                  style={{
                    fontSize: 10.5,
                    lineHeight: 1.4,
                    textWrap: 'pretty',
                    color:
                      entry.level === 'error'
                        ? 'var(--bad)'
                        : entry.level === 'warn'
                          ? 'var(--gold)'
                          : 'var(--dim)'
                  }}
                >
                  {entry.message}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        <div style={{ display: 'flex', gap: 8 }}>
          {expired ? (
            <Button
              kind="solid"
              style={{ flexGrow: 1, textAlign: 'center' }}
              disabled={busy}
              onClick={() => {
                setBusy(true)
                onReconnect()
              }}
            >
              RECONNECT GOOGLE
            </Button>
          ) : (
            <Button
              kind="solid"
              style={{ flexGrow: 1, textAlign: 'center' }}
              disabled={busy || status.state === 'syncing'}
              onClick={() => {
                setBusy(true)
                onSyncNow()
                setTimeout(() => setBusy(false), 1200)
              }}
            >
              SYNC NOW
            </Button>
          )}
          <Button style={{ flexGrow: 1, textAlign: 'center' }} onClick={onSettings}>
            SETTINGS
          </Button>
        </div>
      </div>
    </div>
  )
}
