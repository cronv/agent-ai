import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'

import { env } from './config/env.js'
import type { Db } from './db/prisma.js'
import authPlugin from './plugins/auth.js'
import contextPlugin from './plugins/context.js'
import feedSchedulerPlugin from './plugins/feed-scheduler.js'
import staticAssets from './plugins/static-assets.js'
import adminRoutes from './routes/admin/index.js'
import chatRoutes from './routes/chat.routes.js'
import healthRoutes from './routes/health.js'
import rootRoutes from './routes/root.js'
import type { ModelClient } from './services/dialog/index.js'
import type { SettingsService } from './services/settings/index.js'

/**
 * Сборка HTTP-приложения.
 *
 * Отделена от запуска (`index.ts`), чтобы тесты могли поднимать приложение
 * через `fastify.inject()` без открытия порта.
 *
 *   const app = await buildApp({ prisma: testDb })
 *   const res = await app.inject({ method: 'GET', url: '/api/health' })
 */

export interface BuildAppOptions {
  /** Клиент базы. По умолчанию — общий клиент приложения. */
  prisma?: Db
  /** Сервис настроек. По умолчанию создаётся поверх переданного клиента. */
  settings?: SettingsService
  /** Раздавать ли собранные админку и виджет. В тестах обычно не нужно. */
  serveStatic?: boolean
  /** Поднимать ли задачи обновления фидов. По умолчанию — везде, кроме тестов. */
  scheduler?: boolean
  /** Дополнительные опции Fastify (например, свой логгер). */
  fastify?: FastifyServerOptions
  /** Клиент модели для чата. В тестах сюда подставляется мок вместо Anthropic. */
  modelClient?: ModelClient
}

export async function buildApp(options: BuildAppOptions = {}): Promise<FastifyInstance> {
  const app = Fastify({
    logger: { level: env.logLevel },
    trustProxy: true,
    bodyLimit: 2 * 1024 * 1024,
    ...options.fastify,
  })

  const contextOptions: { prisma?: Db; settings?: SettingsService } = {}
  if (options.prisma) contextOptions.prisma = options.prisma
  if (options.settings) contextOptions.settings = options.settings
  await app.register(contextPlugin, contextOptions)

  // Регистрируется до маршрутов: плагин вешает общий хук, который закрывает
  // всё под /api/admin/ — он должен успеть до того, как появятся маршруты.
  await app.register(authPlugin)

  const schedulerOptions: { enabled?: boolean } = {}
  if (options.scheduler !== undefined) schedulerOptions.enabled = options.scheduler
  await app.register(feedSchedulerPlugin, schedulerOptions)

  await app.register(rootRoutes)
  await app.register(healthRoutes)
  await app.register(adminRoutes)

  // Публичное API виджета: живёт вне /api/admin, свои CORS-заголовки
  // и свои ограничения частоты — см. routes/chat.routes.ts.
  const chatOptions: { modelClient?: ModelClient } = {}
  if (options.modelClient) chatOptions.modelClient = options.modelClient
  await app.register(chatRoutes, chatOptions)

  if (options.serveStatic !== false) {
    await app.register(staticAssets)
  }

  return app
}
