import type { Apartment, Feed, PrismaClient, Project } from '@prisma/client'

import { testDb } from './db.js'

/**
 * Наполнение каталога для тестов.
 *
 *   const project = await createProject({ name: 'Северный', district: 'Приморский' })
 *   await createApartment({ projectId: project.id, rooms: 2, price: 17_000_000 })
 *
 * Обязательных полей у квартиры два — фид и цена, — а значимых для теста
 * обычно одно. Поэтому всё остальное здесь имеет разумные значения
 * по умолчанию: тест перечисляет только то, что проверяет.
 */

let counter = 0

function unique(prefix: string): string {
  counter += 1
  return `${prefix}-${counter}`
}

export async function createFeed(overrides: Partial<Feed> = {}, db: PrismaClient = testDb): Promise<Feed> {
  const name = overrides.name ?? unique('Фид')
  return db.feed.create({
    data: {
      name,
      url: overrides.url ?? `https://example.com/${encodeURIComponent(name)}.xml`,
      ...(overrides.isActive === undefined ? {} : { isActive: overrides.isActive }),
    },
  })
}

export async function createProject(overrides: Partial<Project> = {}, db: PrismaClient = testDb): Promise<Project> {
  const name = overrides.name ?? unique('ЖК')
  const { id: _id, createdAt: _createdAt, updatedAt: _updatedAt, ...rest } = overrides
  return db.project.create({
    data: {
      ...rest,
      name,
      slug: overrides.slug ?? unique('zhk'),
    },
  })
}

export interface ApartmentSeed extends Partial<Omit<Apartment, 'raw'>> {
  feedId?: string
  projectId?: string | null
}

export async function createApartment(seed: ApartmentSeed = {}, db: PrismaClient = testDb): Promise<Apartment> {
  const feedId = seed.feedId ?? (await createFeed({}, db)).id
  const {
    id: _id,
    createdAt: _createdAt,
    updatedAt: _updatedAt,
    feedId: _feedId,
    externalId,
    price,
    ...rest
  } = seed

  return db.apartment.create({
    data: {
      ...rest,
      feedId,
      externalId: externalId ?? unique('lot'),
      price: price ?? 15_000_000,
    },
  })
}
