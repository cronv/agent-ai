import Anthropic from '@anthropic-ai/sdk'

/**
 * Проверка ключа доступа к Claude.
 *
 *   const result = await checkAnthropicKey({ apiKey, model })
 *   result.ok       // заработает ли чат
 *   result.message  // что показать человеку
 *
 * Делается настоящий, но самый дешёвый запрос к API: одно короткое сообщение
 * с ограничением в один токен. Список моделей (`/v1/models`) не годится —
 * он отвечает и на ключе, которому не разрешены сообщения, а нам важно
 * ровно то, что делает чат.
 *
 * Ответ всегда человеческий. Пользователь админки не программист: «401
 * Unauthorized» ему ничего не объясняет, а «ключ не подошёл, проверьте, что
 * скопировали целиком» — объясняет.
 */

/** Как выглядит проверка снаружи: либо прошла, либо нет, и почему. */
export interface AnthropicKeyCheck {
  ok: boolean
  message: string
  /** Модель, на которой проверяли. Пустая строка, если до запроса не дошло. */
  model: string
}

export interface AnthropicKeyCheckInput {
  apiKey: string
  /** Модель из настроек — заодно проверяем, что её название не переврали. */
  model: string
}

/**
 * Сам сетевой вызов. Вынесен отдельным типом, чтобы тесты подменяли его
 * и не ходили в интернет.
 */
export type AnthropicProbe = (input: AnthropicKeyCheckInput) => Promise<void>

/** Минимальный настоящий запрос к Claude: одно сообщение, один токен ответа. */
export const sdkProbe: AnthropicProbe = async ({ apiKey, model }) => {
  const client = new Anthropic({ apiKey, maxRetries: 0, timeout: 20_000 })
  await client.messages.create({
    model,
    max_tokens: 1,
    messages: [{ role: 'user', content: 'ping' }],
  })
}

export async function checkAnthropicKey(
  input: AnthropicKeyCheckInput,
  probe: AnthropicProbe = sdkProbe,
): Promise<AnthropicKeyCheck> {
  const apiKey = input.apiKey.trim()
  const model = input.model.trim()

  if (apiKey === '') {
    return {
      ok: false,
      message: 'Ключ не задан. Вставьте его в поле выше и сохраните — без ключа чат не отвечает.',
      model: '',
    }
  }

  if (model === '') {
    return {
      ok: false,
      message: 'Не выбрана модель. Укажите её в разделе «Ассистент» и повторите проверку.',
      model: '',
    }
  }

  try {
    await probe({ apiKey, model })
    return { ok: true, message: `Ключ работает: пробный запрос к модели ${model} прошёл.`, model }
  } catch (error) {
    return { ...describeFailure(error, model), model }
  }
}

function describeFailure(error: unknown, model: string): { ok: boolean; message: string } {
  const status = statusOf(error)

  switch (status) {
    case 401:
      return {
        ok: false,
        message: 'Ключ не подошёл: Anthropic его не узнал. Проверьте, что скопировали ключ целиком и без пробелов.',
      }
    case 403:
      return {
        ok: false,
        message: 'Ключ есть, но у него нет доступа к этой модели. Проверьте права ключа в личном кабинете Anthropic.',
      }
    case 404:
      return {
        ok: false,
        message: `Ключ принят, но модели «${model}» у Anthropic нет. Проверьте её название в разделе «Ассистент».`,
      }
    case 429:
      // Ключ рабочий: упёрлись в частоту запросов, а не в доступ.
      return {
        ok: true,
        message: 'Ключ рабочий, но Anthropic сейчас ограничивает частоту запросов. Это временно.',
      }
    case 400:
      return { ok: false, message: `Anthropic отклонил пробный запрос: ${messageOf(error)}` }
    default:
      break
  }

  if (status !== null && status >= 500) {
    return { ok: false, message: 'Проверить не получилось: Anthropic сейчас недоступен. Попробуйте через пару минут.' }
  }

  return {
    ok: false,
    message: `Не удалось связаться с Anthropic: ${messageOf(error)}. Проверьте, что у сервера есть доступ в интернет.`,
  }
}

function statusOf(error: unknown): number | null {
  if (typeof error !== 'object' || error === null) return null
  const status = (error as { status?: unknown }).status
  return typeof status === 'number' && Number.isFinite(status) ? status : null
}

function messageOf(error: unknown): string {
  if (error instanceof Error && error.message !== '') return error.message
  return 'неизвестная ошибка'
}
