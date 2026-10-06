import type { IncomingMessage, ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { join } from 'node:path'
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client'
import type { AccountStatus, AccountUser, RpcEvent, RpcLine } from '@shared/types'
import { createContext, type AppContext } from '../context'
import { accountService, AccountError, type AccountService } from '../account/accountService'
import { blobConfigured, MAX_ATTACHMENT_BYTES, mimeFor, writeLocal } from '../platform/attachmentStore'
import { allAccounts, takeRate, withAccount, withGuest, withSchema, type Connection } from './database'
import { CHANNELS, GUEST_CHANNELS, type RpcEnv } from './rpc'
import {
  openFlow,
  readCookie,
  readSession,
  REVALIDATE_MS,
  sealFlow,
  writeFlowCookie,
  writeSession,
  type Session
} from './session'
import pkg from '../../../package.json'

/**
 * Every `/api/*` request lands here — on Vercel through one function, locally through
 * `scripts/dev.ts`. Routes:
 *
 *   POST /api/rpc/<channel>         the app's RPC surface (NDJSON stream)
 *   GET  /api/config                what this deployment has set up (public)
 *   GET  /api/files/<name>          a journal attachment, for its owner only
 *   POST /api/files/token           Vercel Blob client-upload token
 *   PUT  /api/files/local/<name>    development uploads when there is no Blob store
 *   GET  /api/google/connect        start linking Google Tasks + Calendar
 *   GET  /api/google/callback       …and finish
 *   GET  /api/auth/google/start     sign in to Khatwa with Google (via Neon Auth)
 *   GET  /api/auth/google/done      …and finish
 *   GET  /api/cron/daily            the daily sync + reminders sweep (Vercel Cron)
 *   GET  /api/health
 */

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string
  ) {
    super(message)
  }
}

const GUEST_AI_PER_DAY = Number(process.env.GUEST_AI_PER_DAY ?? 3)
const SHARED_KEY_AI_PER_DAY = Number(process.env.AI_DAILY_LIMIT ?? 30)

// ------------------------------------------------------------------ helpers

/** The public origin: APP_URL when set (it must match OAuth redirect URIs), else the request's. */
function originOf(req: IncomingMessage): string {
  if (process.env.APP_URL) return process.env.APP_URL.replace(/\/+$/, '')
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim() || 'http'
  const host = (req.headers['x-forwarded-host'] as string | undefined) || req.headers.host || 'localhost'
  return `${proto}://${host}`
}

function clientIp(req: IncomingMessage): string {
  return ((req.headers['x-forwarded-for'] as string | undefined)?.split(',')[0] || req.socket.remoteAddress || 'unknown').trim()
}

async function readBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    size += (chunk as Buffer).length
    if (size > limit) throw new HttpError(413, 'That is too large to send.')
    chunks.push(chunk as Buffer)
  }
  return Buffer.concat(chunks)
}

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
  res.end(JSON.stringify(body))
}

function redirect(res: ServerResponse, location: string): void {
  res.writeHead(302, { location, 'cache-control': 'no-store' })
  res.end()
}

const message = (err: unknown): string => (err instanceof Error ? err.message : String(err))

/**
 * Requests that change something must come from the app itself: same Origin, and a
 * custom header no cross-site form can send without a CORS preflight we never approve.
 */
function assertSameOrigin(req: IncomingMessage): void {
  const origin = req.headers.origin
  if (origin && origin !== originOf(req)) throw new HttpError(403, 'Cross-site request refused')
  if (req.headers['x-khatwa'] !== '1') throw new HttpError(403, 'Missing request header')
}

/** One client per origin (preview deployments each have their own), kept across warm requests. */
const accountClients = new Map<string, AccountService>()
function accountsFor(req: IncomingMessage): AccountService {
  const origin = originOf(req)
  let svc = accountClients.get(origin)
  if (!svc) {
    svc = accountService({ authUrl: process.env.NEON_AUTH_URL || null, origin })
    accountClients.set(origin, svc)
  }
  return svc
}

/**
 * A fixed local user, for development without Neon Auth. Never on Vercel: a deployment
 * without NEON_AUTH_URL has no way in at all.
 */
function devUser(): AccountUser | null {
  if (process.env.VERCEL || process.env.NEON_AUTH_URL || process.env.KHATWA_DEV_USER !== '1') return null
  return { id: 'local', email: 'local@localhost', name: null, image: null }
}

