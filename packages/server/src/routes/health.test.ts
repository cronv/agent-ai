import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { buildApp } from '../app.js'
import { testDb } from '../testing/db.js'

describe('GET /api/health', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({ prisma: testDb, serveStatic: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('отвечает 200 и сообщает, что база на связи', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/health' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({ status: 'ok', db: 'ok' })
  })

  it('отвечает 503, когда база недоступна', async () => {
    const brokenDb = {
      $queryRaw: async () => {
        throw new Error('connection refused')
      },
    } as unknown as typeof testDb

    const brokenApp = await buildApp({ prisma: brokenDb, serveStatic: false })
    const response = await brokenApp.inject({ method: 'GET', url: '/api/health' })

    expect(response.statusCode).toBe(503)
    expect(response.json()).toEqual({ status: 'error', db: 'error' })

    await brokenApp.close()
  })

  it('стартовая страница открывается и говорит, что сервис работает', async () => {
    const response = await app.inject({ method: 'GET', url: '/' })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/html')
    expect(response.body).toContain('сервис работает')
  })
})
