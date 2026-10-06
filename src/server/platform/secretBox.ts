import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto'

/**
 * AES-256-GCM with a key derived from APP_SECRET. Used for everything the server keeps
 * that would hurt if the database leaked on its own: Google refresh tokens, the Neon
 * Auth session cookie inside the app's own cookie, and pasted AI API keys.
 *
 * Output: base64url(iv ‖ tag ‖ ciphertext). Tampering or a different secret makes
 * `open` return null rather than throw, so callers treat it as "not there".
 */

const IV = 12
const TAG = 16

function key(purpose: string): Buffer {
  const secret = process.env.APP_SECRET
  if (!secret || secret.length < 32) {
    throw new Error('APP_SECRET is not set (or shorter than 32 characters). Generate one with `openssl rand -base64 48`.')
  }
  // One key per purpose, so a value sealed for one use cannot be replayed as another.
  return createHash('sha256').update(`${purpose}\0${secret}`).digest()
}

export function seal(purpose: string, plaintext: string): string {
  const iv = randomBytes(IV)
  const cipher = createCipheriv('aes-256-gcm', key(purpose), iv)
  const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString('base64url')
}

export function open(purpose: string, sealed: string): string | null {
  try {
    const buf = Buffer.from(sealed, 'base64url')
    if (buf.length < IV + TAG) return null
    const decipher = createDecipheriv('aes-256-gcm', key(purpose), buf.subarray(0, IV))
    decipher.setAuthTag(buf.subarray(IV, IV + TAG))
    return Buffer.concat([decipher.update(buf.subarray(IV + TAG)), decipher.final()]).toString('utf8')
  } catch {
    return null
  }
}
