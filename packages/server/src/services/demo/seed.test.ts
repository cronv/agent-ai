import { beforeEach, describe, expect, it } from 'vitest'

import { resetDatabase, testDb } from '../../testing/db.js'
import { SettingsService } from '../settings/index.js'
import { DEMO_FEED_NAME, DEMO_KNOWLEDGE_FILENAME } from './assets.js'
import { seedDemoData, seedDemoIfEmpty } from './seed.js'

/**
 * Засев демо-данных. Проверяется то, ради чего он существует: после одной
 * команды в базе есть на что посмотреть, а после двух — ровно столько же.
 */

const BASE_URL = 'http://localhost:3000'

const settings = new SettingsService({ db: testDb })

async function seed(): ReturnType<typeof seedDemoData> {
  return seedDemoData({ db: testDb, settings, baseUrl: BASE_URL })
}

describe('засев демонстрационных данных', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('заводит четыре ЖК и тридцать квартир из демо-выгрузки', async () => {
    const result = await seed()

    expect(result.error).toBeNull()
    expect(result.projectsCreated).toBe(4)
    expect(result.apartmentsCreated).toBe(30)
    expect(await testDb.apartment.count({ where: { isActive: true } })).toBe(30)
  })

  it('данные правдоподобны: московские районы, вменяемые площади и цены за метр', async () => {
    await seed()

    const districts = await testDb.project.findMany({ select: { district: true, metro: true } })
    expect(districts.map((row) => row.district).sort()).toEqual([
      'Головинский',
      'Некрасовка',
      'Преображенское',
      'Раменки',
    ])
    expect(districts.every((row) => row.metro !== null)).toBe(true)

    const apartments = await testDb.apartment.findMany({
      select: { rooms: true, area: true, price: true, pricePerM2: true, floor: true, floorsTotal: true },
    })
    for (const flat of apartments) {
      // Однушка за 40 млн или студия на 20 м² — то, на чём специалист по
      // недвижимости сразу видит халтуру.
      expect(flat.area).toBeGreaterThanOrEqual(22)
      expect(flat.area).toBeLessThanOrEqual(125)
      expect(flat.pricePerM2).toBeGreaterThanOrEqual(200_000)
      expect(flat.pricePerM2).toBeLessThanOrEqual(600_000)
      expect(flat.floor).toBeLessThanOrEqual(flat.floorsTotal ?? 0)
    }

    // Разброс комнатности: и студии, и многокомнатные — иначе подбор нечем показывать.
    const rooms = new Set(apartments.map((flat) => flat.rooms))
    expect(rooms).toContain(0)
    expect(rooms).toContain(4)
  })

  it('у каждой квартиры есть планировка по адресу самого приложения', async () => {
    await seed()

    const plans = await testDb.apartment.findMany({ select: { planImageUrl: true } })
    expect(plans).toHaveLength(30)
    for (const { planImageUrl } of plans) {
      expect(planImageUrl).toMatch(new RegExp(`^${BASE_URL}/demo/plans/plan-[a-z0-9]+\\.svg$`))
    }
  })

  it('загружает документ базы знаний и режет его на фрагменты', async () => {
    const result = await seed()

    expect(result.knowledgeChunks).toBeGreaterThan(3)
    const doc = await testDb.knowledgeDoc.findFirstOrThrow({ where: { filename: DEMO_KNOWLEDGE_FILENAME } })
    expect(doc.status).toBe('ready')
    // Документ общий: условия описывают все четыре ЖК сразу.
    expect(doc.projectId).toBeNull()
  })

  it('заполняет срок сдачи и описание — того, чего в выгрузке нет', async () => {
    await seed()

    const projects = await testDb.project.findMany({ select: { deadline: true, description: true } })
    expect(projects).toHaveLength(4)
    expect(projects.every((row) => row.deadline !== null)).toBe(true)
    expect(projects.every((row) => (row.description ?? '').length > 80)).toBe(true)
  })

  it('создаёт настройки по умолчанию', async () => {
    const result = await seed()

    expect(result.settingsCreated).toBeGreaterThan(0)
    expect(await settings.get('widget_enabled')).toBe(true)
  })

  it('повторный запуск не плодит дублей', async () => {
    await seed()
    const second = await seed()

    expect(second.apartmentsCreated).toBe(0)
    expect(second.apartmentsUpdated).toBe(30)
    expect(await testDb.feed.count()).toBe(1)
    expect(await testDb.project.count()).toBe(4)
    expect(await testDb.apartment.count()).toBe(30)
    expect(await testDb.knowledgeDoc.count()).toBe(1)
    // Фрагменты старой копии документа удалены вместе с ней — иначе поиск
    // находил бы каждый абзац дважды.
    expect(await testDb.knowledgeChunk.count()).toBe(second.knowledgeChunks)
  })

  it('не затирает описание, поправленное руками в админке', async () => {
    await seed()
    const project = await testDb.project.findFirstOrThrow({ select: { id: true } })
    await testDb.project.update({ where: { id: project.id }, data: { description: 'Своё описание' } })

    await seed()

    const after = await testDb.project.findUniqueOrThrow({ where: { id: project.id } })
    expect(after.description).toBe('Своё описание')
  })

  it('фид заводится один раз и переезжает вслед за адресом приложения', async () => {
    await seed()
    await seedDemoData({ db: testDb, settings, baseUrl: 'https://novostroyki.example' })

    const feeds = await testDb.feed.findMany()
    expect(feeds).toHaveLength(1)
    expect(feeds[0]?.name).toBe(DEMO_FEED_NAME)
    expect(feeds[0]?.url).toBe('https://novostroyki.example/demo/feed.xml')
  })
})

describe('засев при старте сервера', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('на пустой базе засевает', async () => {
    const result = await seedDemoIfEmpty({ db: testDb, settings, baseUrl: BASE_URL })
    expect(result?.apartmentsCreated).toBe(30)
  })

  it('там, где уже есть свои объекты, не делает ничего', async () => {
    await testDb.project.create({ data: { name: 'ЖК Настоящий', slug: 'nastoyashchiy' } })

    const result = await seedDemoIfEmpty({ db: testDb, settings, baseUrl: BASE_URL })

    expect(result).toBeNull()
    expect(await testDb.apartment.count()).toBe(0)
    expect(await testDb.feed.count()).toBe(0)
  })
})
