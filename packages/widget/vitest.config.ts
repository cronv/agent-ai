import { defineConfig } from 'vitest/config'

/**
 * Тесты виджета — только чистая логика: ритм ответа, разбор SSE, форматирование.
 * Ни браузера, ни базы здесь не нужно, поэтому окружение node и никаких
 * подготовительных шагов: `npm test` в корне гоняет их вместе с серверными.
 */
export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
