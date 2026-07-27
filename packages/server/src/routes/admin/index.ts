import type { FastifyPluginAsync } from 'fastify'

import authRoutes from './auth.routes.js'
import dashboardRoutes from './dashboard.routes.js'

/**
 * Все маршруты админки в одном месте.
 *
 * Новый раздел админки добавляется так: рядом кладётся файл
 * `<раздел>.routes.ts` с обычным плагином Fastify и регистрируется здесь.
 * Отдельно закрывать маршрут от посторонних не нужно — всё под
 * `/api/admin/` уже защищено хуком из `plugins/auth.ts`.
 */

const adminRoutes: FastifyPluginAsync = async (app) => {
  await app.register(authRoutes)
  await app.register(dashboardRoutes)
}

export default adminRoutes
