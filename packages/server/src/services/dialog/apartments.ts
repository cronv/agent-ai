import type { Prisma } from '@prisma/client'

import type { Db } from '../../db/prisma.js'
import { findProjectsByPlace } from './places.js'

/**
 * Запросы к каталогу, которыми пользуется модель.
 *
 *   const found = await searchApartments(db, { rooms: [2], priceMax: 18_000_000 })
 *   const projects = await listProjects(db, { district: 'Приморский' })
 *
 * Функции живут отдельно от инструментов (`tools.ts`) намеренно: инструмент —
 * это схема и разбор того, что прислала модель, а здесь только доступ к данным.
 * Так подбор можно проверять тестами без всякой модели.
 *
 * Правило видимости одно на оба запроса: показываем активные лоты активных ЖК.
 * Лот без привязки к ЖК (в фиде не было названия) тоже виден — иначе часть
 * каталога молча исчезла бы из выдачи.
 *
 * Район — единственный фильтр, который не превращается в условие SQL напрямую:
 * человек называет место как угодно («Домодедово», «Домодедовский городской
 * округ»), поэтому оно сначала переводится в список ЖК триграммным поиском —
 * см. places.ts.
 */

/** Сколько квартир уходит модели по умолчанию. Больше — уже не подборка, а список. */
export const APARTMENT_SEARCH_LIMIT = 5

/** Потолок на случай, если модель попросит больше. */
export const APARTMENT_SEARCH_MAX_LIMIT = 20

/** Квартира в том виде, в каком её рисует виджет и получает модель. */
export interface ApartmentCard {
  id: string
  projectId: string | null
  projectName: string | null
  developer: string | null
  district: string | null
  metro: string | null
  metroDistanceMin: number | null
  rooms: number | null
  area: number | null
  livingArea: number | null
  kitchenArea: number | null
  floor: number | null
  floorsTotal: number | null
  price: number
  pricePerM2: number | null
  building: string | null
  section: string | null
  finishing: string | null
  /** «лоджия», «нет», «больше 2» — как это назвала выгрузка. */
  balcony: string | null
  /** «во двор», «во двор и на улицу». */
  windowView: string | null
  /** «совмещенный», «раздельный», «более 2». */
  bathroom: string | null
  /** Евро-планировка: кухня-гостиная вместо отдельной кухни. */
  euroPlan: boolean | null
  /** Срок сдачи в формате `YYYY-MM-DD` или `null`. */
  deadline: string | null
  planImageUrl: string | null
  url: string | null
}

export interface ApartmentSearchParams {
  /** Комнатность; 0 — студия. Пустой список означает «без фильтра». */
  rooms?: number[] | undefined
  priceMin?: number | undefined
  priceMax?: number | undefined
  areaMin?: number | undefined
  areaMax?: number | undefined
  floorMin?: number | undefined
  floorMax?: number | undefined
  projectIds?: string[] | undefined
  district?: string | undefined
  metro?: string | undefined
  /** Ключи не позже этой даты. */
  deadlineBefore?: Date | undefined
  /** Часть слова: «чистов», «без отделки». */
  finishing?: string | undefined
  limit?: number | undefined
}

export interface ApartmentSearchResult {
  /** Сколько всего подходит под фильтры — модель говорит «нашлось 42, показываю 5». */
  total: number
  apartments: ApartmentCard[]
  /** Заполнено только при `total === 0`: чем именно вызван ноль. */
  empty?: EmptySearchFacts
}

/**
 * Локация каталога — то, что модели разрешено называть географией агентства.
 *
 * Собирается из базы: появится восьмой ЖК в новом городе — город появится
 * и здесь, без правок кода.
 */
export interface CatalogLocation {
  /** Место так, как оно записано в каталоге: «Химки», «Пушкинский». */
  name: string
  /** Активных лотов в этом месте. */
  apartmentCount: number
  /**
   * Что есть по комнатностям: сколько и от какой цены, по возрастанию.
   *
   * Одних названий комнатностей мало. Увидев «в Домодедово студии от 4,7 млн»
   * и не увидев цен по однушкам, модель заявляет, что в Домодедово однушки
   * дешевле подольских, — хотя они там на миллион дороже. Цена «от» по каждой
   * комнатности убирает и эту догадку.
   */
  rooms: PlaceRooms[]
  priceMin: number
  priceMax: number
}

