import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'

import { useAuth } from '../auth/AuthProvider.js'
import { cx } from '../lib/cx.js'
import { NAV_ITEMS, findNavItem } from '../navigation.js'
import { Button, IconClose, IconLogout, IconMenu } from '../ui/index.js'

/**
 * Каркас админки: боковое меню слева, содержимое раздела справа.
 *
 * На ноутбуке меню закреплено. На планшете и узком экране оно уезжает
 * в выдвижную панель, которую открывает кнопка в верхней полосе.
 * Панель закрывается по Esc, по клику вне и при переходе в другой раздел.
 */

export function AdminLayout(): ReactElement {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const current = findNavItem(location.pathname)

  // Перешли в другой раздел — выдвижное меню больше не нужно.
  useEffect(() => {
    setMenuOpen(false)
  }, [location.pathname])

  // Esc закрывает меню — привычный способ выйти, не целясь мышью.
  useEffect(() => {
    if (!menuOpen) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  return (
    <div className="min-h-dvh bg-canvas">
      {/* Верхняя полоса — только там, где меню спрятано */}
      <div className="sticky top-0 z-30 flex items-center gap-3 border-b border-line bg-surface/90 px-4 py-3 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => setMenuOpen(true)}
          aria-label="Открыть меню"
          aria-expanded={menuOpen}
          className="flex size-11 cursor-pointer items-center justify-center rounded-xl text-muted transition-colors duration-150 hover:bg-canvas hover:text-ink"
        >
          <IconMenu className="size-5" />
        </button>
        <span className="truncate text-sm font-medium text-ink">{current?.label ?? 'Админка'}</span>
      </div>

      {/* Затемнение под выдвижным меню */}
      {menuOpen ? (
        <div
          className="fixed inset-0 z-40 bg-ink/40 lg:hidden"
          onClick={() => setMenuOpen(false)}
          aria-hidden="true"
        />
      ) : null}

      <Sidebar open={menuOpen} onClose={() => setMenuOpen(false)} />

      <main className="lg:pl-64">
        <div className="mx-auto flex max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
          <Outlet />
        </div>
      </main>
    </div>
  )
}

function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }): ReactElement {
  const { session, logout } = useAuth()
  const [leaving, setLeaving] = useState(false)

  const handleLogout = async (): Promise<void> => {
    setLeaving(true)
    try {
      await logout()
    } finally {
      setLeaving(false)
    }
  }

  return (
    <aside
      className={cx(
        'fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-line bg-surface',
        'transition-transform duration-200 ease-out',
        open ? 'translate-x-0' : '-translate-x-full',
        'lg:translate-x-0',
      )}
      aria-label="Разделы админки"
    >
      <div className="flex items-center justify-between gap-2 px-5 py-5">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold tracking-tight text-ink">Новостройки</p>
          <p className="text-xs text-faint">AI-ассистент</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Закрыть меню"
          className="flex size-9 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-canvas hover:text-ink lg:hidden"
        >
          <IconClose className="size-5" />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4">
        <ul className="flex flex-col gap-0.5">
          {NAV_ITEMS.map((item) => (
            <li key={item.path}>
              <NavLink
                to={item.path}
                end={item.path === '/'}
                className={({ isActive }) =>
                  cx(
                    'flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm transition-colors duration-150',
                    isActive
                      ? 'bg-accent-soft font-medium text-accent-strong'
                      : 'text-muted hover:bg-canvas hover:text-ink',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon className={cx('size-5 shrink-0', isActive ? 'text-accent' : 'text-faint')} />
                    {item.label}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      <div className="border-t border-line px-3 py-3">
        <p className="px-3 pb-2 text-xs text-faint">
          Вы вошли как <span className="font-medium text-muted">{session?.username ?? '—'}</span>
        </p>
        <Button
          variant="ghost"
          size="sm"
          fullWidth
          loading={leaving}
          onClick={() => void handleLogout()}
          icon={<IconLogout className="size-4" />}
          className="justify-start"
        >
          Выйти
        </Button>
      </div>
    </aside>
  )
}
