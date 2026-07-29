import { beforeEach, describe, expect, it } from 'vitest'

import { createApartment, createFeed, createProject } from '../../testing/catalog.js'
import { resetDatabase, testDb } from '../../testing/db.js'
import { APARTMENT_SEARCH_LIMIT, listCatalogLocations, listProjects, searchApartments } from './apartments.js'

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
    const found = await searchApartments(testDb, {})
    expect(found.total).toBe(0)
    expect(found.apartments).toEqual([])
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

  it('район ищется в любой форме, а не буквальным совпадением', async () => {
    const feed = await createFeed()
    const kosmos = await createProject({
      name: 'ЖК «Космос» (Домодедово)',
      district: 'Домодедово',
      address: 'Домодедовский городской округ. ул. Жуковского, д. 4',
    })
    const bereg = await createProject({ name: 'ЖК «Берег»', district: 'Химки' })
    await createApartment({ feedId: feed.id, projectId: kosmos.id, rooms: 0, price: 4_718_010 })
    await createApartment({ feedId: feed.id, projectId: bereg.id, rooms: 0, price: 6_384_000 })

    for (const district of ['Домодедово', 'домодедовский', 'Домодедовский городской округ', 'Домадедово']) {
      const found = await searchApartments(testDb, { rooms: [0], district })
      expect(names(found.apartments), district).toEqual(['ЖК «Космос» (Домодедово)'])
    }
  })

  it('района, которого нет в каталоге, не выдаёт чужие квартиры', async () => {
    const feed = await createFeed()
    const project = await createProject({ name: 'ЖК «Берег»', district: 'Химки' })
    await createApartment({ feedId: feed.id, projectId: project.id })

    const found = await searchApartments(testDb, { district: 'Мурманск' })
    expect(found.total).toBe(0)
    expect(found.apartments).toEqual([])
  })

  it('район сужает выбор ЖК, а не расширяет его', async () => {
    const feed = await createFeed()
    const kosmos = await createProject({ name: 'Космос', district: 'Домодедово' })
    const bereg = await createProject({ name: 'Берег', district: 'Химки' })
    await createApartment({ feedId: feed.id, projectId: kosmos.id })
    await createApartment({ feedId: feed.id, projectId: bereg.id })

    // ЖК заданы списком, район — словом; остаётся пересечение.
    expect(names((await searchApartments(testDb, { district: 'Химки', projectIds: [bereg.id] })).apartments)).toEqual([
      'Берег',
    ])
    const empty = await searchApartments(testDb, { district: 'Химки', projectIds: [kosmos.id] })
    expect(empty.total).toBe(0)
    expect(empty.apartments).toEqual([])
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

  it('находит ЖК по названию так, как его произносит человек', async () => {
    const feed = await createFeed()
    const kosmos = await createProject({ name: 'ЖК «Космос» (Домодедово)' })
    const other = await createProject({ name: 'ЖК «Серебро»' })
    await createApartment({ feedId: feed.id, projectId: kosmos.id })
    await createApartment({ feedId: feed.id, projectId: other.id })

    for (const asked of ['Космос', 'ЖК Космос', 'жк "космос"', 'космос']) {
      expect(names(await listProjects(testDb, { name: asked }))).toEqual(['ЖК «Космос» (Домодедово)'])
    }
    expect(await listProjects(testDb, { name: 'Изумрудный' })).toEqual([])
  })

  it('фильтрует по направлению', async () => {
    const feed = await createFeed()
    const flats = await createProject({ name: 'Новостройка' })
    const office = await createProject({ name: 'Бизнес-центр', category: 'commercial' })
    await createApartment({ feedId: feed.id, projectId: flats.id })
    await createApartment({ feedId: feed.id, projectId: office.id })

    expect(names(await listProjects(testDb, { category: 'commercial' }))).toEqual(['Бизнес-центр'])
    expect(names(await listProjects(testDb, { category: 'novostroyki' }))).toEqual(['Новостройка'])
  })
})

/**
 * Перечень локаций — опора против выдуманных городов, а объяснение пустой
 * выдачи — против ложного «нет вообще» (тикет 19). Обе вещи проверяются на
 * настоящей базе: они целиком состоят из агрегатов.
 */
