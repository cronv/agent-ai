import { useState } from 'preact/hooks'

import { CloseIcon, ExpandIcon, LinkIcon, PlanPlaceholderIcon } from './Icons.tsx'
import { cardTags, formatLocation, formatPrice, formatPricePerM2, formatTitle } from './format.ts'
import type { ApartmentCard } from './types.ts'

/**
 * Карточка квартиры — главный объект в чате: ради неё всё и затевалось.
 *
 * Данные приходят готовыми в событии `apartments`; текст модели здесь не
 * разбирается вовсе. Порядок чтения задан намеренно: планировка → цена →
 * что это за квартира → где → кнопка. Человек листает ленту глазами по
 * планировке и цене, остальное читает, только если зацепило.
 */

interface RailProps {
  apartments: ApartmentCard[]
  onOpenPlan: (card: ApartmentCard) => void
}

export function ApartmentRail({ apartments, onOpenPlan }: RailProps) {
  if (apartments.length === 0) return null

  return (
    <div class="rail-wrap">
      <div class="rail" role="list" aria-label="Подобранные квартиры">
        {apartments.map((card) => (
          <ApartmentCardView key={card.id} card={card} onOpenPlan={onOpenPlan} />
        ))}
      </div>
    </div>
  )
}

interface CardProps {
  card: ApartmentCard
  onOpenPlan: (card: ApartmentCard) => void
}

export function ApartmentCardView({ card, onOpenPlan }: CardProps) {
  const tags = cardTags(card)
  const location = formatLocation(card)
  const perM2 = formatPricePerM2(card.pricePerM2)

  return (
    <article class="card" role="listitem">
      <Plan card={card} onOpen={() => onOpenPlan(card)} />

      <div class="card__body">
        <div class="card__price">{formatPrice(card.price)}</div>
        {perM2 ? <div class="card__perm2">{perM2}</div> : null}

        <div class="card__title">{formatTitle(card)}</div>
        {card.projectName ? (
          <div class="card__project">
            {card.projectName}
            {location ? <span class="card__location">{location}</span> : null}
          </div>
        ) : null}

        {tags.length > 0 ? (
          <div class="card__tags">
            {tags.map((tag) => (
              <span class="tag" key={tag}>
                {tag}
              </span>
            ))}
          </div>
        ) : null}

        {card.url ? (
          <a class="card__link" href={card.url} target="_blank" rel="noopener noreferrer">
            Смотреть квартиру
            <LinkIcon size={14} />
          </a>
        ) : null}
      </div>
    </article>
  )
}

/**
 * Планировка. Пока картинка не загрузилась — светлая подложка, а не пустота;
 * если ссылка битая или её нет вовсе — аккуратная заглушка. Сломанной иконки
 * браузера в дорогой витрине быть не должно.
 */
function Plan({ card, onOpen }: { card: ApartmentCard; onOpen: () => void }) {
  const [failed, setFailed] = useState(false)
  const [loaded, setLoaded] = useState(false)
  const missing = !card.planImageUrl || failed

  if (missing) {
    return (
      <div class="plan plan--empty" aria-hidden="true">
        <PlanPlaceholderIcon />
        <span>Планировка не загружена</span>
      </div>
    )
  }

  return (
    <button
      type="button"
      class="plan"
      onClick={onOpen}
      aria-label={`Открыть планировку: ${formatTitle(card)}${card.projectName ? `, ${card.projectName}` : ''}`}
    >
      <img
        src={card.planImageUrl ?? ''}
        alt=""
        loading="lazy"
        decoding="async"
        class={loaded ? 'plan__img plan__img--ready' : 'plan__img'}
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
      />
      <span class="plan__zoom" aria-hidden="true">
        <ExpandIcon size={16} />
      </span>
    </button>
  )
}

/** Планировка крупно поверх чата. Закрывается кликом по фону и Esc. */
export function PlanViewer({ card, onClose }: { card: ApartmentCard; onClose: () => void }) {
  return (
    <div class="viewer" role="dialog" aria-modal="true" aria-label="Планировка квартиры" onClick={onClose}>
      <button type="button" class="viewer__close" onClick={onClose} aria-label="Закрыть планировку">
        <CloseIcon size={18} />
      </button>
      <figure class="viewer__figure" onClick={(event) => event.stopPropagation()}>
        <img class="viewer__img" src={card.planImageUrl ?? ''} alt={`Планировка: ${formatTitle(card)}`} />
        <figcaption class="viewer__caption">
          <b>{formatTitle(card)}</b>
          <span>{[card.projectName, formatPrice(card.price)].filter(Boolean).join(' · ')}</span>
        </figcaption>
      </figure>
    </div>
  )
}
