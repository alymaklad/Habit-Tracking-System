import type { AccountUser } from '@shared/types'

/**
 * Khatwa accounts, on Neon Auth (Neon's managed Better Auth).
 *
 * The browser never talks to Neon Auth directly: Neon's cookies would be third-party
 * cookies on the app's domain, which browsers increasingly drop. Instead the server
 * calls Neon Auth and keeps Neon's cookie jar sealed inside the app's own httpOnly
 * session cookie. This module is stateless — a jar goes in, an updated jar comes out.
 *
 * Google sign-in uses Neon's own social flow:
 *  1. `startGoogle` asks Neon for the Google URL, with our `/api/auth/google/done` as the
 *     place to come back to. Neon sets a "session challenge" cookie in that response,
 *     which we keep (sealed) until the browser returns.
 *  2. Neon sends the browser back with a one-time `neon_auth_session_verifier`;
 *     `finishGoogle` exchanges it — together with the challenge cookie, so a verifier is
 *     no use to anyone but the browser that started the flow.
 */

const VERIFIER_PARAM = 'neon_auth_session_verifier'

export class AccountError extends Error {
  constructor(
    message: string,
    readonly kind: 'not_configured' | 'credentials' | 'exists' | 'network' | 'other'
  ) {
    super(message)
  }
}

type FetchLike = typeof fetch

export interface Signed {
  user: AccountUser
  /** Neon Auth's cookies for this session, as one `Cookie` header value. */
  jar: string
}

/** Merges a response's Set-Cookie headers into a cookie jar string. */
export function mergeCookies(jar: string | null, res: Response): string | null {
  const set = typeof res.headers.getSetCookie === 'function' ? res.headers.getSetCookie() : []
  if (set.length === 0) return jar
  const map = new Map<string, string>()
  for (const pair of (jar ?? '').split(/;\s*/).filter(Boolean)) {
    const i = pair.indexOf('=')
    if (i > 0) map.set(pair.slice(0, i), pair.slice(i + 1))
  }
  for (const line of set) {
    const [pair, ...attrs] = line.split(';')
    const i = pair!.indexOf('=')
    if (i <= 0) continue
    const name = pair!.slice(0, i).trim()
    const value = pair!.slice(i + 1).trim()
    const expired = attrs.some((a) => /^\s*max-age=0/i.test(a)) || value === ''
    // The session-data cookie is only a cache of what /get-session returns; dropping it
    // keeps the app's own cookie well under the 4 KB browsers allow.
    if (expired || /session_data/i.test(name)) map.delete(name)
    else map.set(name, value)
  }
  return map.size ? [...map].map(([k, v]) => `${k}=${v}`).join('; ') : null
}

function toUser(u: { id: string; email: string; name?: string | null; image?: string | null } | undefined | null): AccountUser | null {
  return u ? { id: u.id, email: u.email, name: u.name?.trim() || null, image: u.image ?? null } : null
}

export function accountService(deps: {
  authUrl: string | null
  /** The app's public origin; must be a trusted domain in Neon Auth. */
  origin: string
  fetchImpl?: FetchLike
}) {
  const doFetch: FetchLike = deps.fetchImpl ?? fetch
  let base: string | null = null

  /** Neon Auth URLs come with and without a trailing `/auth`; find the one that answers. */
  async function resolveBase(): Promise<string> {
    if (base) return base
    if (!deps.authUrl) throw new AccountError('Accounts are not set up on this server (NEON_AUTH_URL).', 'not_configured')
    const root = deps.authUrl.replace(/\/+$/, '')
    for (const candidate of [root, `${root}/auth`]) {
      try {
        const res = await doFetch(`${candidate}/ok`, { headers: { origin: deps.origin } })
        if (res.ok) return (base = candidate)
      } catch {
        throw new AccountError('Could not reach the account service. Try again in a moment.', 'network')
      }
    }
    return (base = root)
  }

  async function call<T>(path: string, init: { method?: string; body?: unknown; jar?: string | null } = {}): Promise<{ data: T; jar: string | null }> {
    const root = await resolveBase()
    const headers: Record<string, string> = { accept: 'application/json', origin: deps.origin }
    if (init.body !== undefined) headers['content-type'] = 'application/json'
    if (init.jar) headers.cookie = init.jar
    let res: Response
    try {
      res = await doFetch(`${root}${path}`, {
        method: init.method ?? 'GET',
        headers,
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        redirect: 'manual'
      })
    } catch {
      throw new AccountError('Could not reach the account service. Try again in a moment.', 'network')
    }
    const jar = mergeCookies(init.jar ?? null, res)
    const data = (await res.json().catch(() => null)) as (T & { message?: string; code?: string }) | null
    if (!res.ok) throw toError(res.status, data?.code, data?.message)
    return { data: data as T, jar }
  }

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
          `The account service refused this site. Add ${deps.origin} to Neon Auth’s trusted domains (see docs/DEPLOY.md).`,
          'other'
        )
    }
    if (status === 429) return new AccountError('Too many attempts. Wait a minute and try again.', 'other')
    return new AccountError(message ? `The account service said: ${message}` : `The account service failed (${status}).`, 'other')
  }

  function signed(user: AccountUser | null, jar: string | null, fallback: string): Signed {
    if (!user || !jar) throw new AccountError(fallback, 'other')
    return { user, jar }
  }

  return {
    configured: (): boolean => Boolean(deps.authUrl),

    /** Who a jar belongs to right now, with the jar Neon wants us to keep; null when signed out. */
    async session(jar: string): Promise<Signed | null> {
      const r = await call<{ user?: AccountUser } | null>('/get-session', { jar })
      const user = toUser(r.data?.user)
      return user && r.jar ? { user, jar: r.jar } : null
    },

    async signUp(name: string, email: string, password: string): Promise<Signed> {
      const r = await call<{ user?: AccountUser }>('/sign-up/email', {
        method: 'POST',
        body: { name: name.trim(), email: email.trim(), password }
      })
      return signed(toUser(r.data.user), r.jar, 'The account was created — check your inbox to confirm your email, then sign in.')
    },

    async signIn(email: string, password: string): Promise<Signed> {
      const r = await call<{ user?: AccountUser }>('/sign-in/email', {
        method: 'POST',
        body: { email: email.trim(), password, rememberMe: true }
      })
      return signed(toUser(r.data.user), r.jar, 'Sign-in did not complete. Try again.')
    },

    /** Neon's Google URL, and the challenge jar to keep until the browser comes back. */
    async startGoogle(callbackURL: string): Promise<{ url: string; jar: string | null }> {
      const r = await call<{ url?: string }>('/sign-in/social', {
        method: 'POST',
        body: { provider: 'google', callbackURL, errorCallbackURL: callbackURL }
      })
      if (!r.data.url) throw new AccountError('Google sign-in could not start. Try again.', 'other')
      return { url: r.data.url, jar: r.jar }
    },

    async finishGoogle(verifier: string, challengeJar: string | null): Promise<Signed> {
      const r = await call<{ user?: AccountUser } | null>(`/get-session?${VERIFIER_PARAM}=${encodeURIComponent(verifier)}`, { jar: challengeJar })
      return signed(toUser(r.data?.user), r.jar, 'Google sign-in did not complete. Try again.')
    },

    /** Best effort: signing out locally must work even when Neon cannot be reached. */
    async signOut(jar: string | null): Promise<void> {
      if (!jar) return
      await call('/sign-out', { method: 'POST', body: {}, jar }).catch(() => undefined)
    },

    verifierParam: VERIFIER_PARAM
  }
}

export type AccountService = ReturnType<typeof accountService>
