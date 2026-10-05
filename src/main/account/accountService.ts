import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { AccountStatus, AccountUser } from '@shared/types'

/**
 * Khatwa accounts, backed by Neon Auth (managed Better Auth).
 *
 * Better Auth is built for browsers: it keeps the session in an HttpOnly cookie. A desktop
 * app has no such cookie jar, so the main process talks to the REST API itself, keeps the
 * session cookie it is given (encrypted at rest, never handed to the UI process) and sends
 * it back on each request. The renderer only ever sees who is signed in.
 *
 * Google sign-in follows Neon's own redirect flow, with the system browser standing in for
 * a web page: the app listens on a localhost port, asks Neon to start Google sign-in with
 * that address as the callback, and opens the link. Neon sends the browser back with a
 * one-time `neon_auth_session_verifier`, which the app exchanges for the session — together
 * with the "session challenge" cookie Neon set when sign-in started, so a verifier is no
 * use to anyone but the app that asked for it.
 */

/** Neon trusts any localhost origin, on any port, out of the box. */
const LOCAL_ORIGIN = 'http://localhost'
const GOOGLE_TIMEOUT_MS = 5 * 60_000
const VERIFIER_PARAM = 'neon_auth_session_verifier'

const donePage = (ok: boolean): string => `<!doctype html><meta charset="utf-8"><title>Khatwa</title>
<style>body{margin:0;height:100vh;display:grid;place-items:center;background:#fbf8f3;color:#24211d;font-family:Georgia,serif}
.c{text-align:center;padding:40px 48px;border:1px solid #e3dacb;border-radius:12px;background:#fdfaf6}h1{font-size:22px;font-weight:500;margin:0 0 8px}p{margin:0;color:#6f675e;font-family:system-ui,sans-serif;font-size:14px}</style>
<div class="c"><h1>${ok ? 'You are signed in to Khatwa' : 'Sign-in did not finish'}</h1><p>${ok ? 'You can close this tab and go back to the app.' : 'Close this tab and try again from the app.'}</p></div>`

export class AccountError extends Error {
  constructor(
    message: string,
    readonly kind: 'not_configured' | 'credentials' | 'exists' | 'network' | 'other'
  ) {
    super(message)
  }
}

/** Where the session cookie lives between launches; encrypted by the caller. */
export interface SessionStore {
  load(): string | null
  save(cookie: string | null): void
}

type FetchLike = typeof fetch

