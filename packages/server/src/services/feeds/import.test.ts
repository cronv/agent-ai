import { readFileSync } from 'node:fs'
import type { FeedFormat, Prisma } from '@prisma/client'
import { beforeEach, describe, expect, it } from 'vitest'

import { resetDatabase, testDb } from '../../testing/db.js'
import type { FeedDownloader } from './download.js'
import { importFeed } from './import.js'

/**
 * Импорт целиком, против настоящего Postgres. Мокается только скачивание —
 * всё остальное (upsert по (feedId, externalId), автосоздание ЖК,
 * деактивация пропавших лотов) проверяется на живой базе, потому что именно
 * там живут уникальные индексы, ради которых всё это и написано.
 */

function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')
}

/** Загрузчик, который отдаёт заранее выбранный файл вместо похода в сеть. */
function serves(name: string): FeedDownloader {
  return async () => fixture(name)
}

/** Загрузчик, который падает — как упавший сервер застройщика. */
function fails(message: string): FeedDownloader {
  return async () => {
    throw new Error(message)
  }
}

async function createFeed(
  overrides: { name?: string; format?: FeedFormat; url?: string; fieldMapping?: Prisma.InputJsonValue } = {},
): Promise<string> {
  const feed = await testDb.feed.create({
    data: {
      name: overrides.name ?? 'Фид застройщика',
      url: overrides.url ?? 'https://dom-sever.ru/feed.xml',
      format: overrides.format ?? 'yandex',
      ...(overrides.fieldMapping ? { fieldMapping: overrides.fieldMapping } : {}),
    },
    select: { id: true },
  })
  return feed.id
}

const CUSTOM_MAPPING = {
  itemsPath: 'export.lots.lot',
  fields: {
    externalId: '@_id',
    price: 'cost',
    area: 'square',
    rooms: 'room_count',
    floor: 'level',
    floorsTotal: 'levels',
    building: 'korpus',
    finishing: 'finish',
    deadline: 'ready',
    url: 'link',
    projectName: 'complex',
    developer: 'builder',
    metro: 'subway',
    metroDistanceMin: 'subway_minutes',
  },
} satisfies Prisma.InputJsonValue

beforeEach(async () => {
  await resetDatabase()
})

