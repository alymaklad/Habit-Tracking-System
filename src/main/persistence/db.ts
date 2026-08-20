import Database from 'better-sqlite3'
import { MIGRATIONS } from './migrations'

export type Db = Database.Database

/**
 * Opens the database and brings it up to the current schema.
 *
 * WAL keeps the background sync writing while the UI reads. `foreign_keys` is off by
 * default in SQLite and has to be asked for on every connection.
 */
export function openDatabase(file: string): Db {
  const db = new Database(file)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  db.pragma('busy_timeout = 5000')
  migrate(db)
  return db
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
