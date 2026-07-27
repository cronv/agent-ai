import { beforeEach, describe, expect, it } from 'vitest'

import { resetDatabase, testDb } from '../../testing/db.js'
import type { FeedImportResult } from './import.js'
import { isFeedSyncing, syncAllFeeds, syncFeed, type FeedImporter } from './sync.js'

/**
 * Запуск синхронизации: замок на фид и обход всех активных фидов.
 *
 * Сам импорт здесь не нужен — вместо него подставляется `importer`, поэтому
 * видно ровно то, что добавляет этот слой: кого запустили, кого пропустили и
 * что случилось, когда один фид развалился.
 */

function okResult(feedId: string, feedName = ''): FeedImportResult {
  const now = new Date()
  return {
    feedId,
    feedName,
    status: 'ok',
    total: 1,
    created: 1,
    updated: 0,
    deactivated: 0,
    skipped: 0,
    projectsCreated: 0,
    activeCount: 1,
    error: null,
    warnings: [],
    startedAt: now,
    finishedAt: now,
    durationMs: 0,
  }
}

function errorResult(feedId: string, message: string): FeedImportResult {
  return { ...okResult(feedId), status: 'error', total: 0, created: 0, activeCount: 0, error: message }
}

/** Импортёр, который запоминает, кого просили обновить. */
function recorder(): { importer: FeedImporter; calls: string[] } {
  const calls: string[] = []
  const importer: FeedImporter = async (feedId) => {
    calls.push(feedId)
    return okResult(feedId)
  }
  return { importer, calls }
}

/** Импортёр, который «зависает», пока его не отпустят. */
function suspended(): { importer: FeedImporter; release: () => void } {
  let release = (): void => undefined
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const importer: FeedImporter = async (feedId) => {
    await gate
    return okResult(feedId)
  }
  return { importer, release }
}

/**
 * Порядок обхода задан явным `createdAt`: без него два фида, заведённые в одну
 * миллисекунду, встали бы в базе в произвольном порядке и тест мигал бы.
 */
let created = 0

async function createFeed(
  overrides: { name?: string; isActive?: boolean; scheduleCron?: string | null } = {},
): Promise<string> {
  created += 1
  const feed = await testDb.feed.create({
    data: {
      name: overrides.name ?? 'Фид',
      url: 'https://example.test/feed.xml',
      isActive: overrides.isActive ?? true,
      scheduleCron: overrides.scheduleCron ?? null,
      createdAt: new Date(Date.UTC(2026, 0, 1) + created * 60_000),
    },
    select: { id: true },
  })
  return feed.id
}

beforeEach(async () => {
  await resetDatabase()
  created = 0
})

describe('syncFeed', () => {
  it('возвращает результат импорта', async () => {
    const feedId = await createFeed()
    const outcome = await syncFeed(feedId, { db: testDb, importer: async (id) => okResult(id, 'Фид') })

    expect(outcome.busy).toBe(false)
    if (outcome.busy) return
    expect(outcome.result.status).toBe('ok')
    expect(outcome.result.feedId).toBe(feedId)
  })

  it('второй запуск того же фида получает отказ «уже выполняется»', async () => {
    const feedId = await createFeed()
    const first = suspended()

    const running = syncFeed(feedId, { db: testDb, importer: first.importer })
    expect(isFeedSyncing(feedId)).toBe(true)

    const second = await syncFeed(feedId, { db: testDb, importer: async (id) => okResult(id) })
    expect(second.busy).toBe(true)
    if (second.busy) {
      expect(second.feedId).toBe(feedId)
      expect(second.startedAt).toBeInstanceOf(Date)
    }

    first.release()
    await running
    expect(isFeedSyncing(feedId)).toBe(false)
  })

  it('разные фиды друг другу не мешают', async () => {
    const busyFeed = await createFeed({ name: 'Занятый' })
    const otherFeed = await createFeed({ name: 'Свободный' })
    const first = suspended()

    const running = syncFeed(busyFeed, { db: testDb, importer: first.importer })
    const outcome = await syncFeed(otherFeed, { db: testDb, importer: async (id) => okResult(id) })
    expect(outcome.busy).toBe(false)

    first.release()
    await running
  })

  it('снимает замок, даже если импорт неожиданно упал', async () => {
    const feedId = await createFeed()
    await expect(
      syncFeed(feedId, {
        db: testDb,
        importer: async () => {
          throw new Error('база отвалилась')
        },
      }),
    ).rejects.toThrow('база отвалилась')

    expect(isFeedSyncing(feedId)).toBe(false)
  })
})

describe('syncAllFeeds', () => {
  it('обходит только активные фиды', async () => {
    const first = await createFeed({ name: 'Первый' })
    const second = await createFeed({ name: 'Второй' })
    await createFeed({ name: 'Выключенный', isActive: false })

    const { importer, calls } = recorder()
    const summary = await syncAllFeeds({ db: testDb, importer })

    expect(calls).toEqual([first, second])
    expect(summary.total).toBe(2)
    expect(summary.ok).toBe(2)
    expect(summary.failed).toBe(0)
  })

  it('ошибка одного фида не останавливает остальные', async () => {
    const first = await createFeed({ name: 'Первый' })
    const broken = await createFeed({ name: 'Битый' })
    const third = await createFeed({ name: 'Третий' })

    const calls: string[] = []
    const summary = await syncAllFeeds({
      db: testDb,
      importer: async (feedId) => {
        calls.push(feedId)
        if (feedId === broken) return errorResult(feedId, 'Сервер ответил 500')
        return okResult(feedId)
      },
    })

    expect(calls).toEqual([first, broken, third])
    expect(summary.ok).toBe(2)
    expect(summary.failed).toBe(1)
    expect(summary.results.find((result) => result.feedId === broken)?.error).toBe('Сервер ответил 500')
  })

  it('неожиданное исключение одного фида тоже не прерывает обход', async () => {
    const first = await createFeed({ name: 'Первый' })
    const broken = await createFeed({ name: 'Взрывной' })
    const third = await createFeed({ name: 'Третий' })

    const calls: string[] = []
    const summary = await syncAllFeeds({
      db: testDb,
      importer: async (feedId) => {
        calls.push(feedId)
        if (feedId === broken) throw new Error('соединение с базой оборвалось')
        return okResult(feedId)
      },
    })

    expect(calls).toEqual([first, broken, third])
    expect(summary.ok).toBe(2)
    expect(summary.failed).toBe(1)
    expect(summary.results.find((result) => result.feedId === broken)?.error).toContain(
      'соединение с базой оборвалось',
    )
  })

  it('пропускает занятый фид, а не ждёт его', async () => {
    const busyFeed = await createFeed({ name: 'Занятый' })
    const otherFeed = await createFeed({ name: 'Свободный' })
    const first = suspended()

    const running = syncFeed(busyFeed, { db: testDb, importer: first.importer })
    const { importer, calls } = recorder()
    const summary = await syncAllFeeds({ db: testDb, importer })

    expect(calls).toEqual([otherFeed])
    expect(summary.busy).toBe(1)
    expect(summary.ok).toBe(1)

    first.release()
    await running
  })

  it('с skipCustomSchedule не трогает фиды с собственным расписанием', async () => {
    const shared = await createFeed({ name: 'Общее расписание' })
    await createFeed({ name: 'Своё расписание', scheduleCron: '0 * * * *' })

    const { importer, calls } = recorder()
    const summary = await syncAllFeeds({ db: testDb, importer, skipCustomSchedule: true })

    expect(calls).toEqual([shared])
    expect(summary.total).toBe(1)
  })
})
