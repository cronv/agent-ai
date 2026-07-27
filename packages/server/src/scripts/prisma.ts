import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

import { env } from '../config/env.js'
import { repoRoot, serverRoot } from '../config/paths.js'

/**
 * Обёртка над командами Prisma.
 *
 *   npm run migrate:deploy      →  tsx src/scripts/prisma.ts migrate deploy
 *
 * Зачем она нужна: Prisma читает `DATABASE_URL` только из окружения и из файла
 * `.env`. Приложение — умнее: если `.env` нет, оно берёт адрес базы по
 * умолчанию (`localhost:5433`, тот самый, что публикует `npm run db:up`).
 * Без обёртки `npm run migrate:deploy` на свежем клоне падал с
 * «Environment variable not found: DATABASE_URL», хотя всё для работы есть.
 *
 * Так адрес базы во всех командах берётся из одного места — `config/env.ts`.
 */

function prismaBinary(): string {
  const candidates = [
    join(serverRoot, 'node_modules', '.bin', 'prisma'),
    join(repoRoot, 'node_modules', '.bin', 'prisma'),
  ]
  return candidates.find((path) => existsSync(path)) ?? 'prisma'
}

const args = process.argv.slice(2)
if (args.length === 0) {
  console.error('Укажите команду Prisma, например: migrate deploy')
  process.exit(1)
}

const result = spawnSync(prismaBinary(), args, {
  cwd: serverRoot,
  env: { ...process.env, DATABASE_URL: env.databaseUrl },
  stdio: 'inherit',
})

process.exit(result.status ?? 1)
