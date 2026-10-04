import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { MIGRATIONS } from './migrations'

export type Db = Database.Database

/**
 * Opens the database and brings it up to the current schema.
 *
 * WAL keeps the background sync writing while the UI reads. `foreign_keys` is off by
 * default in SQLite and has to be asked for on every connection.
 *
 * A damaged file is refused before anything is written to it, and whatever the journal
 * still holds from last time is folded into the main file straight away: until that
 * happens, the only copy of those changes is the `-wal` file.
 */
export function openDatabase(file: string): Db {
  const db = new Database(file)
  try {
    const check = db.pragma('quick_check', { simple: true })
    if (check !== 'ok') throw new Error(String(check))
  } catch (err) {
    db.close()
    throw new Error(
      `The database file is damaged (${err instanceof Error ? err.message : String(err)}). Nothing was written to it. ` +
        'Restore a copy from the backups folder next to it.'
    )
  }
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  checkpoint(db)
  migrate(db)
  return db
}

/** Folds the journal into the main file, then closes; the database is whole on disk afterwards. */
export function closeDatabase(db: Db): void {
  if (!db.open) return
  checkpoint(db)
  db.close()
}

/** Best effort: a checkpoint that cannot run now leaves the journal for the next one. */
function checkpoint(db: Db): void {
  try {
    db.pragma('wal_checkpoint(TRUNCATE)')
  } catch (err) {
    console.warn('[db] checkpoint skipped:', err instanceof Error ? err.message : err)
  }
}

/**
 * One consistent copy a day, taken with SQLite's online backup (safe while the app is
 * writing), keeping the newest `keep`. Returns the path written, or null when today's
 * copy already exists.
 */
export async function dailyBackup(db: Db, dir: string, date: string, keep = 7): Promise<string | null> {
  mkdirSync(dir, { recursive: true })
  const target = join(dir, `habits-${date}.db`)
  if (existsSync(target)) return null
  await db.backup(target)
  const copies = readdirSync(dir)
    .filter((f) => /^habits-\d{4}-\d{2}-\d{2}\.db$/.test(f))
    .sort()
  for (const old of copies.slice(0, Math.max(0, copies.length - keep))) rmSync(join(dir, old), { force: true })
  return target
}

export function migrate(db: Db): void {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`)

  const applied = new Set(
    db.prepare('SELECT id FROM schema_migration').all().map((r) => (r as { id: number }).id)
  )

  const record = db.prepare(
    'INSERT INTO schema_migration (id, name, applied_at) VALUES (?, ?, ?)'
  )

  for (const m of MIGRATIONS) {
    if (applied.has(m.id)) continue
    // Each migration is one transaction: a failure leaves the schema untouched.
    db.transaction(() => {
      db.exec(m.sql)
      record.run(m.id, m.name, new Date().toISOString())
    })()
  }
}

/** Wrap a unit of work in a transaction. Nested calls reuse the outer transaction. */
export function tx<T>(db: Db, fn: () => T): T {
  if (db.inTransaction) return fn()
  return db.transaction(fn)()
}

export const boolToInt = (b: boolean): number => (b ? 1 : 0)
export const intToBool = (n: number | null | undefined): boolean => n === 1
