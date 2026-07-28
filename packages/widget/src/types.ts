import type { Pacing } from './pacing.ts'

/**
 * Типы того, что приходит с сервера. Повторяют контракт публичного API
 * (`packages/server/src/routes/chat.routes.ts`) — виджет собирается отдельно
 * от сервера и импортировать его типы не может.
 */

/** Квартира в том виде, в каком её отдаёт сервер в событии `apartments`. */
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
  /** Срок сдачи в формате `YYYY-MM-DD`. */
  deadline: string | null
  planImageUrl: string | null
  url: string | null
}

/** Публичные настройки — `GET /api/widget/config`. */
export interface WidgetConfig {
  enabled: boolean
  title: string
  accentColor: string
  greeting: string
  exampleQuestions: string[]
  privacyPolicyUrl: string | null
  /** Человеческий ритм ответа: пауза, темп печати, разбивка на сообщения. */
  rhythm: Pacing
}

/** Контакт, сохранённый ассистентом (событие `lead`) или формой в ленте. */
export interface SavedLead {
  id: string
  name: string
  phone: string
  /** `+7 (912) 345-67-89` — так номер показывают в подтверждении. Есть только у ответа формы. */
  phoneFormatted?: string | null
  comment: string | null
}

/** События SSE из `POST /api/chat`, разобранные в объекты. */
export type ChatStreamEvent =
  | { type: 'ready'; conversationId: string; sessionId: string }
  | { type: 'text'; text: string }
  | { type: 'tool'; name: string }
  | { type: 'apartments'; apartments: ApartmentCard[] }
  | { type: 'lead'; lead: SavedLead }
  | { type: 'error'; message: string }
  | { type: 'done' }

/** Сообщение из истории — `GET /api/chat/:sessionId`. */
export interface HistoryMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  apartments: ApartmentCard[]
  createdAt: string
}

/**
 * Элемент ленты чата.
 *
 * Приветствия здесь нет: сервер его не хранит, оно приходит из настроек и
 * рисуется поверх ленты, пока переписки ещё нет.
 */
export type FeedItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; apartments: ApartmentCard[]; failed: boolean }

/** Что виджет показывает человеку, когда что-то пошло не так. */
export interface ChatError {
  /** Текст для человека, без кодов и стека. */
  message: string
  /** Есть ли смысл предлагать «Повторить». */
  retriable: boolean
}
