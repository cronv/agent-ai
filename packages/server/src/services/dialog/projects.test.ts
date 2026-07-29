import { beforeEach, describe, expect, it } from 'vitest'

import { createApartment, createFeed, createProject } from '../../testing/catalog.js'
import { resetDatabase, testDb } from '../../testing/db.js'
import type { ApartmentCard } from './apartments.js'
import type { StoredToolCall } from './history.js'
import { collectProjectCandidates, resolveProjectLinks } from './projects.js'

/**
 * Когда под ответом появляется кнопка перехода на карточку ЖК.
 *
 * Решение принимается по фактам хода, а не спрашивается у модели, поэтому
 * проверяется оно без модели вовсе — обычной функцией. Главное, что здесь
 * защищается: кнопка не появляется на каждом сообщении и никогда не ведёт
 * в никуда.
 */

function call(name: string, input: unknown, result: unknown): StoredToolCall {
  return { id: `t-${name}`, name, input, result: JSON.stringify(result) }
}

function card(projectId: string | null): ApartmentCard {
  return {
    id: `a-${projectId ?? 'none'}-${Math.random()}`,
    projectId,
    projectName: 'ЖК «Космос»',
    developer: null,
    district: null,
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
    finishing: null,
    balcony: null,
    windowView: null,
    bathroom: null,
    euroPlan: null,
    deadline: null,
    isReady: null,
    planImageUrl: null,
    photos: [],
    url: null,
    projectUrl: null,
  }
}

describe('collectProjectCandidates', () => {
  it('спросили про конкретный ЖК — list_projects вернул один комплекс', () => {
    const found = collectProjectCandidates({
      toolCalls: [call('list_projects', { district: 'Домодедово' }, { found: 1, projects: [{ id: 'p1' }] })],
      apartments: [],
    })
    expect(found).toEqual(['p1'])
  })

  it('сравнивают два комплекса — кнопка на каждый', () => {
    const found = collectProjectCandidates({
      toolCalls: [call('list_projects', {}, { found: 2, projects: [{ id: 'p1' }, { id: 'p2' }] })],
      apartments: [],
    })
    expect(found).toEqual(['p1', 'p2'])
  })

  it('разговор про каталог вообще кнопки не даёт: семь ссылок — это меню', () => {
    const found = collectProjectCandidates({
      toolCalls: [
        call('list_projects', {}, { found: 7, projects: [1, 2, 3, 4, 5, 6, 7].map((n) => ({ id: `p${n}` })) }),
      ],
      apartments: [],
    })
    expect(found).toEqual([])
  })

  it('просят квартиры конкретного комплекса — search_apartments с project_ids', () => {
    const found = collectProjectCandidates({
      toolCalls: [call('search_apartments', { project_ids: ['p1'] }, { total: 12 })],
      apartments: [],
    })
    expect(found).toEqual(['p1'])
  })

  it('вся подборка из одного ЖК — тот же повод, даже если искали по району', () => {
    const found = collectProjectCandidates({
      toolCalls: [call('search_apartments', { district: 'Домодедово' }, { total: 25 })],
      apartments: [card('p1'), card('p1'), card('p1')],
    })
    expect(found).toEqual(['p1'])
  })

  it('подборка из разных ЖК повода не даёт', () => {
    const found = collectProjectCandidates({
      toolCalls: [call('search_apartments', {}, { total: 25 })],
      apartments: [card('p1'), card('p2'), card('p3')],
    })
    expect(found).toEqual([])
  })

  it('вопрос про условия конкретного ЖК: берётся разрешённый идентификатор, а не слово модели', () => {
    const found = collectProjectCandidates({
      // Модель кладёт в project_id название, сервер разрешает его в идентификатор.
      toolCalls: [call('search_knowledge', { query: 'сроки', project_id: 'Космос' }, { found: 2, project_id: 'p1' })],
      apartments: [],
    })
    expect(found).toEqual(['p1'])
  })

  it('ошибка инструмента поводом не считается', () => {
    const failed: StoredToolCall = {
      ...call('list_projects', {}, { found: 1, projects: [{ id: 'p1' }] }),
      isError: true,
    }
    expect(collectProjectCandidates({ toolCalls: [failed], apartments: [] })).toEqual([])
  })

  it('обычный разговор без инструментов кнопки не даёт', () => {
    expect(collectProjectCandidates({ toolCalls: [], apartments: [] })).toEqual([])
  })
})

describe('resolveProjectLinks', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('без адреса кнопки нет — битая ссылка хуже отсутствующей', async () => {
    const withUrl = await createProject({ name: 'ЖК «Космос»', url: 'https://ndv.ru/zhk/kosmos' })
    const without = await createProject({ name: 'ЖК «Берег»' })

    const links = await resolveProjectLinks(testDb, [withUrl.id, without.id])

    expect(links).toEqual([{ id: withUrl.id, name: 'ЖК «Космос»', url: 'https://ndv.ru/zhk/kosmos' }])
  })

  it('выключенный ЖК кнопки не получает: его нет в чате', async () => {
    const hidden = await createProject({ name: 'Снятый', url: 'https://ndv.ru/zhk/x', isActive: false })
    expect(await resolveProjectLinks(testDb, [hidden.id])).toEqual([])
  })

  it('ссылку, показанную в последних ответах, второй раз не даёт', async () => {
    const project = await createProject({ name: 'ЖК «Космос»', url: 'https://ndv.ru/zhk/kosmos' })
    expect(await resolveProjectLinks(testDb, [project.id], [project.id])).toEqual([])
  })

  it('квартиры ЖК живут своей жизнью и на кнопку не влияют', async () => {
    const feed = await createFeed()
    const project = await createProject({ name: 'ЖК «Космос»', url: 'https://ndv.ru/zhk/kosmos' })
    await createApartment({ feedId: feed.id, projectId: project.id })

    expect(await resolveProjectLinks(testDb, [project.id])).toHaveLength(1)
  })
})
