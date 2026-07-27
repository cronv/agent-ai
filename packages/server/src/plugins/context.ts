import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'

import type { Db } from '../db/prisma.js'
import { prisma as defaultPrisma } from '../db/prisma.js'
import { SettingsService } from '../services/settings/index.js'

/**
 * Кладёт на экземпляр Fastify общие зависимости, чтобы маршруты
 * не импортировали синглтоны напрямую:
 *
 *   app.prisma   — клиент базы данных
 *   app.settings — сервис настроек
 */

declare module 'fastify' {
  interface FastifyInstance {
    prisma: Db
    settings: SettingsService
  }
}

export interface ContextPluginOptions {
  prisma?: Db
  settings?: SettingsService
}

const contextPlugin: FastifyPluginAsync<ContextPluginOptions> = async (app, options) => {
  const db = options.prisma ?? defaultPrisma
  const settings = options.settings ?? new SettingsService({ db })

  app.decorate('prisma', db)
  app.decorate('settings', settings)
}

export default fp(contextPlugin, { name: 'context' })
