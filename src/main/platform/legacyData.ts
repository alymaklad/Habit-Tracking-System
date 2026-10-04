import { cpSync, existsSync, mkdirSync, rmSync } from 'node:fs'
import { join } from 'node:path'

/** What the app's data folder was called before it was renamed to Khatwa. */
export const LEGACY_APP_NAME = 'Adaptive Habit League'

const DATABASE = 'habits.db'
/** The database's journal files travel with it: until checkpointed, they hold real data. */
const DATABASE_SIDECARS = ['-wal', '-shm']
const FOLDERS = ['attachments', 'backups']

/**
 * The data folder is named after the app, so renaming the app would otherwise open an
 * empty one. On the first launch under the new name, copy the old folder's database and
 * files across. The old folder is left exactly as it was, as a fallback.
 *
 * Copy, never move: if anything fails part-way, the half-copied database is removed so
 * the next launch tries again from the untouched original.
 */
export function adoptLegacyData(fromDir: string, toDir: string): 'copied' | 'nothing-to-copy' | 'already-here' {
  if (existsSync(join(toDir, DATABASE))) return 'already-here'
  if (!existsSync(join(fromDir, DATABASE))) return 'nothing-to-copy'

  mkdirSync(toDir, { recursive: true })
  try {
    for (const folder of FOLDERS) {
      const src = join(fromDir, folder)
      if (existsSync(src)) cpSync(src, join(toDir, folder), { recursive: true, force: false, errorOnExist: false })
    }
    // The database last, so its presence means everything before it arrived.
    for (const suffix of DATABASE_SIDECARS) {
      const src = join(fromDir, DATABASE + suffix)
      if (existsSync(src)) cpSync(src, join(toDir, DATABASE + suffix))
    }
    cpSync(join(fromDir, DATABASE), join(toDir, DATABASE))
    return 'copied'
  } catch (err) {
    for (const suffix of ['', ...DATABASE_SIDECARS]) rmSync(join(toDir, DATABASE + suffix), { force: true })
    throw err
  }
}
