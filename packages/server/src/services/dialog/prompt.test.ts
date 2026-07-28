import { describe, expect, it } from 'vitest'

import type { CatalogLocation, PlaceRooms } from './apartments.js'
import { buildSystemPrompt, type PromptContext } from './prompt.js'

/**
 * Проверяется ровно одно: попадает ли в системный контекст перечень локаций
 * и в каком виде. Модель называет только то, что видит, поэтому «видит»
 * здесь — это тестируемое свойство, а не оформление.
 */

function rooms(...items: [number, number, number][]): PlaceRooms[] {
  return items.map(([count, priceMin, index]) => ({ rooms: index, count, priceMin }))
}

function place(name: string, overrides: Partial<CatalogLocation> = {}): CatalogLocation {
  return {
    name,
    apartmentCount: 10,
    rooms: [
      { rooms: 1, count: 6, priceMin: 5_000_000 },
      { rooms: 2, count: 4, priceMin: 9_000_000 },
    ],
    priceMin: 5_000_000,
    priceMax: 9_000_000,
    ...overrides,
  }
}

function build(overrides: Partial<PromptContext> = {}): string {
  return buildSystemPrompt({
    basePrompt: 'Ты консультант.',
    today: new Date(Date.UTC(2026, 6, 27)),
    projectCount: 7,
    locations: [],
    hasKnowledge: false,
    visitorMessages: 0,
    apartmentsShown: false,
    messagesSinceApartments: 0,
    contactThreshold: 2,
    leadCaptured: false,
    ...overrides,
  })
}

describe('buildSystemPrompt: локации каталога', () => {
  it('перечисляет локации с количеством, комнатностями и вилкой цен', () => {
    const system = build({
      locations: [
        place('Химки', {
          apartmentCount: 183,
          rooms: rooms([7, 6_384_000, 0], [139, 6_968_583, 1], [30, 10_844_500, 2], [7, 14_068_112, 3]),
          priceMin: 6_384_000,
          priceMax: 20_598_776,
        }),
        place('Звенигород', {
          apartmentCount: 35,
          rooms: rooms([35, 5_005_200, 1]),
          priceMin: 5_005_200,
          priceMax: 5_903_647,
        }),
      ],
    })

    expect(system).toContain('# Локации каталога')
    expect(system).toContain(
      '- Химки — 183 квартиры: студии 7 шт. от 6,4 млн ₽; однокомнатные 139 шт. от 7,0 млн ₽; ' +
        'двухкомнатные 30 шт. от 10,8 млн ₽; трёхкомнатные 7 шт. от 14,1 млн ₽',
    )
    expect(system).toContain('- Звенигород — 35 квартир: однокомнатные 35 шт. от 5,0 млн ₽')
    expect(system).toContain('Другой локации у нас нет')
    expect(system).toContain('Самая дешёвая квартира во всём каталоге стоит 5,0 млн ₽')
    expect(system).toContain('Поиск он не заменяет никогда')
    expect(system).toContain('а не названия ЖК')
  })

  it('на пустом каталоге раздела нет — перечислять нечего', () => {
    expect(build({ locations: [] })).not.toContain('# Локации каталога')
  })

  it('при большом каталоге подробностей столько же, а имена перечислены все', () => {
    const many = Array.from({ length: 30 }, (_, index) => place(`Район ${index + 1}`, { apartmentCount: 30 - index }))

    const system = build({ locations: many })
    const detailed = system.split('\n').filter((line) => line.includes(' квартир') && line.startsWith('- '))

    expect(detailed).toHaveLength(12)
    expect(system).toContain('- и ещё: Район 13, Район 14')
    expect(system).toContain('Район 30')
  })

  it('очень длинный список не уходит целиком', () => {
    const many = Array.from({ length: 200 }, (_, index) => place(`Район ${index + 1}`))

    const system = build({ locations: many })

    expect(system).toContain('и ещё 188 локаций')
    expect(system).toContain('наизусть не додумывай')
    expect(system).not.toContain('Район 200')
  })

  it('прежние части контекста на месте', () => {
    const system = build({ locations: [place('Химки')] })

    expect(system).toContain('Ты консультант.')
    expect(system).toContain('27 июля 2026 года')
    expect(system).toContain('В каталоге 7 активных ЖК')
    expect(system).toContain('Подборку ты ещё не показывал')
  })
})
