import { randomUUID } from 'node:crypto'
import { copyFileSync, mkdirSync, rmSync, statSync } from 'node:fs'
import { basename, extname, join } from 'node:path'

/** What the journal may hold. Anything else is refused rather than copied. */
const TYPES: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.pdf': 'application/pdf',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
}

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024
export const ATTACHMENT_EXTENSIONS = Object.keys(TYPES).map((e) => e.slice(1))

/** A stored name is always one we generated: a UUID and a known extension. */
const STORED_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.[a-z]{2,4}$/

export interface ImportedFile {
  storedName: string
  originalName: string
  mime: string
  size: number
}

export interface AttachmentStore {
  import(sourcePath: string): ImportedFile
  remove(storedName: string): void
  /** Absolute path for a stored name, or null if the name is not one of ours. */
  pathFor(storedName: string): string | null
}

/**
 * Journal files live in one folder next to the database. They are copies — deleting or
 * moving the original never breaks an entry, and the protocol that serves them can only
 * ever reach this folder.
 */
export function attachmentStore(dir: string): AttachmentStore {
  mkdirSync(dir, { recursive: true })
  return {
    import(sourcePath: string): ImportedFile {
      const ext = extname(sourcePath).toLowerCase()
      const mime = TYPES[ext]
      if (!mime) throw new Error(`${basename(sourcePath)} can’t be attached — use an image, PDF, text or Office file.`)
      const st = statSync(sourcePath)
      if (!st.isFile()) throw new Error(`${basename(sourcePath)} is not a file.`)
      if (st.size > MAX_ATTACHMENT_BYTES) throw new Error(`${basename(sourcePath)} is larger than 25 MB.`)
      const storedName = `${randomUUID()}${ext === '.jpeg' ? '.jpg' : ext}`
      copyFileSync(sourcePath, join(dir, storedName))
      return { storedName, originalName: basename(sourcePath), mime, size: st.size }
    },
    remove(storedName: string): void {
      const p = this.pathFor(storedName)
      if (p) rmSync(p, { force: true })
    },
    pathFor(storedName: string): string | null {
      return STORED_NAME.test(storedName) ? join(dir, storedName) : null
    }
  }
}
