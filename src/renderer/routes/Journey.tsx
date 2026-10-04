import { useMemo, useState } from 'react'
import { Award, Backpack, BookOpen, ImagePlus, Clock, Flag, Footprints, Mountain, Pencil, Quote, Sparkles, TriangleAlert, X } from 'lucide-react'
import type { AchievementView, Attachment, CalendarBlock, GoalView, JournalEntry, LetGoView, PerformanceView } from '@shared/types'
import { useData } from '../hooks/useData'
import { addDays, duration } from '../lib/format'
import { dayMonth, effectiveStatus, plural, today } from '../lib/khatwa'
import { useShell } from '../khatwa/nav'
import { Page } from '../khatwa/Page'
import { Alert, Btn, Dot, IconBtn, LoadError, Loading, Modal } from '../khatwa/ui'
import { MONTHLY_PROMPTS } from './Journal'
import { importDropped, Lightbox, Polaroid } from '../khatwa/attachments'

const MONTHS = 6

type MonthFolio = {
  ym: string
  label: string
  minutes: number
  completed: number
  scheduled: number
  points: number
  bestDay: { date: string; completed: number } | null
  milestones: { goal: string; title: string; date: string }[]
  summits: GoalView[]
  begun: GoalView[]
  seals: AchievementView[]
}

type Data = { folios: MonthFolio[]; blocks: CalendarBlock[]; selectedYm: string; journal: JournalEntry[]; letGos: LetGoView[] }