/** The signed-in user, re-checking the session with Neon Auth when it is due. */
async function authenticate(req: IncomingMessage, res: ServerResponse): Promise<Session | null> {
  const dev = devUser()
  if (dev) return { user: dev, jar: 'dev', checkedAt: Date.now() }
  const s = readSession(req)
  if (!s) return null
  if (Date.now() - s.checkedAt < REVALIDATE_MS) return s
  try {
    const fresh = await accountsFor(req).session(s.jar)
    if (!fresh) {
      writeSession(res, req, null)
      return null
    }
    const next: Session = { user: fresh.user, jar: fresh.jar, checkedAt: Date.now() }
    writeSession(res, req, next)
    return next
  } catch (err) {
    // Neon Auth unreachable: keep the user in for now rather than lock them out.
    if (err instanceof AccountError && err.kind === 'network') return s
    writeSession(res, req, null)
    return null
  }
}

async function requireUser(req: IncomingMessage, res: ServerResponse): Promise<AccountUser> {
  const s = await authenticate(req, res)
  if (!s) throw new HttpError(401, 'Sign in to continue.')
  return s.user
}

function contextFor(c: Connection, emit?: (e: RpcEvent) => void): AppContext {
  return createContext({
    db: c.db,
    schema: c.schema,
    events: emit && {
      syncStatus: (data) => emit({ event: 'syncStatus', data }),
      toast: (data) => emit({ event: 'toast', data }),
      notify: (title, body) => emit({ event: 'notify', data: { title, body } })
    }
  })
}

// ---------------------------------------------------------------------- RPC

async function accountRpc(channel: string, args: unknown[], req: IncomingMessage, res: ServerResponse): Promise<unknown> {
  const svc = accountsFor(req)
  switch (channel) {
    case 'account:status': {
      if (devUser()) return { configured: false, user: null, offline: false } satisfies AccountStatus
      if (!svc.configured()) return { configured: true, user: null, offline: false } satisfies AccountStatus
      const s = await authenticate(req, res)
      return { configured: true, user: s?.user ?? null, offline: false } satisfies AccountStatus
    }
    case 'account:signUp':
    case 'account:signIn': {
      const r =
        channel === 'account:signUp'
          ? await svc.signUp(String(args[0] ?? ''), String(args[1] ?? ''), String(args[2] ?? ''))
          : await svc.signIn(String(args[0] ?? ''), String(args[1] ?? ''))
      writeSession(res, req, { user: r.user, jar: r.jar, checkedAt: Date.now() })
      return r.user
    }
    case 'account:signOut': {
      await svc.signOut(readSession(req)?.jar ?? null)
      writeSession(res, req, null)
      return null
    }
  }
  throw new HttpError(404, 'Unknown channel')
}

