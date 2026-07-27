import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify'

import { env } from './config/env.js'
import type { Db } from './db/prisma.js'
import contextPlugin from './plugins/context.js'
import staticAssets from './plugins/static-assets.js'
import healthRoutes from './routes/health.js'
import rootRoutes from './routes/root.js'
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
  /** Дополнительные опции Fastify (например, свой логгер). */
  fastify?: FastifyServerOptions
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

  await app.register(rootRoutes)
  await app.register(healthRoutes)

  if (options.serveStatic !== false) {
    await app.register(staticAssets)
  }

  return app
}
