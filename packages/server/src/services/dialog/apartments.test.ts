import { beforeEach, describe, expect, it } from 'vitest'

import { createApartment, createFeed, createProject } from '../../testing/catalog.js'
import { resetDatabase, testDb } from '../../testing/db.js'
import { APARTMENT_SEARCH_LIMIT, listProjects, searchApartments } from './apartments.js'

/**
 * Подбор проверяется на настоящей базе: фильтры — это и есть SQL,
 * подменять его нечем.
 */

function names(items: { projectName?: string | null; name?: string }[]): string[] {
  return items.map((item) => item.projectName ?? item.name ?? '')
}

describe('searchApartments', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('на пустой базе возвращает пустую подборку', async () => {
    expect(await searchApartments(testDb, {})).toEqual({ total: 0, apartments: [] })
  })

  it('фильтрует по комнатности, цене и площади', async () => {
    const feed = await createFeed()
    const project = await createProject({ name: 'Северный' })
    await createApartment({ feedId: feed.id, projectId: project.id, rooms: 1, price: 12_000_000, area: 38 })
    await createApartment({ feedId: feed.id, projectId: project.id, rooms: 2, price: 17_000_000, area: 54 })
    await createApartment({ feedId: feed.id, projectId: project.id, rooms: 2, price: 25_000_000, area: 72 })

    const found = await searchApartments(testDb, { rooms: [2], priceMax: 18_000_000, areaMin: 50 })

    expect(found.total).toBe(1)
    expect(found.apartments[0]?.price).toBe(17_000_000)
    expect(found.apartments[0]?.projectName).toBe('Северный')
  })

  it('фильтрует по этажу, отделке, району и метро', async () => {
    const feed = await createFeed()
    const near = await createProject({ name: 'У метро', district: 'Приморский', metro: 'Беговая' })
    const far = await createProject({ name: 'За городом', district: 'Всеволожский', metro: 'Девяткино' })
    await createApartment({ feedId: feed.id, projectId: near.id, floor: 1, finishing: 'без отделки' })
    await createApartment({ feedId: feed.id, projectId: near.id, floor: 7, finishing: 'чистовая' })
    await createApartment({ feedId: feed.id, projectId: far.id, floor: 7, finishing: 'чистовая' })

    expect((await searchApartments(testDb, { floorMin: 2 })).total).toBe(2)
    expect((await searchApartments(testDb, { finishing: 'чистов' })).total).toBe(2)
    expect(names((await searchApartments(testDb, { district: 'приморский' })).apartments)).toEqual(['У метро', 'У метро'])
    expect(names((await searchApartments(testDb, { metro: 'Беговая', floorMin: 2 })).apartments)).toEqual(['У метро'])
  })

  it('срок сдачи берётся у лота, а при его отсутствии — у ЖК', async () => {
    const feed = await createFeed()
    const early = await createProject({ name: 'Ранний', deadline: new Date(Date.UTC(2026, 11, 31)) })
    const late = await createProject({ name: 'Поздний', deadline: new Date(Date.UTC(2029, 11, 31)) })
    // У лота свой срок — он важнее срока ЖК.
    await createApartment({ feedId: feed.id, projectId: late.id, deadline: new Date(Date.UTC(2026, 5, 30)) })
    await createApartment({ feedId: feed.id, projectId: early.id })
    await createApartment({ feedId: feed.id, projectId: late.id })

    const found = await searchApartments(testDb, { deadlineBefore: new Date(Date.UTC(2027, 0, 1)) })

    expect(found.total).toBe(2)
    expect(names(found.apartments).sort()).toEqual(['Поздний', 'Ранний'])
  })

  it('прячет проданные лоты и выключенные ЖК', async () => {
    const feed = await createFeed()
    const active = await createProject({ name: 'Активный' })
    const disabled = await createProject({ name: 'Выключенный', isActive: false })
    await createApartment({ feedId: feed.id, projectId: active.id })
    await createApartment({ feedId: feed.id, projectId: active.id, isActive: false })
    await createApartment({ feedId: feed.id, projectId: disabled.id })

    const found = await searchApartments(testDb, {})

    expect(names(found.apartments)).toEqual(['Активный'])
  })

  it('по умолчанию отдаёт пять лотов и общее количество найденного', async () => {
    const feed = await createFeed()
    const project = await createProject()
    for (let index = 0; index < 8; index += 1) {
      await createApartment({ feedId: feed.id, projectId: project.id, price: 10_000_000 + index * 100_000 })
    }

    const found = await searchApartments(testDb, {})

    expect(found.total).toBe(8)
    expect(found.apartments).toHaveLength(APARTMENT_SEARCH_LIMIT)
    // Дешёвые идут первыми — так подборка читается сверху вниз.
    expect(found.apartments[0]?.price).toBe(10_000_000)
    expect(found.apartments.at(-1)?.price).toBe(10_400_000)
  })

  it('лимит ограничен потолком', async () => {
    const feed = await createFeed()
    const project = await createProject()
    for (let index = 0; index < 3; index += 1) {
      await createApartment({ feedId: feed.id, projectId: project.id })
    }

    expect((await searchApartments(testDb, { limit: 1000 })).apartments).toHaveLength(3)
  })

  it('карточка содержит всё, что рисует виджет', async () => {
    const feed = await createFeed()
    const project = await createProject({
      name: 'Северный',
      developer: 'Строй',
      district: 'Приморский',
      metro: 'Беговая',
      metroDistanceMin: 7,
    })
    await createApartment({
      feedId: feed.id,
      projectId: project.id,
      rooms: 2,
      area: 54.2,
      floor: 7,
      floorsTotal: 18,
      price: 17_400_000,
      pricePerM2: 321_000,
      finishing: 'чистовая',
      deadline: new Date(Date.UTC(2027, 5, 30)),
      planImageUrl: 'https://example.com/plan.png',
      url: 'https://example.com/lot',
    })

    const card = (await searchApartments(testDb, {})).apartments[0]

    expect(card).toMatchObject({
      projectName: 'Северный',
      developer: 'Строй',
      district: 'Приморский',
      metro: 'Беговая',
      metroDistanceMin: 7,
      rooms: 2,
      area: 54.2,
      floor: 7,
      floorsTotal: 18,
      price: 17_400_000,
      pricePerM2: 321_000,
      finishing: 'чистовая',
      deadline: '2027-06-30',
      planImageUrl: 'https://example.com/plan.png',
      url: 'https://example.com/lot',
    })
  })
})

