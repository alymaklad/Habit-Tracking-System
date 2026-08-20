import { createHash, randomBytes } from 'node:crypto'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { shell } from 'electron'
import type { StoredTokens, TokenVault } from './tokenVault'
import type { SyncRepo } from '../persistence/syncRepo'

/**
 * Google OAuth 2.0 for an installed app.
 *
 * Google retired both the out-of-band flow and custom URI schemes, so the only
 * supported redirect for a Windows desktop app is a loopback listener on
 * `http://127.0.0.1:<port>` combined with PKCE. The client secret for an installed app
 * is not a secret — Google's own documentation says such apps "cannot keep secrets" —
 * so PKCE, not the secret, is what protects the code exchange.
 */

/**
 * The permissions this app asks for, and nothing else.
 *
 * `tasks` is the completion signal — the only Google resource that has one.
 *
 * `calendar.app.created` is write-only reminder delivery, scoped to a secondary
 * calendar THIS APP creates: "Make secondary Google calendars, and see, create, change,
 * and delete events on them." It cannot see or touch existing calendars. It exists
 * because a Google Task stores no time of day, and a date-only task fires no timed
 * notification on a phone — so a mirrored calendar event is the only native way to
 * deliver "German starts in 30 minutes" to mobile.
 */
export const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks'
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created'

export const SCOPES = [TASKS_SCOPE, CALENDAR_SCOPE] as const
export const SCOPE = SCOPES.join(' ')

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo'

const CONSENT_TIMEOUT_MS = 5 * 60_000

/** Thrown when Google has revoked our refresh token and the user must reconnect. */
export class ReauthRequired extends Error {
  constructor(message = 'Google connection expired') {
    super(message)
    this.name = 'ReauthRequired'
  }
}

export interface AuthCredentials {
  clientId: string
  /** Optional for installed apps; present when the Cloud console issues one. */
  clientSecret?: string
}

const base64url = (b: Buffer): string =>
  b.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function pkce(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(32))
  const challenge = base64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

const closePage = (ok: boolean, detail: string): string => `<!doctype html>
<meta charset="utf-8">
<title>${ok ? 'Connected' : 'Connection failed'}</title>
<style>
  body { margin:0; height:100vh; display:grid; place-items:center; background:#141018;
         color:#eee; font-family:system-ui,sans-serif; }
  .card { text-align:center; padding:40px 48px; border:1px solid #322b3a; background:#1c1722; }
  h1 { font-size:18px; margin:0 0 10px; letter-spacing:.03em; text-transform:uppercase; }
  p { font-size:13px; color:#a99fb4; margin:0; }
</style>
<div class="card">
  <h1>${ok ? 'Adaptive Habit League is connected' : 'Connection failed'}</h1>
  <p>${detail}</p>
</div>`

