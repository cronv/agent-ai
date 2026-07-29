import type { ReactElement } from 'react'

import { cx } from '../lib/cx.js'
import { formatDate, formatMoney, formatNumber } from '../lib/format.js'
import { IconExternal, IconProjects } from '../ui/index.js'
import type { ApartmentCardView } from './dialog-view.js'
import { roomsLabel } from './project-view.js'

/**
 * Квартиры, показанные в чате, — карточками, а не сырым JSON.
 *
 *   <ApartmentCards apartments={message.apartments} />
 *
 * Один компонент на два места: подборка внутри диалога и список «что смотрел»
 * в карточке лида. Менеджер видит ровно то же, что видел посетитель, —
 * планировку, комнатность, площадь, этаж и цену.
 */

export function ApartmentCards({
  apartments,
  className,
}: {
  apartments: ApartmentCardView[]
  className?: string
}): ReactElement | null {
  if (apartments.length === 0) return null

  return (
    <ul className={cx('grid gap-2.5 sm:grid-cols-2', className)}>
      {apartments.map((apartment) => (
        <li key={apartment.id}>
          <ApartmentCard apartment={apartment} />
        </li>
      ))}
    </ul>
  )
}

function ApartmentCard({ apartment }: { apartment: ApartmentCardView }): ReactElement {
  // Комнатности может не быть вовсе — у свободной планировки её и не бывает;
  // тогда в заголовок идёт тип планировки, а не «без комнатности».
  const rooms = apartment.rooms === null && apartment.planType ? apartment.planType : roomsLabel(apartment.rooms)
  const title = [rooms, apartment.area === null ? null : `${formatNumber(apartment.area)} м²`].filter(Boolean).join(', ')
  // Планировка главнее, но во вторичке её не дают — тогда показываем первый снимок.
  const thumbnail = apartment.planImageUrl ?? apartment.photos?.[0] ?? null

  const details = [
    apartment.floor === null
      ? null
      : `${apartment.floor}${apartment.floorsTotal === null ? '' : ` из ${apartment.floorsTotal}`} эт.`,
    apartment.finishing,
    // У сданного дома срок стоит в прошлом — это дата ввода, а не обещание.
    apartment.isReady === true
      ? 'дом сдан'
      : apartment.deadline === null
        ? null
        : `сдача ${formatDate(apartment.deadline)}`,
  ].filter((part): part is string => typeof part === 'string' && part !== '')

  return (
    <div className="flex h-full gap-3 rounded-xl border border-line bg-surface p-3">
      {thumbnail === null ? (
        <span
          aria-hidden="true"
          className="flex size-16 shrink-0 items-center justify-center rounded-lg bg-canvas text-faint"
        >
          <IconProjects className="size-5" />
        </span>
      ) : (
        <img
          src={thumbnail}
          alt={apartment.planImageUrl === null ? `Фотография: ${title}` : `Планировка: ${title}`}
          width={64}
          height={64}
          loading="lazy"
          className="size-16 shrink-0 rounded-lg bg-canvas object-contain"
        />
      )}

      <div className="min-w-0 flex-1">
        <p className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <span className="truncate">{title}</span>
          {apartment.url === null ? null : (
            <a
              href={apartment.url}
              target="_blank"
              rel="noreferrer noopener"
              className="shrink-0 text-muted hover:text-accent"
              aria-label={`Открыть карточку квартиры «${title}» на сайте`}
            >
              <IconExternal className="size-3.5" />
            </a>
          )}
        </p>

        {apartment.projectName === null ? null : (
          <p className="truncate text-xs text-muted">
            {apartment.projectName}
            {apartment.metro === null ? null : ` · ${apartment.metro}`}
          </p>
        )}

        <p className="tabular mt-1 text-sm font-medium text-ink">{formatMoney(apartment.price)}</p>

        {details.length > 0 ? <p className="mt-0.5 text-xs text-faint">{details.join(' · ')}</p> : null}
      </div>
    </div>
  )
}
