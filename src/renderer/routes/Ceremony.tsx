import { useEffect, useState } from 'react'
import { ArrowLeft, BookOpen, Footprints, Hourglass, Mountain, RotateCcw, ShieldCheck, Sprout } from 'lucide-react'
import type { JournalEntry, LetGoView } from '@shared/types'
import { useData } from '../hooks/useData'
import { dayMonth, plural } from '../lib/khatwa'
import { useShell } from '../khatwa/nav'
import { Page } from '../khatwa/Page'
import { Alert, Btn, LoadError, Loading, Stamp } from '../khatwa/ui'

/** 0 idle · 1 the item detaches · 2 it rests on the cairn · 3 the pack lightens · 4 the words appear */
type Phase = 0 | 1 | 2 | 3 | 4

function CairnScene({ phase, title }: { phase: Phase; title: string }) {
  const onCairn = phase >= 2
  return (
    <svg viewBox="0 0 360 300" className="w-full h-auto" role="img" aria-label={onCairn ? `${title} left behind; the backpack is lighter` : `A backpack carrying ${title}`}>
      <defs>
        <linearGradient id="sky" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor="var(--ochre-wash)" />
          <stop offset="1" stopColor="var(--sheet)" />
        </linearGradient>
      </defs>
      <rect width="360" height="300" fill="url(#sky)" rx="8" />
      <circle cx="270" cy="70" r="34" fill="var(--ochre-tint)" opacity="0.8" />
      <path d="M0 190 L70 120 L120 160 L190 80 L260 150 L310 115 L360 160 L360 300 L0 300 Z" fill="var(--docket)" />
      <path d="M0 225 C80 205 160 240 240 222 S330 214 360 222 L360 300 L0 300 Z" fill="var(--rule-soft)" />
      <path d="M30 300 C90 270 150 262 200 250 S300 236 350 228" fill="none" stroke="var(--rule)" strokeWidth="3" strokeDasharray="6 7" />

      {/* cairn */}
      <g>
        <ellipse cx="235" cy="246" rx="44" ry="13" fill="#8e877e" />
        <ellipse cx="235" cy="226" rx="34" ry="12" fill="#a39b90" />
        <ellipse cx="236" cy="208" rx="25" ry="10" fill="#8e877e" />
        <ellipse cx="234" cy="192" rx="18" ry="8" fill="#b3aa9e" />
        <ellipse
          cx="235"
          cy="178"
          rx="12"
          ry="6"
          fill="var(--laurel)"
          style={{ opacity: onCairn ? 1 : 0, transform: onCairn ? 'none' : 'translateY(-8px)', transition: 'opacity .9s ease, transform .9s ease' }}
        />
      </g>

      {/* the pack */}
      <g style={{ transform: phase >= 3 ? 'translateY(-10px) scale(0.93)' : 'none', transformOrigin: '120px 240px', transition: 'transform 1.1s ease' }}>
        <rect x="82" y="168" width="76" height="80" rx="16" fill={phase >= 3 ? '#8b8a60' : '#6f6d47'} style={{ transition: 'fill 1.1s ease' }} />
        <path d="M86 184 Q120 160 154 184 L154 200 Q120 186 86 200 Z" fill="#5c5a3a" />
        <rect x="104" y="208" width="32" height="24" rx="5" fill="#5c5a3a" />
        <path d="M96 170 Q98 146 118 142 Q140 146 144 170" fill="none" stroke="#4a4830" strokeWidth="5" strokeLinecap="round" />
      </g>

      {/* the item, tied to the pack, then carried to the cairn */}
      <g
        style={{
          transform: phase === 0 ? 'translate(0,0)' : phase === 1 ? 'translate(52px,-40px) rotate(-6deg)' : 'translate(96px,-30px) scale(0.2)',
          opacity: phase >= 2 ? 0 : 1,
          transformOrigin: '150px 210px',
          transition: 'transform 1s ease, opacity .8s ease .3s'
        }}
      >
        <line x1="150" y1="196" x2="168" y2="210" stroke="var(--ink-3)" strokeWidth="1.5" />
        <rect x="160" y="204" width="82" height="30" rx="4" fill="var(--card)" stroke="var(--rule)" transform="rotate(8 200 219)" />
        <text x="201" y="224" fontSize="11" textAnchor="middle" fill="var(--ink-2)" fontFamily="var(--font-serif)" transform="rotate(8 200 219)">
          {title.length > 16 ? `${title.slice(0, 15)}…` : title}
        </text>
      </g>
    </svg>
  )
}

