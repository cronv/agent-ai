import type { Prisma } from '@prisma/client'

import type { Db } from '../../db/prisma.js'

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

  if (params.district) and.push({ project: { district: { contains: params.district, mode: 'insensitive' } } })
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

export async function searchApartments(db: Db, params: ApartmentSearchParams): Promise<ApartmentSearchResult> {
  const where = buildApartmentWhere(params)
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

  return { total, apartments: rows.map(toCard) }
}

export async function listProjects(db: Db, params: ProjectFilterParams): Promise<ProjectSummary[]> {
  const projectWhere: Prisma.ProjectWhereInput = { isActive: true }
  if (params.district) projectWhere.district = { contains: params.district, mode: 'insensitive' }
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
    deadline: toDateString(row.deadline),
    planImageUrl: row.planImageUrl,
    url: row.url,
  }
}

function toDateString(date: Date | null): string | null {
  return date === null ? null : date.toISOString().slice(0, 10)
}
