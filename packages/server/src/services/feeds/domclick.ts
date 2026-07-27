import { normalizeText, toText } from './normalize.js'
import type { FeedProfile } from './profiles.js'

/**
 * Формат ДомКлик — вложенная выгрузка агрегатора novostroy-m.
 *
 * В отличие от Яндекса и ЦИАН, здесь квартира не самодостаточна: этажность и
 * срок сдачи лежат на корпусе, а название ЖК, адрес и застройщик — на
 * комплексе, то есть на два и три уровня выше лота.
 *
 *   complexes > complex > buildings > building > flats > flat
 *
 * `resolvePath` ходит только внутри узла предложения, поэтому маппингом путей
 * такое не разобрать. Профиль вместо `itemsPaths` задаёт `collect`: обход сам
 * склеивает каждый лот с выжимками родителей под ключами `_building` и
 * `_complex`, а дальше работает та же машинерия `pick` → `normalize`, что и у
 * остальных форматов. Подчёркивание в именах — чтобы не столкнуться с тегом
 * самой квартиры, если в выгрузке однажды появится свой `building`.
 *
 * Склеенный узел целиком уходит в колонку `raw`, поэтому в выжимки попадает
 * только то, что осмысленно хранить у каждого лота: списки фотографий ЖК и
 * расписание отдела продаж остаются за бортом.
 */

/** Сколько символов описания ЖК переносим в карточку комплекса. */
const MAX_DESCRIPTION = 2000

export const DOMCLICK_PROFILE: FeedProfile = {
  label: 'ДомКлик',
  itemsPaths: [],
  collect: collectDomclickOffers,
  fields: {
    externalId: ['flat_id'],
    price: ['price'],
    area: ['area'],
    livingArea: ['living_area'],
    kitchenArea: ['kitchen_area'],
    // 0 здесь означает студию — ровно наш внутренний формат.
    rooms: ['room'],
    floor: ['floor'],
    floorsTotal: ['_building.floors'],
    building: ['_building.name'],
    finishing: ['renovation'],
    balcony: ['balcony'],
    windowView: ['window_view'],
    bathroom: ['bathroom'],
    euroPlan: ['euro_plan'],
    deadlineYear: ['_building.built_year'],
    deadlineQuarter: ['_building.ready_quarter'],
    planImageUrl: ['plan'],
    projectName: ['_complex.name'],
    projectImageUrl: ['_complex.image'],
    projectDescription: ['_complex.description'],
    developer: ['_complex.developer'],
    address: ['_complex.address'],
  },
}

/**
 * Обходит выгрузку и отдаёт лоты, дополненные полями корпуса и комплекса.
 *
 * `null` означает «файл не в этом формате» — parse.ts превращает это в
 * понятную ошибку. Пустой список — исправная, но пустая выгрузка: все лоты
 * фида будут деактивированы, а не объявлены ошибкой.
 */
export function collectDomclickOffers(document: Record<string, unknown>): Record<string, unknown>[] | null {
  if (!('complexes' in document)) return null
  const root = document['complexes']
  // <complexes/> без содержимого — исправная, но пустая выгрузка.
  if (!isPlainObject(root)) return []

  const offers: Record<string, unknown>[] = []
  for (const complex of toObjectArray(root['complex'])) {
    const complexSummary = summarizeComplex(complex)
    for (const building of toObjectArray(child(complex, 'buildings', 'building'))) {
      const buildingSummary = summarizeBuilding(building)
      for (const flat of toObjectArray(child(building, 'flats', 'flat'))) {
        offers.push({ ...flat, _building: buildingSummary, _complex: complexSummary })
      }
    }
  }
  return offers
}

/** Поля комплекса, которые нужны карточке ЖК и остаются в `raw` у лота. */
function summarizeComplex(complex: Record<string, unknown>): Record<string, unknown> {
  return compact({
    id: normalizeText(complex['id'], 60),
    name: normalizeText(complex['name'], 200),
    address: normalizeText(complex['address'], 300),
    latitude: toText(complex['latitude']),
    longitude: toText(complex['longitude']),
    // <developer> — узел с именем, телефоном и логотипом; берём имя.
    developer: normalizeText(child(complex, 'developer', 'name') ?? complex['developer'], 200),
    image: firstImage(complex),
    // <description_main><title/><text/></description_main>
    description: normalizeText(child(complex, 'description_main', 'text'), MAX_DESCRIPTION),
    phone: normalizeText(child(complex, 'sales_info', 'sales_phone'), 60),
  })
}

/** Поля корпуса: этажность, срок сдачи, тип дома, готовность. */
function summarizeBuilding(building: Record<string, unknown>): Record<string, unknown> {
  return compact({
    id: normalizeText(building['id'], 60),
    name: normalizeText(building['name'], 120),
    floors: toText(building['floors']),
    built_year: toText(building['built_year']),
    ready_quarter: toText(building['ready_quarter']),
    building_state: normalizeText(building['building_state'], 60),
    building_type: normalizeText(building['building_type'], 120),
    fz_214: toText(building['fz_214']),
  })
}

/** Первая фотография комплекса — она же обложка ЖК. */
function firstImage(complex: Record<string, unknown>): string | null {
  const images = child(complex, 'images', 'image')
  if (Array.isArray(images)) {
    for (const item of images) {
      const url = toText(item)
      if (url !== null) return url
    }
    return null
  }
  return toText(images)
}

/** Значение вложенного тега: `<images><image>…` без промежуточных проверок. */
function child(node: Record<string, unknown>, wrapper: string, tag: string): unknown {
  const inner = node[wrapper]
  if (!isPlainObject(inner)) return undefined
  return inner[tag]
}

/** Выбрасывает пустые ключи: в `raw` не нужны десять `null`. */
function compact(values: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(values)) {
    if (value !== null && value !== undefined) result[key] = value
  }
  return result
}

function toObjectArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isPlainObject)
  if (isPlainObject(value)) return [value]
  return []
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