export default function Ceremony({ id }: { id: number }) {
  const { navigate, settings } = useShell()
  const [phase, setPhase] = useState<Phase>(0)
  const [vow, setVow] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const { data, error: loadError, refetch } = useData<{ item: LetGoView | null; journal: JournalEntry[] }>(async () => {
    const [item, journal] = await Promise.all([window.api.letGo.get(id), window.api.journal.list()])
    return { item, journal }
  }, [id])

  const reduce = settings?.reduceMotion || window.matchMedia('(prefers-reduced-motion: reduce)').matches

  useEffect(() => {
    if (phase === 0 || phase === 4) return
    const t = setTimeout(() => setPhase((p) => (p + 1) as Phase), reduce ? 0 : 1100)
    return () => clearTimeout(t)
  }, [phase, reduce])

  if (loadError) return <Page><LoadError message={loadError} onRetry={refetch} /></Page>
  if (!data) return <Page><Loading label="Loading…" /></Page>
  const item = data.item
  if (!item) {
    return (
      <Page>
        <div className="kh-empty">
          <span className="t-h2 text-ink">This is no longer in your backpack.</span>
          <Btn kind="ruled" onClick={() => navigate({ name: 'letgo' })}>
            Back to Let Go
          </Btn>
        </div>
      </Page>
    )
  }

  const s = item.stats
  const sealed = item.status === 'left_behind' && phase === 0
  const done = phase === 4 || sealed
  const reflections = data.journal.filter((e) => e.letGoId === item.id).length + item.checkins.filter((c) => c.note || c.trigger || c.need).length
  const topAlt = item.alternatives[0]

  const leave = async (): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await window.api.letGo.leaveBehind(item.id, vow)
      setPhase(reduce ? 4 : 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Page>
      <button className="flex items-center gap-2 text-[15px] text-[var(--ochre-deep)] mb-5 hover:underline" onClick={() => navigate({ name: 'letgo', id: item.id })}>
        <ArrowLeft size={16} /> Back to the backpack
      </button>

      <header className="flex flex-col gap-4 mb-9 max-w-[900px]">
        <h1 className="t-hero !text-[52px] !leading-[60px] m-0 [text-wrap:balance]">{done ? 'The climb became lighter.' : 'You have been carrying this for a while.'}</h1>
        <p className="m-0 text-[17px] flex flex-wrap gap-x-2">
          <span className="font-semibold">Weight cast off:</span>
          <span className="font-serif text-[var(--ochre-deep)]">
            {item.title} · {plural(s.daysCarried, 'day')} on the trail · {s.daysFree} days free ({Math.round(s.freedomRate * 100)}% freedom rate)
          </span>
        </p>
      </header>

      {error ? <div className="mb-6"><Alert>{error}</Alert></div> : null}

      <div className="grid gap-7 min-[1100px]:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <div className="flex flex-col gap-5">
          <section className="kh-card kh-tape p-5 flex flex-col gap-4">
            <div className="flex items-center justify-between">
              <span className="t-stamp !text-[10.5px] text-ink-3">Leaving it behind</span>
              <span className="t-caption">{item.goalTitle ?? 'The trail'}</span>
            </div>
            <div className="rounded-lg overflow-hidden">
              <CairnScene phase={sealed ? 4 : phase} title={item.title} />
            </div>
            <blockquote className="kh-docket m-0 p-5 font-serif text-[20px] leading-[30px] text-[var(--ochre-deep)] [text-wrap:pretty]" style={{ opacity: done ? 1 : 0.55, transition: 'opacity 1s ease' }}>
              “The mountain didn’t change. But the climb became lighter.”
            </blockquote>
            {done ? (
              <div className="flex items-center gap-3 kh-rise">
                <span className="w-8 h-8 rounded-lg grid place-items-center bg-[var(--laurel-wash)] text-laurel">
                  <ShieldCheck size={16} />
                </span>
                <span className="flex flex-col">
                  <span className="t-stamp !text-[10.5px] text-ink-2">Set down &amp; witnessed</span>
                  <span className="t-caption">{item.leftBehindAt ? dayMonth(item.leftBehindAt.slice(0, 10)) : 'Today'}</span>
                </span>
              </div>
            ) : null}
          </section>
        </div>

        <div className="flex flex-col gap-5">
          <section className="kh-sheet p-6 flex flex-col gap-5">
            <div className="flex items-start justify-between gap-3">
              <h2 className="t-h2 m-0 flex items-center gap-2">
                <Hourglass size={18} className="text-[var(--ochre-deep)]" /> What changed while you carried it
              </h2>
              <Stamp tone="laurel" className="!text-[10px]">From your check-ins</Stamp>
            </div>
            <div className="grid gap-3 grid-cols-2">
              <div className="kh-card p-4 flex flex-col gap-1">
                <span className="font-serif text-[34px] leading-10 text-[var(--laurel-deep)]">{s.daysFree}</span>
                <span className="text-[14px] font-semibold">Days chosen differently</span>
                <span className="t-caption">of {s.daysTracked} days you checked in</span>
              </div>
              <div className="kh-card p-4 flex flex-col gap-1">
                <span className="font-serif text-[34px] leading-10 text-[var(--ochre-deep)]">{s.bestStreak}</span>
                <span className="text-[14px] font-semibold">Longest stillness</span>
                <span className="t-caption">consecutive free days — currently {s.currentStreak}</span>
              </div>
              <div className="kh-card p-4 flex flex-col gap-1">
                <span className="font-serif text-[24px] leading-8 [text-wrap:balance]">{topAlt ? topAlt.text : item.replacement ?? '—'}</span>
                <span className="text-[14px] font-semibold flex items-center gap-1.5">
                  <Sprout size={14} className="text-laurel" /> What helped most
                </span>
                <span className="t-caption">{topAlt ? `logged on ${plural(topAlt.count, 'free day')}` : 'what you planned to do instead'}</span>
              </div>
              <div className="kh-card p-4 flex flex-col gap-1">
                <span className="font-serif text-[34px] leading-10">{reflections}</span>
                <span className="text-[14px] font-semibold flex items-center gap-1.5">
                  <BookOpen size={14} /> Reflections written
                </span>
                <span className="t-caption">notes and check-ins where you looked closer</span>
              </div>
            </div>
          </section>

          <section className="kh-card p-6 flex flex-col gap-3">
            <span className="t-stamp !text-[10.5px] text-ink-3">A promise to yourself · optional</span>
            {item.status === 'left_behind' ? (
              <p className="m-0 font-serif italic text-[20px] leading-[32px] text-ink-2 [text-wrap:pretty]">{item.vow ? `“${item.vow}”` : 'No words needed. That is enough.'}</p>
            ) : (
              <textarea
                className="kh-textarea !font-serif !italic !text-[18px]"
                rows={3}
                value={vow}
                placeholder={`I used ${item.title.toLowerCase()} to rest. Now I choose ${item.replacement?.toLowerCase() ?? 'something kinder'}…`}
                onChange={(e) => setVow(e.target.value)}
              />
            )}
          </section>

          <section className="kh-docket p-5 flex gap-3">
            <ShieldCheck size={20} className="text-laurel shrink-0 mt-0.5" />
            <span className="flex flex-col gap-1">
              <span className="text-[14.5px] font-semibold">The trail’s memory keeps every step</span>
              <span className="text-[13.5px] text-ink-3 [text-wrap:pretty]">
                Leaving it behind is not a promise of immunity. If it ever returns you never start from zero — every free day stays counted, and you can keep recording days from here.
              </span>
            </span>
          </section>

          {item.status === 'carrying' ? (
            <div className="flex flex-wrap items-center gap-3">
              <Btn kind="laurel" size="lg" disabled={busy || phase > 0} onClick={() => void leave()}>
                <Footprints size={17} /> Leave this weight behind &amp; continue the climb
              </Btn>
              <Btn kind="soft" onClick={() => navigate({ name: 'letgo', id: item.id })}>
                Not yet
              </Btn>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              {item.goalId !== null ? (
                <Btn kind="laurel" size="lg" onClick={() => navigate({ name: 'mountain', id: item.goalId! })}>
                  <Mountain size={16} /> Continue toward {item.goalTitle}
                </Btn>
              ) : (
                <Btn kind="laurel" size="lg" onClick={() => navigate({ name: 'today' })}>
                  Continue the climb
                </Btn>
              )}
              <Btn kind="soft" onClick={() => navigate({ name: 'journal', letGoId: item.id, prompt: 'What did carrying this teach me?' })}>
                Write about it
              </Btn>
              <Btn kind="ghost" onClick={() => void window.api.letGo.pickUpAgain(item.id).then(() => navigate({ name: 'letgo', id: item.id }))}>
                <RotateCcw size={14} /> It came back — I noticed, and I’ll continue
              </Btn>
            </div>
          )}
        </div>
      </div>
    </Page>
  )
}
