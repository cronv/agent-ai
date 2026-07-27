import { beforeEach, describe, expect, it } from 'vitest'

import { resetDatabase, testDb } from '../../testing/db.js'
import {
  PUBLIC_SETTING_KEYS,
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  getSettingDefinition,
} from './definitions.js'
import { SettingValidationError, SettingsService, UnknownSettingError } from './settings.service.js'

function makeService(processEnv: NodeJS.ProcessEnv = {}): SettingsService {
  return new SettingsService({ db: testDb, processEnv })
}

describe('SettingsService', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  describe('чтение', () => {
    it('на пустой базе отдаёт значения по умолчанию', async () => {
      const settings = makeService()

      expect(await settings.get('feed_sync_cron')).toBe('0 */3 * * *')
      expect(await settings.get('contact_request_threshold')).toBe(2)
      expect(await settings.get('feed_sync_enabled')).toBe(true)
      expect(await settings.get('widget_example_questions')).toEqual(
        SETTING_DEFINITIONS.widget_example_questions.default,
      )
    })

    it('getAll возвращает все известные ключи', async () => {
      const all = await makeService().getAll()

      expect(Object.keys(all).sort()).toEqual([...SETTING_KEYS].sort())
    })

    it('getMany делает один запрос и отдаёт только запрошенное', async () => {
      const settings = makeService()
      await settings.set('widget_title', 'Новостройки Москвы')

      const result = await settings.getMany('widget_title', 'widget_accent_color')

      expect(result).toEqual({ widget_title: 'Новостройки Москвы', widget_accent_color: '#2F6BFF' })
    })

    it('не падает, когда в базе лежит мусор — берёт значение по умолчанию', async () => {
      await testDb.setting.create({
        data: { key: 'contact_request_threshold', value: 'не число' },
      })

      expect(await makeService().get('contact_request_threshold')).toBe(2)
    })

    it('отвергает неизвестный ключ вместо тихого undefined', async () => {
      // @ts-expect-error — проверяем поведение в рантайме на опечатке в ключе
      await expect(makeService().get('systemprompt')).rejects.toBeInstanceOf(UnknownSettingError)
    })
  })

  describe('запись', () => {
    it('сохраняет и отдаёт значение обратно', async () => {
      const settings = makeService()

      await settings.set('system_prompt', 'Отвечай коротко.')

      expect(await settings.get('system_prompt')).toBe('Отвечай коротко.')
    })

    it('приводит значение из формы к нужному типу', async () => {
      const settings = makeService()

      // Форма в браузере присылает всё строками
      await settings.applyPatch({ contact_request_threshold: '4', feed_sync_enabled: 'false' })

      expect(await settings.get('contact_request_threshold')).toBe(4)
      expect(await settings.get('feed_sync_enabled')).toBe(false)
    })

    it('список вопросов принимает и массив, и текст по строкам', async () => {
      const settings = makeService()

      await settings.set('widget_example_questions', ['Первый', 'Второй'])
      expect(await settings.get('widget_example_questions')).toEqual(['Первый', 'Второй'])

      await settings.applyPatch({ widget_example_questions: 'Раз\n\nДва  \nТри' })
      expect(await settings.get('widget_example_questions')).toEqual(['Раз', 'Два', 'Три'])
    })

    it('не принимает значение неподходящего типа', async () => {
      await expect(
        // @ts-expect-error — намеренно передаём мусор, как это сделал бы HTTP-запрос
        makeService().set('contact_request_threshold', 'много'),
      ).rejects.toBeInstanceOf(SettingValidationError)
    })

    it('setMany записывает всё одной транзакцией', async () => {
      const settings = makeService()

      await settings.setMany({ widget_title: 'Дом', widget_accent_color: '#FF6600' })

      expect(await settings.getMany('widget_title', 'widget_accent_color')).toEqual({
        widget_title: 'Дом',
        widget_accent_color: '#FF6600',
      })
    })

    it('при ошибке в одном значении не сохраняет ни одного', async () => {
      const settings = makeService()

      await expect(
        // @ts-expect-error — второе значение негодное
        settings.setMany({ widget_title: 'Дом', contact_request_threshold: 'ой' }),
      ).rejects.toBeInstanceOf(SettingValidationError)

      expect(await settings.get('widget_title')).toBe(SETTING_DEFINITIONS.widget_title.default)
    })

    it('applyPatch игнорирует ключи, которых нет в списке настроек', async () => {
      const applied = await makeService().applyPatch({ widget_title: 'Дом', hacker_key: 'ой' })

      expect(applied).toEqual(['widget_title'])
    })

    it('reset возвращает значение по умолчанию', async () => {
      const settings = makeService()
      await settings.set('feed_sync_cron', '*/5 * * * *')

      expect(await settings.reset('feed_sync_cron')).toBe('0 */3 * * *')
      expect(await settings.get('feed_sync_cron')).toBe('0 */3 * * *')
    })
  })

  describe('засев значений по умолчанию', () => {
    it('при первом старте создаёт строку на каждую настройку', async () => {
      const created = await makeService().seedDefaults()

      expect(created).toBe(SETTING_KEYS.length)
      expect(await testDb.setting.count()).toBe(SETTING_KEYS.length)
    })

    it('повторный запуск ничего не создаёт и не затирает изменённое', async () => {
      const settings = makeService()
      await settings.seedDefaults()
      await settings.set('widget_title', 'Моё агентство')

      const created = await settings.seedDefaults()

      expect(created).toBe(0)
      expect(await settings.get('widget_title')).toBe('Моё агентство')
    })
  })

  describe('ключ Anthropic', () => {
    it('берётся из переменной окружения, пока не задан в админке', async () => {
      const settings = makeService({ ANTHROPIC_API_KEY: 'sk-ant-из-окружения' })
      await settings.seedDefaults()

      expect(await settings.getAnthropicApiKey()).toBe('sk-ant-из-окружения')
    })

    it('значение из админки перебивает переменную окружения', async () => {
      const settings = makeService({ ANTHROPIC_API_KEY: 'sk-ant-из-окружения' })
      await settings.set('anthropic_api_key', 'sk-ant-из-админки')

      expect(await settings.getAnthropicApiKey()).toBe('sk-ant-из-админки')
    })

    it('без ключа отдаёт пустую строку, а не падает', async () => {
      expect(await makeService().getAnthropicApiKey()).toBe('')
    })
  })

  describe('выдача наружу', () => {
    it('публичный конфиг содержит ровно то, что помечено public', async () => {
      const publicSettings = await makeService().getPublic()

      expect(Object.keys(publicSettings).sort()).toEqual([...PUBLIC_SETTING_KEYS].sort())
    })

    it('список публичных ключей совпадает с флагами public в определениях', () => {
      const flagged = SETTING_KEYS.filter((key) => getSettingDefinition(key).public === true).sort()

      expect(flagged).toEqual([...PUBLIC_SETTING_KEYS].sort())
    })

    it('в публичном конфиге нет ни одного секрета', async () => {
      const publicSettings = await makeService().getPublic()

      for (const key of Object.keys(publicSettings)) {
        expect(getSettingDefinition(key as never).secret).not.toBe(true)
      }
    })

    it('админка получает секреты замаскированными, но видит, что они заданы', async () => {
      const settings = makeService()
      await settings.set('anthropic_api_key', 'sk-ant-секрет')

      const rows = await settings.listForAdmin()
      const apiKey = rows.find((row) => row.key === 'anthropic_api_key')

      expect(apiKey?.value).not.toContain('секрет')
      expect(apiKey?.isSet).toBe(true)

      const webhook = rows.find((row) => row.key === 'lead_webhook_url')
      expect(webhook?.isSet).toBe(false)
    })

    it('маска, присланная обратно из админки, не затирает настоящий ключ', async () => {
      const settings = makeService()
      await settings.set('anthropic_api_key', 'sk-ant-секрет')
      const masked = (await settings.listForAdmin()).find((row) => row.key === 'anthropic_api_key')!

      await settings.applyPatch({ anthropic_api_key: masked.value })

      expect(await settings.getAnthropicApiKey()).toBe('sk-ant-секрет')
    })

    it('у каждой настройки есть русская подпись и раздел', () => {
      for (const key of SETTING_KEYS) {
        const definition = getSettingDefinition(key)
        expect(definition.label.length).toBeGreaterThan(0)
        expect(definition.group).toBeTruthy()
      }
    })
  })
})
