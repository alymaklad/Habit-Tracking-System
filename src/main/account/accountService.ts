import type { AccountStatus, AccountUser } from '@shared/types'

/**
 * Khatwa accounts, backed by Neon Auth (managed Better Auth).
 *
 * Better Auth is built for browsers: it keeps the session in an HttpOnly cookie. A desktop
 * app has no such cookie jar, so the main process talks to the REST API itself, keeps the
 * session cookie it is given (encrypted at rest, never handed to the UI process) and sends
 * it back on each request. The renderer only ever sees who is signed in.
 *
 * Google sign-in: the app gets a Google ID token through its own browser-based sign-in
 * and hands it to Neon Auth, which verifies it with Google. The ID token's audience is the
 * app's Google client, so Neon Auth's Google provider must be configured with that client.
 */

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
  googleIdToken: () => Promise<string>
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

  function headers(extra: Record<string, string> = {}): Record<string, string> {
    const h: Record<string, string> = { accept: 'application/json', ...extra }
    if (deps.origin) h.origin = deps.origin
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

  async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const root = await resolveBase()
    let res: Response
    try {
      res = await doFetch(`${root}${path}`, {
        method: init.method ?? 'GET',
        headers: headers(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
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
      const token = await deps.googleIdToken()
      const r = await call<{ user?: AccountUser; redirect?: boolean }>('/sign-in/social', {
        method: 'POST',
        body: { provider: 'google', idToken: { token } }
      })
      const user = toUser(r.user)
      if (!user) throw new AccountError('Google sign-in did not complete. Try again.', 'other')
      return (cached = user)
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
