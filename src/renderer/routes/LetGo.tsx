import { useEffect, useState } from 'react'
import { Backpack, Flame, Mountain, Moon, Pencil, Plus, RotateCcw, Trash2, TriangleAlert } from 'lucide-react'
import type { GoalView, GuideInsight, LetGoView, Tool } from '@shared/types'
import { useData } from '../hooks/useData'
import { dayMonth, plural, today } from '../lib/khatwa'
import { CheckInModal, CONTEXT_LABEL, FEELING_LABEL, GreenXMonth, GuideCard, LetGoForm, ToolsPanel, WEIGHT_LABEL, WEIGHT_TONE } from '../khatwa/letgo'
import { useShell } from '../khatwa/nav'
import { Page } from '../khatwa/Page'
import { Alert, Bar, Btn, Dot, Eyebrow, IconBtn, LoadError, Loading, Modal, Stamp } from '../khatwa/ui'

type Data = { items: LetGoView[]; goals: GoalView[]; tools: Tool[]; guide: GuideInsight[] }

function PackCard({ item, selected, onSelect }: { item: LetGoView; selected: boolean; onSelect: () => void }) {
  const { navigate } = useShell()
  const s = item.stats
  return (
    <article
      className={`kh-card relative p-5 flex flex-col gap-3 cursor-pointer ${selected ? 'kh-tape !border-l-4 !border-l-[var(--laurel-deep)]' : 'hover:border-[var(--rule)]'}`}
      onClick={onSelect}
      aria-current={selected}
    >
      <div className="flex items-center justify-between gap-2 flex-wrap">
        <span className="flex items-center gap-2 flex-wrap">
          <Stamp tone={WEIGHT_TONE[item.weight]} className="!text-[10px]">{WEIGHT_LABEL[item.weight]}</Stamp>
          {item.goalTitle ? (
            <span className="text-[12px] text-ink-3 flex items-center gap-1">
              <Mountain size={12} /> {item.goalTitle}
            </span>
          ) : null}
        </span>
        {item.ceremonyReady ? <Stamp tone="laurel" className="!text-[10px]">Almost left behind</Stamp> : null}
      </div>
      <h3 className="font-serif text-[22px] leading-7 font-normal m-0">{item.title}</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="kh-docket px-3 py-2.5">
          <span className="t-caption block">Freedom rate</span>
          <span className="text-[19px] font-semibold">{s.daysTracked ? `${Math.round(s.freedomRate * 100)}%` : '—'}</span>
          <span className="t-caption"> {s.daysFree}/{s.daysTracked} days</span>
        </div>
        <div className="kh-docket px-3 py-2.5">
          <span className="t-caption block">Current stillness</span>
          <span className="text-[19px] font-semibold">{plural(s.currentStreak, 'day')}</span>
          <span className="t-caption"> · best {s.bestStreak}</span>
        </div>
      </div>
      <Bar value={s.freedomRate} />
      {item.ceremonyReady ? (
        <div className="kh-docket p-4 flex flex-col gap-3" onClick={(e) => e.stopPropagation()}>
          <span className="t-stamp !text-[10.5px] text-[var(--ochre-deep)] flex items-center gap-1.5">
            <Flame size={13} /> Ceremony threshold reached
          </span>
          <span className="text-[14px] text-ink-2 [text-wrap:pretty]">
            Left behind on {s.daysFree} of {s.daysTracked} tracked days. This weight has loosened its straps.
          </span>
          <Btn kind="ochre" size="sm" onClick={() => navigate({ name: 'ceremony', id: item.id })}>
            Begin leave-behind ceremony →
          </Btn>
        </div>
      ) : null}
    </article>
  )
}

