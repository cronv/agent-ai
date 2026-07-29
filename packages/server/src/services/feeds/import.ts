import type { Feed, Prisma } from '@prisma/client'

import type { Db } from '../../db/prisma.js'
import { prisma as defaultPrisma } from '../../db/prisma.js'
import { uniqueSlug } from '../../lib/slug.js'
import { DEFAULT_MAX_BYTES, DEFAULT_TIMEOUT_MS, downloadFeed, type FeedDownloader } from './download.js'
import { describeError, parseFeedXml, type ParsedApartment, type ParsedProject } from './parse.js'

/**
 * Импорт квартир из выгрузки застройщика.
 *
 *   const result = await importFeed(feed.id)
 *   // { status: 'ok', created: 128, updated: 40, deactivated: 3, skipped: 2, … }
 *
 * Один вызов = один прогон одного фида: скачать, разобрать, записать.
 * Наружу не выбрасывается ничего: недоступный URL, таймаут, битый XML и
 * несуществующий фид возвращаются как результат со `status: 'error'` и
 * человеческим текстом в `error`. Синхронизация по расписанию не должна
 * ронять процесс из-за того, что у застройщика упал сервер.
 *
 * Записи не удаляются никогда. Лот, пропавший из выгрузки, получает
 * `isActive = false`: на него могли ссылаться сохранённые переписки.
 * Вернулся в выгрузку — снова станет активным.
 *
 * Повторный запуск на неизменившемся фиде ничего не создаёт: квартиры
 * сопоставляются по (`feedId`, `externalId`), ЖК — по названию.
 */

export interface FeedImportResult {
  feedId: string
  feedName: string
  status: 'ok' | 'error'
  /** Предложений найдено в файле. */
  total: number
  /** Квартир заведено впервые. */
  created: number
  /** Квартир обновлено (в том числе снова включено). */
  updated: number
  /** Квартир помечено `isActive = false`, потому что их нет в выгрузке. */
  deactivated: number
  /** Предложений пропущено: без цены, без идентификатора, дубли. */
  skipped: number
  /** ЖК создано автоматически. */
  projectsCreated: number
  /** Активных квартир в фиде после прогона — это значение уходит в `lastCount`. */
  activeCount: number
  /** Текст ошибки для админки; при успехе — `null`. */
  error: string | null
  /** Первые причины пропусков — чтобы было видно, что именно не так с фидом. */
  warnings: string[]
  startedAt: Date
  finishedAt: Date
  durationMs: number
}

export interface ImportFeedOptions {
  db?: Db
  /** Чем скачивать файл. По умолчанию — настоящий HTTP-запрос. */
  download?: FeedDownloader
  timeoutMs?: number
  maxBytes?: number
  /** Готовый XML вместо скачивания — для отладки и предпросмотра фида. */
  xml?: string
}

/** Сколько причин пропуска показывать в результате. */
const MAX_WARNINGS = 10
/** По столько квартир пишем за одну транзакцию. */
const WRITE_CHUNK = 100

export async function importFeed(feedId: string, options: ImportFeedOptions = {}): Promise<FeedImportResult> {
  const db = options.db ?? defaultPrisma
  const startedAt = new Date()

  const feed = await db.feed.findUnique({ where: { id: feedId } })
  if (!feed) {
    return failure({ feedId, feedName: '', startedAt, error: `Фид ${feedId} не найден` })
  }

  await db.feed.update({ where: { id: feed.id }, data: { lastStatus: 'running' } }).catch(() => undefined)

  try {
    const xml = options.xml ?? (await fetchXml(feed, options))
    const parsed = parseFeedXml(xml, { format: feed.format, fieldMapping: feed.fieldMapping })
    const written = await writeApartments(db, feed, parsed.apartments, startedAt)

    const warnings = [...parsed.skipped.map(describeSkip), ...written.warnings].slice(0, MAX_WARNINGS)
    const result: FeedImportResult = {
      feedId: feed.id,
      feedName: feed.name,
      status: 'ok',
      total: parsed.total,
      created: written.created,
      updated: written.updated,
      deactivated: written.deactivated,
      skipped: parsed.skipped.length + written.skipped,
      projectsCreated: written.projectsCreated,
      activeCount: written.activeCount,
      error: null,
      warnings,
      startedAt,
      finishedAt: new Date(),
      durationMs: 0,
    }
    result.durationMs = result.finishedAt.getTime() - startedAt.getTime()

    await saveFeedStatus(db, feed.id, result)
    return result
  } catch (error) {
    const result = failure({
      feedId: feed.id,
      feedName: feed.name,
      startedAt,
      error: describeError(error),
    })
    await saveFeedStatus(db, feed.id, result)
    return result
  }
}

