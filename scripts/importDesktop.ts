/**
 * Moves the Windows app's data into a Khatwa account on Neon — once, into an empty account.
 *
 *   npm run import:desktop -- --email you@example.com [--db "%APPDATA%\Khatwa\habits.db"]
 *
 * Needs DATABASE_URL (Neon), APP_SECRET, and BLOB_READ_WRITE_TOKEN if the journal has
 * attachments. Sign in to the web app once first, so the account exists.
 *
 * Copied: every habit, day, timer, score, to-do, goal, let-go, journal entry (with its
 * files), tool, achievement and setting. Not copied: the Google connection (its tokens
 * were sealed by Windows for that PC — link Google again in Settings) and pasted AI keys.
 */
import { existsSync, readFileSync } from 'node:fs'
import { join, dirname, resolve } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { put } from '@vercel/blob'
import { createDb, quoteIdent, useSchema, type SqlDriver } from '../src/server/persistence/db'
import { databaseUrl, neonDriver } from '../src/server/persistence/neon'

const root = resolve(import.meta.dirname, '..')
for (const file of ['.env.local', '.env']) if (existsSync(join(root, file))) process.loadEnvFile(join(root, file))

const arg = (name: string): string | null => {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? (process.argv[i + 1] ?? null) : null
}

const email = arg('email')
const dbPath = arg('db') ?? join(process.env.APPDATA ?? '', 'Khatwa', 'habits.db')
if (!email) throw new Error('Pass --email with the address you sign in to Khatwa with.')
if (!existsSync(dbPath)) throw new Error(`No desktop database at ${dbPath}. Pass --db with its path.`)

// Parents before children, so foreign keys hold at every step.
const TABLES = [
  'goal',
  'habit',
  'occurrence',
  'time_log',
  'daily_record',
  'weekly_record',
  'difficulty_proposal',
  'user_achievement',
  'personal_record',
  'todo',
  'habit_subtask_template',
  'letgo',
  'letgo_checkin',
  'journal_entry',
  'attachment',
  'tool',
  'settings'
]

// Settings that belonged to that PC, not to the person.
const SKIP_SETTINGS = /^flag:(accountSession|aiKey:|anthropicApiKey|googleTasklist|calendarMirror|syncRuntime|bootstrapped)/

const source = new DatabaseSync(dbPath, { readOnly: true })
const driver = process.argv.includes('--local') ? await localDriver() : await neonDriver(databaseUrl())

/** `--local`: the dev server's PGlite under .data/, for a dry run before touching Neon. */
async function localDriver(): Promise<SqlDriver> {
  const { PGlite } = await import('@electric-sql/pglite')
  const pg = new PGlite(join(root, '.data/pglite'), { parsers: { 20: Number, 1700: Number } })
  return {
    query: async (text, params) => {
      const r = await pg.query<Record<string, unknown>>(text, params)
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }
    },
    exec: async (text) => void (await pg.exec(text)),
    close: () => pg.close()
  }
}
try {
  const account = await driver.query('SELECT schema_name FROM public.khatwa_account WHERE lower(email) = lower($1)', [email])
  const schema = account.rows[0]?.schema_name as string | undefined
  if (!schema) throw new Error(`No Khatwa account for ${email} yet. Sign in to the web app once, then run this again.`)

  await useSchema(driver, schema)
  const db = createDb(driver)
  for (const table of TABLES.filter((t) => t !== 'settings')) {
    const existing = (await db.prepare(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`).get()) as { n: number }
    if (existing.n > 0) throw new Error(`The account for ${email} already has data (${table}). Import only into a fresh account.`)
  }

  await db.transaction(async () => {
    for (const table of TABLES) {
      let rows = source.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[]
      if (table === 'settings') rows = rows.filter((r) => !SKIP_SETTINGS.test(String(r.key)))
      // The Google link does not travel: drop task and event ids so the account starts clean.
      if (table === 'occurrence') {
        rows = rows.map((r) => ({ ...r, google_task_id: null, google_event_id: null, etag: null, event_etag: null, provision_state: 'none', created_by_app: 0 }))
      }
      if (table === 'habit') rows = rows.map((r) => ({ ...r, google_tasklist_id: null }))
      for (const row of rows) {
        const cols = Object.keys(row)
        await driver.query(
          `INSERT INTO ${quoteIdent(table)} (${cols.map(quoteIdent).join(', ')}) VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})` +
            // Signing in already wrote a few defaults; the desktop's own settings win.
            (table === 'settings' ? ' ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value' : ''),
          cols.map((c) => row[c] ?? null)
        )
      }
      // Identity columns must continue after the copied ids.
      const hasId = (source.prepare(`SELECT COUNT(*) AS n FROM pragma_table_info('${table}') WHERE name = 'id'`).get() as { n: number }).n > 0
      if (hasId && rows.length > 0) {
        await driver.query(
          `SELECT setval(pg_get_serial_sequence($1, 'id'), (SELECT MAX(id) FROM ${quoteIdent(table)}))`,
          [`${quoteIdent(schema)}.${quoteIdent(table)}`]
        )
      }
      console.log(`${table.padEnd(24)} ${rows.length}`)
    }
  })

  // Journal files, into this account's private folder.
  const files = source.prepare('SELECT stored_name, mime FROM attachment').all() as { stored_name: string; mime: string }[]
  if (files.length > 0) {
    if (!process.env.BLOB_READ_WRITE_TOKEN) {
      console.warn(`\n${files.length} journal file(s) not uploaded: set BLOB_READ_WRITE_TOKEN and run again on a fresh account.`)
    } else {
      const dir = join(dirname(dbPath), 'attachments')
      for (const f of files) {
        const path = join(dir, f.stored_name)
        if (!existsSync(path)) continue
        await put(`${schema}/${f.stored_name}`, readFileSync(path), { access: 'private', contentType: f.mime, addRandomSuffix: false })
      }
      console.log(`attachment files           ${files.length}`)
    }
  }
  console.log(`\nDone. Open Khatwa, then link Google again in Settings if you used it.`)
} finally {
  source.close()
  await driver.close()
}
