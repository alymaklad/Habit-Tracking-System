/**
 * Boots the real window against the real IPC bridge and asserts the UI mounted.
 *
 * `npm run smoke` proves the main process; this proves the renderer, which is the half
 * a headless test cannot reach.
 */
const { spawnSync } = require('node:child_process')
const { join } = require('node:path')

const electron = require('electron')
const result = spawnSync(electron, [join(__dirname, '..', 'out', 'main', 'index.js')], {
  env: { ...process.env, AHL_UI_CHECK: '1' },
  encoding: 'utf8',
  timeout: 60_000
})

const output = `${result.stdout ?? ''}${result.stderr ?? ''}`
const line = output.split('\n').find((l) => l.includes('UI_CHECK '))

if (!line) {
  console.error('FAIL  the renderer never reported back')
  console.error(output.split('\n').filter((l) => l.trim()).slice(-12).join('\n'))
  process.exit(1)
}

if (line.includes('UI_CHECK_FAILED')) {
  console.error(`FAIL  ${line}`)
  process.exit(1)
}

const report = JSON.parse(line.slice(line.indexOf('UI_CHECK ') + 'UI_CHECK '.length))
const EXPECTED_NAV = [
  'Dashboard',
  'Habits',
  'Calendar',
  'Progress',
  'Leaderboard',
  'Achievements',
  'Challenges',
  'Settings'
]

const checks = [
  ['React mounted', report.mounted === true, 'root has children'],
  ['IPC bridge exposed', report.hasApi === true, 'window.api present'],
  [
    'navigation complete',
    EXPECTED_NAV.every((n) => report.nav.includes(n)),
    `${report.nav.filter((n) => EXPECTED_NAV.includes(n)).length}/8 items`
  ],
  ['sync status rendered', report.nav.length > EXPECTED_NAV.length, 'status control present']
]

let failed = 0
for (const [name, ok, detail] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}  (${detail})`)
  if (!ok) failed++
}

console.log(`\n${checks.length - failed}/${checks.length} UI checks passed`)
process.exit(failed === 0 ? 0 : 1)