describe('importFeed — фид Яндекса', () => {
  it('складывает квартиры в базу и заводит ЖК', async () => {
    const feedId = await createFeed()

    const result = await importFeed(feedId, { db: testDb, download: serves('yandex-realty.xml') })

    expect(result).toMatchObject({
      status: 'ok',
      total: 5,
      created: 5,
      updated: 0,
      deactivated: 0,
      skipped: 0,
      projectsCreated: 2,
      activeCount: 5,
      error: null,
    })

    const apartments = await testDb.apartment.findMany({ where: { feedId }, orderBy: { externalId: 'asc' } })
    expect(apartments).toHaveLength(5)

    const flat = apartments.find((row) => row.externalId === 'SP-1201')
    expect(flat).toMatchObject({
      price: 18_450_000,
      pricePerM2: 295_673,
      rooms: 2,
      area: 62.4,
      livingArea: 34.1,
      kitchenArea: 12.8,
      floor: 7,
      floorsTotal: 24,
      building: 'Корпус 3',
      finishing: 'чистовая',
      url: 'https://dom-sever.ru/flats/SP-1201',
      planImageUrl: 'https://dom-sever.ru/plans/SP-1201.png',
      isActive: true,
    })
    expect(flat?.deadline?.toISOString().slice(0, 10)).toBe('2027-06-30')
    expect(flat?.projectId).not.toBeNull()

    const projects = await testDb.project.findMany({ orderBy: { name: 'asc' } })
    expect(projects.map((project) => project.name)).toEqual(['ЖК «Лобачевский»', 'ЖК «Северный парк»'])
    expect(projects.map((project) => project.slug)).toEqual(['zhk-lobachevskiy', 'zhk-severnyy-park'])
    expect(projects[1]).toMatchObject({
      developer: 'ГК «Северный дом»',
      district: 'Головинский',
      metro: 'Водный стадион',
      metroDistanceMin: 11,
    })
  })

  it('записывает итог прогона в сам фид', async () => {
    const feedId = await createFeed()

    await importFeed(feedId, { db: testDb, download: serves('yandex-realty.xml') })

    const feed = await testDb.feed.findUniqueOrThrow({ where: { id: feedId } })
    expect(feed.lastStatus).toBe('ok')
    expect(feed.lastCount).toBe(5)
    expect(feed.lastError).toBeNull()
    expect(feed.lastRunAt).toBeInstanceOf(Date)
  })

  it('повторный импорт не плодит ни квартиры, ни ЖК', async () => {
    const feedId = await createFeed()
    await importFeed(feedId, { db: testDb, download: serves('yandex-realty.xml') })

    const second = await importFeed(feedId, { db: testDb, download: serves('yandex-realty.xml') })

    expect(second).toMatchObject({ status: 'ok', created: 0, updated: 5, deactivated: 0, projectsCreated: 0 })
    expect(await testDb.apartment.count()).toBe(5)
    expect(await testDb.project.count()).toBe(2)
  })

  it('пропавший из фида лот выключается, но остаётся в базе', async () => {
    const feedId = await createFeed()
    await importFeed(feedId, { db: testDb, download: serves('yandex-realty.xml') })

    const result = await importFeed(feedId, { db: testDb, download: serves('yandex-realty-updated.xml') })

    expect(result).toMatchObject({ status: 'ok', created: 1, updated: 4, deactivated: 1, activeCount: 5 })
    expect(await testDb.apartment.count()).toBe(6)

    const sold = await testDb.apartment.findFirstOrThrow({ where: { feedId, externalId: 'SP-1202' } })
    expect(sold.isActive).toBe(false)

    const fresh = await testDb.apartment.findFirstOrThrow({ where: { feedId, externalId: 'SP-1401' } })
    expect(fresh.isActive).toBe(true)
  })

  it('вернувшийся в фид лот снова включается', async () => {
    const feedId = await createFeed()
    await importFeed(feedId, { db: testDb, download: serves('yandex-realty.xml') })
    await importFeed(feedId, { db: testDb, download: serves('yandex-realty-updated.xml') })

    await importFeed(feedId, { db: testDb, download: serves('yandex-realty.xml') })

    const returned = await testDb.apartment.findFirstOrThrow({ where: { feedId, externalId: 'SP-1202' } })
    expect(returned.isActive).toBe(true)
  })

  it('обновляет изменившиеся цену и этаж', async () => {
    const feedId = await createFeed()
    await importFeed(feedId, { db: testDb, download: serves('yandex-realty.xml') })

    await importFeed(feedId, { db: testDb, download: serves('yandex-realty-updated.xml') })

    const flat = await testDb.apartment.findFirstOrThrow({ where: { feedId, externalId: 'SP-1201' } })
    expect(flat.price).toBe(17_990_000)
    expect(flat.floor).toBe(8)
  })

  it('пустая выгрузка выключает все квартиры', async () => {
    const feedId = await createFeed()
    await importFeed(feedId, { db: testDb, download: serves('yandex-realty.xml') })

    const result = await importFeed(feedId, { db: testDb, download: serves('yandex-empty.xml') })

    expect(result).toMatchObject({ status: 'ok', total: 0, deactivated: 5, activeCount: 0 })
    expect(await testDb.apartment.count({ where: { isActive: true } })).toBe(0)
    expect(await testDb.apartment.count()).toBe(5)
  })
})

describe('importFeed — фид ЦИАН', () => {
  it('разбирает выгрузку ЦИАН и заводит те же ЖК по названию', async () => {
    const cianFeed = await createFeed({ name: 'ЦИАН', format: 'cian', url: 'https://novostroy.example.ru/cian.xml' })

    const result = await importFeed(cianFeed, { db: testDb, download: serves('cian.xml') })

    expect(result).toMatchObject({ status: 'ok', total: 4, created: 4, skipped: 0, projectsCreated: 2 })

    const studio = await testDb.apartment.findFirstOrThrow({ where: { externalId: 'CN-77-004411' } })
    expect(studio.rooms).toBe(0)
    expect(studio.finishing).toBe('предчистовая')
    expect(studio.price).toBe(8_990_000)
  })

  it('ЖК с тем же названием из другого фида не создаётся заново', async () => {
    const yandexFeed = await createFeed({ name: 'Яндекс' })
    const cianFeed = await createFeed({ name: 'ЦИАН', format: 'cian', url: 'https://novostroy.example.ru/cian.xml' })

    await importFeed(yandexFeed, { db: testDb, download: serves('yandex-realty.xml') })
    const second = await importFeed(cianFeed, { db: testDb, download: serves('cian.xml') })

    expect(second.projectsCreated).toBe(0)
    expect(await testDb.project.count()).toBe(2)

    const lobachevskiy = await testDb.project.findFirstOrThrow({ where: { name: 'ЖК «Лобачевский»' } })
    const apartments = await testDb.apartment.findMany({ where: { projectId: lobachevskiy.id } })
    expect(apartments).toHaveLength(4)
  })

  it('импорт другого фида не трогает квартиры первого', async () => {
    const yandexFeed = await createFeed({ name: 'Яндекс' })
    const cianFeed = await createFeed({ name: 'ЦИАН', format: 'cian', url: 'https://novostroy.example.ru/cian.xml' })
    await importFeed(yandexFeed, { db: testDb, download: serves('yandex-realty.xml') })

    await importFeed(cianFeed, { db: testDb, download: serves('cian.xml') })

    expect(await testDb.apartment.count({ where: { feedId: yandexFeed, isActive: true } })).toBe(5)
  })
})

