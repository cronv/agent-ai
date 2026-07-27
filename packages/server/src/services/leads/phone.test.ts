import { describe, expect, it } from 'vitest'

import { formatPhone, normalizePhone, phoneSearchFragments } from './phone.js'

describe('normalizePhone', () => {
  it.each([
    ['+79123456789', '+79123456789'],
    ['89123456789', '+79123456789'],
    ['79123456789', '+79123456789'],
    ['9123456789', '+79123456789'],
    ['8 (912) 345-67-89', '+79123456789'],
    ['+7 912 345 67 89', '+79123456789'],
    ['  8-912-345-67-89  ', '+79123456789'],
    ['912.345.67.89', '+79123456789'],
    ['+7(912)3456789', '+79123456789'],
    ['007 912 345 67 89', '+79123456789'],
  ])('приводит %s к %s', (input, expected) => {
    const result = normalizePhone(input)
    expect(result).toEqual({ ok: true, phone: expected })
  })

  it.each([
    ['', 'пустая строка'],
    ['   ', 'одни пробелы'],
    ['телефон спросите у мамы', 'слова вместо номера'],
    ['1234', 'слишком коротко'],
    ['891234567890123', 'слишком длинно'],
    ['+1 202 555 0143', 'не российский номер'],
    ['912345678', 'цифр на одну меньше'],
    ['+7 912 345 67 89 доб 12', 'добавочный'],
  ])('отклоняет «%s» (%s) с понятной ошибкой', (input) => {
    const result = normalizePhone(input)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('ожидался отказ')
    expect(result.error).toMatch(/Телефон/u)
    expect(result.error).toMatch(/\+7 \(912\) 345-67-89/u)
  })

  it('отклоняет не строку', () => {
    expect(normalizePhone(undefined).ok).toBe(false)
    expect(normalizePhone(79123456789).ok).toBe(false)
  })
})

describe('formatPhone', () => {
  it('показывает номер человеку', () => {
    expect(formatPhone('+79123456789')).toBe('+7 (912) 345-67-89')
  })

  it('не трогает то, что не в каноническом виде', () => {
    expect(formatPhone('+380671234567')).toBe('+380671234567')
  })
})

describe('phoneSearchFragments', () => {
  it('ищет и по введённым цифрам, и по варианту без кода страны', () => {
    expect(phoneSearchFragments('8 (912) 345')).toEqual(['8912345', '912345'])
    expect(phoneSearchFragments('+7 9123')).toEqual(['79123', '9123'])
    expect(phoneSearchFragments('3456789')).toEqual(['3456789'])
  })

  it('игнорирует запрос без цифр или почти без них', () => {
    expect(phoneSearchFragments('Иван')).toEqual([])
    expect(phoneSearchFragments('12')).toEqual([])
  })
})
