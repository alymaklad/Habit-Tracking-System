/**
 * End-to-end smoke test in the real Electron runtime.
 *
 * The unit and integration suites run headless under vitest with better-sqlite3 loaded
 * by Node. This exercises the same stack the shipped app uses: Electron's Node, the
 * native module compiled for it, DPAPI-backed safeStorage, and the full context graph.
 *
 * Run: npm run smoke
 */
const { app } = require('electron')
const { join } = require('node:path')
const { rmSync } = require('node:fs')
const { tmpdir } = require('node:os')

const checks = []
const check = (name, fn) => {
  try {
    const detail = fn()
    checks.push({ name, ok: true, detail })
  } catch (err) {
    checks.push({ name, ok: false, detail: err.message })
  }
}
const eq = (actual, expected, label) => {
  if (actual !== expected) throw new Error(`${label}: expected ${expected}, got ${actual}`)
  return `${label} = ${actual}`
}

app.setName('Khatwa Smoke')

app.whenReady().then(async () => {
  const dbPath = join(tmpdir(), `khatwa-smoke-${Date.now()}.db`)
  const toasts = []

  // The context is built as its own entry so it can be required without triggering the
  // window and tray lifecycle that `index.js` owns.
  const { createContext } = require('../out/main/context.js')

  const ctx = createContext({
    dbPath,
    toast: (title, body) => toasts.push(`${title}: ${body}`),
    onSyncStatus: () => {},
    onToast: () => {},
    onDataChanged: () => {}
  })

  try {
    // 1. Boot: schema, settings, schedule expansion.
    ctx.bootstrap()
    check('database opens and migrates', () =>
      eq(ctx.repos.settings.all().syncIntervalMinutes, 5, 'sync interval default')
    )

    check('safeStorage encryption available', () => {
      const { safeStorage } = require('electron')
      if (!safeStorage.isEncryptionAvailable()) throw new Error('DPAPI unavailable')
      const round = safeStorage.decryptString(safeStorage.encryptString('token-abc'))
      return eq(round, 'token-abc', 'encrypt/decrypt round trip')
    })

    // 2. Create a habit that runs every day, so today always has an occurrence.
    const habit = ctx.habits.create({
      name: 'Study AI',
      description: null,
      notes: null,
      recurrence: { kind: 'weekly', days: [1, 2, 3, 4, 5, 6, 7] },
      scheduledTime: '18:00',
      targetMinutes: 120,
      baselineMinutes: 120,
      difficultyLevel: 3,
      reminderLeadMinutes: 30,
      colorKey: 'violet',
      googleTasklistId: null,
      active: true
    })
    check('habit created', () => eq(habit.name, 'Study AI', 'habit name'))

    // 3. Today's dashboard should now show it.
    let dash = ctx.views.dashboard()
    check('dashboard lists today’s habit', () => eq(dash.cards.length, 1, 'card count'))
    check('card starts not-started', () => eq(dash.cards[0].status, 'pending', 'status'))

    const occurrenceId = dash.cards[0].occurrenceId

    // 4. Run the timer for a partial session.
    const start = new Date()
    ctx.habits.startTimer(occurrenceId, start)
    ctx.habits.stopTimer(occurrenceId, new Date(start.getTime() + 40 * 60_000))

    dash = ctx.views.dashboard()
    check('partial session scores partial', () => eq(dash.cards[0].status, 'partial', 'status'))
    check('measured minutes recorded', () => eq(dash.cards[0].loggedMinutes, 40, 'minutes'))
    check('provenance is the timer', () => eq(dash.cards[0].origin, 'timer', 'origin'))

    // 5. Complete it outright.
    ctx.habits.setCompleted(occurrenceId, true)
    dash = ctx.views.dashboard()
    check('completion scores full', () => eq(dash.cards[0].status, 'complete', 'status'))
    check('XP awarded', () => {
      if (dash.level.currentXp <= 0) throw new Error('no XP awarded')
      return `total XP = ${dash.level.currentXp}`
    })
    const xpAfterFirst = dash.level.currentXp

    // 6. Idempotency: recomputing must not change a thing.
    for (let i = 0; i < 5; i++) {
      const horizon = ctx.schedule.horizon()
      ctx.engine.refresh(horizon.from, horizon.to)
    }
    dash = ctx.views.dashboard()
    check('five recomputes award no extra XP', () => eq(dash.level.currentXp, xpAfterFirst, 'XP'))

    // 7. Revert: un-completing must take the points back.
    ctx.habits.setCompleted(occurrenceId, false)
    dash = ctx.views.dashboard()
    check('revert restores partial from measured time', () =>
      eq(dash.cards[0].status, 'partial', 'status')
    )
    check('revert keeps the 40 measured minutes', () =>
      eq(dash.cards[0].loggedMinutes, 40, 'minutes')
    )

    // 8. Offline behaviour: a sync with no Google connection still works.
    const status = await ctx.orchestrator.runNow('manual')
    check('sync runs offline without Google', () => eq(status.state, 'disconnected', 'state'))
    check('schedule still expands offline', () => {
      const horizon = ctx.schedule.horizon()
      const rows = ctx.repos.occurrences.listInRange(horizon.from, horizon.to)
      if (rows.length < 7) throw new Error(`only ${rows.length} occurrences`)
      return `${rows.length} occurrences over the horizon`
    })

    // 9. Notifications fan out to the desktop channel.
    await ctx.notifications.streakAlive(3)
    check('notification reaches the toast channel', () => {
      if (toasts.length === 0) throw new Error('no toast fired')
      return toasts[0]
    })

    // 10. Reminders arm from the database.
    check('reminders arm', () => {
      const n = ctx.reminders.rearm()
      if (n < 1) throw new Error('no reminders armed')
      return `${n} armed`
    })

    // 11. Views used by every other screen resolve without throwing.
    check('progress view builds', () => `${ctx.views.progress(8).hoursPerWeek.length} weeks`)
    check('achievements view builds', () => `${ctx.views.achievements().length} achievements`)
    check('personal records view builds', () => `${ctx.views.personalRecords().length} records`)
    check('calendar month view builds', () => `${ctx.views.calendarMonth(dash.date).length} cells`)
  } finally {
    if (ctx) ctx.dispose()
    try {
      rmSync(dbPath, { force: true })
      rmSync(`${dbPath}-wal`, { force: true })
      rmSync(`${dbPath}-shm`, { force: true })
    } catch {
      /* best effort */
    }
  }

  const failed = checks.filter((c) => !c.ok)
  for (const c of checks) {
    console.log(`${c.ok ? 'PASS' : 'FAIL'}  ${c.name}${c.detail ? `  (${c.detail})` : ''}`)
  }
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`)
  process.exit(failed.length === 0 ? 0 : 1)
})
