import type { Prisma } from '@prisma/client'
import type { FastifyInstance } from 'fastify'
import { beforeAll, afterAll, beforeEach, describe, expect, it } from 'vitest'

import { buildApp } from '../../app.js'
import { env } from '../../config/env.js'
import { slugify } from '../../lib/slug.js'
import { ADMIN_SESSION_COOKIE } from '../../plugins/auth.js'
import { resetDatabase, testDb } from '../../testing/db.js'
import { resetLoginAttempts } from './auth.routes.js'

/**
 * Маршруты жилых комплексов: реальная база, реальные квартиры.
 *
 * Отдельно проверяется главное обещание переключателя: выключенный ЖК
 * исчезает из выдачи ассистента. Инструмент `search_apartments` (тикет 05)
 * делается параллельно, поэтому проверка идёт на уровне того самого условия
 * запроса, которым он обязан пользоваться по спеке, — «только активные
 * квартиры активных ЖК». Когда инструмент появится, тест ниже стоит
 * перенаправить прямо на него.
 */

interface ProjectViewJson {
  id: string
  name: string
  slug: string
  developer: string | null
  district: string | null
  metro: string | null
  metroDistanceMin: number | null
  address: string | null
  deadline: string | null
  finishing: string | null
  description: string | null
  url: string | null
  imageUrl: string | null
  category: string
  categoryLabel: string
  isActive: boolean
  apartments: { active: number; total: number }
  price: { min: number; max: number } | null
  feeds: { id: string; name: string; isActive: boolean; projectCount: number }[]
}

interface CategoryJson {
  value: string
  label: string
  count: number
}

interface ApartmentsJson {
  apartments: { id: string; rooms: number | null; price: number; isActive: boolean }[]
  total: number
  facets: {
    rooms: { rooms: number | null; count: number }[]
    price: { min: number; max: number } | null
  }
}

/** Условие из спеки: ассистент показывает только активные лоты активных ЖК. */
const VISIBLE_TO_ASSISTANT: Prisma.ApartmentWhereInput = {
  isActive: true,
  project: { isActive: true },
}

