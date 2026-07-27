import type { ReactElement } from 'react'

import { cx } from '../lib/cx.js'

/** Крутилка. Наследует цвет текста, поэтому одинаково живёт на кнопке и на карточке. */
export function Spinner({ className }: { className?: string }): ReactElement {
  return (
    <svg
      className={cx('animate-spin', className ?? 'size-4')}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
      <path
        d="M21 12a9 9 0 0 0-9-9"
        stroke="currentColor"
        strokeWidth="2.5"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Ожидание загрузки страницы целиком: центрированная крутилка с подписью. */
export function LoadingBlock({ label = 'Загружаю…' }: { label?: string }): ReactElement {
  return (
    <div className="flex items-center justify-center gap-3 py-16 text-muted" role="status">
      <Spinner className="size-5" />
      <span className="text-sm">{label}</span>
    </div>
  )
}