/**
 * Почему поиск вернул ноль.
 *
 * Ноль сам по себе неотличим от «такого товара нет вообще», и модель читает
 * его именно так: поискала двухкомнатные в Химках площадью до 40 м², получила
 * пустоту и объявила, что двухкомнатных в Химках нет. Их тридцать. Поэтому
 * вместе с нулём уходят цифры, которых модели не хватало, чтобы ответить
 * честно: сколько лотов в этой локации, сколько среди них нужной комнатности,
 * какие у них цены и площади и сколько нашлось бы, сними она своё же
 * ограничение.
 */
export interface EmptySearchFacts {
  /** Место из запроса, дословно. `null` — по месту не искали. */
  place: string | null
  /** Нашлось ли это место в каталоге. `false` — человек назвал город, которого у агентства нет. */
  placeKnown: boolean
  /** Весь географический охват агентства. */
  locations: CatalogLocation[]
  /** Активных лотов в этом месте; без фильтра по месту — во всём каталоге. */
  inPlace: number
  /**
   * Что есть в этом месте по комнатностям — с ценой от.
   *
   * Одного списка комнатностей мало: увидев «в Подольске есть студии», модель
   * тут же предлагает их человеку с бюджетом до 4 млн, хотя самая дешёвая
   * студия там стоит 4,4 млн. Цена «от» в той же строке эту подмену закрывает.
   */
  roomsInPlace: PlaceRooms[]
  /** Комнатность из запроса. Пусто — не спрашивали. */
  rooms: number[]
  /** Лотов нужной комнатности в этом месте — без ограничений по площади, цене, этажу, отделке и сроку. */
  inPlaceWithRooms: number
  /** Вилка цен и площадей по этим лотам — из чего человеку реально выбирать. */
  priceMin: number | null
  priceMax: number | null
  areaMin: number | null
  areaMax: number | null
  /** Сколько нашлось бы, если снять это ограничение, оставив остальные. */
  relaxed: RelaxedCount[]
}

export interface RelaxedCount {
  /** Ограничение по-русски: «площадь», «цена», «площадь и цена». */
  filter: string
  total: number
}

/** Комнатность в наличии и с какой цены она начинается. */
export interface PlaceRooms {
  /** 0 — студия. */
  rooms: number
  count: number
  priceMin: number
}

export interface ProjectFilterParams {
  district?: string | undefined
  metro?: string | undefined
  priceMin?: number | undefined
  priceMax?: number | undefined
  deadlineBefore?: Date | undefined
}

/** ЖК с диапазоном цен и количеством свободных лотов. */
export interface ProjectSummary {
  id: string
  name: string
  developer: string | null
  district: string | null
  metro: string | null
  metroDistanceMin: number | null
  deadline: string | null
  finishing: string | null
  url: string | null
  /** Сколько активных лотов подходит под фильтры. */
  apartmentCount: number
  priceMin: number | null
  priceMax: number | null
  /** Какие комнатности есть в наличии, по возрастанию. 0 — студия. */
  roomsAvailable: number[]
}

const CARD_INCLUDE = {
  project: {
    select: {
      id: true,
      name: true,
      developer: true,
      district: true,
      metro: true,
      metroDistanceMin: true,
    },
  },
} satisfies Prisma.ApartmentInclude

type ApartmentRow = Prisma.ApartmentGetPayload<{ include: typeof CARD_INCLUDE }>

/** Активные лоты активных ЖК. Лот без ЖК не прячем — он просто не привязан. */
function visibleApartments(): Prisma.ApartmentWhereInput {
  return {
    isActive: true,
    OR: [{ projectId: null }, { project: { isActive: true } }],
  }
}

