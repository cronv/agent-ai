/**
 * Единственный способ ходить в API админки.
 *
 *   const summary = await api.get<DashboardSummary>('/dashboard')
 *   await api.post('/projects', { name: 'ЖК Река' })
 *
 * Путь пишется коротким — префикс `/api/admin` подставляется сам.
 * Кука с сессией уходит автоматически, вручную ничего добавлять не нужно.
 *
 * Ответ 401 означает, что сессия кончилась. Такой ответ помимо исключения
 * поднимает общий обработчик (`setUnauthorizedHandler`), который вешает
 * AuthProvider, — пользователя выкидывает на экран входа откуда угодно.
 */

const BASE = '/api/admin'

export class ApiError extends Error {
  readonly status: number
  readonly code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }

  /** Сессия кончилась или её не было. */
  get isUnauthorized(): boolean {
    return this.status === 401
  }
}

type UnauthorizedHandler = () => void

let onUnauthorized: UnauthorizedHandler | null = null

/** Кого звать, когда сервер ответил 401. Устанавливается один раз в AuthProvider. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler | null): void {
  onUnauthorized = handler
}

interface RequestOptions {
  method?: string
  body?: unknown
  signal?: AbortSignal
  /** Не звать общий обработчик 401 — нужно самому экрану входа. */
  silentUnauthorized?: boolean
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, signal, silentUnauthorized = false } = options

  // FormData браузер сериализует сам и сам ставит boundary в Content-Type —
  // трогать заголовок нельзя, иначе загрузка файла ломается.
  const isForm = typeof FormData !== 'undefined' && body instanceof FormData

  const init: RequestInit = {
    method,
    credentials: 'same-origin',
    headers: body === undefined || isForm ? {} : { 'Content-Type': 'application/json' },
  }
  if (body !== undefined) init.body = isForm ? (body as FormData) : JSON.stringify(body)
  if (signal) init.signal = signal

  let response: Response
  try {
    response = await fetch(`${BASE}${path}`, init)
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause
    throw new ApiError(0, 'network', 'Сервер не отвечает. Проверьте соединение.')
  }

  if (response.status === 401 && !silentUnauthorized) {
    onUnauthorized?.()
  }

  if (response.status === 204) return undefined as T

  const payload: unknown = await response.json().catch(() => null)

  if (!response.ok) {
    const details = (payload ?? {}) as { error?: string; message?: string }
    throw new ApiError(
      response.status,
      details.error ?? 'unknown',
      details.message ?? 'Что-то пошло не так. Попробуйте ещё раз.',
    )
  }

  return payload as T
}

export const api = {
  get: <T>(path: string, options?: RequestOptions): Promise<T> => request<T>(path, { ...options }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: RequestOptions): Promise<T> =>
    request<T>(path, { ...options, method: 'DELETE' }),
  /** Отправка файла: `api.upload('/knowledge', formData)`. */
  upload: <T>(path: string, form: FormData, options?: RequestOptions): Promise<T> =>
    request<T>(path, { ...options, method: 'POST', body: form }),
}

/** Человеческий текст ошибки для показа в интерфейсе. */
export function errorMessage(error: unknown): string {
  if (error instanceof ApiError) return error.message
  if (error instanceof Error) return error.message
  return 'Неизвестная ошибка'
}
