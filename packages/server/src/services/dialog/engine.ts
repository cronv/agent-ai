import type { Db } from '../../db/prisma.js'
import type { SettingsService } from '../settings/index.js'
import { listCatalogDirections, listCatalogLocations, type ApartmentCard } from './apartments.js'
import {
  AnthropicModelClient,
  MODEL_ERROR_MESSAGES,
  ModelError,
  missingApiKeyError,
  toModelError,
  type ModelBlock,
  type ModelClient,
  type ModelMessage,
  type ModelReply,
  type ModelUsage,
} from './client.js'
import { appendMessage, loadDialogContext } from './conversations.js'
import { executeTool } from './execute.js'
import { buildHistory, trimHistory, type StoredToolCall } from './history.js'
import type { LeadHandler, SavedLead } from './leads.js'
import { chooseModel } from './model.js'
import { buildSystemPrompt } from './prompt.js'
import { collectProjectCandidates, resolveProjectLinks, type ProjectLink } from './projects.js'
import { listSelected } from './selection.js'
import { dialogTools } from './tools.js'

/**
 * Движок диалога.
 *
 *   const engine = new DialogEngine({ db: app.prisma, settings: app.settings })
 *
 *   for await (const event of engine.reply({ conversationId, message })) {
 *     // event.type: 'text' | 'tool' | 'apartments' | 'suggestions' | 'lead' | 'error' | 'done'
 *   }
 *
 * Наружу движок отдаёт поток событий, а не готовую строку: HTTP-слой (тикет 06)
 * перекладывает эти события в SSE один в один, а тесты и любой не-потоковый
 * вызов используют `replyOnce`, который собирает то же самое в один результат.
 *
 * ── Что происходит за один вызов ───────────────────────────────────────────
 *
 *   1. сообщение посетителя сразу пишется в базу — даже если модель упадёт,
 *      вопрос не потеряется и будет виден в админке;
 *   2. собирается системный промпт: настройка администратора плюс состояние
 *      разговора (см. prompt.ts);
 *   3. выбирается модель — быстрая по умолчанию, старшая на сложный запрос;
 *   4. крутится цикл tool use, пока модель просит данные, но не больше
 *      `max_tool_calls` обращений за одно сообщение;
 *   5. ответ пишется в базу целиком: текст, вызовы инструментов, показанные
 *      квартиры структурно, модель и расход токенов.
 *
 * Ошибка модели не роняет процесс: посетитель получает понятную фразу,
 * подробности уходят в лог, ответ сохраняется в переписке как обычный.
 */

export interface DialogLogger {
  error(details: Record<string, unknown>, message: string): void
  warn(details: Record<string, unknown>, message: string): void
}

export interface DialogEngineOptions {
  db: Db
  settings: SettingsService
  /** Клиент модели. В тестах сюда подставляется мок — больше ничего не мокается. */
  client?: ModelClient
  /** Обработчик контакта. Тикет 07 подставляет сюда сервис лидов. */
  saveLead?: LeadHandler
  logger?: DialogLogger
  /** Потолок ответа модели на один запрос. */
  maxTokens?: number
  now?: () => Date
}

export interface DialogRequest {
  conversationId: string
  /** Сообщение посетителя. */
  message: string
}

export type DialogEvent =
  /** Кусок текста ответа — уходит посетителю по мере генерации. */
  | { type: 'text'; text: string }
  /** Ассистент пошёл в базу: виджет показывает «ищу квартиры». */
  | { type: 'tool'; name: string; input: unknown }
  /** Карточки квартир — виджет рисует их, не разбирая текст модели. */
  | { type: 'apartments'; apartments: ApartmentCard[] }
  /** Реплики для кнопок быстрого ответа под сообщением. */
  | { type: 'suggestions'; options: string[] }
  /** Ссылки на карточки ЖК — виджет рисует кнопку перехода на сайт. */
  | { type: 'projects'; projects: ProjectLink[] }
  /** Контакт сохранён. */
  | { type: 'lead'; lead: SavedLead }
  /** Не получилось. Текст уже пригоден для показа человеку. */
  | { type: 'error'; message: string }
  /** Последнее событие: ответ сохранён в базе. */
  | { type: 'done'; reply: DialogReply }

