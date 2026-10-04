import { useState } from 'react'
import { ArrowRight, ChevronLeft, ChevronRight, Clock, Flame, Plus, Trash2, X } from 'lucide-react'
import type { TodoItem, TodoView } from '@shared/types'
import { useData } from '../hooks/useData'
import { addDays } from '../lib/format'
import { longDate, plural, time12, today } from '../lib/khatwa'
import { useShell } from '../khatwa/nav'
import { Page, PageHead } from '../khatwa/Page'
import { Alert, Btn, CheckBox, Dot, IconBtn, LoadError, Loading, Stamp } from '../khatwa/ui'

function ItemRow({ item, run, anchor }: { item: TodoItem; run: (fn: () => Promise<unknown>) => void; anchor: string }) {
  const [editing, setEditing] = useState(false)
  const [title, setTitle] = useState(item.title)
  return (
    <div className={`kh-row !py-3 group ${item.done ? 'is-done' : ''}`}>
      <CheckBox small={item.kind === 'subtask'} state={item.done ? 'done' : 'open'} label={item.done ? `Reopen ${item.title}` : `Mark ${item.title} done`} onClick={() => run(() => window.api.todo.setDone(item.id, !item.done))} />
      <div className="flex flex-col flex-1 min-w-0 gap-1">
        {editing ? (
          <form
            onSubmit={(e) => {
              e.preventDefault()
              setEditing(false)
              if (title.trim() && title.trim() !== item.title) run(() => window.api.todo.rename(item.id, title.trim()))
            }}
          >
            <input className="kh-input !py-1 !text-[15px]" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} onBlur={() => setEditing(false)} />
          </form>
        ) : (
          <button className={`text-left text-[15px] ${item.done ? 'line-through text-ink-4' : ''}`} onDoubleClick={() => setEditing(true)} title="Double-click to rename">
            {item.title}
          </button>
        )}
        <span className="flex flex-wrap gap-1.5">
          <Stamp tone={item.kind === 'manual' ? 'slate' : 'laurel'} className="!text-[10px] !py-0">
            {item.kind === 'manual' ? 'Manual' : `Step · ${item.habitName}`}
          </Stamp>
          {item.carried > 0 && !item.done ? <Stamp tone="ochre" className="!text-[10px] !py-0">Carried {plural(item.carried, 'day')}</Stamp> : null}
          {item.overdue && !item.done ? <Stamp tone="ochre-solid" className="!text-[10px] !py-0">Overdue</Stamp> : null}
          {item.done ? <Stamp className="!text-[10px] !py-0">Done</Stamp> : null}
        </span>
      </div>
      {item.kind === 'manual' && !item.done ? (
        <span className="opacity-0 group-hover:opacity-100 flex">
          <IconBtn title="Move to tomorrow" onClick={() => run(() => window.api.todo.reschedule(item.id, addDays(anchor, 1)))}>
            <ArrowRight size={14} />
          </IconBtn>
          <IconBtn title="Set aside" onClick={() => run(() => window.api.todo.drop(item.id))}>
            <X size={14} />
          </IconBtn>
        </span>
      ) : null}
      {item.kind === 'subtask' ? (
        <span className="opacity-0 group-hover:opacity-100">
          <IconBtn title="Remove step" onClick={() => run(() => window.api.todo.remove(item.id))}>
            <Trash2 size={14} />
          </IconBtn>
        </span>
      ) : null}
    </div>
  )
}

