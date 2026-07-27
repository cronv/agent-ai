import type { Db } from '../../db/prisma.js'
import { KNOWLEDGE_SEARCH_LIMIT, searchKnowledge } from '../knowledge/index.js'
import {
  normalizeFinishing,
  normalizeText,
  parseArea,
  parseDate,
  parseInteger,
  parsePrice,
  parseRooms,
} from '../feeds/normalize.js'
import {
  listProjects,
  searchApartments,
  type ApartmentCard,
  type ApartmentSearchParams,
  type ProjectFilterParams,
} from './apartments.js'
import { saveLeadToDatabase, validateLead, type LeadHandler, type SavedLead } from './leads.js'
import { isToolName, type ToolName } from './tools.js'

/**
 * Исполнение инструментов.
 *
 *   const outcome = await executeTool('search_apartments', input, ctx)
 *
 * Всё, что приходит от модели, считается недоверенным вводом: «до 18 млн»
 * вместо числа, «2 кв. 2027» вместо даты, строка вместо массива. Разбирают это
 * те же функции, что и выгрузки застройщиков (`services/feeds/normalize.ts`) —
 * второй набор правил для тех же величин неизбежно разошёлся бы с первым.
 *
 * Ошибка инструмента не роняет диалог: она возвращается модели как результат
 * с `isError`, и модель либо исправляет параметры, либо честно говорит,
 * что не получилось.
 */

export interface ToolContext {
  db: Db
  conversationId: string
  /** Куда уходит контакт. Тикет 07 подставляет сюда полноценный сервис лидов. */
  saveLead?: LeadHandler
}

export interface ToolOutcome {
  name: string
  /** Результат для модели — JSON-строка. */
  content: string
  isError: boolean
  /** Карточки для виджета: сохраняются в сообщение структурно. */
  apartments: ApartmentCard[]
  lead: SavedLead | null
}

export async function executeTool(name: string, rawInput: unknown, context: ToolContext): Promise<ToolOutcome> {
  if (!isToolName(name)) {
    return failure(name, `Инструмента «${name}» не существует. Доступны search_apartments, list_projects, search_knowledge, save_lead.`)
  }

  const input = asRecord(rawInput)

  try {
    return await run(name, input, context)
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    return failure(name, `Не удалось выполнить запрос к базе: ${detail}`)
  }
}

async function run(name: ToolName, input: Record<string, unknown>, context: ToolContext): Promise<ToolOutcome> {
  switch (name) {
    case 'search_apartments':
      return runSearchApartments(input, context)
    case 'list_projects':
      return runListProjects(input, context)
    case 'search_knowledge':
      return runSearchKnowledge(input, context)
    case 'save_lead':
      return runSaveLead(input, context)
  }
}

async function runSearchApartments(input: Record<string, unknown>, context: ToolContext): Promise<ToolOutcome> {
  const params: ApartmentSearchParams = {}

  const rooms = toArray(input['rooms'])
    .map((value) => parseRooms(value))
    .filter((value): value is number => value !== null)
  if (rooms.length > 0) params.rooms = [...new Set(rooms)]

  assignDefined(params, 'priceMin', parsePrice(input['price_min']))
  assignDefined(params, 'priceMax', parsePrice(input['price_max']))
  assignDefined(params, 'areaMin', parseArea(input['area_min']))
  assignDefined(params, 'areaMax', parseArea(input['area_max']))
  assignDefined(params, 'floorMin', parseInteger(input['floor_min']))
  assignDefined(params, 'floorMax', parseInteger(input['floor_max']))
  assignDefined(params, 'district', normalizeText(input['district'], 120))
  assignDefined(params, 'metro', normalizeText(input['metro'], 120))
  assignDefined(params, 'finishing', normalizeFinishing(input['finishing']))
  assignDefined(params, 'deadlineBefore', parseDate(input['deadline_before']))
  assignDefined(params, 'limit', parseInteger(input['limit']))

  const projectIds = toArray(input['project_ids'])
    .map((value) => normalizeText(value, 60))
    .filter((value): value is string => value !== null)
  if (projectIds.length > 0) params.projectIds = projectIds

  const { total, apartments } = await searchApartments(context.db, params)

  return {
    name: 'search_apartments',
    content: stringify({ total, shown: apartments.length, apartments }),
    isError: false,
    apartments,
    lead: null,
  }
}

async function runListProjects(input: Record<string, unknown>, context: ToolContext): Promise<ToolOutcome> {
  const params: ProjectFilterParams = {}
  assignDefined(params, 'district', normalizeText(input['district'], 120))
  assignDefined(params, 'metro', normalizeText(input['metro'], 120))
  assignDefined(params, 'priceMin', parsePrice(input['price_min']))
  assignDefined(params, 'priceMax', parsePrice(input['price_max']))
  assignDefined(params, 'deadlineBefore', parseDate(input['deadline_before']))

  const projects = await listProjects(context.db, params)

  return {
    name: 'list_projects',
    content: stringify({ found: projects.length, projects }),
    isError: false,
    apartments: [],
    lead: null,
  }
}

async function runSearchKnowledge(input: Record<string, unknown>, context: ToolContext): Promise<ToolOutcome> {
  const query = normalizeText(input['query'], 500)
  if (query === null) {
    return failure('search_knowledge', 'Параметр query пустой. Сформулируй запрос словами и повтори вызов.')
  }

  const projectId = normalizeText(input['project_id'], 60)
  const hits = await searchKnowledge(context.db, {
    query,
    projectId,
    limit: KNOWLEDGE_SEARCH_LIMIT,
  })

  const fragments = hits.map((hit) => ({
    document: hit.documentTitle,
    project: hit.projectName,
    content: hit.content,
  }))

  return {
    name: 'search_knowledge',
    content: stringify({ found: fragments.length, fragments }),
    isError: false,
    apartments: [],
    lead: null,
  }
}

async function runSaveLead(input: Record<string, unknown>, context: ToolContext): Promise<ToolOutcome> {
  const validation = validateLead({ name: input['name'], phone: input['phone'], comment: input['comment'] })
  if (!validation.ok) return failure('save_lead', validation.error)

  const handler = context.saveLead ?? saveLeadToDatabase
  const lead = await handler(validation.value, { db: context.db, conversationId: context.conversationId })

  return {
    name: 'save_lead',
    content: stringify({ saved: true, lead_id: lead.id, name: lead.name, phone: lead.phone }),
    isError: false,
    apartments: [],
    lead,
  }
}

function failure(name: string, error: string): ToolOutcome {
  return { name, content: stringify({ error }), isError: true, apartments: [], lead: null }
}

function stringify(value: unknown): string {
  return JSON.stringify(value)
}

function asRecord(value: unknown): Record<string, unknown> {
  if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
    return value as Record<string, unknown>
  }
  // Модель иногда присылает аргументы строкой с JSON внутри.
  if (typeof value === 'string') {
    try {
      const parsed: unknown = JSON.parse(value)
      if (typeof parsed === 'object' && parsed !== null && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>
      }
    } catch {
      /* не JSON — считаем, что параметров нет */
    }
  }
  return {}
}

/** Одиночное значение приводится к списку: `rooms: 2` — это `[2]`. */
function toArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (value === undefined || value === null || value === '') return []
  return [value]
}

function assignDefined<T extends object, K extends keyof T>(target: T, key: K, value: T[K] | null): void {
  if (value !== null) target[key] = value
}
