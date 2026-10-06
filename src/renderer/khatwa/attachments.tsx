import { useEffect, useState, type DragEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ChevronLeft, ChevronRight, FileText, ImagePlus, Paperclip, X } from 'lucide-react'
import type { Attachment } from '@shared/types'
import { Alert, IconBtn } from './ui'

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Files dropped on the composer are uploaded straight away, unlinked until it is saved. */
export async function importDropped(e: DragEvent): Promise<Attachment[]> {
  const files = [...e.dataTransfer.files]
  return files.length ? window.api.attachments.import(files) : []
}

/** A photograph, taped down. Tilt is fixed per photo so the wall does not reshuffle. */
export function Polaroid({
  att,
  caption,
  tilt = 0,
  size = 'md',
  onOpen,
  children
}: {
  att: Attachment
  caption?: string | null
  tilt?: number
  size?: 'sm' | 'md' | 'lg'
  onOpen?: () => void
  children?: ReactNode
}) {
  const w = size === 'sm' ? 'w-[120px]' : size === 'lg' ? 'w-full' : 'w-[160px]'
  const text = caption ?? att.caption
  return (
    <figure className={`kh-polaroid ${w} relative m-0`} style={{ transform: `rotate(${tilt}deg)` }}>
      <span className="kh-polaroid-tape" aria-hidden="true" />
      <button type="button" className="block w-full" onClick={onOpen} aria-label={`View ${text ?? att.originalName}`}>
        <img src={att.url} alt={text ?? att.originalName} className="w-full aspect-[4/3] object-cover bg-[var(--docket)]" loading="lazy" draggable={false} />
      </button>
      {text ? <figcaption className="font-serif italic text-[13.5px] leading-[18px] text-ink-2 pt-2 px-0.5 [text-wrap:pretty]">{text}</figcaption> : null}
      {children}
    </figure>
  )
}

/** A document, as a folded slip of paper. */
export function DocSlip({ att, onRemove }: { att: Attachment; onRemove?: () => void }) {
  const [error, setError] = useState<string | null>(null)
  return (
    <div className="kh-slip flex items-center gap-3 pl-3 pr-2 py-2.5 min-w-0">
      <FileText size={18} className="text-[var(--slate)] shrink-0" />
      <button type="button" className="flex flex-col min-w-0 text-left flex-1" title="Open in a new tab" onClick={() => window.api.attachments.open(att).catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))}>
        <span className="text-[13.5px] truncate">{att.originalName}</span>
        <span className="t-caption">{error ?? `${(att.originalName.split('.').pop() ?? '').toUpperCase()} · ${fileSize(att.size)}`}</span>
      </button>
      {onRemove ? (
        <IconBtn title={`Remove ${att.originalName}`} onClick={onRemove}>
          <X size={14} />
        </IconBtn>
      ) : null}
    </div>
  )
}

/** Composer tray: drop or choose files, caption photos, take things off again. */
export function AttachmentTray({ items, onChange }: { items: Attachment[]; onChange: (items: Attachment[]) => void }) {
  const [over, setOver] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const add = async (fn: () => Promise<Attachment[]>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      const added = await fn()
      if (added.length) onChange([...items, ...added])
    } catch (err) {
      setError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setBusy(false)
    }
  }

  const remove = (a: Attachment): void => {
    onChange(items.filter((x) => x.id !== a.id))
    // Saved files are deleted when the entry is saved without them; fresh ones go now.
    if (a.journalId === null) void window.api.attachments.discard(a.id)
  }

  const photos = items.filter((a) => a.isImage)
  const docs = items.filter((a) => !a.isImage)

  return (
    <div
      className={`kh-droptray ${over ? 'is-over' : ''}`}
      onDragOver={(e) => {
        if ([...e.dataTransfer.types].includes('Files')) {
          e.preventDefault()
          setOver(true)
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setOver(false)
        void add(() => importDropped(e))
      }}
    >
      {error ? <Alert>{error}</Alert> : null}
      {photos.length ? (
        <div className="flex flex-wrap gap-5 pt-3 pb-1">
          {photos.map((a, i) => (
            <Polaroid key={a.id} att={a} tilt={i % 2 ? 1.4 : -1.2} size="sm" caption={null}>
              <input
                className="kh-input !text-[12.5px] !py-1 !font-serif !italic mt-1"
                placeholder="Caption…"
                defaultValue={a.caption ?? ''}
                aria-label={`Caption for ${a.originalName}`}
                onBlur={(e) => {
                  const caption = e.target.value.trim() || null
                  if (caption === a.caption) return
                  onChange(items.map((x) => (x.id === a.id ? { ...x, caption } : x)))
                  void window.api.attachments.setCaption(a.id, caption)
                }}
              />
              <button type="button" className="kh-polaroid-remove" aria-label={`Remove ${a.originalName}`} onClick={() => remove(a)}>
                <X size={12} />
              </button>
            </Polaroid>
          ))}
        </div>
      ) : null}
      {docs.length ? (
        <div className="grid gap-2 min-[700px]:grid-cols-2">
          {docs.map((a) => (
            <DocSlip key={a.id} att={a} onRemove={() => remove(a)} />
          ))}
        </div>
      ) : null}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <button type="button" className="kh-btn is-ghost !px-0" disabled={busy} onClick={() => void add(() => window.api.attachments.import(null))}>
          <ImagePlus size={15} /> Add a photo or file
        </button>
        <span className="t-caption flex items-center gap-1.5">
          <Paperclip size={12} /> {busy ? 'Adding…' : over ? 'Let go to add it' : 'or drop it onto this page · images, PDF, text or Office, up to 25 MB'}
        </span>
      </div>
    </div>
  )
}

/** Full view of one photo at a time, with the others a keypress away. */
export function Lightbox({ photos, start, onClose }: { photos: Attachment[]; start: number; onClose: () => void }) {
  const [i, setI] = useState(start)
  const a = photos[i]
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') setI((x) => Math.min(photos.length - 1, x + 1))
      if (e.key === 'ArrowLeft') setI((x) => Math.max(0, x - 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [photos.length, onClose])
  if (!a) return null
  return createPortal(
    <div className="kh-overlay !items-center !p-10" onMouseDown={(e) => e.target === e.currentTarget && onClose()} role="dialog" aria-modal="true" aria-label="Photo">
      <figure className="kh-polaroid !p-4 !pb-5 max-w-[min(1000px,90vw)] m-0 kh-rise">
        <img src={a.url} alt={a.caption ?? a.originalName} className="max-h-[72vh] w-auto mx-auto object-contain" />
        <figcaption className="flex items-center justify-between gap-6 pt-3">
          <span className="font-serif italic text-[17px] text-ink-2">{a.caption ?? a.originalName}</span>
          <span className="flex items-center gap-1">
            {photos.length > 1 ? (
              <>
                <IconBtn title="Previous photo" disabled={i === 0} onClick={() => setI(i - 1)}>
                  <ChevronLeft size={16} />
                </IconBtn>
                <span className="t-caption w-12 text-center">
                  {i + 1} of {photos.length}
                </span>
                <IconBtn title="Next photo" disabled={i === photos.length - 1} onClick={() => setI(i + 1)}>
                  <ChevronRight size={16} />
                </IconBtn>
              </>
            ) : null}
            <IconBtn title="Close" onClick={onClose}>
              <X size={16} />
            </IconBtn>
          </span>
        </figcaption>
      </figure>
    </div>,
    document.body
  )
}
