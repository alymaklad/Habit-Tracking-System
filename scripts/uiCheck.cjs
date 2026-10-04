/**
 * Boots the real window against the real IPC bridge and asserts the UI mounted.
 *
 * `npm run smoke` proves the main process; this proves the renderer, which is the half
 * a headless test cannot reach.
 */
const { spawnSync } = require('node:child_process')
const { join } = require('node:path')
const { existsSync, readFileSync, rmSync } = require('node:fs')
const { tmpdir } = require('node:os')

const stamp = Date.now()
const reportPath = join(tmpdir(), `ahl-ui-check-${stamp}.json`)
// An isolated profile, for two reasons: the check must never read or write the real
// habits database, and a separate userData directory gets its own single-instance
// lock — otherwise this silently exits the moment the app is already open.
const profileDir = join(tmpdir(), `ahl-ui-profile-${stamp}`)

const electron = require('electron')

const result = spawnSync(
  electron,
  [join(__dirname, '..', 'out', 'main', 'index.js'), `--user-data-dir=${profileDir}`],
  {
    env: { ...process.env, AHL_UI_CHECK: reportPath },
    encoding: 'utf8',
    timeout: 90_000
  }
)

const cleanup = () => {
  rmSync(reportPath, { force: true })
  rmSync(profileDir, { recursive: true, force: true })
}

if (!existsSync(reportPath)) {
  console.error('FAIL  the renderer never reported back')
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
  const tail = output.split('\n').filter((l) => l.trim()).slice(-12).join('\n')
  if (tail) console.error(tail)
  if (result.status === 0 && !tail) {
    console.error(
      '      The app exited immediately with no output. If a copy is already running,\n' +
        '      close it and try again — though the isolated profile should prevent that.'
    )
  }
  cleanup()
  process.exit(1)
}

const report = JSON.parse(readFileSync(reportPath, 'utf8'))
cleanup()

if (report.error) {
  console.error(`FAIL  the probe threw: ${report.error}`)
  process.exit(1)
}
const EXPECTED_NAV = [
  'Today',
  'Journey',
  'Mountains',
  'Me',
  'Habits',
  'To-do',
  'Calendar',
  'Progress',
  'Weekly Review',
  'Achievements',
  'Let Go',
  'Journal',
  'Settings'
]

const EXPECTED_ROUTES = [
  'Journey',
  'Mountains',
  'Me',
  'Habits',
  'To-do',
  'Calendar',
  'Progress',
  'Weekly Review',
  'Achievements',
  'Let Go',
  'Journal',
  'Settings',
  'Today'
]

const checks = [
  ['React mounted', report.mounted === true, 'root has children'],
  ['IPC bridge exposed', report.hasApi === true, 'window.api present'],
  [
    'navigation complete',
    EXPECTED_NAV.every((n) => report.nav.includes(n)),
    `${report.nav.filter((n) => EXPECTED_NAV.includes(n)).length}/${EXPECTED_NAV.length} items`
  ],
  ['sync status rendered', report.nav.length > EXPECTED_NAV.length, 'status control present'],
  [
    'every screen renders with data',
    EXPECTED_ROUTES.every((r) => report.visited.includes(r)) && report.failures.length === 0,
    report.failures.length > 0
      ? report.failures.join('; ')
      : `${report.visited.length}/${EXPECTED_ROUTES.length} screens`
  ]
]

let failed = 0
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`)
  if (!ok) failed++
}

console.log(`\n${checks.length - failed}/${checks.length} UI checks passed`)
process.exit(failed === 0 ? 0 : 1)
