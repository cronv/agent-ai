import type { ServerResponse } from 'node:http'

import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'

import { env } from '../config/env.js'
import { RateLimiter, retryAfterSeconds } from '../services/chat/index.js'
import {
  DialogEngine,
  ensureConversation,
  type DialogEvent,
  type LeadHandler,
  type ModelClient,
} from '../services/dialog/index.js'

/**
 * Публичное API чата — то, с чем работает виджет на чужом сайте.
 *
 *   POST /api/chat                 сообщение; ответ идёт потоком SSE
 *   GET  /api/chat/:sessionId      история переписки для восстановления
 *   GET  /api/widget/config        публичные настройки виджета
 *
 * Эти адреса намеренно живут вне `/api/admin/`: там всё закрыто хуком
 * авторизации, и виджет получал бы 401.
 *
 * ── Чем это защищено ───────────────────────────────────────────────────────
 *
 * Публичный адрес, за которым стоит платная модель, — это открытый кран.
 * Поэтому:
 *
 *   1. Частота ограничена дважды — по сессии и по IP, каждая пара правил
 *      с коротким и длинным окном (см. `services/chat/rate-limit.ts`).
 *   2. Одна сессия — один поток одновременно. Десять параллельных вкладок
 *      с одним `sessionId` не превращаются в десять запросов к модели.
 *   3. Виджет, выключенный в админке, перестаёт отвечать на сервере, а не
 *      только прятаться на странице.
 *   4. `sessionId` обязан выглядеть как случайный идентификатор: он же
 *      служит ключом к истории переписки.
 *
 * ── Почему CORS устроен именно так ─────────────────────────────────────────
 *
 * Заголовки CORS выставляются только на маршруты этого файла — плагин
 * зарегистрирован без `fastify-plugin`, поэтому его хук не виден снаружи.
 * Админка так и остаётся недоступной для запросов с чужих сайтов.
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
 * Лимиты обращений к чату.
 *
 * Числа подобраны от живого разговора: человек пишет сообщение раз в
 * пять–десять секунд и за час беседы едва наберёт два десятка реплик.
 * Восемь сообщений в минуту — это заметно быстрее самого нетерпеливого
 * посетителя, но в сорок раз медленнее скрипта.
 *
 * Лимит по IP выше сессионного: за одним адресом сидит офис или подъезд
 * с общим NAT, и резать их по норме одного человека нельзя.
 */
export const CHAT_SESSION_RULES = [
  { limit: 8, windowMs: 60_000 },
  { limit: 60, windowMs: 60 * 60_000 },
]

export const CHAT_IP_RULES = [
  { limit: 30, windowMs: 60_000 },
  { limit: 300, windowMs: 60 * 60_000 },
]

/** Чтение истории и конфига модель не трогает — здесь лимит только от долбёжки. */
export const CHAT_READ_RULES = [{ limit: 120, windowMs: 60_000 }]

const sessionLimiter = new RateLimiter(CHAT_SESSION_RULES)
const ipLimiter = new RateLimiter(CHAT_IP_RULES)
const readLimiter = new RateLimiter(CHAT_READ_RULES)

/** Сессии, для которых прямо сейчас крутится поток. */
const streaming = new Set<string>()

/** Сбрасывает счётчики. Нужен тестам, чтобы сценарии не мешали друг другу. */
export function resetChatRateLimits(): void {
  sessionLimiter.reset()
  ipLimiter.reset()
  readLimiter.reset()
  streaming.clear()
}

/** Пределы того, что принимается от виджета. Всё это приходит из браузера. */
const SESSION_ID_MIN = 16
const SESSION_ID_MAX = 128
const SESSION_ID_PATTERN = /^[A-Za-z0-9_-]+$/
const MESSAGE_MAX_LENGTH = 2000
const URL_MAX_LENGTH = 2048
const UTM_MAX_KEYS = 10
const UTM_VALUE_MAX_LENGTH = 200

/** Сколько сообщений отдаём в истории по умолчанию и максимум. */
const HISTORY_DEFAULT_LIMIT = 100
const HISTORY_MAX_LIMIT = 300

/** Раз в столько миллисекунд в поток уходит комментарий-пульс. */
const SSE_PING_INTERVAL_MS = 15_000