async function rpc(channel: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  assertSameOrigin(req)
  const raw = (await readBody(req, 4 * 1024 * 1024)).toString('utf8')
  const args = raw ? (JSON.parse(raw) as unknown) : []
  if (!Array.isArray(args)) throw new HttpError(400, 'Arguments must be an array')

  if (channel.startsWith('account:')) {
    // Answered plainly (not streamed): these set cookies, which must precede the body.
    const result = await accountRpc(channel, args, req, res)
    res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' })
    res.end(JSON.stringify({ result: result ?? null } satisfies RpcLine) + '\n')
    return
  }

  const session = await authenticate(req, res)
  const user = session?.user ?? null
  const ch = (user ? CHANNELS : GUEST_CHANNELS)[channel]
  if (!ch) throw new HttpError(user || !CHANNELS[channel] ? 404 : 401, user || !CHANNELS[channel] ? 'Unknown channel' : 'Sign in to continue.')

  // From here on the answer is a stream: events as they happen, then the result.
  res.writeHead(200, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store', 'x-accel-buffering': 'no' })
  const write = (line: RpcLine): void => {
    if (!res.writableEnded) res.write(JSON.stringify(line) + '\n')
  }
  const later: Promise<unknown>[] = []

  const run = async (c: Connection): Promise<void> => {
    const env: RpcEnv = { schema: c.schema, emit: write, later: (p) => later.push(p) }
    const ctx = contextFor(c, write)
    try {
      if (ch.ai && user && !(await ctx.aiUsesOwnKey())) {
        if (!(await takeRate(c.driver, `ai:user:${user.id}`, SHARED_KEY_AI_PER_DAY, 86_400))) {
          throw new HttpError(429, 'That is all the plans the shared AI key allows today. Add your own API key in Settings to keep planning.')
        }
      }
      const result = await ch.run(ctx, args, env)
      if (ch.mutates) write({ event: 'dataChanged' })
      write({ result: result ?? null })
    } catch (err) {
      write({ error: { message: message(err), status: err instanceof HttpError ? err.status : 400 } })
    }
    res.end()
    // Best-effort follow-ups run on the same connection, after the answer has gone.
    await Promise.allSettled(later)
  }

  try {
    if (user) {
      await withAccount(user, run)
    } else {
      await withGuest(
        (c) => run(c),
        async (driver) => {
          if (ch.ai && !(await takeRate(driver, `ai:ip:${clientIp(req)}`, GUEST_AI_PER_DAY, 86_400))) {
            throw new HttpError(429, 'Create a free account to keep planning — guests get a few plans a day.')
          }
        }
      )
    }
  } catch (err) {
    write({ error: { message: message(err), status: err instanceof HttpError ? err.status : 500 } })
    res.end()
  }
}

// -------------------------------------------------------------------- files

async function serveFile(name: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await requireUser(req, res)
  await withAccount(user, async (c) => {
    const file = await contextFor(c).reflect.readAttachment(name)
    if (!file) throw new HttpError(404, 'That file is no longer attached')
    res.writeHead(200, {
      'content-type': file.mime,
      'content-length': String(file.size),
      'content-disposition': `inline; filename*=UTF-8''${encodeURIComponent(file.originalName)}`,
      'cache-control': 'private, max-age=3600',
      'x-content-type-options': 'nosniff'
    })
    if (Buffer.isBuffer(file.body)) res.end(file.body)
    else
      await new Promise<void>((resolve, reject) => {
        Readable.fromWeb(file.body as import('node:stream/web').ReadableStream).pipe(res).on('finish', resolve).on('error', reject)
      })
  })
}

/** Vercel Blob client uploads: a token for exactly one file, in this account's folder. */
async function uploadToken(req: IncomingMessage, res: ServerResponse): Promise<void> {
  assertSameOrigin(req)
  const user = await requireUser(req, res)
  const body = JSON.parse((await readBody(req, 64 * 1024)).toString('utf8')) as HandleUploadBody
  const result = await withAccount(user, (c) =>
    handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (pathname) => {
        const [folder, name, ...rest] = pathname.split('/')
        const mime = name ? mimeFor(name) : null
        if (folder !== c.schema || rest.length > 0 || !mime) throw new HttpError(400, 'That upload is not allowed')
        return { allowedContentTypes: [mime], maximumSizeInBytes: MAX_ATTACHMENT_BYTES, addRandomSuffix: false, allowOverwrite: false }
      }
    })
  )
  json(res, 200, result)
}

async function uploadLocal(name: string, req: IncomingMessage, res: ServerResponse): Promise<void> {
  if (blobConfigured()) throw new HttpError(404, 'Not found')
  assertSameOrigin(req)
  const user = await requireUser(req, res)
  const data = await readBody(req, MAX_ATTACHMENT_BYTES)
  await withAccount(user, (c) => writeLocal(join(process.cwd(), '.data', 'attachments', c.schema), name, data))
  json(res, 200, { ok: true })
}

// ------------------------------------------------------------ Google links

async function googleConnect(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await requireUser(req, res)
  const { url, flow } = await withAccount(user, async (c) => contextFor(c).auth.begin(`${originOf(req)}/api/google/callback`, user.id))
  writeFlowCookie(res, req, 'khatwa_google', flow)
  redirect(res, url)
}

async function googleCallback(url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const user = await requireUser(req, res)
  const flow = readCookie(req, 'khatwa_google')
  writeFlowCookie(res, req, 'khatwa_google', null)
  try {
    await withAccount(user, async (c) => {
      const ctx = contextFor(c)
      await ctx.auth.complete(
        { code: url.searchParams.get('code'), state: url.searchParams.get('state'), error: url.searchParams.get('error') },
        flow,
        user.id
      )
      await ctx.orchestrator.runNow('manual')
    })
    redirect(res, '/?google=connected')
  } catch (err) {
    redirect(res, `/?google=error&message=${encodeURIComponent(message(err))}`)
  }
}

const NEON_FLOW = 'neon-google'

async function signInWithGoogle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  try {
    const { url, jar } = await accountsFor(req).startGoogle(`${originOf(req)}/api/auth/google/done`)
    writeFlowCookie(res, req, 'khatwa_signin', sealFlow(NEON_FLOW, { jar }))
    redirect(res, url)
  } catch (err) {
    redirect(res, `/?signin=error&message=${encodeURIComponent(message(err))}`)
  }
}