export interface DialogReply {
  messageId: string
  text: string
  apartments: ApartmentCard[]
  /** Реплики для кнопок; пустой список — кнопок не будет. */
  suggestions: string[]
  /** Ссылки на карточки ЖК; пустой список — кнопки перехода не будет. */
  projects: ProjectLink[]
  toolCalls: StoredToolCall[]
  lead: SavedLead | null
  model: string
  escalated: boolean
  usage: ModelUsage
  /** Ответ получен из-за ошибки модели, а не от неё самой. */
  failed: boolean
}

/** Ответ на случай, когда модель закончила ход, не сказав ни слова. */
export const EMPTY_REPLY_TEXT =
  'Похоже, я не смог собрать ответ. Переформулируйте вопрос, пожалуйста, — или оставьте телефон, и менеджер поможет.'

/** Что уходит модели, когда лимит обращений к базе исчерпан. */
export const TOOL_LIMIT_MESSAGE =
  'Лимит обращений к базе за одно сообщение исчерпан. Ответь тем, что уже нашёл, и предложи уточнить запрос.'

const DEFAULT_MAX_TOKENS = 4096

/** Сказал ли ассистент хоть слово: по этому решается, закончен ли ход. */
function answered(text: string): boolean {
  return text.trim() !== ''
}

export class DialogEngine {
  private readonly db: Db
  private readonly settings: SettingsService
  private readonly injectedClient: ModelClient | undefined
  private readonly saveLead: LeadHandler | undefined
  private readonly logger: DialogLogger
  private readonly maxTokens: number
  private readonly now: () => Date

  private cachedClient: { key: string; client: ModelClient } | null = null

  constructor(options: DialogEngineOptions) {
    this.db = options.db
    this.settings = options.settings
    this.injectedClient = options.client
    this.saveLead = options.saveLead
    this.logger = options.logger ?? consoleLogger
    this.maxTokens = options.maxTokens ?? DEFAULT_MAX_TOKENS
    this.now = options.now ?? (() => new Date())
  }

  /** Полный ответ одним значением. Удобно для тестов и не-потоковых вызовов. */
  async replyOnce(request: DialogRequest): Promise<DialogReply> {
    let reply: DialogReply | null = null
    for await (const event of this.reply(request)) {
      if (event.type === 'done') reply = event.reply
    }
    if (reply === null) throw new Error('Движок диалога завершился без результата')
    return reply
  }

