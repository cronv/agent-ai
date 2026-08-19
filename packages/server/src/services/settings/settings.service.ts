import type { Prisma } from '@prisma/client'

import type { Db } from '../../db/prisma.js'
import { prisma as defaultPrisma } from '../../db/prisma.js'
import {
  PUBLIC_SETTING_KEYS,
  SETTING_DEFINITIONS,
  SETTING_KEYS,
  getSettingDefinition,
  isSettingKey,
  type PublicSettings,
  type SettingDefinition,
  type SettingKey,
  type SettingValues,
} from './definitions.js'

/**
 * Сервис настроек.
 *
 * Настройки лежат в таблице `settings` как «ключ → JSON-значение», но наружу
 * сервис отдаёт нормальные типы: строку строкой, число числом, список — массивом.
 * Ключи, которых нет в `SETTING_DEFINITIONS`, отвергаются: опечатка в имени
 * ломается сразу при вызове, а не молча превращается в undefined.
 *
 * Чтение никогда не падает и никогда не возвращает undefined:
 *   значение из базы → переменная окружения (если задан envFallback) → default.
 *
 * Пример:
 *   const prompt = await app.settings.get('system_prompt')
 *   const { widget_title, widget_accent_color } = await app.settings.getMany(
 *     'widget_title', 'widget_accent_color',
 *   )
 *   await app.settings.set('feed_sync_cron', '0 * * * *')
 */

export class UnknownSettingError extends Error {
  constructor(public readonly key: string) {
    super(`Неизвестная настройка: ${key}`)
    this.name = 'UnknownSettingError'
  }
}

export class SettingValidationError extends Error {
  constructor(
    public readonly key: string,
    message: string,
  ) {
    super(`Настройка ${key}: ${message}`)
    this.name = 'SettingValidationError'
  }
}

/** Строка настройки в том виде, в каком её показывает админка. */
export interface SettingView {
  key: SettingKey
  /** Значение; у секретов — замаскированное. */
  value: unknown
  type: SettingDefinition<unknown>['type']
  label: string
  description?: string
  group: SettingDefinition<unknown>['group']
  secret: boolean
  /** Для секрета: задано ли значение вообще (маска не позволяет это понять). */
  isSet: boolean
  /** Значение отличается от значения по умолчанию. */
  isCustom: boolean
}

export interface SettingsServiceOptions {
  db?: Db
  /** Источник переменных окружения для envFallback. Подменяется в тестах. */
  processEnv?: NodeJS.ProcessEnv
}

const SECRET_MASK = '••••••••'

export class SettingsService {
  private readonly db: Db
  private readonly processEnv: NodeJS.ProcessEnv

  constructor(options: SettingsServiceOptions = {}) {
    this.db = options.db ?? defaultPrisma
    this.processEnv = options.processEnv ?? process.env
  }

  // ── Чтение ────────────────────────────────────────────────

  /** Значение одной настройки. Всегда возвращает значение нужного типа. */
  async get<K extends SettingKey>(key: K): Promise<SettingValues[K]> {
    assertKnownKey(key)
    const row = await this.db.setting.findUnique({ where: { key } })
    return this.resolve(key, row?.value)
  }

  /** Несколько настроек одним запросом. */
  async getMany<K extends SettingKey>(...keys: K[]): Promise<Pick<SettingValues, K>> {
    keys.forEach(assertKnownKey)
    const rows = await this.db.setting.findMany({ where: { key: { in: keys } } })
    const stored = new Map(rows.map((row) => [row.key, row.value]))
    const result = {} as Pick<SettingValues, K>
    for (const key of keys) {
      result[key] = this.resolve(key, stored.get(key))
    }
    return result
  }

  /** Все настройки разом — удобно для формы в админке и для движка диалога. */
  async getAll(): Promise<SettingValues> {
    const rows = await this.db.setting.findMany()
    const stored = new Map(rows.map((row) => [row.key, row.value]))
    const result = {} as SettingValues
    for (const key of SETTING_KEYS) {
      // @ts-expect-error — ключ и значение согласованы по построению
      result[key] = this.resolve(key, stored.get(key))
    }
    return result
  }

