import type { Db } from '../../db/prisma.js'
import { categoryLabel, parseProjectCategory } from '../../lib/categories.js'
import { KNOWLEDGE_SEARCH_LIMIT, searchKnowledge } from '../knowledge/index.js'
import {
  normalizeFinishing,
  normalizeText,
  parseArea,
  parseDate,
  parseInteger,
  parsePrice,
  parseRooms,
} from '../feeds/normalize.js'
import {
  listCatalogLocations,
  listProjects,
  searchApartments,
  type ApartmentCard,
  type ApartmentSearchParams,
  type CatalogLocation,
  type EmptySearchFacts,
  type ProjectFilterParams,
} from './apartments.js'
import { areaRange, capitalize, millions, plural, priceRange, roomsGenitive, roomsLabel } from './wording.js'
import { saveLeadToDatabase, validateLead, type LeadHandler, type SavedLead } from './leads.js'
import { describeVariety } from './variety.js'
import { pickSuggestions } from './suggestions.js'
import { isToolName, type ToolName } from './tools.js'

/**
 * Исполнение инструментов.
 *
 *   const outcome = await executeTool('search_apartments', input, ctx)
 *
 * Всё, что приходит от модели, считается недоверенным вводом: «до 18 млн»
 * вместо числа, «2 кв. 2027» вместо даты, строка вместо массива. Разбирают это
 * те же функции, что и выгрузки застройщиков (`services/feeds/normalize.ts`) —
 * второй набор правил для тех же величин неизбежно разошёлся бы с первым.
 *
 * Ошибка инструмента не роняет диалог: она возвращается модели как результат
 * с `isError`, и модель либо исправляет параметры, либо честно говорит,
 * что не получилось.
 */

export interface ToolContext {
  db: Db
  conversationId: string
  /** Куда уходит контакт. Тикет 07 подставляет сюда полноценный сервис лидов. */
  saveLead?: LeadHandler
  /** Сегодняшняя дата — по ней отбраковываются кнопки с прошедшими сроками. */
  today?: Date
}

export interface ToolOutcome {
  name: string
  /** Результат для модели — JSON-строка. */
  content: string
  isError: boolean
  /** Карточки для виджета: сохраняются в сообщение структурно. */
  apartments: ApartmentCard[]
  lead: SavedLead | null
  /** Реплики для кнопок быстрого ответа — только у `suggest_replies`. */
  suggestions: string[]
}

export async function executeTool(name: string, rawInput: unknown, context: ToolContext): Promise<ToolOutcome> {
  if (!isToolName(name)) {
    return failure(
      name,
      `Инструмента «${name}» не существует. Доступны search_apartments, list_projects, search_knowledge, save_lead, suggest_replies.`,
    )
  }

  const input = asRecord(rawInput)

  try {
    return await run(name, input, context)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return failure(name, `Не удалось выполнить запрос к базе: ${detail}`)
  }
}

async function run(name: ToolName, input: Record<string, unknown>, context: ToolContext): Promise<ToolOutcome> {
  switch (name) {
    case 'search_apartments':
      return runSearchApartments(input, context)
    case 'list_projects':
      return runListProjects(input, context)
    case 'search_knowledge':
      return runSearchKnowledge(input, context)
    case 'save_lead':
      return runSaveLead(input, context)
    case 'suggest_replies':
      return runSuggestReplies(input, context)
  }
}

/**
 * Реплики для кнопок.
 *
 * Отбраковка и мелкий ремонт — в `suggestions.ts`; здесь только то, чего там
 * быть не может: названия каталога, по которым восстанавливается заглавная
 * буква в «Показать квартиры в школьном». Запрос лёгкий — семь строк на боевых
 * данных, — и делается он один раз за ход, на завершающем вызове инструмента.
 */
async function runSuggestReplies(input: Record<string, unknown>, context: ToolContext): Promise<ToolOutcome> {
  const options = pickSuggestions(input['options'], context.today ?? new Date(), await catalogNames(context.db))

  return {
    name: 'suggest_replies',
    // Модель не должна получить повод отвечать на этот результат словами:
    // её ход на нём и заканчивается.
    content: stringify({ accepted: options.length }),
    isError: false,
    apartments: [],
    lead: null,
    suggestions: options,
  }
}

