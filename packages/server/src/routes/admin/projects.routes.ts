import { Prisma, ProjectCategory } from '@prisma/client'
import type { Project } from '@prisma/client'
import type { FastifyPluginAsync, FastifyReply } from 'fastify'

import { PROJECT_CATEGORIES, categoryLabel } from '../../lib/categories.js'
import { uniqueSlug } from '../../lib/slug.js'

/**
 * Жилые комплексы в админке.
 *
 *   GET    /api/admin/projects                 список с числом квартир и вилкой цен
 *   GET    /api/admin/projects/:id             карточка ЖК
 *   PATCH  /api/admin/projects/:id             править поля (PUT — синоним)
 *   POST   /api/admin/projects/:id/active      переключатель «показывать в чате»
 *   DELETE /api/admin/projects/:id             удалить ЖК вместе с его квартирами
 *   GET    /api/admin/projects/:id/apartments  квартиры ЖК с фильтрами
 *
 * ЖК заводит импорт фида по названию из выгрузки — руками они не создаются.
 * Админка дополняет карточку тем, чего в фиде нет: район, метро, срок сдачи,
 * отделка, описание. Поэтому здесь нет POST на создание.
 *
 * ── Про удаление ───────────────────────────────────────────────────────────
 *
 * Удаление — не замена выключателю, а уборка мусора: ошибочно созданной записи,
 * дубля из кривой выгрузки, комплекса, которого у агентства никогда не было.
 * Выключенный ЖК (`isActive = false`) остаётся штатным способом «убрать из
 * чата, ничего не теряя», и никуда не девается.
 *
 * Квартиры уходят вместе с ЖК. Оставить их — значит получить лоты без привязки,
 * которые поиск по-прежнему показывает (см. `visibleApartments` в
 * `services/dialog/apartments.ts`): ассистент предлагал бы квартиры комплекса,
 * который администратор только что удалил, и не мог бы сказать, что это за дом.
 * Сохранённые переписки и лиды не страдают: карточки в них лежат снимком в Json,
 * внешних ключей на квартиры там нет.
 *
 * Документы базы знаний, привязанные к ЖК, остаются: это материал агентства,
 * загруженный руками, и удалять его заодно нельзя. Они просто теряют привязку
 * (`onDelete: SetNull`) и продолжают отвечать как общие.
 *
 * Живой фид заведёт удалённый ЖК заново на ближайшей синхронизации — по
 * названию из выгрузки. Поэтому маршрут отказывает: 409 со списком фидов,
 * поимённо и с числом ЖК в каждом. `?force=true` означает «администратор про
 * фиды знает»: админка ставит его только после того, как показала это окном
 * подтверждения, а не заранее. Данные у сервера свежее клиентских, и отказ
 * тому, кто фидов не видел, — не формальность: за минуту до удаления фид мог
 * включить кто-то другой.
 *
 * Всё под `/api/admin/` уже закрыто хуком из `plugins/auth.ts`.
 */

interface ProjectParams {
  id: string
}

/** Направления с подписями — справочник для вкладок и для поля в карточке. */
const CATEGORY_OPTIONS = PROJECT_CATEGORIES.map((category) => ({
  value: category,
  label: categoryLabel(category),
}))

/** Фид, из которого пришли квартиры ЖК: по нему понятно, воскреснет ли он. */
export interface ProjectFeedRef {
  id: string
  name: string
  isActive: boolean
  /**
   * Сколько ЖК всего кормит этот фид.
   *
   * Больше одного — выключать его ради удаления одной записи нельзя: встанет
   * обновление цен и остатков по всему остальному каталогу. Админка на это
   * число и смотрит, предлагать ли выключение.
   */
  projectCount: number
}

/** Изменяемые поля карточки. Всё, кроме названия, может быть пустым. */
interface ProjectBody {
  name?: string
  developer?: string | null
  district?: string | null
  metro?: string | null
  metroDistanceMin?: number | null
  address?: string | null
  deadline?: string | null
  finishing?: string | null
  description?: string | null
  url?: string | null
  imageUrl?: string | null
  category?: ProjectCategory
  isActive?: boolean
}

const projectBodyProperties = {
  name: { type: 'string', minLength: 1, maxLength: 200 },
  developer: { type: ['string', 'null'], maxLength: 200 },
  district: { type: ['string', 'null'], maxLength: 200 },
  metro: { type: ['string', 'null'], maxLength: 200 },
  metroDistanceMin: { type: ['integer', 'null'], minimum: 0, maximum: 600 },
  address: { type: ['string', 'null'], maxLength: 500 },
  deadline: { type: ['string', 'null'], maxLength: 40 },
  finishing: { type: ['string', 'null'], maxLength: 200 },
  description: { type: ['string', 'null'], maxLength: 20000 },
  url: { type: ['string', 'null'], maxLength: 2000 },
  imageUrl: { type: ['string', 'null'], maxLength: 2000 },
  category: { type: 'string', enum: [...PROJECT_CATEGORIES] },
  isActive: { type: 'boolean' },
} as const

