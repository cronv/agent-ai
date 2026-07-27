import type { FeedFormat } from '@prisma/client'
import { XMLParser, XMLValidator } from 'fast-xml-parser'

import {
  computePricePerM2,
  isStudio,
  normalizeFinishing,
  normalizeText,
  normalizeUrl,
  parseArea,
  parseDate,
  parseInteger,
  parsePrice,
  parseQuarter,
  parseRooms,
  parseYear,
  quarterEndDate,
  toText,
} from './normalize.js'
import { FeedMappingError, resolveProfile, type FeedField, type FeedProfile } from './profiles.js'

/**
 * Разбор XML-выгрузки застройщика.
 *
 * Модуль ничего не знает про базу и про сеть: на вход — текст XML и формат,
 * на выходе — список квартир с нормализованными значениями. Это позволяет
 * проверять разбор на эталонных файлах в `__fixtures__` без Postgres.
 *
 *   const { apartments } = parseFeedXml(xml, { format: 'yandex' })
 *
 * Сломанный XML и неопознанный формат приводят к `FeedParseError`; отдельное
 * негодное предложение — не приводит, оно попадает в `skipped` со своей
 * причиной. Один криво заполненный лот не должен отменять импорт остальных.
 */

/** ЖК, каким его описывает выгрузка. Заполняется, только если найдено название. */
export interface ParsedProject {
  name: string
  developer: string | null
  district: string | null
  metro: string | null
  metroDistanceMin: number | null
  address: string | null
  url: string | null
}

/** Квартира, готовая к записи в базу. */
export interface ParsedApartment {
  externalId: string
  price: number
  pricePerM2: number | null
  rooms: number | null
  area: number | null
  livingArea: number | null
  kitchenArea: number | null
  floor: number | null
  floorsTotal: number | null
  building: string | null
  section: string | null
  finishing: string | null
  deadline: Date | null
  planImageUrl: string | null
  url: string | null
  project: ParsedProject | null
  /** Исходный узел XML — в базе хранится в колонке `raw`. */
  raw: Record<string, unknown>
}

/** Предложение, которое не удалось превратить в квартиру. */
export interface SkippedOffer {
  /** Порядковый номер предложения в фиде, с единицы. */
  index: number
  externalId: string | null
  reason: string
}

export interface ParsedFeed {
  apartments: ParsedApartment[]
  skipped: SkippedOffer[]
  /** Сколько предложений было в файле — сумма принятых и пропущенных. */
  total: number
}

export interface ParseFeedOptions {
  format: FeedFormat
  /** Для формата `custom` — соответствие полей из настроек фида. */
  fieldMapping?: unknown
}

export class FeedParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeedParseError'
  }
}

export { FeedMappingError }

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@_',
  textNodeName: '#text',
  // Значения не приводим к числам: '007' и '18 450 000' одинаково приедут
  // строками, а числа из них делает normalize.ts по своим правилам.
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  // Выгрузки Яндекса объявляют пространство имён; префиксы вида `ns:offer`
  // срезаем, чтобы пути в профилях не зависели от того, как его назвали.
  removeNSPrefix: true,
  processEntities: true,
})

/** Разбирает выгрузку. Бросает `FeedParseError`, если файл не читается. */
export function parseFeedXml(xml: string, options: ParseFeedOptions): ParsedFeed {
  const profile = resolveProfile(options.format, options.fieldMapping)
  const document = parseXmlDocument(xml)
  const offers = findOffers(document, profile)

  const apartments: ParsedApartment[] = []
  const skipped: SkippedOffer[] = []

  offers.forEach((offer, position) => {
    const index = position + 1
    try {
      const apartment = buildApartment(offer, profile)
      if ('reason' in apartment) {
        skipped.push({ index, externalId: apartment.externalId, reason: apartment.reason })
      } else {
        apartments.push(apartment)
      }
    } catch (error) {
      skipped.push({ index, externalId: null, reason: describeError(error) })
    }
  })

  return { apartments, skipped, total: offers.length }
}

