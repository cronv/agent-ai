import { afterAll } from 'vitest'

import { disconnectTestDb } from './db.js'

/** Общая обвязка для всех файлов тестов. */

afterAll(async () => {
  await disconnectTestDb()
})
