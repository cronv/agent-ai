import type { Lead, LeadStatus, Prisma } from '@prisma/client'

import type { Db } from '../../db/prisma.js'
import type { ApartmentCard } from '../dialog/apartments.js'
import { ensureConversation } from '../dialog/conversations.js'
import type { LeadHandler, LeadInput } from '../dialog/leads.js'
import type { SettingsService } from '../settings/index.js'
import { formatPhone, normalizePhone, phoneSearchFragments } from './phone.js'
import {
  deliverLeadWebhook,
  type FetchLike,
  type LeadWebhookPayload,
} from './webhook.js'

/**
 * Лиды: единственное место, где контакт попадает в базу.
 *
 *   const lead = await app.leads.capture({ sessionId, name, phone, consent: true })
 *   new DialogEngine({ db, settings, saveLead: app.leads.captureFromDialog })
 *
 * Оба пути — форма в виджете и инструмент `save_lead` — приходят сюда. Иначе
 * получились бы два набора правил для одного и того же: телефон нормализуется
 * в одном месте, дубли ищутся в одном месте, вебхук уходит один раз.
 *
 * ── Что здесь важно ────────────────────────────────────────────────────────
 *
 * Согласие. Без него лид не создаётся вообще — это 152-ФЗ, а не поле формы.
 * В диалоге согласием считается явное «да» человека: инструмент `save_lead`
 * модель вызывает только после него, и момент вызова — момент согласия.
 *
 * Дубли. Человек заполняет форму дважды — уточнил телефон, дописал вопрос.
 * Второй лид из той же сессии не создаётся: обновляется первый. Менеджеру
 * нужен один контакт с последними данными, а не два похожих.
 *
 * Вебхук. Уходит фоном, после того как лид уже в базе. Лежащий на той стороне
 * amoCRM не должен ни задерживать ответ виджету, ни тем более терять контакт:
 * ошибка пишется в лог и остаётся на лиде в `webhookError` — админка показывает
 * её в карточке, и менеджер знает, что заявку нужно перенести руками.
 */

/** Лид в том виде, в каком его отдаёт API. */
export interface LeadView {
  id: string
  conversationId: string | null
  name: string
  phone: string
  /** Тот же номер для показа человеку: `+7 (912) 345-67-89`. */
  phoneFormatted: string
  comment: string | null
  status: LeadStatus
  consentAt: Date | null
  /** Квартиры, показанные в диалоге к моменту оставления контакта. */
  apartments: ApartmentCard[]
  webhookStatus: 'skipped' | 'sent' | 'failed'
  /** Текст ошибки последней отправки — админка показывает его в карточке. */
  webhookError: string | null
  webhookAt: Date | null
  createdAt: Date
  updatedAt: Date
}

/** Ошибка заполнения контакта. Текст написан для человека, а не для лога. */
export class LeadValidationError extends Error {
  constructor(
    public readonly field: 'name' | 'phone' | 'consent' | 'session',
    message: string,
  ) {
    super(message)
    this.name = 'LeadValidationError'
  }
}

export interface LeadCaptureInput {
  /** Идентификатор сессии виджета. Диалог заводится, если его ещё нет. */
  sessionId?: string | null
  /** Прямая ссылка на диалог — так приходит вызов из движка. */
  conversationId?: string | null
  name: string
  phone: string
  comment?: string | null
  /** Галочка согласия на обработку персональных данных. */
  consent: boolean
  /** Страница, с которой пришёл контакт, — если диалога ещё нет. */
  page?: string | null
  referrer?: string | null
  utm?: Record<string, string> | null
}

export interface LeadsLogger {
  error(details: Record<string, unknown>, message: string): void
  info(details: Record<string, unknown>, message: string): void
}

export interface LeadServiceOptions {
  db: Db
  settings: SettingsService
  logger?: LeadsLogger
  /** Подменяется в тестах: в интернет тесты не ходят. */
  fetchImpl?: FetchLike
  webhookTimeoutMs?: number
  webhookRetryDelayMs?: number
}

export interface LeadListFilters {
  status?: LeadStatus | undefined
  /** Включительно, с начала дня. */
  from?: Date | undefined
  /** Включительно, до конца дня. */
  to?: Date | undefined
  /** Поиск по имени и телефону. */
  query?: string | undefined
  limit?: number | undefined
  offset?: number | undefined
}

/** Строка списка: лид плюс то, откуда он пришёл. */
export interface LeadRow extends LeadView {
  conversation: {
    id: string
    sessionId: string
    page: string | null
    referrer: string | null
    utm: Record<string, string> | null
    messageCount: number
    startedAt: Date
  } | null
}

