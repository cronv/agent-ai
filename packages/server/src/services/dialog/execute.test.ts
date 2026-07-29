import { beforeEach, describe, expect, it } from 'vitest'

import { ingestDocument } from '../knowledge/index.js'
import { createApartment, createProject } from '../../testing/catalog.js'
import { resetDatabase, testDb } from '../../testing/db.js'
import { executeTool } from './execute.js'

/**
 * Разбор параметров инструментов проверяется на настоящей базе: то, что
 * присылает модель, — недоверенный ввод, и цена ошибки здесь не «неудобно»,
 * а «ассистент не нашёл условия и выдумал ставку» (тикет 17).
 */

async function addDoc(text: string, projectId: string | null): Promise<void> {
  const doc = await ingestDocument(testDb, {
    filename: 'ипотека.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(text, 'utf8'),
    projectId,
  })
  expect(doc.status).toBe('ready')
}

function fragments(content: string): { found: number; fragments: { content: string }[] } {
  return JSON.parse(content) as { found: number; fragments: { content: string }[] }
}

describe('search_knowledge: параметр project_id', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('находит документ ЖК, когда модель прислала название вместо идентификатора', async () => {
    const project = await createProject({ name: 'ЖК «Космос» (Домодедово)', slug: 'kosmos' })
    await addDoc('Ставка 3,7% годовых при первоначальном взносе от 35%.', project.id)

    const outcome = await executeTool(
      'search_knowledge',
      { query: 'ставка первоначальный взнос', project_id: 'Космос' },
      { db: testDb, conversationId: 'c1' },
    )

    expect(fragments(outcome.content).found).toBe(1)
  })

  it('идентификатор ЖК по-прежнему отсекает документы других комплексов', async () => {
    const kosmos = await createProject({ name: 'Космос', slug: 'kosmos' })
    const bereg = await createProject({ name: 'Берег', slug: 'bereg' })
    await addDoc('Ставка по ипотеке в Космосе — 3,7%.', kosmos.id)
    await addDoc('Ставка по ипотеке в Береге — 9,9%.', bereg.id)

    const outcome = await executeTool(
      'search_knowledge',
      { query: 'ставка по ипотеке', project_id: kosmos.id },
      { db: testDb, conversationId: 'c1' },
    )

    const parsed = fragments(outcome.content)
    expect(parsed.found).toBe(1)
    expect(parsed.fragments[0]?.content).toContain('Космосе')
  })

  it('нераспознанное название снимает фильтр, а не обнуляет выдачу', async () => {
    const project = await createProject({ name: 'Космос', slug: 'kosmos' })
    await addDoc('Ставка 3,7% годовых при первоначальном взносе от 35%.', project.id)

    const outcome = await executeTool(
      'search_knowledge',
      { query: 'ставка первоначальный взнос', project_id: 'ЖК которого нет' },
      { db: testDb, conversationId: 'c1' },
    )

    expect(fragments(outcome.content).found).toBe(1)
  })
})

/**
 * Пустая выдача (тикет 19). Проверяется не форма JSON, а то, что модель
 * получает: цифры, из которых честный ответ собирается сам собой, и готовую
 * формулировку — она повторит именно её.
 */
describe('search_apartments: что уходит модели вместо нуля', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  async function catalog(): Promise<void> {
    const bereg = await createProject({ name: 'ЖК «Берег»', district: 'Химки' })
    const vostok = await createProject({ name: 'ЖК «Восточный»', district: 'Звенигород' })
    await createApartment({ projectId: bereg.id, rooms: 2, area: 52, price: 10_844_500 })
    await createApartment({ projectId: bereg.id, rooms: 2, area: 56, price: 11_200_000 })
    await createApartment({ projectId: vostok.id, rooms: 1, area: 38, price: 5_005_200 })
  }

  async function search(input: Record<string, unknown>): Promise<string> {
    const outcome = await executeTool('search_apartments', input, { db: testDb, conversationId: 'c1' })
    expect(outcome.isError).toBe(false)
    return outcome.content
  }

  it('модели уходит число фотографий, а не десяток ссылок на каждый лот', async () => {
    const bereg = await createProject({ name: 'ЖК «Берег»', district: 'Химки' })
    await createApartment({
      projectId: bereg.id,
      rooms: 2,
      price: 10_000_000,
      photos: ['https://cdn.ru/1.jpg', 'https://cdn.ru/2.jpg', 'https://cdn.ru/3.jpg'],
    })

    const outcome = await executeTool('search_apartments', { rooms: [2] }, { db: testDb, conversationId: 'c1' })

    expect(outcome.content).toContain('"photoCount":3')
    expect(outcome.content).not.toContain('cdn.ru')
    // Виджету при этом уезжают сами ссылки — карточку рисует он.
    expect(outcome.apartments[0]?.photos).toHaveLength(3)
  })

  it('на узком фильтре сообщает, сколько таких квартир есть на самом деле', async () => {
    await catalog()

    const content = await search({ rooms: [2], district: 'Химки', area_max: 40 })

    expect(content).toContain('"total":0')
    expect(content).toContain('Двухкомнатные в локации «Химки» есть — 2 квартиры')
    expect(content).toContain('от 10,8 млн ₽ до 11,2 млн ₽')
    expect(content).toContain('без ограничения «площадь» — 2')
    expect(content).toContain('прямая ложь')
    expect(content).toContain('Разрешения не спрашивай')
  })

  it('на несуществующей локации перечисляет настоящие', async () => {
    await catalog()

    const content = await search({ rooms: [2], district: 'Мытищи' })

    expect(content).toContain('Локации «Мытищи» в каталоге нет')
    expect(content).toContain('Химки, Звенигород')
    expect(content).toContain('"place_in_catalog":false')
  })

  it('настоящее отсутствие не маскирует: студий в Звенигороде нет, но есть однокомнатные', async () => {
    await catalog()

    const content = await search({ rooms: [0], district: 'Звенигород', price_max: 3_000_000 })

    expect(content).toContain('Студий в локации «Звенигород» действительно нет совсем')
    expect(content).toContain('однокомнатные от 5,0 млн ₽')
    expect(content).toContain('"requested_rooms_in_place":0')
  })

  it('комнатности идут с ценой «от» — иначе их выдают за подходящие под бюджет', async () => {
    const podolsk = await createProject({ name: 'ЖК «Красная горка»', district: 'Подольск' })
    await createApartment({ projectId: podolsk.id, rooms: 0, area: 24, price: 4_435_200 })
    await createApartment({ projectId: podolsk.id, rooms: 1, area: 34, price: 5_737_500 })

    const content = await search({ rooms: [1], district: 'Подольск', price_max: 4_000_000 })

    expect(content).toContain('студии от 4,4 млн ₽ (1 шт.)')
    expect(content).toContain('Дешевле 4,4 млн ₽ в локации «Подольск» нет ничего')
    expect(content).toContain('Не обещай показать то, что дешевле')
    expect(content).toContain('"cheapest_in_place":4435200')
  })

  it('на непустой подборке лишнего блока нет', async () => {
    await catalog()

    expect(await search({ rooms: [2], district: 'Химки' })).not.toContain('nothing_found')
  })
})

