import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { demoDir } from '../../config/paths.js'

/**
 * Файлы демонстрационного комплекта.
 *
 *   demo/feed.xml                        выгрузка на 30 квартир в 4 ЖК
 *   demo/plans/*.svg                     планировки-заглушки
 *   demo/knowledge/*.md                  документ базы знаний
 *
 * Всё лежит в проекте и раздаётся самим сервером: демо должно работать на
 * ноутбуке без интернета, а импорт фида умеет ходить только по http(s).
 * Поэтому фид «скачивается» с собственного адреса приложения.
 */

/** Адрес, по которому сервер отдаёт демо-выгрузку. */
export const DEMO_FEED_PATH = '/demo/feed.xml'

/** Как демо-фид называется в админке. По имени же он и находится при повторном засеве. */
export const DEMO_FEED_NAME = 'Демо-выгрузка (4 ЖК, 30 квартир)'

export const DEMO_KNOWLEDGE_FILENAME = 'Ипотека и сроки сдачи — демо.md'

/**
 * Метка внутри `demo/feed.xml`, вместо которой подставляется публичный адрес
 * приложения. Ссылки на планировки обязаны быть абсолютными: карточку виджет
 * рисует на чужом сайте, и относительный путь там ведёт в никуда.
 */
const BASE_URL_PLACEHOLDER = /\{\{BASE_URL\}\}/g

/** Демо-выгрузка с подставленным адресом приложения. */
export function readDemoFeedXml(baseUrl: string): string {
  const xml = readFileSync(join(demoDir, 'feed.xml'), 'utf8')
  return xml.replace(BASE_URL_PLACEHOLDER, baseUrl.replace(/\/+$/, ''))
}

/** Демо-документ базы знаний в том виде, в каком его принимает `ingestDocument`. */
export function readDemoKnowledgeDoc(): { filename: string; mimeType: string; buffer: Buffer } {
  return {
    filename: DEMO_KNOWLEDGE_FILENAME,
    mimeType: 'text/markdown',
    buffer: readFileSync(join(demoDir, 'knowledge', 'ipoteka-i-sroki-sdachi.md')),
  }
}

/** Полный путь до планировки. Имя проверяется вызывающим — сюда попадает уже безопасное. */
export function demoPlanFile(name: string): string {
  return join(demoDir, 'plans', name)
}
