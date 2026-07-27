import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildApp } from '../../app.js'
import { env } from '../../config/env.js'
import { ADMIN_SESSION_COOKIE } from '../../plugins/auth.js'
import { testDb } from '../../testing/db.js'
import { resetLoginAttempts } from './auth.routes.js'

/**
 * Вход в админку. Логин и пароль берутся из окружения — тест использует
 * те же значения, что и приложение, поэтому не зависит от содержимого `.env`.
 */

function sessionCookie(response: { cookies: Array<Record<string, unknown>> }): Record<string, unknown> | undefined {
  return response.cookies.find((cookie) => cookie['name'] === ADMIN_SESSION_COOKIE)
}

describe('Авторизация админки', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({ prisma: testDb, serveStatic: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(() => {
    resetLoginAttempts()
  })

  async function login(): Promise<string> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: env.adminUsername, password: env.adminPassword },
    })
    expect(response.statusCode).toBe(200)
    const cookie = sessionCookie(response)
    return `${ADMIN_SESSION_COOKIE}=${String(cookie?.['value'])}`
  }

  describe('без сессии', () => {
    it('не пускает в дашборд', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/admin/dashboard' })

      expect(response.statusCode).toBe(401)
      expect(response.json()).toMatchObject({ error: 'unauthorized' })
    })

    it('не пускает в «кто я»', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/admin/me' })

      expect(response.statusCode).toBe(401)
    })

    it('закрывает и те административные адреса, которых ещё нет', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/admin/leads?status=new' })

      expect(response.statusCode).toBe(401)
    })

    it('не мешает публичным адресам', async () => {
      const health = await app.inject({ method: 'GET', url: '/api/health' })

      expect(health.statusCode).toBe(200)
    })

    it('не принимает подделанную куку', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/dashboard',
        headers: { cookie: `${ADMIN_SESSION_COOKIE}=подделка` },
      })

      expect(response.statusCode).toBe(401)
    })
  })

  describe('вход', () => {
    it('выдаёт httpOnly-куку на верные логин и пароль', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/login',
        payload: { username: env.adminUsername, password: env.adminPassword },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json()).toMatchObject({ username: env.adminUsername })

      const cookie = sessionCookie(response)
      expect(cookie).toBeDefined()
      expect(cookie?.['httpOnly']).toBe(true)
      expect(cookie?.['sameSite']).toBe('Lax')
      expect(cookie?.['path']).toBe('/')
      expect(String(cookie?.['value']).length).toBeGreaterThan(20)
    })

    it('отказывает при неверном пароле и не выдаёт куку', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/login',
        payload: { username: env.adminUsername, password: 'не тот пароль' },
      })

      expect(response.statusCode).toBe(401)
      expect(sessionCookie(response)).toBeUndefined()
    })

    it('отказывает при неверном логине', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/login',
        payload: { username: 'кто-то другой', password: env.adminPassword },
      })

      expect(response.statusCode).toBe(401)
    })

    it('требует оба поля', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/login',
        payload: { username: env.adminUsername },
      })

      expect(response.statusCode).toBe(400)
    })

    it('перестаёт отвечать на перебор пароля', async () => {
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await app.inject({
          method: 'POST',
          url: '/api/admin/login',
          payload: { username: env.adminUsername, password: `перебор-${attempt}` },
        })
      }

      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/login',
        payload: { username: env.adminUsername, password: env.adminPassword },
      })

      expect(response.statusCode).toBe(429)
    })
  })

  describe('с сессией', () => {
    it('пускает в «кто я» и в дашборд', async () => {
      const cookie = await login()

      const me = await app.inject({ method: 'GET', url: '/api/admin/me', headers: { cookie } })
      expect(me.statusCode).toBe(200)
      expect(me.json()).toMatchObject({ username: env.adminUsername })

      const dashboard = await app.inject({ method: 'GET', url: '/api/admin/dashboard', headers: { cookie } })
      expect(dashboard.statusCode).toBe(200)
    })

    it('выход гасит куку', async () => {
      const cookie = await login()

      const response = await app.inject({ method: 'POST', url: '/api/admin/logout', headers: { cookie } })

      expect(response.statusCode).toBe(200)
      const cleared = sessionCookie(response)
      expect(cleared).toBeDefined()
      expect(cleared?.['value']).toBe('')
      expect(new Date(String(cleared?.['expires'])).getTime()).toBeLessThan(Date.now())
    })
  })
})
