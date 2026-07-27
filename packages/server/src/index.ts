import { buildApp } from './app.js'
import { env } from './config/env.js'
import { checkDatabaseConnection, disconnectPrisma, prisma } from './db/prisma.js'

/**
 * Точка входа сервера.
 *
 * При старте: проверяет базу, засеивает настройки по умолчанию,
 * поднимает HTTP. При остановке — корректно закрывает соединения.
 */

async function main(): Promise<void> {
  const app = await buildApp()

  const dbAlive = await checkDatabaseConnection(prisma)
  if (!dbAlive) {
    app.log.error(
      'Нет соединения с базой данных (%s). Проверьте, что PostgreSQL запущен и DATABASE_URL указан верно.',
      maskUrl(env.databaseUrl),
    )
    process.exit(1)
  }

  const created = await app.settings.seedDefaults()
  if (created > 0) app.log.info('Создано настроек по умолчанию: %d', created)

  const shutdown = async (signal: string): Promise<void> => {
    app.log.info('Получен сигнал %s, останавливаюсь…', signal)
    try {
      await app.close()
      await disconnectPrisma()
    } finally {
      process.exit(0)
    }
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))

  await app.listen({ port: env.port, host: env.host })
  app.log.info('Админка: %s/admin', env.publicBaseUrl)
}

function maskUrl(url: string): string {
  return url.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@')
}

main().catch((error: unknown) => {
  console.error('Не удалось запустить сервер:', error)
  process.exit(1)
})