  /** Публичные настройки виджета. Секретов здесь нет по определению. */
  async getPublic(): Promise<PublicSettings> {
    return this.getMany(...PUBLIC_SETTING_KEYS)
  }

  /**
   * Настройки для экрана админки: со значениями, подписями и типами.
   * Секреты заменены маской — реальный ключ Anthropic наружу не уходит.
   */
  async listForAdmin(): Promise<SettingView[]> {
    const values = await this.getAll()
    return SETTING_KEYS.map((key) => {
      const definition = getSettingDefinition(key)
      const value = values[key]
      const isSet = !(typeof value === 'string' && value === '')
      const view: SettingView = {
        key,
        value: definition.secret ? (isSet ? SECRET_MASK : '') : value,
        type: definition.type,
        group: definition.group,
        label: definition.label,
        secret: definition.secret === true,
        isSet,
        isCustom: JSON.stringify(value) !== JSON.stringify(definition.default),
      }
      if (definition.description !== undefined) view.description = definition.description
      return view
    })
  }

  /**
   * Ключ Anthropic: сначала из настроек, потом из переменной окружения.
   * Пустая строка означает «ключ не задан» — чат об этом честно сообщает,
   * а приложение продолжает работать.
   */
  async getAnthropicApiKey(): Promise<string> {
    return this.get('anthropic_api_key')
  }

  /**
   * Адрес, по которому идут запросы к Claude. Пустая строка — напрямую
   * в Anthropic. Непустая — шлюз-посредник; он нужен, когда сервер стоит
   * в стране, которую Anthropic не обслуживает (Россия в их списке
   * отсутствует, и запрос с российского адреса получает отказ 403).
   */
  async getAnthropicBaseUrl(): Promise<string> {
    return (await this.get('anthropic_base_url')).trim()
  }

  // ── Запись ────────────────────────────────────────────────

  /** Записывает одну настройку. Возвращает то, что реально сохранилось. */
  async set<K extends SettingKey>(key: K, value: SettingValues[K]): Promise<SettingValues[K]> {
    assertKnownKey(key)
    const normalized = coerce(key, value)
    await this.db.setting.upsert({
      where: { key },
      create: { key, value: normalized as Prisma.InputJsonValue },
      update: { value: normalized as Prisma.InputJsonValue },
    })
    return normalized
  }

  /**
   * Записывает несколько настроек за раз — форма настроек в админке
   * сохраняется одной транзакцией: либо всё, либо ничего.
   */
  async setMany(patch: Partial<SettingValues>): Promise<void> {
    const entries = Object.entries(patch) as [SettingKey, unknown][]
    const normalized = entries.map(([key, value]) => {
      assertKnownKey(key)
      return { key, value: coerce(key, value) as Prisma.InputJsonValue }
    })
    if (normalized.length === 0) return
    await this.db.$transaction(
      normalized.map(({ key, value }) =>
        this.db.setting.upsert({ where: { key }, create: { key, value }, update: { value } }),
      ),
    )
  }

  /**
   * То же, что setMany, но принимает неизвестно что (тело HTTP-запроса):
   * лишние ключи отбрасываются, значения приводятся к нужным типам,
   * непригодные — приводят к SettingValidationError.
   */
  async applyPatch(raw: Record<string, unknown>): Promise<SettingKey[]> {
    const patch: Partial<SettingValues> = {}
    const applied: SettingKey[] = []
    for (const [key, value] of Object.entries(raw)) {
      if (!isSettingKey(key)) continue
      // Маска секрета означает «оставить как было»
      if (getSettingDefinition(key).secret && value === SECRET_MASK) continue
      // @ts-expect-error — тип проверяется в coerce внутри setMany
      patch[key] = value
      applied.push(key)
    }
    await this.setMany(patch)
    return applied
  }

  /** Возвращает настройку к значению по умолчанию. */
  async reset<K extends SettingKey>(key: K): Promise<SettingValues[K]> {
    assertKnownKey(key)
    await this.db.setting.deleteMany({ where: { key } })
    return this.get(key)
  }

