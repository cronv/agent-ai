import { readFileSync } from 'node:fs'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildApp } from '../../app.js'
import { env } from '../../config/env.js'
import { ADMIN_SESSION_COOKIE } from '../../plugins/auth.js'
import type { FeedImportResult } from '../../services/feeds/import.js'
import { syncFeed } from '../../services/feeds/sync.js'
import { resetDatabase, testDb } from '../../testing/db.js'
import { resetLoginAttempts } from './auth.routes.js'

/**
 * Маршруты фидов целиком: реальная база, реальный импорт.
 *
 * Ручное обновление проверяется против маленького HTTP-сервера, который отдаёт
 * ту же выгрузку Яндекса, что и тесты импорта, — так видно весь путь от кнопки
 * в админке до строк в базе и записанного состояния фида.
 */

function fixture(name: string): string {
  return readFileSync(new URL(`../../services/feeds/__fixtures__/${name}`, import.meta.url), 'utf8')
}

/** Сервер застройщика: отдаёт выгрузку либо ошибку — как настоящий. */
class FakeFeedHost {
  private server: Server | null = null
  private port = 0
  body = fixture('yandex-realty.xml')
  status = 200

  async start(): Promise<void> {
    this.server = createServer((_request, response) => {
      response.writeHead(this.status, { 'content-type': 'application/xml; charset=utf-8' })
      response.end(this.status === 200 ? this.body : 'нет доступа')
    })
    await new Promise<void>((resolve) => {
      this.server?.listen(0, '127.0.0.1', resolve)
    })
    this.port = (this.server?.address() as AddressInfo).port
  }

  url(path = '/feed.xml'): string {
    return `http://127.0.0.1:${this.port}${path}`
  }

  async stop(): Promise<void> {
    const server = this.server
    this.server = null
    if (!server) return
    await new Promise<void>((resolve) => {
      server.close(() => resolve())
    })
  }
}

interface FeedViewJson {
  id: string
  name: string
  url: string
  format: string
  scheduleCron: string | null
  isActive: boolean
  lastStatus: string | null
  lastCount: number | null
  lastError: string | null
  lastRunAt: string | null
  isSyncing: boolean
  apartments: { active: number; total: number }
}

