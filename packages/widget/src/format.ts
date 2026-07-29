import type { ApartmentCard } from './types.ts'

/**
 * Как числа из фида превращаются в надписи на карточке.
 *
 * Отдельный файл, потому что это единственное место, где решается, как
 * выглядит цена и площадь: карточка должна читаться так же, как на сайте
 * застройщика, иначе покупатель сравнивает не то с тем.
 */

const numbers = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 })
const decimals = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 })

/** «17 000 000 ₽». Неразрывный пробел перед рублём — чтобы знак не отрывался. */
export function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return 'Цена по запросу'
  return `${numbers.format(Math.round(value))} ₽`
}

/** «315 000 ₽/м²». */
export function formatPricePerM2(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null
  return `${numbers.format(Math.round(value))} ₽/м²`
}

/** «54,3 м²». */
export function formatArea(value: number | null): string | null {
  if (value === null || !Number.isFinite(value) || value <= 0) return null
  return `${decimals.format(value)} м²`
}

/** «Студия», «2-комн.». */
export function formatRooms(rooms: number | null): string | null {
  if (rooms === null || !Number.isFinite(rooms)) return null
  if (rooms <= 0) return 'Студия'
  return `${rooms}-комн.`
}

/** Заголовок карточки: «2-комн. · 54,3 м²». */
export function formatTitle(card: ApartmentCard): string {
  // Комнатности может не быть: у свободной планировки комнат нет вовсе,
  // а «многокомнатная» — это «больше пяти», а не число. Тогда в заголовок
  // идёт тип планировки, иначе карточка начиналась бы с одной площади.
  const planType = card.planType ? capitalize(card.planType) : null
  const rooms = formatRooms(card.rooms) ?? planType
  const parts = [rooms, formatArea(card.area)].filter((part): part is string => part !== null && part !== '')
  return parts.length > 0 ? parts.join(' · ') : 'Квартира'
}

/**
 * Что показывать в картинке карточки.
 *
 * Планировка главнее всего: по ней человек и листает ленту. Фотографии —
 * запасной вариант для вторички, где планировок не дают; их несколько, и
 * карточка даёт их пролистать. Нет ни того, ни другого — пустой список,
 * и на месте картинки рисуется заглушка.
 */
export function cardImages(card: ApartmentCard): string[] {
  if (card.planImageUrl) return [card.planImageUrl]
  return (card.photos ?? []).filter((url) => typeof url === 'string' && url !== '')
}

/** «5 из 17 этажа» — без дроби, дробь на карточке читается как ошибка. */
export function formatFloor(floor: number | null, floorsTotal: number | null): string | null {
  if (floor === null || !Number.isFinite(floor)) return null
  if (floorsTotal === null || !Number.isFinite(floorsTotal) || floorsTotal <= 0) return `${floor} этаж`
  return `${floor} из ${floorsTotal} этажа`
}

/** «Ключи в III кв. 2027». Точная дата покупателю ничего не говорит. */
export function formatDeadline(deadline: string | null): string | null {
  if (!deadline) return null
  const match = /^(\d{4})-(\d{2})/.exec(deadline)
  if (!match) return null
  const year = match[1]
  const month = Number(match[2])
  if (!year || !Number.isFinite(month) || month < 1 || month > 12) return null
  const quarter = ['I', 'II', 'III', 'IV'][Math.floor((month - 1) / 3)]
  return `Ключи в ${quarter} кв. ${year}`
}

/** «Беговая · 7 мин». */
export function formatMetro(metro: string | null, minutes: number | null): string | null {
  if (!metro || metro.trim() === '') return null
  if (minutes === null || !Number.isFinite(minutes) || minutes <= 0) return metro
  return `${metro} · ${minutes} мин`
}

/** Подпись под названием ЖК: район или застройщик — что нашлось. */
export function formatLocation(card: ApartmentCard): string | null {
  const parts = [formatMetro(card.metro, card.metroDistanceMin), card.district].filter(
    (part): part is string => typeof part === 'string' && part.trim() !== '',
  )
  return parts.length > 0 ? parts[0]! : null
}

/** Короткие пометки под ценой: отделка, срок сдачи, корпус. */
export function cardTags(card: ApartmentCard): string[] {
  const tags = [
    formatFloor(card.floor, card.floorsTotal),
    formatDeadline(card.deadline),
    card.finishing && card.finishing.trim() !== '' ? capitalize(card.finishing) : null,
  ]
  return tags.filter((tag): tag is string => tag !== null)
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

/**
 * Куда ведёт карточка квартиры.
 *
 * Своя страница лота — лучшее, что можно предложить: человек видит именно ту
 * квартиру, на которую нажал. Но в выгрузках ДомКлика адреса лота нет вовсе,
 * есть только картинка планировки, — тогда открывается карточка ЖК: это не то,
 * что он хотел, но это про тот же дом. Нет ни того, ни другого — `null`,
 * и карточка остаётся некликабельной. Ссылка в никуда хуже её отсутствия.
 *
 * Годятся только http и https. Адреса приходят из выгрузок застройщиков и из
 * админки, где их уже проверяют, — но по пути они лежат в Json-колонке, а
 * `javascript:` в атрибуте `href` означает выполнение чужого кода на странице
 * клиента. Проверка на два байта дешевле такой возможности.
 */
export function cardHref(card: ApartmentCard): string | null {
  return webUrl(card.url) ?? webUrl(card.projectUrl) ?? null
}

/** Адрес, по которому можно вести человека, или `null`. */
export function webUrl(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return /^https?:\/\//i.test(trimmed) ? trimmed : null
}

/** Что показывать, пока ассистент ходит в базу. */
export function toolLabel(name: string): string {
  switch (name) {
    case 'search_apartments':
      return 'Подбираю квартиры'
    case 'list_projects':
      return 'Смотрю проекты'
    case 'search_knowledge':
      return 'Ищу в документах'
    case 'save_lead':
      return 'Сохраняю контакт'
    default:
      return 'Уточняю данные'
  }
}
