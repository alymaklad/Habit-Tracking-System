import { useEffect, useMemo, useState } from 'react'
import { Backpack, BookOpen, Feather, Lightbulb, Mountain, Pencil, Search, Sparkles, Tag, Trash2, X } from 'lucide-react'
import { MOODS, type Attachment, type GoalView, type GuideInsight, type JournalDraft, type JournalEntry, type JournalKind, type LetGoCheckin, type LetGoView, type Mood, type StepToward } from '@shared/types'
import { useData } from '../hooks/useData'
import { dayMonth, longDate, monthYear, plural, today } from '../lib/khatwa'
import { FEELING_LABEL, GuideCard } from '../khatwa/letgo'
import { AttachmentTray, DocSlip, Lightbox, Polaroid } from '../khatwa/attachments'
import { Page } from '../khatwa/Page'
import { Alert, Btn, Dot, IconBtn, LoadError, Loading, Modal, Stamp } from '../khatwa/ui'

type Data = { entries: JournalEntry[]; letGos: LetGoView[]; goals: GoalView[]; guide: GuideInsight[] }
type Mode = 'free' | 'daily' | 'deep'
type Stream = 'all' | 'daily' | 'deep' | 'mountain' | 'pack' | 'monthly'

export const QUICK_PROMPTS = [
  'How am I feeling?',
  'What felt difficult today?',
  'What am I proud of?',
  'What is getting in my way?',
  'How do I feel about my Mountain?',
  'What do I need right now?'
]

export const DEEP_PROMPTS: [string, string][] = [
  ['happened', 'What happened?'],
  ['feeling', 'What were you feeling?'],
  ['before', 'What happened immediately before?'],
  ['needed', 'What did you need?'],
  ['next', 'What would you like to try next time?'],
  ['mountain', 'How do you feel about your Mountain?']
]

export const MONTHLY_PROMPTS: [string, string][] = [
  ['proud', 'What I’m proud of'],
  ['learned', 'What I learned'],
  ['difficult', 'What was difficult'],
  ['next', 'What’s next']
]

const MOOD_LABEL: Record<Mood, string> = { good: 'Good', okay: 'Okay', low: 'Low', stressed: 'Stressed', exhausted: 'Exhausted' }
const STEP_LABEL: Record<StepToward, string> = { yes: 'Yes', little: 'A little', not_today: 'Not today' }
const KIND_LABEL: Record<JournalKind, string> = { free: 'Field note', daily: 'Daily check-in', deep: 'Deep reflection', monthly: 'Monthly memory' }

const blank = (mode: Mode, goalId: number | null, letGoId: number | null, title: string | null): JournalDraft => ({
  date: today(),
  kind: mode,
  title,
  body: '',
  mood: null,
  stepToward: null,
  prompts: {},
  tags: [],
  goalId,
  letGoId
})

