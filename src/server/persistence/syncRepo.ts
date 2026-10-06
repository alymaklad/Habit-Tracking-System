import type { Iso, SyncLogEntry } from '@shared/types'
import type { Db } from './db'

export interface PendingOp {
  id: number
  kind: 'create' | 'patch' | 'delete'
  occurrenceId: number | null
  payload: Record<string, unknown>
  createdAt: Iso
  retryCount: number
  lastError: string | null
}

export function syncRepo(db: Db) {
  return {
    // ------------------------------------------------------ watermark

    /**
     * The Tasks API has no sync token, so incremental pulls use `updatedMin`. The
     * watermark advances from the maximum `updated` value the SERVER returned, never
     * from the local clock — that is what makes it survive clock skew.
     */
    async watermark(tasklistId: string): Promise<string | null> {
      const r = (await db
        .prepare('SELECT updated_watermark AS w FROM sync_state WHERE tasklist_id = ?')
        .get(tasklistId)) as { w: string | null } | undefined
      return r?.w ?? null
    },

    async setWatermark(tasklistId: string, watermark: string | null): Promise<void> {
      await db.prepare(
        `INSERT INTO sync_state (tasklist_id, updated_watermark) VALUES (?, ?)
         ON CONFLICT (tasklist_id) DO UPDATE SET updated_watermark = excluded.updated_watermark`
      ).run(tasklistId, watermark)
    },

    async markSuccess(tasklistId: string, at: Iso): Promise<void> {
      await db.prepare(
        `INSERT INTO sync_state (tasklist_id, last_success_at, last_error, failures)
         VALUES (?, ?, NULL, 0)
         ON CONFLICT (tasklist_id) DO UPDATE SET
           last_success_at = excluded.last_success_at, last_error = NULL, failures = 0`
      ).run(tasklistId, at)
    },

    async markFailure(tasklistId: string, error: string): Promise<void> {
      await db.prepare(
        `INSERT INTO sync_state (tasklist_id, last_error, failures) VALUES (?, ?, 1)
         ON CONFLICT (tasklist_id) DO UPDATE SET
           last_error = excluded.last_error, failures = sync_state.failures + 1`
      ).run(tasklistId, error)
    },

    async state(tasklistId: string) {
      return (await db.prepare('SELECT * FROM sync_state WHERE tasklist_id = ?').get(tasklistId)) as
        | {
            tasklist_id: string
            updated_watermark: string | null
            last_success_at: string | null
            last_error: string | null
            failures: number
          }
        | undefined
    },

    async lastSuccessAnywhere(): Promise<Iso | null> {
      const r = (await db
        .prepare('SELECT MAX(last_success_at) AS a FROM sync_state')
        .get()) as { a: string | null }
      return r?.a ?? null
    },

    async resetAll(): Promise<void> {
      await db.prepare('DELETE FROM sync_state').run()
    },

    // ------------------------------------------------------------ log

    async log(level: 'info' | 'warn' | 'error', message: string, payload?: unknown): Promise<void> {
      await db.prepare('INSERT INTO sync_log (at, level, message, payload) VALUES (?, ?, ?, ?)').run(
        new Date().toISOString(),
        level,
        message,
        payload === undefined ? null : JSON.stringify(payload)
      )
      // Keep the log bounded; it is a diagnostic tail, not an audit trail.
      await db
        .prepare('DELETE FROM sync_log WHERE id NOT IN (SELECT id FROM sync_log ORDER BY id DESC LIMIT 500)')
        .run()
    },

    async recent(limit = 12): Promise<SyncLogEntry[]> {
      const rows = (await db
        .prepare('SELECT at, level, message FROM sync_log ORDER BY id DESC LIMIT ?')
        .all(limit)) as { at: string; level: string; message: string }[]
      return rows.map((r) => ({
        at: r.at,
        level: r.level as 'info' | 'warn' | 'error',
        message: r.message
      }))
    },

    // ---------------------------------------------------- pending ops

    async enqueue(
      kind: PendingOp['kind'],
      occurrenceId: number | null,
      payload: Record<string, unknown>,
      now: Date = new Date()
    ): Promise<void> {
      await db.prepare(
        'INSERT INTO pending_op (kind, occurrence_id, payload, created_at) VALUES (?, ?, ?, ?)'
      ).run(kind, occurrenceId, JSON.stringify(payload), now.toISOString())
    },

    async queued(limit = 50): Promise<PendingOp[]> {
      const rows = (await db
        .prepare('SELECT * FROM pending_op ORDER BY id LIMIT ?')
        .all(limit)) as {
        id: number
        kind: string
        occurrence_id: number | null
        payload: string
        created_at: string
        retry_count: number
        last_error: string | null
      }[]
      return rows.map((r) => ({
        id: r.id,
        kind: r.kind as PendingOp['kind'],
        occurrenceId: r.occurrence_id,
        payload: JSON.parse(r.payload) as Record<string, unknown>,
        createdAt: r.created_at,
        retryCount: r.retry_count,
        lastError: r.last_error
      }))
    },

    async queuedCount(): Promise<number> {
      const r = (await db.prepare('SELECT COUNT(*) AS n FROM pending_op').get()) as { n: number }
      return r.n
    },

    async dequeue(id: number): Promise<void> {
      await db.prepare('DELETE FROM pending_op WHERE id = ?').run(id)
    },

    async failOp(id: number, error: string): Promise<void> {
      await db.prepare(
        'UPDATE pending_op SET retry_count = retry_count + 1, last_error = ? WHERE id = ?'
      ).run(error, id)
    },

    async clearQueue(): Promise<void> {
      await db.prepare('DELETE FROM pending_op').run()
    },

    // ---------------------------------------------------------- token

    /** Ciphertext only — encryption and decryption belong to the token vault. */
    async saveToken(ciphertext: Buffer, account: string | null, scope: string | null): Promise<void> {
      await db.prepare(
        `INSERT INTO oauth_token (id, ciphertext, account, scope, updated_at)
         VALUES (1, ?, ?, ?, ?)
         ON CONFLICT (id) DO UPDATE SET
           ciphertext = excluded.ciphertext, account = excluded.account,
           scope = excluded.scope, updated_at = excluded.updated_at`
      ).run(ciphertext, account, scope, new Date().toISOString())
    },

    async loadToken(): Promise<{ ciphertext: Buffer; account: string | null; scope: string | null } | null> {
      const r = (await db.prepare('SELECT * FROM oauth_token WHERE id = 1').get()) as
        | { ciphertext: Buffer; account: string | null; scope: string | null }
        | undefined
      return r ?? null
    },

    async clearToken(): Promise<void> {
      await db.prepare('DELETE FROM oauth_token WHERE id = 1').run()
    }
  }
}

export type SyncRepo = ReturnType<typeof syncRepo>
