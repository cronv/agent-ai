import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

import { FeedParseError, parseFeedXml, type ParsedApartment } from './parse.js'
import { FeedMappingError } from './profiles.js'

/** Эталонные выгрузки лежат рядом, в `__fixtures__`. */
function fixture(name: string): string {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf8')
}

function byId(apartments: ParsedApartment[], externalId: string): ParsedApartment {
  const found = apartments.find((apartment) => apartment.externalId === externalId)
  if (!found) throw new Error(`В разобранном фиде нет лота ${externalId}`)
  return found
}

const CUSTOM_MAPPING = {
  itemsPath: 'export.lots.lot',
  fields: {
    externalId: '@_id',
    price: 'cost',
    area: 'square',
    kitchenArea: 'kitchen',
    rooms: 'room_count',
    floor: 'level',
    floorsTotal: 'levels',
    building: 'korpus',
    finishing: 'finish',
    deadline: 'ready',
    planImageUrl: 'plan',
    url: 'link',
    projectName: 'complex',
    developer: 'builder',
    metro: 'subway',
    metroDistanceMin: 'subway_minutes',
  },
}

describe('Яндекс.Недвижимость', () => {
  const parsed = parseFeedXml(fixture('yandex-realty.xml'), { format: 'yandex' })

  it('находит все предложения, несмотря на пространство имён', () => {
    expect(parsed.total).toBe(5)
    expect(parsed.apartments).toHaveLength(5)
    expect(parsed.skipped).toHaveLength(0)
  })

  it('разбирает лот целиком', () => {
    const flat = byId(parsed.apartments, 'SP-1201')
    expect(flat).toMatchObject({
      externalId: 'SP-1201',
      price: 18_450_000,
      rooms: 2,
      area: 62.4,
      livingArea: 34.1,
      kitchenArea: 12.8,
      floor: 7,
      floorsTotal: 24,
      building: 'Корпус 3',
      section: '2',
      finishing: 'чистовая',
      planImageUrl: 'https://dom-sever.ru/plans/SP-1201.png',
      url: 'https://dom-sever.ru/flats/SP-1201',
    })
    expect(flat.pricePerM2).toBe(295_673)
    expect(flat.deadline?.toISOString().slice(0, 10)).toBe('2027-06-30')
  })

  it('берёт ЖК, застройщика и ближайшее метро из предложения', () => {
    expect(byId(parsed.apartments, 'SP-1201').project).toEqual({
      name: 'ЖК «Северный парк»',
      developer: 'ГК «Северный дом»',
      district: 'Головинский',
      metro: 'Водный стадион',
      metroDistanceMin: 11,
      address: 'Ленинградское шоссе, 25, корп. 3',
      url: null,
    })
  })

  it('флаг studio перебивает комнатность', () => {
    expect(byId(parsed.apartments, 'SP-1202').rooms).toBe(0)
    expect(byId(parsed.apartments, 'SP-1202').kitchenArea).toBeNull()
  })

  it('читает цену, записанную как «12,5 млн»', () => {
    expect(byId(parsed.apartments, 'RZ-205').price).toBe(12_500_000)
  })

  it('кладёт исходный узел в raw', () => {
    expect(byId(parsed.apartments, 'SP-1201').raw).toMatchObject({ 'building-state': 'unfinished' })
  })
})

describe('ЦИАН', () => {
  const parsed = parseFeedXml(fixture('cian.xml'), { format: 'cian' })

  it('находит все объекты', () => {
    expect(parsed.total).toBe(4)
    expect(parsed.apartments).toHaveLength(4)
    expect(parsed.skipped).toHaveLength(0)
  })

  it('разбирает объект целиком', () => {
    const flat = byId(parsed.apartments, 'CN-77-004410')
    expect(flat).toMatchObject({
      price: 34_750_000,
      area: 74.6,
      livingArea: 41,
      kitchenArea: 15.9,
      rooms: 2,
      floor: 12,
      floorsTotal: 17,
      building: 'Корпус 1',
      section: '2',
      finishing: 'чистовая',
      planImageUrl: 'https://novostroy.example.ru/plans/CN-77-004410.png',
      url: 'https://novostroy.example.ru/lot/CN-77-004410',
    })
    expect(flat.deadline?.toISOString().slice(0, 10)).toBe('2026-12-31')
  })

  it('берёт ЖК из JKSchema и ближайшее метро из первой станции', () => {
    expect(byId(parsed.apartments, 'CN-77-004410').project).toEqual({
      name: 'ЖК «Лобачевский»',
      developer: 'Компания «Раменки Девелопмент»',
      district: 'Раменки',
      metro: 'Мичуринский проспект',
      metroDistanceMin: 8,
      address: 'Москва, ЗАО, ул. Лобачевского, 120',
      url: 'https://novostroy.example.ru/jk/lobachevskiy',
    })
  })

  it('FlatType studio даёт ноль комнат, несмотря на RoomsCount = 1', () => {
    expect(byId(parsed.apartments, 'CN-77-004411').rooms).toBe(0)
  })

  it('переводит коды отделки в слова', () => {
    expect(byId(parsed.apartments, 'CN-77-004411').finishing).toBe('предчистовая')
    expect(byId(parsed.apartments, 'CN-77-009002').finishing).toBe('без отделки')
    expect(byId(parsed.apartments, 'CN-77-009003').finishing).toBe('черновая')
  })
})

