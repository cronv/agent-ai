import type { ApartmentCard, ChatStreamEvent, HistoryMessage, SavedLead, WidgetConfig } from './types.ts'

/**
 * Тонкий слой поверх публичного API чата.
 *
 *   const api = createApi('https://ai.example.ru')
 *   const config = await api.loadConfig()
 *   for await (const event of api.streamMessage({ sessionId, message })) { … }
 *
 * Наружу отсюда не выходит ни одного кода ошибки: всё, что может увидеть
 * посетитель, — это `ChatApiError.message`, написанный по-человечески.
 * Расшифровка кодов живёт здесь и только здесь.
 */

/** Ошибка, текст которой можно показывать в ленте чата как есть. */
export class ChatApiError extends Error {
  readonly retriable: boolean

  constructor(message: string, retriable = true) {
    super(message)
    this.name = 'ChatApiError'
    this.retriable = retriable
  }
}

export const DEFAULT_CONFIG: WidgetConfig = {
  enabled: true,
  title: 'Подбор новостройки',
  accentColor: '#2F6BFF',
  greeting: 'Здравствуйте! Помогу подобрать квартиру в новостройке. Расскажите, что ищете — своими словами.',
  exampleQuestions: [],
  privacyPolicyUrl: null,
}

export interface SendPayload {
  sessionId: string
  message: string
  pageUrl: string | null
  referrer: string | null
  utm: Record<string, string> | null
  signal?: AbortSignal
}

export interface ChatApi {
  loadConfig(): Promise<WidgetConfig>
  loadHistory(sessionId: string): Promise<HistoryMessage[]>
  streamMessage(payload: SendPayload): AsyncGenerator<ChatStreamEvent>
}

export function createApi(baseUrl: string): ChatApi {
  const base = baseUrl.replace(/\/+$/, '')
  const url = (path: string): string => `${base}${path}`

  return {
    async loadConfig(): Promise<WidgetConfig> {
      const response = await request(url('/api/widget/config'))
      const body = (await response.json()) as Partial<WidgetConfig>
      return {
        enabled: body.enabled !== false,
        title: nonEmpty(body.title) ?? DEFAULT_CONFIG.title,
        accentColor: nonEmpty(body.accentColor) ?? DEFAULT_CONFIG.accentColor,
        greeting: nonEmpty(body.greeting) ?? DEFAULT_CONFIG.greeting,
        exampleQuestions: Array.isArray(body.exampleQuestions)
          ? body.exampleQuestions.filter((item): item is string => typeof item === 'string' && item.trim() !== '')
          : [],
        privacyPolicyUrl: nonEmpty(body.privacyPolicyUrl ?? null),
      }
    },

    async loadHistory(sessionId: string): Promise<HistoryMessage[]> {
      const response = await request(url(`/api/chat/${encodeURIComponent(sessionId)}`))
      const body = (await response.json()) as { messages?: unknown }
      if (!Array.isArray(body.messages)) return []
      return body.messages.filter(isHistoryMessage)
    },

    async *streamMessage(payload: SendPayload): AsyncGenerator<ChatStreamEvent> {
      const { signal, ...body } = payload
      const response = await request(url('/api/chat'), {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        ...(signal ? { signal } : {}),
      })

      if (!response.body) {
        throw new ChatApiError('Браузер не смог получить ответ. Обновите страницу и попробуйте снова.')
      }

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      try {
        for (;;) {
          const { done, value } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })

          // Событие SSE заканчивается пустой строкой. Хвост буфера — это
          // недописанное событие, оно дождётся следующего куска.
          let boundary = buffer.indexOf('\n\n')
          while (boundary !== -1) {
            const block = buffer.slice(0, boundary)
            buffer = buffer.slice(boundary + 2)
            const event = parseSseBlock(block)
            if (event) yield event
            boundary = buffer.indexOf('\n\n')
          }
        }
      } finally {
        // Обрыв на нашей стороне закрывает и поток к модели на сервере.
        await reader.cancel().catch(() => undefined)
      }
    },
  }
}

// ── Разбор SSE ───────────────────────────────────────────────

/**
 * Один блок SSE → событие. Комментарии-пульсы (`: ping`) и всё, чего виджет
 * не знает, отбрасываются: сервер вправе добавить событие, не ломая старые
 * виджеты на чужих сайтах.
 */
