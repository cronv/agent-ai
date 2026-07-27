/**
 * Движок диалога: Claude с инструментами подбора.
 *
 *   import { DialogEngine, ensureConversation } from '../services/dialog/index.js'
 *
 *   const conversation = await ensureConversation(app.prisma, { sessionId })
 *   const engine = new DialogEngine({ db: app.prisma, settings: app.settings, logger: app.log })
 *
 *   for await (const event of engine.reply({ conversationId: conversation.id, message })) {
 *     reply.sse.send(event)
 *   }
 *
 * Слои разделены так же, как в остальных сервисах:
 *   client.ts        — порт к Anthropic; единственное, что подменяется в тестах;
 *   tools.ts         — схемы четырёх инструментов;
 *   apartments.ts    — запросы к каталогу, проверяются без всякой модели;
 *   execute.ts       — разбор параметров от модели и исполнение инструментов;
 *   leads.ts         — сохранение контакта; точка расширения для тикета 07;
 *   prompt.ts        — сборка системного промпта;
 *   model.ts         — выбор модели по признакам запроса;
 *   history.ts       — история для модели и её обрезка по бюджету;
 *   conversations.ts — переписка в базе и счётчики диалога;
 *   engine.ts        — цикл tool use и поток событий наружу.
 */

export * from './apartments.js'
export * from './client.js'
export * from './conversations.js'
export * from './engine.js'
export * from './execute.js'
export * from './history.js'
export * from './leads.js'
export * from './model.js'
export * from './prompt.js'
export * from './tools.js'
