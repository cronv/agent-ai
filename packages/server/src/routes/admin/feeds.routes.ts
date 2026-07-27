import { Prisma } from '@prisma/client'
import type { Feed, FeedFormat } from '@prisma/client'
import type { FastifyPluginAsync, FastifyReply } from 'fastify'

import { FEED_FIELDS, FeedMappingError, resolveProfile } from '../../services/feeds/index.js'
import { DEFAULT_FEED_SYNC_CRON, isValidCron } from '../../services/feeds/scheduler.js'
import { isFeedSyncing, syncFeed, syncingFeedIds } from '../../services/feeds/sync.js'

/**
 * Фиды в админке.
 *
 *   GET    /api/admin/feeds            список фидов с состоянием последнего прогона
 *   GET    /api/admin/feeds/meta       справочник для формы: форматы, поля маппинга
 *   GET    /api/admin/feeds/:id        один фид
 *   POST   /api/admin/feeds            завести фид
 *   PATCH  /api/admin/feeds/:id        изменить (PUT — синоним)
 *   DELETE /api/admin/feeds/:id        удалить вместе с квартирами
 *   POST   /api/admin/feeds/:id/sync   обновить немедленно
 *
 * Всё под `/api/admin/` уже закрыто хуком из `plugins/auth.ts`.
 *
 * После любой правки фидов зовётся `app.feedScheduler.reload()`: у фида может
 * быть своё расписание, и оно должно начать действовать сразу, без перезапуска.
 */

const FORMATS: FeedFormat[] = ['yandex', 'cian', 'domclick', 'custom']

interface FeedParams {
  id: string
}

interface FeedBody {
  name?: string
  url?: string
  format?: FeedFormat
  fieldMapping?: unknown
  scheduleCron?: string | null
  isActive?: boolean
}

const feedBodyProperties = {
  name: { type: 'string', minLength: 1, maxLength: 200 },
  url: { type: 'string', minLength: 1, maxLength: 2000 },
  format: { type: 'string', enum: FORMATS },
  fieldMapping: { type: ['object', 'null'] },
  scheduleCron: { type: ['string', 'null'], maxLength: 200 },
  isActive: { type: 'boolean' },
} as const

const createSchema = {
  body: {
    type: 'object',
    required: ['name', 'url'],
    properties: feedBodyProperties,
    additionalProperties: false,
  },
} as const

const updateSchema = {
  body: {
    type: 'object',
    minProperties: 1,
    properties: feedBodyProperties,
    additionalProperties: false,
  },
} as const

/** Фид в том виде, в каком его показывает админка. */
export interface FeedView {
  id: string
  name: string
  url: string
  format: FeedFormat
  fieldMapping: unknown
  scheduleCron: string | null
  isActive: boolean
  lastRunAt: Date | null
  lastStatus: string | null
  lastError: string | null
  lastCount: number | null
  createdAt: Date
  updatedAt: Date
  /** Обновляется прямо сейчас. */
  isSyncing: boolean
  apartments: { active: number; total: number }
}

interface ApartmentCounts {
  active: number
  total: number
}

const NO_APARTMENTS: ApartmentCounts = { active: 0, total: 0 }

function toFeedView(feed: Feed, counts: ApartmentCounts = NO_APARTMENTS): FeedView {
  return {
    id: feed.id,
    name: feed.name,
    url: feed.url,
    format: feed.format,
    fieldMapping: feed.fieldMapping ?? null,
    scheduleCron: feed.scheduleCron,
    isActive: feed.isActive,
    lastRunAt: feed.lastRunAt,
    lastStatus: feed.lastStatus,
    lastError: feed.lastError,
    lastCount: feed.lastCount,
    createdAt: feed.createdAt,
    updatedAt: feed.updatedAt,
    isSyncing: isFeedSyncing(feed.id),
    apartments: counts,
  }
}

/** Ошибка заполнения формы — с человеческим текстом для админки. */
class FeedInputError extends Error {}

function validationFailed(reply: FastifyReply, message: string): FastifyReply {
  return reply.code(400).send({ error: 'validation', message })
}

function notFound(reply: FastifyReply): FastifyReply {
  return reply.code(404).send({ error: 'not_found', message: 'Фид не найден' })
}

