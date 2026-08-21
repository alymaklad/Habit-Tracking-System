import { join } from 'node:path'
import { writeFileSync } from 'node:fs'
import {
  app,
  BrowserWindow,
  Menu,
  Notification,
  nativeImage,
  powerMonitor,
  Tray,
  shell
} from 'electron'
import { PUSH_CHANNELS, type SyncStatus, type ToastMessage } from '@shared/types'
import { createContext, type AppContext } from './context'
import { registerIpc } from './ipc'

let win: BrowserWindow | null = null
let tray: Tray | null = null
let ctx: AppContext | null = null
let quitting = false

const isDev = !app.isPackaged

// Pin the name BEFORE anything reads `userData`. Launched unpackaged, Electron would
// otherwise fall back to "Electron" and put the database somewhere different from the
// packaged build — silently splitting a user's history across two files.
app.setName('Adaptive Habit League')

/** A single instance only — a second launch focuses the window already running. */
if (!app.requestSingleInstanceLock()) {
  app.quit()
}

// ------------------------------------------------------------------ tray

/** Draws the tray icon at runtime so the app ships without a binary asset. */
function trayIcon(): Electron.NativeImage {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">
    <path d="M16 2 29 9.5v15L16 32 3 24.5v-15Z" fill="#b07cff"/>
    <path d="M16 8.5c.7 2.9 2.6 4 3.7 5.7a6.6 6.6 0 1 1-10.3 2.1c0-2.6 1.8-4 2.6-5.7.7 1.1 1.3 1.6 2.2 2C13.9 12.3 14.6 10.3 16 8.5Z" fill="#141018"/>
  </svg>`
  return nativeImage.createFromDataURL(
    `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
  )
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

  tray.setToolTip(`Adaptive Habit League\n${score}\n${sync}`)

  tray.setContextMenu(
    Menu.buildFromTemplate([
      { label: score || 'Adaptive Habit League', enabled: false },
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
    backgroundColor: '#141018',
    autoHideMenuBar: true,
    title: 'Adaptive Habit League',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      // The renderer gets no Node access and no shared context with the preload's
      // privileged scope. Everything it can do goes through the exposed API.
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  })

  win.on('ready-to-show', () => win?.show())

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
    const ROUTES = ['Habits', 'Calendar', 'Progress', 'Performance', 'Achievements', 'Settings', 'Dashboard']
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
  const n = new Notification({ title, body, icon: trayIcon() })
  n.on('click', () => showWindow())
  n.show()
}

// ------------------------------------------------------------- lifecycle

app.on('second-instance', () => showWindow())

app.whenReady().then(() => {
  app.setAppUserModelId('com.adaptivehabitleague.app')

  ctx = createContext({
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

  ctx.bootstrap()
  registerIpc(ctx, () => {
    send(PUSH_CHANNELS.dashboard)
    updateTray()
  })

  createWindow()
  createTray()

  // Start syncing in the background. With no Google connection this still expands the
  // schedule and recomputes, because the app is fully usable offline.
  ctx.orchestrator.start()

  // Waking from sleep invalidates every armed timer and may have missed a sync window.
  powerMonitor.on('resume', () => {
    ctx?.reminders.rearm()
    ctx?.orchestrator.nudge('resume')
  })

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

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
