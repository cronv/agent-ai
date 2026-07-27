import { beforeEach, describe, expect, it } from 'vitest'

import { createApartment, createFeed, createProject } from '../../testing/catalog.js'
import { resetDatabase, testDb } from '../../testing/db.js'
import { SettingsService } from '../settings/index.js'
import { MODEL_ERROR_MESSAGES, ModelError, type ModelBlock, type ModelClient, type ModelRequest, type ModelStreamEvent } from './client.js'
import { ensureConversation } from './conversations.js'
import { DialogEngine, TOOL_LIMIT_MESSAGE, type DialogEvent, type DialogLogger } from './engine.js'

/**
 * Движок диалога с мок-клиентом модели.
 *
 * Настоящих запросов к Anthropic здесь нет и быть не должно: подменяется
 * ровно один шов — `ModelClient`. База при этом настоящая, потому что
 * проверяется в том числе то, что именно попало в переписку.
 */

interface ScriptStep {
  /** Куски текста, которые модель «печатает». */
  text?: string[]
  /** Инструменты, которые модель вызывает в этом ответе. */
  tools?: { id?: string; name: string; input: unknown }[]
  /** Ошибка вместо ответа. */
  error?: unknown
}

class ScriptedModel implements ModelClient {
  /** Копии запросов: движок дописывает свой массив сообщений после вызова. */
  readonly requests: ModelRequest[] = []
  private index = 0

  constructor(private readonly steps: ScriptStep[]) {}

