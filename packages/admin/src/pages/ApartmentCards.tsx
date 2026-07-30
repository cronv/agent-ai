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
 *   <ApartmentCards apartments={lead.selectedApartments} emphasis="strong" />
 *
 * Один компонент на два места: подборка внутри диалога и список «что смотрел»
 * в карточке лида. Менеджер видит ровно то же, что видел посетитель, —
 * планировку, комнатность, площадь, этаж и цену.
 *
 * `emphasis="strong"` — выбранная кнопкой квартира: та же карточка, но крупнее
 * и во всю ширину полосы. С неё начинается разговор менеджера, и она не должна
 * выглядеть как одна из двадцати показанных.
 */

export type ApartmentCardEmphasis = 'default' | 'strong'

/**
 * Всё, чем выбранная квартира отличается от показанной, — в одной таблице,
 * как тона у `Badge` и `Alert`. Ветвление по `emphasis` живёт здесь, а не
 * россыпью тернарников по разметке.
 *
 * `grid` — сколько столбцов влезет, решает контейнер, а не ширина экрана.
 * `sm:grid-cols-2` здесь и подводил: на ноутбуке в 1024 px медиазапрос считает
 * экран широким и делит на два столбца колонку диалога, которой досталось
 * 330 px, — карточки становятся по 160 px, заголовок обрезается до «студи…»,
 * а цена вылезает за край. `min(100%, …)` не даёт карточке вылезти наружу,
 * когда места меньше минимума дорожки. Разница между `auto-fill` и `auto-fit` —
 * что делать с пустой дорожкой: показанная квартира остаётся в своей половине
 * (пятая из пяти не должна быть шире четырёх соседок), а единственная
 * выбранная растягивается на всю полосу.
 *
 * `thumb` — миниатюра самая дорогая часть строки: 80 px планировки на телефоне
 * отнимают у текста ровно то, чего ему и не хватает.
 *
 * `priceRow` — широкая карточка ставит цену и условия в одну строку, иначе
 * справа остаётся пустое место, а этаж с отделкой уезжают вниз.
 */
const EMPHASIS: Record<
  ApartmentCardEmphasis,
  {
    grid: string
    card: string
    thumb: string
    thumbPx: number
    title: string
    link: string
    project: string
    priceRow: string
    price: string
    details: string | null
  }
> = {
  default: {
    grid: 'grid-cols-[repeat(auto-fill,minmax(min(100%,18rem),1fr))]',
    card: 'gap-3 border-line p-3',
    thumb: 'size-16',
    thumbPx: 64,
    title: 'text-sm',
    link: 'mt-0.5',
    project: 'text-xs',
    priceRow: 'mt-1',
    price: 'text-sm font-medium',
    details: 'mt-0.5',
  },
  strong: {
    grid: 'grid-cols-[repeat(auto-fit,minmax(min(100%,20rem),1fr))]',
    card: 'gap-3 border-accent/30 p-3 sm:gap-4 sm:p-4',
    thumb: 'size-16 sm:size-20',
    thumbPx: 80,
    title: 'text-base',
    link: 'mt-1',
    project: 'text-sm',
    priceRow: 'mt-1.5 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-0.5',
    price: 'text-base font-semibold',
    details: null,
  },
}

export function ApartmentCards({
  apartments,
  className,
  emphasis = 'default',
}: {
  apartments: ApartmentCardView[]
  className?: string
  emphasis?: ApartmentCardEmphasis
}): ReactElement | null {
  if (apartments.length === 0) return null

  return (
    <ul className={cx('grid gap-2.5', EMPHASIS[emphasis].grid, className)}>
      {apartments.map((apartment) => (
        <li key={apartment.id}>
          <ApartmentCard apartment={apartment} emphasis={emphasis} />
        </li>
      ))}
    </ul>
  )
}

function ApartmentCard({
  apartment,
  emphasis,
}: {
  apartment: ApartmentCardView
  emphasis: ApartmentCardEmphasis
}): ReactElement {
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

  const style = EMPHASIS[emphasis]

  return (
    <div className={cx('flex h-full rounded-xl border bg-surface', style.card)}>
      {thumbnail === null ? (
        <span
          aria-hidden="true"
          className={cx(
            'flex shrink-0 items-center justify-center rounded-lg bg-canvas text-faint',
            style.thumb,
          )}
        >
          <IconProjects className="size-5" />
        </span>
      ) : (
        <img
          src={thumbnail}
          alt={apartment.planImageUrl === null ? `Фотография: ${title}` : `Планировка: ${title}`}
          width={style.thumbPx}
          height={style.thumbPx}
          loading="lazy"
          className={cx('shrink-0 rounded-lg bg-canvas object-contain', style.thumb)}
        />
      )}

      <div className="min-w-0 flex-1">
        {/*
          Заголовок переносится по словам, а не обрезается: «студия, 29 м²»,
          усечённая до «с», не говорит менеджеру ничего, а две строки — говорят.
        */}
        <p className={cx('flex items-start gap-1.5 font-medium text-ink', style.title)}>
          <span className="min-w-0">{title}</span>
          {apartment.url === null ? null : (
            <a
              href={apartment.url}
              target="_blank"
              rel="noreferrer noopener"
              className={cx('shrink-0 text-muted hover:text-accent', style.link)}
              aria-label={`Открыть карточку квартиры «${title}» на сайте`}
            >
              <IconExternal className="size-3.5" />
            </a>
          )}
        </p>

        {apartment.projectName === null ? null : (
          <p className={cx('text-muted', style.project)}>
            {apartment.projectName}
            {apartment.metro === null ? null : ` · ${apartment.metro}`}
          </p>
        )}

        <div className={style.priceRow}>
          <p className={cx('tabular text-ink', style.price)}>{formatMoney(apartment.price)}</p>

          {details.length > 0 ? (
            <p className={cx('text-xs text-faint', style.details)}>{details.join(' · ')}</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
