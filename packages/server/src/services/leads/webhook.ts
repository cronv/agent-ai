/**
 * Отправка лида во внешний вебхук.
 *
 *   const result = await deliverLeadWebhook({ url, payload })
 *   // { ok: true } | { ok: false, error: 'HTTP 500: …' }
 *
 * Формат тела задан не нами: на том конце уже работает воркер amoCRM
 * пользователя, и он ждёт ровно эти поля. Менять их нельзя — сломается
 * рабочая интеграция:
 *
 *   { name, phone, lead_name, comment, meta: { page, referrer, utm } }
 *
 * Политика повторов простая: одна повторная попытка. Вебхук на той стороне
 * обычно либо жив, либо лежит; десяток попыток не увеличит шанс доставки, зато
 * задержит следующие лиды. Всё, что не доставилось, остаётся на лиде в
 * `webhookError` — менеджер видит проблему в админке и отправляет руками.
 */

/** Тело запроса. Имена полей — контракт с amo-воркером. */
export interface LeadWebhookPayload {
  name: string
  phone: string
  /** Заголовок сделки в CRM. */
  lead_name: string
  comment: string
  meta: {
    page: string | null
    referrer: string | null
    utm: Record<string, string> | null
  }
}

export type LeadWebhookResult = { ok: true } | { ok: false; error: string }

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>

export interface DeliverOptions {
  url: string
  payload: LeadWebhookPayload
  /** Сколько ждать ответа. */
  timeoutMs?: number
  /** Пауза перед повторной попыткой. */
  retryDelayMs?: number
  /** Подменяется в тестах: в интернет тесты не ходят. */
  fetchImpl?: FetchLike
}

export const WEBHOOK_TIMEOUT_MS = 5_000
export const WEBHOOK_RETRY_DELAY_MS = 500

/** Сколько символов ошибки храним: в карточке лида нужен смысл, а не дамп. */
const MAX_ERROR_LENGTH = 500

export async function deliverLeadWebhook(options: DeliverOptions): Promise<LeadWebhookResult> {
  const timeoutMs = options.timeoutMs ?? WEBHOOK_TIMEOUT_MS
  const retryDelayMs = options.retryDelayMs ?? WEBHOOK_RETRY_DELAY_MS
  const send = options.fetchImpl ?? ((url, init) => fetch(url, init))

  let lastError = ''
  for (let attempt = 0; attempt < 2; attempt += 1) {
    if (attempt > 0 && retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs))
    }

    try {
      const response = await send(options.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(options.payload),
        signal: AbortSignal.timeout(timeoutMs),
      })

      if (response.ok) return { ok: true }

      lastError = `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ''}`
      // 4xx — вебхук работает и говорит «так не надо». Повтор с тем же телом
      // даст тот же ответ, только с задержкой.
      if (response.status >= 400 && response.status < 500) break
    } catch (error) {
      lastError = describe(error)
    }
  }

  return { ok: false, error: lastError.slice(0, MAX_ERROR_LENGTH) }
}

function describe(error: unknown): string {
  if (error instanceof Error) {
    if (error.name === 'TimeoutError' || error.name === 'AbortError') {
      return 'Вебхук не ответил вовремя'
    }
    return error.message === '' ? error.name : error.message
  }
  return String(error)
}
