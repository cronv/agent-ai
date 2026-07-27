import { env } from '../config/env.js'
import { checkDatabaseConnection, disconnectPrisma, prisma } from '../db/prisma.js'
import { seedDemoData } from '../services/demo/index.js'

/**
 * Команда засева демонстрационных данных.
 *
 *   npm run seed:demo                 (из корня проекта, через tsx)
 *   docker compose exec app node packages/server/dist/scripts/seed-demo.js
 *
 * В контейнере запускается собранный файл: каталог `src` в runtime-образ не
 * копируется, и `npm run seed:demo` там работать не будет.
 *
 * Заводит демо-выгрузку, импортирует из неё 30 квартир в 4 ЖК, дополняет
 * карточки комплексов, загружает документ базы знаний и создаёт настройки
 * по умолчанию. Интернет не нужен: файлы лежат в `packages/server/demo`.
 *
 * Запускать можно сколько угодно раз — см. `services/demo/seed.ts`.
 */

async function main(): Promise<void> {
  const alive = await checkDatabaseConnection(prisma)
  if (!alive) {
    console.error(
      `Нет соединения с базой данных (${maskUrl(env.databaseUrl)}).\n` +
        'Проверьте, что PostgreSQL запущен: npm run db:up',
    )
    process.exit(1)
  }

  console.log('Засеваю демонстрационные данные…\n')

  const result = await seedDemoData({
    db: prisma,
    baseUrl: env.publicBaseUrl,
    log: (message) => console.log(`  ${message}`),
  })

  if (result.error !== null) {
    console.error(`\nИмпорт демо-выгрузки не удался: ${result.error}`)
    process.exit(1)
  }

  console.log(
    `\nГотово. Откройте админку: ${env.publicBaseUrl}/admin\n` +
      'Разделы «Жилые комплексы», «Выгрузки» и «База знаний» уже не пустые.',
  )
}

function maskUrl(url: string): string {
  return url.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@')
}

main()
  .catch((error: unknown) => {
    console.error('Засев не удался:', error)
    process.exitCode = 1
  })
  .finally(() => void disconnectPrisma())
