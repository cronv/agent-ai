import { buildApp } from './app.js'
import { env } from './config/env.js'
import { checkDatabaseConnection, disconnectPrisma, prisma } from './db/prisma.js'
import { seedDemoIfEmpty } from './services/demo/index.js'
import { SETTING_KEYS } from './services/settings/index.js'

/**
 * Точка входа сервера.
 *
 * При старте: проверяет базу, засеивает настройки по умолчанию и — только на
 * самом первом запуске новой базы — демонстрационные данные, поднимает HTTP.
 * При остановке корректно закрывает соединения.
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

  // Признак самого первого старта на новой базе: настройки завелись все до
  // единой, то есть таблица была пуста. На любом следующем запуске создавать
  // уже нечего, и `created` равен нулю.
  //
  // Это и есть условие автозасева. Пустота таблиц квартир и ЖК условием быть не
  // может: администратор вправе удалить демо-выгрузку и демо-ЖК через админку,
  // после чего база снова «пустая» — и ближайший перезапуск контейнера вернул
  // бы четыре вымышленных ЖК на боевой стенд.
  const firstStart = created === SETTING_KEYS.length

  // Первый запуск на чистой базе показывает готовый пример: 4 ЖК, 30 квартир
  // и документ базы знаний. Выключается переменной SEED_DEMO_DATA=off.
  if (env.seedDemoData && firstStart) {
    try {
      const demo = await seedDemoIfEmpty({
        db: prisma,
        settings: app.settings,
        baseUrl: env.publicBaseUrl,
      })
      if (demo) {
        app.log.info(
          'Засеяны демонстрационные данные: ЖК — %d, квартир — %d, фрагментов базы знаний — %d',
          demo.projectsCreated,
          demo.apartmentsCreated,
          demo.knowledgeChunks,
        )
      }
    } catch (error) {
      // Демо — удобство, а не условие работы. Не смогли — сервер всё равно поднимается.
      app.log.warn({ err: error }, 'Не удалось засеять демонстрационные данные')
    }
  }

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
