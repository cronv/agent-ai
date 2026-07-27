import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { resetDatabase, testDb } from '../../testing/db.js'
import type { ApartmentCard } from '../dialog/apartments.js'
import {
  DialogEngine,
  type ModelBlock,
  type ModelClient,
  type ModelRequest,
  type ModelStreamEvent,
} from '../dialog/index.js'
import { SettingsService } from '../settings/index.js'
import { LeadService, LeadValidationError, type LeadWebhookPayload } from './index.js'

/**
 * Приём контакта поверх настоящей базы. Мокается ровно одно — вебхук:
 * тесты не ходят в интернет.
 */

const settings = new SettingsService({ db: testDb })

interface WebhookMock {
  fetchImpl: ReturnType<typeof vi.fn>
  payloads: () => LeadWebhookPayload[]
}

function webhookMock(response: () => Response = () => new Response('{}', { status: 200 })): WebhookMock {
  const fetchImpl = vi.fn((_url: string, init: RequestInit) => Promise.resolve(response()))
  return {
    fetchImpl,
    payloads: () =>
      fetchImpl.mock.calls.map(([, init]) => JSON.parse(String((init as RequestInit).body)) as LeadWebhookPayload),
  }
}

/**
 * Созданные в тесте сервисы. Вебхук уходит фоном, и незавершённая отправка
 * держит строку в базе — очистка перед следующим тестом встала бы в дедлок.
 * Поэтому после каждого теста ждём, пока фоновые задачи договорят.
 */
const services: LeadService[] = []

afterEach(async () => {
  await Promise.all(services.map((service) => service.whenIdle()))
  services.length = 0
})

function makeService(mock?: WebhookMock): LeadService {
  const service = new LeadService({
    db: testDb,
    settings,
    logger: { error: () => undefined, info: () => undefined },
    ...(mock ? { fetchImpl: mock.fetchImpl as never } : {}),
    webhookRetryDelayMs: 0,
    webhookTimeoutMs: 200,
  })
  services.push(service)
  return service
}

async function conversation(sessionId = 'sess-1'): Promise<string> {
  const row = await testDb.conversation.create({ data: { sessionId, pageUrl: 'https://site.ru/zhk' } })
  return row.id
}

function card(overrides: Partial<ApartmentCard> = {}): ApartmentCard {
  return {
    id: 'apt-1',
    projectId: 'p1',
    projectName: 'ЖК Северный',
    developer: null,
    district: null,
    metro: null,
    metroDistanceMin: null,
    rooms: 2,
    area: 54.2,
    livingArea: null,
    kitchenArea: null,
    floor: 7,
    floorsTotal: 18,
    price: 18_400_000,
    pricePerM2: null,
    building: null,
    section: null,
    finishing: null,
    deadline: null,
    planImageUrl: null,
    url: null,
    ...overrides,
  }
}

