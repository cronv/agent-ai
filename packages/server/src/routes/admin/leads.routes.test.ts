import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildApp } from '../../app.js'
import { env } from '../../config/env.js'
import { ADMIN_SESSION_COOKIE } from '../../plugins/auth.js'
import { CSV_BOM } from '../../services/leads/index.js'
import { resetDatabase, testDb } from '../../testing/db.js'
import { resetLoginAttempts } from './auth.routes.js'

/**
 * Список лидов, фильтры, статусы и выгрузка. Лиды заводятся прямо в базе:
 * приём контакта проверяется отдельно, здесь проверяется работа со списком.
 */

interface LeadRowJson {
  id: string
  name: string
  phone: string
  phoneFormatted: string
  status: string
  webhookStatus: string
  webhookError: string | null
  apartments: unknown[]
  conversation: { page: string | null; utm: Record<string, string> | null } | null
}

describe('/api/admin/leads', () => {
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

  async function seed(): Promise<void> {
    const conversation = await testDb.conversation.create({
      data: {
        sessionId: 'sess-1',
        pageUrl: 'https://site.ru/zhk-severny',
        utm: { utm_source: 'yandex', utm_medium: 'cpc' },
      },
    })

    await testDb.lead.create({
      data: {
        conversationId: conversation.id,
        name: 'Иван Петров',
        phone: '+79123456789',
        comment: 'Хочу двушку; перезвонить после 18',
        consentAt: new Date('2026-07-10T10:00:00Z'),
        createdAt: new Date('2026-07-10T10:00:00Z'),
        webhookStatus: 'failed',
        webhookError: 'HTTP 500 Internal Server Error',
      },
    })
    await testDb.lead.create({
      data: {
        name: 'Мария Сидорова',
        phone: '+79990001122',
        status: 'reached',
        consentAt: new Date('2026-07-20T10:00:00Z'),
        createdAt: new Date('2026-07-20T10:00:00Z'),
      },
    })
  }

  async function list(query = ''): Promise<{ leads: LeadRowJson[]; total: number; counts: Record<string, number> }> {
    const response = await app.inject({ method: 'GET', url: `/api/admin/leads${query}`, headers: { cookie } })
    expect(response.statusCode).toBe(200)
    return response.json() as { leads: LeadRowJson[]; total: number; counts: Record<string, number> }
  }

  it('без сессии список закрыт', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/leads' })
    expect(response.statusCode).toBe(401)
  })

  it('отдаёт лиды новыми сверху вместе с источником и ошибкой вебхука', async () => {
    await seed()
    const body = await list()

    expect(body.total).toBe(2)
    expect(body.leads.map((lead) => lead.name)).toEqual(['Мария Сидорова', 'Иван Петров'])

    const ivan = body.leads[1]
    expect(ivan?.phoneFormatted).toBe('+7 (912) 345-67-89')
    expect(ivan?.conversation?.page).toBe('https://site.ru/zhk-severny')
    expect(ivan?.conversation?.utm).toEqual({ utm_source: 'yandex', utm_medium: 'cpc' })
    expect(ivan?.webhookStatus).toBe('failed')
    expect(ivan?.webhookError).toBe('HTTP 500 Internal Server Error')

    expect(body.counts['all']).toBe(2)
    expect(body.counts['new']).toBe(1)
    expect(body.counts['reached']).toBe(1)
  })

  it('фильтрует по статусу', async () => {
    await seed()
    const body = await list('?status=reached')
    expect(body.total).toBe(1)
    expect(body.leads[0]?.name).toBe('Мария Сидорова')
  })

  it('фильтрует по датам включительно', async () => {
    await seed()

    const day = await list('?from=2026-07-10&to=2026-07-10')
    expect(day.total).toBe(1)
    expect(day.leads[0]?.name).toBe('Иван Петров')

    const period = await list('?from=2026-07-10&to=2026-07-20')
    expect(period.total).toBe(2)
  })

  it('ищет по имени и по телефону', async () => {
    await seed()

    expect((await list('?q=петров')).total).toBe(1)
    expect((await list('?q=8 912')).total).toBe(1)
    expect((await list('?q=000-11-22')).total).toBe(1)
    expect((await list('?q=Сергей')).total).toBe(0)
  })

  it('листает список', async () => {
    await seed()
    const page = await list('?limit=1&offset=1')
    expect(page.total).toBe(2)
    expect(page.leads).toHaveLength(1)
    expect(page.leads[0]?.name).toBe('Иван Петров')
  })

  it('меняет статус лида', async () => {
    await seed()
    const before = await list()
    const target = before.leads[0]
    if (!target) throw new Error('нет лидов')

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/leads/${target.id}`,
      headers: { cookie },
      payload: { status: 'in_progress' },
    })

    expect(response.statusCode).toBe(200)
    expect((response.json() as { lead: LeadRowJson }).lead.status).toBe('in_progress')
    const stored = await testDb.lead.findUniqueOrThrow({ where: { id: target.id } })
    expect(stored.status).toBe('in_progress')
  })

  it('отклоняет неизвестный статус и несуществующий лид', async () => {
    await seed()
    const bad = await app.inject({
      method: 'PATCH',
      url: '/api/admin/leads/xxx',
      headers: { cookie },
      payload: { status: 'позвонил' },
    })
    expect(bad.statusCode).toBe(400)

    const missing = await app.inject({
      method: 'PATCH',
      url: '/api/admin/leads/xxx',
      headers: { cookie },
      payload: { status: 'rejected' },
    })
    expect(missing.statusCode).toBe(404)
  })

  it('выгружает CSV, который Excel открывает без проблем с кириллицей', async () => {
    await seed()

    const response = await app.inject({ method: 'GET', url: '/api/admin/leads/export.csv', headers: { cookie } })

    expect(response.statusCode).toBe(200)
    expect(response.headers['content-type']).toContain('text/csv')
    expect(String(response.headers['content-disposition'])).toContain('.csv')

    const csv = response.body
    expect(csv.startsWith(CSV_BOM)).toBe(true)
    expect(csv).toContain('Имя;Телефон')
    expect(csv).toContain('Иван Петров')
    expect(csv).toContain('+7 (912) 345-67-89')
    // Комментарий с точкой с запятой не должен разъехаться по колонкам.
    expect(csv).toContain('"Хочу двушку; перезвонить после 18"')
  })

  it('выгрузка учитывает текущие фильтры', async () => {
    await seed()

    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/leads/export.csv?status=reached',
      headers: { cookie },
    })

    expect(response.body).toContain('Мария Сидорова')
    expect(response.body).not.toContain('Иван Петров')
  })
})
