import type { ReactElement } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { LoadingBlock } from '../ui/index.js'
import { useAuth } from './AuthProvider.js'

/**
 * Обёртка защищённых страниц.
 *
 *   <Route element={<RequireAuth />}> … </Route>
 *
 * Пока идёт первая проверка сессии — показываем ожидание, а не мигаем
 * формой входа. Без сессии уводим на `/login` и запоминаем, куда человек шёл,
 * чтобы после входа вернуть его туда же.
 */

export function RequireAuth(): ReactElement {
  const { status } = useAuth()
  const location = useLocation()

  if (status === 'checking') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <LoadingBlock label="Проверяю сессию…" />
      </div>
    )
  }

  if (status === 'anonymous') {
    return <Navigate to="/login" state={{ from: location.pathname + location.search }} replace />
  }

  return <Outlet />
}