export const LEAD_LIST_LIMIT = 50
export const LEAD_LIST_MAX_LIMIT = 500
/** Потолок выгрузки: больше в CSV отдавать бессмысленно, это не бэкап базы. */
export const LEAD_EXPORT_LIMIT = 10_000

const MAX_NAME_LENGTH = 100
const MAX_COMMENT_LENGTH = 1000
/** Сколько карточек квартир сохраняем на лиде. */
const MAX_LEAD_APARTMENTS = 20

const CONSENT_ERROR =
  'Без согласия на обработку персональных данных мы не можем сохранить контакт — поставьте галочку.'

export class LeadService {
  private readonly db: Db
  private readonly settings: SettingsService
  private readonly logger: LeadsLogger
  private readonly fetchImpl: FetchLike | undefined
  private readonly webhookTimeoutMs: number | undefined
  private readonly webhookRetryDelayMs: number | undefined

  /** Отправки, которые ещё летят. Тесты ждут их через `whenIdle()`. */
  private readonly pending = new Set<Promise<void>>()

  constructor(options: LeadServiceOptions) {
    this.db = options.db
    this.settings = options.settings
    this.logger = options.logger ?? consoleLogger
    this.fetchImpl = options.fetchImpl
    this.webhookTimeoutMs = options.webhookTimeoutMs
    this.webhookRetryDelayMs = options.webhookRetryDelayMs
  }

  // ── Приём контакта ────────────────────────────────────────

  /**
   * Контакт из формы виджета.
   * Бросает `LeadValidationError`, если данных не хватает или они не разобрались.
   */
  async capture(input: LeadCaptureInput, db: Db = this.db): Promise<LeadView> {
    if (input.consent !== true) throw new LeadValidationError('consent', CONSENT_ERROR)

    const name = typeof input.name === 'string' ? input.name.trim().slice(0, MAX_NAME_LENGTH) : ''
    if (name.length < 2) {
      throw new LeadValidationError('name', 'Как к вам обращаться? Имя нужно из двух букв и длиннее.')
    }

    const phone = normalizePhone(input.phone)
    if (!phone.ok) throw new LeadValidationError('phone', phone.error)

    const comment =
      typeof input.comment === 'string' && input.comment.trim() !== ''
        ? input.comment.trim().slice(0, MAX_COMMENT_LENGTH)
        : null

    const conversationId = await this.resolveConversationId(input, db)
    const apartments = conversationId === null ? [] : await this.apartmentsShown(conversationId, db)

    const data = {
      name,
      phone: phone.phone,
      comment,
      consentAt: new Date(),
      apartments: apartments as unknown as Prisma.InputJsonValue,
    }

    // Тот же человек в той же сессии — это тот же лид. Он мог уточнить телефон
    // или дописать вопрос; заводить вторую карточку значит заставить менеджера
    // звонить дважды.
    const existing =
      conversationId === null
        ? null
        : await db.lead.findFirst({ where: { conversationId }, orderBy: { createdAt: 'desc' } })

    const lead = existing
      ? await db.lead.update({ where: { id: existing.id }, data })
      : await db.lead.create({ data: { ...data, conversationId } })

    this.dispatchWebhook(lead.id, db)
    return toLeadView(lead)
  }

  /**
   * Обработчик для движка диалога.
   *
   *   new DialogEngine({ db, settings, saveLead: leads.captureFromDialog })
   *
   * Стрелка, а не метод: её передают как значение, и `this` должен уехать вместе
   * с ней. Согласие проставляется здесь потому, что модель вызывает `save_lead`
   * только после явного «да» — это и есть момент согласия.
   */
  readonly captureFromDialog: LeadHandler = async (input: LeadInput, context) => {
    const capture: LeadCaptureInput = {
      conversationId: context.conversationId,
      name: input.name,
      phone: input.phone,
      comment: input.comment ?? null,
      consent: true,
    }
    return this.capture(capture, context.db ?? this.db)
  }

  // ── Список, статус, выгрузка ──────────────────────────────

