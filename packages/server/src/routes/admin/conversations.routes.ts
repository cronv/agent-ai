import type { FastifyPluginAsync } from 'fastify'

import type { Db } from '../../db/prisma.js'
import type { ApartmentCard } from '../../services/dialog/apartments.js'
import { parseToolCalls } from '../../services/dialog/conversations.js'
import { parseApartments, toLeadView, formatPhone, phoneSearchFragments } from '../../services/leads/index.js'
import type { LeadView } from '../../services/leads/index.js'

/**
 * Переписки в админке.
 *
 *   GET /api/admin/conversations      список с фильтрами и поиском
 *   GET /api/admin/conversations/:id  диалог целиком
 *
 * Всё под `/api/admin/` уже закрыто хуком из `plugins/auth.ts`.
 *
 * ── Почему список собирается сырым SQL ─────────────────────────────────────
 *
 * Строке списка нужно то, чего нет в самой переписке: первое сообщение
 * посетителя, сколько квартир ей показали, оставлен ли контакт. Через Prisma
 * это либо `include` всех сообщений (переписка на сотню реплик приедет целиком
 * ради одной строки таблицы), либо запрос на строку. Один запрос с боковыми
 * подзапросами делает то же самое по индексу `messages_conversation_id_...`
 * и не тянет в память ничего лишнего — списку всё равно, тысяча в базе
 * диалогов или сто тысяч.
 *
 * ── Поиск по тексту сообщений ──────────────────────────────────────────────
 *
 * По `messages.content` есть GIN-индекс с `gin_trgm_ops`
 * (миграция `*_fulltext_search`). Он ускоряет именно `ILIKE '%…%'`: PostgreSQL
 * разбирает шаблон на триграммы и берёт из индекса кандидатов, а не читает
 * таблицу целиком. Условие — в запросе должна быть хотя бы одна триграмма,
 * то есть три символа; на более коротком запросе индекс бесполезен, и по
 * тексту мы не ищем вовсе (см. `MIN_TEXT_QUERY_LENGTH`), чтобы не устраивать
 * полный проход по всем сообщениям ради двух букв.
 *
 * Полнотекстовый поиск (`tsvector`) здесь не подходит: менеджер ищет обрывок
 * («ипотек», «на Планерной», кусок телефона), а не слово целиком.
 */

/** Сколько переписок на странице по умолчанию. */
export const CONVERSATION_LIST_LIMIT = 50

/** Потолок страницы: больше в таблице всё равно не читают. */
export const CONVERSATION_LIST_MAX_LIMIT = 200

/**
 * Короче трёх символов поиск по тексту сообщений не идёт: триграммный индекс
 * такой шаблон не покрывает, а последовательный проход по всей переписке базы
 * стоит дороже, чем польза от поиска по «до».
 */
export const MIN_TEXT_QUERY_LENGTH = 3

/** Сколько сообщений отдаём в карточке диалога. Длиннее переписок не бывает. */
export const CONVERSATION_MESSAGE_LIMIT = 500

/** Наличие контакта — фильтр «только с лидом» / «только без лида». */
export type LeadPresence = 'with' | 'without'

export interface ConversationListFilters {
  /** Поиск по тексту сообщений, имени и телефону лида, идентификатору сессии. */
  query?: string | undefined
  /** Включительно, с начала дня — по дате начала переписки. */
  from?: Date | undefined
  /** Включительно, до конца дня. */
  to?: Date | undefined
  lead?: LeadPresence | undefined
  limit?: number | undefined
  offset?: number | undefined
}

/** Строка списка переписок. */
export interface ConversationRow {
  id: string
  sessionId: string
  page: string | null
  referrer: string | null
  utm: Record<string, string> | null
  messageCount: number
  tokensIn: number
  tokensOut: number
  startedAt: Date
  lastMessageAt: Date
  /** С чего человек начал — по нему переписка узнаётся в списке. */
  firstMessage: string | null
  /** Сколько карточек квартир показал ассистент за диалог. */
  apartmentsShown: number
  lead: { id: string; name: string; phone: string; phoneFormatted: string; status: string } | null
}