  async *reply(request: DialogRequest): AsyncGenerator<DialogEvent, void, void> {
    const { conversationId } = request
    const text = request.message.trim()

    const config = await this.settings.getMany(
      'system_prompt',
      'contact_request_threshold',
      'model_default',
      'model_escalation',
      'max_tool_calls',
      'quick_replies_enabled',
    )

    if (text !== '') {
      await appendMessage(this.db, { conversationId, role: 'user', content: text })
    }

    const [context, projectCount, knowledgeDocs, locations, directions, selected] = await Promise.all([
      loadDialogContext(this.db, conversationId),
      this.db.project.count({ where: { isActive: true } }),
      this.db.knowledgeDoc.count({ where: { status: 'ready' } }),
      listCatalogLocations(this.db),
      listCatalogDirections(this.db),
      listSelected(this.db, conversationId),
    ])

    const system = buildSystemPrompt({
      basePrompt: config.system_prompt,
      today: this.now(),
      projectCount,
      locations,
      directions,
      hasKnowledge: knowledgeDocs > 0,
      visitorMessages: context.visitorMessages,
      apartmentsShown: context.apartmentsShown,
      messagesSinceApartments: context.messagesSinceApartments,
      contactThreshold: config.contact_request_threshold,
      leadCaptured: context.leadCaptured,
      quickReplies: config.quick_replies_enabled,
      apartmentsChosen: selected.length,
    })

    const choice = chooseModel(text, {
      default: config.model_default,
      escalation: config.model_escalation,
    })

    const messages = trimHistory(buildHistory(context.messages))
    const collected = {
      text: '',
      apartments: [] as ApartmentCard[],
      suggestions: [] as string[],
      projects: [] as ProjectLink[],
      toolCalls: [] as StoredToolCall[],
      lead: null as SavedLead | null,
      usage: { inputTokens: 0, outputTokens: 0 } as ModelUsage,
      model: choice.model,
    }

    const maxToolCalls = Math.max(Math.round(config.max_tool_calls), 0)
    let toolBudget = maxToolCalls
    let failed = false

    try {
      const client = await this.resolveClient()
      // Каждая итерация — один запрос к модели. Итераций не больше, чем
      // обращений к базе плюс два: один на финальный ответ и один на случай,
      // когда модель попробует вызвать инструмент после исчерпания лимита.
      const maxIterations = maxToolCalls + 2

      for (let iteration = 0; iteration < maxIterations; iteration += 1) {
        if (collected.text !== '' && !collected.text.endsWith('\n')) {
          collected.text += '\n\n'
          yield { type: 'text', text: '\n\n' }
        }

        let reply: ModelReply | null = null
        for await (const event of client.stream({
          model: choice.model,
          maxTokens: this.maxTokens,
          system,
          messages,
          tools: dialogTools(config.quick_replies_enabled),
        })) {
          if (event.type === 'text') {
            collected.text += event.text
            yield { type: 'text', text: event.text }
          } else {
            reply = event.reply
          }
        }

        if (reply === null) {
          throw new ModelError('Модель завершила поток без итогового сообщения', MODEL_ERROR_MESSAGES.unavailable)
        }

        collected.usage.inputTokens += reply.usage.inputTokens
        collected.usage.outputTokens += reply.usage.outputTokens
        if (reply.model) collected.model = reply.model

        const calls = reply.content.filter(
          (block): block is Extract<ModelBlock, { type: 'tool_use' }> => block.type === 'tool_use',
        )
        if (calls.length === 0) break

        messages.push({ role: 'assistant', content: reply.content })
        const results: ModelBlock[] = []

        // `suggest_replies` в базу не ходит и лимит обращений не тратит: это
        // не источник данных, а способ закончить ход.
        const onlySuggestions = calls.every((call) => call.name === 'suggest_replies')

        for (const call of calls) {
          if (call.name === 'suggest_replies') {
            const outcome = await executeTool(call.name, call.input, {
              db: this.db,
              conversationId,
              today: this.now(),
            })
            if (outcome.suggestions.length > 0) {
              collected.suggestions = outcome.suggestions
              yield { type: 'suggestions', options: outcome.suggestions }
            }
            // Кнопки вместо ответа — пустое сообщение для посетителя. Модель
            // так делает: приняв короткую реплику («Июнь подходит») за конец
            // разговора, она заканчивает ход одними кнопками. Тогда результат
            // инструмента прямо говорит, чего не хватает, и ход продолжается.
            const content = answered(collected.text)
              ? outcome.content
              : JSON.stringify({
                  accepted: outcome.suggestions.length,
                  error:
                    'Кнопки приняты, но ответа посетителю ты так и не написал — он видит пустое сообщение. ' +
                    'Напиши ответ словами прямо сейчас и вызови suggest_replies ещё раз вместе с ним.',
                })
            results.push({ type: 'tool_result', toolUseId: call.id, content })
            collected.toolCalls.push({ id: call.id, name: call.name, input: call.input, result: content })
            continue
          }

          if (toolBudget <= 0) {
            const content = JSON.stringify({ error: TOOL_LIMIT_MESSAGE })
            results.push({ type: 'tool_result', toolUseId: call.id, content, isError: true })
            collected.toolCalls.push({ id: call.id, name: call.name, input: call.input, result: content, isError: true })
            continue
          }
          toolBudget -= 1

          yield { type: 'tool', name: call.name, input: call.input }

          const toolContext: Parameters<typeof executeTool>[2] = { db: this.db, conversationId }
          if (this.saveLead) toolContext.saveLead = this.saveLead
          const outcome = await executeTool(call.name, call.input, toolContext)

          if (outcome.isError) {
            this.logger.warn(
              { conversationId, tool: call.name, result: outcome.content },
              'Инструмент вернул ошибку',
            )
          }
          if (outcome.apartments.length > 0) {
            collected.apartments.push(...outcome.apartments)
            yield { type: 'apartments', apartments: outcome.apartments }
          }
          if (outcome.lead) {
            collected.lead = outcome.lead
            yield { type: 'lead', lead: outcome.lead }
          }

          const block: ModelBlock = { type: 'tool_result', toolUseId: call.id, content: outcome.content }
          if (outcome.isError) block.isError = true
          results.push(block)
          collected.toolCalls.push({
            id: call.id,
            name: call.name,
            input: call.input,
            result: outcome.content,
            ...(outcome.isError ? { isError: true } : {}),
          })
        }

        // Ход закончен: модель сказала своё и попросила нарисовать кнопки —
        // просить у неё больше нечего, лишний запрос стоил бы секунды ожидания
        // на каждом ответе.
        if (onlySuggestions && answered(collected.text)) break

        messages.push({ role: 'user', content: results })
      }
    } catch (error) {
      const modelError = toModelError(error)
      failed = true
      this.logger.error(
        { conversationId, model: choice.model, status: modelError.status, err: modelError.message },
        'Ошибка обращения к модели',
      )
      // Уже сгенерированный текст выбрасываем: договаривать оборванную фразу
      // хуже, чем честно сказать, что не получилось.
      collected.text = modelError.userMessage
      // Кнопки под сообщением об ошибке предлагали бы продолжить разговор,
      // которого не было: реплики придуманы к ответу, которого посетитель
      // так и не увидел.
      collected.suggestions = []
      yield { type: 'error', message: modelError.userMessage }
    }

    // Кнопка перехода на карточку ЖК. Повод виден из того, что произошло за
    // ход, — модель об этом не спрашивают (почему именно так, см. projects.ts).
    // Под сообщением об ошибке кнопки нет: там нет и разговора про комплекс.
    if (!failed) {
      const candidates = collectProjectCandidates({
        toolCalls: collected.toolCalls,
        apartments: collected.apartments,
      })
      collected.projects = await resolveProjectLinks(this.db, candidates, context.recentProjectLinks)
      if (collected.projects.length > 0) yield { type: 'projects', projects: collected.projects }
    }

    const finalText = collected.text.trim() === '' ? EMPTY_REPLY_TEXT : collected.text.trim()
    const saved = await appendMessage(this.db, {
      conversationId,
      role: 'assistant',
      content: finalText,
      apartments: collected.apartments,
      projects: collected.projects,
      toolCalls: collected.toolCalls,
      model: collected.model,
      tokensIn: collected.usage.inputTokens,
      tokensOut: collected.usage.outputTokens,
    })

    yield {
      type: 'done',
      reply: {
        messageId: saved.id,
        text: finalText,
        apartments: collected.apartments,
        suggestions: collected.suggestions,
        projects: collected.projects,
        toolCalls: collected.toolCalls,
        lead: collected.lead,
        model: collected.model,
        escalated: choice.escalated,
        usage: collected.usage,
        failed,
      },
    }
  }

  /**
   * Клиент модели: подменённый в тестах или собранный по ключу из настроек.
   * Ключ читается на каждом запросе — его меняют в админке, и перезапускать
   * сервер ради этого не нужно.
   */
  private async resolveClient(): Promise<ModelClient> {
    if (this.injectedClient) return this.injectedClient

    const key = (await this.settings.getAnthropicApiKey()).trim()
    if (key === '') throw missingApiKeyError()

    if (this.cachedClient?.key !== key) {
      this.cachedClient = { key, client: new AnthropicModelClient({ apiKey: key }) }
    }
    return this.cachedClient.client
  }
}

const consoleLogger: DialogLogger = {
  error(details, message) {
    console.error(message, details)
  },
  warn(details, message) {
    console.warn(message, details)
  },
}
