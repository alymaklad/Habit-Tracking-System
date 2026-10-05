import { useState } from 'react'
import type { AchievementView, PersonalRecordView } from '@shared/types'
import { useData } from '../hooks/useData'
import { dayMonth } from '../lib/khatwa'
import { Page, PageHead } from '../khatwa/Page'
import { Bar, LoadError, Loading, Stamp } from '../khatwa/ui'
import { SealGlyph } from './Me'

type Filter = 'all' | 'pressed' | 'pending'

export default function Achievements() {
  const [filter, setFilter] = useState<Filter>('all')
  const { data, error, refetch } = useData<{ achievements: AchievementView[]; records: PersonalRecordView[] }>(async () => {
    const [achievements, records] = await Promise.all([window.api.view.achievements(), window.api.view.personalRecords()])
    return { achievements, records }
  }, [])

  if (error) return <Page><LoadError message={error} onRetry={refetch} /></Page>
  if (!data) return <Page><Loading label="Loading achievements…" /></Page>

  const pressed = data.achievements.filter((a) => a.unlockedAt)
  const shown = data.achievements
    .filter((a) => (filter === 'pressed' ? a.unlockedAt : filter === 'pending' ? !a.unlockedAt : true))
    .sort((a, b) => Number(!!b.unlockedAt) - Number(!!a.unlockedAt) || b.progress - a.progress)

  return (
    <Page>
      <PageHead
        title="Achievements"
        aside={
          <div className="kh-sheet px-6 py-4 flex gap-8">
            <span className="flex flex-col">
              <span className="t-stamp !text-[10.5px] text-ink-4">Earned</span>
              <span className="font-serif text-[30px] leading-9 text-[var(--ochre-deep)]">{pressed.length}</span>
            </span>
            <span className="flex flex-col">
              <span className="t-stamp !text-[10.5px] text-ink-4">Awaiting</span>
              <span className="font-serif text-[30px] leading-9">{data.achievements.length - pressed.length}</span>
            </span>
          </div>
        }
      />

      <div className="kh-segmented mb-6">
        {(
          [
            ['all', 'All'],
            ['pressed', 'Earned'],
            ['pending', 'Still ahead']
          ] as const
        ).map(([k, label]) => (
          <button key={k} className={filter === k ? 'is-on' : ''} onClick={() => setFilter(k)}>
            {label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? <div className="kh-empty mb-14">Keep taking steps. Your first one is already on its way.</div> : null}
      <div className="grid gap-5 grid-cols-[repeat(auto-fill,minmax(230px,1fr))] mb-14">
        {shown.map((a, i) => (
          <article key={a.key} className={`kh-card p-6 flex flex-col items-center text-center gap-3 ${a.unlockedAt ? '' : 'opacity-90'}`}>
            <span className={`kh-seal ${a.unlockedAt ? 'is-earned' : ''}`} style={{ transform: `rotate(${(i % 3) - 1}deg)`, width: 72, height: 72 }}>
              <SealGlyph a={a} size={24} />
            </span>
            <h3 className="font-serif text-[20px] leading-[26px] font-normal m-0 [text-wrap:balance]">{a.name}</h3>
            <p className="t-caption !text-[12.5px] m-0 [text-wrap:pretty]">{a.description}</p>
            <div className="mt-auto w-full pt-2">
              {a.unlockedAt ? (
                <Stamp tone="ochre">Earned · {dayMonth(a.unlockedAt.slice(0, 10))}</Stamp>
              ) : (
                <div className="flex flex-col gap-1.5">
                  <Bar value={a.progress} thin />
                  <span className="t-caption">{a.progressLabel}</span>
                </div>
              )}
            </div>
          </article>
        ))}
      </div>

      <section>
        <div className="flex flex-col gap-1 mb-4">
          <span className="t-stamp text-[var(--ochre-deep)]">Records</span>
          <h2 className="t-h1 !text-[30px] m-0">Personal records</h2>
        </div>
        {data.records.length === 0 ? (
          <div className="kh-empty">Your records appear as the weeks fill in.</div>
        ) : (
          <div className="kh-sheet divide-y divide-[var(--rule)]">
            {data.records.map((r) => (
              <div key={r.kind} className="flex items-center gap-4 px-6 py-4">
                <span className="flex-1 text-[14.5px] text-ink-2">{r.label}</span>
                <span className="font-serif text-[22px]">{r.value}</span>
                <span className="t-caption w-24 text-right">{r.achievedOn ? dayMonth(r.achievedOn) : 'All time'}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </Page>
  )
}
