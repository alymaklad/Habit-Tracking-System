import type { ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import {
  Award,
  Backpack,
  BookOpen,
  ChartSpline,
  ListChecks,
  NotebookPen,
  CalendarDays,
  CircleCheckBig,
  CloudOff,
  Compass,
  Mountain,
  RefreshCw,
  SlidersHorizontal,
  Sun,
  TriangleAlert,
  UserRound
} from 'lucide-react'
import type { LevelInfo, SyncStatus } from '@shared/types'
import emblem from '../assets/emblem.png'
import wordmark from '../assets/wordmark-ar.png'
import { useTick } from '../hooks/useData'
import { relative } from '../lib/format'
import { initial } from '../lib/khatwa'
import type { RouteName } from './nav'

type Item = { key: RouteName; title: string; sub?: string; icon: LucideIcon }

const CORE: Item[] = [
  { key: 'today', title: 'Today', sub: 'What am I doing now?', icon: Sun },
  { key: 'journey', title: 'Journey', sub: 'Where have I been?', icon: Compass },
  { key: 'mountains', title: 'Mountains', sub: 'Where am I going?', icon: Mountain },
  { key: 'me', title: 'Me', sub: 'Who am I becoming?', icon: UserRound }
]

const FOLIO: Item[] = [
  { key: 'habits', title: 'Habits', icon: CircleCheckBig },
  { key: 'todo', title: 'To-do', icon: ListChecks },
  { key: 'calendar', title: 'Calendar', icon: CalendarDays },
  { key: 'progress', title: 'Progress', icon: ChartSpline },
  { key: 'review', title: 'Weekly Review', icon: BookOpen },
  { key: 'achievements', title: 'Achievements', icon: Award }
]

const INNER: Item[] = [
  { key: 'letgo', title: 'Let Go', sub: 'What am I carrying?', icon: Backpack },
  { key: 'journal', title: 'Journal', sub: 'What am I learning?', icon: NotebookPen },
  { key: 'settings', title: 'Settings', icon: SlidersHorizontal }
]

function NavButton({ item, index, active, onClick }: { item: Item; index?: number; active: boolean; onClick: () => void }) {
  const Icon = item.icon
  return (
    <button className={`kh-nav-item ${item.sub ? 'is-core' : ''} ${active ? 'is-active' : ''}`} onClick={onClick} aria-current={active ? 'page' : undefined} data-tour={`nav-${item.key}`}>
      <Icon size={18} strokeWidth={1.7} className="shrink-0" />
      <span className="kh-nav-text">
        <span className="kh-nav-title">{item.title}</span>
        {item.sub ? <span className="kh-nav-sub">{item.sub}</span> : null}
      </span>
      {index !== undefined ? <span className="kh-nav-num">0{index + 1}</span> : null}
    </button>
  )
}

function SyncLine({ status, onOpen }: { status: SyncStatus | null; onOpen: () => void }) {
  useTick(30_000)
  let icon: ReactNode = <CloudOff size={14} />
  let text = 'Not synced: saved on this computer'
  let tone = 'text-ink-3'
  if (status) {
    if (status.state === 'needs_reauth') {
      icon = <TriangleAlert size={14} />
      text = 'Google connection expired — reconnect'
      tone = 'text-[var(--error)]'
    } else if (status.state === 'syncing') {
      icon = <RefreshCw size={14} className="kh-spin" />
      text = 'Syncing with Google Tasks…'
      tone = 'text-laurel'
    } else if (status.state === 'connected') {
      icon = <span className="kh-dot is-laurel" />
      text = `Synced ${relative(status.lastSyncAt)}`
      tone = 'text-ink-2'
    } else if (status.state === 'offline') {
      icon = <CloudOff size={14} />
      text = status.queuedCount > 0 ? `Offline · ${status.queuedCount} queued` : 'Offline · changes wait here'
      tone = 'text-[var(--ochre-deep)]'
    }
  }
  return (
    <button onClick={onOpen} className={`flex items-center gap-2.5 px-2.5 py-2 rounded-lg text-left text-[12.5px] hover:bg-[var(--docket)] ${tone}`}>
      <span className="w-4 grid place-items-center shrink-0">{icon}</span>
      <span className="truncate">{text}</span>
    </button>
  )
}

export default function Rail({
  active,
  onNavigate,
  level,
  displayName,
  status,
  onOpenSync
}: {
  active: RouteName
  onNavigate: (key: RouteName) => void
  level: LevelInfo | null
  displayName: string
  status: SyncStatus | null
  onOpenSync: () => void
}) {
  return (
    <aside className="kh-rail" data-tour="sidebar">
      <div className="kh-brand">
        <img className="kh-brand-emblem" src={emblem} alt="" />
        <div className="min-w-0">
          <div className="kh-brand-word">
            <img className="kh-brand-ar" src={wordmark} alt="خطوة" />
            <span className="kh-brand-latin">KHATWA</span>
          </div>
          <div className="kh-brand-tag">One step at a time.</div>
        </div>
      </div>

      <div className="kh-nav-group" data-tour="group-main">
        <div className="kh-nav-heading">Main</div>
        <nav className="kh-nav" aria-label="Main">
          {CORE.map((item, i) => (
            <NavButton key={item.key} item={item} index={i} active={active === item.key} onClick={() => onNavigate(item.key)} />
          ))}
        </nav>
      </div>

      <div className="kh-nav-group" data-tour="group-habits">
        <div className="kh-nav-heading">Habits &amp; progress</div>
        <nav className="kh-nav" aria-label="Habits and progress">
          {FOLIO.map((item) => (
            <NavButton key={item.key} item={item} active={active === item.key} onClick={() => onNavigate(item.key)} />
          ))}
        </nav>
      </div>

      <div className="kh-nav-group" data-tour="group-reflection">
        <div className="kh-nav-heading">Reflection</div>
        <nav className="kh-nav" aria-label="Reflection">
          {INNER.map((item) => (
            <NavButton key={item.key} item={item} active={active === item.key} onClick={() => onNavigate(item.key)} />
          ))}
        </nav>
      </div>

      <div className="kh-rail-foot">
        <nav aria-label="Sync status">
          <SyncLine status={status} onOpen={onOpenSync} />
        </nav>
        <button className="kh-profile" onClick={() => onNavigate('me')}>
          <span className="kh-monogram">{initial(displayName)}</span>
          <span className="flex flex-col min-w-0 flex-1">
            <span className="text-[14px] font-semibold leading-5 truncate">{displayName.trim() || 'You'}</span>
            <span className="font-serif italic text-[12.5px] leading-4 text-ink-3 truncate">
              {level ? `Level ${level.level} · ${level.title}` : 'Setting out'}
            </span>
          </span>
        </button>
      </div>
    </aside>
  )
}
