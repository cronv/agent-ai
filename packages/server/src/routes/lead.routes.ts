import type { FastifyPluginAsync } from 'fastify'

import { LeadValidationError } from '../services/leads/index.js'

/**
 * Контакт из формы виджета.
 *
 *   POST /api/lead
 *   { sessionId, name, phone, comment?, consent, page?, referrer?, utm? }
 *
 * Маршрут публичный и живёт вне `/api/admin/` намеренно: его дёргает виджет с
 * чужого сайта, куки админки там нет и быть не должно.
 *
 * Тот же контакт умеет сохранять модель — инструментом `save_lead`. Оба пути
 * ведут в `app.leads.capture`: телефон нормализуется одинаково, дубль в сессии
 * находится одинаково, вебхук уходит один раз.
 *
 * Согласие проверяется на сервере, а не только галочкой в форме: без него лид
 * не создаётся вовсе — 152-ФЗ.
 */

interface LeadBody {
  sessionId?: string
  name?: string
  phone?: string
  comment?: string | null
  consent?: boolean
  page?: string | null
  referrer?: string | null
  utm?: Record<string, string> | null
}

const leadSchema = {
  body: {
    type: 'object',
    properties: {
      sessionId: { type: 'string', maxLength: 200 },
      name: { type: 'string', maxLength: 200 },
      phone: { type: 'string', maxLength: 50 },
      comment: { type: ['string', 'null'], maxLength: 2000 },
      consent: { type: 'boolean' },
      page: { type: ['string', 'null'], maxLength: 2000 },
      referrer: { type: ['string', 'null'], maxLength: 2000 },
      utm: { type: ['object', 'null'], additionalProperties: { type: 'string' } },
    },
    additionalProperties: false,
  },
} as const

/** Код ошибки для виджета: по нему форма подсвечивает поле. */
const ERROR_CODES: Record<LeadValidationError['field'], string> = {
  consent: 'consent_required',
  name: 'bad_name',
  phone: 'bad_phone',
  session: 'unknown_session',
}

const leadRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: LeadBody }>('/api/lead', { schema: leadSchema }, async (request, reply) => {
    const body = request.body ?? {}

    try {
      const lead = await app.leads.capture({
        sessionId: body.sessionId ?? null,
        name: body.name ?? '',
        phone: body.phone ?? '',
        comment: body.comment ?? null,
        consent: body.consent === true,
        page: body.page ?? null,
        referrer: body.referrer ?? null,
        utm: body.utm ?? null,
      })

      return reply.code(201).send({
        lead: {
          id: lead.id,
          name: lead.name,
          phone: lead.phone,
          phoneFormatted: lead.phoneFormatted,
          comment: lead.comment,
          createdAt: lead.createdAt,
        },
      })
    } catch (error) {
      if (error instanceof LeadValidationError) {
        return reply.code(400).send({ error: ERROR_CODES[error.field], field: error.field, message: error.message })
      }
      throw error
    }
  })
}

export default leadRoutes