  async *stream(request: ModelRequest): AsyncIterable<ModelStreamEvent> {
    this.requests.push(JSON.parse(JSON.stringify(request)) as ModelRequest)
    const step = this.steps[this.index] ?? { text: ['Готово.'] }
    this.index += 1

    if (step.error) throw step.error

    const chunks = step.text ?? []
    for (const chunk of chunks) {
      yield { type: 'text', text: chunk }
    }

    const content: ModelBlock[] = []
    const text = chunks.join('')
    if (text !== '') content.push({ type: 'text', text })
    for (const [position, tool] of (step.tools ?? []).entries()) {
      content.push({ type: 'tool_use', id: tool.id ?? `toolu_${this.index}_${position}`, name: tool.name, input: tool.input })
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
  }
}

const silentLogger: DialogLogger = { error() {}, warn() {} }

interface Harness {
  engine: DialogEngine
  model: ScriptedModel
  settings: SettingsService
  conversationId: string
}

async function harness(steps: ScriptStep[]): Promise<Harness> {
  const settings = new SettingsService({ db: testDb })
  const model = new ScriptedModel(steps)
  const engine = new DialogEngine({
    db: testDb,
    settings,
    client: model,
    logger: silentLogger,
    now: () => new Date(Date.UTC(2026, 6, 27)),
  })
  const conversation = await ensureConversation(testDb, { sessionId: 'session-test' })
  return { engine, model, settings, conversationId: conversation.id }
}

async function seedCatalog(): Promise<{ projectId: string }> {
  const feed = await createFeed()
  const project = await createProject({ name: 'Северный', district: 'Приморский', metro: 'Беговая' })
  await createApartment({ feedId: feed.id, projectId: project.id, rooms: 2, price: 17_000_000, area: 54 })
  await createApartment({ feedId: feed.id, projectId: project.id, rooms: 2, price: 25_000_000, area: 72 })
  return { projectId: project.id }
}

async function collect(engine: DialogEngine, conversationId: string, message: string): Promise<DialogEvent[]> {
  const events: DialogEvent[] = []
  for await (const event of engine.reply({ conversationId, message })) {
    events.push(event)
  }
  return events
}

function lastMessages(request: ModelRequest): ModelBlock[] {
  return request.messages.at(-1)?.content ?? []
}

describe('DialogEngine', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('вызывает инструмент с разобранными параметрами и отдаёт модели результат', async () => {
    await seedCatalog()
    const { engine, model, conversationId } = await harness([
      // Модель пишет числа так, как их сказал человек, — «18 млн», а не 18000000.
      { tools: [{ name: 'search_apartments', input: { rooms: [2], price_max: '18 млн' } }] },
      { text: ['Нашёл ', 'один вариант.'] },
    ])

    const reply = await engine.replyOnce({ conversationId, message: 'Двушка до 18 млн' })

    expect(model.requests).toHaveLength(2)
    expect(reply.text).toBe('Нашёл один вариант.')
    expect(reply.apartments).toHaveLength(1)
    expect(reply.apartments[0]?.price).toBe(17_000_000)

    const toolResult = lastMessages(model.requests[1] as ModelRequest)[0]
    expect(toolResult?.type).toBe('tool_result')
    expect(toolResult?.type === 'tool_result' && toolResult.content).toContain('"total":1')
    expect(toolResult?.type === 'tool_result' && toolResult.content).toContain('17000000')
  })

  it('сохраняет в сообщение квартиры структурно, а не текстом', async () => {
    await seedCatalog()
    const { engine, conversationId } = await harness([
      { tools: [{ name: 'search_apartments', input: { rooms: [2] } }] },
      { text: ['Вот варианты.'] },
    ])

    await engine.replyOnce({ conversationId, message: 'Двушки' })

    const saved = await testDb.message.findFirst({ where: { conversationId, role: 'assistant' } })
    const apartments = saved?.apartments as { price: number; projectName: string }[] | null

    expect(saved?.content).toBe('Вот варианты.')
    expect(apartments).toHaveLength(2)
    expect(apartments?.[0]).toMatchObject({ projectName: 'Северный', price: 17_000_000 })
    expect(saved?.model).toBe('claude-haiku-4-5-20251001')
    expect(saved?.tokensIn).toBe(200)
    expect(saved?.tokensOut).toBe(40)

    const toolCalls = saved?.toolCalls as { name: string; result: string }[] | null
    expect(toolCalls?.[0]?.name).toBe('search_apartments')
    expect(toolCalls?.[0]?.result).toContain('"total":2')
  })

  it('отдаёт поток событий: текст, обращение к базе и карточки', async () => {
    await seedCatalog()
    const { engine, conversationId } = await harness([
      { text: ['Секунду, посмотрю.'], tools: [{ name: 'search_apartments', input: { rooms: [2] } }] },
      { text: ['Готово.'] },
    ])

    const events = await collect(engine, conversationId, 'Двушки')

    expect(events.map((event) => event.type)).toEqual(['text', 'tool', 'apartments', 'text', 'text', 'done'])
    const tool = events.find((event) => event.type === 'tool')
    expect(tool?.type === 'tool' && tool.name).toBe('search_apartments')
    const cards = events.find((event) => event.type === 'apartments')
    expect(cards?.type === 'apartments' && cards.apartments).toHaveLength(2)
  })

  it('обновляет счётчики диалога', async () => {
    const { engine, conversationId } = await harness([{ text: ['Здравствуйте!'] }])

    await engine.replyOnce({ conversationId, message: 'Привет' })

    const conversation = await testDb.conversation.findUniqueOrThrow({ where: { id: conversationId } })
    expect(conversation.messageCount).toBe(2)
    expect(conversation.tokensIn).toBe(100)
    expect(conversation.tokensOut).toBe(20)
  })

  it('поднимает модель на сложный запрос и пишет её в сообщение', async () => {
    const { engine, model, conversationId } = await harness([{ text: ['Сравниваю.'] }])

    const reply = await engine.replyOnce({ conversationId, message: 'Сравните два ЖК по срокам сдачи' })

    expect(model.requests[0]?.model).toBe('claude-sonnet-5')
    expect(reply.escalated).toBe(true)
    expect(reply.model).toBe('claude-sonnet-5')
  })

  it('передаёт модели системный промпт из настроек и состояние разговора', async () => {
    const { engine, model, settings, conversationId } = await harness([{ text: ['Ага.'] }])
    await settings.set('system_prompt', 'Ты консультант из теста.')

    await engine.replyOnce({ conversationId, message: 'Привет' })

    const system = model.requests[0]?.system ?? ''
    expect(system).toContain('Ты консультант из теста.')
    expect(system).toContain('27 июля 2026 года')
    expect(system).toContain('Подборку ты ещё не показывал')
    expect(model.requests[0]?.tools.map((tool) => tool.name)).toEqual([
      'search_apartments',
      'list_projects',
      'search_knowledge',
      'save_lead',
    ])
  })

  it('обрезает длинную историю, оставляя запрос посетителя первым сообщением', async () => {
    const { engine, model, conversationId } = await harness([{ text: ['Понял.'] }])

    for (let index = 0; index < 12; index += 1) {
      await testDb.message.create({
        data: { conversationId, role: 'user', content: `Вопрос ${index}` },
      })
      await testDb.message.create({
        data: {
          conversationId,
          role: 'assistant',
          content: `Ответ ${index}`,
          toolCalls: [
            {
              id: `toolu_${index}`,
              name: 'search_apartments',
              input: { rooms: [2] },
              result: JSON.stringify({ padding: 'я'.repeat(3000) }),
            },
          ],
        },
      })
    }

    await engine.replyOnce({ conversationId, message: 'А подешевле?' })

    const messages = model.requests[0]?.messages ?? []
    expect(messages[0]?.role).toBe('user')
    expect(messages[0]?.content.every((block) => block.type === 'text')).toBe(true)
    expect(JSON.stringify(messages)).toContain('А подешевле?')
    expect(JSON.stringify(messages)).not.toContain('Вопрос 0')

    // Ни один результат инструмента не остался без своего вызова.
    const seen = new Set<string>()
    for (const message of messages) {
      for (const block of message.content) {
        if (block.type === 'tool_use') seen.add(block.id)
        if (block.type === 'tool_result') expect(seen.has(block.toolUseId)).toBe(true)
      }
    }
  })

  it('ограничивает число обращений к базе за одно сообщение', async () => {
    await seedCatalog()
    const { engine, settings, conversationId } = await harness([
      { tools: [{ name: 'search_apartments', input: { rooms: [1] } }] },
      { tools: [{ name: 'search_apartments', input: { rooms: [2] } }] },
      { tools: [{ name: 'search_apartments', input: { rooms: [3] } }] },
      { text: ['Больше искать не буду.'] },
    ])
    await settings.set('max_tool_calls', 2)

    const reply = await engine.replyOnce({ conversationId, message: 'Ищи' })

    expect(reply.toolCalls).toHaveLength(3)
    expect(reply.toolCalls[2]?.isError).toBe(true)
    expect(reply.toolCalls[2]?.result).toContain(TOOL_LIMIT_MESSAGE)
    expect(reply.text).toBe('Больше искать не буду.')
  })

  it('сохраняет контакт и сообщает об этом наружу', async () => {
    const { engine, conversationId } = await harness([
      { tools: [{ name: 'save_lead', input: { name: 'Анна', phone: '+7 (900) 123-45-67', comment: 'Двушка до 18 млн' } }] },
      { text: ['Записал, менеджер перезвонит.'] },
    ])

    const events = await collect(engine, conversationId, 'Анна, +79001234567')
    const done = events.at(-1)

    expect(done?.type === 'done' && done.reply.lead?.name).toBe('Анна')
    expect(events.some((event) => event.type === 'lead')).toBe(true)

    const lead = await testDb.lead.findFirstOrThrow({ where: { conversationId } })
    expect(lead.phone).toBe('+7 (900) 123-45-67')
    expect(lead.comment).toBe('Двушка до 18 млн')
    expect(lead.consentAt).not.toBeNull()
  })

  it('не сохраняет контакт с непохожим телефоном и объясняет это модели', async () => {
    const { engine, conversationId } = await harness([
      { tools: [{ name: 'save_lead', input: { name: 'Анна', phone: 'позвоните мне' } }] },
      { text: ['Уточните номер, пожалуйста.'] },
    ])

    const reply = await engine.replyOnce({ conversationId, message: 'Позвоните' })

    expect(await testDb.lead.count()).toBe(0)
    expect(reply.lead).toBeNull()
    expect(reply.toolCalls[0]?.isError).toBe(true)
    expect(reply.toolCalls[0]?.result).toContain('Телефон не похож на номер')
  })

  it('ищет по базе знаний и возвращает модели фрагменты с источником', async () => {
    const project = await createProject({ name: 'Северный' })
    const doc = await testDb.knowledgeDoc.create({
      data: { projectId: project.id, filename: 'ипотека.txt', mimeType: 'text/plain', sizeBytes: 100, status: 'ready' },
    })
    await testDb.knowledgeChunk.create({
      data: { docId: doc.id, projectId: project.id, position: 0, content: 'Ипотека с господдержкой от 6% годовых.' },
    })

    const { engine, model, conversationId } = await harness([
      { tools: [{ name: 'search_knowledge', input: { query: 'ипотека' } }] },
      { text: ['В презентации ЖК «Северный» — ставка от 6%.'] },
    ])

    await engine.replyOnce({ conversationId, message: 'Какая ипотека?' })

    const result = lastMessages(model.requests[1] as ModelRequest)[0]
    expect(result?.type === 'tool_result' && result.content).toContain('ипотека.txt')
    expect(result?.type === 'tool_result' && result.content).toContain('господдержкой')
  })

  it('ошибка модели не роняет диалог: посетитель видит понятный текст, ответ сохраняется', async () => {
    const { engine, conversationId } = await harness([{ error: new Error('socket hang up') }])

    const events = await collect(engine, conversationId, 'Двушка до 18 млн')
    const failure = events.find((event) => event.type === 'error')
    const done = events.at(-1)

    expect(failure?.type === 'error' && failure.message).toBe(MODEL_ERROR_MESSAGES.unavailable)
    expect(done?.type === 'done' && done.reply.failed).toBe(true)
    expect(done?.type === 'done' && done.reply.text).toBe(MODEL_ERROR_MESSAGES.unavailable)

    const saved = await testDb.message.findMany({ where: { conversationId }, orderBy: { createdAt: 'asc' } })
    expect(saved.map((message) => message.role)).toEqual(['user', 'assistant'])
    expect(saved[1]?.content).toBe(MODEL_ERROR_MESSAGES.unavailable)
  })

  it('превышение лимита у Anthropic превращается в просьбу повторить позже', async () => {
    const { engine, conversationId } = await harness([
      { error: new ModelError('429 rate_limit_error', MODEL_ERROR_MESSAGES.rateLimit, { status: 429 }) },
    ])

    const reply = await engine.replyOnce({ conversationId, message: 'Двушка' })

    expect(reply.failed).toBe(true)
    expect(reply.text).toBe(MODEL_ERROR_MESSAGES.rateLimit)
  })

  it('без ключа Anthropic честно сообщает, что чат недоступен', async () => {
    const settings = new SettingsService({ db: testDb, processEnv: {} })
    const engine = new DialogEngine({ db: testDb, settings, logger: silentLogger })
    const conversation = await ensureConversation(testDb, { sessionId: 'no-key' })

    const reply = await engine.replyOnce({ conversationId: conversation.id, message: 'Привет' })

    expect(reply.failed).toBe(true)
    expect(reply.text).toBe(MODEL_ERROR_MESSAGES.noKey)
  })
})
