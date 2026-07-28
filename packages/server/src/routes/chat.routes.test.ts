import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildApp } from '../app.js'
import type {
  ModelBlock,
  ModelClient,
  ModelRequest,
  ModelStreamEvent,
} from '../services/dialog/index.js'
import { SettingsService } from '../services/settings/index.js'
import { createApartment, createFeed, createProject } from '../testing/catalog.js'
import { resetDatabase, testDb } from '../testing/db.js'
import { CHAT_SELECT_RULES, resetChatRateLimits } from './chat.routes.js'

/**
 * Публичное API чата целиком: от тела запроса до событий на проводе.
 *
 * Модель подменена — настоящих запросов к Anthropic здесь нет. База настоящая:
 * проверяется в том числе то, что попало в переписку и что вернётся при
 * восстановлении истории.
 */

// ── Мок модели ───────────────────────────────────────────────

interface ScriptStep {
  /** Куски текста, которые модель «печатает». */
  text?: string[]
  /** Инструменты, которые модель вызывает в этом ответе. */
  tools?: { name: string; input: unknown }[]
  /** Пауза перед каждым куском — нужна, чтобы успеть оборвать соединение. */
  delayMs?: number
  /** Модель падает вместо ответа. */
  error?: unknown
}

class ScriptedModel implements ModelClient {
  steps: ScriptStep[] = []
  index = 0
  /** Поток закрыли снаружи, не дав модели договорить. */
  interrupted = false

  reset(steps: ScriptStep[]): void {
    this.steps = steps
    this.index = 0
    this.interrupted = false
  }

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    const step = this.steps[this.index] ?? { text: ['Готово.'] }
    this.index += 1
    if (step.error) throw step.error
    const chunks = step.text ?? []

    let finished = false
    try {
      for (const chunk of chunks) {
        if (step.delayMs) await new Promise((resolve) => setTimeout(resolve, step.delayMs))
        yield { type: 'text', text: chunk }
      }

      const content: ModelBlock[] = []
      const text = chunks.join('')
      if (text !== '') content.push({ type: 'text', text })
      for (const [position, tool] of (step.tools ?? []).entries()) {
        content.push({ type: 'tool_use', id: `toolu_${this.index}_${position}`, name: tool.name, input: tool.input })
      }

      yield {
        type: 'reply',
        reply: {
          model: request.model,
          stopReason: (step.tools ?? []).length > 0 ? 'tool_use' : 'end_turn',
          content,
          usage: { inputTokens: 100, outputTokens: 20 },
        },
      }
      finished = true
    } finally {
      // Сюда попадаем и при обычном завершении, и когда поток закрыли снаружи.
      if (!finished) this.interrupted = true
    }
  }
}

// ── Разбор SSE ───────────────────────────────────────────────

interface SseEvent {
  name: string
  data: Record<string, unknown>
}

function parseSse(payload: string): SseEvent[] {
  const events: SseEvent[] = []
  for (const block of payload.split('\n\n')) {
    let name = 'message'
    let data = ''
    for (const line of block.split('\n')) {
      if (line.startsWith('event: ')) name = line.slice('event: '.length)
      else if (line.startsWith('data: ')) data += line.slice('data: '.length)
    }
    if (data === '') continue
    events.push({ name, data: JSON.parse(data) as Record<string, unknown> })
  }
  return events
}

function textOf(events: SseEvent[]): string {
  return events
    .filter((event) => event.name === 'text')
    .map((event) => String(event.data['text']))
    .join('')
}

// ── Обвязка ──────────────────────────────────────────────────

const model = new ScriptedModel()
const SESSION = 'session-aaaaaaaaaaaa'

