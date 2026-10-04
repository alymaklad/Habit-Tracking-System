import { Award, Backpack, Check, Clock, Flame, Flag, Lock, Mountain, NotebookPen, Pencil, SlidersHorizontal, Sun, Target, Trophy } from 'lucide-react'
import type { AchievementView, DashboardView, GoalView, JournalEntry, LetGoView, PersonalRecordView, ProgressView, WeeklyReview } from '@shared/types'
import { levelFloor, levelTitle } from '@shared/levels'
import emblem from '../assets/emblem-large.png'
import { useData } from '../hooks/useData'
import { dayMonth, plural, roman, shortMonthYear } from '../lib/khatwa'
import { InkLine } from '../khatwa/charts'
import { useShell } from '../khatwa/nav'
import { Page } from '../khatwa/Page'
import { Bar, Btn, Dot, LoadError, Loading, Stamp } from '../khatwa/ui'

type Data = {
  dash: DashboardView
  progress: ProgressView
  records: PersonalRecordView[]
  achievements: AchievementView[]
  review: WeeklyReview | null
  goals: GoalView[]
  journal: JournalEntry[]
  letGos: LetGoView[]
}

const RECORD_ICONS = [Flame, Clock, Sun, Target, Trophy, Award]

export function SealGlyph({ a, size = 20 }: { a: AchievementView; size?: number }) {
  const k = a.key
  const Icon = k.startsWith('streak') ? Flame : k.startsWith('hours') ? Clock : k.startsWith('tasks') ? Check : k === 'perfect_week' ? Sun : k === 'beat_record' ? Trophy : k === 'comeback' ? Mountain : Award
  return <Icon size={size} strokeWidth={1.6} />
}

