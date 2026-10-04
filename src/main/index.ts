import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import {
  app,
  BrowserWindow,
  Menu,
  Notification,
  nativeImage,
  net,
  powerMonitor,
  protocol,
  Tray,
  shell
} from 'electron'
import { PUSH_CHANNELS, type SyncStatus, type ToastMessage } from '@shared/types'
import { createContext, type AppContext } from './context'
import { registerIpc } from './ipc'
import iconPath from '../../resources/icon.png?asset'
import { pathToFileURL } from 'node:url'
import { ATTACHMENT_SCHEME } from './persistence/journalRepo'

/** Shown to the user. The internal app name stays put — it decides where the database lives. */
const BRAND = 'Khatwa'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let ctx: AppContext | null = null
let quitting = false

const isDev = !app.isPackaged

// Pin the name BEFORE anything reads `userData`. Launched unpackaged, Electron would
// otherwise fall back to "Electron" and put the database somewhere different from the
// packaged build — silently splitting a user's history across two files.
app.setName('Adaptive Habit League')

/**
 * A single instance only — a second launch focuses the window already running.
 *
 * `app.quit()` does NOT halt module execution, so everything below has to be guarded
 * on the lock. Without the guard a losing second instance carries on initialising:
 * it opens the same SQLite file and can put up a window and a tray icon before the
 * quit lands.
 */
const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) app.quit()

// ------------------------------------------------------------------ tray

const appIcon = nativeImage.createFromPath(iconPath)

function trayIcon(): Electron.NativeImage {
  return appIcon.resize({ width: 32, height: 32, quality: 'best' })
}

function updateTray(status?: SyncStatus): void {
  if (!tray) return
  const dash = ctx?.views.dashboard()
  const score = dash ? `${dash.dayPoints}/${dash.dayPointsMax} today` : ''
  const state = status?.state ?? 'disconnected'
  const sync =
    state === 'connected'
      ? 'Google connected'
      : state === 'needs_reauth'
        ? 'Google connection expired'
        : state === 'syncing'
          ? 'Syncing…'
          : state === 'offline'
            ? 'Offline — changes queued'
            : 'Not connected to Google'

  tray.setToolTip(`${BRAND}\n${score}\n${sync}`)

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: score || BRAND, enabled: false },
      { label: sync, enabled: false },
      { type: 'separator' },
      { label: 'Open dashboard', click: () => showWindow() },
      {
        label: 'Sync now',
        enabled: state !== 'syncing',
        click: () => void ctx?.orchestrator.runNow('manual')
      },
      { type: 'separator' },
      {
        label: 'Quit',
        click: () => {
          quitting = true
          app.quit()
        }
      }
    ])
  )
}

function createTray(): void {
  tray = new Tray(trayIcon())
  tray.on('click', () => showWindow())
  updateTray()
}

// ---------------------------------------------------------------- window