describe('публичное API чата', () => {
  let app: FastifyInstance
  let settings: SettingsService

  beforeAll(async () => {
    settings = new SettingsService({ db: testDb, processEnv: {} })
    app = await buildApp({ prisma: testDb, settings, serveStatic: false, modelClient: model })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await resetDatabase()
    resetChatRateLimits()
    model.reset([])
  })

  async function send(
    payload: Record<string, unknown>,
    headers: Record<string, string> = {},
  ): Promise<{ statusCode: number; events: SseEvent[]; raw: string; headers: Record<string, unknown> }> {
    const response = await app.inject({ method: 'POST', url: '/api/chat', payload, headers })
    return {
      statusCode: response.statusCode,
      events: parseSse(response.payload),
      raw: response.payload,
      headers: response.headers as Record<string, unknown>,
    }
  }

  async function seedCatalog(): Promise<void> {
    const feed = await createFeed()
    const project = await createProject({ name: 'Северный', district: 'Приморский', metro: 'Беговая' })
    await createApartment({ feedId: feed.id, projectId: project.id, rooms: 2, price: 17_000_000, area: 54 })
  }

  // ── Полный цикл ──────────────────────────────────────────

  it('отвечает потоком SSE: текст кусками, квартиры структурно, done последним', async () => {
    await seedCatalog()
    model.reset([
      { tools: [{ name: 'search_apartments', input: { rooms: [2], price_max: 18_000_000 } }] },
      { text: ['Нашёл ', 'один вариант.'] },
    ])

    const { statusCode, events, headers } = await send({ sessionId: SESSION, message: 'Двушка до 18 млн' })

    expect(statusCode).toBe(200)
    expect(String(headers['content-type'])).toContain('text/event-stream')

    expect(events[0]?.name).toBe('ready')
    expect(events[0]?.data['conversationId']).toEqual(expect.any(String))

    const names = events.map((event) => event.name)
    expect(names).toContain('tool')
    expect(names).toContain('apartments')
    expect(names.at(-1)).toBe('done')

    expect(textOf(events)).toContain('Нашёл один вариант.')

    const tool = events.find((event) => event.name === 'tool')
    expect(tool?.data['name']).toBe('search_apartments')

    const apartments = events.find((event) => event.name === 'apartments')
    const cards = apartments?.data['apartments'] as { price: number; projectName: string }[]
    expect(cards).toHaveLength(1)
    expect(cards[0]?.price).toBe(17_000_000)
    expect(cards[0]?.projectName).toBe('Северный')

    const done = events.at(-1)?.data['reply'] as { failed: boolean; messageId: string }
    expect(done.failed).toBe(false)
    expect(done.messageId).toEqual(expect.any(String))
  })

  it('ошибка модели приходит событием error, а следом всё равно done', async () => {
    model.reset([{ error: new Error('Anthropic прилёг') }])

    const { statusCode, events } = await send({ sessionId: SESSION, message: 'Привет' })

    // Поток открылся успешно: ошибка модели — это событие внутри диалога,
    // а не пятисотка, на которой виджету нечего показать.
    expect(statusCode).toBe(200)

    const error = events.find((event) => event.name === 'error')
    expect(String(error?.data['message'])).not.toBe('')
    expect(String(error?.data['message'])).not.toContain('Anthropic прилёг')

    expect(events.at(-1)?.name).toBe('done')
    expect((events.at(-1)?.data['reply'] as { failed: boolean }).failed).toBe(true)

    // Вопрос посетителя не потерялся, ответ сохранён как обычное сообщение.
    expect(await testDb.message.count()).toBe(2)
  })

  // ── Диалог ───────────────────────────────────────────────

  it('заводит диалог при первом сообщении и пишет следующие в тот же', async () => {
    model.reset([{ text: ['Раз.'] }, { text: ['Два.'] }])

    await send({ sessionId: SESSION, message: 'Первое' })
    await send({ sessionId: SESSION, message: 'Второе' })

    const conversations = await testDb.conversation.findMany()
    expect(conversations).toHaveLength(1)
    expect(conversations[0]?.messageCount).toBe(4)

    const messages = await testDb.message.findMany({ orderBy: { createdAt: 'asc' } })
    expect(messages.map((row) => row.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
  })

  it('UTM и страницу входа сохраняет один раз и не перетирает', async () => {
    model.reset([{ text: ['Раз.'] }, { text: ['Два.'] }])

    await send({
      sessionId: SESSION,
      message: 'Первое',
      pageUrl: 'https://example.com/novostroyki?utm_source=yandex',
      referrer: 'https://yandex.ru/',
      utm: { utm_source: 'yandex', utm_campaign: 'brand', ЛишнееПоле: 'выкинуть' },
    })

    await send({
      sessionId: SESSION,
      message: 'Второе',
      pageUrl: 'https://example.com/contacts',
      referrer: 'https://example.com/novostroyki',
      utm: { utm_source: 'vk' },
    })

    const conversation = await testDb.conversation.findUniqueOrThrow({ where: { sessionId: SESSION } })
    expect(conversation.pageUrl).toBe('https://example.com/novostroyki?utm_source=yandex')
    expect(conversation.referrer).toBe('https://yandex.ru/')
    expect(conversation.utm).toEqual({ utm_source: 'yandex', utm_campaign: 'brand' })
  })

  it('запоминает user-agent посетителя', async () => {
    model.reset([{ text: ['Ок.'] }])
    await send({ sessionId: SESSION, message: 'Привет' }, { 'user-agent': 'TestBrowser/1.0' })
    const conversation = await testDb.conversation.findUniqueOrThrow({ where: { sessionId: SESSION } })
    expect(conversation.userAgent).toBe('TestBrowser/1.0')
  })

  // ── Проверка ввода ───────────────────────────────────────

  it('отвергает пустое сообщение, короткий sessionId и слишком длинный текст', async () => {
    const empty = await send({ sessionId: SESSION, message: '   ' })
    expect(empty.statusCode).toBe(400)

    const shortId = await send({ sessionId: 'abc', message: 'Привет' })
    expect(shortId.statusCode).toBe(400)

    const weirdId = await send({ sessionId: '../../etc/passwd0000', message: 'Привет' })
    expect(weirdId.statusCode).toBe(400)

    const long = await send({ sessionId: SESSION, message: 'а'.repeat(2001) })
    expect(long.statusCode).toBe(400)

    // Ни один из отказов не должен был дойти до модели и до базы.
    expect(await testDb.conversation.count()).toBe(0)
  })

  it('не отвечает, когда виджет выключен в админке', async () => {
    await settings.set('widget_enabled', false)
    model.reset([{ text: ['Не должно случиться.'] }])

    const response = await send({ sessionId: SESSION, message: 'Привет' })

    expect(response.statusCode).toBe(403)
    expect(await testDb.conversation.count()).toBe(0)
  })

  // ── История ──────────────────────────────────────────────

  it('восстанавливает переписку по sessionId', async () => {
    await seedCatalog()
    model.reset([
      { tools: [{ name: 'search_apartments', input: { rooms: [2] } }] },
      { text: ['Вот вариант.'] },
    ])
    await send({ sessionId: SESSION, message: 'Двушка' })

    const response = await app.inject({ method: 'GET', url: `/api/chat/${SESSION}` })
    expect(response.statusCode).toBe(200)

    const body = response.json<{
      conversationId: string
      messages: { role: string; content: string; apartments: unknown[] }[]
    }>()

    expect(body.conversationId).toEqual(expect.any(String))
    expect(body.messages).toHaveLength(2)
    expect(body.messages[0]?.role).toBe('user')
    expect(body.messages[0]?.content).toBe('Двушка')
    expect(body.messages[1]?.role).toBe('assistant')
    expect(body.messages[1]?.content).toContain('Вот вариант.')
    // Карточки приходят структурно — виджет не разбирает текст модели.
    expect(body.messages[1]?.apartments).toHaveLength(1)
  })

  it('на незнакомую сессию отдаёт пустую историю, а не ошибку', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/chat/unknown-session-00000' })
    expect(response.statusCode).toBe(200)
    expect(response.json()).toMatchObject({ conversationId: null, messages: [] })
  })

  it('отвергает негодный sessionId в истории', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/chat/..%2Fetc' })
    expect(response.statusCode).toBe(400)
  })

  // ── Выбор квартиры ───────────────────────────────────────

  async function seedApartment(): Promise<string> {
    const feed = await createFeed()
    const project = await createProject({ name: 'ЖК «Космос»', district: 'Химки' })
    const apartment = await createApartment({
      feedId: feed.id,
      projectId: project.id,
      rooms: 2,
      area: 54.3,
      price: 16_400_000,
    })
    return apartment.id
  }

  it('записывает выбор квартиры и оставляет реплику в переписке', async () => {
    const apartmentId = await seedApartment()

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/select',
      payload: { sessionId: SESSION, apartmentId, pageUrl: 'https://site.ru/zhk' },
    })

    expect(response.statusCode).toBe(200)
    const body = response.json<{ selected: boolean; sentToManager: boolean; text: string }>()
    expect(body.selected).toBe(true)
    // Контакта ещё нет — менеджеру пока нечего слать, форму откроет виджет.
    expect(body.sentToManager).toBe(false)
    expect(body.text).toContain('Выбрал: двухкомнатная, 54,3 м², ЖК «Космос»')

    const history = await app.inject({ method: 'GET', url: `/api/chat/${SESSION}` })
    const stored = history.json<{
      messages: { role: string; content: string }[]
      selectedApartments: { id: string }[]
    }>()
    expect(stored.messages[0]?.role).toBe('user')
    expect(stored.messages[0]?.content).toContain('Выбрал:')
    // Вернувшись на страницу, виджет видит, что уже выбрано.
    expect(stored.selectedApartments.map((card) => card.id)).toEqual([apartmentId])
  })

  it('повторный выбор той же квартиры не дублирует ни реплику, ни отметку', async () => {
    const apartmentId = await seedApartment()
    const payload = { sessionId: SESSION, apartmentId }

    await app.inject({ method: 'POST', url: '/api/chat/select', payload })
    const again = await app.inject({ method: 'POST', url: '/api/chat/select', payload })

    expect(again.statusCode).toBe(200)
    expect(again.json<{ selected: boolean; duplicate: boolean }>()).toMatchObject({
      selected: false,
      duplicate: true,
    })

    const history = await app.inject({ method: 'GET', url: `/api/chat/${SESSION}` })
    expect(history.json<{ messages: unknown[] }>().messages).toHaveLength(1)
  })

  it('с уже оставленным контактом выбор уходит менеджеру сразу', async () => {
    const apartmentId = await seedApartment()
    await app.inject({
      method: 'POST',
      url: '/api/lead',
      payload: { sessionId: SESSION, name: 'Иван', phone: '+79123456789', consent: true },
    })

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/select',
      payload: { sessionId: SESSION, apartmentId },
    })

    expect(response.json<{ sentToManager: boolean }>().sentToManager).toBe(true)

    const conversation = await testDb.conversation.findUniqueOrThrow({ where: { sessionId: SESSION } })
    const lead = await testDb.lead.findFirstOrThrow({ where: { conversationId: conversation.id } })
    const selected = lead.selectedApartments as { id: string }[] | null
    expect(selected?.map((card) => card.id)).toEqual([apartmentId])
  })

  it('выключенный виджет не принимает и выбор квартиры', async () => {
    const apartmentId = await seedApartment()
    await settings.set('widget_enabled', false)

    const response = await app.inject({
      method: 'POST',
      url: '/api/chat/select',
      payload: { sessionId: SESSION, apartmentId },
    })

    await settings.set('widget_enabled', true)
    expect(response.statusCode).toBe(403)
    expect(response.json<{ error: string }>().error).toBe('widget_disabled')
    // Ни диалога, ни сообщения выключенный виджет не заводит.
    expect(await testDb.conversation.count()).toBe(0)
  })

  it('режет накрутку выбором: маршрут пишет в базу и дёргает вебхук', async () => {
    const apartmentId = await seedApartment()
    const payload = { sessionId: SESSION, apartmentId }

    // Первый выбор проходит, дальше идут дубли — счётчик они тратят так же.
    let last = { statusCode: 200 }
    for (let attempt = 0; attempt < CHAT_SELECT_RULES[0]!.limit + 1; attempt += 1) {
      last = await app.inject({ method: 'POST', url: '/api/chat/select', payload })
    }

    expect(last.statusCode).toBe(429)
  })

  it('отвергает несуществующую квартиру и негодный запрос', async () => {
    const missing = await app.inject({
      method: 'POST',
      url: '/api/chat/select',
      payload: { sessionId: SESSION, apartmentId: 'nosuchlot' },
    })
    expect(missing.statusCode).toBe(404)

    const bad = await app.inject({
      method: 'POST',
      url: '/api/chat/select',
      payload: { sessionId: 'short', apartmentId: 'x' },
    })
    expect(bad.statusCode).toBe(400)
  })

  // ── Конфиг виджета ───────────────────────────────────────

  it('отдаёт публичные настройки виджета без авторизации', async () => {
    await settings.setMany({
      widget_title: 'Отдел продаж',
      widget_accent_color: '#FF6600',
      widget_greeting: 'Здравствуйте!',
      widget_example_questions: ['Что есть до 10 млн?'],
    })

    const response = await app.inject({ method: 'GET', url: '/api/widget/config' })

    expect(response.statusCode).toBe(200)
    expect(response.json()).toEqual({
      enabled: true,
      title: 'Отдел продаж',
      accentColor: '#FF6600',
      greeting: 'Здравствуйте!',
      exampleQuestions: ['Что есть до 10 млн?'],
      privacyPolicyUrl: null,
      quickReplies: true,
      humanRhythm: true,
      typingSpeed: 32,
      thinkDelayMs: 3500,
    })
  })

  it('отдаёт виджету настройки человеческого ритма', async () => {
    await settings.setMany({
      human_rhythm_enabled: false,
      human_typing_speed: 45,
      human_think_delay_ms: 2000,
    })

    const config = await app.inject({ method: 'GET', url: '/api/widget/config' }).then((r) => r.json())

    expect(config).toMatchObject({ humanRhythm: false, typingSpeed: 45, thinkDelayMs: 2000 })
  })

  it('в конфиг не попадают секреты', async () => {
    await settings.set('anthropic_api_key', 'sk-ant-secret')
    const body = JSON.stringify(await app.inject({ method: 'GET', url: '/api/widget/config' }).then((r) => r.json()))
    expect(body).not.toContain('sk-ant')
    expect(body).not.toContain('system_prompt')
  })

  // ── Ограничение частоты ──────────────────────────────────

  it('режет накрутку по сессии и говорит, когда можно повторить', async () => {
    model.reset([])

    const allowed: number[] = []
    let denied: Awaited<ReturnType<typeof send>> | null = null

    for (let attempt = 0; attempt < 12; attempt += 1) {
      const response = await send({ sessionId: SESSION, message: `Вопрос ${attempt}` })
      if (response.statusCode === 200) allowed.push(attempt)
      else {
        denied = response
        break
      }
    }

    // Лимит по сессии — 8 сообщений в минуту.
    expect(allowed).toHaveLength(8)
    expect(denied?.statusCode).toBe(429)
    expect(denied?.headers['retry-after']).toBeDefined()

    const body = JSON.parse(denied?.raw ?? '{}') as { error: string; retryAfter: number }
    expect(body.error).toBe('rate_limited')
    expect(body.retryAfter).toBeGreaterThan(0)

    // Девятое сообщение до модели не дошло: в базе только восемь пар.
    expect(await testDb.message.count()).toBe(16)
  })

  it('режет накрутку по адресу, даже если сессии разные', async () => {
    model.reset([])

    let denied = 0
    for (let attempt = 0; attempt < 40; attempt += 1) {
      const response = await send({ sessionId: `session-ip-test-${String(attempt).padStart(4, '0')}`, message: 'Привет' })
      if (response.statusCode === 429) {
        denied += 1
        break
      }
    }

    // Лимит по IP — 30 сообщений в минуту; сессионный при разных сессиях не мешает.
    expect(denied).toBe(1)
    expect(await testDb.conversation.count()).toBe(30)
  })

  // ── CORS ─────────────────────────────────────────────────

  it('пускает виджет с чужого домена, но без куки админки', async () => {
    const preflight = await app.inject({
      method: 'OPTIONS',
      url: '/api/chat',
      headers: { origin: 'https://novostroyki.example', 'access-control-request-method': 'POST' },
    })

    expect(preflight.statusCode).toBe(204)
    expect(preflight.headers['access-control-allow-origin']).toBe('*')
    expect(preflight.headers['access-control-allow-methods']).toContain('POST')
    // Ключевое: без credentials браузер не пошлёт сюда куку сессии админки
    // и не даст чужому скрипту прочитать ответ от её имени.
    expect(preflight.headers['access-control-allow-credentials']).toBeUndefined()

    const config = await app.inject({
      method: 'GET',
      url: '/api/widget/config',
      headers: { origin: 'https://novostroyki.example' },
    })
    expect(config.headers['access-control-allow-origin']).toBe('*')
    expect(config.headers['access-control-allow-credentials']).toBeUndefined()
  })

  it('на админку заголовки CORS не ставит', async () => {
    const response = await app.inject({
      method: 'GET',
      url: '/api/admin/settings',
      headers: { origin: 'https://evil.example' },
    })

    expect(response.statusCode).toBe(401)
    expect(response.headers['access-control-allow-origin']).toBeUndefined()
  })

  // ── Обрыв соединения ─────────────────────────────────────

  it('обрыв соединения клиентом прерывает запрос к модели', async () => {
    // Модель «печатает» долго — успеваем закрыть вкладку на середине.
    model.reset([{ text: Array.from({ length: 40 }, (_, i) => `кусок ${i} `), delayMs: 25 }])

    const address = await app.listen({ port: 0, host: '127.0.0.1' })
    const controller = new AbortController()

    const response = await fetch(`${address}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ sessionId: SESSION, message: 'Расскажи подробно' }),
      signal: controller.signal,
    })
    expect(response.status).toBe(200)

    const reader = response.body?.getReader()
    await reader?.read()
    controller.abort()

    await waitFor(() => model.interrupted)
    expect(model.interrupted).toBe(true)

    // Освободили и место в очереди: следующее сообщение той же сессии пройдёт.
    await waitFor(async () => (await testDb.message.count()) >= 1)
    const messages = await testDb.message.findMany()
    expect(messages.every((row) => row.role === 'user')).toBe(true)
  })
})

async function waitFor(condition: () => boolean | Promise<boolean>, timeoutMs = 5_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await condition()) return
    await new Promise((resolve) => setTimeout(resolve, 20))
  }
  throw new Error('Не дождались ожидаемого состояния')
}
