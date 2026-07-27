import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'

import { LeadService, type FetchLike } from '../services/leads/index.js'

/**
 * Сервис лидов как часть приложения.
 *
 *   app.leads.capture({ sessionId, name, phone, consent: true })
 *   new DialogEngine({ db: app.prisma, settings: app.settings, saveLead: app.leads.captureFromDialog })
 *
 * Один экземпляр на приложение: он держит очередь неотправленных вебхуков,
 * и второй такой же начал бы отправлять лиды дважды.
 *
 * На `onClose` приложение дожидается, пока вебхуки долетят: оборвать доставку
 * при перезапуске значит потерять лид на стороне CRM.
 */

declare module 'fastify' {
  interface FastifyInstance {
    leads: LeadService
  }
}

export interface LeadsPluginOptions {
  /** Подменяется в тестах: в интернет тесты не ходят. */
  fetchImpl?: FetchLike
  webhookTimeoutMs?: number
  webhookRetryDelayMs?: number
}

const leadsPlugin: FastifyPluginAsync<LeadsPluginOptions> = async (app, options) => {
  const serviceOptions: ConstructorParameters<typeof LeadService>[0] = {
    db: app.prisma,
    settings: app.settings,
    logger: app.log,
  }
  if (options.fetchImpl) serviceOptions.fetchImpl = options.fetchImpl
  if (options.webhookTimeoutMs !== undefined) serviceOptions.webhookTimeoutMs = options.webhookTimeoutMs
  if (options.webhookRetryDelayMs !== undefined) serviceOptions.webhookRetryDelayMs = options.webhookRetryDelayMs

  const leads = new LeadService(serviceOptions)
  app.decorate('leads', leads)

  app.addHook('onClose', async () => {
    await leads.whenIdle()
  })
}

export default fp(leadsPlugin, { name: 'leads', dependencies: ['context'] })