describe('свой формат', () => {
  it('берёт соответствие полей из настроек фида', () => {
    const parsed = parseFeedXml(fixture('custom.xml'), { format: 'custom', fieldMapping: CUSTOM_MAPPING })
    expect(parsed.apartments).toHaveLength(3)

    const flat = byId(parsed.apartments, 'A-101')
    expect(flat).toMatchObject({
      price: 9_750_000,
      area: 41.7,
      kitchenArea: 10.2,
      rooms: 1,
      floor: 6,
      floorsTotal: 14,
      building: 'Корпус А',
      finishing: 'черновая',
      url: 'https://stroygrad.example.ru/lots/A-101',
    })
    expect(flat.deadline?.toISOString().slice(0, 10)).toBe('2027-06-30')
    expect(flat.project?.name).toBe('ЖК «Гагаринский»')
    expect(flat.project?.metroDistanceMin).toBe(7)
    expect(byId(parsed.apartments, 'A-102').rooms).toBe(0)
    expect(byId(parsed.apartments, 'B-330').price).toBe(14_900_000)
  })

  it('принимает короткую запись маппинга, без обёртки fields', () => {
    const parsed = parseFeedXml(fixture('custom.xml'), {
      format: 'custom',
      fieldMapping: { itemsPath: 'export.lots.lot', externalId: '@_id', price: 'cost', projectName: 'complex' },
    })
    expect(parsed.apartments).toHaveLength(3)
    expect(byId(parsed.apartments, 'A-101').area).toBeNull()
  })

  it('находит список лотов сам, если itemsPath не задан', () => {
    const parsed = parseFeedXml(fixture('custom.xml'), {
      format: 'custom',
      fieldMapping: { externalId: '@_id', price: 'cost' },
    })
    expect(parsed.apartments).toHaveLength(3)
  })

  it('требует маппинг, без него разбирать нечем', () => {
    expect(() => parseFeedXml(fixture('custom.xml'), { format: 'custom' })).toThrow(FeedMappingError)
    expect(() => parseFeedXml(fixture('custom.xml'), { format: 'custom', fieldMapping: { rooms: 'room_count' } })).toThrow(
      FeedMappingError,
    )
  })
})

describe('плохие фиды', () => {
  it('битый XML — понятная ошибка с местом поломки', () => {
    expect(() => parseFeedXml(fixture('broken.xml'), { format: 'yandex' })).toThrow(FeedParseError)
    try {
      parseFeedXml(fixture('broken.xml'), { format: 'yandex' })
    } catch (error) {
      expect((error as Error).message).toMatch(/не является правильным XML/i)
      expect((error as Error).message).toMatch(/строка \d+/)
    }
  })

  it('исправный XML не того формата — говорит, что это не выгрузка', () => {
    expect(() => parseFeedXml(fixture('not-a-feed.xml'), { format: 'yandex' })).toThrow(/не похоже на выгрузку/i)
  })

  it('выгрузка ЦИАН, названная фидом Яндекса, не разбирается молча', () => {
    expect(() => parseFeedXml(fixture('cian.xml'), { format: 'yandex' })).toThrow(FeedParseError)
  })

  it('пустой ответ — отдельная ошибка', () => {
    expect(() => parseFeedXml('   ', { format: 'yandex' })).toThrow(/пустой/i)
  })

  it('исправная, но пустая выгрузка — не ошибка', () => {
    const parsed = parseFeedXml(fixture('yandex-empty.xml'), { format: 'yandex' })
    expect(parsed.total).toBe(0)
    expect(parsed.apartments).toHaveLength(0)
  })
})

describe('фид с пропущенными полями', () => {
  const parsed = parseFeedXml(fixture('yandex-incomplete.xml'), { format: 'yandex' })

  it('пропускает лоты без идентификатора и без цены, оставляя причину', () => {
    expect(parsed.total).toBe(6)
    expect(parsed.apartments.map((flat) => flat.externalId)).toEqual(['OK-1', 'NO-PROJECT', 'OK-1'])

    expect(parsed.skipped).toEqual([
      { index: 2, externalId: null, reason: 'нет внешнего идентификатора лота' },
      { index: 3, externalId: 'NO-PRICE', reason: 'нет цены или цена не читается как число' },
      { index: 4, externalId: 'ZERO-PRICE', reason: 'нет цены или цена не читается как число' },
    ])
  })

  it('лот без ЖК всё равно попадает в базу', () => {
    const flat = byId(parsed.apartments, 'NO-PROJECT')
    expect(flat.project).toBeNull()
    expect(flat.rooms).toBe(0)
    expect(flat.area).toBeNull()
    expect(flat.pricePerM2).toBeNull()
  })

  it('вытягивает число из текстовых полей', () => {
    const flat = byId(parsed.apartments, 'OK-1')
    expect(flat.rooms).toBe(2)
    expect(flat.floorsTotal).toBe(17)
  })
})
