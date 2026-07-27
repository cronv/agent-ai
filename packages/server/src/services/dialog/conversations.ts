import type { Conversation, Message, Prisma } from '@prisma/client'

import type { Db } from '../../db/prisma.js'
import type { ApartmentCard } from './apartments.js'
import type { StoredMessage, StoredToolCall } from './history.js'

/**
 * Переписка в базе: заведение диалога, чтение истории, запись сообщений.
 *
 *   const conversation = await ensureConversation(db, { sessionId })
 *   const context = await loadDialogContext(db, conversation.id)
 *   await appendMessage(db, { conversationId, role: 'user', content: text })
 *
 * Счётчики диалога (`messageCount`, `lastMessageAt`, расход токенов) обновляются
 * той же транзакцией, что создаёт сообщение: разъехавшиеся счётчики в админке
 * выглядят как потерянные сообщения.
 */

/** Сколько последних сообщений поднимаем из базы под контекст модели. */
export const HISTORY_MESSAGE_LIMIT = 40

export interface ConversationStart {
  /** Идентификатор из localStorage виджета. */
  sessionId: string
  pageUrl?: string | null
  referrer?: string | null
  utm?: Record<string, string> | null
  userAgent?: string | null
}

/**
 * Находит диалог по сессии или заводит новый.
 * Данные страницы записываются только при создании: посетитель ходит по сайту,
 * и переписывать источник на каждом сообщении значит потерять точку входа.
 */
export async function ensureConversation(db: Db, start: ConversationStart): Promise<Conversation> {
  const existing = await db.conversation.findUnique({ where: { sessionId: start.sessionId } })
  if (existing) return existing

  const data: Prisma.ConversationCreateInput = { sessionId: start.sessionId }
  if (start.pageUrl) data.pageUrl = start.pageUrl
  if (start.referrer) data.referrer = start.referrer
  if (start.userAgent) data.userAgent = start.userAgent
  if (start.utm && Object.keys(start.utm).length > 0) data.utm = start.utm as Prisma.InputJsonValue

  return db.conversation.create({ data })
}

/** Всё, что нужно знать движку о ходе разговора перед запросом к модели. */
export interface DialogContext {
  messages: StoredMessage[]
  /** Сколько сообщений написал посетитель за всю переписку. */
  visitorMessages: number
  /** Показывали ли уже подборку — от этого зависит, можно ли просить контакт. */
  apartmentsShown: boolean
  /** Сколько раз посетитель написал после последней подборки: это и есть его интерес. */
  messagesSinceApartments: number
  /** Контакт уже оставлен — второй раз просить не нужно. */
  leadCaptured: boolean
}

export async function loadDialogContext(
  db: Db,
  conversationId: string,
  limit: number = HISTORY_MESSAGE_LIMIT,
): Promise<DialogContext> {
  const [rows, visitorMessages, leads] = await Promise.all([
    db.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),
    db.message.count({ where: { conversationId, role: 'user' } }),
    db.lead.count({ where: { conversationId } }),
  ])

  // Считаем по поднятым сообщениям: подборка из позапрошлого года на решение
  // «пора ли просить контакт» всё равно не влияет.
  const ordered = rows.reverse()
  let apartmentsShown = false
  let messagesSinceApartments = 0
  for (const row of ordered) {
    if (Array.isArray(row.apartments) && row.apartments.length > 0) {
      apartmentsShown = true
      messagesSinceApartments = 0
    } else if (apartmentsShown && row.role === 'user') {
      messagesSinceApartments += 1
    }
  }

  return {
    messages: ordered.map(toStoredMessage),
    visitorMessages,
    apartmentsShown,
    messagesSinceApartments,
    leadCaptured: leads > 0,
  }
}

export interface AppendMessageInput {
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  apartments?: ApartmentCard[] | undefined
  toolCalls?: StoredToolCall[] | undefined
  model?: string | undefined
  tokensIn?: number | undefined
  tokensOut?: number | undefined
}

export async function appendMessage(db: Db, input: AppendMessageInput): Promise<Message> {
  const data: Prisma.MessageUncheckedCreateInput = {
    conversationId: input.conversationId,
    role: input.role,
    content: input.content,
  }
  if (input.apartments && input.apartments.length > 0) {
    data.apartments = input.apartments as unknown as Prisma.InputJsonValue
  }
  if (input.toolCalls && input.toolCalls.length > 0) {
    data.toolCalls = input.toolCalls as unknown as Prisma.InputJsonValue
  }
  if (input.model) data.model = input.model
  if (input.tokensIn !== undefined) data.tokensIn = input.tokensIn
  if (input.tokensOut !== undefined) data.tokensOut = input.tokensOut

  const [message] = await db.$transaction([
    db.message.create({ data }),
    db.conversation.update({
      where: { id: input.conversationId },
      data: {
        messageCount: { increment: 1 },
        lastMessageAt: new Date(),
        tokensIn: { increment: input.tokensIn ?? 0 },
        tokensOut: { increment: input.tokensOut ?? 0 },
      },
    }),
  ])

  return message
}

function toStoredMessage(row: Message): StoredMessage {
  const stored: StoredMessage = { role: row.role, content: row.content }
  const calls = parseToolCalls(row.toolCalls)
  if (calls.length > 0) stored.toolCalls = calls
  return stored
}

/** Разбирает `Message.toolCalls`: в базе это Json, читать его нужно осторожно. */
export function parseToolCalls(value: unknown): StoredToolCall[] {
  if (!Array.isArray(value)) return []
  const calls: StoredToolCall[] = []
  for (const item of value) {
    if (typeof item !== 'object' || item === null) continue
    const record = item as Record<string, unknown>
    const id = record['id']
    const name = record['name']
    const result = record['result']
    if (typeof id !== 'string' || typeof name !== 'string' || typeof result !== 'string') continue
    const call: StoredToolCall = { id, name, input: record['input'] ?? {}, result }
    if (record['isError'] === true) call.isError = true
    calls.push(call)
  }
  return calls
}
