import { createHash, timingSafeEqual } from 'node:crypto'

import fastifyCookie from '@fastify/cookie'
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify'
import fp from 'fastify-plugin'

import { env } from '../config/env.js'
import { signJwt, verifyJwt } from '../lib/jwt.js'

/**
 * Авторизация админки.
 *
 * Один вход: логин и пароль из переменных окружения (`ADMIN_USERNAME`,
 * `ADMIN_PASSWORD`). После успешного входа выдаётся JWT в httpOnly-куке —
 * JavaScript страницы её не видит, значит XSS не утащит сессию.
 *
 * Плагин делает две вещи:
 *
 * 1. Закрывает всё под `/api/admin/*` глобальным хуком `onRequest`.
 *    Новый административный маршрут защищён автоматически, помнить об этом
 *    не нужно. Исключения — только `PUBLIC_ADMIN_ROUTES` (вход и выход).
 *
 * 2. Даёт декоратор `app.requireAdmin` — тот же самый разбор куки в виде
 *    preHandler. Нужен, если маршрут живёт вне `/api/admin` или если хочется
 *    видеть защиту прямо в объявлении маршрута:
 *
 *      app.get('/api/admin/projects', { preHandler: app.requireAdmin }, handler)
 *
 *    Повторный вызов безопасен: если сессия уже разобрана, проверка не
 *    повторяется.
 *
 * Внутри обработчика авторизованный пользователь доступен как `request.admin`.
 */

/** Имя куки с сессией. */
export const ADMIN_SESSION_COOKIE = 'admin_session'

/**
 * Сколько живёт сессия. 12 часов — рабочий день: утром вошли, вечером кука
 * протухла сама. В админке видны телефоны клиентов, вечная сессия здесь лишняя.
 */
export const ADMIN_SESSION_TTL_SECONDS = 12 * 60 * 60

/** Адреса под `/api/admin`, которые доступны без сессии. */
const PUBLIC_ADMIN_ROUTES = new Set(['/api/admin/login', '/api/admin/logout'])

const ADMIN_API_PREFIX = '/api/admin/'

export interface AdminIdentity {
  username: string
  /** Когда истекает сессия, секунды unix. */
  expiresAt: number
}

declare module 'fastify' {
  interface FastifyInstance {
    /** preHandler/onRequest-проверка сессии: пропускает или отвечает 401. */
    requireAdmin: (request: FastifyRequest, reply: FastifyReply) => Promise<void>
    /** Выдаёт куку с сессией. Вызывается после проверки логина и пароля. */
    startAdminSession: (reply: FastifyReply, username: string) => void
    /** Гасит куку. Вызывается на выходе. */
    endAdminSession: (reply: FastifyReply) => void
  }

  interface FastifyRequest {
    /** Кто вошёл. `null`, пока сессия не разобрана или её нет. */
    admin: AdminIdentity | null
  }
}

/** Сравнение секретов за постоянное время, без утечки длины. */
function secretsMatch(a: string, b: string): boolean {
  const left = createHash('sha256').update(a).digest()
  const right = createHash('sha256').update(b).digest()
  return timingSafeEqual(left, right)
}

/**
 * Проверяет пару логин-пароль по переменным окружения.
 * Пустой пароль в окружении означает «вход закрыт», а не «пускать всех».
 */
export function verifyAdminCredentials(username: string, password: string): boolean {
  if (env.adminUsername === '' || env.adminPassword === '') return false
  const userOk = secretsMatch(username, env.adminUsername)
  const passOk = secretsMatch(password, env.adminPassword)
  return userOk && passOk
}

/** Путь запроса без строки запроса — по нему решается, защищать ли маршрут. */
function pathOf(url: string): string {
  const queryStart = url.indexOf('?')
  return queryStart === -1 ? url : url.slice(0, queryStart)
}

const authPlugin: FastifyPluginAsync = async (app) => {
  await app.register(fastifyCookie, { secret: env.sessionSecret })

  app.decorateRequest('admin', null)

  const requireAdmin = async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    if (request.admin) return

    const token = request.cookies[ADMIN_SESSION_COOKIE]
    const payload = token ? verifyJwt(token, env.sessionSecret) : null

    if (!payload) {
      await reply.code(401).send({ error: 'unauthorized', message: 'Нужно войти в админку' })
      return
    }

    request.admin = { username: payload.sub, expiresAt: payload.exp }
  }

  app.decorate('requireAdmin', requireAdmin)

  app.decorate('startAdminSession', (reply: FastifyReply, username: string): void => {
    const token = signJwt({ sub: username }, env.sessionSecret, ADMIN_SESSION_TTL_SECONDS)
    reply.setCookie(ADMIN_SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      path: '/',
      secure: env.isProduction,
      maxAge: ADMIN_SESSION_TTL_SECONDS,
    })
  })

  app.decorate('endAdminSession', (reply: FastifyReply): void => {
    reply.clearCookie(ADMIN_SESSION_COOKIE, { path: '/' })
  })

  // Общая защита: всё под /api/admin/, кроме входа и выхода.
  app.addHook('onRequest', async (request, reply) => {
    const path = pathOf(request.url)
    if (!path.startsWith(ADMIN_API_PREFIX)) return
    if (PUBLIC_ADMIN_ROUTES.has(path)) return
    await requireAdmin(request, reply)
  })
}

export default fp(authPlugin, { name: 'auth' })
