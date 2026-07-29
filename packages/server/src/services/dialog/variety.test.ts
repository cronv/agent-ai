import { describe, expect, it } from 'vitest'

import type { ApartmentCard } from './apartments.js'
import { describeVariety } from './variety.js'

/**
 * Чем отличаются показанные квартиры.
 *
 * Смысл этой функции — в одном: у модели должен быть готовый ответ на вопрос
 * «а чем они отличаются», иначе она придумывает отличия сама. Поэтому тесты
 * проверяют не формулировку целиком, а факты в ней: что названо одинаковым,
 * что — разным, и не появилось ли лишнего.
 */

function card(overrides: Partial<ApartmentCard> = {}): ApartmentCard {
  return {
    id: `a-${Math.random()}`,
    projectId: 'p1',
    projectName: 'Космос',
    developer: null,
    district: 'Домодедово',
    metro: null,
    metroDistanceMin: null,
    rooms: 0,
    planType: null,
    area: 29,
    livingArea: null,
    kitchenArea: null,
    floor: 8,
    floorsTotal: 17,
    price: 4_700_000,
    pricePerM2: null,
    building: null,
    section: null,
    finishing: 'без отделки',
    balcony: 'лоджия',
    windowView: null,
    bathroom: null,
    euroPlan: null,
    deadline: '2027-06-30',
    isReady: null,
    planImageUrl: null,
    photos: [],
    url: null,
    projectUrl: null,
    ...overrides,
  }
}

describe('describeVariety', () => {
  it('пять почти одинаковых студий: одинаковы всем, кроме этажа и цены', () => {
    const variety = describeVariety([
      card({ floor: 8, price: 4_700_000 }),
      card({ floor: 9, price: 4_720_000 }),
      card({ floor: 12, price: 4_800_000 }),
      card({ floor: 15, price: 4_900_000 }),
      card({ floor: 17, price: 5_100_000 }),
    ])

    expect(variety?.nearlyIdentical).toBe(true)
    expect(variety?.same).toContain('все в ЖК «Космос»')
    expect(variety?.same).toContain('все студии')
    expect(variety?.same).toContain('отделка у всех «без отделки»')
    expect(variety?.differs).toContain('этаж — с 8 по 17')
    expect(variety?.differs.join(' ')).toContain('цена')

    // Готовая фраза прямо запрещает то, чем модель заполняла пустоту.
    expect(variety?.hint).toContain('практически одинаковы')
    expect(variety?.hint).toContain('Не перечисляй их по одному')
    expect(variety?.hint).toContain('выдумка')
  })

  it('сданные дома описываются готовностью, а не сроком в прошлом', () => {
    const variety = describeVariety([
      card({ isReady: true, deadline: '2023-12-31', floor: 3 }),
      card({ isReady: true, deadline: '2023-12-31', floor: 9 }),
    ])

    expect(variety?.same).toContain('дома уже сданы, ключи сразу')
    expect(variety?.same).not.toContain('срок сдачи у всех один')
    expect(variety?.differs).not.toContain('разные сроки сдачи')
  })

  it('часть сдана, часть строится — это отличие, а не общее', () => {
    const variety = describeVariety([
      card({ isReady: true, deadline: '2023-12-31' }),
      card({ isReady: false, deadline: '2027-06-30' }),
    ])

    expect(variety?.differs).toContain('часть домов уже сдана, часть ещё строится')
  })

  it('разные ЖК и комнатности — это уже настоящий выбор, а не копии', () => {
    const variety = describeVariety([
      card({ projectName: 'Космос', rooms: 0, area: 29, price: 4_700_000 }),
      card({ projectName: 'Серебро', rooms: 2, area: 58, price: 9_400_000, finishing: 'чистовая' }),
    ])

    expect(variety?.nearlyIdentical).toBe(false)
    expect(variety?.differs.join(' ')).toContain('ЖК')
    expect(variety?.differs.join(' ')).toContain('комнатность')
    expect(variety?.differs.join(' ')).toContain('площадь')
    expect(variety?.hint).toContain('Не пересказывай карточки по пунктам')
  })

  it('площадь в пределах метра считается одинаковой: 28,9 и 29,4 — это один лот в разных корпусах', () => {
    const variety = describeVariety([card({ area: 28.9 }), card({ area: 29.4, floor: 10 })])

    expect(variety?.nearlyIdentical).toBe(true)
    expect(variety?.same.join(' ')).toContain('площадь у всех около 29')
  })

  it('одна квартира сравнивать не с чем', () => {
    expect(describeVariety([card()])).toBeNull()
    expect(describeVariety([])).toBeNull()
  })

  it('признак, известный не у всех, не выдаётся ни за общий, ни за отличие', () => {
    const variety = describeVariety([
      card({ floor: 5, finishing: 'без отделки', deadline: '2027-06-30' }),
      card({ floor: null, finishing: null, deadline: null }),
      card({ floor: null, finishing: null, deadline: null }),
    ])

    const said = [...(variety?.same ?? []), ...(variety?.differs ?? [])].join(' | ')
    expect(said).not.toContain('этаж')
    expect(said).not.toContain('отделка')
    expect(said).not.toContain('сроки сдачи')
    // И «практически одинаковыми» такая подборка не объявляется: про отделку
    // и срок у двух лотов не известно ничего.
    expect(variety?.nearlyIdentical).toBe(false)
  })

  it('без площадей подборка не считается одинаковой: сравнивать нечего', () => {
    const variety = describeVariety([card({ area: null }), card({ area: null })])

    expect(variety?.nearlyIdentical).toBe(false)
    expect(variety?.same.join(' ')).not.toContain('площадь')
  })

  it('лоты без комнатности описываются типом планировки, а не молчанием', () => {
    const variety = describeVariety([
      card({ rooms: null, planType: 'свободная планировка' }),
      card({ rooms: null, planType: 'свободная планировка', floor: 11 }),
    ])

    expect(variety?.same.join(' ')).toContain('свободная планировка')
  })
})