export default function Me() {
  const { navigate, settings } = useShell()
  const { data, error, refetch } = useData<Data>(async () => {
    const [dash, progress, records, achievements, review, goals, journal, letGos] = await Promise.all([
      window.api.view.dashboard(),
      window.api.view.progress(26),
      window.api.view.personalRecords(),
      window.api.view.achievements(),
      window.api.view.weeklyReview(),
      window.api.goals.list(),
      window.api.journal.list(),
      window.api.letGo.list()
    ])
    return { dash, progress, records, achievements, review, goals, journal, letGos }
  }, [])

  if (error) return <Page><LoadError message={error} onRetry={refetch} /></Page>
  if (!data) return <Page><Loading label="Opening the dossier…" /></Page>

  const lvl = data.dash.level
  const name = settings?.displayName.trim() ?? ''
  const tiers = Array.from({ length: 5 }, (_, i) => Math.max(1, lvl.level - 2) + i)
  const unlocked = data.achievements.filter((a) => a.unlockedAt)
  const seals = [...data.achievements].sort((a, b) => Number(!!b.unlockedAt) - Number(!!a.unlockedAt) || b.progress - a.progress).slice(0, 5)
  const hours = data.progress.hoursPerWeek
  const activeGoals = data.goals.filter((g) => g.status === 'active')
  const summits = data.goals.filter((g) => g.status === 'achieved')
  const peakIdx = hours.reduce((best, p, i, arr) => (p.value > (arr[best]?.value ?? -1) ? i : best), 0)

  return (
    <Page>
      <section className="kh-sheet relative overflow-hidden p-8 mb-12 grid gap-10 min-[900px]:grid-cols-[250px_1fr] items-center">
        <div className="bg-[var(--card)] p-3 pb-4 shadow-[var(--shadow-float)] -rotate-2 relative mx-auto w-[230px]">
          <span className="kh-pin" />
          <img src={emblem} alt="" className="w-full aspect-[4/5] object-cover mix-blend-multiply dark:mix-blend-normal" />
          <div className="flex justify-between t-stamp !text-[9.5px] text-ink-4 mt-2.5">
            <span>{name ? name.split(/\s+/)[0] : 'The climber'}</span>
            <span>Level {lvl.level}</span>
          </div>
          <div className="text-center t-stamp !text-[10px] text-ink-3 mt-1">Persona archival</div>
        </div>

        <div className="flex flex-col gap-5 min-w-0">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <span className="flex items-center gap-3 flex-wrap">
              <Stamp tone="laurel-solid">
                Lvl {lvl.level} · {lvl.title}
              </Stamp>
              <span className="t-stamp text-[var(--ochre-deep)]">{lvl.currentXp.toLocaleString()} deliberate XP</span>
            </span>
            {(data.review?.streak ?? 0) > 0 ? (
              <span className="flex items-center gap-2 text-[13px] text-ink-3">
                <Dot /> Unbroken trail
              </span>
            ) : null}
          </div>
          <h1 className="t-hero m-0">{name || 'Who am I becoming?'}</h1>
          <p className="t-italic !text-[17px] m-0 [text-wrap:pretty]">
            {name ? `${lvl.title} — ${plural(lvl.xpToNext, 'point')} of XP from becoming ${levelTitle(lvl.level + 1)}.` : 'Give the folio your name in Settings, and this page becomes your dossier.'}
          </p>
          <div className="kh-card px-6 py-5">
            <p className="font-serif italic text-[20px] leading-[31px] m-0 text-ink-2 [text-wrap:pretty]">Your character is not carved in stone; it is folded from the paper of daily practice.</p>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <span className="flex items-center gap-3">
              <Flame size={18} className="text-[var(--ochre-deep)]" />
              <span className="flex flex-col">
                <span className="text-[14px] font-semibold">Active vow of consistency</span>
                <span className="t-caption">
                  {(data.review?.streak ?? 0) > 0 ? `${plural(data.review!.streak, 'day')} of unbroken daily rhythm` : 'A new trail begins with the next kept step'} · {data.progress.totalHours} hours logged in all
                </span>
              </span>
            </span>
            <Btn kind="laurel" size="sm" onClick={() => navigate({ name: 'settings' })}>
              <Pencil size={13} /> {name ? 'Amend name' : 'Add your name'}
            </Btn>
          </div>
        </div>
      </section>

      <section className="mb-12">
        <div className="flex items-end justify-between gap-4 mb-4">
          <div className="flex flex-col gap-1">
            <span className="t-stamp text-[var(--ochre-deep)]">Maturation horizon</span>
            <h2 className="t-h1 !text-[30px] m-0">The Evolutionary Arc</h2>
          </div>
          <span className="t-italic !text-[13px]">Each tier is earned over weeks, not days</span>
        </div>
        <div className="kh-sheet p-6 flex flex-col gap-7">
          <div className="grid gap-3 grid-cols-5">
            {tiers.map((t) => {
              const current = t === lvl.level
              const past = t < lvl.level
              return (
                <div key={t} className={`rounded-[10px] p-4 flex flex-col gap-2 relative ${current ? 'bg-[var(--card)] ring-2 ring-[var(--ink)]' : 'bg-[var(--docket)]'} ${t > lvl.level ? 'opacity-55' : ''}`}>
                  {current ? <span className="absolute -top-2.5 right-3 kh-stamp is-ochre-solid !text-[9.5px] !py-0">Current</span> : null}
                  <div className="flex justify-between items-center">
                    <span className="font-serif text-[12px] text-ink-4">{String(t).padStart(2, '0')}</span>
                    {past ? <Check size={14} className="text-laurel" /> : t > lvl.level ? <Lock size={13} className="text-ink-4" /> : <Target size={14} className="text-[var(--ochre-deep)]" />}
                  </div>
                  <span className="text-[15px] font-semibold">{levelTitle(t)}</span>
                  <span className="t-caption">
                    Lvl {t} — {current ? `${lvl.currentXp.toLocaleString()} XP` : `${levelFloor(t).toLocaleString()} XP`}
                  </span>
                  {current ? <Bar value={lvl.progress} tone="ochre" thin /> : past ? <Bar value={1} thin /> : null}
                </div>
              )
            })}
          </div>
          {hours.length > 1 ? (
            <div className="kh-card p-5">
              <div className="flex justify-between items-baseline mb-2">
                <span className="t-stamp text-ink-4">Deep work hours reclaimed · last {hours.length} weeks</span>
                <span className="t-stamp text-laurel">{data.progress.totalHours} total hrs anchored</span>
              </div>
              <InkLine values={hours.map((h) => h.value)} labels={hours.map((h) => `Week of the ${h.label}`)} mark={peakIdx} format={(v) => `${v} h`} height={150} axisLabels={[`${hours.length} weeks ago`, 'This week']} />
            </div>
          ) : null}
        </div>
      </section>

      <section className="mb-12">
        <div className="flex items-end justify-between gap-4 mb-4">
          <div className="flex flex-col gap-1">
            <span className="t-stamp text-[var(--ochre-deep)]">Permanent inscriptions</span>
            <h2 className="t-h1 !text-[30px] m-0">The Ledger of High Marks</h2>
          </div>
        </div>
        {data.records.length === 0 ? (
          <div className="kh-empty">Records are inscribed as your weeks fill in.</div>
        ) : (
          <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(210px,1fr))]">
            {data.records.map((r, i) => {
              const Icon = RECORD_ICONS[i % RECORD_ICONS.length]!
              return (
                <div key={r.kind} className="kh-sheet p-5 flex flex-col gap-2">
                  <div className="flex justify-between items-center">
                    <Icon size={17} className="text-[var(--ochre-deep)]" />
                    <span className="t-stamp !text-[10px] text-ink-4">{r.achievedOn ? shortMonthYear(r.achievedOn) : 'All time'}</span>
                  </div>
                  <span className="t-stamp !text-[10.5px] text-ink-3 mt-2">{r.label}</span>
                  <span className="font-serif text-[30px] leading-9">{r.value}</span>
                  <span className="t-caption flex items-center gap-1.5 mt-auto">
                    <Check size={12} /> Certified in folio{r.achievedOn ? ` · ${dayMonth(r.achievedOn)}` : ''}
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </section>

      <section className="mb-12">
        <div className="flex items-end justify-between gap-4 mb-4">
          <div className="flex flex-col gap-1">
            <span className="t-stamp text-[var(--ochre-deep)]">Tactile markings</span>
            <h2 className="t-h1 !text-[30px] m-0">Archival Seals &amp; Wax Stamps</h2>
          </div>
          <Btn kind="ghost" onClick={() => navigate({ name: 'achievements' })}>
            All {data.achievements.length} seals · {unlocked.length} pressed
          </Btn>
        </div>
        <div className="grid gap-4 grid-cols-[repeat(auto-fill,minmax(180px,1fr))]">
          {seals.map((a, i) => (
            <div key={a.key} className="kh-card p-5 flex flex-col items-center text-center gap-3">
              <span className={`kh-seal ${a.unlockedAt ? 'is-earned' : ''}`} style={{ transform: `rotate(${(i % 3) - 1}deg)` }}>
                <SealGlyph a={a} />
              </span>
              <span className="font-serif text-[18px] leading-6 [text-wrap:balance]">{a.name}</span>
              <span className="t-caption [text-wrap:pretty]">{a.description}</span>
              {a.unlockedAt ? (
                <Stamp tone="ochre" className="!text-[10px]">Pressed · {dayMonth(a.unlockedAt.slice(0, 10))}</Stamp>
              ) : (
                <div className="w-full flex flex-col gap-1">
                  <Bar value={a.progress} thin />
                  <span className="t-caption">{a.progressLabel}</span>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      <section className="mb-12">
        <div className="flex flex-col gap-1 mb-4">
          <span className="t-stamp text-[var(--ochre-deep)]">Inner work</span>
          <h2 className="t-h1 !text-[30px] m-0">What I carry, what I learn</h2>
        </div>
        <div className="grid gap-4 grid-cols-[repeat(auto-fit,minmax(240px,1fr))]">
          <button className="kh-sheet p-5 text-left flex flex-col gap-2 hover:border-[var(--rule)]" onClick={() => navigate({ name: 'journal' })}>
            <NotebookPen size={18} className="text-laurel" />
            <span className="text-[17px] font-semibold">Journal</span>
            <span className="t-caption !text-[13px]">
              {data.journal.length ? `${plural(data.journal.length, 'entry', 'entries')} · last on ${dayMonth(data.journal[0]!.date)}` : 'What’s on your mind? Write a reflection.'}
            </span>
          </button>
          <button className="kh-sheet p-5 text-left flex flex-col gap-2 hover:border-[var(--rule)]" onClick={() => navigate({ name: 'letgo' })}>
            <Backpack size={18} className="text-[var(--ochre-deep)]" />
            <span className="text-[17px] font-semibold">Let Go</span>
            <span className="t-caption !text-[13px]">
              {data.letGos.length
                ? `${plural(data.letGos.filter((l) => l.status === 'carrying').length, 'thing')} carried · ${data.letGos.filter((l) => l.status === 'left_behind').length} left at the cairn`
                : 'Nothing in the backpack. Add something to let go.'}
            </span>
          </button>
          <button className="kh-sheet p-5 text-left flex flex-col gap-2 hover:border-[var(--rule)]" onClick={() => navigate({ name: 'mountains' })}>
            <Mountain size={18} className="text-slate" />
            <span className="text-[17px] font-semibold">Mountains</span>
            <span className="t-caption !text-[13px]">
              {activeGoals.length} being climbed · {plural(summits.length, 'summit')} reached
            </span>
          </button>
          <button className="kh-sheet p-5 text-left flex flex-col gap-2 hover:border-[var(--rule)]" onClick={() => navigate({ name: 'settings' })}>
            <SlidersHorizontal size={18} className="text-ink-3" />
            <span className="text-[17px] font-semibold">Settings</span>
            <span className="t-caption !text-[13px]">Profile, appearance, Google, AI planner, scoring</span>
          </button>
        </div>
      </section>

      <section className="kh-card kh-tape p-8 flex flex-col gap-4">
        <span className="t-stamp text-[var(--ochre-deep)]">Quarterly introspection folio · {roman(Math.ceil((new Date().getMonth() + 1) / 3))}</span>
        <h2 className="t-h2 m-0">Where the practice is carrying you</h2>
        <p className="m-0 text-[16px] leading-[27px] text-ink-2 [text-wrap:pretty]">
          <span className="font-serif text-[40px] leading-none float-left mr-2 mt-1">{activeGoals.length ? 'Y' : 'T'}</span>
          {activeGoals.length
            ? `You are climbing ${plural(activeGoals.length, 'mountain')}: ${activeGoals.map((g) => g.title).join(', ')}. `
            : 'There is no mountain in view yet — only the daily steps, which is where every summit begins. '}
          {summits.length ? `You have already stood on ${plural(summits.length, 'summit')}. ` : ''}
          Across your folio you have logged {data.progress.totalHours} hours of deliberate practice, and earned {unlocked.length} of {data.achievements.length} seals.
          {data.progress.improvementPercentage !== null
            ? ` This week’s hours ran ${data.progress.improvementPercentage >= 0 ? `${Math.round(data.progress.improvementPercentage)}% above` : `${Math.round(-data.progress.improvementPercentage)}% below`} the week before.`
            : ''}
        </p>
        <div className="flex flex-wrap items-center justify-between gap-3 pt-3 border-t border-[var(--rule)]">
          <span className="t-caption italic">Recorded from the folio’s own ledger</span>
          <span className="flex gap-3">
            <Btn kind="soft" size="sm" onClick={() => navigate({ name: 'review' })}>
              Weekly review
            </Btn>
            <Btn kind="ochre" size="sm" onClick={() => navigate({ name: activeGoals.length ? 'mountains' : 'expedition' })}>
              {activeGoals.length ? (
                <>
                  <Mountain size={13} /> The mountains
                </>
              ) : (
                <>
                  <Flag size={13} /> Choose a mountain
                </>
              )}
            </Btn>
          </span>
        </div>
      </section>
    </Page>
  )
}