export interface ChatRoutesOptions {
  /** Готовый движок. Обычно не нужен — плагин соберёт свой. */
  engine?: DialogEngine
  /** Клиент модели. В тестах сюда подставляется мок. */
  modelClient?: ModelClient
  /** Обработчик контакта. Точка подключения сервиса лидов. */
  saveLead?: LeadHandler
}

// ── Разбор тела запроса ──────────────────────────────────────

export interface ChatRequestBody {
  sessionId: string
  message: string
  pageUrl: string | null
  referrer: string | null
  utm: Record<string, string> | null
}

type ParseResult = { ok: true; value: ChatRequestBody } | { ok: false; error: string }

/**
 * Всё, что пришло от виджета, — недоверенный ввод. Тексты ошибок написаны
 * для разработчика, который ставит виджет: их видно в консоли браузера.
 */
export function parseChatBody(raw: unknown): ParseResult {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return { ok: false, error: 'Ожидался объект с полями sessionId и message' }
  }
  const body = raw as Record<string, unknown>

  const sessionId = typeof body['sessionId'] === 'string' ? body['sessionId'].trim() : ''
  if (sessionId.length < SESSION_ID_MIN || sessionId.length > SESSION_ID_MAX || !SESSION_ID_PATTERN.test(sessionId)) {
    return {
      ok: false,
      error:
        `sessionId должен быть случайной строкой длиной от ${SESSION_ID_MIN} до ${SESSION_ID_MAX} ` +
        'символов (латиница, цифры, «-» и «_»). Подойдёт crypto.randomUUID().',
    }
  }

  const message = typeof body['message'] === 'string' ? body['message'].trim() : ''
  if (message === '') return { ok: false, error: 'Пустое сообщение' }
  if (message.length > MESSAGE_MAX_LENGTH) {
    return { ok: false, error: `Сообщение длиннее ${MESSAGE_MAX_LENGTH} символов` }
  }

  return {
    ok: true,
    value: {
      sessionId,
      message,
      pageUrl: trimmedOrNull(body['pageUrl']),
      referrer: trimmedOrNull(body['referrer']),
      utm: parseUtm(body['utm']),
    },
  }
}

function trimmedOrNull(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const trimmed = value.trim().slice(0, URL_MAX_LENGTH)
  return trimmed === '' ? null : trimmed
}

/**
 * UTM-метки: берём только то, что похоже на метку, и обрезаем длину.
 * Виджет присылает то, что нашёл в адресе страницы, — там бывает что угодно.
 */
function parseUtm(value: unknown): Record<string, string> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
  const result: Record<string, string> = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (Object.keys(result).length >= UTM_MAX_KEYS) break
    if (!/^(utm_[a-z_]{1,30}|gclid|yclid|fbclid)$/i.test(key)) continue
    const text = typeof raw === 'string' ? raw.trim().slice(0, UTM_VALUE_MAX_LENGTH) : ''
    if (text !== '') result[key.toLowerCase()] = text
  }
  return Object.keys(result).length > 0 ? result : null
}

// ── Формат событий на проводе ────────────────────────────────

/**
 * Событие движка → событие SSE. Перекладывание один в один и без потерь:
 * виджет получает ровно то, что произошло внутри.
 *
 * Порядок гарантирован движком: `done` приходит последним всегда, в том числе
 * после `error`. Если соединение оборвалось, `done` не придёт вовсе.
 */
export function toSseEvent(event: DialogEvent): { name: string; data: Record<string, unknown> } {
  switch (event.type) {
    case 'text':
      return { name: 'text', data: { text: event.text } }
    case 'tool':
      return { name: 'tool', data: { name: event.name, input: event.input } }
    case 'apartments':
      return { name: 'apartments', data: { apartments: event.apartments } }
    case 'lead':
      return { name: 'lead', data: { lead: event.lead } }
    case 'error':
      return { name: 'error', data: { message: event.message } }
    case 'done':
      return { name: 'done', data: { reply: event.reply } }
  }
}

function writeSse(raw: ServerResponse, name: string, data: unknown): void {
  if (raw.writableEnded || raw.destroyed) return
  // JSON.stringify экранирует переводы строк — многострочный data не соберётся.
  raw.write(`event: ${name}\ndata: ${JSON.stringify(data)}\n\n`)
}

