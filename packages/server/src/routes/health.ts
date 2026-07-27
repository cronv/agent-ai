import type { FastifyPluginAsync } from 'fastify'

import { checkDatabaseConnection } from '../db/prisma.js'

/**
 * GET /api/health
 *
 * Проверка живости сервиса. Соединение с базой проверяется по-настоящему —
 * запросом к PostgreSQL, а не тем, что клиент был создан. Если база недоступна,
 * ответ 503 и `db: "error"`; healthcheck в docker compose опирается на это.
 */

export interface HealthResponse {
  status: 'ok' | 'error'
  db: 'ok' | 'error'
}

const healthRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/health', async (_request, reply) => {
    const dbAlive = await checkDatabaseConnection(app.prisma)
    const body: HealthResponse = {
      status: dbAlive ? 'ok' : 'error',
      db: dbAlive ? 'ok' : 'error',
    }
    return reply.code(dbAlive ? 200 : 503).send(body)
  })
}

export default healthRoutes
