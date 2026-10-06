import { createHash, randomBytes } from 'node:crypto'
import type { StoredTokens, TokenVault } from './tokenVault'
import type { SyncRepo } from '../persistence/syncRepo'
import { open, seal } from '../platform/secretBox'

/**
 * Google OAuth for linking Tasks and Calendar — the standard web flow.
 *
 *  1. `begin` builds Google's consent URL with PKCE and a random `state`, and returns a
 *     sealed value the HTTP layer keeps in a short-lived, httpOnly cookie.
 *  2. Google redirects back to `/api/google/callback`; `complete` checks the state
 *     against that cookie (a mismatch means the response is not ours) and exchanges the
 *     code. The tokens are stored sealed.
 *
 * Scopes stay as narrow as the features need:
 *  - `tasks` for the sync itself;
 *  - `calendar.app.created` for the reminder mirror — it can only see calendars this app
 *    created, never the user's own.
 */

export const TASKS_SCOPE = 'https://www.googleapis.com/auth/tasks'
export const CALENDAR_SCOPE = 'https://www.googleapis.com/auth/calendar.app.created'

export const SCOPES = [TASKS_SCOPE, CALENDAR_SCOPE] as const
export const SCOPE = SCOPES.join(' ')

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token'
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke'

const FLOW_PURPOSE = 'google-oauth-flow'
const FLOW_TTL_MS = 10 * 60_000

/** Thrown when the refresh token is gone or revoked — the UI should offer reconnect. */
export class ReauthRequired extends Error {
  constructor(message = 'Google connection expired') {
    super(message)
    this.name = 'ReauthRequired'
  }
}

export interface AuthCredentials {
  clientId: string
  clientSecret?: string
}

const base64url = (b: Buffer): string => b.toString('base64url')

interface Flow {
  state: string
  verifier: string
  redirectUri: string
  /** The account that started the flow; the callback must be the same account. */
  owner: string
  exp: number
}

export function authService(deps: {
  vault: TokenVault
  sync: SyncRepo
  credentials: () => AuthCredentials | null
}) {
  const { vault, sync } = deps

  function creds(): AuthCredentials {
    const c = deps.credentials()
    if (!c?.clientId) {
      throw new Error('Google is not set up on this server. See docs/GOOGLE_SETUP.md — set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.')
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

  return {
    async isConnected(): Promise<boolean> {
      return (await vault.load()) !== null
    },

    account(): Promise<string | null> {
      return vault.account()
    },

    /** The consent URL to send the browser to, and the sealed flow for the cookie. */
    begin(redirectUri: string, owner: string): { url: string; flow: string } {
      const { clientId } = creds()
      const verifier = base64url(randomBytes(32))
      const challenge = base64url(createHash('sha256').update(verifier).digest())
      const state = base64url(randomBytes(16))

      const auth = new URL(AUTH_ENDPOINT)
      auth.searchParams.set('client_id', clientId)
      auth.searchParams.set('redirect_uri', redirectUri)
      auth.searchParams.set('response_type', 'code')
      auth.searchParams.set('scope', SCOPE)
      auth.searchParams.set('code_challenge', challenge)
      auth.searchParams.set('code_challenge_method', 'S256')
      auth.searchParams.set('state', state)
      auth.searchParams.set('access_type', 'offline')
      // Force consent so a refresh token is issued even on a re-connect, where Google
      // would otherwise return an access token only.
      auth.searchParams.set('prompt', 'consent')

      const flow: Flow = { state, verifier, redirectUri, owner, exp: Date.now() + FLOW_TTL_MS }
      return { url: auth.toString(), flow: seal(FLOW_PURPOSE, JSON.stringify(flow)) }
    },

    /** Finishes the flow started by `begin`. Throws a readable error on any mismatch. */
    async complete(params: { code: string | null; state: string | null; error: string | null }, sealedFlow: string | null, owner: string): Promise<StoredTokens> {
      if (params.error) throw new Error(`Google returned "${params.error}"`)
      const raw = sealedFlow ? open(FLOW_PURPOSE, sealedFlow) : null
      const flow = raw ? (JSON.parse(raw) as Flow) : null
      // A missing or mismatched state means this response is not one we asked for.
      if (!flow || flow.exp < Date.now() || flow.state !== params.state || flow.owner !== owner) {
        throw new Error('That Google sign-in link has expired or was not started here. Try again.')
      }
      if (!params.code) throw new Error('Google did not return an authorization code')

      const { clientId, clientSecret } = creds()
      const body: Record<string, string> = {
        client_id: clientId,
        code: params.code,
        code_verifier: flow.verifier,
        grant_type: 'authorization_code',
        redirect_uri: flow.redirectUri
      }
      if (clientSecret) body.client_secret = clientSecret

      const res = await postForm(TOKEN_ENDPOINT, body)
      if (!res.ok) throw new Error(`Token exchange failed: ${res.status} ${await res.text()}`)

      const json = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope?: string }
      if (!json.refresh_token) {
        throw new Error('Google did not return a refresh token. Remove Khatwa at myaccount.google.com/permissions and connect again.')
      }

      const tokens: StoredTokens = {
        accessToken: json.access_token,
        refreshToken: json.refresh_token,
        expiresAt: Date.now() + json.expires_in * 1000,
        scope: json.scope ?? SCOPE,
        account: null
      }
      await vault.save(tokens)
      await sync.log('info', 'Connected to Google')
      return tokens
    },

    /** A valid access token, refreshing first if it is about to expire. */
    async accessToken(): Promise<string> {
      const tokens = await vault.load()
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
          await sync.log('error', 'Google refresh token rejected (invalid_grant) — reconnect required')
          throw new ReauthRequired()
        }
        throw new Error(`Token refresh failed: ${res.status} ${text}`)
      }

      const json = (await res.json()) as { access_token: string; expires_in: number; scope?: string; refresh_token?: string }
      const next: StoredTokens = {
        accessToken: json.access_token,
        // Google re-issues a refresh token only occasionally; keep the old one otherwise.
        refreshToken: json.refresh_token ?? tokens.refreshToken,
        expiresAt: Date.now() + json.expires_in * 1000,
        scope: json.scope ?? tokens.scope,
        account: tokens.account
      }
      await vault.save(next)
      return next.accessToken
    },

    /** Revoke at Google (best effort) and forget the tokens. Local history is untouched. */
    async disconnect(): Promise<void> {
      const tokens = await vault.load()
      if (tokens) {
        try {
          await postForm(REVOKE_ENDPOINT, { token: tokens.refreshToken })
        } catch {
          // A revoke that cannot reach Google still clears the local copy; the token
          // expires on its own and the user is no worse off.
        }
      }
      await vault.clear()
      await sync.resetAll()
      await sync.clearQueue()
      await sync.log('info', 'Disconnected from Google; local history preserved')
    }
  }
}

export type AuthService = ReturnType<typeof authService>
