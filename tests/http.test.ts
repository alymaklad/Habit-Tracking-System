import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { HabitDraft, RpcLine } from '@shared/types'
import { handle } from '@server/http/handler'
import { setDriverFactory } from '@server/http/database'
import { seal } from '@server/platform/secretBox'
import { testDriver } from './pg'

/**
 * The HTTP layer end to end, on an in-memory Postgres: what one account can see of
 * another, what a guest may do, and what a cross-site request gets.
 */

process.env.APP_SECRET = 'test-secret-that-is-long-enough-for-the-box-0123456789'
process.env.NEON_AUTH_URL = 'https://auth.invalid'

let server: Server
let base = ''

beforeAll(async () => {
  setDriverFactory(async () => testDriver())
  server = createServer((req, res) => void handle(req, res))
  await new Promise<void>((resolve) => server.listen(0, resolve))
  base = `http://localhost:${(server.address() as AddressInfo).port}`
})

afterAll(() => new Promise<void>((resolve) => server.close(() => resolve())))

/** A session cookie as the server itself would write it, freshly checked. */
function cookieFor(id: string): string {
  const session = { user: { id, email: `${id}@example.com`, name: null, image: null }, jar: 'neon=1', checkedAt: Date.now() }
  return `khatwa_session=${encodeURIComponent(seal('session', JSON.stringify(session)))}`
}

async function rpc(channel: string, args: unknown[] = [], opts: { cookie?: string; headers?: Record<string, string> } = {}) {
  const res = await fetch(`${base}/api/rpc/${channel}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-khatwa': '1', ...(opts.cookie ? { cookie: opts.cookie } : {}), ...opts.headers },
    body: JSON.stringify(args)
  })
  const lines = (await res.text())
    .split('\n')
    .filter(Boolean)
    .map((l) => JSON.parse(l) as RpcLine)
  const last = lines.at(-1)!
  return { status: res.status, lines, result: 'result' in last ? last.result : undefined, error: 'error' in last ? last.error : undefined }
}

const habit: HabitDraft = {
  name: 'German',
  description: null,
  notes: null,
  recurrence: { kind: 'weekly', days: [1, 2, 3, 4, 5, 6, 7] },
  scheduledTime: '20:00',
  targetMinutes: 45,
  baselineMinutes: 45,
  difficultyLevel: 2,
  reminderLeadMinutes: 30,
  colorKey: 'violet',
  googleTasklistId: null,
  goalId: null,
  active: true
}

describe('the API', () => {
  it('keeps every account in its own schema', async () => {
    const aly = cookieFor('aly')
    const omar = cookieFor('omar')
    const created = await rpc('habits:create', [habit], { cookie: aly })
    expect(created.error).toBeUndefined()
    // A change tells the browser to refetch.
    expect(created.lines.some((l) => 'event' in l && l.event === 'dataChanged')).toBe(true)

    expect((await rpc('habits:list', [], { cookie: aly })).result).toHaveLength(1)
    expect((await rpc('habits:list', [], { cookie: omar })).result).toEqual([])
  })

  it('settles the time zone from the browser on first start', async () => {
    const zaid = cookieFor('zaid')
    await rpc('app:start', ['Africa/Cairo'], { cookie: zaid })
    expect((await rpc('settings:get', [], { cookie: zaid })).result).toMatchObject({ timezone: 'Africa/Cairo' })
    // A second start never moves it again.
    await rpc('app:start', ['Asia/Tokyo'], { cookie: zaid })
    expect((await rpc('settings:get', [], { cookie: zaid })).result).toMatchObject({ timezone: 'Africa/Cairo' })
  })

  it('lets a guest reach the planner and nothing else', async () => {
    expect((await rpc('goals:list')).result).toEqual([])
    expect((await rpc('goals:saveDraft', [{ title: 'x' }])).error).toBeUndefined()
    const blocked = await rpc('habits:list')
    expect(blocked.error).toMatchObject({ status: 401 })
  })

  it('refuses requests that did not come from the app', async () => {
    const aly = cookieFor('aly')
    const noHeader = await fetch(`${base}/api/rpc/habits:list`, { method: 'POST', headers: { cookie: aly }, body: '[]' })
    expect(noHeader.status).toBe(403)
    const crossSite = await rpc('habits:list', [], { cookie: aly, headers: { origin: 'https://evil.example' } })
    expect(crossSite.status).toBe(403)
  })

  it('ignores a forged session cookie', async () => {
    const forged = `khatwa_session=${encodeURIComponent(Buffer.from(JSON.stringify({ user: { id: 'aly' } })).toString('base64url'))}`
    expect((await rpc('habits:list', [], { cookie: forged })).error).toMatchObject({ status: 401 })
  })

  it('serves an attachment only to its owner', async () => {
    const res = await fetch(`${base}/api/files/00000000-0000-0000-0000-000000000000.png`, { headers: { cookie: cookieFor('omar') } })
    expect(res.status).toBe(404)
    const anon = await fetch(`${base}/api/files/00000000-0000-0000-0000-000000000000.png`)
    expect(anon.status).toBe(401)
  })

  it('runs the cron only with its secret', async () => {
    process.env.CRON_SECRET = 'cron-secret'
    expect((await fetch(`${base}/api/cron/daily`)).status).toBe(401)
    const ok = await fetch(`${base}/api/cron/daily`, { headers: { authorization: 'Bearer cron-secret' } })
    expect(ok.status).toBe(200)
    const body = (await ok.json()) as { ran: number; failed: number }
    expect(body.ran).toBeGreaterThanOrEqual(2)
    expect(body.failed).toBe(0)
  })
})