// ── XML ─────────────────────────────────────────────────────

function parseXmlDocument(xml: string): Record<string, unknown> {
  if (typeof xml !== 'string' || xml.trim() === '') {
    throw new FeedParseError('Фид пустой — по ссылке ничего не отдали')
  }

  const validation = XMLValidator.validate(xml, { allowBooleanAttributes: true })
  if (validation !== true) {
    const { line, col, msg } = validation.err
    throw new FeedParseError(`Файл не является правильным XML: ${msg} (строка ${line}, позиция ${col})`)
  }

  let document: unknown
  try {
    document = parser.parse(xml)
  } catch (error) {
    throw new FeedParseError(`Не удалось разобрать XML: ${describeError(error)}`)
  }

  if (typeof document !== 'object' || document === null || Array.isArray(document)) {
    throw new FeedParseError('В XML нет корневого элемента')
  }
  return document as Record<string, unknown>
}

/**
 * Находит список предложений.
 *
 * Если путь до контейнера есть, а предложений в нём нет — это пустой, но
 * исправный фид: вернётся пустой список, и все квартиры будут деактивированы.
 * Если контейнера нет вовсе — файл не того формата, и это ошибка.
 */
function findOffers(document: Record<string, unknown>, profile: FeedProfile): Record<string, unknown>[] {
  for (const path of profile.itemsPaths) {
    const segments = path.split('.')
    const last = segments.pop()
    if (last === undefined) continue
    const container = segments.length === 0 ? document : resolvePath(document, segments.join('.'))
    if (!isPlainObject(container)) continue
    if (!(last in container)) return []
    return toObjectArray(container[last])
  }

  // Свой формат без itemsPath: ищем первый узел, похожий на список предложений.
  // Для встроенных профилей путь известен точно — угадывать нечего, иначе
  // выгрузка ЦИАН молча «разберётся» профилем Яндекса и даст пустые поля.
  if (profile.itemsPaths.length === 0) {
    const detected = detectOffers(document)
    if (detected) return detected
  }

  const roots = Object.keys(document)
    .filter((key) => key !== '?xml')
    .map((key) => `«${key}»`)
    .join(', ')
  const expected = profile.itemsPaths.length > 0 ? ` Ожидался путь ${profile.itemsPaths.map((p) => `«${p}»`).join(' или ')}.` : ''
  throw new FeedParseError(
    `Это не похоже на выгрузку в формате «${profile.label}»: в файле нет списка предложений.${expected} Найдены разделы: ${roots || 'нет'}`,
  )
}

/**
 * Догадка о том, где в незнакомом документе лежат предложения: самый большой
 * список одинаковых узлов. Работает только для формата `custom`, когда путь
 * не задан явно; в единственном лоте списка нет, поэтому подходит и одиночный
 * узел, у которого много простых полей.
 */
function detectOffers(document: Record<string, unknown>): Record<string, unknown>[] | null {
  let best: { items: Record<string, unknown>[]; score: number } | null = null

  const visit = (node: Record<string, unknown>, depth: number): void => {
    if (depth > 5) return
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('?') || key.startsWith('@_') || key === '#text') continue

      if (Array.isArray(value)) {
        const items = value.filter(isPlainObject)
        if (items.length > 0) {
          const score = items.length * 100 + depth
          if (!best || score > best.score) best = { items, score }
        }
        const first = items[0]
        if (first) visit(first, depth + 1)
        continue
      }

      if (isPlainObject(value)) {
        if (countScalarFields(value) >= 3) {
          const score = 100 + depth
          if (!best || score > best.score) best = { items: [value], score }
        }
        visit(value, depth + 1)
      }
    }
  }

  visit(document, 0)
  return best === null ? null : (best as { items: Record<string, unknown>[] }).items
}

