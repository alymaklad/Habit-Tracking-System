import type { ReactNode } from 'react'
import { Page, PageHead } from '../khatwa/Page'

/** Page chrome for the screens built on the older primitives: an editorial head and a body. */
export default function Screen({
  title,
  subtitle,
  actions,
  children
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
}) {
  return (
    <Page>
      <PageHead eyebrow={subtitle} title={title} aside={actions} />
      {children}
    </Page>
  )
}