describe('importFeed — свой формат', () => {
  it('берёт соответствие полей из fieldMapping', async () => {
    const feedId = await createFeed({
      name: 'СтройГрад',
      format: 'custom',
      url: 'https://stroygrad.example.ru/export.xml',
      fieldMapping: CUSTOM_MAPPING,
    })

    const result = await importFeed(feedId, { db: testDb, download: serves('custom.xml') })

    expect(result).toMatchObject({ status: 'ok', total: 3, created: 3, projectsCreated: 1 })
    const flat = await testDb.apartment.findFirstOrThrow({ where: { externalId: 'B-330' } })
    expect(flat.price).toBe(14_900_000)
    expect(flat.rooms).toBe(3)
    expect(flat.building).toBe('Корпус Б')
  })

  it('без fieldMapping возвращает понятную ошибку, а не падает', async () => {
    const feedId = await createFeed({ format: 'custom' })

    const result = await importFeed(feedId, { db: testDb, download: serves('custom.xml') })

    expect(result.status).toBe('error')
    expect(result.error).toMatch(/соответствие полей/i)
  })
})

describe('importFeed — фид с пропущенными полями', () => {
  it('пропускает негодные лоты и объясняет причину', async () => {
    const feedId = await createFeed()

    const result = await importFeed(feedId, { db: testDb, download: serves('yandex-incomplete.xml') })

    expect(result).toMatchObject({ status: 'ok', total: 6, created: 2, skipped: 4 })
    expect(result.warnings).toEqual([
      'Предложение №2: нет внешнего идентификатора лота',
      'Лот NO-PRICE: нет цены или цена не читается как число',
      'Лот ZERO-PRICE: нет цены или цена не читается как число',
      'Лот OK-1: повторяется в фиде, взят первый',
    ])

    const apartments = await testDb.apartment.findMany({ where: { feedId }, orderBy: { externalId: 'asc' } })
    expect(apartments.map((row) => row.externalId)).toEqual(['NO-PROJECT', 'OK-1'])
    expect(apartments[0]?.projectId).toBeNull()
    expect(apartments[1]?.price).toBe(15_300_000)
  })
})

describe('importFeed — беды', () => {
  it('битый XML не выбрасывает исключение, а сохраняет текст ошибки', async () => {
    const feedId = await createFeed()
    await importFeed(feedId, { db: testDb, download: serves('yandex-realty.xml') })

    const result = await importFeed(feedId, { db: testDb, download: serves('broken.xml') })

    expect(result.status).toBe('error')
    expect(result.error).toMatch(/не является правильным XML/i)

    const feed = await testDb.feed.findUniqueOrThrow({ where: { id: feedId } })
    expect(feed.lastStatus).toBe('error')
    expect(feed.lastError).toMatch(/не является правильным XML/i)

    // Уже загруженные квартиры от битой выгрузки не страдают.
    expect(await testDb.apartment.count({ where: { feedId, isActive: true } })).toBe(5)
  })

  it('недоступный сервер не выбрасывает исключение', async () => {
    const feedId = await createFeed()

    const result = await importFeed(feedId, { db: testDb, download: fails('getaddrinfo ENOTFOUND dom-sever.ru') })

    expect(result.status).toBe('error')
    expect(result.error).toMatch(/ENOTFOUND/)
    expect(result.created).toBe(0)
  })

  it('таймаут не выбрасывает исключение', async () => {
    const feedId = await createFeed()

    const result = await importFeed(feedId, { db: testDb, download: fails('Сервер не ответил за 60 с') })

    expect(result.status).toBe('error')
    expect(result.error).toBe('Сервер не ответил за 60 с')
  })

  it('файл не того формата — говорит об этом, а не молчит', async () => {
    const feedId = await createFeed()

    const result = await importFeed(feedId, { db: testDb, download: serves('not-a-feed.xml') })

    expect(result.status).toBe('error')
    expect(result.error).toMatch(/не похоже на выгрузку/i)
  })

  it('несуществующий фид — ошибка в результате, а не исключение', async () => {
    const result = await importFeed('нет-такого-фида', { db: testDb })

    expect(result.status).toBe('error')
    expect(result.error).toMatch(/не найден/i)
  })
})