function buildApartmentWhere(params: ApartmentSearchParams | ProjectFilterParams): Prisma.ApartmentWhereInput {
  const and: Prisma.ApartmentWhereInput[] = [visibleApartments()]
  const search = params as ApartmentSearchParams

  if (search.rooms && search.rooms.length > 0) and.push({ rooms: { in: search.rooms } })

  if (params.priceMin !== undefined || params.priceMax !== undefined) {
    const price: Prisma.FloatFilter = {}
    if (params.priceMin !== undefined) price.gte = params.priceMin
    if (params.priceMax !== undefined) price.lte = params.priceMax
    and.push({ price })
  }

  if (search.areaMin !== undefined || search.areaMax !== undefined) {
    const area: Prisma.FloatNullableFilter = {}
    if (search.areaMin !== undefined) area.gte = search.areaMin
    if (search.areaMax !== undefined) area.lte = search.areaMax
    and.push({ area })
  }

  if (search.floorMin !== undefined || search.floorMax !== undefined) {
    const floor: Prisma.IntNullableFilter = {}
    if (search.floorMin !== undefined) floor.gte = search.floorMin
    if (search.floorMax !== undefined) floor.lte = search.floorMax
    and.push({ floor })
  }

  if (search.projectIds && search.projectIds.length > 0) and.push({ projectId: { in: search.projectIds } })

  // Района здесь нет намеренно: он уже превращён в `projectIds` — см. narrowByPlace.
  if (params.metro) and.push({ project: { metro: { contains: params.metro, mode: 'insensitive' } } })
  if (search.finishing) and.push({ finishing: { contains: search.finishing, mode: 'insensitive' } })

  // Срок сдачи бывает задан у лота, бывает только у ЖК — учитываем оба места,
  // иначе «сдача до 2027» выкинет весь корпус, у которого дата стоит на ЖК.
  if (params.deadlineBefore) {
    and.push({
      OR: [
        { deadline: { lte: params.deadlineBefore } },
        { deadline: null, project: { deadline: { lte: params.deadlineBefore } } },
      ],
    })
  }

  return { AND: and }
}

/**
 * Заменяет название места списком ЖК.
 *
 * `null` означает «в каталоге нет ни одного подходящего ЖК» — вызывающий
 * возвращает пустую подборку, а не ищет по всей базе без фильтра.
 */
async function narrowByPlace(db: Db, params: ApartmentSearchParams): Promise<ApartmentSearchParams | null> {
  if (!params.district) return params

  const found = await findProjectsByPlace(db, params.district)
  if (found.length === 0) return null

  // Если ЖК заданы и списком, и районом — берём пересечение: район сужает
  // выбор, а не расширяет его.
  const projectIds = params.projectIds ? params.projectIds.filter((id) => found.includes(id)) : found
  if (projectIds.length === 0) return null

  return { ...params, district: undefined, projectIds }
}

export async function searchApartments(db: Db, params: ApartmentSearchParams): Promise<ApartmentSearchResult> {
  const narrowed = await narrowByPlace(db, params)
  if (narrowed === null) {
    return { total: 0, apartments: [], empty: await explainEmptySearch(db, params, null) }
  }

  const where = buildApartmentWhere(narrowed)
  const limit = clampLimit(params.limit)

  const [total, rows] = await Promise.all([
    db.apartment.count({ where }),
    db.apartment.findMany({
      where,
      include: CARD_INCLUDE,
      orderBy: [{ price: 'asc' }, { area: 'asc' }, { id: 'asc' }],
      take: limit,
    }),
  ])

  if (total === 0) {
    return { total, apartments: [], empty: await explainEmptySearch(db, params, narrowed) }
  }

  return { total, apartments: rows.map(toCard) }
}

/** Место без района в каталоге. Такие лоты всё равно находятся поиском, поэтому и в перечне они видны. */
const PLACELESS = 'Без указания района'

/**
 * Весь географический охват каталога: локация, число лотов, комнатности, цены.
 *
 * Это опора против выдуманных городов. Пока модель не видит списка, она берёт
 * Мытищи и Долгопрудный из общих знаний о Подмосковье и подаёт их как
 * ассортимент агентства; со списком выдумывать нечего.
 */
export async function listCatalogLocations(db: Db): Promise<CatalogLocation[]> {
  const [projects, grouped] = await Promise.all([
    db.project.findMany({ where: { isActive: true }, select: { id: true, name: true, district: true } }),
    db.apartment.groupBy({
      by: ['projectId', 'rooms'],
      where: visibleApartments(),
      _count: { _all: true },
      _min: { price: true },
      _max: { price: true },
    }),
  ])

  interface PlaceStats {
    count: number
    min: number | null
    max: number | null
    rooms: Map<number, PlaceRooms>
  }

  const placeOf = new Map(projects.map((project) => [project.id, placeOfProject(project)]))
  const places = new Map<string, PlaceStats>()

  for (const row of grouped) {
    const name = row.projectId === null ? PLACELESS : placeOf.get(row.projectId)
    if (name === undefined) continue
    const entry = places.get(name) ?? { count: 0, min: null, max: null, rooms: new Map<number, PlaceRooms>() }
    entry.count += row._count._all
    if (row._min.price !== null) entry.min = entry.min === null ? row._min.price : Math.min(entry.min, row._min.price)
    if (row._max.price !== null) entry.max = entry.max === null ? row._max.price : Math.max(entry.max, row._max.price)
    if (row.rooms !== null) {
      // Одна и та же комнатность приходит из нескольких ЖК локации — складываем.
      const seen = entry.rooms.get(row.rooms)
      const priceMin = row._min.price ?? 0
      entry.rooms.set(row.rooms, {
        rooms: row.rooms,
        count: (seen?.count ?? 0) + row._count._all,
        priceMin: seen === undefined ? priceMin : Math.min(seen.priceMin, priceMin),
      })
    }
    places.set(name, entry)
  }

  return [...places]
    .map(([name, entry]) => ({
      name,
      apartmentCount: entry.count,
      rooms: [...entry.rooms.values()].sort((a, b) => a.rooms - b.rooms),
      priceMin: entry.min ?? 0,
      priceMax: entry.max ?? 0,
    }))
    .sort((a, b) => b.apartmentCount - a.apartmentCount || a.name.localeCompare(b.name, 'ru'))
}

