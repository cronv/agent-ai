import type { ReactElement, ReactNode } from 'react'

import { cx } from '../lib/cx.js'

/**
 * Плитка с числом на дашборде.
 *
 *   <StatCard label="Диалоги за 7 дней" value={12} hint="всего 340" />
 *
 * `value` уже отформатирован снаружи (см. lib/format.ts) — плитка не решает,
 * рубли это, штуки или проценты.
 */

export function StatCard({
  label,
  value,
  hint,
  tone = 'neutral',
  className,
}: {
  label: string
  value: ReactNode
  hint?: ReactNode
  tone?: 'neutral' | 'accent'
  className?: string
}): ReactElement {
  return (
    <div
      className={cx(
        'flex flex-col gap-1 rounded-2xl border border-line bg-surface p-5 shadow-card',
        className,
      )}
    >
      <span className="text-sm text-muted">{label}</span>
      <span
        className={cx(
          'tabular text-3xl leading-tight font-semibold tracking-tight',
          tone === 'accent' ? 'text-accent' : 'text-ink',
        )}
      >
        {value}
      </span>
      {hint ? <span className="text-xs text-faint">{hint}</span> : null}
    </div>
  )
}

/** Скелет плитки на время загрузки — чтобы страница не прыгала, когда придут числа. */
export function StatCardSkeleton(): ReactElement {
  return (
    <div className="flex flex-col gap-2.5 rounded-2xl border border-line bg-surface p-5 shadow-card">
      <span className="h-4 w-28 animate-pulse rounded bg-canvas" />
      <span className="h-8 w-16 animate-pulse rounded bg-canvas" />
      <span className="h-3 w-20 animate-pulse rounded bg-canvas" />
    </div>
  )
}
