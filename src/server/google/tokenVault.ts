import type { SyncRepo } from '../persistence/syncRepo'
import { open, seal } from '../platform/secretBox'

export interface StoredTokens {
  accessToken: string
  refreshToken: string
  /** Epoch ms when the access token expires. */
  expiresAt: number
  scope: string
  account: string | null
}

const PURPOSE = 'google-tokens'

/**
 * Google tokens at rest. The refresh token is a long-lived credential for the user's
 * Google data, so the database only ever holds it sealed with the server's APP_SECRET.
 */
export function tokenVault(sync: SyncRepo) {
  let cache: StoredTokens | null | undefined

  return {
    async save(tokens: StoredTokens): Promise<void> {
      await sync.saveToken(Buffer.from(seal(PURPOSE, JSON.stringify(tokens)), 'utf8'), tokens.account, tokens.scope)
      cache = tokens
    },

    async load(): Promise<StoredTokens | null> {
      if (cache !== undefined) return cache
      const row = await sync.loadToken()
      if (!row) return (cache = null)
      const json = open(PURPOSE, Buffer.from(row.ciphertext).toString('utf8'))
      if (!json) {
        // Sealed with a different secret (it was rotated): treat as disconnected.
        await sync.clearToken()
        return (cache = null)
      }
      return (cache = JSON.parse(json) as StoredTokens)
    },

    async account(): Promise<string | null> {
      return (await this.load())?.account ?? (await sync.loadToken())?.account ?? null
    },

    async clear(): Promise<void> {
      cache = null
      await sync.clearToken()
    }
  }
}

export type TokenVault = ReturnType<typeof tokenVault>
