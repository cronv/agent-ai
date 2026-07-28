import { useState } from 'preact/hooks'

import { ArrowIcon, CheckIcon, CloseIcon, ExpandIcon, LinkIcon, PlanPlaceholderIcon } from './Icons.tsx'
import { cardImages, cardTags, formatLocation, formatPrice, formatPricePerM2, formatTitle } from './format.ts'
import type { ApartmentCard } from './types.ts'

/**
 * Карточка квартиры — главный объект в чате: ради неё всё и затевалось.
 *
 * Данные приходят готовыми в событии `apartments`; текст модели здесь не
 * разбирается вовсе. Порядок чтения задан намеренно: картинка → цена →
 * что это за квартира → где → кнопка. Человек листает ленту глазами по
 * картинке и цене, остальное читает, только если зацепило.
 *
 * Картинка — это планировка, если она есть. Вторичка планировок не отдаёт,
 * зато отдаёт фотографии: тогда карточка показывает первую и даёт пролистать
 * остальные. Нет ни того, ни другого — заглушка; сломанной иконки браузера
 * в дорогой витрине быть не должно.
 *
 * Внизу карточки две кнопки, и спорить друг с другом им нельзя. «Выбрать» —
 * заливка акцентом: это действие ради которого всё и затевалось, менеджер
 * узнает про выбранную квартиру. «Смотреть» — тише, оно уводит с сайта.
 */

interface RailProps {
  apartments: ApartmentCard[]
  onOpenPlan: (card: ApartmentCard, index: number) => void
  /** Идентификаторы уже выбранных квартир. */
  selected?: string[]
  /** Нажали «Выбрать». Не задан — кнопки выбора нет вовсе. */
  onSelect?: (card: ApartmentCard) => void
}

export function ApartmentRail({ apartments, onOpenPlan, selected = [], onSelect }: RailProps) {
  if (apartments.length === 0) return null

  return (
    <div class="rail-wrap">
      <div class="rail" role="list" aria-label="Подобранные квартиры">
        {apartments.map((card) => (
          <ApartmentCardView
            key={card.id}
            card={card}
            onOpenPlan={onOpenPlan}
            chosen={selected.includes(card.id)}
            {...(onSelect ? { onSelect } : {})}
          />
        ))}
      </div>
    </div>
  )
}

interface CardProps {
  card: ApartmentCard
  onOpenPlan: (card: ApartmentCard, index: number) => void
  chosen?: boolean
  onSelect?: (card: ApartmentCard) => void
}

export function ApartmentCardView({ card, onOpenPlan, chosen = false, onSelect }: CardProps) {
  const tags = cardTags(card)
  const location = formatLocation(card)
  const perM2 = formatPricePerM2(card.pricePerM2)

  return (
    <article class={chosen ? 'card card--chosen' : 'card'} role="listitem">
      <Gallery card={card} onOpen={(index) => onOpenPlan(card, index)} />

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

        <div class="card__actions">
          {onSelect ? (
            <button
              type="button"
              class={chosen ? 'card__pick card__pick--chosen' : 'card__pick'}
              onClick={() => onSelect(card)}
              disabled={chosen}
              aria-label={chosen ? `Квартира выбрана: ${formatTitle(card)}` : `Выбрать квартиру: ${formatTitle(card)}`}
            >
              {chosen ? (
                <>
                  <CheckIcon size={15} />
                  Выбрана
                </>
              ) : (
                'Выбрать'
              )}
            </button>
          ) : null}

          {card.url ? (
            <a
              class={onSelect ? 'card__link card__link--quiet' : 'card__link'}
              href={card.url}
              target="_blank"
              rel="noopener noreferrer"
            >
              {onSelect ? 'Смотреть' : 'Смотреть квартиру'}
              <LinkIcon size={14} />
            </a>
          ) : null}
        </div>
      </div>
    </article>
  )
}

/**
 * Картинка карточки: планировка или фотографии.
 *
 * Пока снимок не загрузился — светлая подложка, а не пустота. Битую ссылку
 * пролистываем дальше: у вторички половина галереи может отвалиться, и это
 * не повод показывать заглушку, пока есть хоть один живой кадр. Отвалилось
 * всё — заглушка, та же, что и у лота без картинок вовсе.
 */
