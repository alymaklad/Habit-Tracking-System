import { useState, type FormEvent, type ReactNode } from 'react'
import { ArrowRight, Compass } from 'lucide-react'
import type { AccountUser } from '@shared/types'
import emblem from '../assets/emblem-large.png'
import wordmark from '../assets/wordmark-ar.png'
import { Alert, Btn, Field, Modal } from './ui'

type Mode = 'sign-in' | 'sign-up'

const clean = (err: unknown): string =>
  err instanceof Error ? err.message.replace(/^Error invoking remote method '[^']+': (\w*Error: )?/, '') : String(err)

/** Google's "G", drawn inline so it needs no network and matches Google's own button. */
function GoogleMark() {
  return (
    <svg width="17" height="17" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#EA4335" d="M24 9.5c3.5 0 6.6 1.2 9 3.5l6.7-6.7C35.6 2.4 30.2 0 24 0 14.6 0 6.6 5.4 2.7 13.3l7.8 6C12.4 13.7 17.7 9.5 24 9.5z" />
      <path fill="#4285F4" d="M46.1 24.6c0-1.6-.1-3.1-.4-4.6H24v9h12.4c-.5 2.9-2.2 5.3-4.6 6.9l7.4 5.7c4.3-4 6.9-9.9 6.9-17z" />
      <path fill="#FBBC05" d="M10.5 28.7A14.6 14.6 0 0 1 9.5 24c0-1.6.3-3.2.8-4.7l-7.8-6A24 24 0 0 0 0 24c0 3.9.9 7.5 2.6 10.7l7.9-6z" />
      <path fill="#34A853" d="M24 48c6.5 0 11.9-2.1 15.9-5.8l-7.4-5.7c-2.1 1.4-4.8 2.3-8.5 2.3-6.3 0-11.6-4.2-13.5-9.9l-7.9 6C6.6 42.6 14.6 48 24 48z" />
    </svg>
  )
}

/** Sign in or create an account: email and password, or Google. */
export function AccountForm({ onDone, initialMode = 'sign-in' }: { onDone: (user: AccountUser) => void; initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode)
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'email' | 'google' | null>(null)
  const [error, setError] = useState<string | null>(null)

  const run = async (kind: 'email' | 'google', fn: () => Promise<AccountUser>): Promise<void> => {
    setBusy(kind)
    setError(null)
    try {
      onDone(await fn())
    } catch (err) {
      setError(clean(err))
    } finally {
      setBusy(null)
    }
  }

  const submit = (e: FormEvent): void => {
    e.preventDefault()
    void run('email', () =>
      mode === 'sign-up' ? window.api.account.signUp(name, email, password) : window.api.account.signIn(email, password)
    )
  }

  const switchTo = (next: Mode): void => {
    setMode(next)
    setError(null)
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="kh-segmented self-start" role="tablist" aria-label="Account">
        <button role="tab" aria-selected={mode === 'sign-in'} className={mode === 'sign-in' ? 'is-on' : ''} onClick={() => switchTo('sign-in')}>
          Sign in
        </button>
        <button role="tab" aria-selected={mode === 'sign-up'} className={mode === 'sign-up' ? 'is-on' : ''} onClick={() => switchTo('sign-up')}>
          Create account
        </button>
      </div>

      <Btn kind="ghost" className="kh-google-btn" disabled={busy !== null} onClick={() => void run('google', () => window.api.account.signInWithGoogle())}>
        <GoogleMark />
        {busy === 'google' ? 'Finish in your browser…' : mode === 'sign-up' ? 'Sign up with Google' : 'Sign in with Google'}
      </Btn>

      <div className="kh-or" aria-hidden="true">
        <span>or with email</span>
      </div>

      <form className="flex flex-col gap-4" onSubmit={submit}>
        {mode === 'sign-up' ? (
          <Field label="Your name">
            <input className="kh-input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" required />
          </Field>
        ) : null}
        <Field label="Email">
          <input className="kh-input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />
        </Field>
        <Field label="Password" hint={mode === 'sign-up' ? 'At least 8 characters.' : undefined}>
          <input
            className="kh-input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete={mode === 'sign-up' ? 'new-password' : 'current-password'}
            minLength={mode === 'sign-up' ? 8 : undefined}
            required
          />
        </Field>
        {error ? <Alert>{error}</Alert> : null}
        <Btn type="submit" kind="laurel" size="lg" disabled={busy !== null}>
          {busy === 'email' ? (mode === 'sign-up' ? 'Creating your account…' : 'Signing in…') : mode === 'sign-up' ? 'Create account' : 'Sign in'}
        </Btn>
      </form>
    </div>
  )
}

/** The first screen when no one is signed in. */
export function Welcome({ onSignedIn, onTryPlanner }: { onSignedIn: (user: AccountUser) => void; onTryPlanner: () => void }) {
  return (
    <div className="kh-welcome">
      <section className="kh-welcome-story">
        <img src={emblem} alt="" className="kh-welcome-emblem" />
        <img src={wordmark} alt="Khatwa" className="kh-welcome-wordmark" />
        <p className="kh-welcome-line">One step at a time.</p>
        <p className="kh-welcome-body">
          Name a big goal. Khatwa plans the milestones and weekly habits to get there, and helps you keep going.
        </p>
        <button className="kh-welcome-try" onClick={onTryPlanner}>
          <Compass size={18} />
          <span className="flex flex-col items-start text-left">
            <b>Try the planner first</b>
            <span>Draft a plan without an account. You’ll create one to save it.</span>
          </span>
          <ArrowRight size={16} className="ml-auto" />
        </button>
      </section>
      <section className="kh-welcome-form kh-card">
        <AccountForm onDone={onSignedIn} />
      </section>
    </div>
  )
}

/** Asked mid-way, as a guest: create an account (or sign in) to keep what you made. */
export function AccountDialog({
  reason,
  children,
  startWith = 'sign-up',
  onDone,
  onClose
}: {
  reason: string
  children?: ReactNode
  startWith?: Mode
  onDone: (user: AccountUser) => void
  onClose: () => void
}) {
  return (
    <Modal label={reason} onClose={onClose} width={480}>
      <div className="p-7 flex flex-col gap-5">
        <div className="flex flex-col gap-1.5">
          <h2 className="t-h2 m-0">{reason}</h2>
          {children ? <p className="text-ink-3 m-0 [text-wrap:pretty]">{children}</p> : null}
        </div>
        <AccountForm onDone={onDone} initialMode={startWith} />
      </div>
    </Modal>
  )
}