async function signInWithGoogleDone(url: URL, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const svc = accountsFor(req)
  const flow = openFlow<{ jar: string | null }>(NEON_FLOW, readCookie(req, 'khatwa_signin'))
  writeFlowCookie(res, req, 'khatwa_signin', null)
  const verifier = url.searchParams.get(svc.verifierParam)
  try {
    if (!verifier || !flow) throw new Error(`Google sign-in did not finish${url.searchParams.get('error') ? ` (${url.searchParams.get('error')})` : ''}. Try again.`)
    const r = await svc.finishGoogle(verifier, flow.jar)
    writeSession(res, req, { user: r.user, jar: r.jar, checkedAt: Date.now() })
    redirect(res, '/?signin=done')
  } catch (err) {
    redirect(res, `/?signin=error&message=${encodeURIComponent(message(err))}`)
  }
}

// --------------------------------------------------------------------- cron

/**
 * Once a day for every account: extend the schedule, carry to-dos forward, sync with
 * Google when linked, and deliver any reminder that is due (push relay users get it on
 * their phone). The open app does the same more often for whoever is using it.
 */
async function dailyCron(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) throw new HttpError(401, 'Unauthorized')
  const started = Date.now()
  const budgetMs = 250_000
  const results: { schema: string; ok: boolean; error?: string }[] = []
  for (const { schema } of await allAccounts()) {
    if (Date.now() - started > budgetMs) break
    try {
      await withSchema(schema, async (c) => {
        const ctx = contextFor(c)
        await ctx.bootstrap(null)
        if (await ctx.auth.isConnected()) await ctx.orchestrator.runNow('cron')
        await ctx.reminders.fireDue()
      })
      results.push({ schema, ok: true })
    } catch (err) {
      results.push({ schema, ok: false, error: message(err) })
    }
  }
  json(res, 200, { ran: results.length, failed: results.filter((r) => !r.ok).length, results })
}

// ------------------------------------------------------------------- router

export async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname.replace(/\/+$/, '')
  const method = req.method ?? 'GET'

  try {
    let m: RegExpExecArray | null
    if (method === 'POST' && (m = /^\/api\/rpc\/([a-zA-Z]+:[a-zA-Z]+)$/.exec(path))) return await rpc(m[1]!, req, res)
    if (method === 'GET' && path === '/api/config') {
      return json(res, 200, {
        version: pkg.version,
        accounts: Boolean(process.env.NEON_AUTH_URL) || !devUser(),
        google: Boolean(process.env.GOOGLE_CLIENT_ID),
        uploads: blobConfigured() ? 'blob' : 'local'
      })
    }
    if (method === 'GET' && (m = /^\/api\/files\/([0-9a-f-]+\.[a-z]+)$/.exec(path))) return await serveFile(m[1]!, req, res)
    if (method === 'POST' && path === '/api/files/token') return await uploadToken(req, res)
    if (method === 'PUT' && (m = /^\/api\/files\/local\/([0-9a-f-]+\.[a-z]+)$/.exec(path))) return await uploadLocal(m[1]!, req, res)
    if (method === 'GET' && path === '/api/google/connect') return await googleConnect(req, res)
    if (method === 'GET' && path === '/api/google/callback') return await googleCallback(url, req, res)
    if (method === 'GET' && path === '/api/auth/google/start') return await signInWithGoogle(req, res)
    if (method === 'GET' && path === '/api/auth/google/done') return await signInWithGoogleDone(url, req, res)
    if (method === 'GET' && path === '/api/cron/daily') return await dailyCron(req, res)
    if (method === 'GET' && path === '/api/health') return json(res, 200, { ok: true, version: pkg.version })
    throw new HttpError(404, 'Not found')
  } catch (err) {
    const status = err instanceof HttpError ? err.status : err instanceof AccountError ? 400 : 500
    if (status === 500) console.error('[api]', path, err)
    if (res.headersSent) {
      res.end()
      return
    }
    // RPC callers read NDJSON; everything else gets plain JSON.
    if (path.startsWith('/api/rpc/')) {
      res.writeHead(status, { 'content-type': 'application/x-ndjson', 'cache-control': 'no-store' })
      res.end(JSON.stringify({ error: { message: message(err), status } } satisfies RpcLine) + '\n')
    } else {
      json(res, status, { error: message(err) })
    }
  }
}
