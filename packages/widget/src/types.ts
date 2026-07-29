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
  /** «свободная планировка», «многокомнатная» — когда комнатность числом не выражается. */
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
  /** Срок сдачи в формате `YYYY-MM-DD`. */
  deadline: string | null
  /**
   * Дом построен и введён в эксплуатацию. Тогда на карточке стоит «Дом сдан»,
   * а не срок: у сданного корпуса он в прошлом и читается как ошибка базы.
   * У переписок, сохранённых до тикета 24, поля нет вовсе.
   */
  isReady?: boolean | null
  planImageUrl: string | null
  /**
   * Фотографии объекта. Показываются вместо планировки, когда её нет:
   * во вторичке планировок не дают, а карточка без картинки — не витрина.
   * У переписок, сохранённых до тикета 20, поля нет вовсе.
   */
  photos?: string[]
  url: string | null
  /**
   * Адрес карточки ЖК на сайте агентства.
   *
   * Запасной адрес для клика по карточке: у лота из ДомКлика своего адреса нет
   * вовсе, и без этого поля вести человека было бы некуда. У переписок,
   * сохранённых до тикета 22, поля нет — тогда его просто нет.
   */
  projectUrl?: string | null
}

/** Ссылка на карточку ЖК — кнопка перехода под ответом ассистента. */
export interface ProjectLink {
  id: string
  name: string
  url: string
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
  /** Кнопки быстрых ответов под сообщением ассистента. */
  quickReplies: boolean
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
  /** Реплики для кнопок под ответом — их придумала модель, не виджет. */
  | { type: 'suggestions'; options: string[] }
  /** Кнопки перехода на карточки ЖК: повод для них решил сервер. */
  | { type: 'projects'; projects: ProjectLink[] }
  | { type: 'lead'; lead: SavedLead }
  | { type: 'error'; message: string }
  | { type: 'done' }

/** Сообщение из истории — `GET /api/chat/:sessionId`. */
export interface HistoryMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  apartments: ApartmentCard[]
  /** Кнопки перехода на ЖК, которые были под этим ответом. */
  projects?: ProjectLink[]
  createdAt: string
}

/** Ответ `GET /api/chat/:sessionId`: переписка и то, что уже выбрано. */
export interface ChatHistory {
  messages: HistoryMessage[]
  /** Идентификаторы квартир, отмеченных кнопкой «Выбрать» за этот диалог. */
  selectedIds: string[]
  /**
   * Кнопки перехода на ЖК из последнего ответа ассистента.
   *
   * Только из последнего: под каждым ответом переписки они превратились бы
   * в частокол ссылок, а к месту они там, где разговор остановился.
   */
  projects: ProjectLink[]
}

/** Ответ `POST /api/chat/select` — итог нажатия «Выбрать» на карточке. */
export interface SelectionResult {
  /** Выбор записан. `false` — эту квартиру уже выбирали раньше. */
  selected: boolean
  /** Контакт уже был оставлен, и обновлённый лид ушёл менеджеру сразу. */
  sentToManager: boolean
  /** Реплика, которая встала в переписку: «Выбрал: двухкомнатная, …». */
  text: string
}

/**
 * Элемент ленты чата.
 *
 * Приветствия здесь нет: сервер его не хранит, оно приходит из настроек и
 * рисуется поверх ленты, пока переписки ещё нет.
 *
 * `note` — служебная строка виджета: «передал менеджеру», «не получилось
 * отметить». В базе её нет и быть не должно: это рассказ о том, что сделал
 * виджет, а не реплика разговора.
 */
export type FeedItem =
  | { kind: 'user'; id: string; text: string }
  | { kind: 'assistant'; id: string; text: string; apartments: ApartmentCard[]; failed: boolean }
  | { kind: 'note'; id: string; text: string; tone: 'ok' | 'bad' }

/** Что виджет показывает человеку, когда что-то пошло не так. */
export interface ChatError {
  /** Текст для человека, без кодов и стека. */
  message: string
  /** Есть ли смысл предлагать «Повторить». */
  retriable: boolean
}