describe('LeadService.capture', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('сохраняет контакт и привязывает его к диалогу', async () => {
    const conversationId = await conversation()
    const leads = makeService()

    const lead = await leads.capture({
      conversationId,
      name: '  Иван  ',
      phone: '8 (912) 345-67-89',
      comment: 'Перезвоните после 18',
      consent: true,
    })

    expect(lead.name).toBe('Иван')
    expect(lead.phone).toBe('+79123456789')
    expect(lead.phoneFormatted).toBe('+7 (912) 345-67-89')
    expect(lead.status).toBe('new')
    expect(lead.consentAt).toBeInstanceOf(Date)

    const stored = await testDb.lead.findUniqueOrThrow({ where: { id: lead.id } })
    expect(stored.conversationId).toBe(conversationId)
    expect(stored.comment).toBe('Перезвоните после 18')
  })

  it('без согласия лид не создаётся — это 152-ФЗ, а не поле формы', async () => {
    const conversationId = await conversation()
    const leads = makeService()

    await expect(
      leads.capture({ conversationId, name: 'Иван', phone: '+79123456789', consent: false }),
    ).rejects.toBeInstanceOf(LeadValidationError)

    expect(await testDb.lead.count()).toBe(0)
  })

  it.each([
    ['8 912 345-67-89', '+79123456789'],
    ['+7 (912) 345-67-89', '+79123456789'],
    ['79123456789', '+79123456789'],
    ['9123456789', '+79123456789'],
  ])('нормализует телефон %s', async (input, expected) => {
    const leads = makeService()
    const lead = await leads.capture({ sessionId: `s-${input}`, name: 'Иван', phone: input, consent: true })
    expect(lead.phone).toBe(expected)
  })

  it('мусор вместо телефона отклоняется с понятной ошибкой', async () => {
    const leads = makeService()

    const error = await leads
      .capture({ sessionId: 'sess-x', name: 'Иван', phone: 'позвоните маме', consent: true })
      .catch((err: unknown) => err)

    expect(error).toBeInstanceOf(LeadValidationError)
    expect((error as LeadValidationError).field).toBe('phone')
    expect((error as LeadValidationError).message).toContain('+7 (912) 345-67-89')
    expect(await testDb.lead.count()).toBe(0)
  })

  it('короткое имя отклоняется', async () => {
    const leads = makeService()
    await expect(
      leads.capture({ sessionId: 'sess-y', name: 'И', phone: '+79123456789', consent: true }),
    ).rejects.toBeInstanceOf(LeadValidationError)
  })

  it('повторная отправка в той же сессии обновляет лид, а не плодит дубли', async () => {
    const leads = makeService()

    const first = await leads.capture({ sessionId: 'sess-dup', name: 'Иван', phone: '89123456789', consent: true })
    const second = await leads.capture({
      sessionId: 'sess-dup',
      name: 'Иван Петров',
      phone: '+7 999 000-11-22',
      comment: 'Уточнил номер',
      consent: true,
    })

    expect(second.id).toBe(first.id)
    expect(await testDb.lead.count()).toBe(1)

    const stored = await testDb.lead.findUniqueOrThrow({ where: { id: first.id } })
    expect(stored.name).toBe('Иван Петров')
    expect(stored.phone).toBe('+79990001122')
    expect(stored.comment).toBe('Уточнил номер')
  })

  it('заводит диалог по sessionId, если его ещё не было', async () => {
    const leads = makeService()

    const lead = await leads.capture({
      sessionId: 'sess-new',
      name: 'Иван',
      phone: '+79123456789',
      consent: true,
      page: 'https://site.ru/lp',
      utm: { utm_source: 'vk' },
    })

    const conv = await testDb.conversation.findUniqueOrThrow({ where: { sessionId: 'sess-new' } })
    expect(lead.conversationId).toBe(conv.id)
    expect(conv.pageUrl).toBe('https://site.ru/lp')
  })

  it('сохраняет квартиры, показанные в диалоге к моменту оставления контакта', async () => {
    const conversationId = await conversation('sess-apt')
    await testDb.message.create({
      data: { conversationId, role: 'assistant', content: 'Вот варианты', apartments: [card()] as never },
    })
    await testDb.message.create({
      data: {
        conversationId,
        role: 'assistant',
        content: 'И ещё один',
        apartments: [card({ id: 'apt-2', projectName: 'ЖК Южный' }), card()] as never,
      },
    })

    const leads = makeService()
    const lead = await leads.capture({ conversationId, name: 'Иван', phone: '+79123456789', consent: true })

    expect(lead.apartments.map((item) => item.id)).toEqual(['apt-1', 'apt-2'])
    expect(lead.apartments[0]?.projectName).toBe('ЖК Северный')
  })
})

