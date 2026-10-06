import { createDb, schemaFor, useSchema, type Db, type SqlDriver } from '../persistence/db'
import { databaseUrl, neonDriver } from '../persistence/neon'

/**
 * Connections for the HTTP layer. Every request opens one session, points it at the
 * account's schema, and closes it when the response is done.
 *
 * Two small tables live in `public`, outside every account:
 *  - `khatwa_account` lists the accounts, so the daily cron knows whose schema to visit;
 *  - `khatwa_rate` counts AI drafts per caller, so a public URL cannot run up the bill.
 */

const PUBLIC_SQL = `
CREATE TABLE IF NOT EXISTS public.khatwa_account (
  user_id      TEXT PRIMARY KEY,
  schema_name  TEXT NOT NULL UNIQUE,
  email        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS public.khatwa_rate (
  key          TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  count        INTEGER NOT NULL
);`

/** Only the schema guests plan in. Always empty, and opened read-only. */
export const GUEST_SCHEMA = 'khatwa_guest'

type DriverFactory = () => Promise<SqlDriver>
let factory: DriverFactory = () => neonDriver(databaseUrl())
let publicReady: Promise<void> | null = null

/** Tests swap in PGlite. */
export function setDriverFactory(f: DriverFactory): void {
  factory = f
  publicReady = null
}

async function connect(): Promise<SqlDriver> {
  const driver = await factory()
  if (!publicReady) {
    publicReady = driver.exec(PUBLIC_SQL).catch((err: unknown) => {
      publicReady = null
      throw err
    })
  }
  await publicReady
  return driver
}

export interface Connection {
  db: Db
  driver: SqlDriver
  schema: string
}

/** Runs `fn` with a connection on the signed-in account's schema, recording the visit. */
export async function withAccount<T>(user: { id: string; email: string }, fn: (c: Connection) => Promise<T>): Promise<T> {
  const driver = await connect()
  try {
    const schema = schemaFor(user.id)
    await driver.query(
      `INSERT INTO public.khatwa_account (user_id, schema_name, email) VALUES ($1, $2, $3)
       ON CONFLICT (user_id) DO UPDATE SET email = EXCLUDED.email, last_seen_at = now()`,
      [user.id, schema, user.email]
    )
    await useSchema(driver, schema)
    return await fn({ db: createDb(driver), driver, schema })
  } finally {
    await driver.close()
  }
}

/** A guest's connection: the empty guest schema, with every write refused by Postgres itself. */
export async function withGuest<T>(fn: (c: Connection, driver: SqlDriver) => Promise<T>, beforeReadOnly?: (driver: SqlDriver) => Promise<void>): Promise<T> {
  const driver = await connect()
  try {
    await beforeReadOnly?.(driver)
    await useSchema(driver, GUEST_SCHEMA)
    await driver.exec('SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY')
    try {
      return await fn({ db: createDb(driver), driver, schema: GUEST_SCHEMA }, driver)
    } finally {
      // Never let a reused connection carry the guest's restrictions to someone else.
      await driver.exec('SET SESSION CHARACTERISTICS AS TRANSACTION READ WRITE').catch(() => undefined)
    }
  } finally {
    await driver.close()
  }
}

/** Every account's schema, for the cron. */
export async function allAccounts(): Promise<{ userId: string; schema: string }[]> {
  const driver = await connect()
  try {
    const r = await driver.query('SELECT user_id, schema_name FROM public.khatwa_account ORDER BY last_seen_at DESC', [])
    return r.rows.map((row) => ({ userId: String(row.user_id), schema: String(row.schema_name) }))
  } finally {
    await driver.close()
  }
}

/** Runs `fn` on one schema by name (the cron's way in). */
export async function withSchema<T>(schema: string, fn: (c: Connection) => Promise<T>): Promise<T> {
  const driver = await connect()
  try {
    await useSchema(driver, schema)
    return await fn({ db: createDb(driver), driver, schema })
  } finally {
    await driver.close()
  }
}

/**
 * Counts one use of `key` in a rolling window and says whether it is still within
 * `limit`. Fixed windows are coarse, but enough to stop a script from draining an API key.
 */
export async function takeRate(driver: SqlDriver, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const r = await driver.query(
    `INSERT INTO public.khatwa_rate (key, window_start, count) VALUES ($1, now(), 1)
     ON CONFLICT (key) DO UPDATE SET
       count = CASE WHEN public.khatwa_rate.window_start < now() - make_interval(secs => $2) THEN 1 ELSE public.khatwa_rate.count + 1 END,
       window_start = CASE WHEN public.khatwa_rate.window_start < now() - make_interval(secs => $2) THEN now() ELSE public.khatwa_rate.window_start END
     RETURNING count`,
    [key, windowSeconds]
  )
  return Number(r.rows[0]?.count ?? 0) <= limit
}