describe('listProjects', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('отдаёт диапазон цен, количество лотов и комнатности', async () => {
    const feed = await createFeed()
    const project = await createProject({ name: 'Северный', district: 'Приморский' })
    await createApartment({ feedId: feed.id, projectId: project.id, rooms: 1, price: 12_000_000 })
    await createApartment({ feedId: feed.id, projectId: project.id, rooms: 2, price: 17_000_000 })
    await createApartment({ feedId: feed.id, projectId: project.id, rooms: 2, price: 25_000_000 })

    const [summary] = await listProjects(testDb, {})

    expect(summary).toMatchObject({
      name: 'Северный',
      district: 'Приморский',
      apartmentCount: 3,
      priceMin: 12_000_000,
      priceMax: 25_000_000,
      roomsAvailable: [1, 2],
    })
  })

  it('ЖК без свободных лотов в список не попадает', async () => {
    const feed = await createFeed()
    const empty = await createProject({ name: 'Пустой' })
    const filled = await createProject({ name: 'С лотами' })
    await createApartment({ feedId: feed.id, projectId: empty.id, isActive: false })
    await createApartment({ feedId: feed.id, projectId: filled.id })

    expect(names(await listProjects(testDb, {}))).toEqual(['С лотами'])
  })

  it('фильтр по цене считает только подходящие лоты', async () => {
    const feed = await createFeed()
    const cheap = await createProject({ name: 'Доступный' })
    const pricey = await createProject({ name: 'Дорогой' })
    await createApartment({ feedId: feed.id, projectId: cheap.id, price: 9_000_000 })
    await createApartment({ feedId: feed.id, projectId: cheap.id, price: 30_000_000 })
    await createApartment({ feedId: feed.id, projectId: pricey.id, price: 40_000_000 })

    const found = await listProjects(testDb, { priceMax: 12_000_000 })

    expect(names(found)).toEqual(['Доступный'])
    expect(found[0]?.apartmentCount).toBe(1)
    expect(found[0]?.priceMax).toBe(9_000_000)
  })

  it('фильтрует по району', async () => {
    const feed = await createFeed()
    const near = await createProject({ name: 'Приморский дом', district: 'Приморский' })
    const other = await createProject({ name: 'Невский дом', district: 'Невский' })
    await createApartment({ feedId: feed.id, projectId: near.id })
    await createApartment({ feedId: feed.id, projectId: other.id })

    expect(names(await listProjects(testDb, { district: 'примор' }))).toEqual(['Приморский дом'])
  })
})