function countScalarFields(node: Record<string, unknown>): number {
  return Object.values(node).filter((value) => typeof value === 'string' || typeof value === 'number').length
}

function toObjectArray(value: unknown): Record<string, unknown>[] {
  if (Array.isArray(value)) return value.filter(isPlainObject)
  if (isPlainObject(value)) return [value]
  return []
}

/**
 * Значение по пути с точками. Массив на промежуточном шаге — берётся первый
 * элемент: `<Undergrounds><Underground>…` может повторяться, нам нужна
 * ближайшая станция, она в выгрузках идёт первой.
 */
export function resolvePath(node: unknown, path: string): unknown {
  let current: unknown = node
  for (const segment of path.split('.')) {
    if (Array.isArray(current)) current = current[0]
    if (!isPlainObject(current)) return undefined
    current = current[segment]
    if (current === undefined || current === null) return undefined
  }
  return current
}

// ── Поля ────────────────────────────────────────────────────

/** Первое непустое значение среди путей, заданных для поля. */
function pick(offer: Record<string, unknown>, profile: FeedProfile, field: FeedField): unknown {
  const paths = profile.fields[field]
  if (!paths) return undefined
  for (const path of paths) {
    const value = resolvePath(offer, path)
    if (toText(value) !== null) return value
  }
  return undefined
}

type BuildResult = ParsedApartment | { reason: string; externalId: string | null }

function buildApartment(offer: Record<string, unknown>, profile: FeedProfile): BuildResult {
  const externalId = normalizeText(pick(offer, profile, 'externalId'), 200)
  if (externalId === null) {
    return { reason: 'нет внешнего идентификатора лота', externalId: null }
  }

  const price = parsePrice(pick(offer, profile, 'price'))
  if (price === null) {
    return { reason: 'нет цены или цена не читается как число', externalId }
  }

  const area = parseArea(pick(offer, profile, 'area'))
  const studioFlag = profile.fields.studio ? isStudio(pick(offer, profile, 'studio')) : false
  const rooms = studioFlag ? 0 : parseRooms(pick(offer, profile, 'rooms'))

  const deadline =
    parseDate(pick(offer, profile, 'deadline')) ??
    quarterEndDate(parseYear(pick(offer, profile, 'deadlineYear')), parseQuarter(pick(offer, profile, 'deadlineQuarter')))

  return {
    externalId,
    price,
    pricePerM2: parsePrice(pick(offer, profile, 'pricePerM2')) ?? computePricePerM2(price, area),
    rooms,
    area,
    livingArea: parseArea(pick(offer, profile, 'livingArea')),
    kitchenArea: parseArea(pick(offer, profile, 'kitchenArea')),
    floor: parseInteger(pick(offer, profile, 'floor')),
    floorsTotal: parseInteger(pick(offer, profile, 'floorsTotal')),
    building: normalizeText(pick(offer, profile, 'building'), 120),
    section: normalizeText(pick(offer, profile, 'section'), 120),
    finishing: normalizeFinishing(pick(offer, profile, 'finishing')),
    deadline,
    planImageUrl: normalizeUrl(pick(offer, profile, 'planImageUrl')),
    url: normalizeUrl(pick(offer, profile, 'url')),
    project: buildProject(offer, profile),
    raw: offer,
  }
}

function buildProject(offer: Record<string, unknown>, profile: FeedProfile): ParsedProject | null {
  const name = normalizeText(pick(offer, profile, 'projectName'), 200)
  if (name === null) return null
  return {
    name,
    developer: normalizeText(pick(offer, profile, 'developer'), 200),
    district: normalizeText(pick(offer, profile, 'district'), 120),
    metro: normalizeText(pick(offer, profile, 'metro'), 120),
    metroDistanceMin: parseInteger(pick(offer, profile, 'metroDistanceMin')),
    address: normalizeText(pick(offer, profile, 'address'), 300),
    url: normalizeUrl(pick(offer, profile, 'projectUrl')),
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message
  return String(error)
}
