import { safeStorage } from 'electron'
import type { SettingsRepo } from '../persistence/settingsRepo'
import type { SessionStore } from './accountService'

const FLAG = 'accountSession'

/**
 * The account session cookie, encrypted with DPAPI the same way the Google tokens are, and
 * kept in the main process only. Without encryption available it is not stored at all:
 * the user stays signed in for this launch and signs in again next time.
 */
export function sessionVault(settings: SettingsRepo): SessionStore {
  let memory: string | null = null
  return {
    load(): string | null {
      if (memory) return memory
      const stored = settings.getFlag<string | null>(FLAG, null)
      if (!stored || !safeStorage.isEncryptionAvailable()) return null
      try {
        return (memory = safeStorage.decryptString(Buffer.from(stored, 'base64')))
      } catch {
        settings.setFlag(FLAG, null)
        return null
      }
    },
    save(cookie: string | null): void {
      memory = cookie
      if (!cookie || !safeStorage.isEncryptionAvailable()) {
        settings.setFlag(FLAG, null)
        return
      }
      settings.setFlag(FLAG, safeStorage.encryptString(cookie).toString('base64'))
    }
  }
}