  async list(filters: LeadListFilters = {}): Promise<{ leads: LeadRow[]; total: number; limit: number; offset: number }> {
    const where = buildWhere(filters)
    const limit = clamp(filters.limit ?? LEAD_LIST_LIMIT, 1, LEAD_LIST_MAX_LIMIT)
    const offset = Math.max(filters.offset ?? 0, 0)

    const [rows, total] = await Promise.all([
      this.db.lead.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: limit,
        skip: offset,
        include: { conversation: true },
      }),
      this.db.lead.count({ where }),
    ])

    return { leads: rows.map(toLeadRow), total, limit, offset }
  }

  /** Сколько лидов в каждом статусе — цифры на вкладках фильтра. */
  async countByStatus(filters: LeadListFilters = {}): Promise<Record<LeadStatus | 'all', number>> {
    const where = buildWhere({ ...filters, status: undefined })
    const rows = await this.db.lead.groupBy({ by: ['status'], where, _count: { _all: true } })
    const counts: Record<string, number> = { all: 0, new: 0, in_progress: 0, reached: 0, rejected: 0 }
    for (const row of rows) {
      counts[row.status] = row._count._all
      counts['all'] = (counts['all'] ?? 0) + row._count._all
    }
    return counts as Record<LeadStatus | 'all', number>
  }

  async updateStatus(id: string, status: LeadStatus): Promise<LeadRow | null> {
    const existing = await this.db.lead.findUnique({ where: { id } })
    if (!existing) return null
    const lead = await this.db.lead.update({ where: { id }, data: { status }, include: { conversation: true } })
    return toLeadRow(lead)
  }

  /** Те же фильтры, что и в списке, но без постраничной навигации. */
  async listForExport(filters: LeadListFilters = {}): Promise<LeadRow[]> {
    const rows = await this.db.lead.findMany({
      where: buildWhere(filters),
      orderBy: { createdAt: 'desc' },
      take: LEAD_EXPORT_LIMIT,
      include: { conversation: true },
    })
    return rows.map(toLeadRow)
  }

  // ── Вебхук ────────────────────────────────────────────────

  /**
   * Ждёт, пока улетят все отправки. Нужно тестам и остановке приложения:
   * оборвать доставку на полуслове — значит потерять лид на той стороне.
   */
  async whenIdle(): Promise<void> {
    while (this.pending.size > 0) {
      await Promise.all([...this.pending])
    }
  }

  /** Запускает отправку в фоне: ответ виджету не должен ждать чужой сервер. */
  private dispatchWebhook(leadId: string, db: Db): void {
    const task = this.sendWebhook(leadId, db)
      .catch((error: unknown) => {
        this.logger.error({ leadId, err: describeError(error) }, 'Не удалось обработать отправку лида в вебхук')
      })
      .finally(() => {
        this.pending.delete(task)
      })
    this.pending.add(task)
  }

  private async sendWebhook(leadId: string, db: Db): Promise<void> {
    const url = (await this.settings.get('lead_webhook_url')).trim()
    if (url === '') return

    const lead = await db.lead.findUnique({ where: { id: leadId }, include: { conversation: true } })
    if (!lead) return

    const options: Parameters<typeof deliverLeadWebhook>[0] = { url, payload: buildPayload(toLeadRow(lead)) }
    if (this.fetchImpl) options.fetchImpl = this.fetchImpl
    if (this.webhookTimeoutMs !== undefined) options.timeoutMs = this.webhookTimeoutMs
    if (this.webhookRetryDelayMs !== undefined) options.retryDelayMs = this.webhookRetryDelayMs

    const result = await deliverLeadWebhook(options)

    if (result.ok) {
      this.logger.info({ leadId }, 'Лид отправлен в вебхук')
    } else {
      this.logger.error({ leadId, err: result.error }, 'Вебхук не принял лид')
    }

    await db.lead.update({
      where: { id: leadId },
      data: {
        webhookStatus: result.ok ? 'sent' : 'failed',
        webhookError: result.ok ? null : result.error,
        webhookAt: new Date(),
      },
    })
  }

  // ── Внутреннее ────────────────────────────────────────────

  private async resolveConversationId(input: LeadCaptureInput, db: Db): Promise<string | null> {
    if (input.conversationId) {
      const found = await db.conversation.findUnique({ where: { id: input.conversationId }, select: { id: true } })
      if (found) return found.id
      throw new LeadValidationError('session', 'Диалог не найден. Обновите страницу и попробуйте ещё раз.')
    }

    const sessionId = typeof input.sessionId === 'string' ? input.sessionId.trim() : ''
    if (sessionId === '') return null

    const start: Parameters<typeof ensureConversation>[1] = { sessionId }
    if (input.page) start.pageUrl = input.page
    if (input.referrer) start.referrer = input.referrer
    if (input.utm) start.utm = input.utm
    const conversation = await ensureConversation(db, start)
    return conversation.id
  }

  /**
   * Квартиры, которые ассистент показал за диалог. Берём их из сохранённых
   * сообщений, а не пересчитываем поиском: важно, что человек видел на экране,
   * а не что нашлось бы сейчас.
   */
  private async apartmentsShown(conversationId: string, db: Db): Promise<ApartmentCard[]> {
    const rows = await db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      select: { apartments: true },
      take: 200,
    })

    const byId = new Map<string, ApartmentCard>()
    for (const row of rows) {
      for (const card of parseApartments(row.apartments)) {
        byId.set(card.id, card)
      }
    }
    return [...byId.values()].slice(-MAX_LEAD_APARTMENTS)
  }
}

