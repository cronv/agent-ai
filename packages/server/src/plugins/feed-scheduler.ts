import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'

import { env } from '../config/env.js'
import { FeedScheduler } from '../services/feeds/scheduler.js'

/**
 * Планировщик обновления фидов как часть приложения.
 *
 *   app.feedScheduler.reload()   // расписание поменяли — применить заново
 *
 * Задачи поднимаются на `onReady` и гаснут на `onClose`, поэтому отдельно
 * останавливать планировщик не нужно: `app.close()` делает это сам.
 *
 * В тестах задачи по умолчанию не поднимаются (`NODE_ENV=test`), но объект
 * `app.feedScheduler` есть всегда — маршруты зовут `reload()` не оглядываясь.
 */

declare module 'fastify' {
  interface FastifyInstance {
    feedScheduler: FeedScheduler
  }
}

export interface FeedSchedulerPluginOptions {
  /** Поднимать ли задачи. По умолчанию — везде, кроме тестов. */
  enabled?: boolean
}

const feedSchedulerPlugin: FastifyPluginAsync<FeedSchedulerPluginOptions> = async (app, options) => {
  const scheduler = new FeedScheduler({
    db: app.prisma,
    settings: app.settings,
    logger: app.log,
  })

  app.decorate('feedScheduler', scheduler)

  app.addHook('onClose', async () => {
    await scheduler.stop()
  })

  const enabled = options.enabled ?? !env.isTest
  if (enabled) {
    app.addHook('onReady', async () => {
      await scheduler.start()
    })
  }
}

export default fp(feedSchedulerPlugin, { name: 'feed-scheduler', dependencies: ['context'] })