export function accountService(deps: {
  /** The Neon Auth URL from the Neon console; null when accounts are not set up in this build. */
  authUrl: string | null
  /** Sent as the Origin header — must be one of Neon Auth's trusted domains, if it checks. */
  origin?: string | null
  store: SessionStore
  /** Opens a link in the system browser. */
  openExternal: (url: string) => void | Promise<void>
  fetchImpl?: FetchLike
}) {
  const doFetch: FetchLike = deps.fetchImpl ?? fetch
  let base: string | null = null
  let cached: AccountUser | null = null

  /** Neon shows one URL; the endpoints sit either directly under it or under `/auth`. */
  async function resolveBase(): Promise<string> {
    if (base) return base
    if (!deps.authUrl) throw new AccountError('Accounts are not set up in this build.', 'not_configured')
    const root = deps.authUrl.replace(/\/+$/, '')
    for (const candidate of [root, `${root}/auth`]) {
      try {
        const res = await doFetch(`${candidate}/ok`, { headers: headers() })
        if (res.ok) return (base = candidate)
      } catch {
        throw new AccountError('Could not reach the account service. Check your connection.', 'network')
      }
    }
    // Fall back to the URL as given; the real request will report what went wrong.
    return (base = root)
  }

  function headers(extra: Record<string, string> = {}, origin = deps.origin || LOCAL_ORIGIN): Record<string, string> {
    const h: Record<string, string> = { accept: 'application/json', ...extra }
    h.origin = origin
    const cookie = deps.store.load()
    if (cookie) h.cookie = cookie
    return h
  }

  /** Keep every cookie the service sets; a cleared (expired) one removes the session. */
  function keepCookies(res: Response): void {
    const set = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
    if (set.length === 0) return
    const jar = new Map<string, string>()
    for (const pair of (deps.store.load() ?? '').split(/;\s*/).filter(Boolean)) {
      const i = pair.indexOf('=')
      if (i > 0) jar.set(pair.slice(0, i), pair.slice(i + 1))
    }
    for (const line of set) {
      const [pair, ...attrs] = line.split(';')
      const i = pair!.indexOf('=')
      if (i <= 0) continue
      const name = pair!.slice(0, i).trim()
      const value = pair!.slice(i + 1).trim()
      const expired = attrs.some((a) => /^\s*max-age=0/i.test(a)) || value === ''
      if (expired) jar.delete(name)
      else jar.set(name, value)
    }
    deps.store.save(jar.size ? [...jar].map(([k, v]) => `${k}=${v}`).join('; ') : null)
  }

  async function call<T>(path: string, init: { method?: string; body?: unknown; origin?: string } = {}): Promise<T> {
    const root = await resolveBase()
    let res: Response
    try {
      res = await doFetch(`${root}${path}`, {
        method: init.method ?? 'GET',
        headers: headers(init.body !== undefined ? { 'content-type': 'application/json' } : {}, init.origin),
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined
      })
    } catch {
      throw new AccountError('Could not reach the account service. Check your connection.', 'network')
    }
    keepCookies(res)
    const data = (await res.json().catch(() => null)) as (T & { message?: string; code?: string }) | null
    if (!res.ok) throw toError(res.status, data?.code, data?.message)
    return data as T
  }

  /** Better Auth's error codes, said the way a person would want to hear them. */
  function toError(status: number, code?: string, message?: string): AccountError {
    switch (code) {
      case 'INVALID_EMAIL_OR_PASSWORD':
        return new AccountError('That email and password do not match an account.', 'credentials')
      case 'USER_ALREADY_EXISTS':
      case 'USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL':
        return new AccountError('An account with that email already exists — sign in instead.', 'exists')
      case 'PASSWORD_TOO_SHORT':
        return new AccountError('Use a password of at least 8 characters.', 'credentials')
      case 'PASSWORD_TOO_LONG':
        return new AccountError('That password is too long.', 'credentials')
      case 'INVALID_EMAIL':
        return new AccountError('That does not look like an email address.', 'credentials')
      case 'EMAIL_NOT_VERIFIED':
        return new AccountError('Confirm your email first — check your inbox for the link.', 'credentials')
      case 'INVALID_ORIGIN':
      case 'INVALID_CALLBACK_URL':
        return new AccountError(
          'The account service refused this app. Add its origin to Neon Auth’s trusted domains (see docs/ACCOUNTS.md).',
          'other'
        )
    }
    if (status === 429) return new AccountError('Too many attempts. Wait a minute and try again.', 'other')
    return new AccountError(message ? `The account service said: ${message}` : `The account service failed (${status}).`, 'other')
  }

  let cancelGoogle: (() => void) | null = null

  /**
   * A one-shot listener for Neon's redirect back from Google. It answers on both IPv4 and
   * IPv6 loopback, because a browser may resolve "localhost" to either, and never on the
   * network.
   */
  async function listenForVerifier(): Promise<{ port: number; verifier: Promise<string>; close: () => void }> {
    const servers: Server[] = []
    let settle: { resolve: (v: string) => void; reject: (e: Error) => void } | null = null
    const verifier = new Promise<string>((resolve, reject) => {
      settle = { resolve, reject }
    })
    // Rejections are delivered to the awaiting caller; never leave one unhandled.
    verifier.catch(() => undefined)
    let timer: ReturnType<typeof setTimeout> | null = null
    const close = (): void => {
      for (const s of servers) s.close()
      if (timer) clearTimeout(timer)
      if (cancelGoogle === cancel) cancelGoogle = null
    }
    const cancel = (): void => {
      settle?.reject(new AccountError('Google sign-in was cancelled.', 'other'))
      close()
    }
    const handler = (req: IncomingMessage, res: ServerResponse): void => {
      const url = new URL(req.url ?? '/', 'http://localhost')
      if (url.pathname !== '/done') {
        res.writeHead(404).end()
        return
      }
      const code = url.searchParams.get(VERIFIER_PARAM)
      res.writeHead(code ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' }).end(donePage(Boolean(code)))
      const why = url.searchParams.get('error')
      if (code) settle?.resolve(code)
      else settle?.reject(new AccountError(`Google sign-in did not finish${why ? ` (${why})` : ''}. Try again.`, 'other'))
    }

    const first = createServer(handler)
    await new Promise<void>((resolve, reject) => {
      first.once('error', reject)
      first.listen(0, '127.0.0.1', () => resolve())
    })
    servers.push(first)
    const port = (first.address() as AddressInfo).port
    const second = createServer(handler)
    await new Promise<void>((resolve) => {
      second.once('error', () => resolve()) // no IPv6 loopback here: IPv4 alone will do
      second.listen(port, '::1', () => {
        servers.push(second)
        resolve()
      })
    })

    timer = setTimeout(() => {
      settle?.reject(new AccountError('Google sign-in timed out. Try again.', 'other'))
      close()
    }, GOOGLE_TIMEOUT_MS)
    timer.unref?.()
    cancelGoogle = cancel
    return { port, verifier, close }
  }

  function toUser(u: { id: string; email: string; name?: string | null; image?: string | null } | undefined | null): AccountUser | null {
    return u ? { id: u.id, email: u.email, name: u.name?.trim() || null, image: u.image ?? null } : null
  }

  return {
    configured: (): boolean => Boolean(deps.authUrl),

    /** Who is signed in, checked with the service; signed out when the session has lapsed. */
    async status(): Promise<AccountStatus> {
      if (!deps.authUrl) return { configured: false, user: null, offline: false }
      if (!deps.store.load()) return { configured: true, user: (cached = null), offline: false }
      try {
        const session = await call<{ user?: AccountUser } | null>('/get-session')
        cached = toUser(session?.user)
        if (!cached) deps.store.save(null)
        return { configured: true, user: cached, offline: false }
      } catch (err) {
        // Offline: trust the last known user rather than locking someone out of their own app.
        if (err instanceof AccountError && err.kind === 'network') return { configured: true, user: cached, offline: true }
        throw err
      }
    },

    async signUp(name: string, email: string, password: string): Promise<AccountUser> {
      const r = await call<{ user?: AccountUser }>('/sign-up/email', {
        method: 'POST',
        body: { name: name.trim(), email: email.trim(), password }
      })
      const user = toUser(r.user)
      if (!user) throw new AccountError('The account was created — check your inbox to confirm your email, then sign in.', 'other')
      return (cached = user)
    },

    async signIn(email: string, password: string): Promise<AccountUser> {
      const r = await call<{ user?: AccountUser }>('/sign-in/email', {
        method: 'POST',
        body: { email: email.trim(), password, rememberMe: true }
      })
      const user = toUser(r.user)
      if (!user) throw new AccountError('Sign-in did not complete. Try again.', 'other')
      return (cached = user)
    },

    async signInWithGoogle(): Promise<AccountUser> {
      if (!deps.authUrl) throw new AccountError('Accounts are not set up in this build.', 'not_configured')
      cancelGoogle?.()
      const back = await listenForVerifier()
      try {
        const origin = `http://localhost:${back.port}`
        const r = await call<{ url?: string }>('/sign-in/social', {
          method: 'POST',
          body: { provider: 'google', callbackURL: `${origin}/done`, errorCallbackURL: `${origin}/done` },
          origin
        })
        if (!r.url) throw new AccountError('Google sign-in could not start. Try again.', 'other')
        await deps.openExternal(r.url)
        const verifier = await back.verifier
        const session = await call<{ user?: AccountUser } | null>(`/get-session?${VERIFIER_PARAM}=${encodeURIComponent(verifier)}`, { origin })
        const user = toUser(session?.user)
        if (!user) throw new AccountError('Google sign-in did not complete. Try again.', 'other')
        return (cached = user)
      } finally {
        back.close()
      }
    },

    async signOut(): Promise<void> {
      try {
        if (deps.store.load()) await call('/sign-out', { method: 'POST', body: {} })
      } catch {
        // Signing out locally must work even when the service cannot be reached.
      } finally {
        deps.store.save(null)
        cached = null
      }
    }
  }
}

export type AccountService = ReturnType<typeof accountService>