/**
 * Названия, по которым узнаётся комплекс или район в надписи на кнопке.
 *
 * Берём и название ЖК, и район: «Показать квартиры в школьном» и «Другой
 * район, не подольск» — одна и та же ошибка. Выключенные ЖК сюда не попадают:
 * их нет в чате, и упомянуть их кнопка не может.
 */
async function catalogNames(db: Db): Promise<string[]> {
  const projects = await db.project.findMany({ where: { isActive: true }, select: { name: true, district: true } })
  const names: string[] = []
  for (const project of projects) {
    names.push(project.name)
    if (project.district !== null) names.push(project.district)
  }
  return names
}

async function runSearchApartments(input: Record<string, unknown>, context: ToolContext): Promise<ToolOutcome> {
  const params: ApartmentSearchParams = {}

  const rooms = toArray(input['rooms'])
    .map((value) => parseRooms(value))
    .filter((value): value is number => value !== null)
  if (rooms.length > 0) params.rooms = [...new Set(rooms)]

  assignDefined(params, 'priceMin', parsePrice(input['price_min']))
  assignDefined(params, 'priceMax', parsePrice(input['price_max']))
  assignDefined(params, 'areaMin', parseArea(input['area_min']))
  assignDefined(params, 'areaMax', parseArea(input['area_max']))
  assignDefined(params, 'floorMin', parseInteger(input['floor_min']))
  assignDefined(params, 'floorMax', parseInteger(input['floor_max']))
  assignDefined(params, 'district', normalizeText(input['district'], 120))
  assignDefined(params, 'metro', normalizeText(input['metro'], 120))
  assignDefined(params, 'finishing', normalizeFinishing(input['finishing']))
  assignDefined(params, 'deadlineBefore', parseDate(input['deadline_before']))
  assignDefined(params, 'limit', parseInteger(input['limit']))

  const projectIds = toArray(input['project_ids'])
    .map((value) => normalizeText(value, 60))
    .filter((value): value is string => value !== null)
  if (projectIds.length > 0) params.projectIds = projectIds

  const { total, apartments, empty } = await searchApartments(context.db, params)

  const payload: Record<string, unknown> = { total, shown: apartments.length, apartments: apartments.map(forModel) }
  if (empty) payload['nothing_found'] = describeEmpty(empty)

  // Чем показанные лоты похожи и чем отличаются — посчитанное, а не угаданное.
  // Без этого модель, чтобы пять почти одинаковых студий не выглядели копиями,
  // дописывает им отличия от себя. См. variety.ts.
  const variety = describeVariety(apartments)
  if (variety) {
    payload['how_they_differ'] = {
      hint: variety.hint,
      nearly_identical: variety.nearlyIdentical,
      same: variety.same,
      differs: variety.differs,
    }
  }

  return {
    name: 'search_apartments',
    content: stringify(payload),
    isError: false,
    apartments,
    lead: null,
    suggestions: [],
  }
}

/**
 * Карточка в том виде, в каком её читает модель.
 *
 * Ссылки на фотографии ей не нужны: показывает их виджет, а в ответе
 * инструмента десяток URL на каждый из пяти лотов — это сотни токенов ни за
 * что. Вместо списка уходит их число: «фотографий 12» модель сказать может,
 * а сами адреса ей ни к чему.
 *
 * У сданного дома вместо `deadline` уходит `handover` — словами. Дата ввода
 * никуда не делась, она лежит в базе и работает в фильтрах, но модели её
 * показывать нельзя: увидев «2023-12-31», она послушно пишет «сдача в декабре
 * 2023-го» — про дом, куда можно въехать сегодня, — и пытается посчитать,
 * сколько осталось ждать. Убрать дату надёжнее, чем просить её не называть.
 */
function forModel(card: ApartmentCard): Record<string, unknown> {
  const { photos, isReady, deadline, ...rest } = card
  const handover =
    isReady === true
      ? { ready: true, handover: 'дом построен и введён в эксплуатацию, ключи сразу' }
      : { ready: isReady, deadline }
  return { ...rest, ...handover, photoCount: photos.length }
}