const updateSchema = {
  body: {
    type: 'object',
    minProperties: 1,
    properties: projectBodyProperties,
    additionalProperties: false,
  },
} as const

const activeSchema = {
  body: {
    type: 'object',
    required: ['isActive'],
    properties: { isActive: { type: 'boolean' } },
    additionalProperties: false,
  },
} as const

/** Числа по квартирам ЖК: сколько их и в какую цену. */
export interface ProjectStats {
  apartments: { active: number; total: number }
  /** Вилка цен по активным квартирам; если активных нет — `null`. */
  price: { min: number; max: number } | null
  /**
   * Фиды, из которых пришли квартиры этого ЖК. Нужны удалению: пока хоть один
   * из них включён, удалённый ЖК вернётся на ближайшей синхронизации.
   */
  feeds: ProjectFeedRef[]
}

/** ЖК в том виде, в каком его показывает админка. */
export interface ProjectView extends ProjectStats {
  id: string
  name: string
  slug: string
  developer: string | null
  district: string | null
  metro: string | null
  metroDistanceMin: number | null
  address: string | null
  deadline: Date | null
  finishing: string | null
  description: string | null
  url: string | null
  imageUrl: string | null
  category: ProjectCategory
  /** Подпись направления — чтобы админка не держала второй словарь. */
  categoryLabel: string
  isActive: boolean
  createdAt: Date
  updatedAt: Date
}

const NO_STATS: ProjectStats = { apartments: { active: 0, total: 0 }, price: null, feeds: [] }

function toProjectView(project: Project, stats: ProjectStats = NO_STATS): ProjectView {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    developer: project.developer,
    district: project.district,
    metro: project.metro,
    metroDistanceMin: project.metroDistanceMin,
    address: project.address,
    deadline: project.deadline,
    finishing: project.finishing,
    description: project.description,
    url: project.url,
    imageUrl: project.imageUrl,
    category: project.category,
    categoryLabel: categoryLabel(project.category),
    isActive: project.isActive,
    createdAt: project.createdAt,
    updatedAt: project.updatedAt,
    ...stats,
  }
}

/** Ошибка заполнения формы — с человеческим текстом для админки. */
class ProjectInputError extends Error {}

function validationFailed(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: 'validation', message })
}

function notFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({ error: 'not_found', message: 'Жилой комплекс не найден' })
}

/** Пустая строка в форме означает «поле не заполнено», а не «пустой текст». */
function optionalText(value: string | null | undefined): string | null | undefined {
  if (value === undefined) return undefined
  if (value === null) return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}

function optionalUrl(value: string | null | undefined, label: string): string | null | undefined {
  const text = optionalText(value)
  if (text === undefined || text === null) return text
  let parsed: URL
  try {
    parsed = new URL(text)
  } catch {
    throw new ProjectInputError(`${label} должна быть полной ссылкой, например https://example.ru/zhk`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new ProjectInputError(`${label} должна начинаться с http:// или https://`)
  }
  return text
}

/**
 * Срок сдачи. Из формы приходит `2027-06-30` или `2027-06`; хранится как дата,
 * поэтому неполный месяц дополняется первым числом.
 */
function optionalDeadline(value: string | null | undefined): Date | null | undefined {
  const text = optionalText(value)
  if (text === undefined || text === null) return text
  const normalized = /^\d{4}-\d{2}$/.test(text) ? `${text}-01` : text
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/.test(normalized) ? `${normalized}T00:00:00.000Z` : normalized)
  if (Number.isNaN(date.getTime())) {
    throw new ProjectInputError(`Срок сдачи «${text}» не похож на дату. Формат: 2027-06-30`)
  }
  return date
}