function monthsBack(n: number): string[] {
  const d = new Date(`${today().slice(0, 7)}-15T12:00:00`)
  return Array.from({ length: n }, (_, i) => {
    const x = new Date(d)
    x.setMonth(d.getMonth() - i)
    return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`
  })
}

function monthLabel(ym: string, style: 'long' | 'short' = 'long'): string {
  return new Date(`${ym}-15T12:00:00`).toLocaleDateString(undefined, { month: style, year: 'numeric' })
}

function lastDay(ym: string): string {
  const d = new Date(`${ym}-01T12:00:00`)
  d.setMonth(d.getMonth() + 1)
  d.setDate(0)
  return `${ym}-${String(d.getDate()).padStart(2, '0')}`
}

function fold(ym: string, perf: PerformanceView, goals: GoalView[], achievements: AchievementView[]): MonthFolio {
  const days = perf.monthGrid.filter((d) => d.date.startsWith(ym))
  const best = days.reduce<MonthFolio['bestDay']>((b, d) => (d.completed > (b?.completed ?? 0) ? { date: d.date, completed: d.completed } : b), null)
  return {
    ym,
    label: monthLabel(ym),
    minutes: days.reduce((s, d) => s + d.minutes, 0),
    completed: days.reduce((s, d) => s + d.completed, 0),
    scheduled: days.reduce((s, d) => s + d.scheduled, 0),
    points: days.reduce((s, d) => s + d.points, 0),
    bestDay: best,
    milestones: goals.flatMap((g) => g.milestones.filter((m) => m.done && m.date?.startsWith(ym)).map((m) => ({ goal: g.title, title: m.title, date: m.date! }))),
    summits: goals.filter((g) => g.status === 'achieved' && g.closedAt?.startsWith(ym)),
    begun: goals.filter((g) => g.createdAt.startsWith(ym)),
    seals: achievements.filter((a) => a.unlockedAt?.startsWith(ym))
  }
}

function FolioCard({ folio, index, onOpen, rotate, cover }: { folio: MonthFolio; index: number; onOpen: () => void; rotate: number; cover?: Attachment }) {
  return (
    <button className="kh-card relative p-5 pt-6 text-left flex flex-col gap-2 hover:shadow-[var(--shadow-float)] transition-shadow" style={{ transform: `rotate(${rotate}deg)` }} onClick={onOpen}>
      <span className="kh-pin" />
      <div className="flex justify-between items-baseline">
        <span className="t-stamp !text-[10.5px] text-ink-3">Folio N° {index}</span>
        <span className="t-italic !text-[12px]">Archived</span>
      </div>
      {cover ? <img src={cover.url} alt={cover.caption ?? ''} className="w-full aspect-[16/9] object-cover rounded-[3px] mt-1" draggable={false} /> : null}
      <span className="font-serif text-[22px] leading-7">{folio.label}</span>
      <span className="font-serif italic text-[13.5px] text-[var(--ochre-deep)]">
        {folio.completed ? `${plural(folio.completed, 'step')} kept of ${folio.scheduled}` : 'A quiet month on the trail'}
      </span>
      <div className="flex justify-between t-caption mt-2">
        <span className="flex items-center gap-1.5">
          <Clock size={12} /> {duration(folio.minutes)} logged
        </span>
        <span className="flex items-center gap-1.5">
          <Flag size={12} /> {plural(folio.milestones.length, 'waypoint')}
        </span>
      </div>
    </button>
  )
}

function MonthlyEditor({ ym, entry, onClose }: { ym: string; entry: JournalEntry | null; onClose: () => void }) {
  const [prompts, setPrompts] = useState<Record<string, string>>(entry?.prompts ?? {})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const save = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await window.api.journal.save(entry?.id ?? null, {
        date: `${ym}-01`,
        kind: 'monthly',
        title: `${monthLabel(ym)} — monthly memory`,
        body: '',
        mood: null,
        stepToward: null,
        prompts,
        tags: [],
        goalId: null,
        letGoId: null
      })
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal onClose={onClose} label={`Monthly memory for ${monthLabel(ym)}`} width={680}>
      <div className="flex flex-col">
        <div className="flex items-start justify-between gap-4 px-8 pt-7 pb-5 border-b border-[var(--rule)]">
          <div className="flex flex-col gap-1">
            <span className="t-stamp text-[var(--ochre-deep)]">Monthly memory</span>
            <h2 className="t-h1 !text-[28px] m-0">{monthLabel(ym)}</h2>
          </div>
          <IconBtn title="Close" onClick={onClose}>
            <X size={17} />
          </IconBtn>
        </div>
        <div className="px-8 py-6 flex flex-col gap-5 max-h-[62vh] overflow-y-auto">
          {error ? <Alert>{error}</Alert> : null}
          {MONTHLY_PROMPTS.map(([k, label]) => (
            <label key={k} className="kh-field">
              <span className="kh-field-label">{label}</span>
              <textarea className="kh-textarea" rows={3} value={prompts[k] ?? ''} onChange={(e) => setPrompts({ ...prompts, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        <div className="flex justify-end gap-3 px-8 py-5 border-t border-[var(--rule)] bg-[var(--sheet)] rounded-b-[14px]">
          <Btn kind="soft" onClick={onClose}>
            Cancel
          </Btn>
          <Btn kind="laurel" disabled={busy} onClick={() => void save()}>
            Pin the page to the wall
          </Btn>
        </div>
      </div>
    </Modal>
  )
}

export default function Journey() {
  const { navigate } = useShell()
  const months = useMemo(() => monthsBack(MONTHS), [])
  const [selected, setSelected] = useState<string | 'all'>(months[0]!)
  const [editingMonth, setEditingMonth] = useState<string | null>(null)
  const [viewing, setViewing] = useState<number | null>(null)
  const [pinning, setPinning] = useState(false)
  const [pinError, setPinError] = useState<string | null>(null)
  const [dropOver, setDropOver] = useState(false)
  const { data, error, refetch } = useData<Data>(async () => {
    const now = today()
    const [goals, achievements, journal, letGos, ...perfs] = await Promise.all([
      window.api.goals.list(),
      window.api.view.achievements(),
      window.api.journal.list(),
      window.api.letGo.list(),
      ...months.map((ym) => window.api.view.performance(ym === now.slice(0, 7) ? now : `${ym}-15`))
    ])
    const ym = selected === 'all' ? months[0]! : selected
    const blocks = await window.api.view.calendarRange(`${ym}-01`, ym === now.slice(0, 7) ? now : lastDay(ym))
    return {
      folios: months.map((m, i) => fold(m, perfs[i] as PerformanceView, goals as GoalView[], achievements as AchievementView[])),
      blocks,
      selectedYm: ym,
      journal: journal as JournalEntry[],
      letGos: letGos as LetGoView[]
    }
  }, [selected])

  if (error) return <Page><LoadError message={error} onRetry={refetch} /></Page>
  if (!data) return <Page><Loading label="Pinning the month’s folios to the wall…" /></Page>

  const folios = data.folios
  const photosOf = (ym: string): Attachment[] => data.journal.filter((e) => e.date.startsWith(ym)).flatMap((e) => e.attachments.filter((a) => a.isImage).map((a) => ({ ...a, caption: a.caption ?? e.title })))
  const current = folios.find((f) => f.ym === data.selectedYm) ?? folios[0]!
  const index = (ym: string): number => Number(ym.slice(5, 7))
  const earlier = folios.filter((f) => f.ym < current.ym)
  const missesByHabit = new Map<string, number>()
  for (const b of data.blocks) if (effectiveStatus(b) === 'missed') missesByHabit.set(b.name, (missesByHabit.get(b.name) ?? 0) + 1)
  const resistance = [...missesByHabit.entries()].sort((a, b) => b[1] - a[1])[0] ?? null
  const totals = folios.reduce((s, f) => ({ minutes: s.minutes + f.minutes, keepsakes: s.keepsakes + f.milestones.length + f.seals.length + f.summits.length }), { minutes: 0, keepsakes: 0 })
  const artifacts = [...current.summits.map((g) => ({ kind: 'summit' as const, g })), ...current.begun.map((g) => ({ kind: 'begun' as const, g }))]
  const rate = current.scheduled ? Math.round((current.completed / current.scheduled) * 100) : null
  const memory = data.journal.find((e) => e.kind === 'monthly' && e.date === `${current.ym}-01`) ?? null
  const fragments = data.journal.filter((e) => e.kind !== 'monthly' && e.date.startsWith(current.ym)).slice(0, 3)
  const monthPhotos = photosOf(current.ym)

  /** A photo pinned to the wall belongs to the month's own page, created if it has none yet. */
  const pin = async (fetch: () => Promise<Attachment[]>): Promise<void> => {
    setPinning(true)
    setPinError(null)
    try {
      const added = await fetch()
      if (!added.length) return
      await window.api.journal.save(memory?.id ?? null, {
        date: `${current.ym}-01`,
        kind: 'monthly',
        title: memory?.title ?? `${current.label} — monthly memory`,
        body: memory?.body ?? '',
        mood: null,
        stepToward: null,
        prompts: memory?.prompts ?? {},
        tags: memory?.tags ?? [],
        goalId: memory?.goalId ?? null,
        letGoId: memory?.letGoId ?? null,
        attachmentIds: [...(memory?.attachments.map((a) => a.id) ?? []), ...added.map((a) => a.id)]
      })
    } catch (err) {
      setPinError(err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(err))
    } finally {
      setPinning(false)
    }
  }
  const leftBehind = data.letGos
    .map((l) => {
      const inMonth = l.checkins.filter((c) => c.date.startsWith(current.ym))
      return { l, free: inMonth.filter((c) => c.resisted).length, tracked: inMonth.length, setDown: !!l.leftBehindAt?.startsWith(current.ym) }
    })
    .filter((x) => x.tracked > 0 || x.setDown)

  return (
    <Page>
      <div className="kh-sheet !rounded-[12px] px-3 py-2 mb-6 flex flex-wrap items-center gap-1.5 sticky top-0 z-10">
        <button className={`kh-chip !border-0 ${selected === 'all' ? 'is-on' : '!bg-transparent'}`} onClick={() => setSelected('all')}>
          All six months
        </button>
        {months.map((ym, i) => (
          <button key={ym} className={`kh-chip !border-0 ${selected === ym ? 'is-on' : '!bg-transparent'}`} onClick={() => setSelected(ym)}>
            {i === 0 ? <span className="kh-dot is-laurel" /> : null}
            {monthLabel(ym, 'short')}
            {i === 0 ? ' · active' : ''}
          </button>
        ))}
        <span className="ml-auto">
          <Btn kind="ochre" size="sm" onClick={() => navigate({ name: 'review' })}>
            Weekly review
          </Btn>
        </span>
      </div>

      <section
        className={`kh-dotgrid rounded-[14px] border bg-[var(--sheet)] p-8 transition-colors ${dropOver ? 'border-[var(--laurel)] border-dashed' : 'border-[var(--rule-soft)]'}`}
        onDragOver={(e) => {
          if (selected !== 'all' && [...e.dataTransfer.types].includes('Files')) {
            e.preventDefault()
            setDropOver(true)
          }
        }}
        onDragLeave={() => setDropOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDropOver(false)
          if (selected !== 'all') void pin(() => importDropped(e))
        }}
      >
        <div className="flex flex-wrap items-start justify-between gap-4 mb-8">
          <div className="flex flex-col gap-1">
            <span className="t-stamp text-[var(--ochre-deep)]">Wall of continuity &amp; evidence</span>
            <span className="t-italic !text-[13.5px]">“We are what we pay attention to.” — the folio keeps the record so memory does not have to</span>
          </div>
          <span className="flex items-center gap-4 t-caption">
            <span className="flex items-center gap-1.5">
              <Dot /> Brass pin: a month
            </span>
            <span className="flex items-center gap-1.5">
              <span className="w-4 h-2 bg-[var(--docket)] inline-block" /> Tape: a keepsake
            </span>
          </span>
        </div>

        {selected === 'all' ? (
          <div className="grid gap-8 grid-cols-[repeat(auto-fill,minmax(250px,1fr))]">
            {folios.map((f, i) => (
              <FolioCard key={f.ym} folio={f} index={index(f.ym)} rotate={[-1.2, 0.8, -0.5, 1.1, -0.9, 0.6][i % 6]!} onOpen={() => setSelected(f.ym)} cover={photosOf(f.ym)[0]} />
            ))}
          </div>
        ) : (
          <div className="grid gap-8 items-start min-[1100px]:grid-cols-[240px_minmax(0,1fr)] min-[1450px]:grid-cols-[240px_minmax(0,1fr)_240px]">
            <div className="flex flex-col gap-8">
              {earlier.slice(0, 2).map((f, i) => (
                <FolioCard key={f.ym} folio={f} index={index(f.ym)} rotate={i % 2 ? 1 : -1.3} onOpen={() => setSelected(f.ym)} cover={photosOf(f.ym)[0]} />
              ))}
              <div className="kh-card relative p-5 pt-6 rotate-[1.2deg]">
                <span className="kh-pin" />
                <span className="t-stamp text-[var(--ochre-deep)] flex items-center gap-2">
                  <Quote size={13} /> Trail note
                </span>
                <p className="font-serif text-[17px] leading-[26px] m-0 mt-2">“Every step is small. The distance is what adds up.”</p>
                <span className="t-caption block text-right mt-2">— Khatwa</span>
              </div>
            </div>

            <article className="kh-card kh-tape relative px-8 pt-9 pb-7 flex flex-col gap-6 min-w-0">
              <div className="flex flex-col gap-2">
                <span className="t-stamp text-ink-3">
                  Folio N° {index(current.ym)} · Monthly synthesis {current.ym === months[0] ? <span className="text-laurel">· in progress</span> : null}
                </span>
                <h1 className="t-hero !text-[54px] !leading-[58px] m-0">{current.label}</h1>
                <span className="font-serif italic text-[16px] text-[var(--ochre-deep)]">
                  {current.completed ? `The month of ${plural(current.completed, 'kept step')}` : 'A quiet month on the trail'}
                </span>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div className="kh-docket p-4 flex flex-col">
                  <span className="t-stamp !text-[10px] text-ink-4">Tally of the vow</span>
                  <span className="font-serif text-[28px] leading-9">{duration(current.minutes)}</span>
                  <span className="t-caption">deliberate practice</span>
                </div>
                <div className="kh-docket p-4 flex flex-col">
                  <span className="t-stamp !text-[10px] text-ink-4">Steps kept</span>
                  <span className="font-serif text-[28px] leading-9">{current.completed}</span>
                  <span className="t-caption">{rate === null ? 'nothing scheduled' : `${rate}% of ${current.scheduled}`}</span>
                </div>
                <div className="kh-docket p-4 flex flex-col">
                  <span className="t-stamp !text-[10px] text-ink-4">Points pressed</span>
                  <span className="font-serif text-[28px] leading-9">{current.points}</span>
                  <span className="t-caption">{current.bestDay ? `best: ${dayMonth(current.bestDay.date)}` : '—'}</span>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                <span className="t-stamp text-laurel flex items-center gap-2">
                  <Sparkles size={14} /> Breakthroughs
                </span>
                {current.milestones.length === 0 && current.summits.length === 0 && current.seals.length === 0 ? (
                  <p className="t-italic m-0">No waypoint was cleared this month — the trail still counts every step.</p>
                ) : null}
                {current.summits.map((g) => (
                  <p key={`s${g.id}`} className="m-0 text-[15.5px] leading-6">
                    <b className="font-semibold">Summit reached:</b> {g.title}
                  </p>
                ))}
                {current.milestones.map((m, i) => (
                  <p key={`m${i}`} className="m-0 text-[15.5px] leading-6 flex gap-2">
                    <Dot tone="laurel" />
                    <span>
                      <span className="text-ink-4 font-serif text-[13px] mr-1.5">{dayMonth(m.date)}</span>
                      {m.title} <span className="t-caption">· {m.goal}</span>
                    </span>
                  </p>
                ))}
                {current.seals.map((a) => (
                  <p key={a.key} className="m-0 text-[15.5px] leading-6 flex items-center gap-2">
                    <Award size={14} className="text-[var(--ochre-deep)]" /> Seal pressed: {a.name}
                  </p>
                ))}
              </div>

              <div className="flex flex-col gap-2">
                <span className="t-stamp text-[var(--ochre-deep)] flex items-center gap-2">
                  <TriangleAlert size={14} /> The resistance encountered
                </span>
                <p className="m-0 font-serif text-[17px] leading-[26px] text-ink-2 [text-wrap:pretty]">
                  {resistance
                    ? `${resistance[0]} slipped ${plural(resistance[1], 'time')} this month — the rhythm that met the most friction. Worth asking what stood in its way.`
                    : 'No step was missed outright this month. Friction was met and passed.'}
                </p>
              </div>

              <div className="flex flex-col gap-3 pt-4 border-t border-[var(--rule)]">
                <div className="flex items-center justify-between gap-3">
                  <span className="t-stamp text-ink-2 flex items-center gap-2">
                    <BookOpen size={14} /> How did I change this month?
                  </span>
                  <span className="flex items-center gap-4">
                    <Btn kind="ghost" disabled={pinning} onClick={() => void pin(() => window.api.attachments.import(null))}>
                      <ImagePlus size={13} /> {pinning ? 'Pinning…' : 'Pin a photo'}
                    </Btn>
                    <Btn kind="ghost" onClick={() => setEditingMonth(current.ym)}>
                      <Pencil size={13} /> {memory ? 'Revise the page' : 'Write the month’s page'}
                    </Btn>
                  </span>
                </div>
                {memory && Object.keys(memory.prompts).length ? (
                  <div className="grid gap-4 min-[800px]:grid-cols-2">
                    {MONTHLY_PROMPTS.filter(([k]) => memory.prompts[k]).map(([k, label]) => (
                      <div key={k} className="flex flex-col gap-1">
                        <span className="t-stamp !text-[10.5px] text-[var(--ochre-deep)]">{label}</span>
                        <p className="m-0 font-serif text-[16px] leading-[25px] text-ink-2 whitespace-pre-wrap">{memory.prompts[k]}</p>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="m-0 t-italic !text-[15px]">What you’re proud of, what you learned, what was difficult, what’s next — a few lines, in your own words.</p>
                )}
              </div>

              {leftBehind.length ? (
                <div className="flex flex-col gap-2">
                  <span className="t-stamp text-laurel flex items-center gap-2">
                    <Backpack size={14} /> What I left behind
                  </span>
                  {leftBehind.map(({ l, free, tracked, setDown }) => (
                    <p key={l.id} className="m-0 text-[15.5px] leading-6">
                      <b className="font-semibold">{l.title}</b>
                      <span className="text-ink-3"> · {free} / {tracked} days free{setDown ? ' · set down at the cairn this month' : ''}</span>
                    </p>
                  ))}
                  {memory?.prompts.learned ? <p className="m-0 font-serif italic text-[16px] text-ink-2">“{memory.prompts.learned}”</p> : null}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-5 pt-4 border-t border-[var(--rule)] t-caption !text-[12.5px]">
                <span className="flex items-center gap-1.5">
                  <Footprints size={13} /> {current.completed}/{current.scheduled} rituals
                </span>
                <span className="flex items-center gap-1.5">
                  <Flag size={13} /> {plural(current.milestones.length, 'waypoint')} cleared
                </span>
                <span className="flex items-center gap-1.5">
                  <Award size={13} /> {plural(current.seals.length, 'seal')} pressed
                </span>
              </div>
            </article>

            <div className="flex flex-col gap-8">
              {pinError ? <Alert>{pinError}</Alert> : null}
              {monthPhotos.map((a, i) => (
                <div key={a.id} className="self-center" style={{ marginTop: i ? -6 : 0 }}>
                  <Polaroid att={a} tilt={[-2.2, 1.6, -0.8, 2.4][i % 4]} onOpen={() => setViewing(i)} />
                </div>
              ))}
              {fragments.map((e, i) => (
                <button key={e.id} className="kh-card relative p-5 pt-6 text-left flex flex-col gap-2" style={{ transform: `rotate(${i % 2 ? 1.2 : -0.8}deg)` }} onClick={() => navigate({ name: 'journal' })}>
                  <span className="kh-pin" />
                  <span className="t-stamp !text-[10.5px] text-ink-3">Journal · {dayMonth(e.date)}</span>
                  <span className="font-serif text-[16px] leading-6 [text-wrap:pretty]">{e.title ?? (e.body.length > 110 ? `${e.body.slice(0, 110)}…` : e.body || 'A daily check-in')}</span>
                </button>
              ))}
              {artifacts.length === 0 && current.seals.length === 0 && fragments.length === 0 ? (
                <div className="kh-card relative p-5 pt-6 -rotate-1 flex flex-col gap-3">
                  <span className="kh-pin" />
                  <span className="t-stamp text-ink-3">Keepsakes</span>
                  <p className="t-italic !text-[14px] m-0">Your wall is waiting for its first memory — journal entries, summits and seals from this month are pinned here.</p>
                  <Btn kind="soft" size="sm" onClick={() => navigate({ name: 'journal' })}>
                    Add a memory
                  </Btn>
                </div>
              ) : null}
              {artifacts.map(({ kind, g }, i) => (
                <button key={`${kind}${g.id}`} className="kh-docket relative p-5 text-left flex flex-col gap-2 shadow-[var(--shadow-rest)] kh-tape" style={{ transform: `rotate(${i % 2 ? 1 : -1.5}deg)` }} onClick={() => navigate({ name: 'mountain', id: g.id })}>
                  <div className="flex justify-between items-baseline">
                    <span className="t-stamp !text-[10.5px] text-ink-3">{kind === 'summit' ? 'Summit · ticket' : 'Expedition · ticket'}</span>
                    <span className="t-caption">{dayMonth((kind === 'summit' ? g.closedAt! : g.createdAt).slice(0, 10))}</span>
                  </div>
                  <span className="flex items-center gap-2 text-[13px] text-ink-3">
                    <Mountain size={13} /> {kind === 'summit' ? 'Base camp → the peak' : 'Base camp → first waypoint'}
                  </span>
                  <span className="bg-[var(--card)] rounded-lg px-4 py-3 font-serif text-[18px] leading-6 [text-wrap:balance]">{g.title}</span>
                </button>
              ))}
              {current.seals.map((a, i) => (
                <div key={a.key} className="kh-card relative p-5 pt-6 flex items-center gap-4" style={{ transform: `rotate(${i % 2 ? -1 : 1.2}deg)` }}>
                  <span className="kh-pin" />
                  <span className="kh-seal is-earned !w-12 !h-12">
                    <Award size={17} />
                  </span>
                  <span className="flex flex-col">
                    <span className="font-serif text-[16px] leading-5">{a.name}</span>
                    <span className="t-caption">{dayMonth(a.unlockedAt!.slice(0, 10))}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <footer className="flex flex-wrap items-center gap-4 mt-5 t-caption !text-[12.5px]">
        <span className="flex items-center gap-2">
          <Dot tone="laurel" /> <b className="text-ink font-semibold">Active board: the last {MONTHS} months</b>
        </span>
        <span>
          {plural(folios.length, 'folio')} · {plural(totals.keepsakes, 'keepsake')} pinned · {duration(totals.minutes)} chronicled
        </span>
        <span className="ml-auto italic font-serif">Since {dayMonth(addDays(`${months[months.length - 1]!}-01`, 0))}</span>
      </footer>
      {editingMonth ? <MonthlyEditor ym={editingMonth} entry={data.journal.find((e) => e.kind === 'monthly' && e.date === `${editingMonth}-01`) ?? null} onClose={() => setEditingMonth(null)} /> : null}
      {viewing !== null && selected !== 'all' ? <Lightbox photos={photosOf(data.selectedYm)} start={viewing} onClose={() => setViewing(null)} /> : null}
    </Page>
  )
}