/** Сообщение в карточке диалога. */
export interface MessageView {
  id: string
  role: 'user' | 'assistant'
  content: string
  /** Квартиры, показанные этим сообщением, — админка рисует из них карточки. */
  apartments: ApartmentCard[]
  /** Чем ассистент пользовался, отвечая. Результаты не отдаём: это килобайты JSON. */
  tools: { id: string; name: string; input: unknown; isError: boolean }[]
  model: string | null
  tokensIn: number | null
  tokensOut: number | null
  createdAt: Date
}

export interface ConversationDetail extends ConversationRow {
  userAgent: string | null
  messages: MessageView[]
  /** Все уникальные квартиры диалога — то, что менеджер обсуждает по телефону. */
  apartments: ApartmentCard[]
  /** Контакт из этой переписки, если он есть. */
  leadCard: LeadView | null
  /** Сообщений больше, чем поместилось: показаны первые `CONVERSATION_MESSAGE_LIMIT`. */
  truncated: boolean
}

interface ListQuery {
  q?: string
  /** Дата в формате `YYYY-MM-DD` — включительно, с начала дня. */
  from?: string
  /** Дата в формате `YYYY-MM-DD` — включительно, до конца дня. */
  to?: string
  lead?: LeadPresence
  limit?: number
  offset?: number
}

const listQuerySchema = {
  querystring: {
    type: 'object',
    properties: {
      q: { type: 'string', maxLength: 200 },
      from: { type: 'string', maxLength: 40 },
      to: { type: 'string', maxLength: 40 },
      lead: { type: 'string', enum: ['with', 'without'] },
      limit: { type: 'integer', minimum: 1, maximum: CONVERSATION_LIST_MAX_LIMIT },
      offset: { type: 'integer', minimum: 0 },
    },
    additionalProperties: false,
  },
} as const

// ─────────────────────────────────────────────────────────────
//  Сборка SQL
// ─────────────────────────────────────────────────────────────

/** Позиционные параметры запроса: `params.add(value)` возвращает `$1`, `$2`… */
class SqlParams {
  readonly values: unknown[] = []

  add(value: unknown): string {
    this.values.push(value)
    return `$${this.values.length}`
  }
}

/**
 * Экранирование шаблона `ILIKE`. Без него «100%» в запросе означает
 * «что угодно после 100», а «_» — любой символ.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/gu, (match) => `\\${match}`)
}

function conditions(params: SqlParams, filters: ConversationListFilters, withLeadFilter: boolean): string {
  const parts: string[] = []

  if (filters.from) parts.push(`c."started_at" >= ${params.add(filters.from)}`)
  if (filters.to) parts.push(`c."started_at" <= ${params.add(filters.to)}`)

  if (withLeadFilter && filters.lead === 'with') {
    parts.push(`EXISTS (SELECT 1 FROM "leads" l WHERE l."conversation_id" = c."id")`)
  }
  if (withLeadFilter && filters.lead === 'without') {
    parts.push(`NOT EXISTS (SELECT 1 FROM "leads" l WHERE l."conversation_id" = c."id")`)
  }

  const query = filters.query?.trim() ?? ''
  if (query !== '') {
    const pattern = params.add(`%${escapeLike(query)}%`)
    // Телефон в базе лежит как `+7XXXXXXXXXX`, а ищут его кусками и в другом
    // написании: «8 912», «345-67». Готовые куски даёт сервис лидов.
    const phones = params.add(phoneSearchFragments(query).map((fragment) => `%${escapeLike(fragment)}%`))
    const session = params.add(query)

    const or = [
      `EXISTS (SELECT 1 FROM "leads" l WHERE l."conversation_id" = c."id"
                 AND (l."name" ILIKE ${pattern} OR l."phone" LIKE ANY(${phones}::text[])))`,
      `c."session_id" = ${session}`,
    ]
    if (query.length >= MIN_TEXT_QUERY_LENGTH) {
      or.unshift(
        `EXISTS (SELECT 1 FROM "messages" m WHERE m."conversation_id" = c."id" AND m."content" ILIKE ${pattern})`,
      )
    }
    parts.push(`(${or.join(' OR ')})`)
  }

  return parts.length === 0 ? 'TRUE' : parts.join(' AND ')
}

interface ListRow {
  id: string
  session_id: string
  page_url: string | null
  referrer: string | null
  utm: unknown
  message_count: number
  tokens_in: number
  tokens_out: number
  started_at: Date
  last_message_at: Date
  first_message: string | null
  apartments_shown: number
  lead_id: string | null
  lead_name: string | null
  lead_phone: string | null
  lead_status: string | null
}

interface CountsRow {
  all: number
  with_lead: number
}

export interface ConversationListPage {
  conversations: ConversationRow[]
  total: number
  limit: number
  offset: number
  /** Цифры на переключателе «все / с контактом / без контакта». */
  counts: { all: number; withLead: number; withoutLead: number }
}

