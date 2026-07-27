import Anthropic from '@anthropic-ai/sdk'

/**
 * Клиент модели.
 *
 * Между движком диалога и SDK Anthropic стоит узкий порт `ModelClient`.
 * Причины ровно две:
 *
 *   1. В тестах подменяется он — и это единственное, что подменяется.
 *      Мок пишется в пять строк и не требует конструировать `Anthropic.Message`
 *      со всеми его обязательными полями.
 *   2. Блоки сообщения (`ModelBlock`) сериализуемы как есть. Их же формат
 *      лежит в `Message.toolCalls` в базе, поэтому история диалога
 *      восстанавливается без второго преобразования.
 *
 * Запрос всегда идёт со стримингом: ответ уходит посетителю по мере генерации,
 * а не через десять секунд тишины. Поток отдаётся как асинхронный итератор —
 * сначала куски текста, последним событием полный ответ модели.
 *
 * Параметры `thinking` и `effort` намеренно не отправляются: набор моделей
 * задаётся в админке, а поддержка этих полей у моделей разная — лишний
 * параметр превратился бы в 400 на ровном месте.
 */

/** Схема инструмента в том виде, в каком её принимает Anthropic. */
export interface ToolDefinition {
  name: string
  description: string
  input_schema: {
    type: 'object'
    properties: Record<string, unknown>
    required?: string[]
  }
}

/** Блок содержимого сообщения. Сериализуем: то же лежит в базе. */
export type ModelBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: unknown }
  | { type: 'tool_result'; toolUseId: string; content: string; isError?: boolean }

export interface ModelMessage {
  role: 'user' | 'assistant'
  content: ModelBlock[]
}

export interface ModelUsage {
  inputTokens: number
  outputTokens: number
}

/** Ответ модели на один запрос. */
export interface ModelReply {
  model: string
  stopReason: string | null
  /** Только `text` и `tool_use` — результаты инструментов присылает клиент. */
  content: ModelBlock[]
  usage: ModelUsage
}

export interface ModelRequest {
  model: string
  maxTokens: number
  system: string
  messages: ModelMessage[]
  tools: ToolDefinition[]
}

export type ModelStreamEvent =
  | { type: 'text'; text: string }
  | { type: 'reply'; reply: ModelReply }

export interface ModelClient {
  /**
   * Один запрос к модели. Отдаёт куски текста по мере генерации,
   * последним событием — полный ответ.
   */
  stream(request: ModelRequest): AsyncIterable<ModelStreamEvent>
}

/**
 * Ошибка обращения к модели.
 *
 * `message` уходит в лог и содержит подробности, `userMessage` — то, что
 * увидит посетитель. Разделение нужно, чтобы код статуса и текст ошибки
 * Anthropic не попадали в чат на сайте.
 */
export class ModelError extends Error {
  readonly userMessage: string
  readonly status: number | undefined

  constructor(message: string, userMessage: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause })
    this.name = 'ModelError'
    this.userMessage = userMessage
    this.status = options.status
  }
}

/** Что видит посетитель, когда модель недоступна. */
export const MODEL_ERROR_MESSAGES = {
  noKey: 'Чат сейчас не отвечает — не настроен доступ к ассистенту. Оставьте телефон, и менеджер перезвонит.',
  auth: 'Чат сейчас не отвечает — не настроен доступ к ассистенту. Оставьте телефон, и менеджер перезвонит.',
  rateLimit: 'Сейчас слишком много обращений. Повторите вопрос через минуту, пожалуйста.',
  unavailable: 'Не получилось связаться с ассистентом. Повторите вопрос через минуту — обычно это ненадолго.',
} as const

/** Ошибка «ключ не задан»: сообщение то же, что при отказе авторизации. */
export function missingApiKeyError(): ModelError {
  return new ModelError('Ключ Anthropic не задан ни в настройках, ни в переменной окружения', MODEL_ERROR_MESSAGES.noKey)
}

export interface AnthropicModelClientOptions {
  apiKey: string
  /** Сколько ждать ответ модели. По умолчанию минута — чат не должен висеть. */
  timeoutMs?: number
  maxRetries?: number
}

/** Боевой клиент: обёртка над официальным SDK. */
export class AnthropicModelClient implements ModelClient {
  private readonly sdk: Anthropic

  constructor(options: AnthropicModelClientOptions) {
    this.sdk = new Anthropic({
      apiKey: options.apiKey,
      timeout: options.timeoutMs ?? 60_000,
      maxRetries: options.maxRetries ?? 2,
    })
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    try {
      const stream = this.sdk.messages.stream({
        model: request.model,
        max_tokens: request.maxTokens,
        system: request.system,
        messages: toSdkMessages(request.messages),
        tools: request.tools,
      })

      for await (const event of stream) {
        if (event.type === 'content_block_delta' && event.delta.type === 'text_delta') {
          yield { type: 'text', text: event.delta.text }
        }
      }

      yield { type: 'reply', reply: fromSdkMessage(await stream.finalMessage()) }
    } catch (error) {
      throw toModelError(error)
    }
  }
}

/** Переводит ошибку SDK в `ModelError` с понятным человеку текстом. */
export function toModelError(error: unknown): ModelError {
  if (error instanceof ModelError) return error

  if (error instanceof Anthropic.APIError) {
    const status = error.status
    const userMessage =
      status === 401 || status === 403
        ? MODEL_ERROR_MESSAGES.auth
        : status === 429
          ? MODEL_ERROR_MESSAGES.rateLimit
          : MODEL_ERROR_MESSAGES.unavailable
    const detail: { status?: number; cause: unknown } = { cause: error }
    if (status !== undefined) detail.status = status
    return new ModelError(`Anthropic ответил ошибкой ${status ?? '—'}: ${error.message}`, userMessage, detail)
  }

  const message = error instanceof Error ? error.message : String(error)
  return new ModelError(`Не удалось обратиться к модели: ${message}`, MODEL_ERROR_MESSAGES.unavailable, {
    cause: error,
  })
}

function toSdkMessages(messages: ModelMessage[]): Anthropic.MessageParam[] {
  return messages.map((message) => ({
    role: message.role,
    content: message.content.map(toSdkBlock),
  }))
}

function toSdkBlock(block: ModelBlock): Anthropic.ContentBlockParam {
  switch (block.type) {
    case 'text':
      return { type: 'text', text: block.text }
    case 'tool_use':
      return { type: 'tool_use', id: block.id, name: block.name, input: block.input }
    case 'tool_result': {
      const result: Anthropic.ToolResultBlockParam = {
        type: 'tool_result',
        tool_use_id: block.toolUseId,
        content: block.content,
      }
      if (block.isError) result.is_error = true
      return result
    }
  }
}

function fromSdkMessage(message: Anthropic.Message): ModelReply {
  const content: ModelBlock[] = []
  for (const block of message.content) {
    if (block.type === 'text') content.push({ type: 'text', text: block.text })
    else if (block.type === 'tool_use') {
      content.push({ type: 'tool_use', id: block.id, name: block.name, input: block.input })
    }
  }
  return {
    model: message.model,
    stopReason: message.stop_reason,
    content,
    usage: {
      inputTokens: message.usage.input_tokens,
      outputTokens: message.usage.output_tokens,
    },
  }
}