export default function LetGo({ id, create }: { id?: number; create?: boolean }) {
  const [selected, setSelected] = useState<number | null>(id ?? null)
  const [editing, setEditing] = useState<LetGoView | 'new' | null>(create ? 'new' : null)
  const [checkDate, setCheckDate] = useState<string | null>(null)
  const [confirmRemove, setConfirmRemove] = useState<LetGoView | null>(null)
  const [error, setError] = useState<string | null>(null)
  const { data, error: loadError, refetch } = useData<Data>(async () => {
    const [items, goals, tools, guide] = await Promise.all([window.api.letGo.list(), window.api.goals.list(), window.api.tools.list(), window.api.guide.list()])
    return { items, goals, tools, guide }
  }, [])

  const carrying = data?.items.filter((i) => i.status === 'carrying') ?? []
  const behind = data?.items.filter((i) => i.status === 'left_behind') ?? []
  const current = data?.items.find((i) => i.id === selected) ?? carrying[0] ?? behind[0] ?? null
  useEffect(() => {
    if (id !== undefined) setSelected(id)
  }, [id])

  if (loadError) return <Page><LoadError message={loadError} onRetry={refetch} /></Page>
  if (!data) return <Page><Loading label="Opening the backpack…" /></Page>

  const now = today()
  const tracked = carrying.reduce((s, i) => s + i.stats.daysTracked, 0)
  const free = carrying.reduce((s, i) => s + i.stats.daysFree, 0)
  const ready = carrying.filter((i) => i.ceremonyReady).length
  const lastCheck = data.items.flatMap((i) => i.checkins).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
  const mine = (key: string): boolean => current !== null && new RegExp(`^(letgo-feeling|letgo-alternative|ceremony):${current.id}(:|$)`).test(key)
  const insights = data.guide.filter((g) => mine(g.key) || !/^(letgo|ceremony)/.test(g.key))

  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setError(null)
    try {
      await fn()
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return (
    <Page>
      <header className="flex flex-wrap items-end justify-between gap-6 mb-8">
        <div className="flex flex-col gap-3 max-w-[680px]">
          <Eyebrow>
            <Dot /> Folio VI · The pack &amp; the pass <span className="is-quiet">/ Inventory of weights &amp; shedding</span>
          </Eyebrow>
          <h1 className="t-hero m-0">
            What are you ready to <em className="text-[var(--laurel-deep)]">leave behind?</em>
          </h1>
          <p className="font-serif text-[17px] leading-[27px] text-ink-2 m-0 [text-wrap:pretty]">
            “Some things make the mountain harder to climb. You don’t always need to climb harder. Sometimes you need to put something down.”
          </p>
        </div>
        <div className="flex flex-col items-end gap-3">
          {lastCheck ? <span className="t-caption">Last weigh-in: {dayMonth(lastCheck.date)}</span> : null}
          <Btn kind="laurel" onClick={() => setEditing('new')}>
            <Plus size={15} /> What else are you carrying?
          </Btn>
        </div>
      </header>

      {error ? <div className="mb-6"><Alert>{error}</Alert></div> : null}

      {data.items.length === 0 ? (
        <div className="kh-empty">
          <Backpack size={30} className="text-ink-4" />
          <span className="t-h2 text-ink">Some things are easier to carry once you decide to put them down.</span>
          <span className="max-w-[460px]">Name a behaviour that makes the climb harder. Each evening you mark whether you left it behind — a returned day is noted, never punished, and never resets what you have already done.</span>
          <Btn kind="laurel" onClick={() => setEditing('new')}>
            Add something to let go
          </Btn>
        </div>
      ) : (
        <>
          <section className="kh-sheet p-6 mb-9 flex flex-col gap-5">
            <div className="flex flex-wrap items-center gap-8">
              <span className="w-14 h-14 rounded-xl grid place-items-center bg-[var(--ochre-wash)] text-[var(--ochre-deep)] shrink-0">
                <Backpack size={26} />
              </span>
              <div className="flex flex-col">
                <span className="font-serif text-[26px] leading-8">{plural(carrying.length, 'behaviour')} carried</span>
                <span className="text-[13px] text-ink-3">
                  {ready ? `${ready} ready to leave behind · ` : ''}
                  {behind.length ? `${behind.length} already left at the cairn` : 'Nothing left at the cairn yet'}
                </span>
              </div>
              <div className="flex flex-col">
                <span className="t-stamp !text-[10.5px] text-ink-4">Unburdened days</span>
                <span className="font-serif text-[26px] leading-8 t-num">
                  {free} <span className="text-[14px] text-ink-4">/ {tracked} recorded</span>
                </span>
              </div>
              <div className="flex flex-col">
                <span className="t-stamp !text-[10.5px] text-ink-4">Freedom across the pack</span>
                <span className="font-serif text-[26px] leading-8 text-[var(--ochre-deep)]">{tracked ? `${Math.round((free / tracked) * 100)}%` : '—'}</span>
              </div>
            </div>
            <Bar value={tracked ? free / tracked : 0} />
          </section>

          <div className="grid gap-8 min-[1150px]:grid-cols-[minmax(300px,0.9fr)_minmax(0,1.3fr)]">
            <div className="flex flex-col gap-5 min-w-0">
              <div className="flex items-baseline justify-between">
                <span className="t-stamp text-ink-2">
                  Pack manifest <span className="text-ink-4">/ {plural(carrying.length, 'weight')}</span>
                </span>
              </div>
              {carrying.map((i) => (
                <PackCard key={i.id} item={i} selected={current?.id === i.id} onSelect={() => setSelected(i.id)} />
              ))}
              {carrying.length === 0 ? <span className="t-italic">The pack is empty. Everything you carried has been set down.</span> : null}

              {behind.length ? (
                <div className="flex flex-col gap-3 mt-2">
                  <span className="t-stamp text-ink-2">Left behind at the cairn</span>
                  {behind.map((i) => (
                    <button key={i.id} className={`kh-docket px-4 py-3 text-left flex items-center gap-3 ${current?.id === i.id ? 'ring-1 ring-[var(--laurel)]' : ''}`} onClick={() => setSelected(i.id)}>
                      <span className="flex flex-col flex-1 min-w-0">
                        <span className="text-[14.5px] font-semibold">{i.title}</span>
                        <span className="t-caption">
                          Set down {i.leftBehindAt ? dayMonth(i.leftBehindAt.slice(0, 10)) : ''} · {i.stats.daysFree} free days kept
                        </span>
                      </span>
                      <Stamp tone="laurel" className="!text-[10px]">At the cairn</Stamp>
                    </button>
                  ))}
                </div>
              ) : null}

              <p className="kh-docket p-5 m-0 font-serif italic text-[15px] leading-[24px] text-ink-3">
                “We do not battle our habits in anger; we observe them, remove what fuels them, and place them quietly by the trail.”
              </p>
            </div>

            {current ? (
              <div className="flex flex-col gap-6 min-w-0">
                <section className="kh-card p-6 flex flex-col gap-5">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex flex-col gap-1 min-w-0">
                      <span className="t-stamp !text-[10.5px] text-ink-4">Freedom ledger</span>
                      <h2 className="t-h2 m-0">{current.title}</h2>
                      <span className="t-caption">
                        Tracking since {dayMonth(current.startedOn)} · {plural(current.stats.daysCarried, 'day')} on the trail
                        {current.triggerContexts.length ? ` · usually ${current.triggerContexts.map((c) => CONTEXT_LABEL[c].toLowerCase()).join(', ')}` : ''}
                      </span>
                    </div>
                    <span className="flex">
                      <IconBtn title="Re-weigh or edit" onClick={() => setEditing(current)}>
                        <Pencil size={14} />
                      </IconBtn>
                      <IconBtn title="Remove from the pack" onClick={() => setConfirmRemove(current)}>
                        <Trash2 size={14} />
                      </IconBtn>
                    </span>
                  </div>
                  <GreenXMonth item={current} onPick={setCheckDate} />
                  <div className="kh-docket p-4 flex flex-wrap items-center gap-4">
                    <Moon size={18} className="text-ink-3" />
                    <span className="flex flex-col flex-1 min-w-[200px]">
                      <span className="text-[15px] font-semibold">
                        {current.today ? (current.today.resisted ? 'Today is stamped: left behind' : 'Today is noted: it returned') : 'Evening check-in awaits'}
                      </span>
                      <span className="t-caption">
                        {current.today ? 'You can change today’s answer any time before midnight.' : 'A single question, and an optional reflection if it returned.'}
                      </span>
                    </span>
                    <Btn kind="laurel" size="sm" onClick={() => setCheckDate(now)}>
                      {current.today ? 'Change today' : 'Record today'}
                    </Btn>
                  </div>
                  {current.status === 'left_behind' ? (
                    <div className="kh-alert is-laurel !items-center">
                      <RotateCcw size={16} className="shrink-0" />
                      <span className="flex-1">Left at the cairn. You can keep recording days — and if it comes back, you noticed it, and you can continue.</span>
                      <Btn size="sm" kind="soft" onClick={() => void run(() => window.api.letGo.pickUpAgain(current.id))}>
                        It came back — carry it again
                      </Btn>
                    </div>
                  ) : null}
                </section>

                <div className="grid gap-5 min-[900px]:grid-cols-2">
                  <section className="kh-sheet p-5 flex flex-col gap-4">
                    <span className="t-stamp !text-[10.5px] text-[var(--ochre-deep)] flex items-center gap-1.5">
                      <TriangleAlert size={13} /> Urge surface patterns
                    </span>
                    <span className="t-h3">When does the weight press?</span>
                    {current.feelings.length === 0 ? (
                      <span className="t-italic !text-[14px]">When it returns and you note how you felt, the pattern appears here.</span>
                    ) : (
                      current.feelings.slice(0, 4).map((f) => (
                        <div key={f.feeling} className="flex flex-col gap-1">
                          <div className="flex justify-between text-[13.5px]">
                            <span>{FEELING_LABEL[f.feeling]}</span>
                            <span className="text-ink-3">
                              {f.count} of {current.checkins.filter((c) => !c.resisted).length} returns
                            </span>
                          </div>
                          <Bar value={f.share} tone="ochre" thin />
                        </div>
                      ))
                    )}
                    {current.triggerNotes ? <span className="t-caption italic">You wrote: “{current.triggerNotes}”</span> : null}
                  </section>
                  <section className="kh-sheet p-5 flex flex-col gap-4">
                    <span className="t-stamp !text-[10.5px] text-laurel">Substitutions placed</span>
                    <span className="t-h3">Verified alternatives</span>
                    {current.alternatives.length === 0 ? (
                      <span className="t-italic !text-[14px]">
                        On free days, note what helped instead{current.replacement ? ` — you planned “${current.replacement}”` : ''}.
                      </span>
                    ) : (
                      current.alternatives.slice(0, 4).map((a) => (
                        <div key={a.text} className="kh-card px-3.5 py-2.5 flex items-center justify-between gap-3">
                          <span className="text-[14px] [text-wrap:pretty] min-w-0">{a.text}</span>
                          <Stamp tone="laurel" className="!text-[10px] shrink-0">{a.count}× logged</Stamp>
                        </div>
                      ))
                    )}
                  </section>
                </div>

                {insights.map((g) => (
                  <GuideCard key={g.key} insight={g} />
                ))}

                <section className="kh-sheet p-5">
                  <ToolsPanel tools={data.tools} goals={data.goals} />
                </section>
              </div>
            ) : null}
          </div>
        </>
      )}

      {editing ? <LetGoForm initial={editing === 'new' ? null : editing} goals={data.goals} onClose={() => setEditing(null)} onSaved={(nid) => setSelected(nid)} /> : null}
      {checkDate && current ? <CheckInModal item={current} date={checkDate} onClose={() => setCheckDate(null)} /> : null}
      {confirmRemove ? (
        <Modal onClose={() => setConfirmRemove(null)} label="Remove from the pack" width={480}>
          <div className="p-7 flex flex-col gap-4">
            <h2 className="t-h2 m-0">Remove “{confirmRemove.title}” entirely?</h2>
            <p className="m-0 text-ink-2 [text-wrap:pretty]">
              This deletes it and all {plural(confirmRemove.checkins.length, 'recorded day')}. If you simply feel lighter, the leave-behind ceremony keeps the history instead.
            </p>
            <div className="flex justify-end gap-3">
              <Btn kind="soft" onClick={() => setConfirmRemove(null)}>
                Keep it
              </Btn>
              <Btn
                kind="danger"
                onClick={() =>
                  void run(async () => {
                    await window.api.letGo.remove(confirmRemove.id)
                    setConfirmRemove(null)
                    setSelected(null)
                  })
                }
              >
                Delete it and its history
              </Btn>
            </div>
          </div>
        </Modal>
      ) : null}
    </Page>
  )
}
