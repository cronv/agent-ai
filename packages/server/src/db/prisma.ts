import { PrismaClient } from '@prisma/client'

import { env } from '../config/env.js'

/**
 * Доступ к базе данных.
 *
 * В приложении используется единый экземпляр `prisma`. В тестах и скриптах
 * можно создать отдельный клиент через `createPrismaClient(url)`.
 */

export type Db = PrismaClient

export function createPrismaClient(databaseUrl: string = env.databaseUrl): PrismaClient {
  return new PrismaClient({
    datasourceUrl: databaseUrl,
    log: env.nodeEnv === 'development' ? ['warn', 'error'] : ['error'],
  })
}

/** Общий клиент приложения. */
export const prisma: PrismaClient = createPrismaClient()

/** Проверка живого соединения с базой — используется в /api/health. */
export async function checkDatabaseConnection(db: Db = prisma): Promise<boolean> {
  try {
    await db.$queryRaw`SELECT 1`
    return true
  } catch {
    return false
  }
}

export async function disconnectPrisma(db: Db = prisma): Promise<void> {
  await db.$disconnect()
}