/** Сколько локаций уходит в ответ инструмента: перечень нужен полный, но не бесконечный. */
const LOCATIONS_IN_RESULT = 20

/**
 * Ноль с объяснением.
 *
 * Пустая выдача сама по себе не говорит модели ничего, кроме «ноль», и она
 * достраивает смысл сама — обычно худшим образом: «в Химках двухкомнатных нет
 * вообще», когда их тридцать, просто не той площади. Поэтому рядом с нулём
 * едут цифры и готовая формулировка. Ключевое здесь — `hint`: модель повторяет
 * то, что видит, поэтому проще дать ей верную фразу целиком, чем надеяться,
 * что она соберёт её из полей сама.
 */
function describeEmpty(empty: EmptySearchFacts): Record<string, unknown> {
  return {
    hint: emptyHint(empty),
    place: empty.place,
    place_in_catalog: empty.placeKnown,
    apartments_in_place: empty.inPlace,
    rooms_in_place: empty.roomsInPlace.map((item) => ({
      rooms: item.rooms,
      count: item.count,
      price_min: item.priceMin,
    })),
    cheapest_in_place: cheapestInPlace(empty),
    cheapest_in_catalog: cheapestInCatalog(empty),
    requested_rooms: empty.rooms,
    requested_rooms_in_place: empty.inPlaceWithRooms,
    price_min: empty.priceMin,
    price_max: empty.priceMax,
    area_min: empty.areaMin,
    area_max: empty.areaMax,
    found_if_filter_removed: empty.relaxed,
    catalog_locations: toLocationList(empty.locations),
  }
}

/**
 * Названия локаций через запятую, без повторов.
 *
 * Одно и то же место может стоять в перечне дважды — в новостройках и в
 * коммерции это разные строки (см. `listCatalogLocations`). В готовой фразе
 * для модели такой повтор читается как ошибка: «Химки, Химки».
 */
function placeNames(locations: CatalogLocation[]): string {
  return [...new Set(locations.map((place) => place.name))].join(', ')
}

/** Перечень локаций в том виде, в каком его читает модель. */
function toLocationList(locations: CatalogLocation[]): Record<string, unknown>[] {
  return locations.slice(0, LOCATIONS_IN_RESULT).map((place) => ({
    name: place.name,
    // Направление рядом с локацией: одно и то же место в новостройках и в
    // коммерции — разные строки, и подменять одно другим нельзя.
    direction: categoryLabel(place.category),
    apartments: place.apartmentCount,
    rooms: place.rooms,
    price_min: place.priceMin,
    price_max: place.priceMax,
  }))
}

function cheapestInPlace(empty: EmptySearchFacts): number | null {
  const prices = empty.roomsInPlace.map((item) => item.priceMin)
  return prices.length === 0 ? null : Math.min(...prices)
}

function cheapestInCatalog(empty: EmptySearchFacts): number | null {
  const prices = empty.locations.map((place) => place.priceMin)
  return prices.length === 0 ? null : Math.min(...prices)
}

/** «студии от 4,4 млн ₽ (2 шт.), однокомнатные от 5,7 млн ₽ (56 шт.)» */
function roomsWithPrices(rooms: EmptySearchFacts['roomsInPlace']): string {
  if (rooms.length === 0) return 'нет данных о комнатности'
  return rooms.map((item) => `${roomsLabel(item.rooms)} от ${millions(item.priceMin)} (${item.count} шт.)`).join(', ')
}

