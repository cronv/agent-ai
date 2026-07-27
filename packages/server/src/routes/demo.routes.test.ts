import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../app.js'
import { testDb } from '../testing/db.js'

/**
 * Раздача демо-комплекта. Смысл этих маршрутов в том, что импорт умеет ходить
 * только по http(s): демо-фид должен откуда-то скачиваться, и на ноутбуке без
 * интернета единственный доступный источник — сам сервер.
 */

describe('демонстрационный комплект', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({ prisma: testDb, serveStatic: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('отдаёт выгрузку на 30 квартир', async () => {
    const response = await app.inject({ method: 'GET', url: '/demo/feed.xml' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('application/xml')
    expect(response.body.match(/<offer /g) ?? []).toHaveLength(30)
  })

  it('подставляет в ссылки на планировки адрес приложения, а не метку', async () => {
    const response = await app.inject({ method: 'GET', url: '/demo/feed.xml' })

    expect(response.body).not.toContain('{{BASE_URL}}')
    expect(response.body).toContain('/demo/plans/plan-2k.svg')
    // Ссылка обязана быть абсолютной: карточку виджет рисует на чужом сайте.
    expect(response.body).toMatch(/<image>https?:\/\/[^<]+\/demo\/plans\//)
  })

  it('отдаёт планировку картинкой, доступной с чужого домена', async () => {
    const response = await app.inject({ method: 'GET', url: '/demo/plans/plan-2k.svg' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('image/svg+xml')
    expect(response.headers['access-control-allow-origin']).toBe('*')
    expect(response.body).toContain('<svg')
  })

  it('за пределы каталога планировок не выпускает', async () => {
    for (const url of ['/demo/plans/..%2F..%2Ffeed.xml', '/demo/plans/../../package.json', '/demo/plans/Нет.svg']) {
      const response = await app.inject({ method: 'GET', url })
      expect(response.statusCode).toBe(404)
    }
  })
})
