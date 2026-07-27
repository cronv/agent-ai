import { existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * Пути внутри монорепозитория.
 *
 * Считаются от расположения этого файла, а не от текущего каталога, —
 * поэтому сервер одинаково работает из `packages/server`, из корня
 * репозитория и внутри Docker-образа.
 */

const here = dirname(fileURLToPath(import.meta.url))

function findUp(startDir: string, marker: string): string | null {
  let dir = startDir
  for (let i = 0; i < 12; i += 1) {
    if (existsSync(join(dir, marker))) return dir
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return null
}

/** Корень пакета server (там, где лежат package.json и prisma/). */
export const serverRoot: string = findUp(here, 'prisma/schema.prisma') ?? resolve(here, '../..')

/** Корень монорепозитория (там, где лежат docker-compose.yml и .env). */
export const repoRoot: string = findUp(serverRoot, 'docker-compose.yml') ?? resolve(serverRoot, '../..')

/** Каталог со собранной админкой. */
export const adminDistDir: string = join(repoRoot, 'packages', 'admin', 'dist')

/** Файл собранного виджета. */
export const widgetBundleFile: string = join(repoRoot, 'packages', 'widget', 'dist', 'widget.js')

/**
 * Каталог демонстрационных данных: выгрузка квартир, планировки-заглушки и
 * документ базы знаний. Лежит внутри пакета server и раздаётся им же —
 * благодаря этому засев и импорт работают без интернета.
 */
export const demoDir: string = join(serverRoot, 'demo')
