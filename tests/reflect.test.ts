import { beforeEach, describe, expect, it } from 'vitest'
import type { GoalView, JournalDraft, LetGoCheckin, LetGoDraft } from '@shared/types'
import type { Db } from '@server/persistence/db'
import { freshDb } from './pg'
import { settingsRepo } from '@server/persistence/settingsRepo'
import { goalRepo } from '@server/persistence/goalRepo'
import { letGoRepo } from '@server/persistence/letGoRepo'
import { journalRepo } from '@server/persistence/journalRepo'
import { reflectService } from '@server/application/reflectService'
import { alternativeCounts, ceremonyReady, feelingPatterns, letGoStats } from '@server/domain/letGo'
import { addDays } from '@server/domain/time'
import { diskStore, newStoredName } from '@server/platform/attachmentStore'
import type { UploadedFile } from '@server/application/reflectService'
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach } from 'vitest'

const TODAY = '2026-09-25'
const NOW = new Date('2026-09-25T10:00:00.000Z') // Friday, Cairo

function ci(date: string, resisted: boolean, extra: Partial<LetGoCheckin> = {}): LetGoCheckin {
  return { id: 0, letGoId: 1, date, resisted, feelings: [], trigger: null, need: null, alternative: null, note: null, createdAt: '', ...extra }
}

describe('let-go statistics', () => {
  it('counts freedom without resetting it when the behaviour returns', async () => {
    const checkins = [ci('2026-09-20', true), ci('2026-09-21', true), ci('2026-09-22', false), ci('2026-09-23', true), ci('2026-09-24', true)]
    const s = letGoStats(checkins, '2026-09-20', TODAY)
    expect(s.daysTracked).toBe(5)
    expect(s.daysFree).toBe(4)
    expect(s.freedomRate).toBeCloseTo(0.8)
    expect(s.currentStreak).toBe(2)
    expect(s.bestStreak).toBe(2)
    expect(s.daysCarried).toBe(6)
  })

  it('does not end the current run just because today is not answered yet', async () => {
    const s = letGoStats([ci('2026-09-23', true), ci('2026-09-24', true)], '2026-09-23', TODAY)
    expect(s.currentStreak).toBe(2)
  })

  it('treats an unrecorded day as a gap in the best run, not as a return', async () => {
    const s = letGoStats([ci('2026-09-20', true), ci('2026-09-21', true), ci('2026-09-23', true)], '2026-09-20', TODAY)
    expect(s.bestStreak).toBe(2)
    expect(s.daysFree).toBe(3)
    expect(s.freedomRate).toBe(1)
  })

  it('reads feelings only from returned days and alternatives only from free days', async () => {
    const checkins = [
      ci('2026-09-20', false, { feelings: ['tired', 'stressed'] }),
      ci('2026-09-21', false, { feelings: ['tired'] }),
      ci('2026-09-22', true, { alternative: 'Paper book' }),
      ci('2026-09-23', true, { alternative: 'paper book ' })
    ]
    expect(feelingPatterns(checkins)[0]).toEqual({ feeling: 'tired', count: 2, share: 1 })
    expect(alternativeCounts(checkins)).toEqual([{ text: 'Paper book', count: 2 }])
  })

  it('offers the ceremony only after enough steady days', async () => {
    const many = Array.from({ length: 21 }, (_, i) => ci(addDays('2026-09-01', i), i % 5 !== 0))
    const s = letGoStats(many, '2026-09-01', TODAY)
    expect(ceremonyReady(s, 'carrying')).toBe(true)
    expect(ceremonyReady(s, 'left_behind')).toBe(false)
    expect(ceremonyReady(letGoStats(many.slice(0, 10), '2026-09-01', TODAY), 'carrying')).toBe(false)
  })
})

