import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildApp } from '../../app.js'
import { env } from '../../config/env.js'
import { ADMIN_SESSION_COOKIE } from '../../plugins/auth.js'
import { SETTING_DEFINITIONS, SettingsService, type SettingView } from '../../services/settings/index.js'
import { resetDatabase, testDb } from '../../testing/db.js'
import { resetLoginAttempts } from './auth.routes.js'

/**
 * Настройки правятся через API целиком так же, как из формы админки:
 * читаем список, отправляем изменённые ключи, читаем снова.
 * Отдельно проверяется, что секрет наружу уходит маской и что вернувшаяся
 * маска не затирает сохранённый ключ.
 */

interface SettingsPayload {
  settings: SettingView[]
  install: { scriptUrl: string; snippet: string }
  updated?: string[]
}

const SECRET_MASK = '••••••••'

function pick(payload: SettingsPayload, key: string): SettingView {
  const view = payload.settings.find((item) => item.key === key)
  if (!view) throw new Error(`В ответе нет настройки ${key}`)
  return view
}

describe('/api/admin/settings', () => {
  let app: FastifyInstance
  let cookie: string

  beforeAll(async () => {
    // processEnv: {} — чтобы ANTHROPIC_API_KEY из окружения разработчика
    // не подменял результат проверки ключа и не уводил тест в интернет.
    app = await buildApp({
      prisma: testDb,
      settings: new SettingsService({ db: testDb, processEnv: {} }),
      serveStatic: false,
    })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await resetDatabase()
    resetLoginAttempts()
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: env.adminUsername, password: env.adminPassword },
    })
    const issued = login.cookies.find((item) => item.name === ADMIN_SESSION_COOKIE)
    cookie = `${ADMIN_SESSION_COOKIE}=${String(issued?.value)}`
  })

  async function read(): Promise<SettingsPayload> {
    const response = await app.inject({ method: 'GET', url: '/api/admin/settings', headers: { cookie } })
    expect(response.statusCode).toBe(200)
    return response.json<SettingsPayload>()
  }

  async function save(patch: Record<string, unknown>): Promise<ReturnType<FastifyInstance['inject']>> {
    return app.inject({ method: 'PUT', url: '/api/admin/settings', headers: { cookie }, payload: patch })
  }

  it('без сессии настройки не отдаются', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/settings' })

    expect(response.statusCode).toBe(401)
  })

  it('отдаёт все настройки с подписями, типами и разделами', async () => {
    const payload = await read()

    expect(payload.settings).toHaveLength(Object.keys(SETTING_DEFINITIONS).length)
    const prompt = pick(payload, 'system_prompt')
    expect(prompt.type).toBe('text')
    expect(prompt.group).toBe('assistant')
    expect(prompt.label).toBe(SETTING_DEFINITIONS.system_prompt.label)
    expect(prompt.value).toBe(SETTING_DEFINITIONS.system_prompt.default)
    expect(prompt.isCustom).toBe(false)
  })

  it('отдаёт готовую строчку для вставки на сайт', async () => {
    const payload = await read()

    expect(payload.install.scriptUrl.endsWith('/widget.js')).toBe(true)
    expect(payload.install.snippet).toBe(`<script src="${payload.install.scriptUrl}" defer></script>`)
  })

  it('сохраняет изменения и сразу отдаёт их обратно', async () => {
    const response = await save({
      system_prompt: 'Ты консультант по новостройкам Казани.',
      widget_title: 'Подбор квартиры',
      contact_request_threshold: 3,
      widget_example_questions: ['Что есть до 12 млн?', 'Когда сдача?'],
      widget_enabled: false,
    })

    expect(response.statusCode).toBe(200)
    const payload = response.json<SettingsPayload>()
    expect(payload.updated).toEqual(
      expect.arrayContaining(['system_prompt', 'widget_title', 'contact_request_threshold']),
    )

    const saved = await read()
    expect(pick(saved, 'system_prompt').value).toBe('Ты консультант по новостройкам Казани.')
    expect(pick(saved, 'system_prompt').isCustom).toBe(true)
    expect(pick(saved, 'contact_request_threshold').value).toBe(3)
    expect(pick(saved, 'widget_example_questions').value).toEqual(['Что есть до 12 млн?', 'Когда сдача?'])
    expect(pick(saved, 'widget_enabled').value).toBe(false)
  })

  it('приводит значение из формы к типу настройки', async () => {
    // Из HTML-формы число приходит строкой, список — текстом по строке на пункт.
    const response = await save({
      contact_request_threshold: '4',
      widget_example_questions: 'Первый вопрос\nВторой вопрос\n',
    })

    expect(response.statusCode).toBe(200)
    const saved = await read()
    expect(pick(saved, 'contact_request_threshold').value).toBe(4)
    expect(pick(saved, 'widget_example_questions').value).toEqual(['Первый вопрос', 'Второй вопрос'])
  })

  it('на негодное значение отвечает 400 и ничего не сохраняет', async () => {
    const response = await save({ contact_request_threshold: 'много' })

    expect(response.statusCode).toBe(400)
    expect(response.json<{ key: string }>().key).toBe('contact_request_threshold')
    expect(pick(await read(), 'contact_request_threshold').value).toBe(2)
  })

  it('молча пропускает чужие ключи', async () => {
    const response = await save({ widget_title: 'Новостройки', сколько_денег: 100 })

    expect(response.statusCode).toBe(200)
    expect(response.json<SettingsPayload>().updated).toEqual(['widget_title'])
  })

  it('ключ Anthropic читается маской, а не открытым текстом', async () => {
    await save({ anthropic_api_key: 'sk-ant-секретный-ключ' })

    const view = pick(await read(), 'anthropic_api_key')
    expect(view.secret).toBe(true)
    expect(view.isSet).toBe(true)
    expect(view.value).toBe(SECRET_MASK)
    expect(String(view.value)).not.toContain('секретный')
  })

  it('маска, вернувшаяся из формы, не затирает сохранённый ключ', async () => {
    await save({ anthropic_api_key: 'sk-ant-секретный-ключ' })

    const response = await save({ anthropic_api_key: SECRET_MASK, widget_title: 'Новый заголовок' })

    expect(response.statusCode).toBe(200)
    expect(response.json<SettingsPayload>().updated).toEqual(['widget_title'])
    expect(await app.settings.getAnthropicApiKey()).toBe('sk-ant-секретный-ключ')
  })

  it('незаданный секрет отдаётся пустым, а не маской', async () => {
    const view = pick(await read(), 'lead_webhook_url')

    expect(view.isSet).toBe(false)
    expect(view.value).toBe('')
  })

  it('возвращает настройку к значению по умолчанию', async () => {
    await save({ system_prompt: 'Свой текст' })

    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/settings/system_prompt/reset',
      headers: { cookie },
    })

    expect(response.statusCode).toBe(200)
    const view = pick(response.json<SettingsPayload>(), 'system_prompt')
    expect(view.value).toBe(SETTING_DEFINITIONS.system_prompt.default)
    expect(view.isCustom).toBe(false)
  })

  it('на сброс несуществующей настройки отвечает 404', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/settings/systemprompt/reset',
      headers: { cookie },
    })

    expect(response.statusCode).toBe(404)
  })

  it('расписание фидов применяется без перезапуска приложения', async () => {
    const response = await save({ feed_sync_cron: '0 */6 * * *', feed_sync_enabled: false })

    expect(response.statusCode).toBe(200)
    // Планировщик читает настройки сам — проверяем, что новое значение уже в базе
    // и что перезагрузка расписания не уронила запрос.
    expect(await app.settings.get('feed_sync_cron')).toBe('0 */6 * * *')
    expect(await app.settings.get('feed_sync_enabled')).toBe(false)
    expect(await app.feedScheduler.reload()).toBeDefined()
  })

  it('без ключа проверка честно говорит, что проверять нечего', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/settings/check-key',
      headers: { cookie },
      payload: {},
    })

    expect(response.statusCode).toBe(200)
    const result = response.json<{ ok: boolean; message: string }>()
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Ключ не задан')
  })
})
