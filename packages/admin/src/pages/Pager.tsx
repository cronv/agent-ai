import type { ReactElement } from 'react'

import { formatNumber, plural } from '../lib/format.js'
import { Button, IconChevronLeft, IconChevronRight } from '../ui/index.js'

/**
 * Постраничная навигация для списков админки.
 *
 *   <Pager total={total} limit={limit} offset={offset} onChange={setOffset} unit={['лид','лида','лидов']} />
 *
 * Страницами, а не «показать ещё»: списки лидов и переписок растут до тысяч
 * строк, и грузить их в браузер целиком нельзя — сервер отдаёт ровно одну
 * страницу, здесь только переключение окна.
 */

export function Pager({
  total,
  limit,
  offset,
  loading = false,
  onChange,
  unit,
}: {
  total: number
  limit: number
  offset: number
  loading?: boolean
  onChange: (offset: number) => void
  /** Склонения для подписи: `['лид', 'лида', 'лидов']`. */
  unit: [string, string, string]
}): ReactElement | null {
  if (total <= limit) return null

  const from = offset + 1
  const to = Math.min(offset + limit, total)
  const canBack = offset > 0
  const canForward = to < total

  return (
    <nav
      className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-5 py-3"
      aria-label="Страницы списка"
    >
      <p className="tabular text-xs text-muted">
        {formatNumber(from)}–{formatNumber(to)} из {formatNumber(total)}{' '}
        {plural(total, unit)}
      </p>

      <div className="flex items-center gap-2">
        <Button
          variant="secondary"
          size="sm"
          disabled={!canBack || loading}
          onClick={() => onChange(Math.max(offset - limit, 0))}
          icon={<IconChevronLeft className="size-4" />}
        >
          Назад
        </Button>
        <Button
          variant="secondary"
          size="sm"
          disabled={!canForward || loading}
          onClick={() => onChange(offset + limit)}
        >
          Вперёд
          <IconChevronRight className="size-4" />
        </Button>
      </div>
    </nav>
  )
}
