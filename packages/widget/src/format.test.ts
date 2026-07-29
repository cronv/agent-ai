import { describe, expect, it } from 'vitest'

import { cardHref, cardImages, formatTitle } from './format.ts'
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

describe('cardHref', () => {
  it('своя страница лота главнее карточки ЖК', () => {
    const href = cardHref(card({ url: 'https://ndv.ru/flat/1', projectUrl: 'https://ndv.ru/zhk/kosmos' }))
    expect(href).toBe('https://ndv.ru/flat/1')
  })

  it('без адреса лота ведёт на карточку ЖК: у ДомКлика адреса квартиры нет вовсе', () => {
    expect(cardHref(card({ projectUrl: 'https://ndv.ru/zhk/kosmos' }))).toBe('https://ndv.ru/zhk/kosmos')
  })

  it('без обоих адресов карточка остаётся некликабельной', () => {
    expect(cardHref(card())).toBeNull()
    expect(cardHref(card({ url: '  ', projectUrl: '' }))).toBeNull()
  })

  it('переписка, сохранённая до появления ссылок, не ломает карточку', () => {
    const old = card({ url: null })
    delete (old as { projectUrl?: string | null }).projectUrl
    expect(cardHref(old)).toBeNull()
  })

  it('ведёт только по http и https: javascript: в href — это чужой код на странице', () => {
    expect(cardHref(card({ url: 'javascript:alert(1)', projectUrl: 'https://ndv.ru/zhk/kosmos' }))).toBe(
      'https://ndv.ru/zhk/kosmos',
    )
    expect(cardHref(card({ url: 'data:text/html,<script>', projectUrl: null }))).toBeNull()
    expect(cardHref(card({ url: '/flat/1', projectUrl: null }))).toBeNull()
  })
})
