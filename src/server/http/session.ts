import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AccountUser } from '@shared/types'
import { open, seal } from '../platform/secretBox'

/**
 * The app's own session: one httpOnly cookie holding, sealed, who is signed in and the
 * Neon Auth cookie jar that proves it. The server re-checks the jar with Neon every
 * REVALIDATE_MS, so signing out elsewhere (or a revoked session) takes effect quickly
 * without a round trip to Neon on every request.
 */

export interface Session {
  user: AccountUser
  jar: string
  /** Epoch ms when Neon last confirmed this session. */
  checkedAt: number
}

export const REVALIDATE_MS = 15 * 60_000
const MAX_AGE_S = 60 * 60 * 24 * 30
const PURPOSE = 'session'

/** Cookies get the `__Host-` prefix (HTTPS only, this host only) wherever HTTPS is in use. */
export function cookieName(base: string, secure: boolean): string {
  return secure ? `__Host-${base}` : base
}

export function isSecure(req: IncomingMessage): boolean {
  const proto = (req.headers['x-forwarded-proto'] as string | undefined)?.split(',')[0]?.trim()
  return proto === 'https'
}

export function parseCookies(req: IncomingMessage): Map<string, string> {
  const out = new Map<string, string>()
  for (const part of (req.headers.cookie ?? '').split(/;\s*/)) {
    const i = part.indexOf('=')
    if (i > 0) out.set(part.slice(0, i), decodeURIComponent(part.slice(i + 1)))
  }
  return out
}

export function setCookie(
  res: ServerResponse,
  req: IncomingMessage,
  base: string,
  value: string | null,
  opts: { maxAgeS?: number } = {}
): void {
  const secure = isSecure(req)
  const parts = [
    `${cookieName(base, secure)}=${value === null ? '' : encodeURIComponent(value)}`,
    'Path=/',
    'HttpOnly',
    'SameSite=Lax',
    `Max-Age=${value === null ? 0 : (opts.maxAgeS ?? MAX_AGE_S)}`
  ]
  if (secure) parts.push('Secure')
  const prev = res.getHeader('set-cookie')
  const list = Array.isArray(prev) ? prev : prev ? [String(prev)] : []
  res.setHeader('set-cookie', [...list, parts.join('; ')])
}

export function readCookie(req: IncomingMessage, base: string): string | null {
  return parseCookies(req).get(cookieName(base, isSecure(req))) ?? null
}

export function readSession(req: IncomingMessage): Session | null {
  const raw = readCookie(req, 'khatwa_session')
  const json = raw ? open(PURPOSE, raw) : null
  if (!json) return null
  try {
    const s = JSON.parse(json) as Session
    return s?.user?.id && s.jar ? s : null
  } catch {
    return null
  }
}

export function writeSession(res: ServerResponse, req: IncomingMessage, session: Session | null): void {
  setCookie(res, req, 'khatwa_session', session ? seal(PURPOSE, JSON.stringify(session)) : null)
}

/** A short-lived sealed value that rides along an OAuth round trip. */
export function writeFlowCookie(res: ServerResponse, req: IncomingMessage, name: string, value: string | null): void {
  setCookie(res, req, name, value, { maxAgeS: 10 * 60 })
}

export const sealFlow = (purpose: string, value: unknown): string => seal(purpose, JSON.stringify(value))
export function openFlow<T>(purpose: string, raw: string | null): T | null {
  const json = raw ? open(purpose, raw) : null
  try {
    return json ? (JSON.parse(json) as T) : null
  } catch {
    return null
  }
}