export async function listConversations(
  db: Db,
  filters: ConversationListFilters = {},
): Promise<ConversationListPage> {
  const limit = clamp(filters.limit ?? CONVERSATION_LIST_LIMIT, 1, CONVERSATION_LIST_MAX_LIMIT)
  const offset = Math.max(Math.round(filters.offset ?? 0), 0)

  const pageParams = new SqlParams()
  const pageWhere = conditions(pageParams, filters, true)
  const limitParam = pageParams.add(limit)
  const offsetParam = pageParams.add(offset)

  // Считаем отдельным запросом, а не оконной функцией: иначе на странице,
  // которая вышла за конец списка, строк нет — и общее число взять неоткуда.
  const countParams = new SqlParams()
  const countWhere = conditions(countParams, filters, false)

  const [rows, counts] = await Promise.all([
    db.$queryRawUnsafe<ListRow[]>(
      `
      SELECT
        c."id",
        c."session_id",
        c."page_url",
        c."referrer",
        c."utm",
        c."message_count",
        c."tokens_in",
        c."tokens_out",
        c."started_at",
        c."last_message_at",
        (SELECT m."content"
           FROM "messages" m
          WHERE m."conversation_id" = c."id" AND m."role" = 'user'::"MessageRole"
          ORDER BY m."created_at" ASC, m."id" ASC
          LIMIT 1) AS first_message,
        COALESCE((SELECT sum(jsonb_array_length(m."apartments"))
                    FROM "messages" m
                   WHERE m."conversation_id" = c."id"
                     AND jsonb_typeof(m."apartments") = 'array'), 0)::int AS apartments_shown,
        l."id"            AS lead_id,
        l."name"          AS lead_name,
        l."phone"         AS lead_phone,
        l."status"::text  AS lead_status
      FROM "conversations" c
      LEFT JOIN LATERAL (
        SELECT ld."id", ld."name", ld."phone", ld."status"
          FROM "leads" ld
         WHERE ld."conversation_id" = c."id"
         ORDER BY ld."created_at" DESC
         LIMIT 1
      ) l ON TRUE
      WHERE ${pageWhere}
      ORDER BY c."last_message_at" DESC, c."id" DESC
      LIMIT ${limitParam} OFFSET ${offsetParam}
      `,
      ...pageParams.values,
    ),
    db.$queryRawUnsafe<CountsRow[]>(
      `
      SELECT
        count(*)::int AS all,
        count(*) FILTER (
          WHERE EXISTS (SELECT 1 FROM "leads" l WHERE l."conversation_id" = c."id")
        )::int AS with_lead
      FROM "conversations" c
      WHERE ${countWhere}
      `,
      ...countParams.values,
    ),
  ])

  const all = counts[0]?.all ?? 0
  const withLead = counts[0]?.with_lead ?? 0
  const total = filters.lead === 'with' ? withLead : filters.lead === 'without' ? all - withLead : all

  return {
    conversations: rows.map(toConversationRow),
    total,
    limit,
    offset,
    counts: { all, withLead, withoutLead: all - withLead },
  }
}

