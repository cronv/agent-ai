/**
 * Переписки и лиды в том виде, в каком их отдаёт админский API.
 *
 * Те же поля, что у `ConversationRow`, `MessageView` и `LeadRow` на сервере
 * (`routes/admin/conversations.routes.ts`, `services/leads/leads.service.ts`),
 * только даты приходят строками, как их сериализует JSON.
 *
 * Общий файл на два раздела: список лидов и карточка диалога показывают одни
 * и те же квартиры и один и тот же контакт — расходиться в типах им нельзя.
 */

/** Квартира, показанная в чате. Приходит и в сообщении, и на лиде. */
export interface ApartmentCardView {
  id: string
  projectId: string | null
  projectName: string | null
  developer: string | null
  district: string | null
  metro: string | null
  metroDistanceMin: number | null
  rooms: number | null
  /** «свободная планировка», «многокомнатная» — вместо числа комнат. */
  planType?: string | null
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
  deadline: string | null
  /** Дом построен и введён. У переписок, сохранённых до тикета 24, поля нет. */
  isReady?: boolean | null
  planImageUrl: string | null
  /** Фотографии объекта. У переписок, сохранённых до тикета 20, их нет. */
  photos?: string[]
  url: string | null
}

export type LeadStatus = 'new' | 'in_progress' | 'reached' | 'rejected'

/** Наличие контакта — фильтр списка переписок. */
export type LeadPresence = 'with' | 'without'

// ── Переписки ────────────────────────────────────────────────

export interface ConversationLead {
  id: string
  name: string
  phone: string
  phoneFormatted: string
  status: LeadStatus
}

export interface ConversationRow {
  id: string
  sessionId: string
  page: string | null
  referrer: string | null
  utm: Record<string, string> | null
  messageCount: number
  tokensIn: number
  tokensOut: number
  startedAt: string
  lastMessageAt: string
  firstMessage: string | null
  apartmentsShown: number
  lead: ConversationLead | null
}

export interface ConversationListResponse {
  conversations: ConversationRow[]
  total: number
  limit: number
  offset: number
  counts: { all: number; withLead: number; withoutLead: number }
}

export interface MessageView {
  id: string
  role: 'user' | 'assistant'
  content: string
  apartments: ApartmentCardView[]
  tools: { id: string; name: string; input: unknown; isError: boolean }[]
  model: string | null
  tokensIn: number | null
  tokensOut: number | null
  createdAt: string
}

export interface ConversationDetail extends ConversationRow {
  userAgent: string | null
  messages: MessageView[]
  apartments: ApartmentCardView[]
  leadCard: LeadCard | null
  truncated: boolean
}

export interface ConversationResponse {
  conversation: ConversationDetail
}

// ── Лиды ─────────────────────────────────────────────────────

/** Сам контакт. В карточке диалога приходит именно он. */
export interface LeadCard {
  id: string
  conversationId: string | null
  name: string
  phone: string
  /** Тот же номер для показа человеку: `+7 (912) 345-67-89`. */
  phoneFormatted: string
  comment: string | null
  status: LeadStatus
  consentAt: string | null
  apartments: ApartmentCardView[]
  /**
   * Квартиры, которые посетитель отметил кнопкой «Выбрать».
   * Это не то же, что показанные: показали пять, выбрал одну — звонить
   * менеджер будет про неё.
   */
  selectedApartments: ApartmentCardView[]
  webhookStatus: 'skipped' | 'sent' | 'failed'
  webhookError: string | null
  webhookAt: string | null
  createdAt: string
  updatedAt: string
}

/** Строка списка лидов: контакт плюс то, откуда он пришёл. */
export interface LeadRow extends LeadCard {
  conversation: {
    id: string
    sessionId: string
    page: string | null
    referrer: string | null
    utm: Record<string, string> | null
    messageCount: number
    startedAt: string
  } | null
}

export interface LeadListResponse {
  leads: LeadRow[]
  total: number
  limit: number
  offset: number
  counts: Record<LeadStatus | 'all', number>
}

/** Подписи статусов — те же слова, что уходят в CSV. */
export const LEAD_STATUS_LABELS: Record<LeadStatus, string> = {
  new: 'Новый',
  in_progress: 'В работе',
  reached: 'Дозвонился',
  rejected: 'Отказ',
}

export const LEAD_STATUSES: LeadStatus[] = ['new', 'in_progress', 'reached', 'rejected']

/** Цвет ярлыка статуса. Рядом всегда есть текст — цвет не единственный признак. */
export const LEAD_STATUS_TONES: Record<LeadStatus, 'accent' | 'warn' | 'ok' | 'neutral'> = {
  new: 'accent',
  in_progress: 'warn',
  reached: 'ok',
  rejected: 'neutral',
}

/** Понятные названия инструментов ассистента — «search_apartments» менеджеру ни о чём не говорит. */
export const TOOL_LABELS: Record<string, string> = {
  search_apartments: 'подбирал квартиры',
  list_projects: 'смотрел список ЖК',
  search_knowledge: 'искал в базе знаний',
  save_lead: 'сохранил контакт',
  suggest_replies: 'предложил кнопки ответов',
}

/**
 * `https://site.ru/zhk-severny?utm_source=yandex` → `site.ru/zhk-severny`.
 * В таблице важен путь, а не протокол с хвостом меток.
 */
export function shortUrl(value: string | null): string | null {
  if (value === null || value.trim() === '') return null
  try {
    const url = new URL(value)
    const path = url.pathname === '/' ? '' : url.pathname.replace(/\/$/, '')
    return `${url.host}${path}`
  } catch {
    return value
  }
}

/** Метки одной строкой: `yandex / cpc / leto-2026`. */
export function utmSummary(utm: Record<string, string> | null): string | null {
  if (!utm) return null
  const parts = [utm['utm_source'], utm['utm_medium'], utm['utm_campaign']].filter(
    (part): part is string => typeof part === 'string' && part !== '',
  )
  return parts.length > 0 ? parts.join(' / ') : null
}
