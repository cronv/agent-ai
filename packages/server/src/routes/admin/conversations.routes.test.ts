import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildApp } from '../../app.js'
import { env } from '../../config/env.js'
import { ADMIN_SESSION_COOKIE } from '../../plugins/auth.js'
import { resetDatabase, testDb } from '../../testing/db.js'
import { resetLoginAttempts } from './auth.routes.js'

/**
 * Список переписок, фильтры, поиск по тексту сообщений и просмотр диалога.
 *
 * Переписки заводятся прямо в базе: как они появляются, проверяет тест API
 * чата — здесь проверяется то, что видит менеджер в админке.
 */

interface ConversationRowJson {
  id: string
  sessionId: string
  page: string | null
  utm: Record<string, string> | null
  messageCount: number
  tokensIn: number
  tokensOut: number
  firstMessage: string | null
  apartmentsShown: number
  lead: { name: string; phoneFormatted: string; status: string } | null
}

interface ListJson {
  conversations: ConversationRowJson[]
  total: number
  limit: number
  offset: number
  counts: { all: number; withLead: number; withoutLead: number }
}

interface MessageJson {
  role: 'user' | 'assistant'
  content: string
  apartments: { id: string; projectName: string | null; price: number }[]
  tools: { name: string; input: unknown }[]
  model: string | null
  tokensIn: number | null
  tokensOut: number | null
}

interface DetailJson {
  conversation: ConversationRowJson & {
    messages: MessageJson[]
    apartments: { id: string }[]
    leadCard: { phoneFormatted: string; webhookStatus: string } | null
    truncated: boolean
  }
}

const CARD = {
  id: 'apt-1',
  projectId: null,
  projectName: 'ЖК Северный парк',
  developer: null,
  district: 'Приморский',
  metro: 'Комендантский проспект',
  metroDistanceMin: 12,
  rooms: 2,
  area: 54.3,
  livingArea: null,
  kitchenArea: null,
  floor: 7,
  floorsTotal: 18,
  price: 12_400_000,
  pricePerM2: null,
  building: null,
  section: null,
  finishing: 'чистовая',
  deadline: '2027-06-30',
  planImageUrl: null,
  url: 'https://site.ru/apt-1',
}