function emptyHint(empty: EmptySearchFacts): string {
  const where = empty.place === null ? 'в каталоге' : `в локации «${empty.place}»`
  const sentences: string[] = []

  if (!empty.placeKnown) {
    const names = placeNames(empty.locations)
    sentences.push(
      `Локации «${empty.place ?? ''}» в каталоге нет — у агентства там нет ни одного объекта.`,
      `Скажи об этом прямо и назови те локации, которые есть: ${names}.`,
      'Другие города не предлагай: их у агентства нет.',
    )
    return sentences.join(' ')
  }

  if (empty.inPlace === 0) {
    sentences.push(`Активных квартир ${where} сейчас нет ни одной — это можно сказать без оговорок.`)
    sentences.push('Предложи альтернативу только из перечня catalog_locations.')
    return sentences.join(' ')
  }

  const asked = empty.rooms.length > 0 ? empty.rooms.map(roomsLabel).join(' и ') : null
  const askedGenitive = empty.rooms.map(roomsGenitive).join(' и ')
  const count = `${empty.inPlace} ${plural(empty.inPlace, 'квартира', 'квартиры', 'квартир')}`

  if (asked !== null && empty.inPlaceWithRooms > 0) {
    sentences.push(
      'Ноль — это ноль по всем условиям запроса сразу, а не отсутствие таких квартир.',
      `${capitalize(asked)} ${where} есть — ${empty.inPlaceWithRooms} ` +
        `${plural(empty.inPlaceWithRooms, 'квартира', 'квартиры', 'квартир')}, ` +
        `${priceRange(empty.priceMin, empty.priceMax)}, ${areaRange(empty.areaMin, empty.areaMax)}.`,
      `Написать, что ${askedGenitive} тут нет, — прямая ложь. Отсутствие формулируй только в рамках применённых ограничений: нет не таких квартир, а таких на этих условиях.`,
    )
  } else if (asked !== null) {
    sentences.push(
      `${capitalize(askedGenitive)} ${where} действительно нет совсем — это сказать можно.`,
      `Всего ${where} ${count}. Назови сразу, что есть, чтобы человек увидел, из чего выбирать.`,
    )
  } else {
    sentences.push(`Ноль дали условия запроса, а не пустой каталог: всего ${where} ${count}.`)
  }

  const useful = empty.relaxed.filter((item) => item.total > 0)
  if (useful.length > 0) {
    const parts = useful.map((item) => `без ограничения «${item.filter}» — ${item.total}`)
    sentences.push(`Сколько нашлось бы, если снять условия: ${parts.join(', ')}.`)
    sentences.push(
      'Повтори поиск без самого узкого условия прямо сейчас, в этом же ответе, и покажи найденное карточками. ' +
        'Разрешения не спрашивай: «показать?» вместо карточек — это ответ ни с чем.',
    )
  }

  // Цена «от» рядом с каждой комнатностью нужна для одного: не подсунуть
  // человеку с бюджетом до 4 млн студии, которые начинаются с 4,4 млн.
  if (empty.roomsInPlace.length > 0) {
    sentences.push(
      `Что есть ${where} по комнатностям, с ценой «от»: ${roomsWithPrices(empty.roomsInPlace)}. ` +
        'Это наличие вообще, без учёта бюджета, площади и отделки из запроса — не выдавай его за подходящее под них.',
    )
  }

  const floor = cheapestInPlace(empty)
  const catalogFloor = cheapestInCatalog(empty)
  if (floor !== null) {
    sentences.push(
      `Дешевле ${millions(floor)} ${where} нет ничего` +
        (catalogFloor !== null && catalogFloor < floor
          ? `, а во всём каталоге — дешевле ${millions(catalogFloor)}.`
          : ', и во всём каталоге тоже.') +
        ' Не обещай показать то, что дешевле: этого нет.',
    )
  }

  return sentences.join(' ')
}

async function runListProjects(input: Record<string, unknown>, context: ToolContext): Promise<ToolOutcome> {
  const params: ProjectFilterParams = {}
  assignDefined(params, 'name', normalizeText(input['name'], 200))
  assignDefined(params, 'district', normalizeText(input['district'], 120))
  assignDefined(params, 'metro', normalizeText(input['metro'], 120))
  assignDefined(params, 'priceMin', parsePrice(input['price_min']))
  assignDefined(params, 'priceMax', parsePrice(input['price_max']))
  assignDefined(params, 'deadlineBefore', parseDate(input['deadline_before']))
  assignDefined(params, 'category', parseProjectCategory(input['category']))

  const projects = await listProjects(context.db, params)

  const payload: Record<string, unknown> = {
    found: projects.length,
    projects: projects.map((project) => ({ ...project, direction: categoryLabel(project.category) })),
  }
  // Пустой список ЖК модель читает так же неверно, как пустую подборку, — и по
  // тому же поводу зовёт человека в соседний город из общих знаний. Перечень
  // локаций закрывает и этот путь.
  if (projects.length === 0) {
    const locations = await listCatalogLocations(context.db)
    payload['nothing_found'] = {
      hint:
        locations.length === 0
          ? 'Каталог пуст: предлагать нечего.'
          : `Ни один ЖК не подошёл. Локации каталога, и других у агентства нет: ${placeNames(locations)}. Города вне этого перечня не называй.`,
      catalog_locations: toLocationList(locations),
    }
  }

  return {
    name: 'list_projects',
    content: stringify(payload),
    isError: false,
    apartments: [],
    lead: null,
    suggestions: [],
  }
}

