/**
 * Адрес тестовой базы данных.
 *
 * Один и тот же результат нужен трём местам: конфигу Vitest, глобальной
 * подготовке (поднять контейнер и накатить миграции) и самим тестам.
 * Файл намеренно без зависимостей — его импортирует vitest.config.ts.
 */

export const DEFAULT_TEST_DATABASE_URL =
  'postgresql://novostroyki:novostroyki@localhost:5434/novostroyki_test?schema=public'

export function resolveTestDatabaseUrl(source: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = source.TEST_DATABASE_URL
  return fromEnv !== undefined && fromEnv !== '' ? fromEnv : DEFAULT_TEST_DATABASE_URL
}
