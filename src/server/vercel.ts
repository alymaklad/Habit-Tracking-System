import type { IncomingMessage, ServerResponse } from 'node:http'
import { waitUntil } from '@vercel/functions'
import { handle } from './http/handler'

/**
 * The Vercel function behind every `/api/*` route. `waitUntil` keeps the invocation
 * alive for best-effort follow-ups (Google clean-up after a schedule change) that run
 * after the response has already been sent.
 */
export default function khatwaApi(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const done = handle(req, res)
  waitUntil(done)
  return done
}