/** Район, а если он не заполнен — название ЖК: место должно быть хоть как-то названо. */
function placeOfProject(project: { name: string; district: string | null }): string {
  const district = project.district?.trim()
  return district === undefined || district === '' ? project.name : district
}

/**
 * Ограничения, которые модель добавляет от себя чаще всего и которые чаще
 * всего и обнуляют выдачу. Для каждого считаем, сколько нашлось бы без него.
 */
const RELAXABLE: { label: string; keys: (keyof ApartmentSearchParams)[] }[] = [
  { label: 'площадь', keys: ['areaMin', 'areaMax'] },
  { label: 'цена', keys: ['priceMin', 'priceMax'] },
  { label: 'этаж', keys: ['floorMin', 'floorMax'] },
  { label: 'отделка', keys: ['finishing'] },
  { label: 'срок сдачи', keys: ['deadlineBefore'] },
]

async function explainEmptySearch(
  db: Db,
  params: ApartmentSearchParams,
  narrowed: ApartmentSearchParams | null,
): Promise<EmptySearchFacts> {
  const locations = await listCatalogLocations(db)
  const rooms = params.rooms ?? []
  const place = params.district ?? null

  // Место названо, но в каталоге его нет — считать больше нечего, вся правда
  // в перечне локаций.
  if (narrowed === null) {
    return {
      place,
      placeKnown: false,
      locations,
      inPlace: 0,
      roomsInPlace: [],
      rooms,
      inPlaceWithRooms: 0,
      priceMin: null,
      priceMax: null,
      areaMin: null,
      areaMax: null,
      relaxed: [],
    }
  }

  // «В этом месте» — это только география: ЖК, найденные по району, и метро.
  // Всё остальное снято намеренно: нам нужен знаменатель, а не ещё один ноль.
  const placeOnly: ApartmentSearchParams = {}
  if (narrowed.projectIds) placeOnly.projectIds = narrowed.projectIds
  if (narrowed.metro) placeOnly.metro = narrowed.metro

  const withRooms = rooms.length > 0 ? { ...placeOnly, rooms } : placeOnly

  const [inPlace, roomRows, stats, relaxed] = await Promise.all([
    db.apartment.count({ where: buildApartmentWhere(placeOnly) }),
    db.apartment.groupBy({
      by: ['rooms'],
      where: buildApartmentWhere(placeOnly),
      _count: { _all: true },
      _min: { price: true },
    }),
    db.apartment.aggregate({
      where: buildApartmentWhere(withRooms),
      _count: { _all: true },
      _min: { price: true, area: true },
      _max: { price: true, area: true },
    }),
    countRelaxed(db, narrowed),
  ])

  return {
    place,
    placeKnown: true,
    locations,
    inPlace,
    roomsInPlace: roomRows
      .filter((row): row is typeof row & { rooms: number } => row.rooms !== null)
      .map((row) => ({ rooms: row.rooms, count: row._count._all, priceMin: row._min.price ?? 0 }))
      .sort((a, b) => a.rooms - b.rooms),
    rooms,
    inPlaceWithRooms: stats._count._all,
    priceMin: stats._min.price,
    priceMax: stats._max.price,
    areaMin: stats._min.area,
    areaMax: stats._max.area,
    relaxed,
  }
}

/**
 * Сколько нашлось бы, сними мы по одному ограничению — и сколько, сними их все.
 * Считается только на пустой выдаче, поэтому лишних запросов в обычном подборе нет.
 */
