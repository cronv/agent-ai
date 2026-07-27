import type { ReactElement, ReactNode } from 'react'

import { cx } from '../lib/cx.js'

/**
 * Белая карточка — основной контейнер разделов.
 *
 *   <Card>
 *     <CardHeader title="Фиды" action={<Button size="sm">Добавить</Button>} />
 *     …
 *   </Card>
 *
 * `padded={false}` — когда внутри таблица во всю ширину.
 */

export function Card({
  children,
  className,
  padded = true,
}: {
  children: ReactNode
  className?: string
  padded?: boolean
}): ReactElement {
  return (
    <section
      className={cx(
        'rounded-2xl border border-line bg-surface shadow-card',
        padded && 'p-5 sm:p-6',
        className,
      )}
    >
      {children}
    </section>
  )
}

export function CardHeader({
  title,
  description,
  action,
  className,
}: {
  title: ReactNode
  description?: ReactNode
  action?: ReactNode
  className?: string
}): ReactElement {
  return (
    <div
      className={cx(
        'flex flex-wrap items-start justify-between gap-3',
        className,
      )}
    >
      <div className="min-w-0">
        <h2 className="text-base font-semibold tracking-tight text-ink">{title}</h2>
        {description ? <p className="mt-1 text-sm text-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
