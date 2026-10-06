import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { del, get, head } from '@vercel/blob'

export const ATTACHMENT_TYPES: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
export const ATTACHMENT_EXTENSIONS = [...Object.keys(ATTACHMENT_TYPES), 'jpeg']

/** The only names this app ever stores: a random UUID and a known extension. */
const STORED_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.([a-z]{2,4})$/

/** The extension a file is stored under, or null when that kind of file is not accepted. */
export function storedExtension(originalName: string): string | null {
  const ext = /\.([a-z0-9]+)$/i.exec(originalName)?.[1]?.toLowerCase()
  if (!ext) return null
  const normal = ext === 'jpeg' ? 'jpg' : ext
  return ATTACHMENT_TYPES[normal] ? normal : null
}

/** A fresh name for an upload; the browser uploads under exactly this name. */
export function newStoredName(originalName: string): string {
  const ext = storedExtension(originalName)
  if (!ext) throw new Error(`${originalName} can’t be attached — use an image, PDF, text or Office file.`)
  return `${randomUUID()}.${ext}`
}

export function mimeFor(storedName: string): string | null {
  const ext = STORED_NAME.exec(storedName)?.[1]
  return ext ? (ATTACHMENT_TYPES[ext] ?? null) : null
}

export interface StoredFile {
  body: ReadableStream<Uint8Array> | Buffer
  mime: string
  size: number
}

/**
 * Where journal files live, scoped to one account. Files are never public: the browser
 * reaches them only through `/api/files/…`, which checks the session first.
 */
export interface AttachmentStore {
  /** The size of a stored file, or null when nothing was uploaded under that name. */
  size(storedName: string): Promise<number | null>
  read(storedName: string): Promise<StoredFile | null>
  remove(storedName: string): Promise<void>
}

function checked(storedName: string): string {
  if (!STORED_NAME.test(storedName)) throw new Error('Unknown file')
  return storedName
}

/** Production: a private Vercel Blob store, one folder per account. */
export function blobStore(folder: string): AttachmentStore {
  const path = (name: string) => `${folder}/${checked(name)}`
  return {
    async size(name) {
      try {
        return (await head(path(name))).size
      } catch {
        return null
      }
    },
    async read(name) {
      const r = await get(path(name), { access: 'private' })
      if (!r || r.statusCode !== 200) return null
      return { body: r.stream, mime: mimeFor(name) ?? r.blob.contentType, size: r.blob.size }
    },
    async remove(name) {
      await del(path(name)).catch(() => undefined)
    }
  }
}

/** Development without a Blob token: a folder on disk. */
export function diskStore(dir: string): AttachmentStore {
  const path = (name: string) => join(dir, checked(name))
  return {
    async size(name) {
      try {
        return (await stat(path(name))).size
      } catch {
        return null
      }
    },
    async read(name) {
      try {
        const body = await readFile(path(name))
        return { body, mime: mimeFor(name) ?? 'application/octet-stream', size: body.length }
      } catch {
        return null
      }
    },
    async remove(name) {
      await rm(path(name), { force: true })
    }
  }
}

/** Development uploads land here, through `/api/files/upload-local`. */
export async function writeLocal(dir: string, storedName: string, data: Buffer): Promise<void> {
  if (data.length > MAX_ATTACHMENT_BYTES) throw new Error('That file is larger than 25 MB.')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, checked(storedName)), data)
}

export const blobConfigured = (): boolean => Boolean(process.env.BLOB_READ_WRITE_TOKEN)