describe('маршруты фидов', () => {
  let app: FastifyInstance
  let cookie: string
  const host = new FakeFeedHost()

  beforeAll(async () => {
    app = await buildApp({ prisma: testDb, serveStatic: false })
    await app.ready()
    await host.start()
  })

  afterAll(async () => {
    await host.stop()
    await app.close()
  })

  beforeEach(async () => {
    await resetDatabase()
    resetLoginAttempts()
    host.status = 200
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: env.adminUsername, password: env.adminPassword },
    })
    const issued = login.cookies.find((item) => item.name === ADMIN_SESSION_COOKIE)
    cookie = `${ADMIN_SESSION_COOKIE}=${String(issued?.value)}`
  })

  async function createFeed(payload: Record<string, unknown> = {}): Promise<FeedViewJson> {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/feeds',
      headers: { cookie },
      payload: { name: 'Фид застройщика', url: host.url(), ...payload },
    })
    expect(response.statusCode).toBe(201)
    return response.json<FeedViewJson>()
  }

  it('без сессии не пускает', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/feeds' })
    expect(response.statusCode).toBe(401)
  })

  describe('CRUD', () => {
    it('заводит фид и показывает его в списке', async () => {
      const created = await createFeed({ name: 'Северный парк', format: 'cian' })

      expect(created).toMatchObject({
        name: 'Северный парк',
        format: 'cian',
        isActive: true,
        lastStatus: null,
        isSyncing: false,
        apartments: { active: 0, total: 0 },
      })

      const list = await app.inject({ method: 'GET', url: '/api/admin/feeds', headers: { cookie } })
      expect(list.statusCode).toBe(200)
      const body = list.json<{ feeds: FeedViewJson[]; syncing: string[] }>()
      expect(body.feeds).toHaveLength(1)
      expect(body.feeds[0]?.id).toBe(created.id)
      expect(body.syncing).toEqual([])
    })

    it('отдаёт один фид и 404 на несуществующий', async () => {
      const created = await createFeed()

      const found = await app.inject({ method: 'GET', url: `/api/admin/feeds/${created.id}`, headers: { cookie } })
      expect(found.statusCode).toBe(200)
      expect(found.json<FeedViewJson>().name).toBe('Фид застройщика')

      const missing = await app.inject({ method: 'GET', url: '/api/admin/feeds/missing-id', headers: { cookie } })
      expect(missing.statusCode).toBe(404)
    })

    it('меняет фид', async () => {
      const created = await createFeed()

      const response = await app.inject({
        method: 'PATCH',
        url: `/api/admin/feeds/${created.id}`,
        headers: { cookie },
        payload: { name: 'Переименованный', isActive: false, scheduleCron: '0 6 * * *' },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json<FeedViewJson>()).toMatchObject({
        name: 'Переименованный',
        isActive: false,
        scheduleCron: '0 6 * * *',
        url: created.url,
      })
    })

    it('удаляет фид вместе с квартирами', async () => {
      const created = await createFeed()
      await testDb.apartment.create({ data: { feedId: created.id, externalId: 'a-1', price: 10_000_000 } })

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/admin/feeds/${created.id}`,
        headers: { cookie },
      })

      expect(response.statusCode).toBe(200)
      expect(await testDb.feed.count()).toBe(0)
      expect(await testDb.apartment.count()).toBe(0)
    })

    it('не принимает ссылку без http и негодное расписание', async () => {
      const badUrl = await app.inject({
        method: 'POST',
        url: '/api/admin/feeds',
        headers: { cookie },
        payload: { name: 'Фид', url: 'ftp://dom.ru/feed.xml' },
      })
      expect(badUrl.statusCode).toBe(400)
      expect(badUrl.json<{ message: string }>().message).toMatch(/http/i)

      const badCron = await app.inject({
        method: 'POST',
        url: '/api/admin/feeds',
        headers: { cookie },
        payload: { name: 'Фид', url: host.url(), scheduleCron: 'каждый час' },
      })
      expect(badCron.statusCode).toBe(400)
      expect(badCron.json<{ message: string }>().message).toMatch(/Расписание/)
    })

    it('не принимает custom без соответствия полей', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/feeds',
        headers: { cookie },
        payload: { name: 'Свой формат', url: host.url(), format: 'custom' },
      })

      expect(response.statusCode).toBe(400)
      expect(response.json<{ message: string }>().message).toMatch(/соответствие полей/i)
    })

    it('отдаёт справочник для формы маппинга', async () => {
      const response = await app.inject({ method: 'GET', url: '/api/admin/feeds/meta', headers: { cookie } })

      expect(response.statusCode).toBe(200)
      const meta = response.json<{ formats: string[]; fields: string[]; defaultCron: string }>()
      expect(meta.formats).toEqual(['yandex', 'cian', 'domclick', 'custom'])
      expect(meta.fields).toContain('externalId')
      expect(meta.defaultCron).toBe('0 */3 * * *')
    })
  })

  describe('POST /api/admin/feeds/:id/sync', () => {
    it('обновляет фид немедленно и возвращает результат', async () => {
      const created = await createFeed()

      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/feeds/${created.id}/sync`,
        headers: { cookie },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ result: FeedImportResult; feed: FeedViewJson }>()
      expect(body.result).toMatchObject({ status: 'ok', total: 5, created: 5, activeCount: 5 })
      expect(body.feed).toMatchObject({ lastStatus: 'ok', lastCount: 5, lastError: null })
      expect(body.feed.lastRunAt).not.toBeNull()
      expect(body.feed.apartments).toEqual({ active: 5, total: 5 })

      expect(await testDb.apartment.count({ where: { feedId: created.id } })).toBe(5)
    })

    it('недоступный фид не роняет запрос, а становится ошибкой в состоянии фида', async () => {
      const created = await createFeed()
      host.status = 503

      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/feeds/${created.id}/sync`,
        headers: { cookie },
      })

      expect(response.statusCode).toBe(200)
      const body = response.json<{ result: FeedImportResult; feed: FeedViewJson }>()
      expect(body.result.status).toBe('error')
      expect(body.feed.lastStatus).toBe('error')
      expect(body.feed.lastError).toMatch(/503/)
    })

    it('пока фид обновляется, второй запуск получает 409', async () => {
      const created = await createFeed()
      let release = (): void => undefined
      const gate = new Promise<void>((resolve) => {
        release = resolve
      })

      // Занимаем фид «долгим» прогоном — тем же замком, что и настоящий импорт.
      const running = syncFeed(created.id, {
        db: testDb,
        importer: async () => {
          await gate
          return { status: 'ok' } as unknown as FeedImportResult
        },
      })

      const response = await app.inject({
        method: 'POST',
        url: `/api/admin/feeds/${created.id}/sync`,
        headers: { cookie },
      })

      expect(response.statusCode).toBe(409)
      expect(response.json<{ error: string; message: string }>()).toMatchObject({ error: 'feed_busy' })

      const list = await app.inject({ method: 'GET', url: '/api/admin/feeds', headers: { cookie } })
      expect(list.json<{ syncing: string[] }>().syncing).toEqual([created.id])

      release()
      await running

      // Замок снят — следующий запуск проходит.
      const second = await app.inject({
        method: 'POST',
        url: `/api/admin/feeds/${created.id}/sync`,
        headers: { cookie },
      })
      expect(second.statusCode).toBe(200)
    })

    it('на несуществующий фид отвечает 404', async () => {
      const response = await app.inject({
        method: 'POST',
        url: '/api/admin/feeds/missing-id/sync',
        headers: { cookie },
      })
      expect(response.statusCode).toBe(404)
    })
  })
})