describe('маршруты жилых комплексов', () => {
  let app: FastifyInstance
  let cookie: string

  beforeAll(async () => {
    app = await buildApp({ prisma: testDb, serveStatic: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await resetDatabase()
    resetLoginAttempts()
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: env.adminUsername, password: env.adminPassword },
    })
    const issued = login.cookies.find((item) => item.name === ADMIN_SESSION_COOKIE)
    cookie = `${ADMIN_SESSION_COOKIE}=${String(issued?.value)}`
  })

  /** ЖК с квартирами: цены и комнатность задаются списком. */
  async function seedProject(
    name: string,
    lots: { rooms: number; price: number; isActive?: boolean }[] = [],
  ): Promise<string> {
    const project = await testDb.project.create({ data: { name, slug: slugify(name) } })
    if (lots.length === 0) return project.id

    const feed = await testDb.feed.create({
      data: { name: `Фид ${name}`, url: `https://example.test/${project.slug}.xml` },
    })
    await testDb.apartment.createMany({
      data: lots.map((lot, index) => ({
        feedId: feed.id,
        projectId: project.id,
        externalId: `${project.slug}-${index}`,
        rooms: lot.rooms,
        area: 30 + lot.rooms * 12,
        price: lot.price,
        isActive: lot.isActive ?? true,
      })),
    })
    return project.id
  }

  it('без сессии не пускает', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/projects' })
    expect(response.statusCode).toBe(401)
  })

  it('в списке показывает число активных квартир и вилку цен', async () => {
    await seedProject('Северный парк', [
      { rooms: 1, price: 8_000_000 },
      { rooms: 2, price: 14_500_000 },
      { rooms: 3, price: 30_000_000, isActive: false },
    ])
    await seedProject('Пустой квартал')

    const response = await app.inject({ method: 'GET', url: '/api/admin/projects', headers: { cookie } })
    expect(response.statusCode).toBe(200)

    const { projects } = response.json<{ projects: ProjectViewJson[] }>()
    const park = projects.find((project) => project.name === 'Северный парк')
    expect(park).toMatchObject({
      apartments: { active: 2, total: 3 },
      price: { min: 8_000_000, max: 14_500_000 },
    })

    const empty = projects.find((project) => project.name === 'Пустой квартал')
    expect(empty).toMatchObject({ apartments: { active: 0, total: 0 }, price: null })
  })

  it('отдаёт карточку и 404 на несуществующий', async () => {
    const id = await seedProject('Река', [{ rooms: 1, price: 9_000_000 }])

    const found = await app.inject({ method: 'GET', url: `/api/admin/projects/${id}`, headers: { cookie } })
    expect(found.statusCode).toBe(200)
    expect(found.json<ProjectViewJson>().apartments.active).toBe(1)

    const missing = await app.inject({
      method: 'GET',
      url: '/api/admin/projects/net-takogo',
      headers: { cookie },
    })
    expect(missing.statusCode).toBe(404)
  })

  it('дописывает в карточку то, чего нет в фиде', async () => {
    const id = await seedProject('Река')

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/projects/${id}`,
      headers: { cookie },
      payload: {
        developer: 'ГК Пример',
        district: 'Приморский',
        metro: 'Комендантский проспект',
        metroDistanceMin: 12,
        address: 'ул. Планерная, 5',
        deadline: '2027-06-30',
        finishing: 'чистовая',
        description: 'Дом у воды',
        url: 'https://example.test/reka',
        imageUrl: 'https://example.test/reka.jpg',
      },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json<ProjectViewJson>()).toMatchObject({
      developer: 'ГК Пример',
      district: 'Приморский',
      metro: 'Комендантский проспект',
      metroDistanceMin: 12,
      finishing: 'чистовая',
      description: 'Дом у воды',
      url: 'https://example.test/reka',
    })
    expect(response.json<ProjectViewJson>().deadline).toContain('2027-06-30')
  })

  it('пустое поле стирает прежнее значение, а не пишет пустую строку', async () => {
    const id = await seedProject('Река')
    await app.inject({
      method: 'PATCH',
      url: `/api/admin/projects/${id}`,
      headers: { cookie },
      payload: { district: 'Приморский' },
    })

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/projects/${id}`,
      headers: { cookie },
      payload: { district: '   ' },
    })

    expect(response.statusCode).toBe(200)
    expect(response.json<ProjectViewJson>().district).toBeNull()
  })

  it('при переименовании пересобирает slug и не сталкивает его с чужим', async () => {
    await seedProject('Северный парк')
    const id = await seedProject('Река')

    const response = await app.inject({
      method: 'PATCH',
      url: `/api/admin/projects/${id}`,
      headers: { cookie },
      payload: { name: 'Северный парк' },
    })

    expect(response.statusCode).toBe(200)
    const view = response.json<ProjectViewJson>()
    expect(view.name).toBe('Северный парк')
    expect(view.slug).toBe('severnyy-park-2')
  })

  it('объясняет, что не так со ссылкой и сроком сдачи', async () => {
    const id = await seedProject('Река')

    const badUrl = await app.inject({
      method: 'PATCH',
      url: `/api/admin/projects/${id}`,
      headers: { cookie },
      payload: { url: 'example.test/reka' },
    })
    expect(badUrl.statusCode).toBe(400)
    expect(badUrl.json<{ message: string }>().message).toContain('ссылкой')

    const badDeadline = await app.inject({
      method: 'PATCH',
      url: `/api/admin/projects/${id}`,
      headers: { cookie },
      payload: { deadline: 'когда-нибудь' },
    })
    expect(badDeadline.statusCode).toBe(400)
    expect(badDeadline.json<{ message: string }>().message).toContain('Срок сдачи')
  })

  it('переключателем выключает и включает ЖК', async () => {
    const id = await seedProject('Река')

    const off = await app.inject({
      method: 'POST',
      url: `/api/admin/projects/${id}/active`,
      headers: { cookie },
      payload: { isActive: false },
    })
    expect(off.statusCode).toBe(200)
    expect(off.json<ProjectViewJson>().isActive).toBe(false)

    const on = await app.inject({
      method: 'POST',
      url: `/api/admin/projects/${id}/active`,
      headers: { cookie },
      payload: { isActive: true },
    })
    expect(on.json<ProjectViewJson>().isActive).toBe(true)
  })

  describe('квартиры ЖК', () => {
    it('фильтрует по комнатности и цене и отдаёт границы фильтров', async () => {
      const id = await seedProject('Северный парк', [
        { rooms: 0, price: 6_000_000 },
        { rooms: 1, price: 9_000_000 },
        { rooms: 2, price: 14_000_000 },
        { rooms: 2, price: 18_000_000 },
        { rooms: 3, price: 25_000_000, isActive: false },
      ])

      const all = await app.inject({
        method: 'GET',
        url: `/api/admin/projects/${id}/apartments`,
        headers: { cookie },
      })
      expect(all.statusCode).toBe(200)
      const allBody = all.json<ApartmentsJson>()
      expect(allBody.total).toBe(4)
      expect(allBody.facets.price).toEqual({ min: 6_000_000, max: 18_000_000 })
      expect(allBody.facets.rooms.map((row) => row.rooms)).toEqual([0, 1, 2])

      const filtered = await app.inject({
        method: 'GET',
        url: `/api/admin/projects/${id}/apartments?rooms=2&priceMax=15000000`,
        headers: { cookie },
      })
      const filteredBody = filtered.json<ApartmentsJson>()
      expect(filteredBody.total).toBe(1)
      expect(filteredBody.apartments[0]?.price).toBe(14_000_000)
      // Границы считаются по всему ЖК, иначе фильтр схлопывался бы сам в себя.
      expect(filteredBody.facets.price).toEqual({ min: 6_000_000, max: 18_000_000 })

      const withHidden = await app.inject({
        method: 'GET',
        url: `/api/admin/projects/${id}/apartments?onlyActive=false`,
        headers: { cookie },
      })
      expect(withHidden.json<ApartmentsJson>().total).toBe(5)
    })

    it('на несуществующий ЖК отвечает 404', async () => {
      const response = await app.inject({
        method: 'GET',
        url: '/api/admin/projects/net-takogo/apartments',
        headers: { cookie },
      })
      expect(response.statusCode).toBe(404)
    })
  })

  describe('направления', () => {
    it('по умолчанию всё, что завёл фид, — новостройки, и список приходит со счётчиками', async () => {
      await seedProject('Северный парк', [{ rooms: 1, price: 8_000_000 }])

      const response = await app.inject({ method: 'GET', url: '/api/admin/projects', headers: { cookie } })
      const body = response.json<{ projects: ProjectViewJson[]; categories: CategoryJson[] }>()

      expect(body.projects[0]).toMatchObject({ category: 'novostroyki', categoryLabel: 'Новостройки' })
      // Пустые направления в списке тоже есть: иначе первый такой ЖК некуда перенести.
      expect(body.categories).toEqual([
        { value: 'novostroyki', label: 'Новостройки', count: 1 },
        { value: 'vtorichka', label: 'Вторичка', count: 0 },
        { value: 'commercial', label: 'Коммерция', count: 0 },
        { value: 'suburban', label: 'Загородная недвижимость', count: 0 },
      ])
    })

    it('направление меняется в карточке', async () => {
      const id = await seedProject('Склад на Речной')

      const saved = await app.inject({
        method: 'PATCH',
        url: `/api/admin/projects/${id}`,
        headers: { cookie },
        payload: { category: 'commercial' },
      })
      expect(saved.statusCode).toBe(200)
      expect(saved.json<ProjectViewJson>()).toMatchObject({
        category: 'commercial',
        categoryLabel: 'Коммерция',
      })
    })

    it('выдуманное направление не принимается', async () => {
      const id = await seedProject('Река')
      const response = await app.inject({
        method: 'PATCH',
        url: `/api/admin/projects/${id}`,
        headers: { cookie },
        payload: { category: 'kosmos' },
      })
      expect(response.statusCode).toBe(400)
    })
  })

  describe('удаление ЖК', () => {
    it('пока фид включён, отказывает и называет его: иначе ЖК вернётся сам', async () => {
      const id = await seedProject('Северный парк', [{ rooms: 1, price: 8_000_000 }])

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/admin/projects/${id}`,
        headers: { cookie },
      })

      expect(response.statusCode).toBe(409)
      const body = response.json<{ error: string; message: string; feeds: { name: string }[] }>()
      expect(body.error).toBe('feed_active')
      expect(body.message).toContain('Фид Северный парк')
      expect(body.feeds).toEqual([
        // Число ЖК в фиде админка показывает отдельно: выключать выгрузку,
        // которая кормит весь каталог, ради одной записи нельзя.
        { id: expect.any(String) as unknown as string, name: 'Фид Северный парк', isActive: true, projectCount: 1 },
      ])

      // Ничего не удалено: отказ — это отказ.
      expect(await testDb.project.count({ where: { id } })).toBe(1)
      expect(await testDb.apartment.count({ where: { projectId: id } })).toBe(1)
    })

    it('с выключенным фидом удаляет ЖК вместе с квартирами', async () => {
      const id = await seedProject('Северный парк', [
        { rooms: 1, price: 8_000_000 },
        { rooms: 2, price: 14_000_000, isActive: false },
      ])
      await seedProject('Река', [{ rooms: 1, price: 7_000_000 }])
      await testDb.feed.updateMany({ where: { name: 'Фид Северный парк' }, data: { isActive: false } })

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/admin/projects/${id}`,
        headers: { cookie },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json<{ apartmentsDeleted: number }>().apartmentsDeleted).toBe(2)
      expect(await testDb.project.count({ where: { id } })).toBe(0)
      // Квартиры уходят вместе с ЖК: лоты без комплекса поиск всё равно показал бы.
      expect(await testDb.apartment.count({ where: { projectId: id } })).toBe(0)
      // Соседний ЖК цел.
      expect(await testDb.apartment.count()).toBe(1)
    })

    it('force удаляет и при живом фиде — администратор про него уже знает', async () => {
      const id = await seedProject('Северный парк', [{ rooms: 1, price: 8_000_000 }])

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/admin/projects/${id}?force=true`,
        headers: { cookie },
      })

      expect(response.statusCode).toBe(200)
      expect(response.json<{ activeFeeds: { name: string }[] }>().activeFeeds).toHaveLength(1)
      expect(await testDb.project.count({ where: { id } })).toBe(0)
    })

    it('называет, сколько ЖК кормит фид: выключать общую выгрузку опасно', async () => {
      const feed = await testDb.feed.create({ data: { name: 'Общий фид', url: 'https://example.test/all.xml' } })
      const first = await testDb.project.create({ data: { name: 'Первый', slug: 'pervyy' } })
      const second = await testDb.project.create({ data: { name: 'Второй', slug: 'vtoroy' } })
      await testDb.apartment.createMany({
        data: [
          { feedId: feed.id, projectId: first.id, externalId: 'a1', price: 5_000_000 },
          { feedId: feed.id, projectId: second.id, externalId: 'a2', price: 6_000_000 },
        ],
      })

      const response = await app.inject({
        method: 'GET',
        url: `/api/admin/projects/${first.id}`,
        headers: { cookie },
      })

      expect(response.json<ProjectViewJson>().feeds).toEqual([
        { id: feed.id, name: 'Общий фид', isActive: true, projectCount: 2 },
      ])
    })

    it('документы базы знаний переживают удаление ЖК: это материал агентства', async () => {
      const id = await seedProject('Северный парк')
      const doc = await testDb.knowledgeDoc.create({
        data: { projectId: id, filename: 'ипотека.pdf', mimeType: 'application/pdf', sizeBytes: 10 },
      })

      const response = await app.inject({
        method: 'DELETE',
        url: `/api/admin/projects/${id}`,
        headers: { cookie },
      })
      expect(response.statusCode).toBe(200)

      const kept = await testDb.knowledgeDoc.findUnique({ where: { id: doc.id } })
      expect(kept?.projectId).toBeNull()
    })

    it('на несуществующий ЖК отвечает 404', async () => {
      const response = await app.inject({
        method: 'DELETE',
        url: '/api/admin/projects/net-takogo',
        headers: { cookie },
      })
      expect(response.statusCode).toBe(404)
    })
  })

  it('выключенный ЖК не попадает в выдачу ассистента', async () => {
    const id = await seedProject('Северный парк', [
      { rooms: 1, price: 8_000_000 },
      { rooms: 2, price: 14_000_000 },
    ])
    await seedProject('Река', [{ rooms: 1, price: 7_000_000 }])

    const before = await testDb.apartment.findMany({ where: VISIBLE_TO_ASSISTANT })
    expect(before).toHaveLength(3)

    const off = await app.inject({
      method: 'POST',
      url: `/api/admin/projects/${id}/active`,
      headers: { cookie },
      payload: { isActive: false },
    })
    expect(off.statusCode).toBe(200)

    const after = await testDb.apartment.findMany({
      where: VISIBLE_TO_ASSISTANT,
      include: { project: { select: { name: true } } },
    })
    expect(after).toHaveLength(1)
    expect(after[0]?.project?.name).toBe('Река')

    // Сами квартиры никуда не делись — они нужны истории переписок.
    expect(await testDb.apartment.count({ where: { projectId: id, isActive: true } })).toBe(2)
  })
})