async function fetchXml(feed: Feed, options: ImportFeedOptions): Promise<string> {
  const download = options.download ?? downloadFeed
  return download(feed.url, {
    timeoutMs: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
    maxBytes: options.maxBytes ?? DEFAULT_MAX_BYTES,
  })
}

// ── Запись в базу ───────────────────────────────────────────

interface WriteSummary {
  created: number
  updated: number
  deactivated: number
  skipped: number
  projectsCreated: number
  activeCount: number
  warnings: string[]
}

async function writeApartments(
  db: Db,
  feed: Feed,
  apartments: ParsedApartment[],
  syncedAt: Date,
): Promise<WriteSummary> {
  const summary: WriteSummary = {
    created: 0,
    updated: 0,
    deactivated: 0,
    skipped: 0,
    projectsCreated: 0,
    activeCount: 0,
    warnings: [],
  }

  const existing = await db.apartment.findMany({ where: { feedId: feed.id }, select: { externalId: true } })
  const known = new Set(existing.map((row) => row.externalId))

  const projects = new ProjectResolver(db)
  const seen = new Set<string>()
  const operations: Prisma.PrismaPromise<unknown>[] = []

  for (const apartment of apartments) {
    if (seen.has(apartment.externalId)) {
      summary.skipped += 1
      if (summary.warnings.length < MAX_WARNINGS) {
        summary.warnings.push(`Лот ${apartment.externalId}: повторяется в фиде, взят первый`)
      }
      continue
    }
    seen.add(apartment.externalId)

    const projectId = apartment.project ? await projects.resolve(apartment.project) : null
    const data = toApartmentData(apartment, projectId, syncedAt)

    if (known.has(apartment.externalId)) {
      summary.updated += 1
    } else {
      summary.created += 1
    }

    operations.push(
      db.apartment.upsert({
        where: { feedId_externalId: { feedId: feed.id, externalId: apartment.externalId } },
        create: { feedId: feed.id, externalId: apartment.externalId, ...data },
        update: data,
      }),
    )
  }

  summary.projectsCreated = projects.createdCount

  for (let offset = 0; offset < operations.length; offset += WRITE_CHUNK) {
    await db.$transaction(operations.slice(offset, offset + WRITE_CHUNK))
  }

  // Всё, чего не коснулись в этом прогоне, из фида пропало.
  const deactivated = await db.apartment.updateMany({
    where: { feedId: feed.id, isActive: true, syncedAt: { lt: syncedAt } },
    data: { isActive: false },
  })
  summary.deactivated = deactivated.count
  summary.activeCount = seen.size

  return summary
}

function toApartmentData(
  apartment: ParsedApartment,
  projectId: string | null,
  syncedAt: Date,
): Omit<Prisma.ApartmentUncheckedCreateInput, 'feedId' | 'externalId'> {
  return {
    projectId,
    rooms: apartment.rooms,
    planType: apartment.planType,
    area: apartment.area,
    livingArea: apartment.livingArea,
    kitchenArea: apartment.kitchenArea,
    floor: apartment.floor,
    floorsTotal: apartment.floorsTotal,
    price: apartment.price,
    pricePerM2: apartment.pricePerM2,
    building: apartment.building,
    section: apartment.section,
    finishing: apartment.finishing,
    balcony: apartment.balcony,
    windowView: apartment.windowView,
    bathroom: apartment.bathroom,
    euroPlan: apartment.euroPlan,
    deadline: apartment.deadline,
    isReady: apartment.isReady,
    planImageUrl: apartment.planImageUrl,
    photos: apartment.photos,
    url: apartment.url,
    isActive: true,
    raw: apartment.raw as Prisma.InputJsonValue,
    syncedAt,
  }
}

/** Поля ЖК, которые приходят из выгрузки и которые администратор правит руками. */
const PROJECT_FIELDS = [
  'developer',
  'district',
  'metro',
  'metroDistanceMin',
  'address',
  'url',
  'imageUrl',
  'description',
] as const satisfies readonly (keyof ParsedProject)[]

