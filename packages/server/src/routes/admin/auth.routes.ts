import type { FastifyPluginAsync } from 'fastify'

import { ADMIN_SESSION_TTL_SECONDS, verifyAdminCredentials } from '../../plugins/auth.js'

/**
 * Вход, выход и «кто я» для админки.
 *
 *   POST /api/admin/login   { username, password }  → кука с сессией
 *   POST /api/admin/logout                          → куки больше нет
 *   GET  /api/admin/me                              → кто вошёл (401 без сессии)
 *
 * `login` и `logout` открыты без сессии — это оговорено в plugins/auth.ts.
 * Всё остальное под `/api/admin/` закрывается там же автоматически.
 */

interface LoginBody {
  username: string
  password: string
}

/**
 * Простейшая защита от перебора пароля: считаем неудачные попытки по IP.
 * Память процесса, без внешних хранилищ — сервис однопроцессный, а задача
 * скромная: сделать перебор бессмысленно медленным.
 */
const MAX_ATTEMPTS = 10
const WINDOW_MS = 5 * 60 * 1000

interface AttemptRecord {
  count: number
  firstAt: number
}

const attempts = new Map<string, AttemptRecord>()

function isThrottled(key: string, now: number): boolean {
  const record = attempts.get(key)
  if (!record) return false
  if (now - record.firstAt > WINDOW_MS) {
    attempts.delete(key)
    return false
  }
  return record.count >= MAX_ATTEMPTS
}

function registerFailure(key: string, now: number): void {
  const record = attempts.get(key)
  if (!record || now - record.firstAt > WINDOW_MS) {
    attempts.set(key, { count: 1, firstAt: now })
    return
  }
  record.count += 1
}

/** Сбрасывает счётчик попыток — используется тестами и после успешного входа. */
export function resetLoginAttempts(): void {
  attempts.clear()
}

const loginSchema = {
  body: {
    type: 'object',
    required: ['username', 'password'],
    properties: {
      username: { type: 'string', minLength: 1, maxLength: 200 },
      password: { type: 'string', minLength: 1, maxLength: 200 },
    },
    additionalProperties: false,
  },
} as const

const authRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: LoginBody }>('/api/admin/login', { schema: loginSchema }, async (request, reply) => {
    const key = request.ip
    const now = Date.now()

    if (isThrottled(key, now)) {
      return reply.code(429).send({
        error: 'too_many_attempts',
        message: 'Слишком много попыток входа. Подождите несколько минут.',
      })
    }

    const { username, password } = request.body
    if (!verifyAdminCredentials(username, password)) {
      registerFailure(key, now)
      request.log.warn({ ip: key }, 'Неудачная попытка входа в админку')
      return reply.code(401).send({ error: 'invalid_credentials', message: 'Неверный логин или пароль' })
    }

    attempts.delete(key)
    app.startAdminSession(reply, username)
    return reply.send({ username, expiresIn: ADMIN_SESSION_TTL_SECONDS })
  })

  app.post('/api/admin/logout', async (_request, reply) => {
    app.endAdminSession(reply)
    return reply.send({ ok: true })
  })

  app.get('/api/admin/me', async (request, reply) => {
    // Сюда попадаем только с валидной сессией — её проверил хук из plugins/auth.ts.
    return reply.send(request.admin)
  })
}

export default authRoutes
