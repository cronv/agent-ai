import type { Db } from '../../db/prisma.js'
import { prisma as defaultPrisma } from '../../db/prisma.js'
import { importFeed, type FeedImportResult, type ImportFeedOptions } from './import.js'
import { describeError } from './parse.js'

/**
 * Запуск синхронизации фидов: по расписанию и вручную.
 *
 *   const outcome = await syncFeed(feedId, { db: app.prisma })
 *   if (outcome.busy) …  // фид уже обновляется прямо сейчас
 *   else outcome.result  // FeedImportResult
 *
 * Слой над `importFeed`, который добавляет ровно две вещи:
 *
 * 1. **Один фид — один прогон.** Пока идёт импорт, повторный запуск того же
 *    фида получает отказ `busy`, а не вторую параллельную запись в те же
 *    строки. Замок живёт в памяти процесса: сервис однопроцессный, и
 *    расписание с кнопкой «Обновить» в админке — единственные его источники.
 *    Разные фиды друг другу не мешают.
 *
 * 2. **Прогон пачкой.** `syncAllFeeds` обходит активные фиды по одному:
 *    упавший фид не мешает остальным, потому что `importFeed` не выбрасывает
 *    исключений, а всё неожиданное ловится здесь же.
 *
 * Состояние фида (`lastRunAt`, `lastStatus`, `lastError`, `lastCount`) пишет
 * сам `importFeed` — здесь это не дублируется.
 */

/** Что именно запускать. Подменяется в тестах, по умолчанию — настоящий импорт. */
export type FeedImporter = (feedId: string, options: ImportFeedOptions) => Promise<FeedImportResult>

export interface FeedSyncOptions extends ImportFeedOptions {
  importer?: FeedImporter
}

/** Импорт прошёл (успешно или с ошибкой — смотрите `result.status`). */
export interface FeedSyncDone {
  busy: false
  result: FeedImportResult
}

/** Фид уже обновляется — этот запуск отменён. */
export interface FeedSyncBusy {
  busy: true
  feedId: string
  /** Когда начался прогон, который занял фид. */
  startedAt: Date
}

export type FeedSyncOutcome = FeedSyncDone | FeedSyncBusy

interface RunningSync {
  startedAt: Date
}

/** Фиды, которые обновляются прямо сейчас. */
const running = new Map<string, RunningSync>()

/** Обновляется ли фид прямо сейчас. */
export function isFeedSyncing(feedId: string): boolean {
  return running.has(feedId)
}

/** Идентификаторы фидов, которые обновляются прямо сейчас. */
export function syncingFeedIds(): string[] {
  return [...running.keys()]
}

/**
 * Обновляет один фид, если он не обновляется прямо сейчас.
 * Никогда не выбрасывает ошибку импорта — она приходит как `result.status`.
 */
export async function syncFeed(feedId: string, options: FeedSyncOptions = {}): Promise<FeedSyncOutcome> {
  const active = running.get(feedId)
  if (active) {
    return { busy: true, feedId, startedAt: active.startedAt }
  }

  const { importer = importFeed, ...importOptions } = options
  const startedAt = new Date()
  running.set(feedId, { startedAt })
  try {
    const result = await importer(feedId, importOptions)
    return { busy: false, result }
  } finally {
    running.delete(feedId)
  }
}

export interface SyncAllFeedsOptions extends FeedSyncOptions {
  /**
   * Пропускать фиды с собственным расписанием: их запускают отдельные задачи
   * планировщика, и в общем прогоне они были бы лишними.
   */
  skipCustomSchedule?: boolean
}

export interface FeedSyncSummary {
  startedAt: Date
  finishedAt: Date
  durationMs: number
  /** Фидов взято в работу. */
  total: number
  /** Обновились без ошибки. */
  ok: number
  /** Завершились ошибкой. */
  failed: number
  /** Пропущено, потому что фид уже обновлялся. */
  busy: number
  results: FeedImportResult[]
}

/**
 * Обновляет все активные фиды по очереди.
 *
 * Последовательно, а не разом: выгрузки застройщиков бывают на сотни тысяч
 * строк, и десять параллельных импортов положат базу вернее, чем сэкономят
 * время. Ошибка одного фида не прерывает обход.
 */
export async function syncAllFeeds(options: SyncAllFeedsOptions = {}): Promise<FeedSyncSummary> {
  const db = options.db ?? defaultPrisma
  const { skipCustomSchedule, ...feedOptions } = options
  const startedAt = new Date()

  const feeds = await db.feed.findMany({
    where: { isActive: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    select: { id: true, name: true, scheduleCron: true },
  })
  const selected = skipCustomSchedule ? feeds.filter((feed) => !hasCustomSchedule(feed.scheduleCron)) : feeds

  const summary: FeedSyncSummary = {
    startedAt,
    finishedAt: startedAt,
    durationMs: 0,
    total: selected.length,
    ok: 0,
    failed: 0,
    busy: 0,
    results: [],
  }

  for (const feed of selected) {
    try {
      const outcome = await syncFeed(feed.id, feedOptions)
      if (outcome.busy) {
        summary.busy += 1
        continue
      }
      summary.results.push(outcome.result)
      if (outcome.result.status === 'ok') summary.ok += 1
      else summary.failed += 1
    } catch (error) {
      // Сюда попадает только неожиданное — например, оборвавшееся соединение
      // с базой. Остальные фиды из-за этого обновляться не перестают.
      summary.failed += 1
      summary.results.push(crashResult(feed.id, feed.name, error))
    }
  }

  summary.finishedAt = new Date()
  summary.durationMs = summary.finishedAt.getTime() - startedAt.getTime()
  return summary
}

/** Есть ли у фида собственное расписание. Пустая строка означает «общее». */
export function hasCustomSchedule(scheduleCron: string | null | undefined): boolean {
  return typeof scheduleCron === 'string' && scheduleCron.trim() !== ''
}

function crashResult(feedId: string, feedName: string, error: unknown): FeedImportResult {
  const now = new Date()
  return {
    feedId,
    feedName,
    status: 'error',
    total: 0,
    created: 0,
    updated: 0,
    deactivated: 0,
    skipped: 0,
    projectsCreated: 0,
    activeCount: 0,
    error: describeError(error),
    warnings: [],
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
  }
}