/** Проверяет ссылку: без http/https скачивать нечего. */
function normalizeUrl(raw: string): string {
  const value = raw.trim()
  let parsed: URL
  try {
    parsed = new URL(value)
  } catch {
    throw new FeedInputError(`Ссылка на фид неправильная: ${value}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new FeedInputError('Ссылка на фид должна начинаться с http:// или https://')
  }
  return value
}

function normalizeCron(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null
  const value = raw.trim()
  if (value === '') return null
  if (!isValidCron(value)) {
    throw new FeedInputError(`Расписание «${value}» записано неправильно. Пример: ${DEFAULT_FEED_SYNC_CRON}`)
  }
  return value
}

/**
 * Собирает поля для записи. Для формата `custom` маппинг проверяется тем же
 * кодом, что разбирает фид, — админка узнает об ошибке до первого прогона.
 */
function buildFeedData(body: FeedBody, current?: Feed): Prisma.FeedUncheckedCreateInput {
  const name = body.name === undefined ? current?.name : body.name.trim()
  if (name === undefined || name === '') throw new FeedInputError('Название фида не может быть пустым')

  const url = body.url === undefined ? current?.url : normalizeUrl(body.url)
  if (url === undefined || url === '') throw new FeedInputError('Укажите ссылку на фид')

  const format = body.format ?? current?.format ?? 'yandex'
  const fieldMapping =
    body.fieldMapping === undefined ? (current?.fieldMapping ?? null) : (body.fieldMapping ?? null)

  try {
    resolveProfile(format, fieldMapping)
  } catch (error) {
    if (error instanceof FeedMappingError) throw new FeedInputError(error.message)
    throw error
  }

  const data: Prisma.FeedUncheckedCreateInput = {
    name,
    url,
    format,
    fieldMapping: fieldMapping === null ? Prisma.DbNull : (fieldMapping as Prisma.InputJsonValue),
    scheduleCron: body.scheduleCron === undefined ? (current?.scheduleCron ?? null) : normalizeCron(body.scheduleCron),
  }
  if (body.isActive !== undefined) data.isActive = body.isActive
  return data
}

const feedsRoutes: FastifyPluginAsync = async (app) => {
  /** Сколько квартир у каждого фида: всего и активных. */
  async function countApartments(): Promise<Map<string, ApartmentCounts>> {
    const [totals, actives] = await Promise.all([
      app.prisma.apartment.groupBy({ by: ['feedId'], _count: { _all: true } }),
      app.prisma.apartment.groupBy({ by: ['feedId'], where: { isActive: true }, _count: { _all: true } }),
    ])
    const counts = new Map<string, ApartmentCounts>()
    for (const row of totals) {
      counts.set(row.feedId, { active: 0, total: row._count._all })
    }
    for (const row of actives) {
      const current = counts.get(row.feedId) ?? { active: 0, total: 0 }
      counts.set(row.feedId, { active: row._count._all, total: current.total })
    }
    return counts
  }

  app.get('/api/admin/feeds', async (_request, reply) => {
    const [feeds, counts] = await Promise.all([
      app.prisma.feed.findMany({ orderBy: { createdAt: 'asc' } }),
      countApartments(),
    ])
    return reply.send({
      feeds: feeds.map((feed) => toFeedView(feed, counts.get(feed.id) ?? NO_APARTMENTS)),
      syncing: syncingFeedIds(),
      scheduler: app.feedScheduler.state,
    })
  })

  // Статический путь объявлен до `/:id`, чтобы не быть им перехваченным.
  app.get('/api/admin/feeds/meta', async (_request, reply) => {
    return reply.send({
      formats: FORMATS,
      fields: FEED_FIELDS,
      defaultCron: DEFAULT_FEED_SYNC_CRON,
      scheduler: app.feedScheduler.state,
    })
  })

  app.get<{ Params: FeedParams }>('/api/admin/feeds/:id', async (request, reply) => {
    const feed = await app.prisma.feed.findUnique({ where: { id: request.params.id } })
    if (!feed) return notFound(reply)
    const counts = await countApartments()
    return reply.send(toFeedView(feed, counts.get(feed.id) ?? NO_APARTMENTS))
  })

  app.post<{ Body: FeedBody }>('/api/admin/feeds', { schema: createSchema }, async (request, reply) => {
    let data: Prisma.FeedUncheckedCreateInput
    try {
      data = buildFeedData(request.body)
    } catch (error) {
      if (error instanceof FeedInputError) return validationFailed(reply, error.message)
      throw error
    }

    const feed = await app.prisma.feed.create({ data })
    await app.feedScheduler.reload()
    return reply.code(201).send(toFeedView(feed))
  })

  const updateHandler = async (
    request: { params: FeedParams; body: FeedBody },
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    const current = await app.prisma.feed.findUnique({ where: { id: request.params.id } })
    if (!current) return notFound(reply)

    let data: Prisma.FeedUncheckedCreateInput
    try {
      data = buildFeedData(request.body, current)
    } catch (error) {
      if (error instanceof FeedInputError) return validationFailed(reply, error.message)
      throw error
    }

    const feed = await app.prisma.feed.update({ where: { id: current.id }, data })
    await app.feedScheduler.reload()
    const counts = await countApartments()
    return reply.send(toFeedView(feed, counts.get(feed.id) ?? NO_APARTMENTS))
  }

  app.patch<{ Params: FeedParams; Body: FeedBody }>(
    '/api/admin/feeds/:id',
    { schema: updateSchema },
    updateHandler,
  )
  app.put<{ Params: FeedParams; Body: FeedBody }>(
    '/api/admin/feeds/:id',
    { schema: updateSchema },
    updateHandler,
  )

  app.delete<{ Params: FeedParams }>('/api/admin/feeds/:id', async (request, reply) => {
    const feed = await app.prisma.feed.findUnique({ where: { id: request.params.id } })
    if (!feed) return notFound(reply)

    // Квартиры фида уходят вместе с ним — так устроена связь в схеме.
    await app.prisma.feed.delete({ where: { id: feed.id } })
    await app.feedScheduler.reload()
    return reply.send({ ok: true, id: feed.id })
  })

  /**
   * Ручное обновление. Ответ приходит после прогона — он занимает секунды,
   * зато в админке сразу видно, что именно загрузилось и на чём споткнулось.
   */
  app.post<{ Params: FeedParams }>('/api/admin/feeds/:id/sync', async (request, reply) => {
    const feed = await app.prisma.feed.findUnique({ where: { id: request.params.id } })
    if (!feed) return notFound(reply)

    const outcome = await syncFeed(feed.id, { db: app.prisma })
    if (outcome.busy) {
      return reply.code(409).send({
        error: 'feed_busy',
        message: 'Фид уже обновляется, дождитесь окончания',
        startedAt: outcome.startedAt,
      })
    }

    const updated = await app.prisma.feed.findUnique({ where: { id: feed.id } })
    const counts = await countApartments()
    return reply.send({
      result: outcome.result,
      feed: toFeedView(updated ?? feed, counts.get(feed.id) ?? NO_APARTMENTS),
    })
  })
}

export default feedsRoutes