function Gallery({ card, onOpen }: { card: ApartmentCard; onOpen: (index: number) => void }) {
  const images = cardImages(card)
  const [index, setIndex] = useState(0)
  const [loaded, setLoaded] = useState(false)
  const [broken, setBroken] = useState<string[]>([])

  const alive = images.filter((url) => !broken.includes(url))
  const current = alive[Math.min(index, alive.length - 1)]

  if (current === undefined) {
    return (
      <div class="plan plan--empty" aria-hidden="true">
        <PlanPlaceholderIcon />
        <span>{card.planImageUrl ? 'Планировка не загружена' : 'Фотографий пока нет'}</span>
      </div>
    )
  }

  const isPlan = current === card.planImageUrl
  const what = isPlan ? 'планировку' : 'фотографию'
  const title = `${formatTitle(card)}${card.projectName ? `, ${card.projectName}` : ''}`
  const position = Math.min(index, alive.length - 1)

  const step = (delta: number): void => {
    setLoaded(false)
    setIndex((was) => (Math.min(was, alive.length - 1) + delta + alive.length) % alive.length)
  }

  return (
    <div class="plan">
      <button type="button" class="plan__open" onClick={() => onOpen(position)} aria-label={`Открыть ${what}: ${title}`}>
        <img
          // Ключ по адресу: без него Preact переиспользует <img> и на миг
          // показывает прошлый кадр под новым onLoad.
          key={current}
          src={current}
          alt=""
          loading="lazy"
          decoding="async"
          class={`${isPlan ? 'plan__img' : 'plan__img plan__img--photo'}${loaded ? ' plan__img--ready' : ''}`}
          onLoad={() => setLoaded(true)}
          onError={() => setBroken((was) => [...was, current])}
        />
      </button>
      <span class="plan__zoom" aria-hidden="true">
        <ExpandIcon size={16} />
      </span>
      {alive.length > 1 ? (
        <>
          <button type="button" class="plan__nav plan__nav--prev" onClick={() => step(-1)} aria-label="Предыдущее фото">
            <ArrowIcon size={16} />
          </button>
          <button type="button" class="plan__nav plan__nav--next" onClick={() => step(1)} aria-label="Следующее фото">
            <ArrowIcon size={16} />
          </button>
          <span class="plan__count">
            {position + 1}/{alive.length}
          </span>
        </>
      ) : null}
    </div>
  )
}

/**
 * Картинка крупно поверх чата. Закрывается кликом по фону и Esc.
 *
 * Листается теми же стрелками, что и в карточке: человек, открывший третий
 * снимок, ожидает увидеть рядом четвёртый, а не возвращаться в ленту.
 */
export function PlanViewer({ card, index, onClose }: { card: ApartmentCard; index: number; onClose: () => void }) {
  const images = cardImages(card)
  const [position, setPosition] = useState(Math.min(Math.max(index, 0), Math.max(images.length - 1, 0)))
  const current = images[position] ?? ''
  const isPlan = current === card.planImageUrl
  const label = isPlan ? 'Планировка' : 'Фотография'

  const step = (delta: number): void => {
    setPosition((was) => (was + delta + images.length) % images.length)
  }

  return (
    <div class="viewer" role="dialog" aria-modal="true" aria-label={`${label} квартиры`} onClick={onClose}>
      <button type="button" class="viewer__close" onClick={onClose} aria-label="Закрыть">
        <CloseIcon size={18} />
      </button>
      <figure class="viewer__figure" onClick={(event) => event.stopPropagation()}>
        <div class="viewer__frame">
          <img class="viewer__img" src={current} alt={`${label}: ${formatTitle(card)}`} />
          {images.length > 1 ? (
            <>
              <button type="button" class="plan__nav plan__nav--prev" onClick={() => step(-1)} aria-label="Предыдущее фото">
                <ArrowIcon size={18} />
              </button>
              <button type="button" class="plan__nav plan__nav--next" onClick={() => step(1)} aria-label="Следующее фото">
                <ArrowIcon size={18} />
              </button>
            </>
          ) : null}
        </div>
        <figcaption class="viewer__caption">
          <b>{formatTitle(card)}</b>
          <span>
            {[card.projectName, formatPrice(card.price), images.length > 1 ? `${position + 1} из ${images.length}` : null]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </figcaption>
      </figure>
    </div>
  )
}