// ── Разбор и сборка ──────────────────────────────────────────

export function parseApartments(value: unknown): ApartmentCard[] {
  if (!Array.isArray(value)) return []
  return value.filter(
    (item): item is ApartmentCard =>
      typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string',
  )
}

function parseUtm(value: unknown): Record<string, string> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const utm: Record<string, string> = {}
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (typeof item === 'string' && item !== '') utm[key] = item
  }
  return Object.keys(utm).length > 0 ? utm : null
}

type LeadWithConversation = Lead & {
  conversation?: {
    id: string
    sessionId: string
    pageUrl: string | null
    referrer: string | null
    utm: unknown
    messageCount: number
    startedAt: Date
  } | null
}

export function toLeadView(lead: Lead): LeadView {
  return {
    id: lead.id,
    conversationId: lead.conversationId,
    name: lead.name,
    phone: lead.phone,
    phoneFormatted: formatPhone(lead.phone),
    comment: lead.comment,
    status: lead.status,
    consentAt: lead.consentAt,
    apartments: parseApartments(lead.apartments),
    webhookStatus: lead.webhookStatus,
    webhookError: lead.webhookError,
    webhookAt: lead.webhookAt,
    createdAt: lead.createdAt,
    updatedAt: lead.updatedAt,
  }
}

export function toLeadRow(lead: LeadWithConversation): LeadRow {
  const conversation = lead.conversation
  return {
    ...toLeadView(lead),
    conversation: conversation
      ? {
          id: conversation.id,
          sessionId: conversation.sessionId,
          page: conversation.pageUrl,
          referrer: conversation.referrer,
          utm: parseUtm(conversation.utm),
          messageCount: conversation.messageCount,
          startedAt: conversation.startedAt,
        }
      : null,
  }
}

/**
 * Тело вебхука. Поля и их имена — контракт с amo-воркером пользователя.
 *
 * `comment` собирается из того, что написал человек, и того, что он смотрел:
 * менеджер открывает карточку в CRM и сразу видит, о каких квартирах речь,
 * не заходя в админку.
 */
export function buildPayload(lead: LeadRow): LeadWebhookPayload {
  const parts: string[] = []
  if (lead.comment) parts.push(lead.comment)
  if (lead.apartments.length > 0) {
    parts.push('Смотрел в чате:\n' + lead.apartments.map(describeApartment).join('\n'))
  }

  return {
    name: lead.name,
    phone: lead.phone,
    lead_name: `Заявка из чата — ${lead.name}`,
    comment: parts.join('\n\n'),
    meta: {
      page: lead.conversation?.page ?? null,
      referrer: lead.conversation?.referrer ?? null,
      utm: lead.conversation?.utm ?? null,
    },
  }
}

export function describeApartment(card: ApartmentCard): string {
  const parts: string[] = []
  if (card.projectName) parts.push(card.projectName)
  if (card.rooms !== null && card.rooms !== undefined) {
    parts.push(card.rooms === 0 ? 'студия' : `${card.rooms}-к`)
  }
  if (card.area) parts.push(`${formatNumber(card.area)} м²`)
  if (card.floor !== null && card.floor !== undefined) {
    parts.push(card.floorsTotal ? `${card.floor}/${card.floorsTotal} эт.` : `${card.floor} эт.`)
  }
  parts.push(`${formatNumber(card.price)} ₽`)
  return `— ${parts.join(', ')}`
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 1 }).format(value)
}

function buildWhere(filters: LeadListFilters): Prisma.LeadWhereInput {
  const where: Prisma.LeadWhereInput = {}
  if (filters.status) where.status = filters.status

  if (filters.from || filters.to) {
    where.createdAt = {
      ...(filters.from ? { gte: filters.from } : {}),
      ...(filters.to ? { lte: filters.to } : {}),
    }
  }

  const query = filters.query?.trim() ?? ''
  if (query !== '') {
    const or: Prisma.LeadWhereInput[] = [{ name: { contains: query, mode: 'insensitive' } }]
    // По телефону ищут кусками: «345-67», «8 912». Целиком номер вводят редко,
    // поэтому ищем вхождение — и сразу в двух вариантах, с кодом страны и без:
    // «8 912…» должно находить номер, сохранённый как «+7 912…».
    for (const fragment of phoneSearchFragments(query)) {
      or.push({ phone: { contains: fragment } })
    }
    where.OR = or
  }

  return where
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(Math.round(value), min), max)
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

const consoleLogger: LeadsLogger = {
  error(details, message) {
    console.error(message, details)
  },
  info() {
    /* по умолчанию молчим: успешная отправка — не новость */
  },
}