describe('listCatalogLocations', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('собирает локации из базы: сколько лотов, какие комнатности, вилка цен', async () => {
    const feed = await createFeed()
    const bereg = await createProject({ name: 'ЖК «Берег»', district: 'Химки' })
    const mishino = await createProject({ name: 'ЖК «Мишино-2»', district: 'Химки' })
    const vostok = await createProject({ name: 'ЖК «Восточный»', district: 'Звенигород' })
    await createApartment({ feedId: feed.id, projectId: bereg.id, rooms: 2, price: 10_800_000 })
    await createApartment({ feedId: feed.id, projectId: bereg.id, rooms: 0, price: 6_400_000 })
    await createApartment({ feedId: feed.id, projectId: mishino.id, rooms: 3, price: 20_600_000 })
    await createApartment({ feedId: feed.id, projectId: vostok.id, rooms: 1, price: 5_000_000 })

    expect(await listCatalogLocations(testDb)).toEqual([
      {
        name: 'Химки',
        category: 'novostroyki',
        apartmentCount: 3,
        // Комнатность из двух разных ЖК локации складывается в одну строку.
        rooms: [
          { rooms: 0, count: 1, priceMin: 6_400_000 },
          { rooms: 2, count: 1, priceMin: 10_800_000 },
          { rooms: 3, count: 1, priceMin: 20_600_000 },
        ],
        priceMin: 6_400_000,
        priceMax: 20_600_000,
      },
      {
        name: 'Звенигород',
        category: 'novostroyki',
        apartmentCount: 1,
        rooms: [{ rooms: 1, count: 1, priceMin: 5_000_000 }],
        priceMin: 5_000_000,
        priceMax: 5_000_000,
      },
    ])
  })

  it('не показывает то, чего нельзя предложить: выключенные ЖК и лоты', async () => {
    const feed = await createFeed()
    const active = await createProject({ name: 'Живой', district: 'Химки' })
    const hidden = await createProject({ name: 'Снятый', district: 'Мытищи', isActive: false })
    await createApartment({ feedId: feed.id, projectId: active.id, rooms: 1 })
    await createApartment({ feedId: feed.id, projectId: active.id, rooms: 2, isActive: false })
    await createApartment({ feedId: feed.id, projectId: hidden.id, rooms: 2 })

    expect(await listCatalogLocations(testDb)).toEqual([
      {
        name: 'Химки',
        category: 'novostroyki',
        apartmentCount: 1,
        rooms: [{ rooms: 1, count: 1, priceMin: 15_000_000 }],
        priceMin: 15_000_000,
        priceMax: 15_000_000,
      },
    ])
  })

  it('ЖК без района попадает в перечень под своим названием', async () => {
    const feed = await createFeed()
    const project = await createProject({ name: 'Без района', district: null })
    await createApartment({ feedId: feed.id, projectId: project.id, rooms: 1 })

    expect((await listCatalogLocations(testDb)).map((place) => place.name)).toEqual(['Без района'])
  })
})

describe('searchApartments: объяснение пустой выдачи', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  /** Химки из тикета: двухкомнатные есть, но не площадью до 40 м². */
  async function khimki(): Promise<void> {
    const feed = await createFeed()
    const bereg = await createProject({ name: 'ЖК «Берег»', district: 'Химки' })
    const vostok = await createProject({ name: 'ЖК «Восточный»', district: 'Звенигород' })
    await createApartment({ feedId: feed.id, projectId: bereg.id, rooms: 2, area: 52, price: 10_800_000 })
    await createApartment({ feedId: feed.id, projectId: bereg.id, rooms: 2, area: 56, price: 11_200_000 })
    await createApartment({ feedId: feed.id, projectId: bereg.id, rooms: 1, area: 34, price: 7_000_000 })
    await createApartment({ feedId: feed.id, projectId: vostok.id, rooms: 1, area: 38, price: 5_000_000 })
  }

  it('говорит, сколько таких квартир есть без придуманного ограничения', async () => {
    await khimki()

    const found = await searchApartments(testDb, { district: 'Химки', rooms: [2], areaMax: 40 })

    expect(found.total).toBe(0)
    expect(found.empty).toMatchObject({
      place: 'Химки',
      placeKnown: true,
      inPlace: 3,
      roomsInPlace: [
        { rooms: 1, count: 1, priceMin: 7_000_000 },
        { rooms: 2, count: 2, priceMin: 10_800_000 },
      ],
      rooms: [2],
      inPlaceWithRooms: 2,
      priceMin: 10_800_000,
      priceMax: 11_200_000,
      areaMin: 52,
      areaMax: 56,
      relaxed: [{ filter: 'площадь', total: 2 }],
    })
  })

  it('считает снятие каждого ограничения и всех сразу', async () => {
    await khimki()

    const found = await searchApartments(testDb, { district: 'Химки', rooms: [2], areaMax: 40, priceMax: 9_000_000 })

    expect(found.empty?.relaxed).toEqual([
      // Поодиночке не спасает ни то, ни другое — а вместе открывают две квартиры.
      { filter: 'площадь', total: 0 },
      { filter: 'цена', total: 0 },
      { filter: 'площадь и цена', total: 2 },
    ])
  })

  it('на несуществующей локации отдаёт перечень настоящих', async () => {
    await khimki()

    const found = await searchApartments(testDb, { district: 'Мытищи' })

    expect(found.empty?.placeKnown).toBe(false)
    expect(found.empty?.place).toBe('Мытищи')
    expect(found.empty?.locations.map((place) => place.name)).toEqual(['Химки', 'Звенигород'])
  })

  it('честное «нет ни одной» отличимо от «нет по этим условиям»', async () => {
    await khimki()

    const found = await searchApartments(testDb, { district: 'Звенигород', rooms: [0] })

    expect(found.empty).toMatchObject({
      placeKnown: true,
      inPlace: 1,
      roomsInPlace: [{ rooms: 1, count: 1, priceMin: 5_000_000 }],
      inPlaceWithRooms: 0,
    })
  })

  it('на непустой выдаче объяснения нет — считать нечего', async () => {
    await khimki()

    expect((await searchApartments(testDb, { district: 'Химки', rooms: [2] })).empty).toBeUndefined()
  })
})
