import { PrismaClient } from '@prisma/client'

import { resolveTestDatabaseUrl } from './database-url.js'

/**
 * Помощники для тестов, работающих с базой.
 *
 *   import { testDb, resetDatabase } from '../testing/db.js'
 *
 *   beforeEach(async () => { await resetDatabase() })
 *
 * Клиент один на файл тестов; закрывать его вручную не нужно —
 * это делает `afterAll` в src/testing/setup.ts.
 */

let client: PrismaClient | null = null

/** Клиент Prisma, подключённый к тестовой базе. */
export function getTestDb(): PrismaClient {
  if (!client) {
    // log: [] — тесты специально проверяют падающие запросы,
    // их не нужно печатать в вывод как ошибки.
    client = new PrismaClient({ datasourceUrl: resolveTestDatabaseUrl(), log: [] })
  }
  return client
}

/** То же самое, но как значение — для короткой записи в тестах. */
export const testDb: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property, receiver) {
    return Reflect.get(getTestDb() as object, property, receiver)
  },
})

let tableNames: string[] | null = null

async function listTables(db: PrismaClient): Promise<string[]> {
  if (tableNames) return tableNames
  const rows = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename NOT LIKE '\\_prisma%'
  `
  tableNames = rows.map((row) => `"public"."${row.tablename}"`)
  return tableNames
}

/** Чистит все таблицы. Схема и миграции остаются на месте. */
export async function resetDatabase(db: PrismaClient = getTestDb()): Promise<void> {
  const tables = await listTables(db)
  if (tables.length === 0) return
  await db.$executeRawUnsafe(`TRUNCATE TABLE ${tables.join(', ')} RESTART IDENTITY CASCADE`)
}

export async function disconnectTestDb(): Promise<void> {
  if (client) {
    await client.$disconnect()
    client = null
  }
}
