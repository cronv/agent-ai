import { describe, expect, it } from 'vitest'

import {
  computePricePerM2,
  isStudio,
  normalizeFinishing,
  normalizeText,
  normalizeUrl,
  parseArea,
  parseBoolean,
  parseDate,
  parseInteger,
  parseNumber,
  parsePrice,
  parseQuarter,
  parseReadiness,
  parseRooms,
  parseRoomsCode,
  parseYear,
  quarterEndDate,
  toText,
} from './normalize.js'

describe('toText', () => {
  it('достаёт значение из тега с атрибутами', () => {
    expect(toText({ '#text': '62.4', '@_unit': 'кв. м' })).toBe('62.4')
  })

  it('берёт первое непустое значение из повторяющихся тегов', () => {
    expect(toText(['', '  ', 'https://example.ru/plan.png'])).toBe('https://example.ru/plan.png')
  })

  it('пустую строку считает отсутствием значения', () => {
    expect(toText('   ')).toBeNull()
    expect(toText(undefined)).toBeNull()
    expect(toText({})).toBeNull()
  })
})

describe('parseNumber', () => {
  it('читает цену с пробелами, включая неразрывные', () => {
    expect(parseNumber('18 450 000')).toBe(18_450_000)
    expect(parseNumber('18 450 000')).toBe(18_450_000)
    expect(parseNumber('18 450 000 ₽')).toBe(18_450_000)
  })

  it('читает сокращения «млн» и «тыс»', () => {
    expect(parseNumber('12,5 млн')).toBe(12_500_000)
    expect(parseNumber('12.5 млн ₽')).toBe(12_500_000)
    expect(parseNumber('1,2 млрд')).toBe(1_200_000_000)
    expect(parseNumber('850 тыс')).toBe(850_000)
  })

  it('различает запятую-разделитель тысяч и запятую-дробную часть', () => {
    expect(parseNumber('12,500,000')).toBe(12_500_000)
    expect(parseNumber('62,4')).toBe(62.4)
    expect(parseNumber('18450000,50')).toBe(18_450_000.5)
  })

  it('не спотыкается о единицы измерения с точкой', () => {
    expect(parseNumber('62,4 кв. м')).toBe(62.4)
    expect(parseNumber('17 этажей')).toBe(17)
  })

  it('возвращает null там, где числа нет', () => {
    expect(parseNumber('по запросу')).toBeNull()
    expect(parseNumber('')).toBeNull()
    expect(parseNumber(null)).toBeNull()
  })
})

describe('parsePrice и parseArea', () => {
  it('отбрасывают ноль и отрицательные значения', () => {
    expect(parsePrice('0')).toBeNull()
    expect(parsePrice('-100')).toBeNull()
    expect(parseArea('0')).toBeNull()
  })

  it('отбрасывают заведомо неправдоподобную площадь', () => {
    expect(parseArea('624000')).toBeNull()
    expect(parseArea('62,4')).toBe(62.4)
  })
})

describe('parseRooms', () => {
  it('студию считает нулём комнат', () => {
    expect(parseRooms('студия')).toBe(0)
    expect(parseRooms('Студия')).toBe(0)
    expect(parseRooms('studio')).toBe(0)
  })

  it('читает комнатность в любой записи', () => {
    expect(parseRooms('1-комнатная')).toBe(1)
    expect(parseRooms('1К')).toBe(1)
    expect(parseRooms('1')).toBe(1)
    expect(parseRooms(3)).toBe(3)
  })

  it('свободную планировку оставляет неизвестной', () => {
    expect(parseRooms('свободная планировка')).toBeNull()
    expect(parseRooms('')).toBeNull()
  })
})

describe('parseRoomsCode', () => {
  it('код 9 — это студия, а не девять комнат', () => {
    expect(parseRoomsCode('9')).toEqual({ rooms: 0, planType: null })
  })

  it('коды 1–5 — обычная комнатность', () => {
    expect(parseRoomsCode('1')).toEqual({ rooms: 1, planType: null })
    expect(parseRoomsCode(5)).toEqual({ rooms: 5, planType: null })
  })

  it('коды 6 и 7 не дают числа комнат — только тип планировки', () => {
    expect(parseRoomsCode('6')).toEqual({ rooms: null, planType: 'многокомнатная' })
    expect(parseRoomsCode('7')).toEqual({ rooms: null, planType: 'свободная планировка' })
  })

  it('пустое значение означает «кода нет» — комнатность возьмут из другого поля', () => {
    expect(parseRoomsCode('')).toBeNull()
    expect(parseRoomsCode(undefined)).toBeNull()
    expect(parseRoomsCode('нет данных')).toBeNull()
  })

  it('кода вне таблицы не выдумывает комнатность', () => {
    expect(parseRoomsCode('8')).toEqual({ rooms: null, planType: null })
    expect(parseRoomsCode('12')).toEqual({ rooms: null, planType: null })
  })
})

describe('isStudio', () => {
  it('понимает и флаг Яндекса, и тип квартиры ЦИАН', () => {
    expect(isStudio('true')).toBe(true)
    expect(isStudio('да')).toBe(true)
    expect(isStudio('studio')).toBe(true)
    expect(isStudio('false')).toBe(false)
    expect(isStudio('rooms')).toBe(false)
    expect(isStudio(undefined)).toBe(false)
  })
})

