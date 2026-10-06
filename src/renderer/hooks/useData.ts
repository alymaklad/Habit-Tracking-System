import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Fetch-on-mount with a refetch that the server can trigger.
 *
 * Every mutation ends with the server streaming a `dataChanged` event, so
 * the UI re-reads rather than trying to mirror state locally. That keeps the database
 * the single source of truth, which is the same principle the engine follows.
 */
export function useData<T>(
  load: () => Promise<T>,
  deps: unknown[] = []
): { data: T | null; error: string | null; loading: boolean; refetch: () => void } {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const alive = useRef(true)
  const loadRef = useRef(load)
  loadRef.current = load

  const run = useCallback(() => {
    loadRef
      .current()
      .then((value) => {
        if (!alive.current) return
        setData(value)
        setError(null)
      })
      .catch((err: unknown) => {
        if (!alive.current) return
        setError(err instanceof Error ? err.message : String(err))
      })
      .finally(() => {
        if (alive.current) setLoading(false)
      })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    alive.current = true
    run()
    return () => {
      alive.current = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)

  useEffect(() => window.api.on.dataChanged(run), [run])

  return { data, error, loading, refetch: run }
}

/** Re-renders on an interval — used for live timers and sync countdowns. */
export function useTick(ms = 1000): number {
  const [n, setN] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setN((x) => x + 1), ms)
    return () => clearInterval(t)
  }, [ms])
  return n
}
