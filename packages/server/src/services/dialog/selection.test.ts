import { beforeEach, describe, expect, it } from 'vitest'

import { createApartment, createFeed, createProject } from '../../testing/catalog.js'
import { resetDatabase, testDb } from '../../testing/db.js'
import { ensureConversation } from './conversations.js'
import { describeChoice, listSelected, selectApartment } from './selection.js'

/**
 * Выбор квартиры кнопкой на карточке.
 *
 * База настоящая: проверяется в том числе то, что попало в переписку — реплика
 * «Выбрал: …» нужна не для красоты, по ней ассистент понимает следующий ход.
 */

async function seed(): Promise<{ conversationId: string; apartmentId: string; otherId: string }> {
  const feed = await createFeed()
  const project = await createProject({ name: 'ЖК «Космос»', district: 'Химки' })
  const apartment = await createApartment({
    feedId: feed.id,
    projectId: project.id,
    rooms: 2,
    area: 54.3,
    floor: 7,
    floorsTotal: 17,
    price: 16_400_000,
  })
  const other = await createApartment({ feedId: feed.id, projectId: project.id, rooms: 1, price: 9_100_000 })
  const conversation = await ensureConversation(testDb, { sessionId: 'session-select-test' })
  return { conversationId: conversation.id, apartmentId: apartment.id, otherId: other.id }
}

describe('selectApartment', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('записывает выбор на диалог и оставляет след в переписке', async () => {
    const { conversationId, apartmentId } = await seed()

    const outcome = await selectApartment(testDb, { conversationId, apartmentId })

    expect(outcome.status).toBe('added')
    expect(outcome.status === 'added' && outcome.text).toBe(
      'Выбрал: двухкомнатная, 54,3 м², ЖК «Космос», 7-й этаж из 17, 16,4 млн ₽',
    )

    // Реплика от лица посетителя: ассистент прочитает её как сказанное им.
    const message = await testDb.message.findFirstOrThrow({ where: { conversationId } })
    expect(message.role).toBe('user')
    expect(message.content).toContain('Выбрал:')
    expect(Array.isArray(message.apartments) ? message.apartments : []).toHaveLength(1)

    expect(await listSelected(testDb, conversationId)).toHaveLength(1)
  })

  it('повторный выбор той же квартиры ничего не дублирует', async () => {
    const { conversationId, apartmentId } = await seed()

    await selectApartment(testDb, { conversationId, apartmentId })
    const again = await selectApartment(testDb, { conversationId, apartmentId })

    expect(again.status).toBe('duplicate')
    expect(await testDb.message.count({ where: { conversationId } })).toBe(1)
    expect(await listSelected(testDb, conversationId)).toHaveLength(1)
  })

  it('за диалог можно выбрать несколько квартир', async () => {
    const { conversationId, apartmentId, otherId } = await seed()

    await selectApartment(testDb, { conversationId, apartmentId })
    await selectApartment(testDb, { conversationId, apartmentId: otherId })

    const selected = await listSelected(testDb, conversationId)
    expect(selected.map((card) => card.id)).toEqual([apartmentId, otherId])
  })

  it('снятый с продажи лот выбрать нельзя', async () => {
    const { conversationId, apartmentId } = await seed()
    await testDb.apartment.update({ where: { id: apartmentId }, data: { isActive: false } })

    const outcome = await selectApartment(testDb, { conversationId, apartmentId })

    expect(outcome.status).toBe('unknown')
    expect(await testDb.message.count({ where: { conversationId } })).toBe(0)
  })
})

describe('describeChoice', () => {
  const base = {
    id: 'a1',
    projectId: null,
    projectName: null,
    developer: null,
    district: null,
    metro: null,
    metroDistanceMin: null,
    rooms: null as number | null,
    planType: null as string | null,
    area: null as number | null,
    livingArea: null,
    kitchenArea: null,
    floor: null as number | null,
    floorsTotal: null as number | null,
    price: 5_000_000,
    pricePerM2: null,
    building: null,
    section: null,
    finishing: null,
    balcony: null,
    windowView: null,
    bathroom: null,
    euroPlan: null,
    deadline: null,
    planImageUrl: null,
    photos: [] as string[],
    url: null,
  }

  it('пишет комнатность в единственном числе — речь про одну квартиру', () => {
    expect(describeChoice({ ...base, rooms: 3, area: 88 })).toBe('Выбрал: трёхкомнатная, 88,0 м², 5,0 млн ₽')
  })

  it('студию называет студией', () => {
    expect(describeChoice({ ...base, rooms: 0, area: 22.8 })).toBe('Выбрал: студия, 22,8 м², 5,0 млн ₽')
  })

  it('без комнатности берёт тип планировки', () => {
    expect(describeChoice({ ...base, planType: 'свободная планировка' })).toBe(
      'Выбрал: свободная планировка, 5,0 млн ₽',
    )
  })
})