export default function Todo() {
  const { navigate } = useShell()
  const [anchor, setAnchor] = useState(today())
  const [draft, setDraft] = useState('')
  const [error, setError] = useState<string | null>(null)
  const { data, error: loadError, refetch } = useData<TodoView>(() => window.api.view.todos(anchor), [anchor])

  const run = (fn: () => Promise<unknown>): void => {
    setError(null)
    fn().catch((err: unknown) => setError(err instanceof Error ? err.message : String(err)))
  }

  if (loadError) return <Page><LoadError message={loadError} onRetry={refetch} /></Page>
  if (!data) return <Page><Loading label="Unfolding the list…" /></Page>

  const manual = data.items.filter((i) => i.kind === 'manual' && !i.dropped)
  const dropped = data.items.filter((i) => i.kind === 'manual' && i.dropped)
  const groups = data.groups.filter((g) => g.habitId !== null)

  return (
    <Page narrow>
      <PageHead
        eyebrow={
          <>
            To-do <Dot /> <span className="is-quiet">Manual items carry forward · habit steps complete their habit</span>
          </>
        }
        title={anchor === today() ? 'Today’s list' : longDate(anchor)}
        aside={
          <div className="flex items-center gap-2">
            <IconBtn title="Previous day" onClick={() => setAnchor(addDays(anchor, -1))}>
              <ChevronLeft size={16} />
            </IconBtn>
            <Btn kind="soft" size="sm" onClick={() => setAnchor(today())}>
              Today
            </Btn>
            <IconBtn title="Next day" onClick={() => setAnchor(addDays(anchor, 1))}>
              <ChevronRight size={16} />
            </IconBtn>
          </div>
        }
      />

      {error ? <div className="mb-5"><Alert>{error}</Alert></div> : null}

      {data.avoidance.map((a) => (
        <div key={a.todoId} className="kh-alert is-ochre mb-4">
          <Flame size={16} className="shrink-0 mt-0.5" />
          <span>{a.message}</span>
        </div>
      ))}

      <section className="mb-10">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="t-h2 m-0">Manual items</h2>
          <span className="t-caption">
            {data.manualDone} of {data.manualTotal} done · ticking one earns no XP — it is simply done
          </span>
        </div>
        <form
          className="kh-card px-4 py-3 flex items-center gap-3 mb-3"
          onSubmit={(e) => {
            e.preventDefault()
            const t = draft.trim()
            if (!t) return
            setDraft('')
            run(() => window.api.todo.addManual(t, anchor))
          }}
        >
          <Plus size={16} className="text-ink-4" />
          <input className="kh-input !border-0 !text-[15px]" value={draft} placeholder="Add something to do on this day…" onChange={(e) => setDraft(e.target.value)} />
          <Btn kind="laurel" size="sm" type="submit" disabled={!draft.trim()}>
            Add
          </Btn>
        </form>
        <div className="flex flex-col gap-2">
          {manual.length === 0 ? <span className="t-italic !text-[14px] px-1">Nothing pinned to this day.</span> : null}
          {manual.map((i) => (
            <ItemRow key={i.id} item={i} run={run} anchor={anchor} />
          ))}
        </div>
        {manual.length === 0 && data.suggestions.length ? (
          <div className="mt-4 flex flex-col gap-1.5">
            <span className="t-stamp text-ink-4">Perhaps</span>
            {data.suggestions.slice(0, 4).map((s) => (
              <button key={s.title} className="text-left group" title={s.reason} onClick={() => run(() => window.api.todo.addManual(s.title, anchor))}>
                <span className="font-serif italic text-[15px] text-ink-3 group-hover:text-ink">+ {s.title}</span>
                <span className="t-caption ml-2">{s.reason}</span>
              </button>
            ))}
          </div>
        ) : null}
      </section>

      <section className="mb-10">
        <div className="flex items-baseline justify-between mb-3">
          <h2 className="t-h2 m-0">Habit steps</h2>
          <span className="t-caption">Ticking the last step completes the habit; un-ticking one reopens it</span>
        </div>
        {groups.length === 0 ? (
          <span className="t-italic !text-[14px] px-1">No habit on this day has steps. Add default steps in a habit’s editor.</span>
        ) : (
          <div className="flex flex-col gap-5">
            {groups.map((g) => (
              <div key={g.occurrenceId} className="kh-sheet p-4 flex flex-col gap-2">
                <button className="flex items-center justify-between gap-3 text-left" onClick={() => g.habitId !== null && navigate({ name: 'habit', id: g.habitId })}>
                  <span className="flex items-center gap-2">
                    <span className="text-[16px] font-semibold">{g.habitName}</span>
                    {g.scheduledTime ? (
                      <span className="t-caption flex items-center gap-1">
                        <Clock size={12} /> {time12(g.scheduledTime)}
                      </span>
                    ) : null}
                  </span>
                  <Stamp tone={g.habitComplete ? 'laurel' : 'plain'} className="!text-[10px]">
                    {g.habitComplete ? 'Habit complete' : `${g.done}/${g.total} steps`}
                  </Stamp>
                </button>
                {g.items
                  .filter((i) => !i.dropped)
                  .map((i) => (
                    <ItemRow key={i.id} item={i} run={run} anchor={anchor} />
                  ))}
              </div>
            ))}
          </div>
        )}
      </section>

      {dropped.length ? (
        <section>
          <h2 className="t-h3 mb-2">Set aside</h2>
          <div className="flex flex-col gap-1">
            {dropped.map((i) => (
              <div key={i.id} className="flex items-center gap-3 px-2 py-1.5 text-ink-4">
                <span className="flex-1 line-through">{i.title}</span>
                <IconBtn title="Delete permanently" onClick={() => run(() => window.api.todo.remove(i.id))}>
                  <Trash2 size={13} />
                </IconBtn>
              </div>
            ))}
          </div>
        </section>
      ) : null}
    </Page>
  )
}
