import { defineConfig } from 'vitest/config'

import { resolveTestDatabaseUrl } from './src/testing/database-url.js'

const testDatabaseUrl = resolveTestDatabaseUrl()

export default defineConfig({
  test: {
    globals: false,
    environment: 'node',
    include: ['src/**/*.test.ts'],
    globalSetup: ['./src/testing/global-setup.ts'],
    setupFiles: ['./src/testing/setup.ts'],
    // Тесты делят одну базу данных, поэтому идут по одному файлу за раз.
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 60_000,
    env: {
      NODE_ENV: 'test',
      LOG_LEVEL: 'silent',
      DATABASE_URL: testDatabaseUrl,
      TEST_DATABASE_URL: testDatabaseUrl,
    },
  },
})