async function countRelaxed(db: Db, narrowed: ApartmentSearchParams): Promise<RelaxedCount[]> {
  const applied = RELAXABLE.filter((group) => group.keys.some((key) => narrowed[key] !== undefined))
  if (applied.length === 0) return []

  const variants = applied.map((group) => ({ filter: group.label, keys: group.keys }))
  if (applied.length > 1) {
    variants.push({
      filter: applied.map((group) => group.label).join(' и '),
      keys: applied.flatMap((group) => group.keys),
    })
  }

  return Promise.all(
    variants.map(async (variant) => ({
      filter: variant.filter,
      total: await db.apartment.count({ where: buildApartmentWhere(omit(narrowed, variant.keys)) }),
    })),
  )
}

function omit(params: ApartmentSearchParams, keys: (keyof ApartmentSearchParams)[]): ApartmentSearchParams {
  const copy = { ...params }
  for (const key of keys) delete copy[key]
  return copy
}

export async function listProjects(db: Db, params: ProjectFilterParams): Promise<ProjectSummary[]> {
  const projectWhere: Prisma.ProjectWhereInput = { isActive: true }
  if (params.district) {
    const found = await findProjectsByPlace(db, params.district)
    if (found.length === 0) return []
    projectWhere.id = { in: found }
  }
  if (params.metro) projectWhere.metro = { contains: params.metro, mode: 'insensitive' }

  const projects = await db.project.findMany({ where: projectWhere, orderBy: { name: 'asc' } })
  if (projects.length === 0) return []

  const apartmentWhere = buildApartmentWhere({ ...params, projectIds: projects.map((project) => project.id) })
  const grouped = await db.apartment.groupBy({
    by: ['projectId', 'rooms'],
    where: apartmentWhere,
    _count: { _all: true },
    _min: { price: true },
    _max: { price: true },
  })

  const stats = new Map<string, { count: number; min: number | null; max: number | null; rooms: Set<number> }>()
  for (const row of grouped) {
    if (row.projectId === null) continue
    const entry = stats.get(row.projectId) ?? { count: 0, min: null, max: null, rooms: new Set<number>() }
    entry.count += row._count._all
    if (row._min.price !== null) entry.min = entry.min === null ? row._min.price : Math.min(entry.min, row._min.price)
    if (row._max.price !== null) entry.max = entry.max === null ? row._max.price : Math.max(entry.max, row._max.price)
    if (row.rooms !== null) entry.rooms.add(row.rooms)
    stats.set(row.projectId, entry)
  }

  // ЖК без подходящих лотов не показываем: предлагать проект, в котором сейчас
  // нечего купить, — это ложное обещание.
  return projects
    .filter((project) => (stats.get(project.id)?.count ?? 0) > 0)
    .map((project) => {
      const entry = stats.get(project.id)
      return {
        id: project.id,
        name: project.name,
        developer: project.developer,
        district: project.district,
        metro: project.metro,
        metroDistanceMin: project.metroDistanceMin,
        deadline: toDateString(project.deadline),
        finishing: project.finishing,
        url: project.url,
        apartmentCount: entry?.count ?? 0,
        priceMin: entry?.min ?? null,
        priceMax: entry?.max ?? null,
        roomsAvailable: [...(entry?.rooms ?? [])].sort((a, b) => a - b),
      }
    })
}

function clampLimit(limit: number | undefined): number {
  if (limit === undefined || !Number.isFinite(limit)) return APARTMENT_SEARCH_LIMIT
  return Math.min(Math.max(Math.round(limit), 1), APARTMENT_SEARCH_MAX_LIMIT)
}

function toCard(row: ApartmentRow): ApartmentCard {
  return {
    id: row.id,
    projectId: row.projectId,
    projectName: row.project?.name ?? null,
    developer: row.project?.developer ?? null,
    district: row.project?.district ?? null,
    metro: row.project?.metro ?? null,
    metroDistanceMin: row.project?.metroDistanceMin ?? null,
    rooms: row.rooms,
    area: row.area,
    livingArea: row.livingArea,
    kitchenArea: row.kitchenArea,
    floor: row.floor,
    floorsTotal: row.floorsTotal,
    price: row.price,
    pricePerM2: row.pricePerM2,
    building: row.building,
    section: row.section,
    finishing: row.finishing,
    balcony: row.balcony,
    windowView: row.windowView,
    bathroom: row.bathroom,
    euroPlan: row.euroPlan,
    deadline: toDateString(row.deadline),
    planImageUrl: row.planImageUrl,
    url: row.url,
  }
}

function toDateString(date: Date | null): string | null {
  return date === null ? null : date.toISOString().slice(0, 10)
}