function Composer({
  draft,
  setDraft,
  editingId,
  goals,
  letGos,
  onSaved,
  onCancel,
  attachments,
  setAttachments
}: {
  attachments: Attachment[]
  setAttachments: (a: Attachment[]) => void
  draft: JournalDraft
  setDraft: (d: JournalDraft) => void
  editingId: number | null
  goals: GoalView[]
  letGos: LetGoView[]
  onSaved: () => void
  onCancel: () => void
}) {
  const [tagDraft, setTagDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const mode = draft.kind as Mode
  const set = (patch: Partial<JournalDraft>): void => setDraft({ ...draft, ...patch })
  const setPrompt = (k: string, v: string): void => setDraft({ ...draft, prompts: { ...draft.prompts, [k]: v } })

  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await window.api.journal.save(editingId, { ...draft, tags: tagDraft.trim() ? [...draft.tags, tagDraft] : draft.tags, attachmentIds: attachments.map((a) => a.id) })
      setTagDraft('')
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="kh-card kh-tape p-6 flex flex-col gap-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="t-stamp !text-[11px] text-[var(--ochre-deep)] flex items-center gap-2">
          <Dot /> {editingId ? 'Revising an entry' : 'Pen on paper'} · {draft.date === today() ? 'today' : dayMonth(draft.date)}
        </span>
        <div className="kh-segmented">
          {(['free', 'daily', 'deep'] as const).map((m) => (
            <button key={m} className={mode === m ? 'is-on' : ''} onClick={() => set({ kind: m })}>
              {m === 'free' ? 'Free' : m === 'daily' ? 'Daily check-in' : 'Deep reflection'}
            </button>
          ))}
        </div>
      </div>
      {error ? <Alert>{error}</Alert> : null}

      {mode === 'free' ? (
        <>
          <input className="kh-input !font-serif !text-[22px] !border-0 !px-0" value={draft.title ?? ''} placeholder="Title this reflection…" onChange={(e) => set({ title: e.target.value })} aria-label="Title" />
          <textarea className="kh-textarea !text-[16px]" rows={5} value={draft.body} placeholder="Write honestly. What moved your spirit or slowed your pace today?" onChange={(e) => set({ body: e.target.value })} aria-label="Reflection" />
        </>
      ) : null}

      {mode === 'daily' ? (
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-2">
            <span className="kh-field-label">How am I feeling?</span>
            <div className="flex flex-wrap gap-2">
              {MOODS.map((m) => (
                <button key={m} className={`kh-chip ${draft.mood === m ? 'is-on' : ''}`} aria-pressed={draft.mood === m} onClick={() => set({ mood: draft.mood === m ? null : m })}>
                  {MOOD_LABEL[m]}
                </button>
              ))}
            </div>
          </div>
          <label className="kh-field">
            <span className="kh-field-label">What felt difficult today?</span>
            <textarea className="kh-textarea" rows={2} value={draft.prompts.difficult ?? ''} placeholder="Optional — a line is enough" onChange={(e) => setPrompt('difficult', e.target.value)} />
          </label>
          <div className="flex flex-col gap-2">
            <span className="kh-field-label">Did I take a step toward my Mountain?</span>
            <div className="flex flex-wrap gap-2">
              {(['yes', 'little', 'not_today'] as const).map((s) => (
                <button key={s} className={`kh-chip ${draft.stepToward === s ? 'is-on' : ''}`} aria-pressed={draft.stepToward === s} onClick={() => set({ stepToward: draft.stepToward === s ? null : s })}>
                  {STEP_LABEL[s]}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

      {mode === 'deep' ? (
        <div className="flex flex-col gap-4">
          <input className="kh-input !font-serif !text-[20px] !border-0 !px-0" value={draft.title ?? ''} placeholder="Name this moment — a breakthrough, a slip, feeling stuck…" onChange={(e) => set({ title: e.target.value })} aria-label="Title" />
          {DEEP_PROMPTS.map(([k, q]) => (
            <label key={k} className="kh-field">
              <span className="kh-field-label !normal-case !tracking-normal !font-serif !italic !text-[15px] !font-normal text-ink-2">{q}</span>
              <textarea className="kh-textarea" rows={2} value={draft.prompts[k] ?? ''} onChange={(e) => setPrompt(k, e.target.value)} />
            </label>
          ))}
        </div>
      ) : null}

      <div className="grid gap-4 min-[900px]:grid-cols-2">
        <label className="kh-field">
          <span className="kh-field-label">Mountain</span>
          <select className="kh-select" value={draft.goalId ?? ''} onChange={(e) => set({ goalId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">None</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </select>
        </label>
        <label className="kh-field">
          <span className="kh-field-label">From the backpack</span>
          <select className="kh-select" value={draft.letGoId ?? ''} onChange={(e) => set({ letGoId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">None</option>
            {letGos.map((l) => (
              <option key={l.id} value={l.id}>
                {l.title}
              </option>
            ))}
          </select>
        </label>
      </div>

      <AttachmentTray items={attachments} onChange={setAttachments} />

      <div className="flex flex-wrap items-center gap-2">
        <Tag size={14} className="text-ink-4" />
        {draft.tags.map((t) => (
          <span key={t} className="kh-chip !py-0.5 !text-[12px]">
            #{t}
            <button aria-label={`Remove tag ${t}`} onClick={() => set({ tags: draft.tags.filter((x) => x !== t) })}>
              <X size={11} />
            </button>
          </span>
        ))}
        <input
          className="kh-input !w-40 !text-[13px] !py-1"
          value={tagDraft}
          placeholder="Add a tag…"
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if ((e.key === 'Enter' || e.key === ',') && tagDraft.trim()) {
              e.preventDefault()
              set({ tags: [...new Set([...draft.tags, tagDraft.trim().replace(/^#/, '').toLowerCase()])] })
              setTagDraft('')
            }
          }}
        />
      </div>

      <div className="flex items-center justify-between gap-3 pt-2 border-t border-[var(--rule)]">
        <span className="t-caption">Private to your account.</span>
        <span className="flex gap-2">
          {editingId || draft.body || Object.keys(draft.prompts).length || attachments.length ? (
            <Btn kind="soft" onClick={onCancel}>
              {editingId ? 'Cancel' : 'Clear'}
            </Btn>
          ) : null}
          <Btn kind="ochre" disabled={busy} onClick={() => void save()}>
            <Feather size={15} /> {editingId ? 'Save changes' : 'Save entry'}
          </Btn>
        </span>
      </div>
    </section>
  )
}

function EntryCard({ e, goals, letGos, onEdit, onDelete }: { e: JournalEntry; goals: GoalView[]; letGos: LetGoView[]; onEdit: () => void; onDelete: () => void }) {
  const [viewing, setViewing] = useState<number | null>(null)
  const photos = e.attachments.filter((a) => a.isImage)
  const docs = e.attachments.filter((a) => !a.isImage)
  const goal = goals.find((g) => g.id === e.goalId)
  const lg = letGos.find((l) => l.id === e.letGoId)
  const qa: [string, string][] =
    e.kind === 'deep' ? DEEP_PROMPTS.filter(([k]) => e.prompts[k]).map(([k, q]) => [q, e.prompts[k]!]) : e.kind === 'monthly' ? MONTHLY_PROMPTS.filter(([k]) => e.prompts[k]).map(([k, q]) => [q, e.prompts[k]!]) : []
  return (
    <article className="kh-card p-6 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="t-stamp !text-[11px] text-ink-3 flex items-center gap-2">
          <BookOpen size={13} /> {longDate(e.date)} · <span className="italic text-[var(--ochre-deep)] normal-case tracking-normal">{KIND_LABEL[e.kind]}</span>
        </span>
        <span className="flex gap-1.5 flex-wrap">
          {goal ? (
            <Stamp tone="laurel" className="!text-[10px] !normal-case !tracking-normal !font-sans">
              <Mountain size={11} /> {goal.title}
            </Stamp>
          ) : null}
          {lg ? (
            <Stamp tone="ochre" className="!text-[10px] !normal-case !tracking-normal !font-sans">
              <Backpack size={11} /> {lg.title}
            </Stamp>
          ) : null}
        </span>
      </div>
      {e.title ? <h3 className="font-serif text-[23px] leading-[30px] font-normal m-0">{e.title}</h3> : null}
      {e.kind === 'daily' ? (
        <div className="flex flex-wrap gap-2">
          {e.mood ? <Stamp>Feeling: {MOOD_LABEL[e.mood]}</Stamp> : null}
          {e.stepToward ? <Stamp tone={e.stepToward === 'yes' ? 'laurel' : 'plain'}>Step toward the mountain: {STEP_LABEL[e.stepToward]}</Stamp> : null}
        </div>
      ) : null}
      {e.kind === 'daily' && e.prompts.difficult ? <p className="m-0 font-serif text-[17px] leading-[27px] text-ink-2">Difficult: {e.prompts.difficult}</p> : null}
      {e.body ? <p className="m-0 text-[16px] leading-[27px] text-ink-2 whitespace-pre-wrap [text-wrap:pretty]">{e.body}</p> : null}
      {photos.length === 1 ? (
        <div className="py-3 px-1">
          <Polaroid att={photos[0]!} size="lg" tilt={-0.6} onOpen={() => setViewing(0)} />
        </div>
      ) : photos.length > 1 ? (
        <div className="flex flex-wrap items-start gap-4 py-3 px-1">
          {photos.map((a, i) => (
            <Polaroid key={a.id} att={a} tilt={[-1.4, 1.1, -0.5, 1.6][i % 4]} onOpen={() => setViewing(i)} />
          ))}
        </div>
      ) : null}
      {docs.length ? (
        <div className="grid gap-2 min-[700px]:grid-cols-2">
          {docs.map((a) => (
            <DocSlip key={a.id} att={a} />
          ))}
        </div>
      ) : null}
      {viewing !== null ? <Lightbox photos={photos} start={viewing} onClose={() => setViewing(null)} /> : null}
      {qa.length ? (
        <div className="kh-docket p-4 flex flex-col gap-3">
          {qa.map(([q, a]) => (
            <div key={q} className="flex flex-col gap-0.5">
              <span className="t-stamp !text-[10.5px] text-[var(--ochre-deep)]">{q}</span>
              <span className="text-[15px] leading-[23px] text-ink-2 whitespace-pre-wrap">{a}</span>
            </div>
          ))}
        </div>
      ) : null}
      <div className="flex items-center justify-between gap-3">
        <span className="text-[13px] text-laurel">{e.tags.map((t) => `#${t}`).join(' ')}</span>
        <span className="flex">
          <IconBtn title="Edit entry" onClick={onEdit}>
            <Pencil size={14} />
          </IconBtn>
          <IconBtn title="Delete entry" onClick={onDelete}>
            <Trash2 size={14} />
          </IconBtn>
        </span>
      </div>
    </article>
  )
}

function SlipCard({ c, item }: { c: LetGoCheckin; item: LetGoView }) {
  return (
    <article className="kh-card p-6 flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <span className="t-stamp !text-[11px] text-ink-3 flex items-center gap-2">
          <Dot /> {longDate(c.date)} · <span className="italic normal-case tracking-normal">Evening check-in</span>
        </span>
        <Stamp tone="ochre-solid" className="!text-[10px]">Slip inquiry</Stamp>
      </div>
      <h3 className="font-serif text-[22px] leading-[29px] font-normal m-0">{item.title} returned — noticing what happened</h3>
      <div className="kh-docket p-4 grid gap-4 min-[800px]:grid-cols-3">
        <div className="flex flex-col gap-1">
          <span className="t-stamp !text-[10.5px] text-[var(--ochre-deep)]">The trigger</span>
          <span className="text-[14.5px]">{c.trigger ?? '—'}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="t-stamp !text-[10.5px] text-[var(--ochre-deep)]">What I felt</span>
          <span className="text-[14.5px]">{c.feelings.length ? c.feelings.map((f) => FEELING_LABEL[f]).join(', ') : '—'}</span>
        </div>
        <div className="flex flex-col gap-1">
          <span className="t-stamp !text-[10.5px] text-[var(--ochre-deep)]">What I needed</span>
          <span className="text-[14.5px]">{c.need ?? '—'}</span>
        </div>
      </div>
      {c.note ? <p className="m-0 font-serif italic text-[16px] text-ink-2">“{c.note}”</p> : null}
    </article>
  )
}

export default function Journal({ prompt, goalId, letGoId, kind }: { prompt?: string; goalId?: number | null; letGoId?: number | null; kind?: Mode }) {
  const [draft, setDraft] = useState<JournalDraft>(blank(kind ?? 'free', goalId ?? null, letGoId ?? null, prompt ?? null))
  const [editingId, setEditingId] = useState<number | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [stream, setStream] = useState<Stream>('all')
  const [tag, setTag] = useState<string | null>(null)
  const [month, setMonth] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [confirmDelete, setConfirmDelete] = useState<JournalEntry | null>(null)
  const { data, error, refetch } = useData<Data>(async () => {
    const [entries, letGos, goals, guide] = await Promise.all([window.api.journal.list(), window.api.letGo.list(), window.api.goals.list(), window.api.guide.list()])
    return { entries, letGos, goals, guide }
  }, [])

  useEffect(() => {
    if (prompt || kind || goalId || letGoId) setDraft(blank(kind ?? 'free', goalId ?? null, letGoId ?? null, prompt ?? null))
  }, [prompt, kind, goalId, letGoId])

  const slips = useMemo(
    () => (data?.letGos ?? []).flatMap((l) => l.checkins.filter((c) => !c.resisted && (c.trigger || c.need || c.note || c.feelings.length)).map((c) => ({ c, item: l }))),
    [data?.letGos]
  )

  if (error) return <Page><LoadError message={error} onRetry={refetch} /></Page>
  if (!data) return <Page><Loading label="Opening the inner compass…" /></Page>

  const inStream = (e: JournalEntry): boolean =>
    stream === 'all' || (stream === 'daily' && e.kind === 'daily') || (stream === 'deep' && e.kind === 'deep') || (stream === 'monthly' && e.kind === 'monthly') || (stream === 'mountain' && e.goalId !== null) || (stream === 'pack' && e.letGoId !== null)
  const q = query.trim().toLowerCase()
  const matches = (e: JournalEntry): boolean =>
    inStream(e) &&
    (!tag || e.tags.includes(tag)) &&
    (!month || e.date.startsWith(month)) &&
    (!q || `${e.title ?? ''} ${e.body} ${Object.values(e.prompts).join(' ')} ${e.tags.join(' ')}`.toLowerCase().includes(q))
  const showSlips = (stream === 'all' || stream === 'pack') && !tag
  const feed = [
    ...data.entries.filter(matches).map((e) => ({ date: e.date, key: `e${e.id}`, node: <EntryCard key={`e${e.id}`} e={e} goals={data.goals} letGos={data.letGos} onEdit={() => { setEditingId(e.id); setDraft({ ...e }); setAttachments(e.attachments); document.querySelector('.kh-scroll')?.scrollTo({ top: 0, behavior: 'smooth' }) }} onDelete={() => setConfirmDelete(e)} /> })),
    ...(showSlips ? slips.filter(({ c }) => (!month || c.date.startsWith(month)) && (!q || `${c.trigger ?? ''} ${c.need ?? ''} ${c.note ?? ''}`.toLowerCase().includes(q))).map(({ c, item }) => ({ date: c.date, key: `s${c.id}`, node: <SlipCard key={`s${c.id}`} c={c} item={item} /> })) : [])
  ].sort((a, b) => b.date.localeCompare(a.date))

  const tags = [...new Set(data.entries.flatMap((e) => e.tags))].sort()
  const months = [...new Set(data.entries.map((e) => e.date.slice(0, 7)))].sort().reverse()
  const counts: Record<Stream, number> = {
    all: data.entries.length + slips.length,
    daily: data.entries.filter((e) => e.kind === 'daily').length,
    deep: data.entries.filter((e) => e.kind === 'deep').length,
    mountain: data.entries.filter((e) => e.goalId !== null).length,
    pack: data.entries.filter((e) => e.letGoId !== null).length + slips.length,
    monthly: data.entries.filter((e) => e.kind === 'monthly').length
  }
  const active = data.goals.find((g) => g.status === 'active')
  const streams: [Stream, string][] = [
    ['all', 'All entries'],
    ['daily', 'Daily check-ins'],
    ['deep', 'Deep reflections'],
    ['mountain', 'Mountain check-ins'],
    ['pack', 'Pack & friction'],
    ['monthly', 'Monthly memories']
  ]
  const startPrompt = (p: string): void => {
    setEditingId(null)
    setDraft(blank('free', draft.goalId, draft.letGoId, p))
  }

  return (
    <Page>
      <header className="flex flex-wrap items-end justify-between gap-6 mb-6">
        <div className="flex flex-col gap-3 max-w-[720px]">
          <h1 className="t-hero m-0">Journal</h1>
          <p className="font-serif text-[17px] leading-[27px] text-ink-2 m-0">A quiet space to understand what you carry, what you learn, and who you are becoming.</p>
        </div>
        <div className="kh-sheet flex items-center gap-4 px-5 py-3">
          <span className="w-12 h-12 rounded-xl grid place-items-center bg-[var(--laurel-deep)] text-[var(--on-solid)] font-serif text-[20px]">{counts.all}</span>
          <span className="flex flex-col">
            <span className="t-stamp !text-[11px]">Field inquiries</span>
            <span className="t-caption">Entries and evening check-ins</span>
          </span>
        </div>
      </header>

      <div className="flex gap-2 overflow-x-auto pb-2 mb-6">
        <Btn kind="laurel" onClick={() => { setEditingId(null); setDraft(blank('free', null, null, null)) }}>
          <Feather size={15} /> Write free reflection
        </Btn>
        {QUICK_PROMPTS.map((p) => (
          <button key={p} className="kh-chip !py-2 shrink-0" onClick={() => startPrompt(p)}>
            {p}
          </button>
        ))}
      </div>

      <div className="grid gap-6 min-[1250px]:grid-cols-[210px_minmax(0,1fr)_280px] min-[1000px]:grid-cols-[210px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-5 min-w-0">
          <div className="kh-sheet p-4 flex flex-col gap-2">
            <span className="t-stamp !text-[10.5px] text-ink-3">Search entries</span>
            <div className="relative">
              <Search size={14} className="absolute left-0 top-1/2 -translate-y-1/2 text-ink-4" />
              <input className="kh-input !pl-6 !text-[14px]" value={query} placeholder="Insights, friction…" onChange={(e) => setQuery(e.target.value)} />
            </div>
          </div>
          <div className="kh-sheet p-3 flex flex-col gap-1">
            <span className="t-stamp !text-[10.5px] text-ink-3 px-2 pb-1">Index streams</span>
            {streams.map(([k, label]) => (
              <button key={k} className={`flex items-center justify-between gap-2 px-2.5 py-2 rounded-lg text-left text-[14px] ${stream === k ? 'bg-[var(--laurel-deep)] text-[var(--on-solid)]' : 'hover:bg-[var(--docket)]'}`} onClick={() => setStream(k)}>
                <span>{label}</span>
                <span className={`text-[11px] px-1.5 rounded-full ${stream === k ? 'bg-white/20' : 'bg-[var(--docket)] text-ink-3'}`}>{counts[k]}</span>
              </button>
            ))}
          </div>
          {tags.length ? (
            <div className="kh-sheet p-4 flex flex-col gap-2">
              <span className="t-stamp !text-[10.5px] text-ink-3">Thematic tags</span>
              <div className="flex flex-wrap gap-1.5">
                {tags.map((t) => (
                  <button key={t} className={`kh-chip !py-0.5 !text-[12px] ${tag === t ? 'is-on' : ''}`} onClick={() => setTag(tag === t ? null : t)}>
                    #{t}
                  </button>
                ))}
              </div>
            </div>
          ) : null}
          {months.length ? (
            <div className="kh-sheet p-4 flex flex-col gap-1">
              <span className="t-stamp !text-[10.5px] text-ink-3 pb-1">By month</span>
              {months.map((m) => (
                <button key={m} className={`flex justify-between text-left text-[14px] py-1 ${month === m ? 'text-laurel font-semibold' : ''}`} onClick={() => setMonth(month === m ? null : m)}>
                  <span>{monthYear(`${m}-15`)}</span>
                  <span className="t-caption">{plural(data.entries.filter((e) => e.date.startsWith(m)).length, 'note')}</span>
                </button>
              ))}
            </div>
          ) : null}
        </aside>

        <div className="flex flex-col gap-6 min-w-0">
          <Composer
            draft={draft}
            setDraft={setDraft}
            editingId={editingId}
            goals={data.goals}
            letGos={data.letGos}
            attachments={attachments}
            setAttachments={setAttachments}
            onSaved={() => {
              setEditingId(null)
              setAttachments([])
              setDraft(blank(draft.kind as Mode, null, null, null))
            }}
            onCancel={() => {
              // Files added in this sitting and never saved are removed now, not left behind.
              for (const a of attachments) if (a.journalId === null) void window.api.attachments.discard(a.id)
              setEditingId(null)
              setAttachments([])
              setDraft(blank('free', null, null, null))
            }}
          />
          {feed.length === 0 ? (
            <div className="kh-empty">
              <span className="t-h2 text-ink">{data.entries.length || slips.length ? 'Nothing here matches.' : 'What’s on your mind?'}</span>
              <span>{data.entries.length || slips.length ? 'Try another stream, tag or month.' : 'Your reflections gather here — a line a day is enough.'}</span>
            </div>
          ) : (
            feed.map((f) => f.node)
          )}
        </div>

        <aside className="flex flex-col gap-5 min-w-0 min-[1000px]:max-[1249px]:col-span-2">
          {[...data.guide]
            .sort((a, b) => Number(/^(letgo|ceremony)/.test(a.key)) - Number(/^(letgo|ceremony)/.test(b.key)))
            .slice(0, 3)
            .map((g) => (
              <GuideCard key={g.key} insight={g} />
            ))}
          {data.guide.length === 0 ? (
            <div className="kh-sheet p-5 flex gap-3">
              <Lightbulb size={18} className="text-ink-4 shrink-0 mt-0.5" />
              <span className="text-[13.5px] text-ink-3 [text-wrap:pretty]">Your Guide only speaks when your own entries and check-ins show a pattern — nothing yet.</span>
            </div>
          ) : null}
          {active ? (
            <div className="kh-sheet p-5 flex flex-col gap-3">
              <span className="t-stamp !text-[10.5px] text-[var(--ochre-deep)] flex items-center gap-1.5">
                <Sparkles size={13} /> Mountain resonance
              </span>
              <p className="m-0 font-serif text-[20px] leading-[29px] [text-wrap:balance]">“How do you feel about your pace toward {active.title}?”</p>
              <Btn kind="soft" size="sm" onClick={() => { setEditingId(null); setDraft(blank('free', active.id, null, `My pace toward ${active.title}`)) }}>
                Write about it
              </Btn>
            </div>
          ) : null}
          <figure className="kh-docket m-0 p-6 flex flex-col gap-3 text-center">
            <span className="font-serif text-[30px] text-[var(--ochre-deep)] leading-none">“</span>
            <blockquote className="m-0 font-serif italic text-[20px] leading-[29px]">Caminante, no hay camino, se hace camino al andar.</blockquote>
            <figcaption className="t-caption">— Antonio Machado · “the path is made by walking”</figcaption>
          </figure>
        </aside>
      </div>

      {confirmDelete ? (
        <Modal onClose={() => setConfirmDelete(null)} label="Delete entry" width={460}>
          <div className="p-7 flex flex-col gap-4">
            <h2 className="t-h2 m-0">Delete this entry?</h2>
            <p className="m-0 text-ink-2">{confirmDelete.title ?? longDate(confirmDelete.date)} will be removed from your journal. This cannot be undone.</p>
            <div className="flex justify-end gap-3">
              <Btn kind="soft" onClick={() => setConfirmDelete(null)}>
                Keep it
              </Btn>
              <Btn kind="danger" onClick={() => void window.api.journal.remove(confirmDelete.id).then(() => setConfirmDelete(null))}>
                Delete
              </Btn>
            </div>
          </div>
        </Modal>
      ) : null}
    </Page>
  )
}
