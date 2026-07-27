import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'

import { api, setUnauthorizedHandler } from '../lib/api.js'

/**
 * Кто вошёл в админку.
 *
 *   const { session, logout } = useAuth()
 *
 * Сессия живёт в httpOnly-куке, JavaScript её не видит — поэтому «вошёл ли
 * пользователь» узнаём у сервера запросом `GET /api/admin/me` при загрузке.
 *
 * Любой ответ 401 из любого запроса админки (см. lib/api.ts) переводит
 * состояние в `anonymous`, и защищённые страницы сами уводят на вход.
 */

export interface AdminSession {
  username: string
  /** Когда истекает сессия, секунды unix. */
  expiresAt: number
}

export type AuthStatus = 'checking' | 'authenticated' | 'anonymous'

interface AuthContextValue {
  status: AuthStatus
  session: AdminSession | null
  login: (username: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }): ReactElement {
  const [status, setStatus] = useState<AuthStatus>('checking')
  const [session, setSession] = useState<AdminSession | null>(null)

  // Первая проверка при загрузке страницы.
  useEffect(() => {
    let cancelled = false

    api
      .get<AdminSession>('/me', { silentUnauthorized: true })
      .then((me) => {
        if (cancelled) return
        setSession(me)
        setStatus('authenticated')
      })
      .catch(() => {
        if (cancelled) return
        setSession(null)
        setStatus('anonymous')
      })

    return () => {
      cancelled = true
    }
  }, [])

  // Сессия могла кончиться посреди работы — тогда 401 придёт из любого запроса.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setSession(null)
      setStatus('anonymous')
    })
    return () => {
      setUnauthorizedHandler(null)
    }
  }, [])

  const login = useCallback(async (username: string, password: string): Promise<void> => {
    const result = await api.post<{ username: string; expiresIn: number }>(
      '/login',
      { username, password },
      { silentUnauthorized: true },
    )
    setSession({
      username: result.username,
      expiresAt: Math.floor(Date.now() / 1000) + result.expiresIn,
    })
    setStatus('authenticated')
  }, [])

  const logout = useCallback(async (): Promise<void> => {
    try {
      await api.post('/logout', undefined, { silentUnauthorized: true })
    } finally {
      setSession(null)
      setStatus('anonymous')
    }
  }, [])

  const value = useMemo<AuthContextValue>(
    () => ({ status, session, login, logout }),
    [status, session, login, logout],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth вызван вне <AuthProvider>')
  return value
}