describe('LeadService — вебхук', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('без адреса в настройках никуда не ходит', async () => {
    const mock = webhookMock()
    const leads = makeService(mock)

    await leads.capture({ sessionId: 'sess-w0', name: 'Иван', phone: '+79123456789', consent: true })
    await leads.whenIdle()

    expect(mock.fetchImpl).not.toHaveBeenCalled()
    const stored = await testDb.lead.findFirstOrThrow()
    expect(stored.webhookStatus).toBe('skipped')
  })

  it('отправляет лид указанным payload и помечает отправку успешной', async () => {
    await settings.set('lead_webhook_url', 'https://hook.example/amo')
    const conversationId = await conversation('sess-w1')
    await testDb.conversation.update({
      where: { id: conversationId },
      data: { referrer: 'https://yandex.ru/', utm: { utm_source: 'yandex', utm_campaign: 'novostroyki' } },
    })
    await testDb.message.create({
      data: { conversationId, role: 'assistant', content: 'Вот варианты', apartments: [card()] as never },
    })

    const mock = webhookMock()
    const leads = makeService(mock)

    await leads.capture({ conversationId, name: 'Иван', phone: '89123456789', comment: 'Хочу двушку', consent: true })
    await leads.whenIdle()

    expect(mock.fetchImpl).toHaveBeenCalledTimes(1)
    const payload = mock.payloads()[0]
    expect(payload?.name).toBe('Иван')
    expect(payload?.phone).toBe('+79123456789')
    expect(payload?.lead_name).toContain('Иван')
    expect(payload?.comment).toContain('Хочу двушку')
    expect(payload?.comment).toContain('ЖК Северный')
    expect(payload?.meta).toEqual({
      page: 'https://site.ru/zhk',
      referrer: 'https://yandex.ru/',
      utm: { utm_source: 'yandex', utm_campaign: 'novostroyki' },
    })

    const stored = await testDb.lead.findFirstOrThrow()
    expect(stored.webhookStatus).toBe('sent')
    expect(stored.webhookError).toBeNull()
    expect(stored.webhookAt).toBeInstanceOf(Date)
  })

  it('упавший вебхук не мешает сохранению — ошибка остаётся на лиде', async () => {
    await settings.set('lead_webhook_url', 'https://hook.example/amo')
    const mock = webhookMock(() => new Response('', { status: 500, statusText: 'Internal Server Error' }))
    const leads = makeService(mock)

    const lead = await leads.capture({ sessionId: 'sess-w2', name: 'Иван', phone: '+79123456789', consent: true })
    await leads.whenIdle()

    expect(mock.fetchImpl).toHaveBeenCalledTimes(2)
    const stored = await testDb.lead.findUniqueOrThrow({ where: { id: lead.id } })
    expect(stored.name).toBe('Иван')
    expect(stored.webhookStatus).toBe('failed')
    expect(stored.webhookError).toContain('500')
  })
})