  /**
   * Создаёт недостающие строки настроек значениями по умолчанию.
   * Вызывается при старте сервера. Уже изменённые значения не трогает,
   * поэтому вызывать можно сколько угодно раз.
   * Возвращает количество созданных строк.
   */
  async seedDefaults(): Promise<number> {
    const existing = await this.db.setting.findMany({ select: { key: true } })
    const known = new Set(existing.map((row) => row.key))
    const missing = SETTING_KEYS.filter((key) => !known.has(key))
    if (missing.length === 0) return 0
    const result = await this.db.setting.createMany({
      data: missing.map((key) => ({
        key,
        value: SETTING_DEFINITIONS[key].default as Prisma.InputJsonValue,
      })),
      skipDuplicates: true,
    })
    return result.count
  }

  // ── Внутреннее ────────────────────────────────────────────

  /** база → переменная окружения → значение по умолчанию. */
  private resolve<K extends SettingKey>(key: K, stored: unknown): SettingValues[K] {
    const definition = getSettingDefinition(key)
    if (stored !== undefined && stored !== null) {
      try {
        const value = coerce(key, stored)
        // Пустая строка в базе не должна перебивать переменную окружения
        if (!(value === '' && definition.envFallback)) return value
      } catch {
        // Мусор в базе не должен ронять приложение — берём значение по умолчанию
      }
    }
    if (definition.envFallback) {
      const fromEnv = this.processEnv[definition.envFallback]
      if (fromEnv !== undefined && fromEnv !== '') {
        try {
          return coerce(key, fromEnv)
        } catch {
          /* игнорируем негодное значение из окружения */
        }
      }
    }
    return definition.default
  }
}

function assertKnownKey(key: string): asserts key is SettingKey {
  if (!isSettingKey(key)) throw new UnknownSettingError(key)
}

/** Проверяет и приводит значение к типу настройки. */
export function coerce<K extends SettingKey>(key: K, raw: unknown): SettingValues[K] {
  const { type } = getSettingDefinition(key)
  const fail = (message: string): never => {
    throw new SettingValidationError(key, message)
  }

  switch (type) {
    case 'string':
    case 'text': {
      if (typeof raw === 'string') return raw as SettingValues[K]
      if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw) as SettingValues[K]
      if (raw === null) return '' as SettingValues[K]
      return fail(`ожидалась строка, получено ${describe(raw)}`)
    }
    case 'number': {
      if (typeof raw === 'number' && Number.isFinite(raw)) return raw as SettingValues[K]
      if (typeof raw === 'string' && raw.trim() !== '') {
        const parsed = Number(raw)
        if (Number.isFinite(parsed)) return parsed as SettingValues[K]
      }
      return fail(`ожидалось число, получено ${describe(raw)}`)
    }
    case 'boolean': {
      if (typeof raw === 'boolean') return raw as SettingValues[K]
      if (raw === 'true' || raw === '1') return true as SettingValues[K]
      if (raw === 'false' || raw === '0') return false as SettingValues[K]
      return fail(`ожидалось да/нет, получено ${describe(raw)}`)
    }
    case 'string[]': {
      if (Array.isArray(raw)) {
        if (!raw.every((item) => typeof item === 'string')) {
          return fail('ожидался список строк')
        }
        return raw.map((item) => item.trim()).filter((item) => item !== '') as SettingValues[K]
      }
      if (typeof raw === 'string') {
        return raw
          .split('\n')
          .map((item) => item.trim())
          .filter((item) => item !== '') as SettingValues[K]
      }
      return fail(`ожидался список строк, получено ${describe(raw)}`)
    }
    default:
      return fail(`неизвестный тип настройки: ${String(type)}`)
  }
}

function describe(value: unknown): string {
  if (value === null) return 'null'
  if (Array.isArray(value)) return 'список'
  return typeof value
}

/** Экземпляр по умолчанию — работает с общим клиентом Prisma. */
export const settings: SettingsService = new SettingsService()
