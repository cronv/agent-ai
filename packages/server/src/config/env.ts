import { existsSync } from 'node:fs'
import { join } from 'node:path'
import dotenv from 'dotenv'

import { repoRoot, serverRoot } from './paths.js'

/**
 * Переменные окружения приложения.
 *
 * Значения читаются один раз при старте. Файл `.env` ищется сначала рядом
 * с пакетом server, затем в корне репозитория; уже заданные переменные
 * окружения имеют приоритет над файлом (важно для Docker).
 */

export interface AppEnv {
  nodeEnv: 'development' | 'test' | 'production'
  isProduction: boolean
  isTest: boolean
  port: number
  host: string
  logLevel: string
  databaseUrl: string
  publicBaseUrl: string
  adminUsername: string
  adminPassword: string
  sessionSecret: string
  /** Запасной ключ Anthropic; основной хранится в настройках базы. */
  anthropicApiKey: string
  /**
   * Домены, с которых виджету разрешено дёргать публичное API чата.
   * Пустой список означает «с любого» — виджет ставится на чужие сайты,
   * и заранее их адреса неизвестны. Заполняется, когда сайты известны.
   */
  widgetAllowedOrigins: string[]
}

let dotenvLoaded = false

/** Подхватывает `.env`, если он есть. Повторные вызовы ничего не делают. */
export function loadDotEnv(): void {
  if (dotenvLoaded) return
  dotenvLoaded = true
  const candidates = [join(serverRoot, '.env'), join(repoRoot, '.env')]
  for (const path of candidates) {
    if (existsSync(path)) dotenv.config({ path, override: false, quiet: true })
  }
}

function str(source: NodeJS.ProcessEnv, key: string, fallback: string): string {
  const value = source[key]
  return value === undefined || value === '' ? fallback : value
}

function int(source: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = source[key]
  if (raw === undefined || raw === '') return fallback
  const parsed = Number.parseInt(raw, 10)
  if (Number.isNaN(parsed)) {
    throw new Error(`Переменная окружения ${key} должна быть числом, получено: ${raw}`)
  }
  return parsed
}

/** Список через запятую. Пустые элементы и пробелы отбрасываются. */
function list(source: NodeJS.ProcessEnv, key: string): string[] {
  const raw = source[key]
  if (raw === undefined) return []
  return raw
    .split(',')
    .map((item) => item.trim().replace(/\/+$/, ''))
    .filter((item) => item !== '')
}

const DEFAULT_DATABASE_URL = 'postgresql://novostroyki:novostroyki@localhost:5433/novostroyki?schema=public'

export function loadEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const nodeEnvRaw = str(source, 'NODE_ENV', 'development')
  const nodeEnv: AppEnv['nodeEnv'] =
    nodeEnvRaw === 'production' || nodeEnvRaw === 'test' ? nodeEnvRaw : 'development'

  return {
    nodeEnv,
    isProduction: nodeEnv === 'production',
    isTest: nodeEnv === 'test',
    port: int(source, 'PORT', 3000),
    host: str(source, 'HOST', '0.0.0.0'),
    logLevel: str(source, 'LOG_LEVEL', nodeEnv === 'test' ? 'silent' : 'info'),
    databaseUrl: str(source, 'DATABASE_URL', DEFAULT_DATABASE_URL),
    publicBaseUrl: str(source, 'PUBLIC_BASE_URL', `http://localhost:${int(source, 'PORT', 3000)}`),
    adminUsername: str(source, 'ADMIN_USERNAME', 'admin'),
    adminPassword: str(source, 'ADMIN_PASSWORD', 'change-me-please'),
    sessionSecret: str(source, 'SESSION_SECRET', 'change-me-to-a-long-random-string'),
    anthropicApiKey: str(source, 'ANTHROPIC_API_KEY', ''),
    widgetAllowedOrigins: list(source, 'WIDGET_ALLOWED_ORIGINS'),
  }
}

loadDotEnv()

/** Готовая конфигурация. Импортируйте её, отдельный вызов loadEnv не нужен. */
export const env: AppEnv = loadEnv()
