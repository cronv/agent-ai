import type { LeadStatus } from '@prisma/client'
import type { FastifyPluginAsync } from 'fastify'

import {
  LEAD_LIST_LIMIT,
  LEAD_LIST_MAX_LIMIT,
  exportFilename,
  exportLeadsCsv,
  type LeadListFilters,
} from '../../services/leads/index.js'

/**
 * Лиды в админке.
 *
 *   GET   /api/admin/leads             список с фильтрами и поиском
 *   GET   /api/admin/leads/export.csv  та же выборка файлом для Excel
 *   PATCH /api/admin/leads/:id         сменить статус
 *
 * Всё под `/api/admin/` уже закрыто хуком из `plugins/auth.ts`.
 *
 * Фильтры у списка и выгрузки одни и те же: кнопка «Выгрузить» в админке
 * отдаёт ровно то, что менеджер видит на экране, а не всю базу.
 */

const LEAD_STATUSES: LeadStatus[] = ['new', 'in_progress', 'reached', 'rejected']

interface ListQuery {
  status?: string
  /** Дата в формате `YYYY-MM-DD` — включительно, с начала дня. */
  from?: string
  /** Дата в формате `YYYY-MM-DD` — включительно, до конца дня. */
  to?: string
  /** Поиск по имени и телефону. */
  q?: string
  limit?: number
  offset?: number
}

const listQuerySchema = {
  querystring: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: LEAD_STATUSES },
      from: { type: 'string', maxLength: 40 },
      to: { type: 'string', maxLength: 40 },
      q: { type: 'string', maxLength: 200 },
      limit: { type: 'integer', minimum: 1, maximum: LEAD_LIST_MAX_LIMIT },
      offset: { type: 'integer', minimum: 0 },
    },
    additionalProperties: false,
  },
} as const

const exportQuerySchema = {
  querystring: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: LEAD_STATUSES },
      from: { type: 'string', maxLength: 40 },
      to: { type: 'string', maxLength: 40 },
      q: { type: 'string', maxLength: 200 },
    },
    additionalProperties: false,
  },
} as const

const statusSchema = {
  body: {
    type: 'object',
    required: ['status'],
    properties: { status: { type: 'string', enum: LEAD_STATUSES } },
    additionalProperties: false,
  },
} as const

/**
 * Границы периода. `from` берётся с начала дня, `to` — до его конца:
 * фильтр «с 1 по 5 июля» должен показывать и лид, оставленный пятого вечером.
 */
function parseDay(value: string | undefined, end: boolean): Date | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const text = value.trim()
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/u.test(text) ? `${text}T${end ? '23:59:59.999' : '00:00:00.000'}` : text)
  return Number.isNaN(date.getTime()) ? undefined : date
}

function toFilters(query: ListQuery): LeadListFilters {
  const filters: LeadListFilters = {}
  if (query.status && (LEAD_STATUSES as string[]).includes(query.status)) {
    filters.status = query.status as LeadStatus
  }
  const from = parseDay(query.from, false)
  if (from) filters.from = from
  const to = parseDay(query.to, true)
  if (to) filters.to = to
  if (query.q && query.q.trim() !== '') filters.query = query.q.trim()
  return filters
}

const leadsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListQuery }>('/api/admin/leads', { schema: listQuerySchema }, async (request, reply) => {
    const filters = toFilters(request.query)
    filters.limit = request.query.limit ?? LEAD_LIST_LIMIT
    filters.offset = request.query.offset ?? 0

    const [page, counts] = await Promise.all([app.leads.list(filters), app.leads.countByStatus(filters)])

    return reply.send({ ...page, counts })
  })

  /**
   * Выгрузка. Имя маршрута с расширением — чтобы браузер сохранил файл
   * как `.csv`, даже если пользователь откроет ссылку напрямую.
   */
  app.get<{ Querystring: ListQuery }>(
    '/api/admin/leads/export.csv',
    { schema: exportQuerySchema },
    async (request, reply) => {
      const leads = await app.leads.listForExport(toFilters(request.query))
      return reply
        .header('content-type', 'text/csv; charset=utf-8')
        .header('content-disposition', `attachment; filename="${exportFilename()}"`)
        .send(exportLeadsCsv(leads))
    },
  )

  app.patch<{ Params: { id: string }; Body: { status: LeadStatus } }>(
    '/api/admin/leads/:id',
    { schema: statusSchema },
    async (request, reply) => {
      const lead = await app.leads.updateStatus(request.params.id, request.body.status)
      if (!lead) return reply.code(404).send({ error: 'not_found', message: 'Лид не найден' })
      return reply.send({ lead })
    },
  )
}

export default leadsRoutes
