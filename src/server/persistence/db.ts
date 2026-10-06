import { AsyncLocalStorage } from 'node:async_hooks'
import { MIGRATIONS } from './migrations'

/**
 * The one door to Postgres.
 *
 * Repositories keep the shape they had on SQLite — `db.prepare(sql).get/all/run` — but
 * every call now returns a promise. The SQL itself keeps SQLite's `?` and `@name`
 * placeholders; they are rewritten to Postgres' `$n` once per statement and cached.
 *
 * Each account's data lives in its own Postgres schema, selected with `search_path` on
 * the connection the request holds. No query names a schema or filters by user, so a
 * query cannot forget to: isolation is a property of the connection, not of the SQL.
 */

/** A driver: Neon in production, PGlite in tests. Both speak `$n` placeholders. */
export interface SqlDriver {
  query(text: string, params: unknown[]): Promise<{ rows: Record<string, unknown>[]; rowCount: number | null }>
  /** Several statements in one string, no parameters (migrations). */
  exec(text: string): Promise<void>
  close(): Promise<void>
}

export interface RunResult {
  changes: number
  /** The `id` the statement returned; ask for it with `RETURNING id`. */
  lastInsertRowid: number
  rows: Record<string, unknown>[]
}

export interface Statement {
  get(...params: unknown[]): Promise<unknown>
  all(...params: unknown[]): Promise<unknown[]>
  run(...params: unknown[]): Promise<RunResult>
}

export interface Db {
  prepare(sql: string): Statement
  exec(sql: string): Promise<void>
  /** Runs `fn` in a transaction. Nested calls join the outer one. */
  transaction<T>(fn: () => Promise<T>): Promise<T>
  close(): Promise<void>
}

// ------------------------------------------------------------ placeholders

interface Compiled {
  text: string
  /** Positional statements bind arguments in order; named ones bind from one object. */
  names: string[] | null
}

const compiled = new Map<string, Compiled>()

/**
 * `?` → `$1, $2…`, and `@name` → `$n` (the same name reuses its number). String literals,
 * quoted identifiers and comments are copied untouched.
 */
export function compile(sql: string): Compiled {
  const hit = compiled.get(sql)
  if (hit) return hit

  let out = ''
  let positional = 0
  const names: string[] = []
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i]!
    if (c === "'" || c === '"') {
      const end = sql.indexOf(c, i + 1)
      const stop = end === -1 ? sql.length : end + 1
      out += sql.slice(i, stop)
      i = stop - 1
    } else if (c === '-' && sql[i + 1] === '-') {
      const end = sql.indexOf('\n', i)
      const stop = end === -1 ? sql.length : end
      out += sql.slice(i, stop)
      i = stop - 1
    } else if (c === '?') {
      out += `$${++positional}`
    } else if (c === '@' && /[a-z_]/i.test(sql[i + 1] ?? '')) {
      const m = /^[a-z_][a-z0-9_]*/i.exec(sql.slice(i + 1))!
      const name = m[0]
      let n = names.indexOf(name)
      if (n === -1) n = names.push(name) - 1
      out += `$${n + 1}`
      i += name.length
    } else {
      out += c
    }
  }
  if (positional > 0 && names.length > 0) throw new Error('A statement cannot mix ? and @name placeholders')
  const result: Compiled = { text: out, names: names.length ? names : null }
  compiled.set(sql, result)
  return result
}

function bind(c: Compiled, args: unknown[]): unknown[] {
  if (!c.names) return args.map(normalise)
  const obj = (args[0] ?? {}) as Record<string, unknown>
  return c.names.map((n) => {
    if (!(n in obj)) throw new Error(`Missing value for @${n}`)
    return normalise(obj[n])
  })
}

/** SQLite took `undefined` as an error and booleans not at all; keep values Postgres-safe. */
function normalise(v: unknown): unknown {
  if (v === undefined) return null
  if (typeof v === 'boolean') return v ? 1 : 0
  return v
}

// ---------------------------------------------------------------- database

/**
 * Wraps a driver. A transaction claims the connection for its duration; work started
 * inside it (directly or through awaited helpers) is recognised via async context, so
 * nested `transaction` calls simply join it.
 */
export function createDb(driver: SqlDriver): Db {
  const inTx = new AsyncLocalStorage<boolean>()

  async function query(sql: string, args: unknown[]) {
    const c = compile(sql)
    return driver.query(c.text, bind(c, args))
  }

  return {
    prepare(sql: string): Statement {
      return {
        async get(...args) {
          return (await query(sql, args)).rows[0]
        },
        async all(...args) {
          return (await query(sql, args)).rows
        },
        async run(...args) {
          const r = await query(sql, args)
          const id = r.rows[0]?.id
          return { changes: r.rowCount ?? 0, lastInsertRowid: typeof id === 'number' ? id : Number(id ?? 0), rows: r.rows }
        }
      }
    },

    exec: (sql) => driver.exec(sql),

    async transaction<T>(fn: () => Promise<T>): Promise<T> {
      if (inTx.getStore()) return fn()
      await driver.query('BEGIN', [])
      try {
        const result = await inTx.run(true, fn)
        await driver.query('COMMIT', [])
        return result
      } catch (err) {
        await driver.query('ROLLBACK', []).catch(() => undefined)
        throw err
      }
    },

    close: () => driver.close()
  }
}

// -------------------------------------------------------------- migrations

/** A schema name for an account. Auth user ids are opaque strings; keep only safe characters. */
export function schemaFor(userId: string): string {
  const safe = userId.toLowerCase().replace(/[^a-z0-9]/g, '')
  if (!safe) throw new Error('Invalid account id')
  return `u_${safe}`.slice(0, 63)
}

export const quoteIdent = (name: string): string => `"${name.replace(/"/g, '""')}"`

/**
 * Creates the schema if needed, points the connection at it, and brings it up to date.
 * Each migration runs in its own transaction; an advisory lock keeps two cold starts
 * from migrating the same schema at once.
 */
export async function useSchema(driver: SqlDriver, schema: string): Promise<void> {
  const q = quoteIdent(schema)
  await driver.exec(`CREATE SCHEMA IF NOT EXISTS ${q}; SET search_path TO ${q}`)
  await driver.exec(`CREATE TABLE IF NOT EXISTS schema_migration (
    id         INTEGER PRIMARY KEY,
    name       TEXT NOT NULL,
    applied_at TEXT NOT NULL
  )`)
  const latest = MIGRATIONS[MIGRATIONS.length - 1]!.id
  const done = await driver.query('SELECT COALESCE(MAX(id), 0) AS id FROM schema_migration', [])
  if (Number(done.rows[0]?.id ?? 0) >= latest) return

  await driver.query('SELECT pg_advisory_lock(hashtext($1))', [schema])
  try {
    const applied = new Set(
      (await driver.query('SELECT id FROM schema_migration', [])).rows.map((r) => Number(r.id))
    )
    for (const m of MIGRATIONS) {
      if (applied.has(m.id)) continue
      await driver.query('BEGIN', [])
      try {
        await driver.exec(m.sql)
        await driver.query('INSERT INTO schema_migration (id, name, applied_at) VALUES ($1, $2, $3)', [
          m.id,
          m.name,
          new Date().toISOString()
        ])
        await driver.query('COMMIT', [])
      } catch (err) {
        await driver.query('ROLLBACK', []).catch(() => undefined)
        throw err
      }
    }
  } finally {
    await driver.query('SELECT pg_advisory_unlock(hashtext($1))', [schema])
  }
}

export const boolToInt = (b: boolean): number => (b ? 1 : 0)
export const intToBool = (n: number | null | undefined): boolean => n === 1
