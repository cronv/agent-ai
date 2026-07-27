import { useCallback, useEffect, useState } from 'react'

import { api } from './api.js'

/**
 * Загрузка данных раздела.
 *
 *   const leads = useApiQuery<Lead[]>('/leads')
 *   if (leads.loading) return <LoadingBlock />
 *   if (leads.error) return <Alert action={<Button onClick={leads.reload}>Повторить</Button>}>…</Alert>
 *
 * Умеет ровно то, что нужно админке: загрузить, показать ошибку, повторить.
 * При повторной загрузке прежние данные остаются на экране — страница
 * не мигает пустотой, пока летит запрос.
 */

export interface ApiQueryResult<T> {
  data: T | null
  error: unknown
  /** Идёт самая первая загрузка — показывать скелет. */
  loading: boolean
  /** Идёт обновление поверх уже показанных данных. */
  refreshing: boolean
  reload: () => void
}

export function useApiQuery<T>(path: string): ApiQueryResult<T> {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [pending, setPending] = useState(true)
  const [attempt, setAttempt] = useState(0)

  const reload = useCallback(() => {
    setAttempt((value) => value + 1)
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    setPending(true)

    api
      .get<T>(path, { signal: controller.signal })
      .then((result) => {
        setData(result)
        setError(null)
      })
      .catch((cause: unknown) => {
        if (cause instanceof DOMException && cause.name === 'AbortError') return
        setError(cause)
      })
      .finally(() => {
        if (!controller.signal.aborted) setPending(false)
      })

    return () => {
      controller.abort()
    }
  }, [path, attempt])

  return {
    data,
    error,
    loading: pending && data === null,
    refreshing: pending && data !== null,
    reload,
  }
}
