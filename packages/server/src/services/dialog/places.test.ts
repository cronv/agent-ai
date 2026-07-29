import { beforeEach, describe, expect, it } from 'vitest'

import { createProject } from '../../testing/catalog.js'
import { resetDatabase, testDb } from '../../testing/db.js'
import { findProjectsByName, findProjectsByPlace } from './places.js'

/**
 * Поиск по месту проверяется на настоящем Postgres: вся логика — это
 * триграммы pg_trgm, подменять их нечем.
 *
 * Каталог здесь — те же семь ЖК NDV.RU, что и у заказчика.
 */

interface Seeded {
  kosmos: string
  bereg: string
  mishino: string
  gorka: string
  shkolny: string
  serebro: string
  vostochny: string
}

async function seedCatalog(): Promise<Seeded> {
  const make = async (name: string, district: string | null, address: string): Promise<string> =>
    (await createProject({ name, district, address })).id

  return {
    kosmos: await make('ЖК «Космос» (Домодедово)', 'Домодедово', 'Домодедовский городской округ. ул. Жуковского, д. 4'),
    bereg: await make('ЖК «Берег»', 'Химки', 'Химки городской округ. ул. Береговая, д. 1А'),
    mishino: await make('ЖК «Мишино-2»', 'Химки', 'Химки городской округ. ул. Озерная, ЖК Мишино-2'),
    gorka: await make('ЖК «Красная горка» (Подольск)', 'Подольск', 'Подольск городской округ. ул. Садовая, д. 14'),
    shkolny: await make('ЖК «Школьный» («Альянс»)', 'Подольск', 'Подольск городской округ. ул. Школьная, д. 41'),
    serebro: await make('ЖК «Серебро»', 'Пушкинский', 'Пушкинский район. Ярославское ш., 35 километр'),
    vostochny: await make('ЖК «Восточный» (Звенигород)', 'Звенигород', 'Одинцовский район. микрорайон Восточный'),
  }
}

describe('findProjectsByPlace', () => {
  let ids: Seeded

  beforeEach(async () => {
    await resetDatabase()
    ids = await seedCatalog()
  })

  it.each([
    ['Домодедово'],
    ['домодедово'],
    ['домодедовский'],
    ['Домодедовский городской округ'],
    ['г. Домодедово'],
    // Опечатка в одну букву.
    ['Домадедово'],
    // Место названо внутри фразы.
    ['квартира в Домодедово'],
  ])('находит ЖК по написанию «%s»', async (query) => {
    expect(await findProjectsByPlace(testDb, query)).toEqual([ids.kosmos])
  })

  it('возвращает все ЖК района, а не первый попавшийся', async () => {
    expect((await findProjectsByPlace(testDb, 'Химки')).sort()).toEqual([ids.bereg, ids.mishino].sort())
    expect((await findProjectsByPlace(testDb, 'химкинский городской округ')).sort()).toEqual(
      [ids.bereg, ids.mishino].sort(),
    )
    expect((await findProjectsByPlace(testDb, 'Подольск')).sort()).toEqual([ids.gorka, ids.shkolny].sort())
  })

  it('похожий, но другой район в выдачу не попадает', async () => {
    expect(await findProjectsByPlace(testDb, 'Подольск')).not.toContain(ids.kosmos)
    expect(await findProjectsByPlace(testDb, 'Химки')).not.toContain(ids.serebro)
  })

  it('«Пушкино» и «Пушкинский район» — одно и то же место', async () => {
    expect(await findProjectsByPlace(testDb, 'Пушкинский район')).toEqual([ids.serebro])
    expect(await findProjectsByPlace(testDb, 'Пушкино')).toEqual([ids.serebro])
  })

  it('если района нет в базе, ищет слово в названии и адресе ЖК', async () => {
    await testDb.project.updateMany({ data: { district: null } })

    expect(await findProjectsByPlace(testDb, 'Домодедово')).toEqual([ids.kosmos])
    expect((await findProjectsByPlace(testDb, 'Химки')).sort()).toEqual([ids.bereg, ids.mishino].sort())
    expect(await findProjectsByPlace(testDb, 'Звенигород')).toEqual([ids.vostochny])
  })

  it('запасной ход срабатывает и когда район заполнен, но не совпал', async () => {
    // «Одинцово» стоит только в адресе: район у ЖК записан как «Звенигород».
    expect(await findProjectsByPlace(testDb, 'Одинцовский район')).toEqual([ids.vostochny])
  })

  it('места, которого нет в каталоге, не находит', async () => {
    expect(await findProjectsByPlace(testDb, 'Мурманск')).toEqual([])
    expect(await findProjectsByPlace(testDb, 'Владивосток')).toEqual([])
    expect(await findProjectsByPlace(testDb, '   ')).toEqual([])
  })

  it('выключенные ЖК не показываются', async () => {
    await testDb.project.update({ where: { id: ids.kosmos }, data: { isActive: false } })
    expect(await findProjectsByPlace(testDb, 'Домодедово')).toEqual([])
  })
})

describe('findProjectsByName', () => {
  let ids: Seeded

  beforeEach(async () => {
    await resetDatabase()
    ids = await seedCatalog()
  })

  it('находит комплекс в косвенном падеже', () => {
    // «Когда сдача Серебра» модель превращает в name: «Серебра». Строгое
    // вхождение не находило «Серебро», и ассистент отвечал «такого комплекса
    // у нас нет» — про дом, продающий 220 квартир.
    return Promise.all([
      expect(findProjectsByName(testDb, 'Серебра')).resolves.toEqual([ids.serebro]),
      expect(findProjectsByName(testDb, 'Космоса')).resolves.toEqual([ids.kosmos]),
      expect(findProjectsByName(testDb, 'Школьном')).resolves.toEqual([ids.shkolny]),
    ])
  })

  it('точное вхождение по-прежнему главнее и находит часть названия', async () => {
    await expect(findProjectsByName(testDb, 'горка')).resolves.toEqual([ids.gorka])
    await expect(findProjectsByName(testDb, 'Берег')).resolves.toEqual([ids.bereg])
  })

  it('комплекса, которого нет, не выдумывает', async () => {
    await expect(findProjectsByName(testDb, 'Северный парк')).resolves.toEqual([])
  })
})