function showWindow(): void {
  if (!win) {
    createWindow()
    return
  }
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function createWindow(): void {
  win = new BrowserWindow({
    width: 1240,
    height: 860,
    minWidth: 1000,
    minHeight: 700,
    show: false,
    backgroundColor: '#FBF8F3',
    autoHideMenuBar: true,
    title: BRAND,
    icon: appIcon,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The renderer gets no Node access and no shared context with the preload's
      // privileged scope. Everything it can do goes through the exposed API.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  // Depending on how the process was launched, Windows can hand back a window that is
  // already iconic. `show()` on its own honours that state, so the app starts as a
  // taskbar button and never appears — restore explicitly before showing.
  win.on('ready-to-show', () => {
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  // Closing the window keeps the app alive in the tray so background sync continues.
  win.on('close', (event) => {
    if (quitting) return
    const minimise = ctx?.repos.settings.all().minimiseToTray ?? true
    if (minimise) {
      event.preventDefault()
      win?.hide()
    }
  })

  win.on('closed', () => {
    win = null
  })

  // A sync as soon as the user comes back to the window makes the dashboard feel live.
  win.on('focus', () => ctx?.orchestrator.nudge('focus'))

  // Never let the renderer navigate itself somewhere else, and send real links out to
  // the system browser rather than opening them in an Electron window.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (event, url) => {
    const dev = process.env.ELECTRON_RENDERER_URL
    if (dev && url.startsWith(dev)) return
    event.preventDefault()
  })

  // Surface renderer errors in the terminal during development, where they would
  // otherwise only appear in DevTools.
  if (isDev) {
    win.webContents.on('console-message', (event) => {
      if (event.level === 'error') console.error(`[renderer] ${event.message}`)
    })
    win.webContents.on('render-process-gone', (_e, details) => {
      console.error(`[renderer] process gone: ${details.reason}`)
    })
  }

  // Self-check hook: mount the UI, walk every screen, report what rendered, and exit.
  // Used by `npm run smoke:ui` to verify the renderer boots against the real IPC bridge.
  //
  // The navigation is driven from here rather than from one long async script in the
  // page: each step is a single synchronous expression, so a failure names the screen
  // that broke instead of leaving one promise pending forever.
  if (process.env.AHL_UI_CHECK) {
    const reportPath = process.env.AHL_UI_CHECK
    const ROUTES = ['Journey', 'Mountains', 'Me', 'Habits', 'To-do', 'Calendar', 'Progress', 'Weekly Review', 'Achievements', 'Let Go', 'Journal', 'Settings', 'Today']
    const pause = (ms: number) => new Promise((r) => setTimeout(r, ms))

    win.webContents.once('did-finish-load', () => {
      void (async () => {
        const wc = win?.webContents
        const visited: string[] = []
        const failures: string[] = []
        try {
          if (!wc) throw new Error('no webContents')
          await pause(1200)

          const base = (await wc.executeJavaScript(
            "(() => JSON.stringify({" +
              " mounted: !!document.getElementById('root') && document.getElementById('root').children.length > 0," +
              " hasApi: typeof window.api === 'object'," +
              " nav: [...document.querySelectorAll('nav button')].map((b) => b.innerText.split('\\n')[0]).filter(Boolean)" +
              " }))()"
          )) as string

          for (const name of ROUTES) {
            const clicked = (await wc.executeJavaScript(
              "(() => { const b = [...document.querySelectorAll('nav button')]" +
                ".find((x) => x.innerText.trim().startsWith(" +
                JSON.stringify(name) +
                ")); if (!b) return false; b.click(); return true })()"
            )) as boolean
            if (!clicked) { failures.push(name + ': no nav button'); continue }

            await pause(350)

            const body = (await wc.executeJavaScript(
              "(() => { const m = document.querySelector('main'); return m ? m.innerText.trim().length : -1 })()"
            )) as number
            if (body > 0) visited.push(name)
            else failures.push(name + ': rendered empty')
          }

          writeFileSync(
            reportPath,
            JSON.stringify({ ...JSON.parse(base), visited, failures }),
            'utf8'
          )
        } catch (err) {
          writeFileSync(reportPath, JSON.stringify({ error: String(err), visited, failures }), 'utf8')
        }
        quitting = true
        app.quit()
      })()
    })
  }

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// ------------------------------------------------------------- messaging

function send(channel: string, payload?: unknown): void {
  if (win && !win.isDestroyed()) win.webContents.send(channel, payload)
}

function nativeToast(title: string, body: string): void {
  if (!Notification.isSupported()) return
  const n = new Notification({ title, body, icon: appIcon })
  n.on('click', () => showWindow())
  n.show()
}

// ------------------------------------------------------------- lifecycle

app.on('second-instance', () => showWindow())

// Journal attachments are served from their own folder through a private scheme, so the
// renderer's strict CSP can allow exactly that and nothing else from disk.
protocol.registerSchemesAsPrivileged([{ scheme: ATTACHMENT_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }])

if (gotSingleInstanceLock) void start()

async function start(): Promise<void> {
  await app.whenReady()
  app.setAppUserModelId('com.adaptivehabitleague.app')

  protocol.handle(ATTACHMENT_SCHEME, (req) => {
    const url = new URL(req.url)
    const path = url.hostname === 'attachment' ? ctx?.reflect.storedFilePath(decodeURIComponent(url.pathname.replace(/^\//, ''))) : null
    if (!path) return new Response('Not found', { status: 404 })
    return net.fetch(pathToFileURL(path).toString())
  })

  /**
   * Startup failures must never cost the user their window.
   *
   * Previously a throw anywhere in here skipped `createWindow()` entirely, leaving the
   * process alive with no window and no tray — and holding the single-instance lock, so
   * the app was unreachable and every relaunch appeared to do nothing. The window is now
   * created whatever happens, and the failure is reported into it.
   */
  let startupError: string | null = null

  try {
    ctx = buildContext()
  } catch (err) {
    startupError = `The database could not be opened: ${err instanceof Error ? err.message : String(err)}`
  }

  if (ctx) {
    const now = new Date()
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    ctx.backupDaily(today).catch((err: unknown) => console.error('[startup] daily backup', err))

    try {
      ctx.reflect.sweepAttachments()
    } catch (err) {
      console.error('[startup] attachment sweep', err)
    }

    try {
      ctx.bootstrap()
    } catch (err) {
      startupError = `Startup did not finish: ${err instanceof Error ? err.message : String(err)}`
      console.error('[startup]', err)
    }

    // Under the self-check, seed a habit and complete it so every screen renders its
    // POPULATED state. Without this the check only ever exercised empty states, which is
    // how a screen could pass while being blank with real data. The profile is a
    // throwaway directory, so nothing here touches a real database.
    if (process.env.AHL_UI_CHECK) {
      try {
        ctx.habits.create({
          name: 'Check Habit',
          description: null,
          notes: null,
          recurrence: { kind: 'weekly', days: [1, 2, 3, 4, 5, 6, 7] },
          scheduledTime: '09:00',
          targetMinutes: 60,
          baselineMinutes: 60,
          difficultyLevel: 2,
          reminderLeadMinutes: 30,
          colorKey: 'violet',
          googleTasklistId: null,
          goalId: null,
          active: true
        })
        const card = ctx.views.dashboard().cards[0]
        if (card) {
          // A step plus a manual item, so the to-do screen renders populated too.
          ctx.todos.addSubtask(card.occurrenceId, 'Check step')
          ctx.todos.addManual('Check task')
          ctx.habits.setCompleted(card.occurrenceId, true)
        }
      } catch (err) {
        console.error(`[ui-check] seeding failed: ${String(err)}`)
      }
    }

    try {
      registerIpc(
        ctx,
        () => {
          send(PUSH_CHANNELS.dashboard)
          updateTray()
        },
        send
      )
    } catch (err) {
      startupError = `The app could not start: ${err instanceof Error ? err.message : String(err)}`
    }
  }

  createWindow()
  createTray()

  if (startupError) {
    // The renderer subscribes on mount, so wait for it before reporting.
    win?.webContents.once('did-finish-load', () => {
      send(PUSH_CHANNELS.toast, {
        kind: 'error',
        title: 'Something went wrong starting up',
        body: startupError
      } satisfies ToastMessage)
    })
  } else {
    // Start syncing in the background. With no Google connection this still expands the
    // schedule and recomputes, because the app is fully usable offline.
    ctx?.orchestrator.start()
  }

  // Waking from sleep invalidates every armed timer and may have missed a sync window.
  powerMonitor.on('resume', () => {
    ctx?.reminders.rearm()
    ctx?.orchestrator.nudge('resume')
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
}

function buildContext(): AppContext {
  return createContext({
    dbPath: join(app.getPath('userData'), 'habits.db'),
    toast: nativeToast,
    onSyncStatus: (status: SyncStatus) => {
      send(PUSH_CHANNELS.syncStatus, status)
      updateTray(status)
    },
    onToast: (message: ToastMessage) => send(PUSH_CHANNELS.toast, message),
    onDataChanged: () => {
      send(PUSH_CHANNELS.dashboard)
      updateTray()
    }
  })

}

app.on('before-quit', () => {
  quitting = true
})

app.on('window-all-closed', () => {
  // Deliberately does NOT quit on Windows: the tray keeps background sync running.
  if (process.platform === 'darwin') return
})

app.on('will-quit', () => {
  ctx?.dispose()
  ctx = null
  tray?.destroy()
  tray = null
})