describe('/api/admin/conversations', () => {
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

  /** Переписка с лидом (июль, 10-е) и переписка без лида (июль, 20-е). */
  async function seed(): Promise<{ withLead: string; withoutLead: string }> {
    const withLead = await testDb.conversation.create({
      data: {
        sessionId: 'sess-lead',
        pageUrl: 'https://site.ru/zhk-severny',
        referrer: 'https://yandex.ru/',
        utm: { utm_source: 'yandex', utm_medium: 'cpc' },
        startedAt: new Date('2026-07-10T10:00:00Z'),
        lastMessageAt: new Date('2026-07-10T10:05:00Z'),
        messageCount: 3,
        tokensIn: 1200,
        tokensOut: 400,
      },
    })

    await testDb.message.createMany({
      data: [
        {
          conversationId: withLead.id,
          role: 'user',
          content: 'Ищу двушку рядом с метро до 13 миллионов',
          createdAt: new Date('2026-07-10T10:00:00Z'),
        },
        {
          conversationId: withLead.id,
          role: 'assistant',
          content: 'Вот что подходит по вашему запросу',
          apartments: [CARD],
          toolCalls: [
            {
              id: 'toolu_1',
              name: 'search_apartments',
              input: { rooms: [2], price_max: 13_000_000 },
              result: '{"total":4}',
            },
          ],
          model: 'claude-haiku-4-5-20251001',
          tokensIn: 900,
          tokensOut: 300,
          createdAt: new Date('2026-07-10T10:01:00Z'),
        },
        {
          conversationId: withLead.id,
          role: 'user',
          content: 'А ипотека субсидированная есть?',
          createdAt: new Date('2026-07-10T10:05:00Z'),
        },
      ],
    })

    await testDb.lead.create({
      data: {
        conversationId: withLead.id,
        name: 'Иван Петров',
        phone: '+79123456789',
        status: 'in_progress',
        webhookStatus: 'failed',
        webhookError: 'HTTP 500 Internal Server Error',
        createdAt: new Date('2026-07-10T10:06:00Z'),
      },
    })

    const withoutLead = await testDb.conversation.create({
      data: {
        sessionId: 'sess-anon',
        pageUrl: 'https://site.ru/',
        startedAt: new Date('2026-07-20T10:00:00Z'),
        lastMessageAt: new Date('2026-07-20T10:02:00Z'),
        messageCount: 1,
      },
    })
    await testDb.message.create({
      data: {
        conversationId: withoutLead.id,
        role: 'user',
        content: 'Какие вообще студии есть в Приморском районе?',
        createdAt: new Date('2026-07-20T10:00:00Z'),
      },
    })

    return { withLead: withLead.id, withoutLead: withoutLead.id }
  }

  async function list(query = ''): Promise<ListJson> {
    const response = await app.inject({
      method: 'GET',
      url: `/api/admin/conversations${query}`,
      headers: { cookie },
    })
    expect(response.statusCode).toBe(200)
    return response.json() as ListJson
  }

  it('без сессии список закрыт', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/conversations' })
    expect(response.statusCode).toBe(401)
  })

  it('отдаёт переписки свежими сверху: первое сообщение, счётчики и лид', async () => {
    await seed()
    const body = await list()

    expect(body.total).toBe(2)
    expect(body.counts).toEqual({ all: 2, withLead: 1, withoutLead: 1 })
    expect(body.conversations.map((item) => item.sessionId)).toEqual(['sess-anon', 'sess-lead'])

    const first = body.conversations[1]
    expect(first?.firstMessage).toBe('Ищу двушку рядом с метро до 13 миллионов')
    expect(first?.messageCount).toBe(3)
    expect(first?.apartmentsShown).toBe(1)
    expect(first?.page).toBe('https://site.ru/zhk-severny')
    expect(first?.utm).toEqual({ utm_source: 'yandex', utm_medium: 'cpc' })
    expect(first?.lead?.name).toBe('Иван Петров')
    expect(first?.lead?.phoneFormatted).toBe('+7 (912) 345-67-89')
    expect(first?.lead?.status).toBe('in_progress')
    expect(body.conversations[0]?.lead).toBeNull()
  })

  it('ищет по тексту сообщений', async () => {
    await seed()

    const found = await list('?q=ипотека')
    expect(found.total).toBe(1)
    expect(found.conversations[0]?.sessionId).toBe('sess-lead')

    const другая = await list('?q=студии')
    expect(другая.conversations[0]?.sessionId).toBe('sess-anon')

    expect((await list('?q=пентхаус')).total).toBe(0)
  })

  it('ищет по имени и телефону лида', async () => {
    await seed()

    expect((await list('?q=петров')).total).toBe(1)
    expect((await list('?q=8 912 345')).total).toBe(1)
    expect((await list('?q=345-67-89')).total).toBe(1)
  })

  it('не принимает символы шаблона за подстановку', async () => {
    await seed()
    // «%» в запросе — это символ, а не «что угодно»: находиться не должно ничего.
    expect((await list('?q=%25')).total).toBe(0)
  })

  it('фильтрует по датам включительно', async () => {
    await seed()

    const day = await list('?from=2026-07-10&to=2026-07-10')
    expect(day.total).toBe(1)
    expect(day.conversations[0]?.sessionId).toBe('sess-lead')

    expect((await list('?from=2026-07-10&to=2026-07-20')).total).toBe(2)
  })

  it('фильтрует по наличию контакта, не теряя общие цифры', async () => {
    await seed()

    const withLead = await list('?lead=with')
    expect(withLead.total).toBe(1)
    expect(withLead.conversations[0]?.sessionId).toBe('sess-lead')
    expect(withLead.counts.all).toBe(2)

    const withoutLead = await list('?lead=without')
    expect(withoutLead.total).toBe(1)
    expect(withoutLead.conversations[0]?.sessionId).toBe('sess-anon')
  })

  it('листает список', async () => {
    await seed()

    const page = await list('?limit=1&offset=1')
    expect(page.total).toBe(2)
    expect(page.conversations).toHaveLength(1)
    expect(page.conversations[0]?.sessionId).toBe('sess-lead')

    // Страница за концом списка не должна терять общее число.
    const beyond = await list('?limit=1&offset=10')
    expect(beyond.total).toBe(2)
    expect(beyond.conversations).toHaveLength(0)
  })

  it('показывает диалог целиком: порядок, роли, карточки квартир, модель и токены', async () => {
    const { withLead } = await seed()

    const response = await app.inject({
      method: 'GET',
      url: `/api/admin/conversations/${withLead}`,
      headers: { cookie },
    })
    expect(response.statusCode).toBe(200)

    const { conversation } = response.json() as DetailJson

    expect(conversation.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'user'])
    expect(conversation.messages[0]?.content).toBe('Ищу двушку рядом с метро до 13 миллионов')
    expect(conversation.truncated).toBe(false)

    const answer = conversation.messages[1]
    expect(answer?.apartments).toHaveLength(1)
    expect(answer?.apartments[0]?.projectName).toBe('ЖК Северный парк')
    expect(answer?.apartments[0]?.price).toBe(12_400_000)
    expect(answer?.model).toBe('claude-haiku-4-5-20251001')
    expect(answer?.tokensIn).toBe(900)
    expect(answer?.tokensOut).toBe(300)
    expect(answer?.tools[0]?.name).toBe('search_apartments')

    // Всё, что показали за диалог, — одним списком, без повторов.
    expect(conversation.apartments.map((card) => card.id)).toEqual(['apt-1'])

    expect(conversation.tokensIn).toBe(1200)
    expect(conversation.tokensOut).toBe(400)
    expect(conversation.leadCard?.phoneFormatted).toBe('+7 (912) 345-67-89')
    expect(conversation.leadCard?.webhookStatus).toBe('failed')
  })

  it('отвечает 404 на неизвестную переписку', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/conversations/нет-такой',
      headers: { cookie },
    })
    expect(response.statusCode).toBe(404)
  })
})