function buildProjectData(body: ProjectBody): Prisma.ProjectUncheckedUpdateInput {
  const data: Prisma.ProjectUncheckedUpdateInput = {}

  if (body.name !== undefined) {
    const name = body.name.trim()
    if (name === '') throw new ProjectInputError('Название ЖК не может быть пустым')
    data.name = name
  }

  const developer = optionalText(body.developer)
  if (developer !== undefined) data.developer = developer
  const district = optionalText(body.district)
  if (district !== undefined) data.district = district
  const metro = optionalText(body.metro)
  if (metro !== undefined) data.metro = metro
  const address = optionalText(body.address)
  if (address !== undefined) data.address = address
  const finishing = optionalText(body.finishing)
  if (finishing !== undefined) data.finishing = finishing
  const description = optionalText(body.description)
  if (description !== undefined) data.description = description

  const url = optionalUrl(body.url, 'Ссылка на ЖК')
  if (url !== undefined) data.url = url
  const imageUrl = optionalUrl(body.imageUrl, 'Ссылка на картинку')
  if (imageUrl !== undefined) data.imageUrl = imageUrl

  const deadline = optionalDeadline(body.deadline)
  if (deadline !== undefined) data.deadline = deadline

  if (body.metroDistanceMin !== undefined) data.metroDistanceMin = body.metroDistanceMin
  if (body.category !== undefined) data.category = body.category
  if (body.isActive !== undefined) data.isActive = body.isActive

  return data
}

interface ApartmentsQuery {
  /** Комнатность через запятую: `0,1,2`. Ноль — студия. */
  rooms?: string
  priceMin?: number
  priceMax?: number
  /** `false` — показать и снятые с продажи. По умолчанию только активные. */
  onlyActive?: boolean
  limit?: number
  offset?: number
}

const apartmentsSchema = {
  querystring: {
    type: 'object',
    properties: {
      rooms: { type: 'string', maxLength: 100 },
      priceMin: { type: 'number', minimum: 0 },
      priceMax: { type: 'number', minimum: 0 },
      onlyActive: { type: 'boolean' },
      limit: { type: 'integer', minimum: 1, maximum: 500 },
      offset: { type: 'integer', minimum: 0 },
    },
    additionalProperties: false,
  },
} as const

function parseRooms(raw: string | undefined): number[] {
  if (raw === undefined) return []
  const values = raw
    .split(',')
    .map((part) => Number.parseInt(part.trim(), 10))
    .filter((value) => Number.isInteger(value) && value >= 0 && value <= 20)
  return [...new Set(values)]
}

