import { describe, expect, it } from 'vitest'
import { accountService, mergeCookies } from '@server/account/accountService'

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown }

/** A tiny Better Auth stand-in: endpoints live under `/auth`, as on some Neon projects. */
function fakeNeonAuth() {
  const calls: Call[] = []
  const users = new Map<string, { id: string; email: string; name: string; password: string }>()
  let session: string | null = null
  let down = false
  let googleCallback: string | null = null
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
        // Neon's redirect flow: note where to send the browser back, and set the
        // challenge cookie the verifier exchange will require.
        if (body.provider !== 'google' || !String(body.callbackURL).startsWith('https://khatwa.example/')) return json(400, { code: 'INVALID_CALLBACKURL' })
        googleCallback = body.callbackURL
        return json(200, { url: 'https://auth.example/auth/sign-in/social/init?token=t1', redirect: true }, '__Secure-neon-auth.session_challenge=ch1; Path=/; HttpOnly; Secure')
      }
      case '/auth/get-session?neon_auth_session_verifier=v1': {
        if (!headers.cookie?.includes('__Secure-neon-auth.session_challenge=ch1')) return json(401, { code: 'SESSION_CHALLENGE_COOKIE_NOT_FOUND' })
        session = 's-google'
        return json(200, { session: {}, user: { id: 'g1', email: 'aly@gmail.com', name: 'Aly', image: 'https://x/y.png' } }, `__Secure-neonauth.session_token=${session}; Path=/`)
      }
      case '/auth/get-session':
        return json(200, signedIn ? { session: {}, user: { id: 'u1', email: 'aly@example.com', name: 'Aly' } } : null)
      case '/auth/sign-out':
        session = null
        return json(200, { success: true }, '__Secure-neonauth.session_token=; Max-Age=0; Path=/')
    }
    return json(404, {})
  }
  return { calls, impl: impl as unknown as typeof fetch, goDown: () => void (down = true), googleCallback: () => googleCallback }
}

const ORIGIN = 'https://khatwa.example'

const make = () => {
  const neon = fakeNeonAuth()
  const account = accountService({ authUrl: 'https://auth.example/', origin: ORIGIN, fetchImpl: neon.impl })
  return { neon, account }
}

describe('accountService', () => {
  it('refuses plainly without an auth URL', async () => {
    const account = accountService({ authUrl: null, origin: ORIGIN })
    expect(account.configured()).toBe(false)
    await expect(account.signIn('a@b.c', 'x')).rejects.toMatchObject({ kind: 'not_configured' })
  })

  it('finds the endpoints under /auth, signs up, and hands back the session jar', async () => {
    const { neon, account } = make()
    const { user, jar } = await account.signUp(' Aly ', 'aly@example.com', 'correct horse')
    expect(user).toEqual({ id: 'u1', email: 'aly@example.com', name: 'Aly', image: null })
    expect(neon.calls.find((c) => c.url.endsWith('/auth/sign-up/email'))!.body).toEqual({ name: 'Aly', email: 'aly@example.com', password: 'correct horse' })
    expect(jar).toBe('__Secure-neonauth.session_token=s-u1')

    const session = await account.session(jar)
    expect(session?.user.email).toBe('aly@example.com')
    expect(neon.calls.at(-1)!.headers.cookie).toBe(jar)
  })

  it('says plainly when the email is taken or the password is wrong', async () => {
    const { account } = make()
    await account.signUp('Aly', 'aly@example.com', 'correct horse')
    await expect(account.signUp('Aly', 'aly@example.com', 'x')).rejects.toThrow('already exists — sign in instead')
    await expect(account.signIn('aly@example.com', 'wrong')).rejects.toThrow('do not match an account')
  })

  it('signs in with Google: the start keeps the challenge cookie, the verifier needs it', async () => {
    const { neon, account } = make()
    const start = await account.startGoogle(`${ORIGIN}/api/auth/google/done`)
    expect(start.url).toBe('https://auth.example/auth/sign-in/social/init?token=t1')
    expect(start.jar).toContain('session_challenge=ch1')
    expect(neon.calls.find((c) => c.url.endsWith('/auth/sign-in/social'))!.body).toMatchObject({ provider: 'google', callbackURL: `${ORIGIN}/api/auth/google/done` })

    // Without the challenge cookie a stolen verifier is worthless.
    await expect(account.finishGoogle('v1', null)).rejects.toThrow()
    const done = await account.finishGoogle('v1', start.jar)
    expect(done.user).toMatchObject({ email: 'aly@gmail.com', image: 'https://x/y.png' })
    expect(done.jar).toContain('__Secure-neonauth.session_token=s-google')
  })

  it('reports a signed-out jar as no session', async () => {
    const { account } = make()
    expect(await account.session('__Secure-neonauth.session_token=nope')).toBeNull()
  })

  it('reports an unreachable service as a network error', async () => {
    const { neon, account } = make()
    const { jar } = await account.signUp('Aly', 'aly@example.com', 'correct horse')
    neon.goDown()
    await expect(account.session(jar)).rejects.toMatchObject({ kind: 'network' })
  })

  it('signs out without failing when the service cannot be reached', async () => {
    const { neon, account } = make()
    const { jar } = await account.signUp('Aly', 'aly@example.com', 'correct horse')
    neon.goDown()
    await expect(account.signOut(jar)).resolves.toBeUndefined()
  })

  it('sends the app’s own origin, which must be a trusted domain in Neon Auth', async () => {
    const { neon, account } = make()
    await account.signUp('Aly', 'aly@example.com', 'correct horse')
    expect(neon.calls.every((c) => c.headers.origin === ORIGIN)).toBe(true)
  })
})

describe('mergeCookies', () => {
  const res = (...cookies: string[]): Response => {
    const headers = new Headers()
    for (const c of cookies) headers.append('set-cookie', c)
    return new Response(null, { headers })
  }

  it('adds, replaces and expires cookies', () => {
    let jar = mergeCookies(null, res('a=1; Path=/', 'b=2'))
    expect(jar).toBe('a=1; b=2')
    jar = mergeCookies(jar, res('a=3', 'b=; Max-Age=0'))
    expect(jar).toBe('a=3')
  })

  it('drops the session-data cache cookie so the app cookie stays small', () => {
    expect(mergeCookies(null, res('x.session_token=t', 'x.session_data=' + 'z'.repeat(3000)))).toBe('x.session_token=t')
  })
})
