import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { adoptLegacyData } from '@main/platform/legacyData'

let root: string
let from: string
let to: string

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'khatwa-legacy-'))
  from = join(root, 'Adaptive Habit League')
  to = join(root, 'Khatwa')
})

afterEach(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('adoptLegacyData', () => {
  it('copies the database, its journal and the attachment and backup folders, leaving the original', () => {
    mkdirSync(join(from, 'attachments'), { recursive: true })
    mkdirSync(join(from, 'backups'), { recursive: true })
    writeFileSync(join(from, 'habits.db'), 'db')
    writeFileSync(join(from, 'habits.db-wal'), 'wal')
    writeFileSync(join(from, 'attachments', 'a.png'), 'png')
    writeFileSync(join(from, 'backups', 'habits-2026-10-01.db'), 'bk')

    expect(adoptLegacyData(from, to)).toBe('copied')
    expect(readFileSync(join(to, 'habits.db'), 'utf8')).toBe('db')
    expect(readFileSync(join(to, 'habits.db-wal'), 'utf8')).toBe('wal')
    expect(readFileSync(join(to, 'attachments', 'a.png'), 'utf8')).toBe('png')
    expect(existsSync(join(to, 'backups', 'habits-2026-10-01.db'))).toBe(true)
    expect(existsSync(join(from, 'habits.db'))).toBe(true)
  })

  it('never overwrites a database already in the new folder', () => {
    mkdirSync(from, { recursive: true })
    mkdirSync(to, { recursive: true })
    writeFileSync(join(from, 'habits.db'), 'old')
    writeFileSync(join(to, 'habits.db'), 'new')
    expect(adoptLegacyData(from, to)).toBe('already-here')
    expect(readFileSync(join(to, 'habits.db'), 'utf8')).toBe('new')
  })

  it('does nothing for a fresh install', () => {
    expect(adoptLegacyData(from, to)).toBe('nothing-to-copy')
    expect(existsSync(to)).toBe(false)
  })
})
