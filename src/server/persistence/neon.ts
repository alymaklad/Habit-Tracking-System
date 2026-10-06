import { Client, neonConfig, types } from '@neondatabase/serverless'
import ws from 'ws'
import type { SqlDriver } from './db'

// Counts and sums come back as int8/numeric, which `pg` hands over as strings to avoid
// precision loss. Nothing this app counts gets anywhere near 2^53.
types.setTypeParser(20, Number) // int8
types.setTypeParser(1700, Number) // numeric

neonConfig.webSocketConstructor = ws

/**
 * One WebSocket session per request. A session (not Neon's HTTP mode) because the
 * request sets `search_path` once and may open a transaction; both are session state.
 *
 * Use the DIRECT (unpooled) connection string: PgBouncer in transaction mode would drop
 * `search_path` between statements.
 */
export async function neonDriver(connectionString: string): Promise<SqlDriver> {
  const client = new Client({ connectionString })
  await client.connect()
  return {
    async query(text, params) {
      const r = await client.query(text, params)
      return { rows: r.rows as Record<string, unknown>[], rowCount: r.rowCount }
    },
    async exec(text) {
      await client.query(text)
    },
    async close() {
      await client.end().catch(() => undefined)
    }
  }
}

/** The unpooled URL when the Neon integration provides one, else the plain one. */
export function databaseUrl(): string {
  const url = process.env.DATABASE_URL_UNPOOLED || process.env.POSTGRES_URL_NON_POOLING || process.env.DATABASE_URL
  if (!url) throw new Error('DATABASE_URL is not set. Add the Neon connection string to the environment.')
  return url
}
