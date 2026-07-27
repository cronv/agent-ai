import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'

import { env } from '../config/env.js'

/**
 * CORS для публичного API виджета.
 *
 * Виджет по замыслу стоит на ЧУЖОМ домене: строчка `<script src=".../widget.js">`
 * вставляется на сайт агентства, а запросы уходят на этот сервер. Значит все
 * публичные адреса — и чат, и конфиг, и форма контакта — кросс-доменные, и
 * каждому нужны и заголовки ответа, и обработчик предполётного запроса.
 * Тело `application/json` вызывает предполётный `OPTIONS` всегда.
 *
 * Плагин собран через `fastify-plugin`, поэтому его хук виден всей области, в
 * которой он зарегистрирован. Регистрируется он не в корне приложения, а внутри
 * области публичных маршрутов (`app.ts`) — так правила общие для всего
 * публичного API и по-прежнему не доходят до `/api/admin/*`.
 *
 * ── Почему без credentials ─────────────────────────────────────────────────
 *
 * `Access-Control-Allow-Credentials` не выставляется никогда. Вместе с
 * `Allow-Origin: *` это ровно то, что нужно: браузер не пошлёт сюда куку
 * админки и не даст чужому скрипту прочитать ответ, сделанный от имени
 * администратора. Диалог опознаётся по `sessionId` в теле запроса, кука ему
 * не нужна.
 *
 * Если сайты, на которых стоит виджет, известны, их перечисляют в
 * `WIDGET_ALLOWED_ORIGINS` — тогда список работает как белый.
 */

/**
 * Публичные адреса, которым нужен предполётный обработчик.
 * Список держится здесь, а не размазан по файлам маршрутов: забытый адрес —
 * это молча не работающая на боевом сайте функция, а не заметная ошибка.
 */
export const PUBLIC_CORS_PATHS = ['/api/chat', '/api/chat/:sessionId', '/api/widget/config', '/api/lead'] as const

/** Из заголовков запроса разрешён только Content-Type — больше виджету не нужно. */
const ALLOWED_REQUEST_HEADERS = 'content-type'
const ALLOWED_METHODS = 'GET, POST, OPTIONS'
const PREFLIGHT_MAX_AGE_SECONDS = '86400'

/**
 * Какой Origin разрешить. Пустой белый список означает «любой»:
 * виджет ставится на сайты, адреса которых заранее неизвестны.
 *
 * Вынесено отдельной функцией без Fastify, чтобы белый список проверялся
 * тестом напрямую, а не через переменные окружения на старте процесса.
 */
export function resolveAllowedOrigin(origin: string | undefined, allowList: readonly string[]): string | null {
  if (allowList.length === 0) return '*'
  if (typeof origin !== 'string' || origin === '') return null
  return allowList.includes(origin.replace(/\/+$/, '')) ? origin : null
}

function allowedOrigin(request: FastifyRequest): string | null {
  return resolveAllowedOrigin(request.headers.origin, env.widgetAllowedOrigins)
}

/**
 * Заголовки ответа. Экспортируется, потому что поток чата пишет в сокет сам
 * (`reply.hijack()`), и заголовки туда нужно положить руками.
 */
export function corsHeaders(request: FastifyRequest): Record<string, string> {
  const origin = allowedOrigin(request)
  if (origin === null) return {}
  const headers: Record<string, string> = { 'access-control-allow-origin': origin }
  // Ответ зависит от Origin — кэшу об этом нужно сказать.
  if (origin !== '*') headers['vary'] = 'Origin'
  return headers
}

export interface PublicCorsOptions {
  /** Адреса, для которых регистрируется обработчик OPTIONS. */
  paths?: readonly string[]
}

const publicCors: FastifyPluginAsync<PublicCorsOptions> = async (app, options) => {
  app.addHook('onRequest', async (request, reply) => {
    for (const [name, value] of Object.entries(corsHeaders(request))) {
      void reply.header(name, value)
    }
  })

  /** Предполётный запрос браузера. Тело application/json его всегда вызывает. */
  const preflight = async (request: FastifyRequest, reply: FastifyReply): Promise<FastifyReply> => {
    if (allowedOrigin(request) === null) {
      return reply.code(403).send({ error: 'origin_not_allowed', message: 'Этот домен не в списке разрешённых' })
    }
    return reply
      .header('access-control-allow-methods', ALLOWED_METHODS)
      .header('access-control-allow-headers', ALLOWED_REQUEST_HEADERS)
      .header('access-control-max-age', PREFLIGHT_MAX_AGE_SECONDS)
      .code(204)
      .send()
  }

  for (const path of options.paths ?? PUBLIC_CORS_PATHS) {
    app.options(path, preflight)
  }
}

export default fp(publicCors, { name: 'public-cors' })
