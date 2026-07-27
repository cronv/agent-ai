import type { FeedFormat } from '@prisma/client'

/**
 * Где в XML лежит какое поле.
 *
 * Профиль — это словарь «поле квартиры → путь в разобранном XML». Пути
 * указываются точками относительно узла одного предложения; атрибуты
 * начинаются с `@_` (так их называет fast-xml-parser). Для поля можно задать
 * несколько путей — берётся первый, где нашлось непустое значение: выгрузки
 * одного и того же формата отличаются мелочами, и запасной путь дешевле, чем
 * отдельный формат.
 *
 * Профили `yandex` и `cian` встроены. Формат `custom` берёт такой же словарь
 * из поля `fieldMapping` фида — см. `resolveProfile`.
 */

/** Поля, которые умеет заполнять маппинг. */
export const FEED_FIELDS = [
  'externalId',
  'url',
  'price',
  'pricePerM2',
  'area',
  'livingArea',
  'kitchenArea',
  'rooms',
  'studio',
  'floor',
  'floorsTotal',
  'building',
  'section',
  'finishing',
  'deadline',
  'deadlineYear',
  'deadlineQuarter',
  'planImageUrl',
  'projectName',
  'projectUrl',
  'projectImageUrl',
  'developer',
  'district',
  'metro',
  'metroDistanceMin',
  'address',
] as const

export type FeedField = (typeof FEED_FIELDS)[number]

export interface FeedProfile {
  /**
   * Пути до списка предложений, от корня документа. Проверяются по порядку;
   * если родитель пути существует, а списка нет — фид считается пустым,
   * а не сломанным.
   */
  itemsPaths: string[]
  /** Как называется формат в сообщениях об ошибке. */
  label: string
  fields: Partial<Record<FeedField, string[]>>
}

/**
 * Яндекс.Недвижимость — YML-подобный `realty-feed`.
 * Схема: http://webmaster.yandex.ru/schemas/feed/realty/2010-06
 */
export const YANDEX_PROFILE: FeedProfile = {
  label: 'Яндекс.Недвижимость',
  itemsPaths: ['realty-feed.offer'],
  fields: {
    externalId: ['@_internal-id', 'internal-id', 'offer-id', '@_id'],
    url: ['url'],
    price: ['price.value', 'price'],
    area: ['area.value', 'area'],
    livingArea: ['living-space.value', 'living-space'],
    kitchenArea: ['kitchen-space.value', 'kitchen-space'],
    rooms: ['rooms', 'rooms-offered'],
    studio: ['studio'],
    floor: ['floor'],
    floorsTotal: ['floors-total'],
    building: ['building-section', 'building-number'],
    section: ['building-phase'],
    finishing: ['renovation'],
    deadlineYear: ['built-year'],
    deadlineQuarter: ['ready-quarter'],
    planImageUrl: ['image'],
    projectName: ['building-name'],
    developer: ['sales-agent.organization'],
    district: ['location.sub-locality-name'],
    metro: ['location.metro.name'],
    metroDistanceMin: ['location.metro.time-on-foot', 'location.metro.time-on-transport'],
    address: ['location.address'],
  },
}

/** ЦИАН — выгрузка `feed` версии 2. */
export const CIAN_PROFILE: FeedProfile = {
  label: 'ЦИАН',
  itemsPaths: ['feed.object'],
  fields: {
    externalId: ['ExternalId', 'Id'],
    url: ['Url', 'ExternalUrl'],
    price: ['BargainTerms.Price'],
    area: ['TotalArea'],
    livingArea: ['LivingArea'],
    kitchenArea: ['KitchenArea'],
    rooms: ['RoomsCount', 'FlatRoomsCount', 'FlatType'],
    studio: ['FlatType'],
    floor: ['FloorNumber'],
    floorsTotal: ['Building.FloorsCount'],
    building: ['JKSchema.House.Name', 'Building.Name'],
    section: ['JKSchema.House.Section', 'SectionName'],
    finishing: ['Decoration', 'JKSchema.House.Decoration'],
    deadlineYear: ['Building.Deadline.Year', 'JKSchema.House.Deadline.Year'],
    deadlineQuarter: ['Building.Deadline.Quarter', 'JKSchema.House.Deadline.Quarter'],
    planImageUrl: ['LayoutPhoto.FullUrl', 'Photos.PhotoSchema.FullUrl'],
    projectName: ['JKSchema.Name'],
    projectUrl: ['JKSchema.Url'],
    developer: ['JKSchema.Developer.Name', 'Building.Developer'],
    district: ['District', 'JKSchema.District'],
    metro: ['Undergrounds.Underground.Name'],
    metroDistanceMin: ['Undergrounds.Underground.Time'],
    address: ['Address'],
  },
}

export const BUILT_IN_PROFILES: Record<'yandex' | 'cian', FeedProfile> = {
  yandex: YANDEX_PROFILE,
  cian: CIAN_PROFILE,
}

export class FeedMappingError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeedMappingError'
  }
}

/**
 * Профиль для фида.
 *
 * Для `yandex` и `cian` — встроенный, `fieldMapping` не нужен. Для `custom` —
 * собирается из `fieldMapping`; принимаются две записи:
 *
 *   { "itemsPath": "offers.offer", "fields": { "price": "cost", … } }
 *   { "price": "cost", "area": "square", … }            // короткая запись
 *
 * Значение поля — строка или список строк (запасные пути). Неизвестные поля
 * игнорируются: лишний ключ в настройке не должен ронять синхронизацию.
 */
export function resolveProfile(format: FeedFormat, fieldMapping: unknown): FeedProfile {
  if (format !== 'custom') {
    const profile = BUILT_IN_PROFILES[format]
    if (!profile) throw new FeedMappingError(`Неизвестный формат фида: ${String(format)}`)
    return profile
  }

  if (fieldMapping === null || fieldMapping === undefined || typeof fieldMapping !== 'object' || Array.isArray(fieldMapping)) {
    throw new FeedMappingError(
      'Для формата «custom» нужно заполнить соответствие полей (fieldMapping) — какой путь в XML соответствует какому полю квартиры',
    )
  }

  const source = fieldMapping as Record<string, unknown>
  const rawFields = isPlainObject(source['fields']) ? (source['fields'] as Record<string, unknown>) : source

  const fields: Partial<Record<FeedField, string[]>> = {}
  for (const field of FEED_FIELDS) {
    const paths = toPathList(rawFields[field])
    if (paths.length > 0) fields[field] = paths
  }

  if (fields.externalId === undefined && fields.price === undefined) {
    throw new FeedMappingError(
      'В соответствии полей должны быть заданы хотя бы externalId и price — без них квартиру нельзя ни опознать, ни показать',
    )
  }

  const itemsPaths = toPathList(source['itemsPath'] ?? source['itemsPaths'])

  return {
    label: 'свой формат',
    itemsPaths,
    fields,
  }
}

function toPathList(value: unknown): string[] {
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? [] : [trimmed]
  }
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string' && item.trim() !== '').map((item) => item.trim())
  }
  return []
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
