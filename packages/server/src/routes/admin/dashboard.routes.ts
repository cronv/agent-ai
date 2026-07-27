import type { FastifyPluginAsync } from 'fastify'

import { getDashboardSummary } from '../../services/dashboard/dashboard.service.js'

/**
 * GET /api/admin/dashboard
 *
 * Сводка для главной страницы админки. Защищена как всё под `/api/admin/`.
 */

const dashboardRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/admin/dashboard', async (_request, reply) => {
    const summary = await getDashboardSummary(app.prisma)
    return reply.send(summary)
  })
}

export default dashboardRoutes
