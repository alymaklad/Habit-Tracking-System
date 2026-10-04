import { describe, expect, it } from 'vitest'
import { accountService, type SessionStore } from '@main/account/accountService'

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown }

/** A tiny Better Auth stand-in: endpoints live under `/auth`, as on some Neon projects. */
function fakeNeonAuth() {
  const calls: Call[] = []
  const users = new Map<string, { id: string; email: string; name: string; password: string }>()
  let session: string | null = null
  let down = false
  const json = (status: number, data: unknown, cookie?: string): Response => {
    const headers = new Headers({ 'content-type': 'application/json' })
    if (cookie !== undefined) headers.append('set-cookie', cookie)
    return new Response(JSON.stringify(data), { status, headers })
  }
  const impl = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input)
    const headers = Object.fromEntries(Object.entries((init?.headers as Record<string, string>) ?? {}).map(([k, v]) => [k.toLowerCase(), v]))
    const body = init?.body ? JSON.parse(String(init.body)) : null
    calls.push({ url, method: init?.method ?? 'GET', headers, body })
    if (down) throw new TypeError('fetch failed')
    const path = url.replace('https://auth.example', '')
    if (path === '/ok') return new Response('not found', { status: 404 })
    if (path === '/auth/ok') return json(200, { ok: true })
    const signedIn = session && headers.cookie?.includes(`__Secure-neonauth.session_token=${session}`)
    switch (path) {
      case '/auth/sign-up/email': {
        if (users.has(body.email)) return json(422, { code: 'USER_ALREADY_EXISTS', message: 'User already exists' })
        const user = { id: `u${users.size + 1}`, email: body.email, name: body.name, password: body.password }
        users.set(body.email, user)
        session = `s-${user.id}`
        return json(200, { user: { id: user.id, email: user.email, name: user.name } }, `__Secure-neonauth.session_token=${session}; Path=/; HttpOnly; Secure; SameSite=None`)
      }
      case '/auth/sign-in/email': {
        const u = users.get(body.email)
        if (!u || u.password !== body.password) return json(401, { code: 'INVALID_EMAIL_OR_PASSWORD', message: 'Invalid email or password' })
        session = `s-${u.id}`
        return json(200, { user: { id: u.id, email: u.email, name: u.name } }, `__Secure-neonauth.session_token=${session}; Path=/; HttpOnly`)
      }
      case '/auth/sign-in/social': {
        if (body.provider !== 'google' || body.idToken?.token !== 'google-id-token') return json(401, { code: 'INVALID_TOKEN' })
        session = 's-google'
        return json(200, { redirect: false, user: { id: 'g1', email: 'aly@gmail.com', name: 'Aly', image: 'https://x/y.png' } }, `__Secure-neonauth.session_token=${session}; Path=/`)
      }
      case '/auth/get-session':
        return json(200, signedIn ? { session: {}, user: { id: 'u1', email: 'aly@example.com', name: 'Aly' } } : null)
      case '/auth/sign-out':
        session = null
        return json(200, { success: true }, '__Secure-neonauth.session_token=; Max-Age=0; Path=/')
    }
    return json(404, {})
  }
  return { calls, impl: impl as unknown as typeof fetch, goDown: () => void (down = true) }
}

function memoryStore(): SessionStore & { value: string | null } {
  return {
    value: null,
    load() {
      return this.value
    },
    save(v) {
      this.value = v
    }
  }
}

const make = (opts: { origin?: string } = {}) => {
  const neon = fakeNeonAuth()
  const store = memoryStore()
  const account = accountService({
    authUrl: 'https://auth.example/',
    origin: opts.origin ?? null,
    store,
    googleIdToken: async () => 'google-id-token',
    fetchImpl: neon.impl
  })
  return { neon, store, account }
}

describe('accountService', () => {
  it('reports "not configured" without an auth URL, instead of failing', async () => {
    const account = accountService({ authUrl: null, store: memoryStore(), googleIdToken: async () => '' })
    expect(await account.status()).toEqual({ configured: false, user: null, offline: false })
    await expect(account.signIn('a@b.c', 'x')).rejects.toMatchObject({ kind: 'not_configured' })
  })

  it('finds the endpoints under /auth, signs up, and keeps the session for the next request', async () => {
    const { neon, store, account } = make()
    const user = await account.signUp(' Aly ', 'aly@example.com', 'correct horse')
    expect(user).toEqual({ id: 'u1', email: 'aly@example.com', name: 'Aly', image: null })
    expect(neon.calls.find((c) => c.url.endsWith('/auth/sign-up/email'))!.body).toEqual({ name: 'Aly', email: 'aly@example.com', password: 'correct horse' })
    expect(store.value).toBe('__Secure-neonauth.session_token=s-u1')

    const status = await account.status()
    expect(status.user?.email).toBe('aly@example.com')
    expect(neon.calls.at(-1)!.headers.cookie).toBe('__Secure-neonauth.session_token=s-u1')
  })

  it('says plainly when the email is taken or the password is wrong', async () => {
    const { account } = make()
    await account.signUp('Aly', 'aly@example.com', 'correct horse')
    await expect(account.signUp('Aly', 'aly@example.com', 'x')).rejects.toThrow('already exists — sign in instead')
    await expect(account.signIn('aly@example.com', 'wrong')).rejects.toThrow('do not match an account')
  })

  it('signs in with a Google ID token', async () => {
    const { neon, account } = make()
    const user = await account.signInWithGoogle()
    expect(user).toMatchObject({ email: 'aly@gmail.com', image: 'https://x/y.png' })
    expect(neon.calls.at(-1)!.body).toEqual({ provider: 'google', idToken: { token: 'google-id-token' } })
  })

  it('keeps the last known user while offline rather than locking them out', async () => {
    const { neon, account } = make()
    await account.signUp('Aly', 'aly@example.com', 'correct horse')
    await account.status()
    neon.goDown()
    expect(await account.status()).toMatchObject({ offline: true, user: { email: 'aly@example.com' } })
  })

  it('signs out locally even when the service cannot be reached', async () => {
    const { neon, store, account } = make()
    await account.signUp('Aly', 'aly@example.com', 'correct horse')
    neon.goDown()
    await account.signOut()
    expect(store.value).toBeNull()
    expect((await account.status()).user).toBeNull()
  })

  it('drops the session when the service clears its cookie', async () => {
    const { store, account } = make()
    await account.signUp('Aly', 'aly@example.com', 'correct horse')
    await account.signOut()
    expect(store.value).toBeNull()
  })

  it('sends the configured Origin header', async () => {
    const { neon, account } = make({ origin: 'https://khatwa.app' })
    await account.signUp('Aly', 'aly@example.com', 'correct horse')
    expect(neon.calls.every((c) => c.headers.origin === 'https://khatwa.app')).toBe(true)
  })
})
