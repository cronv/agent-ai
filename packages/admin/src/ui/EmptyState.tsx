import type { ReactElement, ReactNode } from 'react'

import { cx } from '../lib/cx.js'
import { IconInbox } from './icons.js'

/**
 * Пустое состояние.
 *
 *   <EmptyState
 *     title="Пока нет фидов"
 *     description="Добавьте ссылку на выгрузку застройщика — квартиры появятся сами."
 *     action={<Button size="sm">Добавить фид</Button>}
 *   />
 *
 * Пустой раздел не должен выглядеть как сломанная страница: объясняем,
 * почему пусто, и что сделать, чтобы стало не пусто.
 */

export function EmptyState({
  title,
  description,
  icon,
  action,
  className,
  compact = false,
}: {
  title: string
  description?: ReactNode
  icon?: ReactNode
  action?: ReactNode
  className?: string
  compact?: boolean
}): ReactElement {
  return (
    <div
      className={cx(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-2 px-4 py-10' : 'gap-3 px-6 py-16',
        className,
      )}
    >
      <span className="flex size-11 items-center justify-center rounded-full bg-canvas text-faint">
        {icon ?? <IconInbox className="size-5" />}
      </span>
      <p className="text-sm font-medium text-ink">{title}</p>
      {description ? <p className="max-w-sm text-sm leading-relaxed text-muted">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  )
}
