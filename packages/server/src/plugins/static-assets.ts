import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

import fastifyStatic from '@fastify/static'
import type { FastifyPluginAsync } from 'fastify'
import fp from 'fastify-plugin'

import { adminDistDir, widgetBundleFile } from '../config/paths.js'

/**
 * Раздача собранной статики:
 *   /admin, /admin/*  — SPA админки (любой внутренний адрес отдаёт index.html)
 *   /widget.js        — бандл виджета для вставки на чужой сайт
 *
 * Если сборки нет (обычная ситуация при `npm run dev` без предварительного
 * `npm run build`), маршруты всё равно регистрируются и отвечают понятным
 * текстом с подсказкой, что собрать. Сервер из-за этого не падает.
 */

export interface StaticAssetsOptions {
  adminDir?: string
  widgetFile?: string
}

const NOT_BUILT_HINT = (what: string, command: string): string =>
  `${what} ещё не собран(а).\n\nВыполните в корне проекта:\n    ${command}\n\nИли запустите всё через Docker:\n    docker compose up\n`

const staticAssets: FastifyPluginAsync<StaticAssetsOptions> = async (app, options) => {
  const adminDir = options.adminDir ?? adminDistDir
  const widgetFile = options.widgetFile ?? widgetBundleFile

  // ── Админка ──────────────────────────────────────────────
  const adminIndex = join(adminDir, 'index.html')
  if (existsSync(adminIndex)) {
    await app.register(
      async (scope) => {
        await scope.register(fastifyStatic, { root: adminDir, decorateReply: false })
        // Любой адрес внутри /admin, которому не соответствует файл, —
        // это маршрут внутри SPA: отдаём index.html, роутер разберётся.
        scope.setNotFoundHandler((request, reply) => {
          if (request.method !== 'GET' && request.method !== 'HEAD') {
            return reply.code(404).send({ error: 'Not Found' })
          }
          return reply.type('text/html; charset=utf-8').send(readFileSync(adminIndex))
        })
      },
      { prefix: '/admin' },
    )
  } else {
    app.log.warn('Админка не собрана: %s не найден. /admin вернёт подсказку.', adminIndex)
    const hint = NOT_BUILT_HINT('Админка', 'npm run build:admin')
    app.get('/admin', (_request, reply) => reply.code(503).type('text/plain; charset=utf-8').send(hint))
    app.get('/admin/*', (_request, reply) => reply.code(503).type('text/plain; charset=utf-8').send(hint))
  }

  // ── Виджет ───────────────────────────────────────────────
  app.get('/widget.js', (_request, reply) => {
    if (!existsSync(widgetFile)) {
      return reply
        .code(503)
        .type('text/plain; charset=utf-8')
        .send(NOT_BUILT_HINT('Виджет', 'npm run build:widget'))
    }
    return reply
      .type('application/javascript; charset=utf-8')
      .header('Cache-Control', 'public, max-age=300')
      .header('Access-Control-Allow-Origin', '*')
      .send(readFileSync(widgetFile))
  })
}

export default fp(staticAssets, { name: 'static-assets' })
