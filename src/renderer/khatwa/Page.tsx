import type { ReactNode } from 'react'
import { Eyebrow } from './ui'

export function Page({ children, narrow }: { children: ReactNode; narrow?: boolean }) {
  return <div className={`kh-page kh-rise ${narrow ? 'is-narrow' : ''}`}>{children}</div>
}

export function PageHead({
  eyebrow,
  title,
  lede,
  aside,
  hero
}: {
  eyebrow?: ReactNode
  title: ReactNode
  lede?: ReactNode
  aside?: ReactNode
  hero?: boolean
}) {
  return (
    <header className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5 mb-9">
      <div className="flex flex-col gap-3 min-w-0 max-w-[720px]">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <h1 className={`${hero ? 't-hero' : 't-hero !text-[42px] !leading-[50px]'} m-0 text-ink [text-wrap:balance]`}>{title}</h1>
        {lede ? <p className="t-italic !text-[17px] !leading-[27px] m-0 [text-wrap:pretty]">{lede}</p> : null}
      </div>
      {aside ? <div className="shrink-0">{aside}</div> : null}
    </header>
  )
}

export function SectionHead({
  title,
  meta,
  action,
  eyebrow
}: {
  title: ReactNode
  meta?: ReactNode
  action?: ReactNode
  eyebrow?: ReactNode
}) {
  return (
    <div className="kh-section-head">
      <div className="flex flex-col gap-1 min-w-0">
        {eyebrow ? <span className="t-stamp text-ink-4">{eyebrow}</span> : null}
        <div className="flex items-baseline gap-3 flex-wrap">
          <h2 className="t-h2 m-0">{title}</h2>
          {meta ? <span className="t-stamp text-ink-4">{meta}</span> : null}
        </div>
      </div>
      {action}
    </div>
  )
}