describe('list_projects: пустой ответ называет реальные локации', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('перечисляет локации каталога', async () => {
    const bereg = await createProject({ name: 'ЖК «Берег»', district: 'Химки' })
    await createApartment({ projectId: bereg.id, rooms: 2, price: 10_844_500 })

    const outcome = await executeTool('list_projects', { district: 'Лобня' }, { db: testDb, conversationId: 'c1' })

    expect(outcome.content).toContain('"found":0')
    expect(outcome.content).toContain('Локации каталога, и других у агентства нет: Химки')
  })
})

/**
 * Сданные дома (тикет 24). 69% боевого каталога — построенные корпуса, у
 * которых срок сдачи стоит в прошлом. Проверяется, что модель этой даты
 * вообще не видит: увидев «2023-12-31», она послушно напишет «сдача в декабре
 * 2023-го» про дом, куда можно въехать сегодня.
 */
describe('готовность дома доезжает до модели', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('вместо срока сданного дома уходят слова, а не дата из прошлого', async () => {
    const project = await createProject({ name: 'ЖК «Серебро»', slug: 'serebro', district: 'Пушкинский' })
    await createApartment({
      projectId: project.id,
      rooms: 1,
      price: 6_000_000,
      deadline: new Date('2023-12-31'),
      isReady: true,
    })

    const outcome = await executeTool('search_apartments', {}, { db: testDb, conversationId: 'c1' })

    expect(outcome.content).toContain('"ready":true')
    expect(outcome.content).toContain('дом построен и введён в эксплуатацию')
    expect(outcome.content).not.toContain('2023')
    // Карточка виджета дату сохраняет: показывает он её иначе, чем словом.
    expect(outcome.apartments[0]?.isReady).toBe(true)
    expect(outcome.apartments[0]?.deadline).toBe('2023-12-31')
  })

  it('строящийся дом по-прежнему приходит со сроком', async () => {
    const project = await createProject({ name: 'ЖК «Берег»', slug: 'bereg' })
    await createApartment({
      projectId: project.id,
      price: 7_000_000,
      deadline: new Date('2027-06-30'),
      isReady: false,
    })

    const outcome = await executeTool('search_apartments', {}, { db: testDb, conversationId: 'c1' })

    expect(outcome.content).toContain('"deadline":"2027-06-30"')
    expect(outcome.content).toContain('"ready":false')
  })

  it('list_projects называет сданный комплекс сданным и не отдаёт срок в прошлом', async () => {
    const project = await createProject({
      name: 'ЖК «Серебро»',
      slug: 'serebro',
      deadline: new Date('2023-12-31'),
    })
    await createApartment({ projectId: project.id, price: 6_000_000, isReady: true })
    await createApartment({ projectId: project.id, price: 7_000_000, isReady: true })

    const outcome = await executeTool('list_projects', { name: 'Серебро' }, { db: testDb, conversationId: 'c1' })

    expect(outcome.content).toContain('"ready":true')
    expect(outcome.content).toContain('"deadline":null')
  })

  it('часть корпусов сдана, часть нет — про готовность комплекса не говорим', async () => {
    const project = await createProject({ name: 'ЖК «Мишино-2»', slug: 'mishino' })
    await createApartment({ projectId: project.id, price: 6_000_000, isReady: true })
    await createApartment({ projectId: project.id, price: 7_000_000, isReady: false })

    const outcome = await executeTool('list_projects', { name: 'Мишино' }, { db: testDb, conversationId: 'c1' })

    expect(outcome.content).toContain('"ready":null')
  })
})