describe('save_lead в диалоге ходит в тот же сервис', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  /** Модель, которая на первом же ходу зовёт save_lead и на этом успокаивается. */
  class SaveLeadModel implements ModelClient {
    private calls = 0

    constructor(private readonly input: unknown) {}

    async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
      this.calls += 1
      const content: ModelBlock[] =
        this.calls === 1
          ? [{ type: 'tool_use', id: 'toolu_1', name: 'save_lead', input: this.input }]
          : [{ type: 'text', text: 'Записал, менеджер перезвонит.' }]

      yield {
        type: 'reply',
        reply: {
          model: request.model,
          stopReason: this.calls === 1 ? 'tool_use' : 'end_turn',
          content,
          usage: { inputTokens: 10, outputTokens: 5 },
        },
      }
    }
  }

  it('телефон нормализуется, вебхук уходит, второй вызов не плодит дубль', async () => {
    await settings.set('lead_webhook_url', 'https://hook.example/amo')
    const mock = webhookMock()
    const leads = makeService(mock)
    const conversationId = await conversation('sess-dialog')

    const engine = new DialogEngine({
      db: testDb,
      settings,
      client: new SaveLeadModel({ name: 'Иван', phone: '8 912 345-67-89' }),
      logger: { error: () => undefined, warn: () => undefined },
      saveLead: leads.captureFromDialog,
    })

    const reply = await engine.replyOnce({ conversationId, message: 'Мой телефон 8 912 345-67-89' })
    await leads.whenIdle()

    expect(reply.lead?.phone).toBe('+79123456789')
    const stored = await testDb.lead.findFirstOrThrow()
    expect(stored.phone).toBe('+79123456789')
    // Согласие проставляется движком: инструмент вызывается только после «да».
    expect(stored.consentAt).toBeInstanceOf(Date)
    expect(mock.fetchImpl).toHaveBeenCalledTimes(1)

    const second = new DialogEngine({
      db: testDb,
      settings,
      client: new SaveLeadModel({ name: 'Иван Петров', phone: '+7 999 000-11-22' }),
      logger: { error: () => undefined, warn: () => undefined },
      saveLead: leads.captureFromDialog,
    })
    await second.replyOnce({ conversationId, message: 'Точнее, 999 000-11-22' })
    await leads.whenIdle()

    expect(await testDb.lead.count()).toBe(1)
    const updated = await testDb.lead.findFirstOrThrow()
    expect(updated.id).toBe(stored.id)
    expect(updated.phone).toBe('+79990001122')
  })
})

describe('LeadService — список и статусы', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  async function seed(): Promise<void> {
    const leads = makeService()
    await leads.capture({ sessionId: 's1', name: 'Иван Петров', phone: '89123456789', consent: true })
    await leads.capture({ sessionId: 's2', name: 'Мария Сидорова', phone: '+79990001122', consent: true })
    await leads.capture({ sessionId: 's3', name: 'Пётр Иванов', phone: '9995554433', consent: true })
    await leads.whenIdle()
  }

  it('фильтрует по статусу и считает лиды по статусам', async () => {
    await seed()
    const leads = makeService()
    const all = await leads.list()
    const target = all.leads[0]
    if (!target) throw new Error('нет лидов')

    await leads.updateStatus(target.id, 'reached')

    const reached = await leads.list({ status: 'reached' })
    expect(reached.total).toBe(1)
    expect(reached.leads[0]?.id).toBe(target.id)

    const counts = await leads.countByStatus({ status: 'reached' })
    expect(counts.all).toBe(3)
    expect(counts.new).toBe(2)
    expect(counts.reached).toBe(1)
  })

  it('ищет по имени и по куску телефона в любом формате', async () => {
    await seed()
    const leads = makeService()

    expect((await leads.list({ query: 'мария' })).total).toBe(1)
    expect((await leads.list({ query: '8 912' })).total).toBe(1)
    expect((await leads.list({ query: '345-67' })).total).toBe(1)
    expect((await leads.list({ query: 'Иван' })).total).toBe(2)
    expect((await leads.list({ query: 'Никого' })).total).toBe(0)
  })

  it('фильтрует по датам включительно', async () => {
    await seed()
    const leads = makeService()
    const [first] = await testDb.lead.findMany({ take: 1 })
    if (!first) throw new Error('нет лидов')
    await testDb.lead.update({ where: { id: first.id }, data: { createdAt: new Date('2026-07-01T12:00:00Z') } })

    const inRange = await leads.list({ from: new Date('2026-07-01T00:00:00Z'), to: new Date('2026-07-01T23:59:59Z') })
    expect(inRange.total).toBe(1)
    expect(inRange.leads[0]?.id).toBe(first.id)

    const after = await leads.list({ from: new Date('2026-07-02T00:00:00Z') })
    expect(after.total).toBe(2)
  })

  it('несуществующий лид не меняет статус', async () => {
    const leads = makeService()
    expect(await leads.updateStatus('нет-такого', 'rejected')).toBeNull()
  })
})
