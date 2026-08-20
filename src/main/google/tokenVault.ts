import { safeStorage } from 'electron'
import type { SyncRepo } from '../persistence/syncRepo'

export interface StoredTokens {
  accessToken: string
  refreshToken: string
  /** Epoch milliseconds. */
  expiresAt: number
  scope: string
  account: string | null
}

/**
 * OAuth tokens at rest.
 *
 * `safeStorage` is backed by DPAPI on Windows, so the ciphertext is bound to the
 * user account. Plaintext tokens exist only in memory inside the main process — they
 * are never written to disk and never cross the IPC bridge to the renderer.
 */
export function tokenVault(sync: SyncRepo) {
  let cache: StoredTokens | null = null

  return {
    available(): boolean {
      return safeStorage.isEncryptionAvailable()
    },

    save(tokens: StoredTokens): void {
      if (!safeStorage.isEncryptionAvailable()) {
        throw new Error('Windows credential encryption is unavailable; refusing to store tokens')
      }
      const buf = safeStorage.encryptString(JSON.stringify(tokens))
      sync.saveToken(buf, tokens.account, tokens.scope)
      cache = tokens
    },

    load(): StoredTokens | null {
      if (cache) return cache
      const row = sync.loadToken()
      if (!row) return null
      try {
        const json = safeStorage.decryptString(row.ciphertext)
        cache = JSON.parse(json) as StoredTokens
        return cache
      } catch {
        // A vault we cannot decrypt is a vault we must not trust — most often this is
        // a different Windows user or a restored profile. Treat it as disconnected.
        sync.clearToken()
        cache = null
        return null
      }
    },

    account(): string | null {
      return this.load()?.account ?? sync.loadToken()?.account ?? null
    },

    clear(): void {
      cache = null
      sync.clearToken()
    }
  }
}

export type TokenVault = ReturnType<typeof tokenVault>
