import { existsSync, readFileSync } from 'node:fs'

import type { FastifyPluginAsync } from 'fastify'

import { env } from '../config/env.js'
import { demoDir } from '../config/paths.js'
import { DEMO_FEED_PATH, demoPlanFile, readDemoFeedXml } from '../services/demo/index.js'

/**
 * Раздача демонстрационного комплекта.
 *
 *   GET /demo/feed.xml            выгрузка на 30 квартир в 4 вымышленных ЖК
 *   GET /demo/plans/plan-2k.svg   планировка-заглушка
 *
 * Зачем это на сервере, а не просто файлом в репозитории: импорт умеет ходить
 * только по http(s), и демо-фид должен откуда-то скачиваться. Свой же адрес —
 * единственный источник, который доступен на ноутбуке без интернета. Кнопка
 * «Обновить сейчас» в админке работает с ним ровно так же, как с чужой
 * выгрузкой, — и это заодно проверяет весь путь синхронизации целиком.
 *
 * Ссылки на планировки внутри XML абсолютные: карточку виджет рисует на чужом
 * сайте, относительный путь там ведёт в никуда. Поэтому адрес подставляется
 * при раздаче — из `PUBLIC_BASE_URL`.
 *
 * Заголовок CORS открытый: планировки грузятся тегом `<img>` со стороннего
 * сайта, а сама выгрузка — публичный файл без чего-либо личного.
 */

/** Имя файла планировки. Всё, что не подходит, — 404, а не попытка чтения. */
const PLAN_NAME = /^[a-z0-9-]{1,50}\.svg$/

const demoRoutes: FastifyPluginAsync = async (app) => {
  // Комплект могли не положить в образ. Это не повод ронять сервер: маршруты
  // регистрируются всегда и в таком случае честно отвечают 404.
  if (!existsSync(demoDir)) {
    app.log.warn('Демо-данные не найдены: %s. Адреса /demo/* вернут 404.', demoDir)
    return
  }

  app.get(DEMO_FEED_PATH, async (_request, reply) => {
    return reply
      .type('application/xml; charset=utf-8')
      .header('cache-control', 'public, max-age=60')
      .header('access-control-allow-origin', '*')
      .send(readDemoFeedXml(env.publicBaseUrl))
  })

  app.get<{ Params: { name: string } }>('/demo/plans/:name', async (request, reply) => {
    const { name } = request.params
    if (!PLAN_NAME.test(name)) {
      return reply.code(404).send({ error: 'not_found', message: 'Такой планировки нет' })
    }

    const file = demoPlanFile(name)
    if (!existsSync(file)) {
      return reply.code(404).send({ error: 'not_found', message: 'Такой планировки нет' })
    }

    return reply
      .type('image/svg+xml; charset=utf-8')
      .header('cache-control', 'public, max-age=3600')
      .header('access-control-allow-origin', '*')
      .send(readFileSync(file))
  })
}

export default demoRoutes