export function authService(deps: {
  vault: TokenVault
  sync: SyncRepo
  credentials: () => AuthCredentials | null
}) {
  const { vault, sync } = deps
  let inFlight: Server | null = null

  function creds(): AuthCredentials {
    const c = deps.credentials()
    if (!c?.clientId) {
      throw new Error(
        'No Google OAuth client is configured. See docs/GOOGLE_SETUP.md — create a Desktop app client and set GOOGLE_CLIENT_ID.'
      )
    }
    return c
  }

  function postForm(url: string, body: Record<string, string>): Promise<Response> {
    return fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(body).toString()
    })
  }

  async function fetchAccount(accessToken: string): Promise<string | null> {
    try {
      const res = await fetch(USERINFO_ENDPOINT, {
        headers: { authorization: `Bearer ${accessToken}` }
      })
      if (!res.ok) return null
      const json = (await res.json()) as { email?: string }
      return json.email ?? null
    } catch {
      return null
    }
  }

  /** Runs the loopback listener and resolves with the code plus the exact redirect used. */
  function awaitAuthorizationCode(
    clientId: string,
    challenge: string,
    state: string
  ): Promise<{ code: string; redirectUri: string }> {
    return new Promise((resolve, reject) => {
      let redirectUri = ''

      const server = createServer((req, res) => {
        const url = new URL(req.url ?? '/', 'http://127.0.0.1')
        if (url.pathname !== '/callback') {
          res.writeHead(404).end()
          return
        }

        const finish = (ok: boolean, detail: string): void => {
          res.writeHead(ok ? 200 : 400, { 'content-type': 'text/html; charset=utf-8' })
          res.end(closePage(ok, detail))
          setImmediate(() => server.close())
          inFlight = null
        }

        const error = url.searchParams.get('error')
        const returnedState = url.searchParams.get('state')
        const code = url.searchParams.get('code')

        if (error) {
          finish(false, 'You can close this tab and try again from the app.')
          reject(new Error(`Google returned "${error}"`))
        } else if (returnedState !== state) {
          // A mismatched state means this response is not ours: never exchange it.
          finish(false, 'Security check failed. You can close this tab.')
          reject(new Error('OAuth state mismatch'))
        } else if (!code) {
          finish(false, 'No authorization code was returned.')
          reject(new Error('No authorization code returned'))
        } else {
          finish(true, 'You can close this tab and go back to the app.')
          resolve({ code, redirectUri })
        }
      })

      server.on('error', reject)

      // Port 0 lets the OS pick a free port; binding 127.0.0.1 keeps it off the network.
      server.listen(0, '127.0.0.1', () => {
        inFlight = server
        const { port } = server.address() as AddressInfo
        redirectUri = `http://127.0.0.1:${port}/callback`

        const auth = new URL(AUTH_ENDPOINT)
        auth.searchParams.set('client_id', clientId)
        auth.searchParams.set('redirect_uri', redirectUri)
        auth.searchParams.set('response_type', 'code')
        auth.searchParams.set('scope', SCOPE)
        auth.searchParams.set('code_challenge', challenge)
        auth.searchParams.set('code_challenge_method', 'S256')
        auth.searchParams.set('state', state)
        auth.searchParams.set('access_type', 'offline')
        // Force consent so a refresh token is issued even on a re-connect, where
        // Google would otherwise return an access token only.
        auth.searchParams.set('prompt', 'consent')

        // System browser, never an embedded window: an Electron webview breaks Google's
        // policy and hides the address bar the user needs in order to trust the page.
        void shell.openExternal(auth.toString())
      })

      setTimeout(() => {
        if (inFlight === server) {
          server.close()
          inFlight = null
          reject(new Error('Timed out waiting for Google authorization'))
        }
      }, CONSENT_TIMEOUT_MS).unref()
    })
  }

  return {
    isConnected(): boolean {
      return vault.load() !== null
    },

    account(): string | null {
      return vault.account()
    },

    cancel(): void {
      if (inFlight) {
        inFlight.close()
        inFlight = null
      }
    },

    /** Opens the system browser, waits for the loopback redirect, stores the tokens. */
    async connect(): Promise<StoredTokens> {
      const { clientId, clientSecret } = creds()
      this.cancel()

      const { verifier, challenge } = pkce()
      const state = base64url(randomBytes(16))
      const { code, redirectUri } = await awaitAuthorizationCode(clientId, challenge, state)

      const body: Record<string, string> = {
        client_id: clientId,
        code,
        code_verifier: verifier,
        grant_type: 'authorization_code',
        redirect_uri: redirectUri
      }
      if (clientSecret) body.client_secret = clientSecret

      const res = await postForm(TOKEN_ENDPOINT, body)
      if (!res.ok) {
        throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`)
      }

      const json = (await res.json()) as {
        access_token: string
        refresh_token?: string
        expires_in: number
        scope?: string
      }

      if (!json.refresh_token) {
        throw new Error(
          'Google did not return a refresh token. Remove this app at myaccount.google.com/permissions and connect again.'
        )
      }

      const tokens: StoredTokens = {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expiresAt: Date.now() + json.expires_in * 1000,
        scope: json.scope ?? SCOPE,
        account: await fetchAccount(json.access_token)
      }

      vault.save(tokens)
      sync.log('info', `Connected to Google as ${tokens.account ?? 'an unknown account'}`)
      return tokens
    },

    /** A valid access token, refreshing first when the current one is near expiry. */
    async accessToken(): Promise<string> {
      const tokens = vault.load()
      if (!tokens) throw new ReauthRequired('Not connected to Google')

      // Refresh a minute early so a long request cannot straddle the expiry.
      if (Date.now() < tokens.expiresAt - 60_000) return tokens.accessToken

      const { clientId, clientSecret } = creds()
      const body: Record<string, string> = {
        client_id: clientId,
        refresh_token: tokens.refreshToken,
        grant_type: 'refresh_token'
      }
      if (clientSecret) body.client_secret = clientSecret

      const res = await postForm(TOKEN_ENDPOINT, body)
      if (!res.ok) {
        const text = await res.text()
        // `invalid_grant` is what Google returns once it has revoked the refresh token,
        // which it does every 7 days while the consent screen is still in Testing.
        if (text.includes('invalid_grant')) {
          sync.log('error', 'Google refresh token rejected (invalid_grant) — reconnect required')
          throw new ReauthRequired()
        }
        throw new Error(`Token refresh failed: ${res.status} ${text}`)
      }

      const json = (await res.json()) as {
        access_token: string
        expires_in: number
        scope?: string
        refresh_token?: string
      }

      const next: StoredTokens = {
        accessToken: json.access_token,
        // Google re-issues a refresh token only occasionally; keep the old one otherwise.
        refreshToken: json.refresh_token ?? tokens.refreshToken,
        expiresAt: Date.now() + json.expires_in * 1000,
        scope: json.scope ?? tokens.scope,
        account: tokens.account
      }
      vault.save(next)
      return next.accessToken
    },

    /**
     * Revokes the token with Google and forgets it locally. Habit history is
     * deliberately untouched — erasing it is a separate, explicitly confirmed action.
     */
    async disconnect(): Promise<void> {
      const tokens = vault.load()
      if (tokens) {
        try {
          await postForm(REVOKE_ENDPOINT, { token: tokens.refreshToken })
        } catch {
          // A revoke that cannot reach Google still clears the local copy; the token
          // expires on its own and the user is no worse off.
        }
      }
      vault.clear()
      sync.resetAll()
      sync.clearQueue()
      sync.log('info', 'Disconnected from Google; local history preserved')
    }
  }
}

export type AuthService = ReturnType<typeof authService>