describe('parseInteger, parseBoolean, parseYear, parseQuarter', () => {
  it('округляет дробные этажи и минуты', () => {
    expect(parseInteger('7')).toBe(7)
    expect(parseInteger('11,4')).toBe(11)
    expect(parseInteger('мусор')).toBeNull()
  })

  it('читает да/нет по-русски и по-английски', () => {
    expect(parseBoolean('да')).toBe(true)
    expect(parseBoolean('True')).toBe(true)
    expect(parseBoolean('нет')).toBe(false)
    expect(parseBoolean('возможно')).toBeNull()
  })

  it('читает год и квартал словами, цифрами и римскими', () => {
    expect(parseYear('2027')).toBe(2027)
    expect(parseYear('2027 г.')).toBe(2027)
    expect(parseYear('12')).toBeNull()
    expect(parseQuarter('second')).toBe(2)
    expect(parseQuarter('IV')).toBe(4)
    expect(parseQuarter('3')).toBe(3)
    expect(parseQuarter('нет')).toBeNull()
  })
})

describe('parseReadiness', () => {
  it('читает готовность и словом, и числом: у ДомКлика она записана двумя способами', () => {
    expect(parseReadiness('ready')).toBe(true)
    expect(parseReadiness('1')).toBe(true)
    expect(parseReadiness('Сдан')).toBe(true)
    expect(parseReadiness('построен')).toBe(true)
    expect(parseReadiness('unfinished')).toBe(false)
    expect(parseReadiness('0')).toBe(false)
    expect(parseReadiness('строится')).toBe(false)
  })

  it('молчание выгрузки — это «неизвестно», а не «строится»', () => {
    // Иначе форматы без такого поля объявили бы весь каталог стройкой.
    expect(parseReadiness(null)).toBeNull()
    expect(parseReadiness('')).toBeNull()
    expect(parseReadiness('скоро')).toBeNull()
  })
})

describe('quarterEndDate и parseDate', () => {
  it('срок сдачи — последний день квартала', () => {
    expect(quarterEndDate(2027, 2)?.toISOString().slice(0, 10)).toBe('2027-06-30')
    expect(quarterEndDate(2026, 4)?.toISOString().slice(0, 10)).toBe('2026-12-31')
  })

  it('без квартала берётся конец года', () => {
    expect(quarterEndDate(2027, null)?.toISOString().slice(0, 10)).toBe('2027-12-31')
  })

  it('читает дату в разных записях', () => {
    expect(parseDate('2027-06-30')?.toISOString().slice(0, 10)).toBe('2027-06-30')
    expect(parseDate('30.06.2027')?.toISOString().slice(0, 10)).toBe('2027-06-30')
    expect(parseDate('2 кв. 2027')?.toISOString().slice(0, 10)).toBe('2027-06-30')
    expect(parseDate('IV квартал 2026')?.toISOString().slice(0, 10)).toBe('2026-12-31')
    expect(parseDate('скоро')).toBeNull()
  })
})

describe('normalizeFinishing', () => {
  it('переводит коды ЦИАН в слова', () => {
    expect(normalizeFinishing('without')).toBe('без отделки')
    expect(normalizeFinishing('fine')).toBe('чистовая')
    expect(normalizeFinishing('preFine')).toBe('предчистовая')
    expect(normalizeFinishing('rough')).toBe('черновая')
  })

  it('русские значения Яндекса оставляет как есть', () => {
    expect(normalizeFinishing('дизайнерский ремонт')).toBe('дизайнерская')
    expect(normalizeFinishing('под ключ')).toBe('чистовая')
    expect(normalizeFinishing('современный стиль')).toBe('современный стиль')
  })

  it('«нет» в графе отделки означает её отсутствие — так пишет ДомКлик', () => {
    expect(normalizeFinishing('нет')).toBe('без отделки')
    expect(normalizeFinishing('отсутствует')).toBe('без отделки')
    // «нет» как часть фразы про что-то другое трогать не надо.
    expect(normalizeFinishing('нет данных о ремонте')).toBe('нет данных о ремонте')
  })
})

describe('normalizeText и normalizeUrl', () => {
  it('схлопывает пробелы и обрезает длинные строки', () => {
    expect(normalizeText('  ЖК   «Северный   парк» ')).toBe('ЖК «Северный парк»')
    expect(normalizeText('a'.repeat(300), 10)).toHaveLength(10)
  })

  it('пропускает только http и https', () => {
    expect(normalizeUrl('https://example.ru/plan.png')).toBe('https://example.ru/plan.png')
    expect(normalizeUrl('javascript:alert(1)')).toBeNull()
    expect(normalizeUrl('/plans/1.png')).toBeNull()
  })
})

describe('computePricePerM2', () => {
  it('считает цену за метр и округляет до рубля', () => {
    expect(computePricePerM2(18_450_000, 62.4)).toBe(295_673)
  })

  it('без площади не считает', () => {
    expect(computePricePerM2(18_450_000, null)).toBeNull()
    expect(computePricePerM2(null, 62.4)).toBeNull()
  })
})