export async function getConversation(db: Db, id: string): Promise<ConversationDetail | null> {
  const conversation = await db.conversation.findUnique({
    where: { id },
    include: {
      messages: { orderBy: [{ createdAt: 'asc' }, { id: 'asc' }], take: CONVERSATION_MESSAGE_LIMIT + 1 },
      leads: { orderBy: { createdAt: 'desc' }, take: 1 },
    },
  })
  if (!conversation) return null

  const truncated = conversation.messages.length > CONVERSATION_MESSAGE_LIMIT
  const rows = truncated ? conversation.messages.slice(0, CONVERSATION_MESSAGE_LIMIT) : conversation.messages

  const messages: MessageView[] = rows.map((row) => ({
    id: row.id,
    role: row.role,
    content: row.content,
    apartments: parseApartments(row.apartments),
    tools: parseToolCalls(row.toolCalls).map((call) => ({
      id: call.id,
      name: call.name,
      input: call.input,
      isError: call.isError === true,
    })),
    model: row.model,
    tokensIn: row.tokensIn,
    tokensOut: row.tokensOut,
    createdAt: row.createdAt,
  }))

  // Одна и та же квартира может встретиться в нескольких подборках —
  // менеджеру нужен список того, что обсуждали, а не история повторов.
  const byId = new Map<string, ApartmentCard>()
  for (const message of messages) {
    for (const card of message.apartments) byId.set(card.id, card)
  }

  const lead = conversation.leads[0] ?? null

  return {
    id: conversation.id,
    sessionId: conversation.sessionId,
    page: conversation.pageUrl,
    referrer: conversation.referrer,
    utm: parseUtm(conversation.utm),
    messageCount: conversation.messageCount,
    tokensIn: conversation.tokensIn,
    tokensOut: conversation.tokensOut,
    startedAt: conversation.startedAt,
    lastMessageAt: conversation.lastMessageAt,
    firstMessage: messages.find((message) => message.role === 'user')?.content ?? null,
    apartmentsShown: byId.size,
    lead: lead
      ? {
          id: lead.id,
          name: lead.name,
          phone: lead.phone,
          phoneFormatted: formatPhone(lead.phone),
          status: lead.status,
        }
      : null,
    userAgent: conversation.userAgent,
    messages,
    apartments: [...byId.values()],
    leadCard: lead ? toLeadView(lead) : null,
    truncated,
  }
}

// ─────────────────────────────────────────────────────────────
//  Маршруты
// ─────────────────────────────────────────────────────────────

/**
 * Границы периода. `from` берётся с начала дня, `to` — до его конца:
 * фильтр «с 1 по 5 июля» должен показывать и переписку пятого вечером.
 */
function parseDay(value: string | undefined, end: boolean): Date | undefined {
  if (value === undefined || value.trim() === '') return undefined
  const text = value.trim()
  const date = new Date(/^\d{4}-\d{2}-\d{2}$/u.test(text) ? `${text}T${end ? '23:59:59.999' : '00:00:00.000'}` : text)
  return Number.isNaN(date.getTime()) ? undefined : date
}

export function toFilters(query: ListQuery): ConversationListFilters {
  const filters: ConversationListFilters = {}
  const from = parseDay(query.from, false)
  if (from) filters.from = from
  const to = parseDay(query.to, true)
  if (to) filters.to = to
  if (query.lead === 'with' || query.lead === 'without') filters.lead = query.lead
  if (query.q && query.q.trim() !== '') filters.query = query.q.trim()
  return filters
}

const conversationsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Querystring: ListQuery }>(
    '/api/admin/conversations',
    { schema: listQuerySchema },
    async (request, reply) => {
      const filters = toFilters(request.query)
      filters.limit = request.query.limit ?? CONVERSATION_LIST_LIMIT
      filters.offset = request.query.offset ?? 0
      return reply.send(await listConversations(app.prisma, filters))
    },
  )

  app.get<{ Params: { id: string } }>('/api/admin/conversations/:id', async (request, reply) => {
    const conversation = await getConversation(app.prisma, request.params.id)
    if (!conversation) return reply.code(404).send({ error: 'not_found', message: 'Переписка не найдена' })
    return reply.send({ conversation })
  })
}

export default conversationsRoutes

// ─────────────────────────────────────────────────────────────
//  Разбор
// ─────────────────────────────────────────────────────────────

function toConversationRow(row: ListRow): ConversationRow {
  return {
    id: row.id,
    sessionId: row.session_id,
    page: row.page_url,
    referrer: row.referrer,
    utm: parseUtm(row.utm),
    messageCount: row.message_count,
    tokensIn: row.tokens_in,
    tokensOut: row.tokens_out,
    startedAt: row.started_at,
    lastMessageAt: row.last_message_at,
    firstMessage: row.first_message,
    apartmentsShown: row.apartments_shown,
    lead:
      row.lead_id === null || row.lead_name === null || row.lead_phone === null
        ? null
        : {
            id: row.lead_id,
            name: row.lead_name,
            phone: row.lead_phone,
            phoneFormatted: formatPhone(row.lead_phone),
            status: row.lead_status ?? 'new',
          },
  }
}

function parseUtm(value: unknown): Record<string, string> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const utm: Record<string, string> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string' && item !== '') utm[key] = item
  }
  return Object.keys(utm).length > 0 ? utm : null
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max)
}