async function runSearchKnowledge(input: Record<string, unknown>, context: ToolContext): Promise<ToolOutcome> {
  const query = normalizeText(input['query'], 500)
  if (query === null) {
    return failure('search_knowledge', 'Параметр query пустой. Сформулируй запрос словами и повтори вызов.')
  }

  const projectId = await resolveKnowledgeProject(context.db, normalizeText(input['project_id'], 120))
  const hits = await searchKnowledge(context.db, {
    query,
    projectId,
    limit: KNOWLEDGE_SEARCH_LIMIT,
  })

  const fragments = hits.map((hit) => ({
    document: hit.documentTitle,
    project: hit.projectName,
    content: hit.content,
  }))

  return {
    name: 'search_knowledge',
    // `project_id` возвращается разрешённым: модель кладёт в него название ЖК,
    // а кнопке перехода на комплекс нужен идентификатор — см. projects.ts.
    content: stringify({ found: fragments.length, fragments, project_id: projectId }),
    isError: false,
    apartments: [],
    lead: null,
    suggestions: [],
  }
}

/**
 * `project_id` для базы знаний: идентификатор, название или ничего.
 *
 * Модель регулярно кладёт в этот параметр название ЖК — «Космос» вместо
 * `cms3gz…`. Фильтр по несуществующему идентификатору отсекает все фрагменты,
 * привязанные к комплексам, поиск возвращает пустоту, а дальше начинается
 * ровно то, против чего написан тикет 17: условий не нашлось — модель берёт
 * ставку из головы. Поэтому название разрешается в идентификатор, а совсем
 * непонятное значение просто снимает фильтр: искать по всей базе знаний
 * безопаснее, чем не искать нигде.
 */
async function resolveKnowledgeProject(db: Db, value: string | null): Promise<string | null> {
  if (value === null) return null

  const byId = await db.project.findUnique({ where: { id: value }, select: { id: true } })
  if (byId) return byId.id

  const byName = await db.project.findFirst({
    where: { OR: [{ slug: value }, { name: { contains: value, mode: 'insensitive' } }] },
    select: { id: true },
    orderBy: { name: 'asc' },
  })
  return byName?.id ?? null
}

async function runSaveLead(input: Record<string, unknown>, context: ToolContext): Promise<ToolOutcome> {
  const validation = validateLead({ name: input['name'], phone: input['phone'], comment: input['comment'] })
  if (!validation.ok) return failure('save_lead', validation.error)

  const handler = context.saveLead ?? saveLeadToDatabase
  const lead = await handler(validation.value, { db: context.db, conversationId: context.conversationId })

  return {
    name: 'save_lead',
    content: stringify({ saved: true, lead_id: lead.id, name: lead.name, phone: lead.phone }),
    isError: false,
    apartments: [],
    lead,
    suggestions: [],
  }
}

function failure(name: string, error: string): ToolOutcome {
  return { name, content: stringify({ error }), isError: true, apartments: [], lead: null, suggestions: [] }
}

function stringify(value: unknown): string {
  return JSON.stringify(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  // Модель иногда присылает аргументы строкой с JSON внутри.
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      /* не JSON — считаем, что параметров нет */
    }
  }
  return {}
}

/** Одиночное значение приводится к списку: `rooms: 2` — это `[2]`. */
function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null || value === '') return []
  return [value]
}

function assignDefined<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | null): void {
  if (value !== null) target[key] = value
}