/**
 * Подбирает ЖК по названию, создаёт недостающие.
 *
 * Сравнение без учёта регистра — «ЖК Северный парк» и «ЖК СЕВЕРНЫЙ ПАРК»
 * в одной выгрузке означают один комплекс. Найденное за прогон запоминается,
 * чтобы не ходить в базу на каждую из тысячи квартир.
 *
 * Заполненные поля уже заведённого ЖК не трогаются: их правят руками в
 * админке, и импорт не должен затирать правки. Но пустые — дозаполняются:
 * когда в разборе появляется поле, которого раньше не было (так случилось с
 * районом у ДомКлика), ЖК получает его на ближайшем прогоне, без ручной
 * правки и без пересоздания каталога. Стёртое администратором в пустоту
 * значение вернётся — цена того, чтобы новые поля доезжали сами.
 */
class ProjectResolver {
  private readonly cache = new Map<string, string>()
  public createdCount = 0

  constructor(private readonly db: Db) {}

  async resolve(project: ParsedProject): Promise<string> {
    const key = project.name.toLowerCase()
    const cached = this.cache.get(key)
    if (cached) return cached

    const existing = await this.db.project.findFirst({
      where: { name: { equals: project.name, mode: 'insensitive' } },
      select: { id: true, developer: true, district: true, metro: true, metroDistanceMin: true, address: true, url: true, imageUrl: true, description: true },
    })
    if (existing) {
      const patch = blanksToFill(existing, project)
      if (Object.keys(patch).length > 0) {
        await this.db.project.update({ where: { id: existing.id }, data: patch })
      }
      this.cache.set(key, existing.id)
      return existing.id
    }

    const slug = await uniqueSlug(project.name, async (candidate) => {
      const taken = await this.db.project.findUnique({ where: { slug: candidate }, select: { id: true } })
      return taken !== null
    })

    const created = await this.db.project.create({
      data: {
        name: project.name,
        slug,
        developer: project.developer,
        district: project.district,
        metro: project.metro,
        metroDistanceMin: project.metroDistanceMin,
        address: project.address,
        url: project.url,
        imageUrl: project.imageUrl,
        description: project.description,
      },
      select: { id: true },
    })
    this.createdCount += 1
    this.cache.set(key, created.id)
    return created.id
  }
}

/** Поля, которые в базе пусты, а в выгрузке есть. Остальное не трогаем. */
function blanksToFill(
  stored: Pick<Prisma.ProjectUncheckedCreateInput, (typeof PROJECT_FIELDS)[number]>,
  parsed: ParsedProject,
): Prisma.ProjectUncheckedUpdateInput {
  const patch: Prisma.ProjectUncheckedUpdateInput = {}
  for (const field of PROJECT_FIELDS) {
    const current = stored[field]
    const incoming = parsed[field]
    if (incoming === null) continue
    if (current !== null && current !== undefined && current !== '') continue
    patch[field] = incoming
  }
  return patch
}

// ── Состояние фида ──────────────────────────────────────────

async function saveFeedStatus(db: Db, feedId: string, result: FeedImportResult): Promise<void> {
  try {
    await db.feed.update({
      where: { id: feedId },
      data: {
        lastRunAt: result.finishedAt,
        lastStatus: result.status,
        lastError: result.error,
        lastCount: result.status === 'ok' ? result.activeCount : null,
      },
    })
  } catch {
    // Не смогли записать состояние — сам импорт от этого не становится неудачным.
  }
}

function failure(input: { feedId: string; feedName: string; startedAt: Date; error: string }): FeedImportResult {
  const finishedAt = new Date()
  return {
    feedId: input.feedId,
    feedName: input.feedName,
    status: 'error',
    total: 0,
    created: 0,
    updated: 0,
    deactivated: 0,
    skipped: 0,
    projectsCreated: 0,
    activeCount: 0,
    error: input.error,
    warnings: [],
    startedAt: input.startedAt,
    finishedAt,
    durationMs: finishedAt.getTime() - input.startedAt.getTime(),
  }
}

function describeSkip(skip: { index: number; externalId: string | null; reason: string }): string {
  const who = skip.externalId ? `Лот ${skip.externalId}` : `Предложение №${skip.index}`
  return `${who}: ${skip.reason}`
}