const projectsRoutes: FastifyPluginAsync = async (app) => {
  /**
   * Числа по всем ЖК разом: два групповых запроса вместо запроса на строку.
   * Вилка цен считается только по активным квартирам — показывать цену лота,
   * которого уже нет в продаже, значит вводить менеджера в заблуждение.
   */
  async function collectStats(): Promise<Map<string, ProjectStats>> {
    const [totals, actives, byFeed, feeds] = await Promise.all([
      app.prisma.apartment.groupBy({
        by: ['projectId'],
        where: { projectId: { not: null } },
        _count: { _all: true },
      }),
      app.prisma.apartment.groupBy({
        by: ['projectId'],
        where: { projectId: { not: null }, isActive: true },
        _count: { _all: true },
        _min: { price: true },
        _max: { price: true },
      }),
      app.prisma.apartment.groupBy({
        by: ['projectId', 'feedId'],
        where: { projectId: { not: null } },
        _count: { _all: true },
      }),
      app.prisma.feed.findMany({ select: { id: true, name: true, isActive: true } }),
    ])

    const feedById = new Map(feeds.map((feed) => [feed.id, feed]))
    // Сколько ЖК кормит каждый фид: одна выгрузка обычно заводит их пачкой.
    const projectsPerFeed = new Map<string, number>()
    for (const row of byFeed) {
      if (!row.projectId) continue
      projectsPerFeed.set(row.feedId, (projectsPerFeed.get(row.feedId) ?? 0) + 1)
    }
    const blank = (): ProjectStats => ({ apartments: { active: 0, total: 0 }, price: null, feeds: [] })

    const stats = new Map<string, ProjectStats>()
    const entry = (projectId: string): ProjectStats => {
      const found = stats.get(projectId) ?? blank()
      stats.set(projectId, found)
      return found
    }

    for (const row of totals) {
      if (!row.projectId) continue
      entry(row.projectId).apartments.total = row._count._all
    }
    for (const row of actives) {
      if (!row.projectId) continue
      const current = entry(row.projectId)
      current.apartments.active = row._count._all
      const min = row._min.price
      const max = row._max.price
      current.price = min === null || max === null ? null : { min, max }
    }
    for (const row of byFeed) {
      if (!row.projectId) continue
      const feed = feedById.get(row.feedId)
      if (!feed) continue
      entry(row.projectId).feeds.push({
        id: feed.id,
        name: feed.name,
        isActive: feed.isActive,
        projectCount: projectsPerFeed.get(feed.id) ?? 1,
      })
    }
    return stats
  }

  async function statsFor(projectId: string): Promise<ProjectStats> {
    return (await collectStats()).get(projectId) ?? NO_STATS
  }

  app.get('/api/admin/projects', async (_request, reply) => {
    const [projects, stats] = await Promise.all([
      app.prisma.project.findMany({ orderBy: [{ isActive: 'desc' }, { name: 'asc' }] }),
      collectStats(),
    ])
    return reply.send({
      projects: projects.map((project) => toProjectView(project, stats.get(project.id) ?? NO_STATS)),
      // Направления приходят с сервера вместе со счётчиками: вкладка «Коммерция»
      // должна быть на месте и тогда, когда коммерции в каталоге ещё нет, —
      // иначе некуда перенести первый такой ЖК.
      categories: CATEGORY_OPTIONS.map((option) => ({
        ...option,
        count: projects.filter((project) => project.category === option.value).length,
      })),
    })
  })

  app.get<{ Params: ProjectParams }>('/api/admin/projects/:id', async (request, reply) => {
    const project = await app.prisma.project.findUnique({ where: { id: request.params.id } })
    if (!project) return notFound(reply)
    return reply.send({
      ...toProjectView(project, await statsFor(project.id)),
      // Справочник направлений едет вместе с карточкой: он статичен, а без
      // него админке пришлось бы тянуть весь список ЖК ради четырёх подписей.
      categories: CATEGORY_OPTIONS,
    })
  })

  const updateHandler = async (
    request: { params: ProjectParams; body: ProjectBody },
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const current = await app.prisma.project.findUnique({ where: { id: request.params.id } })
    if (!current) return notFound(reply)

    let data: Prisma.ProjectUncheckedUpdateInput
    try {
      data = buildProjectData(request.body)
    } catch (error) {
      if (error instanceof ProjectInputError) return validationFailed(reply, error.message)
      throw error
    }

    // Переименовали — пересобираем slug: он уникален и участвует в ссылках,
    // а старый после смены названия перестаёт что-либо объяснять.
    if (typeof data.name === 'string' && data.name !== current.name) {
      data.slug = await uniqueSlug(data.name, async (slug) => {
        const taken = await app.prisma.project.findUnique({ where: { slug }, select: { id: true } })
        return taken !== null && taken.id !== current.id
      })
    }

    const project = await app.prisma.project.update({ where: { id: current.id }, data })
    return reply.send(toProjectView(project, await statsFor(project.id)))
  }

  app.patch<{ Params: ProjectParams; Body: ProjectBody }>(
    '/api/admin/projects/:id',
    { schema: updateSchema },
    updateHandler,
  )
  app.put<{ Params: ProjectParams; Body: ProjectBody }>(
    '/api/admin/projects/:id',
    { schema: updateSchema },
    updateHandler,
  )

  /**
   * Отдельный маршрут для переключателя в списке: тумблер дёргают часто и
   * из строки таблицы, где ни одного другого поля формы нет.
   */
  app.post<{ Params: ProjectParams; Body: { isActive: boolean } }>(
    '/api/admin/projects/:id/active',
    { schema: activeSchema },
    async (request, reply) => {
      const current = await app.prisma.project.findUnique({ where: { id: request.params.id } })
      if (!current) return notFound(reply)
      const project = await app.prisma.project.update({
        where: { id: current.id },
        data: { isActive: request.body.isActive },
      })
      return reply.send(toProjectView(project, await statsFor(project.id)))
    },
  )

  /**
   * Удаление ЖК вместе с его квартирами.
   *
   *   DELETE /api/admin/projects/:id            откажет, если ЖК кормит живой фид
   *   DELETE /api/admin/projects/:id?force=true удалит всё равно
   *
   * Отказ — не каприз: удалённый ЖК вернётся из выгрузки вместе со всеми
   * квартирами, и администратор решит, что кнопка сломана. Поэтому в ответе
   * поимённо перечислены включённые фиды, из которых пришли его квартиры.
   */
  app.delete<{ Params: ProjectParams; Querystring: { force?: boolean } }>(
    '/api/admin/projects/:id',
    { schema: { querystring: { type: 'object', properties: { force: { type: 'boolean' } }, additionalProperties: false } } },
    async (request, reply) => {
      const project = await app.prisma.project.findUnique({ where: { id: request.params.id } })
      if (!project) return notFound(reply)

      const stats = await statsFor(project.id)
      const liveFeeds = stats.feeds.filter((feed) => feed.isActive)

      if (liveFeeds.length > 0 && request.query.force !== true) {
        const names = liveFeeds.map((feed) => `«${feed.name}»`).join(', ')
        return reply.code(409).send({
          error: 'feed_active',
          message:
            `Квартиры этого ЖК приходят из ${liveFeeds.length === 1 ? 'включённого фида' : 'включённых фидов'} ${names}. ` +
            'Следующая синхронизация заведёт комплекс заново по названию из выгрузки. ' +
            `Сначала выключите ${liveFeeds.length === 1 ? 'его' : 'их'} в разделе «Фиды» — или удалите, зная, что ЖК вернётся.`,
          feeds: liveFeeds,
        })
      }

      const knowledgeDocs = await app.prisma.knowledgeDoc.count({ where: { projectId: project.id } })

      // Квартиры уходят вместе с ЖК одной транзакцией: половина удаления —
      // это лоты без комплекса, которые ассистент продолжает предлагать.
      const [removed] = await app.prisma.$transaction([
        app.prisma.apartment.deleteMany({ where: { projectId: project.id } }),
        app.prisma.project.delete({ where: { id: project.id } }),
      ])

      return reply.send({
        ok: true,
        id: project.id,
        name: project.name,
        apartmentsDeleted: removed.count,
        /** Документы базы знаний остались, но потеряли привязку к ЖК. */
        knowledgeDocsUnlinked: knowledgeDocs,
        /** Фиды, которые заведут ЖК заново. Админка честно об этом говорит. */
        activeFeeds: liveFeeds,
      })
    },
  )

  /**
   * Квартиры ЖК. Фильтры те же, что человек держит в голове, когда смотрит
   * на карточку: комнатность и цена. Вместе со списком приходят границы —
   * какие комнатности есть и в какую цену, чтобы фильтр не предлагал пустоту.
   */
  app.get<{ Params: ProjectParams; Querystring: ApartmentsQuery }>(
    '/api/admin/projects/:id/apartments',
    { schema: apartmentsSchema },
    async (request, reply) => {
      const project = await app.prisma.project.findUnique({
        where: { id: request.params.id },
        select: { id: true, name: true },
      })
      if (!project) return notFound(reply)

      const { priceMin, priceMax, limit = 100, offset = 0 } = request.query
      const onlyActive = request.query.onlyActive !== false
      const rooms = parseRooms(request.query.rooms)

      const where: Prisma.ApartmentWhereInput = { projectId: project.id }
      if (onlyActive) where.isActive = true
      if (rooms.length > 0) where.rooms = { in: rooms }
      if (priceMin !== undefined || priceMax !== undefined) {
        where.price = {
          ...(priceMin !== undefined ? { gte: priceMin } : {}),
          ...(priceMax !== undefined ? { lte: priceMax } : {}),
        }
      }

      // Границы считаются по тому же набору, но без фильтров цены и комнат:
      // иначе ползунок цены схлопывался бы после каждого шага фильтрации.
      const scope: Prisma.ApartmentWhereInput = onlyActive
        ? { projectId: project.id, isActive: true }
        : { projectId: project.id }

      const [apartments, total, roomsFacet, priceRange] = await Promise.all([
        app.prisma.apartment.findMany({
          where,
          orderBy: [{ price: 'asc' }, { id: 'asc' }],
          take: limit,
          skip: offset,
        }),
        app.prisma.apartment.count({ where }),
        app.prisma.apartment.groupBy({ by: ['rooms'], where: scope, _count: { _all: true } }),
        app.prisma.apartment.aggregate({ where: scope, _min: { price: true }, _max: { price: true } }),
      ])

      return reply.send({
        project: { id: project.id, name: project.name },
        apartments: apartments.map((apartment) => ({
          id: apartment.id,
          externalId: apartment.externalId,
          rooms: apartment.rooms,
          planType: apartment.planType,
          area: apartment.area,
          floor: apartment.floor,
          floorsTotal: apartment.floorsTotal,
          price: apartment.price,
          pricePerM2: apartment.pricePerM2,
          building: apartment.building,
          section: apartment.section,
          finishing: apartment.finishing,
          deadline: apartment.deadline,
          planImageUrl: apartment.planImageUrl,
          photos: apartment.photos,
          url: apartment.url,
          isActive: apartment.isActive,
          syncedAt: apartment.syncedAt,
        })),
        total,
        limit,
        offset,
        facets: {
          rooms: roomsFacet
            .map((row) => ({ rooms: row.rooms, count: row._count._all }))
            .sort((a, b) => (a.rooms ?? 99) - (b.rooms ?? 99)),
          price:
            priceRange._min.price === null || priceRange._max.price === null
              ? null
              : { min: priceRange._min.price, max: priceRange._max.price },
        },
      })
    },
  )
}

export default projectsRoutes
