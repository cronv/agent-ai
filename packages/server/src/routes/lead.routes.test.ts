import type { FastifyInstance } from 'fastify'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'

import { buildApp } from '../app.js'
import { SettingsService } from '../services/settings/index.js'
import { resetDatabase, testDb } from '../testing/db.js'

/**
 * Публичная форма контакта. Проверяется то, на что опирается виджет:
 * коды ошибок, нормализация телефона, отсутствие дублей.
 * Мокается только вебхук — в интернет тесты не ходят.
 */

const settings = new SettingsService({ db: testDb })

describe('POST /api/lead', () => {
  let app: FastifyInstance
  const fetchImpl = vi.fn(() => Promise.resolve(new Response('{}', { status: 200 })))

  beforeAll(async () => {
    app = await buildApp({
      prisma: testDb,
      serveStatic: false,
      leads: { fetchImpl: fetchImpl as never, webhookRetryDelayMs: 0, webhookTimeoutMs: 200 },
    })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await resetDatabase()
    fetchImpl.mockClear()
  })

  // Вебхук уходит фоном; недоговорившая отправка держит строку в базе, и
  // очистка перед следующим тестом встала бы с ней в дедлок.
  afterEach(async () => {
    await app.leads.whenIdle()
  })

  async function post(payload: Record<string, unknown>): Promise<ReturnType<FastifyInstance['inject']>> {
    return app.inject({ method: 'POST', url: '/api/lead', payload })
  }

  it('доступен без куки админки — это форма на чужом сайте', async () => {
    const response = await post({ sessionId: 's1', name: 'Иван', phone: '+79123456789', consent: true })
    expect(response.statusCode).toBe(201)
  })

  it('сохраняет контакт и привязывает его к диалогу сессии', async () => {
    const response = await post({
      sessionId: 's1',
      name: 'Иван',
      phone: '8 (912) 345-67-89',
      comment: 'Перезвоните вечером',
      consent: true,
      page: 'https://site.ru/zhk',
      utm: { utm_source: 'yandex' },
    })

    expect(response.statusCode).toBe(201)
    const body = response.json() as { lead: { id: string; phone: string; phoneFormatted: string } }
    expect(body.lead.phone).toBe('+79123456789')
    expect(body.lead.phoneFormatted).toBe('+7 (912) 345-67-89')

    const stored = await testDb.lead.findUniqueOrThrow({ where: { id: body.lead.id } })
    const conversation = await testDb.conversation.findUniqueOrThrow({ where: { sessionId: 's1' } })
    expect(stored.conversationId).toBe(conversation.id)
    expect(conversation.pageUrl).toBe('https://site.ru/zhk')
  })

  it('без согласия отвечает понятной ошибкой и ничего не сохраняет', async () => {
    const response = await post({ sessionId: 's1', name: 'Иван', phone: '+79123456789', consent: false })

    expect(response.statusCode).toBe(400)
    const body = response.json() as { error: string; message: string }
    expect(body.error).toBe('consent_required')
    expect(body.message).toContain('согласия')
    expect(await testDb.lead.count()).toBe(0)
  })

  it('согласие обязательно даже если поле не прислали вовсе', async () => {
    const response = await post({ sessionId: 's1', name: 'Иван', phone: '+79123456789' })
    expect(response.statusCode).toBe(400)
    expect((response.json() as { error: string }).error).toBe('consent_required')
  })

  it('мусор вместо телефона отклоняется с подсказкой формата', async () => {
    const response = await post({ sessionId: 's1', name: 'Иван', phone: '12345', consent: true })

    expect(response.statusCode).toBe(400)
    const body = response.json() as { error: string; message: string }
    expect(body.error).toBe('bad_phone')
    expect(body.message).toContain('+7 (912) 345-67-89')
  })

  it('повторная отправка в той же сессии обновляет тот же лид', async () => {
    const first = await post({ sessionId: 's1', name: 'Иван', phone: '89123456789', consent: true })
    const second = await post({ sessionId: 's1', name: 'Иван Петров', phone: '+79990001122', consent: true })

    expect(second.statusCode).toBe(201)
    expect((second.json() as { lead: { id: string } }).lead.id).toBe(
      (first.json() as { lead: { id: string } }).lead.id,
    )
    expect(await testDb.lead.count()).toBe(1)
  })

  it('отправляет лид в вебхук, если адрес задан в настройках', async () => {
    await settings.set('lead_webhook_url', 'https://hook.example/amo')

    const response = await post({ sessionId: 's1', name: 'Иван', phone: '+79123456789', consent: true })
    expect(response.statusCode).toBe(201)

    await app.leads.whenIdle()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })

  // ── Кросс-доменная отправка ──────────────────────────────
  //
  // Виджет стоит на чужом сайте, тело у формы — application/json, значит
  // браузер всегда шлёт предполётный OPTIONS и без правильного ответа на него
  // контакт не уйдёт вовсе. На демо-стенде и при установке на тот же домен
  // это незаметно, поэтому проверяется отдельно.

  it('отвечает на предполётный запрос браузера с чужого домена', async () => {
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/lead',
      headers: {
        origin: 'https://novostroyki.example',
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'content-type',
      },
    })

    expect(preflight.statusCode).toBe(204)
    expect(preflight.headers['access-control-allow-origin']).toBe('*')
    expect(preflight.headers['access-control-allow-methods']).toContain('POST')
    expect(preflight.headers['access-control-allow-headers']).toBe('content-type')
    // Кука админки в кросс-доменный запрос попасть не должна ни при каких условиях.
    expect(preflight.headers['access-control-allow-credentials']).toBeUndefined()
  })

  it('сохраняет контакт, отправленный с чужого домена, и отдаёт заголовки CORS', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/lead',
      headers: { origin: 'https://novostroyki.example', 'content-type': 'application/json' },
      payload: { sessionId: 's1', name: 'Иван', phone: '+79123456789', consent: true },
    })

    expect(response.statusCode).toBe(201)
    expect(response.headers['access-control-allow-origin']).toBe('*')
    expect(response.headers['access-control-allow-credentials']).toBeUndefined()
    expect(await testDb.lead.count()).toBe(1)
  })

  it('ошибку формы браузер тоже сможет прочитать — заголовки стоят и на 400', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/lead',
      headers: { origin: 'https://novostroyki.example', 'content-type': 'application/json' },
      payload: { sessionId: 's1', name: 'Иван', phone: '12345', consent: true },
    })

    expect(response.statusCode).toBe(400)
    expect(response.headers['access-control-allow-origin']).toBe('*')
  })

  it('на админку эти правила не распространяются', async () => {
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/admin/leads',
      headers: { origin: 'https://evil.example', 'access-control-request-method': 'GET' },
    })

    expect(preflight.headers['access-control-allow-origin']).toBeUndefined()
    expect(preflight.statusCode).not.toBe(204)
  })

  it('падение вебхука не мешает ответу и сохранению', async () => {
    await settings.set('lead_webhook_url', 'https://hook.example/amo')
    fetchImpl.mockRejectedValue(new Error('сеть недоступна'))

    const response = await post({ sessionId: 's1', name: 'Иван', phone: '+79123456789', consent: true })
    expect(response.statusCode).toBe(201)

    await app.leads.whenIdle()
    const stored = await testDb.lead.findFirstOrThrow()
    expect(stored.webhookStatus).toBe('failed')
    expect(stored.webhookError).toContain('сеть недоступна')

    fetchImpl.mockResolvedValue(new Response('{}', { status: 200 }))
  })
})
