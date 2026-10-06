import { PGlite } from '@electric-sql/pglite'
import { createDb, useSchema, type Db, type SqlDriver } from '@server/persistence/db'

/**
 * An in-memory Postgres (PGlite) for tests: the same SQL, constraints and upserts the
 * app runs against Neon, with no server to start. One instance per test file; each
 * `freshDb()` drops and recreates the schema, so every test starts from empty.
 */

let pg: PGlite | null = null

function driverFor(db: PGlite): SqlDriver {
  return {
    async query(text, params) {
      const r = await db.query<Record<string, unknown>>(text, params as unknown[])
      return { rows: r.rows, rowCount: r.affectedRows ?? r.rows.length }
    },
    async exec(text) {
      await db.exec(text)
    },
    async close() {}
  }
}

export function testDriver(): SqlDriver {
  pg ??= new PGlite({
    // As in production: counts and sums come back as numbers, not strings.
    parsers: { 20: (v: string) => Number(v), 1700: (v: string) => Number(v) }
  })
  return driverFor(pg)
}

export async function freshDb(schema = 'test'): Promise<Db> {
  const driver = testDriver()
  await driver.exec(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`)
  await useSchema(driver, schema)
  return createDb(driver)
}
