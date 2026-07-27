import type { FastifyPluginAsync, FastifyReply } from 'fastify'

import { env } from '../../config/env.js'
import { checkAnthropicKey } from '../../services/anthropic/index.js'
import { SettingValidationError, isSettingKey, type SettingKey } from '../../services/settings/index.js'

/**
 * Настройки в админке.
 *
 *   GET   /api/admin/settings              все настройки со значениями и подписями
 *   PUT   /api/admin/settings              сохранить изменённые (PATCH — синоним)
 *   POST  /api/admin/settings/:key/reset   вернуть одну настройку к значению по умолчанию
 *   POST  /api/admin/settings/check-key    пробный запрос к Anthropic текущим ключом
 *
 * Всё под `/api/admin/` уже закрыто хуком из `plugins/auth.ts`.
 *
 * Список полей нигде не продублирован: форма собирается из того, что отдаёт
 * `settings.listForAdmin()`, а он строится из `SETTING_DEFINITIONS`. Новый
 * ключ появляется в админке сам, без правок здесь и в интерфейсе.
 *
 * Секреты уходят наружу замаскированными; значение-маска, вернувшееся обратно,
 * означает «не менять» — это разбирает `applyPatch`.
 *
 * После правки расписания фидов зовётся `app.feedScheduler.reload()`:
 * настройки должны действовать сразу, без перезапуска приложения.
 */

/** Ключи, от которых зависит планировщик обновления фидов. */
const SCHEDULER_KEYS: SettingKey[] = ['feed_sync_cron', 'feed_sync_enabled']

const settingsRoutes: FastifyPluginAsync = async (app) => {
  /** Строчка для вставки на сайт — собирается здесь, чтобы админка не гадала адрес. */
  function installSnippet(): { scriptUrl: string; snippet: string } {
    const scriptUrl = `${env.publicBaseUrl.replace(/\/+$/, '')}/widget.js`
    return { scriptUrl, snippet: `<script src="${scriptUrl}" defer></script>` }
  }

  async function currentState(): Promise<Record<string, unknown>> {
    return {
      settings: await app.settings.listForAdmin(),
      install: installSnippet(),
    }
  }

  app.get('/api/admin/settings', async (_request, reply) => {
    return reply.send(await currentState())
  })

  const save = async (
    body: unknown,
    reply: FastifyReply,
  ): Promise<FastifyReply> => {
    if (typeof body !== 'object' || body === null || Array.isArray(body)) {
      return reply.code(400).send({ error: 'bad_body', message: 'Ожидался объект «ключ: значение»' })
    }

    let updated: SettingKey[]
    try {
      updated = await app.settings.applyPatch(body as Record<string, unknown>)
    } catch (error) {
      if (error instanceof SettingValidationError) {
        return reply.code(400).send({ error: 'bad_setting', message: error.message, key: error.key })
      }
      throw error
    }

    if (updated.some((key) => SCHEDULER_KEYS.includes(key))) {
      await app.feedScheduler.reload()
    }

    return reply.send({ updated, ...(await currentState()) })
  }

  app.put('/api/admin/settings', async (request, reply) => save(request.body, reply))
  app.patch('/api/admin/settings', async (request, reply) => save(request.body, reply))

  app.post('/api/admin/settings/:key/reset', async (request, reply) => {
    const { key } = request.params as { key: string }
    if (!isSettingKey(key)) {
      return reply.code(404).send({ error: 'unknown_setting', message: `Нет такой настройки: ${key}` })
    }

    await app.settings.reset(key)
    if (SCHEDULER_KEYS.includes(key)) {
      await app.feedScheduler.reload()
    }

    return reply.send({ key, ...(await currentState()) })
  })

  app.post('/api/admin/settings/check-key', async (request, reply) => {
    const body = (request.body ?? {}) as { apiKey?: unknown }
    // Ключ можно проверить до сохранения — тогда он приходит прямо в запросе.
    const provided = typeof body.apiKey === 'string' ? body.apiKey.trim() : ''
    const apiKey = provided !== '' ? provided : await app.settings.getAnthropicApiKey()
    const model = await app.settings.get('model_default')

    const result = await checkAnthropicKey({ apiKey, model })
    return reply.send(result)
  })
}

export default settingsRoutes
