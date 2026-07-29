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
 *
 * Отдельного поля «район» в формате нет — он вычисляется из адреса и названия
 * комплекса, см. `districtFromComplex`.
 *
 * Готовность дома формат сообщает дважды и по-разному: у корпуса словом
 * (`building_state` = `ready`), у квартиры числом (`ready_housing` = 1).
 * Оба значения попадают в одно поле `ready` запасными путями — на боевых
 * данных это 685 лотов из 997, у которых «срок сдачи» иначе оказывается
 * в прошлом.
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
    // Готовность выгрузка сообщает дважды: у квартиры числом, у корпуса словом.
    // Начинаем с квартиры — она конкретнее: в одном ЖК бывают и сданные корпуса,
    // и строящиеся.
    ready: ['ready_housing', '_building.building_state'],
    planImageUrl: ['plan'],
    projectName: ['_complex.name'],
    projectImageUrl: ['_complex.image'],
    projectDescription: ['_complex.description'],
    developer: ['_complex.developer'],
    district: ['_complex.district'],
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
  const name = normalizeText(complex['name'], 200)
  const address = normalizeText(complex['address'], 300)
  return compact({
    id: normalizeText(complex['id'], 60),
    name,
    address,
    // Отдельного тега с районом в формате нет — вычисляем его сами.
    district: districtFromComplex(name, address),
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

// ── Район ───────────────────────────────────────────────────

/**
 * Район ЖК: ДомКлик не отдаёт его отдельным полем.
 *
 *   districtFromComplex('ЖК «Космос» (Домодедово)', 'Домодедовский городской округ. ул. Жуковского, д. 4')
 *   // → 'Домодедово'
 *
 * Есть два источника, и оба неточные. Первый — уточнение в скобках названия:
 * `ЖК «Восточный» (Звенигород)` стоит в Одинцовском районе, но человек ищет
 * Звенигород, поэтому скобки важнее адреса. Второй — часть адреса до первой
 * точки: там лежит административная единица.
 *
 * В скобках бывает и не город: `ЖК «Школьный» («Альянс»)` — второе имя
 * комплекса. Признак простой: настоящий город в кавычки не берут.
 */
export function districtFromComplex(name: string | null, address: string | null): string | null {
  return districtFromName(name) ?? districtFromAddress(address)
}

/** Уточнение в скобках названия: `ЖК «Космос» (Домодедово)` → `Домодедово`. */
function districtFromName(name: string | null): string | null {
  if (name === null) return null
  const match = /\(([^()]+)\)/.exec(name)
  if (!match) return null
  const inner = match[1] ?? ''
  // Кавычки внутри скобок означают второе название ЖК, а не населённый пункт.
  if (/[«»"'„“”]/.test(inner)) return null
  return humanizePlace(inner)
}

/**
 * Первая часть адреса — административная единица. Разбираем две первые части:
 * встречается и `Химки городской округ. ул. …`, и `г.о. Химки. ул. …`.
 * Дальше начинается улица, и туда лезть незачем.
 */
function districtFromAddress(address: string | null): string | null {
  if (address === null) return null
  const segments = address.split(/\.(?=\s|$)/, 2)
  for (const segment of segments) {
    const place = humanizePlace(segment)
    if (place !== null) return place
  }
  return null
}

/** Слова административного деления: в речи покупателя их нет. */
const ADMIN_WORDS = new Set([
  'городской',
  'городского',
  'городская',
  'городское',
  'муниципальный',
  'муниципального',
  'муниципальное',
  'сельский',
  'сельского',
  'сельское',
  'поселение',
  'поселения',
  'поселок',
  'посёлок',
  'округ',
  'округа',
  'район',
  'района',
  'р-н',
  'область',
  'области',
  'обл',
  'край',
  'края',
  'республика',
  'республики',
  'город',
  'гор',
  'г',
  'о',
  'го',
  'мо',
])

/** Слова, после которых начинается адрес, а не название места. */
const STREET_WORDS = new Set([
  'ул',
  'улица',
  'пер',
  'переулок',
  'пр-т',
  'просп',
  'проспект',
  'пр',
  'ш',
  'шоссе',
  'наб',
  'набережная',
  'бул',
  'бульвар',
  'мкр',
  'микрорайон',
  'квартал',
  'д',
  'дом',
  'корп',
  'корпус',
  'стр',
  'влд',
  'км',
  'километр',
  'жк',
])

/** Сколько слов может быть в названии места. «Наро-Фоминский городской округ» — три. */
const MAX_PLACE_WORDS = 4

/**
 * Приводит административное название к тому виду, которым пользуются люди:
 *
 *   'Домодедовский городской округ' → 'Домодедово'
 *   'Химки городской округ'         → 'Химки'
 *   'Пушкинский район'              → 'Пушкинский'
 *   'ул. Жуковского, д. 4'          → null
 *
 * `null` означает «это не название места»: лучше оставить район пустым,
 * чем записать в него кусок улицы.
 */
export function humanizePlace(value: string): string | null {
  const text = value.replace(/\s+/g, ' ').trim()
  if (text === '' || /\d/.test(text)) return null

  const words = text
    .split(/[\s,]+/)
    .map((word) => word.replace(/[.«»"'„“”]/g, '').trim())
    .filter((word) => word !== '')

  if (words.length === 0 || words.length > MAX_PLACE_WORDS) return null
  if (words.some((word) => STREET_WORDS.has(word.toLowerCase()))) return null

  const kept = words.filter((word) => !ADMIN_WORDS.has(word.toLowerCase()))
  if (kept.length === 0) return null

  // Прилагательное превращаем в название города, только когда слово одно:
  // «Домодедовский» — это Домодедово, а в «Старый Оскол» ничего менять не надо.
  const named = kept.length === 1 ? cityFromAdjective(kept[0] ?? '') : kept.join(' ')
  return capitalize(named)
}

/**
 * «Домодедовский» → «Домодедово», «Одинцовский» → «Одинцово».
 *
 * Работают только суффиксы -овский/-евский: по ним город восстанавливается
 * однозначно. «Пушкинский» так не разворачивается (Пушкино или Пушкин —
 * из одного слова не понять), и остаётся как есть: поиск по району всё равно
 * триграммный и «Пушкино» с «Пушкинским» сопоставит.
 */
function cityFromAdjective(word: string): string {
  if (/овский$/i.test(word)) return word.replace(/овский$/i, 'ово')
  if (/евский$/i.test(word)) return word.replace(/евский$/i, 'ево')
  return word
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
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
