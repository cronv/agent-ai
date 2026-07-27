import { execFileSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { PrismaClient } from '@prisma/client'

import { repoRoot, serverRoot } from '../config/paths.js'
import { resolveTestDatabaseUrl } from './database-url.js'

/**
 * Подготовка тестовой базы — выполняется один раз перед всем прогоном.
 *
 * 1. Если база не отвечает, поднимает контейнер `postgres-test`
 *    (docker compose, профиль test) и ждёт готовности.
 * 2. Накатывает миграции Prisma.
 *
 * Тесты работают против настоящего PostgreSQL: tsvector, полнотекстовый
 * поиск и уникальные индексы нельзя проверить на подменённом клиенте.
 */

const CONNECT_TIMEOUT_MS = 90_000

async function canConnect(url: string): Promise<boolean> {
  const client = new PrismaClient({ datasourceUrl: url })
  try {
    await client.$queryRaw`SELECT 1`
    return true
  } catch {
    return false
  } finally {
    await client.$disconnect().catch(() => undefined)
  }
}

async function waitForConnection(url: string, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs
  for (;;) {
    if (await canConnect(url)) return
    if (Date.now() > deadline) {
      throw new Error(
        `Тестовая база не отвечает: ${url}\n` +
          'Поднимите её вручную:  npm run db:test:up\n' +
          'Или укажите свою базу через переменную TEST_DATABASE_URL.',
      )
    }
    await new Promise((resolve) => setTimeout(resolve, 1000))
  }
}

function prismaBinary(): string {
  const candidates = [
    join(serverRoot, 'node_modules', '.bin', 'prisma'),
    join(repoRoot, 'node_modules', '.bin', 'prisma'),
  ]
  return candidates.find((path) => existsSync(path)) ?? 'prisma'
}

export default async function setup(): Promise<void> {
  const url = resolveTestDatabaseUrl()
  process.env.TEST_DATABASE_URL = url
  process.env.DATABASE_URL = url
  process.env.NODE_ENV = 'test'

  if (!(await canConnect(url))) {
    console.log('→ Поднимаю тестовую базу данных в Docker…')
    try {
      execFileSync('docker', ['compose', '--profile', 'test', 'up', '-d', '--wait', 'postgres-test'], {
        cwd: repoRoot,
        stdio: 'inherit',
      })
    } catch {
      throw new Error(
        'Не удалось запустить контейнер с тестовой базой.\n' +
          'Убедитесь, что Docker запущен, и повторите: npm run db:test:up',
      )
    }
    await waitForConnection(url, CONNECT_TIMEOUT_MS)
  }

  console.log('→ Накатываю миграции на тестовую базу…')
  execFileSync(prismaBinary(), ['migrate', 'deploy'], {
    cwd: serverRoot,
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'inherit',
  })
}
