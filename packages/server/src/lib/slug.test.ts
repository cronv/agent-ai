import { describe, expect, it } from 'vitest'

import { slugify, uniqueSlug } from './slug.js'

describe('slugify', () => {
  it('переводит русское название в латиницу', () => {
    expect(slugify('ЖК «Северный парк»')).toBe('zhk-severnyy-park')
    expect(slugify('ЖК «Лобачевский»')).toBe('zhk-lobachevskiy')
    expect(slugify('Квартал «Ясный»')).toBe('kvartal-yasnyy')
  })

  it('не превращает «й» в «i» из-за нормализации юникода', () => {
    expect(slugify('Гагаринский')).toBe('gagarinskiy')
    expect(slugify('Ёлки')).toBe('elki')
  })

  it('схлопывает знаки препинания в один дефис и обрезает края', () => {
    expect(slugify('  ЖК №1 — «Дом у реки» ')).toBe('zhk-1-dom-u-reki')
    expect(slugify('A & B')).toBe('a-b')
  })

  it('латиницу с диакритикой приводит к простым буквам', () => {
    expect(slugify('Café Résidence')).toBe('cafe-residence')
  })

  it('из названия без единой пригодной буквы делает запасной slug', () => {
    expect(slugify('🏠🏠')).toBe('obekt')
  })
})

describe('uniqueSlug', () => {
  it('отдаёт базовый вариант, если он свободен', async () => {
    expect(await uniqueSlug('ЖК «Северный парк»', async () => false)).toBe('zhk-severnyy-park')
  })

  it('добавляет номер, пока не найдёт свободный', async () => {
    const taken = new Set(['zhk-severnyy-park', 'zhk-severnyy-park-2'])
    expect(await uniqueSlug('ЖК «Северный парк»', async (slug) => taken.has(slug))).toBe('zhk-severnyy-park-3')
  })
})
