import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildApp } from '../../app.js'
import { env } from '../../config/env.js'
import { ADMIN_SESSION_COOKIE } from '../../plugins/auth.js'
import type { DashboardSummary } from '../../services/dashboard/dashboard.service.js'
import { resetDatabase, testDb } from '../../testing/db.js'
import { resetLoginAttempts } from './auth.routes.js'

/**
 * Дашборд считает по-настоящему: в базу кладутся записи внутри недели и
 * заведомо старые, и проверяется, что в «за 7 дней» попали только первые.
 */

const DAY = 24 * 60 * 60 * 1000

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * DAY)
}

describe('GET /api/admin/dashboard', () => {
  let app: FastifyInstance
  let cookie: string

  beforeAll(async () => {
    app = await buildApp({ prisma: testDb, serveStatic: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await resetDatabase()
    resetLoginAttempts()
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: env.adminUsername, password: env.adminPassword },
    })
    const issued = login.cookies.find((item) => item.name === ADMIN_SESSION_COOKIE)
    cookie = `${ADMIN_SESSION_COOKIE}=${String(issued?.value)}`
  })

  async function fetchSummary(): Promise<DashboardSummary> {
    const response = await app.inject({ method: 'GET', url: '/api/admin/dashboard', headers: { cookie } })
    expect(response.statusCode).toBe(200)
    return response.json<DashboardSummary>()
  }

  it('на пустой базе отдаёт нули и пустой список фидов', async () => {
    const summary = await fetchSummary()

    expect(summary.conversations).toEqual({ period: 0, total: 0 })
    expect(summary.leads).toEqual({ period: 0, total: 0, new: 0 })
    expect(summary.apartments).toEqual({ active: 0 })
    expect(summary.projects).toEqual({ active: 0, total: 0 })
    expect(summary.feeds).toEqual([])
    expect(summary.periodDays).toBe(7)
  })

  it('считает диалоги и лиды за неделю, не захватывая старые', async () => {
    const conversationFresh = await testDb.conversation.create({
      data: { sessionId: 'свежая', startedAt: daysAgo(1) },
    })
    await testDb.conversation.create({ data: { sessionId: 'вчерашняя', startedAt: daysAgo(6) } })
    await testDb.conversation.create({ data: { sessionId: 'старая', startedAt: daysAgo(30) } })

    await testDb.lead.create({
      data: { conversationId: conversationFresh.id, name: 'Анна', phone: '+79990000001', createdAt: daysAgo(2) },
    })
    await testDb.lead.create({
      data: { name: 'Пётр', phone: '+79990000002', status: 'reached', createdAt: daysAgo(3) },
    })
    await testDb.lead.create({ data: { name: 'Старый', phone: '+79990000003', createdAt: daysAgo(20) } })

    const summary = await fetchSummary()

    expect(summary.conversations).toEqual({ period: 2, total: 3 })
    expect(summary.leads).toEqual({ period: 2, total: 3, new: 2 })
  })

  it('считает активные квартиры и ЖК', async () => {
    const project = await testDb.project.create({ data: { name: 'ЖК Река', slug: 'reka' } })
    await testDb.project.create({ data: { name: 'ЖК Парк', slug: 'park' } })
    await testDb.project.create({ data: { name: 'ЖК Архив', slug: 'arhiv', isActive: false } })

    const feed = await testDb.feed.create({ data: { name: 'Основной', url: 'https://example.test/feed.xml' } })
    await testDb.apartment.createMany({
      data: [
        { feedId: feed.id, projectId: project.id, externalId: 'a-1', price: 12_000_000 },
        { feedId: feed.id, projectId: project.id, externalId: 'a-2', price: 15_000_000 },
        { feedId: feed.id, projectId: project.id, externalId: 'a-3', price: 9_000_000, isActive: false },
      ],
    })

    const summary = await fetchSummary()

    expect(summary.apartments).toEqual({ active: 2 })
    expect(summary.projects).toEqual({ active: 2, total: 3 })
  })

  it('показывает состояние фидов вместе с ошибкой последнего запуска', async () => {
    const lastRun = daysAgo(0.5)
    await testDb.feed.create({
      data: {
        name: 'Живой фид',
        url: 'https://example.test/ok.xml',
        lastRunAt: lastRun,
        lastStatus: 'ok',
        lastCount: 128,
      },
    })
    await testDb.feed.create({
      data: {
        name: 'Битый фид',
        url: 'https://example.test/broken.xml',
        lastRunAt: lastRun,
        lastStatus: 'error',
        lastError: 'Сервер застройщика ответил 500',
      },
    })

    const summary = await fetchSummary()

    expect(summary.feeds).toHaveLength(2)
    const broken = summary.feeds.find((feed) => feed.name === 'Битый фид')
    expect(broken?.lastStatus).toBe('error')
    expect(broken?.lastError).toBe('Сервер застройщика ответил 500')
    expect(broken?.lastRunAt).toBe(lastRun.toISOString())

    const alive = summary.feeds.find((feed) => feed.name === 'Живой фид')
    expect(alive?.lastStatus).toBe('ok')
    expect(alive?.lastCount).toBe(128)
    expect(alive?.lastError).toBeNull()
  })
})
