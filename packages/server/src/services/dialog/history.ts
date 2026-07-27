import type { ModelBlock, ModelMessage } from './client.js'

/**
 * История диалога для модели.
 *
 *   const history = trimHistory(buildHistory(rows))
 *
 * Переписка хранится в базе построчно: роль, текст, вызовы инструментов
 * с результатами. Модель ждёт другую форму — цепочку сообщений, где вызов
 * инструмента и его результат идут отдельными репликами. `buildHistory`
 * переводит одно в другое, `trimHistory` укладывает результат в бюджет.
 *
 * ── Почему обрезка сложнее, чем «взять последние N сообщений» ──────────────
 *
 * Anthropic отвергает запрос, в котором `tool_result` встретился раньше своего
 * `tool_use`. Наивная обрезка по количеству сообщений разрежет пару ровно
 * посередине — и диалог будет падать с 400 ровно на длинных переписках,
 * то есть на самых ценных.
 *
 * Поэтому обрезка идёт до безопасной границы: началом истории может быть
 * только реплика посетителя, состоящая из одного текста. Всё, что осталось
 * от разрезанной пары, отбрасывается целиком.
 */

/** Вызов инструмента в том виде, в каком он лежит в `Message.toolCalls`. */
export interface StoredToolCall {
  id: string
  name: string
  input: unknown
  /** Результат, который получила модель, — JSON-строка. */
  result: string
  isError?: boolean
}

/** Строка переписки из базы. */
export interface StoredMessage {
  role: 'user' | 'assistant'
  content: string
  toolCalls?: StoredToolCall[] | null
}

/**
 * Бюджет истории в символах. ~24 000 символов — это порядка 8 000 токенов:
 * с запасом хватает на десяток ходов с подборками и не съедает контекст,
 * который нужен под ответы инструментов текущего сообщения.
 */
export const HISTORY_CHAR_BUDGET = 24_000

export function buildHistory(messages: StoredMessage[]): ModelMessage[] {
  const result: ModelMessage[] = []

  for (const message of messages) {
    if (message.role === 'user') {
      if (message.content.trim() !== '') result.push({ role: 'user', content: [{ type: 'text', text: message.content }] })
      continue
    }

    const calls = message.toolCalls ?? []
    if (calls.length > 0) {
      result.push({
        role: 'assistant',
        content: calls.map((call) => ({ type: 'tool_use', id: call.id, name: call.name, input: call.input })),
      })
      result.push({
        role: 'user',
        content: calls.map((call) => {
          const block: ModelBlock = { type: 'tool_result', toolUseId: call.id, content: call.result }
          if (call.isError) block.isError = true
          return block
        }),
      })
    }

    if (message.content.trim() !== '') {
      result.push({ role: 'assistant', content: [{ type: 'text', text: message.content }] })
    }
  }

  return result
}

export function trimHistory(messages: ModelMessage[], budget: number = HISTORY_CHAR_BUDGET): ModelMessage[] {
  const sizes = messages.map(messageSize)
  let total = sizes.reduce((sum, size) => sum + size, 0)

  let start = 0
  while (start < messages.length && total > budget) {
    total -= sizes[start] ?? 0
    start += 1
  }

  return messages.slice(safeStart(messages, start))
}

/**
 * Ближайшая позиция, с которой история начинается корректно.
 * Если такой не нашлось, история отбрасывается целиком — это хуже для
 * контекста, но лучше, чем гарантированная ошибка запроса.
 */
function safeStart(messages: ModelMessage[], from: number): number {
  for (let index = from; index < messages.length; index += 1) {
    const message = messages[index]
    if (message && isSafeStart(message)) return index
  }
  return messages.length
}

function isSafeStart(message: ModelMessage): boolean {
  return message.role === 'user' && message.content.every((block) => block.type === 'text')
}

function messageSize(message: ModelMessage): number {
  let size = 0
  for (const block of message.content) {
    switch (block.type) {
      case 'text':
        size += block.text.length
        break
      case 'tool_use':
        size += block.name.length + JSON.stringify(block.input ?? null).length
        break
      case 'tool_result':
        size += block.content.length
        break
    }
  }
  return size
}