// ── CORS ─────────────────────────────────────────────────────

/**
 * Какой Origin разрешить. Пустой белый список означает «любой»:
 * виджет ставится на сайты, адреса которых заранее неизвестны.
 */
function allowedOrigin(request: FastifyRequest): string | null {
  const allowList = env.widgetAllowedOrigins
  if (allowList.length === 0) return '*'
  const origin = request.headers.origin
  if (typeof origin !== 'string' || origin === '') return null
  return allowList.includes(origin.replace(/\/+$/, '')) ? origin : null
}

function corsHeaders(request: FastifyRequest): Record<string, string> {
  const origin = allowedOrigin(request)
  if (origin === null) return {}
  const headers: Record<string, string> = { 'access-control-allow-origin': origin }
  // Ответ зависит от Origin — кэшу об этом нужно сказать.
  if (origin !== '*') headers['vary'] = 'Origin'
  return headers
}

// ── Маршруты ─────────────────────────────────────────────────

const chatRoutes: FastifyPluginAsync<ChatRoutesOptions> = async (app, options) => {
  const engine =
    options.engine ??
    new DialogEngine({
      db: app.prisma,
      settings: app.settings,
      logger: app.log,
      ...(options.modelClient ? { client: options.modelClient } : {}),
      ...(options.saveLead ? { saveLead: options.saveLead } : {}),
    })

  // Хук виден только маршрутам этого плагина: он зарегистрирован без
  // fastify-plugin, значит инкапсуляция Fastify его отсюда не выпустит.
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
      .header('access-control-allow-methods', 'GET, POST, OPTIONS')
      .header('access-control-allow-headers', 'content-type')
      .header('access-control-max-age', '86400')
      .code(204)
      .send()
  }

  app.options('/api/chat', preflight)
  app.options('/api/chat/:sessionId', preflight)
  app.options('/api/widget/config', preflight)

  // ── Публичные настройки виджета ────────────────────────────

  app.get('/api/widget/config', async (request, reply) => {
    const decision = readLimiter.check(`config:${request.ip}`)
    if (!decision.allowed) return tooManyRequests(reply, decision.retryAfterMs)

    const values = await app.settings.getPublic()
    return reply.header('cache-control', 'public, max-age=60').send({
      enabled: values.widget_enabled,
      title: values.widget_title,
      accentColor: values.widget_accent_color,
      greeting: values.widget_greeting,
      exampleQuestions: values.widget_example_questions,
      privacyPolicyUrl: values.privacy_policy_url === '' ? null : values.privacy_policy_url,
    })
  })

  // ── История переписки ──────────────────────────────────────

  app.get('/api/chat/:sessionId', async (request, reply) => {
    const { sessionId } = request.params as { sessionId: string }
    if (sessionId.length > SESSION_ID_MAX || !SESSION_ID_PATTERN.test(sessionId)) {
      return reply.code(400).send({ error: 'bad_session', message: 'Неверный sessionId' })
    }

    const decision = readLimiter.check(`history:${request.ip}`)
    if (!decision.allowed) return tooManyRequests(reply, decision.retryAfterMs)

    const limit = parseLimit((request.query as Record<string, unknown> | undefined)?.['limit'])

    const conversation = await app.prisma.conversation.findUnique({ where: { sessionId } })
    // Неизвестная сессия — не ошибка: у посетителя мог остаться старый
    // localStorage от базы, которую с тех пор почистили.
    if (!conversation) {
      return reply.send({ sessionId, conversationId: null, startedAt: null, messages: [] })
    }

    const rows = await app.prisma.message.findMany({
      where: { conversationId: conversation.id },
      orderBy: { createdAt: 'desc' },
      take: limit,
    })

    return reply.send({
      sessionId,
      conversationId: conversation.id,
      startedAt: conversation.startedAt.toISOString(),
      messages: rows.reverse().map((row) => ({
        id: row.id,
        role: row.role,
        content: row.content,
        apartments: Array.isArray(row.apartments) ? row.apartments : [],
        createdAt: row.createdAt.toISOString(),
      })),
    })
  })

  // ── Сообщение в чат ────────────────────────────────────────

  app.post('/api/chat', async (request, reply) => {
    const parsed = parseChatBody(request.body)
    if (!parsed.ok) {
      return reply.code(400).send({ error: 'bad_request', message: parsed.error })
    }
    const { sessionId, message } = parsed.value

    // Лимиты проверяются до любых обращений к базе: отказ должен быть дешевле
    // того, от чего он защищает.
    const bySession = sessionLimiter.check(`session:${sessionId}`)
    if (!bySession.allowed) return tooManyRequests(reply, bySession.retryAfterMs)

    const byIp = ipLimiter.check(`ip:${request.ip}`)
    if (!byIp.allowed) return tooManyRequests(reply, byIp.retryAfterMs)

    if (streaming.has(sessionId)) {
      return reply.code(429).send({
        error: 'already_streaming',
        message: 'Предыдущий ответ ещё не дописан. Дождитесь его окончания.',
        retryAfter: 1,
      })
    }

    if (!(await app.settings.get('widget_enabled'))) {
      return reply.code(403).send({ error: 'widget_disabled', message: 'Чат сейчас выключен' })
    }

    const conversation = await openConversation(parsed.value, request)

    streaming.add(sessionId)

    const raw = reply.raw
    let clientGone = false
    raw.on('close', () => {
      clientGone = true
    })

    // Дальше Fastify в ответ не вмешивается: пишем в сокет сами.
    reply.hijack()
    raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-store, no-transform',
      connection: 'keep-alive',
      // Nginx буферизует ответы по умолчанию — со стримингом это несовместимо.
      'x-accel-buffering': 'no',
      ...corsHeaders(request),
    })

    writeSse(raw, 'ready', { conversationId: conversation.id, sessionId })

    // Пульс держит соединение живым через прокси, которые рвут простой.
    const ping = setInterval(() => {
      if (!raw.writableEnded && !raw.destroyed) raw.write(': ping\n\n')
    }, SSE_PING_INTERVAL_MS)
    ping.unref?.()

    try {
      // Выход из цикла по break вызывает generator.return(): движок
      // останавливается на текущем месте, а вместе с ним закрывается и поток
      // от Anthropic — оборванная вкладка не оставляет висящий запрос к модели.
      for await (const event of engine.reply({ conversationId: conversation.id, message })) {
        if (clientGone) break
        const { name, data } = toSseEvent(event)
        writeSse(raw, name, data)
      }
    } catch (error) {
      // Движок наружу не бросает; сюда попадёт разве что сбой базы.
      app.log.error({ err: error, sessionId }, 'Поток чата оборвался с ошибкой')
      writeSse(raw, 'error', { message: 'Не получилось ответить. Попробуйте ещё раз.' })
    } finally {
      clearInterval(ping)
      streaming.delete(sessionId)
      if (!raw.writableEnded && !raw.destroyed) raw.end()
    }

    return undefined
  })

  /**
   * Диалог по сессии: находится или заводится. Данные страницы и UTM пишутся
   * только при создании — этим занимается `ensureConversation`.
   *
   * Гонка двух одновременных первых сообщений упирается в уникальный индекс
   * по `sessionId`; в этом случае повторный поиск найдёт уже созданный диалог.
   */
  async function openConversation(body: ChatRequestBody, request: FastifyRequest) {
    const start = {
      sessionId: body.sessionId,
      pageUrl: body.pageUrl,
      referrer: body.referrer,
      utm: body.utm,
      userAgent: request.headers['user-agent'] ?? null,
    }
    try {
      return await ensureConversation(app.prisma, start)
    } catch {
      return await ensureConversation(app.prisma, start)
    }
  }
}

function tooManyRequests(reply: FastifyReply, retryAfterMs: number): FastifyReply {
  const seconds = retryAfterSeconds(retryAfterMs)
  return reply
    .code(429)
    .header('retry-after', String(seconds))
    .send({
      error: 'rate_limited',
      message: 'Слишком много запросов. Подождите немного и попробуйте снова.',
      retryAfter: seconds,
    })
}

function parseLimit(raw: unknown): number {
  const parsed = typeof raw === 'string' ? Number.parseInt(raw, 10) : Number.NaN
  if (!Number.isFinite(parsed) || parsed <= 0) return HISTORY_DEFAULT_LIMIT
  return Math.min(parsed, HISTORY_MAX_LIMIT)
}

export default chatRoutes
