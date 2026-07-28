import { describe, expect, it } from 'vitest'

import { cardImages, formatTitle } from './format.ts'
import type { ApartmentCard } from './types.ts'

/**
 * Как карточка выбирает картинку и заголовок.
 *
 * Это правило дороже, чем кажется: планировка — то, по чему человек листает
 * ленту, и подменять её первым попавшимся снимком нельзя. Обратное тоже верно:
 * у вторички планировок не бывает вовсе, и карточка без картинки — не витрина.
 */

function card(overrides: Partial<ApartmentCard> = {}): ApartmentCard {
  return {
    id: 'apt-1',
    projectId: null,
    projectName: null,
    developer: null,
    district: null,
    metro: null,
    metroDistanceMin: null,
    rooms: 2,
    area: 54.3,
    livingArea: null,
    kitchenArea: null,
    floor: null,
    floorsTotal: null,
    price: 12_000_000,
    pricePerM2: null,
    building: null,
    section: null,
    finishing: null,
    deadline: null,
    planImageUrl: null,
    url: null,
    ...overrides,
  }
}

describe('cardImages', () => {
  it('планировка главнее фотографий', () => {
    const images = cardImages(card({ planImageUrl: 'https://cdn.ru/plan.png', photos: ['https://cdn.ru/1.jpg'] }))
    expect(images).toEqual(['https://cdn.ru/plan.png'])
  })

  it('без планировки показываются фотографии, все', () => {
    const photos = ['https://cdn.ru/1.jpg', 'https://cdn.ru/2.jpg', 'https://cdn.ru/3.jpg']
    expect(cardImages(card({ photos }))).toEqual(photos)
  })

  it('без картинок вовсе — пустой список, дальше рисуется заглушка', () => {
    expect(cardImages(card())).toEqual([])
    expect(cardImages(card({ photos: [] }))).toEqual([])
  })

  it('переписка, сохранённая до появления галереи, не ломает карточку', () => {
    const old = card({ planImageUrl: 'https://cdn.ru/plan.png' })
    delete (old as { photos?: string[] }).photos
    expect(cardImages(old)).toEqual(['https://cdn.ru/plan.png'])
  })
})

describe('formatTitle', () => {
  /** Intl ставит в числах неразрывный пробел — сравнивать надо по нему. */
  function title(overrides: Partial<ApartmentCard>): string {
    return formatTitle(card(overrides)).replace(/\u00a0|\u202f/g, ' ')
  }

  it('обычная комнатность', () => {
    expect(title({})).toBe('2-комн. · 54,3 м²')
    expect(title({ rooms: 0 })).toBe('Студия · 54,3 м²')
  })

  it('без комнатности заголовок берёт тип планировки', () => {
    expect(title({ rooms: null, planType: 'свободная планировка' })).toBe('Свободная планировка · 54,3 м²')
    expect(title({ rooms: null, planType: 'многокомнатная', area: 245 })).toBe('Многокомнатная · 245 м²')
  })

  it('без комнатности и без типа остаётся одна площадь', () => {
    expect(title({ rooms: null })).toBe('54,3 м²')
  })
})