export function parseSseBlock(block: string): ChatStreamEvent | null {
  let name = 'message'
  let data = ''
  for (const line of block.split('\n')) {
    if (line.startsWith(':')) continue
    if (line.startsWith('event:')) name = line.slice('event:'.length).trim()
    else if (line.startsWith('data:')) data += line.slice('data:'.length).trim()
  }
  if (data === '') return null

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(data) as Record<string, unknown>
  } catch {
    return null
  }

  switch (name) {
    case 'ready':
      return {
        type: 'ready',
        conversationId: String(parsed['conversationId'] ?? ''),
        sessionId: String(parsed['sessionId'] ?? ''),
      }
    case 'text':
      return typeof parsed['text'] === 'string' ? { type: 'text', text: parsed['text'] } : null
    case 'tool':
      return typeof parsed['name'] === 'string' ? { type: 'tool', name: parsed['name'] } : null
    case 'apartments':
      return {
        type: 'apartments',
        apartments: Array.isArray(parsed['apartments']) ? (parsed['apartments'] as ApartmentCard[]) : [],
      }
    case 'lead':
      return isRecord(parsed['lead']) ? { type: 'lead', lead: parsed['lead'] as unknown as SavedLead } : null
    case 'error':
      return {
        type: 'error',
        message:
          typeof parsed['message'] === 'string' && parsed['message'].trim() !== ''
            ? parsed['message']
            : 'Не получилось ответить. Попробуйте ещё раз.',
      }
    case 'done':
      return { type: 'done' }
    default:
      return null
  }
}

// ── Запросы ──────────────────────────────────────────────────

/**
 * Запрос с человеческим переводом отказа.
 *
 * Тексты ошибок сервера писались для разработчика, который ставит виджет,
 * и в ленту чата не годятся: посетителю нечего делать с «sessionId должен
 * быть случайной строкой». Поэтому текст выбирается здесь, по коду ошибки.
 */
async function request(target: string, init?: RequestInit): Promise<Response> {
  let response: Response
  try {
    response = await fetch(target, { ...init, mode: 'cors', credentials: 'omit' })
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') throw error
    throw new ChatApiError('Не получается связаться с сервером. Проверьте интернет и попробуйте снова.')
  }

  if (response.ok) return response
  throw await toHumanError(response)
}

async function toHumanError(response: Response): Promise<ChatApiError> {
  const body = await response
    .json()
    .then((value: unknown) => (isRecord(value) ? value : {}))
    .catch(() => ({}) as Record<string, unknown>)

  const code = typeof body['error'] === 'string' ? body['error'] : ''
  const retryAfter = typeof body['retryAfter'] === 'number' ? body['retryAfter'] : 0

  switch (code) {
    case 'rate_limited':
      return new ChatApiError(
        retryAfter > 0
          ? `Слишком много сообщений подряд. Подождите ${plural(retryAfter, 'секунду', 'секунды', 'секунд')} и напишите снова.`
          : 'Слишком много сообщений подряд. Подождите немного и напишите снова.',
      )
    case 'already_streaming':
      return new ChatApiError('Ассистент ещё дописывает прошлый ответ. Секунду — и можно продолжать.')
    case 'widget_disabled':
      return new ChatApiError('Чат сейчас выключен. Загляните чуть позже.', false)
    case 'origin_not_allowed':
      return new ChatApiError('Чат не подключён для этого сайта.', false)
    case 'bad_request':
    case 'bad_session':
      return new ChatApiError('Не получилось отправить сообщение. Попробуйте написать его иначе.')
    default:
      return new ChatApiError(
        response.status >= 500
          ? 'Сервер не отвечает. Попробуйте ещё раз через минуту.'
          : 'Что-то пошло не так. Попробуйте ещё раз.',
      )
  }
}

function plural(value: number, one: string, few: string, many: string): string {
  const mod100 = value % 100
  const mod10 = value % 10
  if (mod100 >= 11 && mod100 <= 14) return `${value} ${many}`
  if (mod10 === 1) return `${value} ${one}`
  if (mod10 >= 2 && mod10 <= 4) return `${value} ${few}`
  return `${value} ${many}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isHistoryMessage(value: unknown): value is HistoryMessage {
  if (!isRecord(value)) return false
  const role = value['role']
  return (role === 'user' || role === 'assistant') && typeof value['content'] === 'string'
}

function nonEmpty(value: string | null | undefined): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim()
  return trimmed === '' ? null : trimmed
}