describe('reflect service', () => {
  let db: Db
  let svc: ReturnType<typeof reflectService>
  let goals: ReturnType<typeof goalRepo>
  let dir: string
  let src: string

  const draft = (over: Partial<LetGoDraft> = {}): LetGoDraft => ({
    title: 'Late-night scrolling',
    triggerContexts: ['before_sleep', 'stress'],
    triggerNotes: null,
    replacement: 'Read a paper book',
    goalId: null,
    weight: 'heavy',
    startedOn: '2026-09-01',
    ...over
  })
  const entry = (over: Partial<JournalDraft> = {}): JournalDraft => ({
    date: TODAY,
    kind: 'free',
    title: null,
    body: 'A quiet morning.',
    mood: null,
    stepToward: null,
    prompts: {},
    tags: [],
    goalId: null,
    letGoId: null,
    ...over
  })

  beforeEach(async () => {
    db = await freshDb()
    const settings = settingsRepo(db)
    await settings.save({ timezone: 'Africa/Cairo' })
    goals = goalRepo(db)
    dir = mkdtempSync(join(tmpdir(), 'khatwa-att-'))
    src = mkdtempSync(join(tmpdir(), 'khatwa-src-'))
    svc = reflectService({ letGo: letGoRepo(db), journal: journalRepo(db), goals, settings, files: diskStore(dir), goalViews: async () => [] as GoalView[] })
  })

  it('creates a behaviour, records days, and keeps one answer per day', async () => {
    const lg = await svc.letGoCreate(draft())
    await svc.checkIn(lg.id, '2026-09-24', { resisted: false, feelings: ['tired'], trigger: 'Late debugging', need: 'Rest', alternative: null, note: null }, NOW)
    await svc.checkIn(lg.id, '2026-09-24', { resisted: true, feelings: ['tired'], trigger: 'ignored', need: null, alternative: 'Walk', note: null }, NOW)
    const v = (await svc.letGoGet(lg.id, NOW))!
    expect(v.checkins).toHaveLength(1)
    // A free day keeps its alternative and drops the urge-reflection fields.
    expect(v.checkins[0]).toMatchObject({ resisted: true, feelings: [], trigger: null, alternative: 'Walk' })
  })

  it('refuses a day that has not happened yet', async () => {
    const lg = await svc.letGoCreate(draft())
    await expect(svc.checkIn(lg.id, '2026-09-26', { resisted: true, feelings: [], trigger: null, need: null, alternative: null, note: null }, NOW)).rejects.toThrow(/not happened/)
  })

  it('leaves a behaviour behind without losing its history, and can pick it up again', async () => {
    const lg = await svc.letGoCreate(draft())
    await svc.checkIn(lg.id, '2026-09-24', { resisted: true, feelings: [], trigger: null, need: null, alternative: null, note: null }, NOW)
    await svc.leaveBehind(lg.id, '  I choose real rest.  ')
    let v = (await svc.letGoGet(lg.id, NOW))!
    expect(v.status).toBe('left_behind')
    expect(v.vow).toBe('I choose real rest.')
    expect(v.checkins).toHaveLength(1)
    await svc.pickUpAgain(lg.id)
    v = (await svc.letGoGet(lg.id, NOW))!
    expect(v.status).toBe('carrying')
    expect(v.stats.daysFree).toBe(1)
  })

  it('keeps a behaviour when its mountain is deleted, clearing only the link', async () => {
    const g = await goals.create({ title: 'Become an AI engineer', description: null, targetDate: null, weeklyMinutesBudget: null, mindMap: [], resources: [] })
    const lg = await svc.letGoCreate(draft({ goalId: g.id }))
    expect((await svc.letGoGet(lg.id, NOW))!.goalTitle).toBe('Become an AI engineer')
    await goals.remove(g.id)
    expect((await svc.letGoGet(lg.id, NOW))!.goalId).toBeNull()
  })

  it('refuses an empty entry, normalises tags, and keeps a single page per month', async () => {
    await expect(svc.journalSave(null, entry({ body: '   ' }))).rejects.toThrow(/nothing written/)
    const e = await svc.journalSave(null, entry({ tags: ['#Clarity', 'clarity', ' let-go '] }))
    expect(e.tags).toEqual(['clarity', 'let-go'])
    const a = await svc.journalSave(null, entry({ kind: 'monthly', date: '2026-09-14', body: '', prompts: { proud: 'Kept going' } }))
    const b = await svc.journalSave(null, entry({ kind: 'monthly', date: '2026-09-30', body: '', prompts: { proud: 'Kept going', learned: 'Rest matters' } }))
    expect(b.id).toBe(a.id)
    expect(b.date).toBe('2026-09-01')
    expect((await svc.journalList()).filter((x) => x.kind === 'monthly')).toHaveLength(1)
  })

  it('grounds each Guide observation in counts, and lets it be dismissed', async () => {
    const lg = await svc.letGoCreate(draft())
    const days = ['2026-09-19', '2026-09-20', '2026-09-21']
    for (const d of days) (await svc.checkIn(lg.id, d, { resisted: false, feelings: ['tired'], trigger: null, need: null, alternative: null, note: null }, NOW))
    for (const d of ['2026-09-22', '2026-09-23', '2026-09-24']) (await svc.checkIn(lg.id, d, { resisted: true, feelings: [], trigger: null, need: null, alternative: 'Paper book', note: null }, NOW))

    const insights = await svc.guide(NOW)
    const feeling = insights.find((i) => i.key.startsWith('letgo-feeling'))!
    expect(feeling.observation).toMatch(/feeling tired in 3 of your last 3 reflections/)
    const alt = insights.find((i) => i.key.startsWith('letgo-alternative'))!
    expect(alt.action).toMatchObject({ kind: 'add-tool', title: 'Paper book' })

    await svc.dismissInsight(feeling.key)
    expect((await svc.guide(NOW)).some((i) => i.key === feeling.key)).toBe(false)

    // Once kept as a tool, the Guide stops suggesting it.
    await svc.toolSave(null, { title: 'paper book', description: null, goalId: null, habitId: null })
    expect((await svc.guide(NOW)).some((i) => i.key.startsWith('letgo-alternative'))).toBe(false)
  })

  afterEach(async () => {
    rmSync(dir, { recursive: true, force: true })
    rmSync(src, { recursive: true, force: true })
  })

  /** What the browser does: upload under a server-chosen name, then register it. */
  const upload = (name: string, bytes = 16): UploadedFile => {
    const storedName = newStoredName(name)
    writeFileSync(join(dir, storedName), Buffer.alloc(bytes, 7))
    return { storedName, originalName: name }
  }

  it('registers an uploaded photo unlinked, links it on save, and deletes it with the entry', async () => {
    const [photo] = await svc.registerAttachments([upload('desk.JPG')])
    expect(photo).toMatchObject({ journalId: null, isImage: true, originalName: 'desk.JPG', mime: 'image/jpeg' })
    expect(photo!.url).toMatch(/^\/api\/files\/[0-9a-f-]{36}\.jpg$/)
    expect(readdirSync(dir)).toHaveLength(1)

    // A photo alone is enough of an entry.
    const e = await svc.journalSave(null, entry({ body: '', attachmentIds: [photo!.id] }))
    expect(e.attachments.map((a) => a.id)).toEqual([photo!.id])
    expect((await svc.journalList())[0]!.attachments).toHaveLength(1)

    await svc.journalRemove(e.id)
    expect(readdirSync(dir)).toHaveLength(0)
  })

  it('deletes a file taken off an entry, and leaves another entry’s files alone', async () => {
    const [a, b] = await svc.registerAttachments([upload('a.png'), upload('b.pdf')])
    const one = await svc.journalSave(null, entry({ attachmentIds: [a!.id, b!.id] }))
    const two = await svc.journalSave(null, entry({ body: 'Other', attachmentIds: [a!.id] }))
    expect(two.attachments).toEqual([]) // a belongs to the first entry
    const kept = await svc.journalSave(one.id, entry({ attachmentIds: [a!.id] }))
    expect(kept.attachments.map((x) => x.originalName)).toEqual(['a.png'])
    expect(readdirSync(dir)).toHaveLength(1)
  })

  it('refuses unknown types, missing and oversized uploads, and serves only its own files', async () => {
    expect(() => newStoredName('run.exe')).toThrow(/can’t be attached/)
    await expect(svc.registerAttachments([{ storedName: '00000000-0000-0000-0000-000000000000.exe', originalName: 'run.exe' }])).rejects.toThrow(/can’t be attached/)
    await expect(svc.registerAttachments([{ storedName: newStoredName('gone.png'), originalName: 'gone.png' }])).rejects.toThrow(/did not finish uploading/)
    const huge = upload('huge.png', 25 * 1024 * 1024 + 1)
    await expect(svc.registerAttachments([huge])).rejects.toThrow(/larger than 25 MB/)
    expect(existsSync(join(dir, huge.storedName))).toBe(false)

    const [mine] = await svc.registerAttachments([upload('mine.png')])
    const name = mine!.url.split('/').pop()!
    expect((await svc.readAttachment(name))?.size).toBe(16)
    // A file in the folder that is not one of this account's attachments is not served.
    const stray = upload('stray.png')
    expect(await svc.readAttachment(stray.storedName)).toBeNull()
    expect(await svc.readAttachment('../../habits.db')).toBeNull()
  })

  it('sweeps files imported for an entry that was never saved', async () => {
    const [orphan] = await svc.registerAttachments([upload('lost.png')])
    expect(await svc.sweepAttachments(new Date())).toBe(0) // too fresh — maybe still being written
    expect(await svc.sweepAttachments(new Date(Date.now() + 25 * 3_600_000))).toBe(1)
    expect(existsSync(join(dir, orphan!.url.split('/').pop()!))).toBe(false)
  })

  it('says nothing when there is too little to go on', async () => {
    const lg = await svc.letGoCreate(draft())
    await svc.checkIn(lg.id, '2026-09-24', { resisted: false, feelings: ['tired'], trigger: null, need: null, alternative: null, note: null }, NOW)
    await svc.journalSave(null, entry({ kind: 'daily', mood: 'exhausted', body: '' }))
    expect(await svc.guide(NOW)).toEqual([])
  })
})
