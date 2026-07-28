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
      imageUrl: null,
      description: null,
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
      imageUrl: null,
      description: null,
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

  it('фотографии объявления идут в галерею, а не в планировку', () => {
    const flat = byId(parsed.apartments, 'CN-77-004410')
    expect(flat.photos).toEqual([
      'https://novostroy.example.ru/photos/CN-77-004410-1.jpg',
      'https://novostroy.example.ru/photos/CN-77-004410-2.jpg',
    ])
    expect(flat.planImageUrl).toBe('https://novostroy.example.ru/plans/CN-77-004410.png')
  })
})

describe('ЦИАН — боевая выгрузка вторички NDV', () => {
  const parsed = parseFeedXml(fixture('cian-ndv.xml'), { format: 'cian' })

  it('разбирает все объекты', () => {
    expect(parsed.total).toBe(6)
    expect(parsed.apartments).toHaveLength(6)
    expect(parsed.skipped).toHaveLength(0)
  })

  it('код 9 — это студия, а не девятикомнатная квартира', () => {
    const studio = byId(parsed.apartments, 'B76BD12A-87A1-4A15-B067-7592856CFFB7')
    expect(studio.rooms).toBe(0)
    expect(studio.planType).toBeNull()
    expect(studio.area).toBe(29.4)
  })

  it('коды 1–5 — это комнатность как есть', () => {
    expect(byId(parsed.apartments, '920BDFA3-446F-4231-93D8-91694F14099F').rooms).toBe(1)
    expect(byId(parsed.apartments, 'DDA19693-A2A9-4D74-B2D1-046ABB2B9B6B').rooms).toBe(5)
  })

  it('код 6 — многокомнатная, без числа комнат', () => {
    const flat = byId(parsed.apartments, 'C07ECBE3-1F1D-46A7-AE39-A188B7B59A85')
    // Шестёрка означает «больше пяти», а не «шесть»: числом её записать нельзя,
    // иначе лот всплывёт в поиске шестикомнатных.
    expect(flat.rooms).toBeNull()
    expect(flat.planType).toBe('многокомнатная')
  })

  it('код 7 — свободная планировка, без числа комнат', () => {
    const flat = byId(parsed.apartments, 'FREE-PLAN-NO-PHOTOS')
    expect(flat.rooms).toBeNull()
    expect(flat.planType).toBe('свободная планировка')
  })

  it('FlatRoomsCount главнее RoomsCount', () => {
    // Продажа комнаты: RoomsCount — это комнаты всей квартиры, а не лота.
    // Оба поля здесь совпадают, но приоритет должен быть у FlatRoomsCount —
    // он заполнен у всех 95 объектов выгрузки, RoomsCount у двух.
    const room = byId(parsed.apartments, '04BED09F-DC03-4474-AE23-2FCA441AED4A')
    expect(room.rooms).toBe(2)
    expect(room.raw['RoomsCount']).toBe('2')
    expect(room.raw['FlatRoomsCount']).toBe('2')
  })

  it('забирает всю галерею, но не больше десяти снимков', () => {
    const gallery = byId(parsed.apartments, '920BDFA3-446F-4231-93D8-91694F14099F').photos
    expect(gallery).toHaveLength(10)
    expect(new Set(gallery).size).toBe(10)
    for (const url of gallery) expect(url).toMatch(/^https:\/\/omut\.ndv\.ru\/file\//)
    expect(gallery[0]).toBe(
      'https://omut.ndv.ru/file/6C753A82-D545-4DA9-A4A8-536BE57DAA26/watermark-f79d3-m30/IMG_20260326_175655.png',
    )
  })

  it('объявление без фотографий получает пустую галерею, а не выдумку', () => {
    expect(byId(parsed.apartments, 'FREE-PLAN-NO-PHOTOS').photos).toEqual([])
  })

  it('без LayoutPhoto планировки нет — первый снимок за неё не выдаётся', () => {
    // Ровно тот дефект, из-за которого клиент видел фотографию кухни
    // с подписью «планировка».
    const flat = byId(parsed.apartments, 'C07ECBE3-1F1D-46A7-AE39-A188B7B59A85')
    expect(flat.planImageUrl).toBeNull()
    expect(flat.photos.length).toBeGreaterThan(0)
  })

  it('LayoutPhoto — это и есть планировка, и она не попадает в галерею', () => {
    const studio = byId(parsed.apartments, 'B76BD12A-87A1-4A15-B067-7592856CFFB7')
    expect(studio.planImageUrl).toBe('https://omut.ndv.ru/file/PLAN-B76BD12A/plan.png')
    expect(studio.photos).toHaveLength(3)
    expect(studio.photos).not.toContain(studio.planImageUrl)
  })

  it('берёт ЖК из JKSchema и срок сдачи из корпуса', () => {
    const studio = byId(parsed.apartments, 'B76BD12A-87A1-4A15-B067-7592856CFFB7')
    expect(studio.project?.name).toBe('Куркино 15')
    expect(studio.deadline?.toISOString().slice(0, 10)).toBe('2026-09-30')
    expect(studio.finishing).toBe('черновая')
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

describe('ДомКлик — многокорпусный ЖК', () => {
  const parsed = parseFeedXml(fixture('domclick-multi.xml'), { format: 'domclick' })

  it('собирает лоты из всех корпусов', () => {
    expect(parsed.total).toBe(7)
    expect(parsed.apartments).toHaveLength(7)
    expect(parsed.skipped).toHaveLength(0)
  })

  it('разбирает лот целиком, вместе с полями корпуса', () => {
    const flat = byId(parsed.apartments, '5121530')
    expect(flat).toMatchObject({
      externalId: '5121530',
      price: 14_562_044,
      rooms: 2,
      area: 72.27,
      kitchenArea: 23.28,
      livingArea: 31.55,
      floor: 1,
      // Этажность лежит на корпусе, а не на лоте.
      floorsTotal: 5,
      building: '5',
      finishing: 'без отделки',
      balcony: 'нет',
      windowView: 'во двор',
      bathroom: 'раздельный',
      euroPlan: false,
      planImageUrl: 'https://omut.ndv.ru/file/E658FFBA-7277-44F5-A879-1B658A07E298/k5-s1-et1-2.png',
    })
    expect(flat.pricePerM2).toBe(201_495)
  })

  it('складывает срок сдачи из года и квартала готовности корпуса', () => {
    // built_year 2027 + ready_quarter 1 → последний день первого квартала.
    expect(byId(parsed.apartments, '5121530').deadline?.toISOString().slice(0, 10)).toBe('2027-03-31')
  })

  it('лоты разных корпусов получают свой номер корпуса', () => {
    expect(byId(parsed.apartments, '5459177').building).toBe('5')
    expect(byId(parsed.apartments, '5121438').building).toBe('6')
  })

  it('нулевая комнатность — это студия, а не пустое значение', () => {
    const studio = byId(parsed.apartments, '5121438')
    expect(studio.rooms).toBe(0)
    expect(byId(parsed.apartments, '5121449').rooms).toBe(0)
    // Комнатность остальных не пострадала.
    expect(parsed.apartments.map((flat) => flat.rooms)).toEqual([2, 1, 3, 0, 0, 1, 2])
  })

  it('планировка есть у каждого лота', () => {
    for (const flat of parsed.apartments) {
      expect(flat.planImageUrl).toMatch(/^https:\/\/omut\.ndv\.ru\//)
    }
  })

  it('заполняет ЖК полями комплекса — одинаково для всех лотов', () => {
    const project = byId(parsed.apartments, '5121438').project
    expect(project).toMatchObject({
      name: 'ЖК «Мишино-2»',
      developer: 'НДВ Супермаркет недвижимости',
      address: 'Химки городской округ. ул. Озерная, ЖК Мишино-2, корп. 5, 6, 7, 8, 9, 10',
      // Отдельного тега с районом в выгрузке нет — он вычислен из адреса.
      district: 'Химки',
      imageUrl:
        'https://exchange.novostroy-m.ru/images/novos/1600x1200_without_watermark/8ee9305058d91e0f006aa0cb9698a5b7.jpg',
    })
    expect(project?.description).toMatch(/^ЖК Мишино-2 располагается в городе Химки/)
    expect(new Set(parsed.apartments.map((flat) => flat.project?.name))).toEqual(new Set(['ЖК «Мишино-2»']))
  })

  it('кладёт в raw и сам лот, и выжимки корпуса с комплексом', () => {
    const raw = byId(parsed.apartments, '5121530').raw
    expect(raw['flat_id']).toBe('5121530')
    expect(raw['_building']).toMatchObject({ name: '5', floors: '5', building_type: 'кирпично-монолитный' })
    expect(raw['_complex']).toMatchObject({ id: '3869', name: 'ЖК «Мишино-2»' })
  })
})

describe('ДомКлик — однокорпусный ЖК', () => {
  const parsed = parseFeedXml(fixture('domclick-single.xml'), { format: 'domclick' })

  it('разбирается так же, как многокорпусный', () => {
    expect(parsed.apartments).toHaveLength(4)
    expect(parsed.skipped).toHaveLength(0)
    expect(new Set(parsed.apartments.map((flat) => flat.building))).toEqual(new Set(['1']))
    expect(byId(parsed.apartments, '6325593').rooms).toBe(0)
    expect(byId(parsed.apartments, '6325593').floorsTotal).toBe(17)
    expect(byId(parsed.apartments, '6325593').deadline?.toISOString().slice(0, 10)).toBe('2026-09-30')
    expect(parsed.apartments[0]?.project?.name).toBe('ЖК «Красная горка» (Подольск)')
  })

  it('район берётся из уточнения в названии ЖК', () => {
    expect(parsed.apartments[0]?.project?.district).toBe('Подольск')
  })
})

describe('ДомКлик — негодные лоты', () => {
  const parsed = parseFeedXml(fixture('domclick-incomplete.xml'), { format: 'domclick' })

  it('пропускает лоты без цены и без идентификатора, оставляя причину', () => {
    expect(parsed.total).toBe(6)
    expect(parsed.apartments.map((flat) => flat.externalId)).toEqual(['DK-OK-1', 'DK-OK-2', 'DK-OK-2'])
    expect(parsed.skipped).toEqual([
      { index: 2, externalId: 'DK-NO-PRICE', reason: 'нет цены или цена не читается как число' },
      { index: 3, externalId: 'DK-ZERO-PRICE', reason: 'нет цены или цена не читается как число' },
      { index: 4, externalId: null, reason: 'нет внешнего идентификатора лота' },
    ])
  })

  it('корпус без квартир не ломает разбор', () => {
    expect(byId(parsed.apartments, 'DK-OK-2').building).toBe('3')
    expect(byId(parsed.apartments, 'DK-OK-2').deadline?.toISOString().slice(0, 10)).toBe('2024-12-31')
  })

  it('цена с пробелами читается как число', () => {
    expect(byId(parsed.apartments, 'DK-OK-1').price).toBe(6_340_000)
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

  it('выгрузка Яндекса, названная фидом ДомКлик, не разбирается молча', () => {
    expect(() => parseFeedXml(fixture('yandex-realty.xml'), { format: 'domclick' })).toThrow(/не похоже на выгрузку/i)
  })

  it('битый XML в формате ДомКлик — та же понятная ошибка', () => {
    expect(() => parseFeedXml(fixture('broken.xml'), { format: 'domclick' })).toThrow(/не является правильным XML/i)
  })

  it('выгрузка ДомКлик без единого корпуса — не ошибка, а пустой фид', () => {
    const parsed = parseFeedXml('<?xml version="1.0"?><complexes></complexes>', { format: 'domclick' })
    expect(parsed.total).toBe(0)
    expect(parsed.apartments).toHaveLength(0)
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
