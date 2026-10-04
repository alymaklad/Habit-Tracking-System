import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { closeDatabase, dailyBackup, openDatabase } from '@main/persistence/db'

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'ahl-dbsafety-'))
})

afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('database safety', () => {
  it('leaves nothing in the journal after a close: the main file holds every change', () => {
    const file = join(dir, 'habits.db')
    const db = openDatabase(file)
    db.prepare("INSERT INTO settings (key, value) VALUES ('probe', '\"x\"')").run()
    closeDatabase(db)
    expect(!existsSync(`${file}-wal`) || statSync(`${file}-wal`).size === 0).toBe(true)

    const again = openDatabase(file)
    expect(again.prepare("SELECT value FROM settings WHERE key = 'probe'").get()).toEqual({ value: '"x"' })
    closeDatabase(again)
  })

  it('refuses a damaged file without writing to it', () => {
    const file = join(dir, 'habits.db')
    writeFileSync(file, Buffer.alloc(8192, 7))
    const before = statSync(file).mtimeMs
    expect(() => openDatabase(file)).toThrow(/damaged.*Nothing was written/)
    expect(statSync(file).mtimeMs).toBe(before)
  })

  it('takes one backup a day and keeps only the newest ones', async () => {
    const db = openDatabase(join(dir, 'habits.db'))
    const backups = join(dir, 'backups')
    expect(await dailyBackup(db, backups, '2026-09-20', 3)).toMatch(/habits-2026-09-20\.db$/)
    expect(await dailyBackup(db, backups, '2026-09-20', 3)).toBeNull()
    for (const d of ['2026-09-21', '2026-09-22', '2026-09-23']) await dailyBackup(db, backups, d, 3)
    expect(readdirSync(backups).sort()).toEqual(['habits-2026-09-21.db', 'habits-2026-09-22.db', 'habits-2026-09-23.db'])

    // A backup is a whole, openable database.
    const copy = openDatabase(join(backups, 'habits-2026-09-23.db'))
    expect(copy.prepare('SELECT COUNT(*) AS n FROM schema_migration').get()).toMatchObject({ n: expect.any(Number) })
    closeDatabase(copy)
    closeDatabase(db)
  })
})
