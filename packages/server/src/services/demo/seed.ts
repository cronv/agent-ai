import type { Db } from '../../db/prisma.js'
import { prisma as defaultPrisma } from '../../db/prisma.js'
import { importFeed } from '../feeds/index.js'
import { deleteDocument, ingestDocument } from '../knowledge/index.js'
import { SettingsService } from '../settings/index.js'
import { DEMO_FEED_NAME, DEMO_FEED_PATH, DEMO_KNOWLEDGE_FILENAME, readDemoFeedXml, readDemoKnowledgeDoc } from './assets.js'

/**
 * Засев демонстрационных данных.
 *
 *   npm run seed:demo
 *
 * Человек, который впервые открыл проект, должен увидеть работающего
 * ассистента до того, как получил фиды застройщиков и ключ Anthropic.
 * Команда заводит выгрузку, импортирует из неё квартиры, дополняет карточки
 * ЖК описаниями, загружает документ базы знаний и создаёт настройки
 * по умолчанию.
 *
 * Повторный запуск не плодит дубли:
 *   - фид ищется по имени и обновляется, а не создаётся заново;
 *   - квартиры пишутся upsert-ом по (feedId, externalId) — это обычный импорт;
 *   - карточки ЖК дополняются только там, где поле пустое: правки, сделанные
 *     руками в админке, засев не затирает;
 *   - документ базы знаний с тем же именем удаляется и загружается заново,
 *     иначе фрагменты нашлись бы дважды.
 *
 * Интернет не нужен: XML читается с диска и передаётся импорту напрямую.
 * Адрес фида при этом остаётся настоящим (`/demo/feed.xml` на самом сервере) —
 * кнопка «Обновить сейчас» в админке работает так же, как для чужой выгрузки.
 */

export interface SeedDemoOptions {
  db?: Db
  settings?: SettingsService
  /**
   * Публичный адрес приложения. Подставляется в ссылки на планировки и
   * в адрес самого фида.
   */
  baseUrl: string
  /** Куда писать ход работы. По умолчанию — молча. */
  log?: (message: string) => void
}

export interface SeedDemoResult {
  settingsCreated: number
  feedId: string
  apartmentsCreated: number
  apartmentsUpdated: number
  projectsCreated: number
  projectsDescribed: number
  knowledgeChunks: number
  /** Текст ошибки импорта; при успехе — `null`. */
  error: string | null
}

/**
 * Чего нет в выгрузке застройщика, но что должно быть в карточке ЖК.
 * Ключ — название комплекса ровно так, как оно написано в `demo/feed.xml`.
 */
const PROJECT_DETAILS: Record<string, { deadline: string; finishing: string; description: string }> = {
  'ЖК «Северный ветер»': {
    deadline: '2027-12-31',
    finishing: 'чистовая, предчистовая, без отделки',
    description:
      'Два монолитных корпуса на 24 этажа в Головинском районе, 7 минут пешком до метро «Водный стадион». ' +
      'Рядом Химкинское водохранилище и парк Дружбы. Корпус 3 сдаётся во II квартале 2027 года, корпус 5 — в IV. ' +
      'Застройщик субсидирует ипотечную ставку на первые два года и даёт беспроцентную рассрочку до ключей.',
  },
  'ЖК «Лобачевский парк»': {
    deadline: '2026-12-31',
    finishing: 'предчистовая, дизайнерская, без отделки',
    description:
      'Бизнес-класс в Раменках, 8 минут пешком до метро «Мичуринский проспект». Дома построены, идёт благоустройство: ' +
      'ключи в IV квартале 2026 года, сроки не переносились. Подземный паркинг сдаётся вместе с домом. ' +
      'Самые просторные планировки среди демонстрационных проектов и самая высокая цена за метр.',
  },
  'ЖК «Преображенский двор»': {
    deadline: '2027-09-30',
    finishing: 'чистовая, без отделки',
    description:
      'Квартал в Преображенском, 5 минут пешком до метро «Преображенская площадь» — ближе к метро, чем остальные ' +
      'демонстрационные проекты. Сдача в III квартале 2027 года, срок переносился один раз. ' +
      'Во втором корпусе школа на 550 мест и детский сад на 200 мест.',
  },
  'ЖК «Некрасовка парк»': {
    deadline: '2028-06-30',
    finishing: 'чистовая, без отделки',
    description:
      'Самый доступный вход в демонстрационной базе: студии от 5,3 млн ₽. Некрасовка, 11 минут пешком до одноимённой ' +
      'станции метро. Корпус 1 сдаётся в IV квартале 2027 года, корпус 2 — во II квартале 2028 года. ' +
      'Рассрочка с первым взносом 15% и субсидированная ставка от застройщика.',
  },
}

export async function seedDemoData(options: SeedDemoOptions): Promise<SeedDemoResult> {
  const db = options.db ?? defaultPrisma
  const settings = options.settings ?? new SettingsService({ db })
  const baseUrl = options.baseUrl.replace(/\/+$/, '')
  const log = options.log ?? ((): void => undefined)

  const settingsCreated = await settings.seedDefaults()
  log(`Настройки: создано значений по умолчанию — ${settingsCreated}`)

  const feed = await upsertDemoFeed(db, `${baseUrl}${DEMO_FEED_PATH}`)
  log(`Выгрузка: ${feed.url}`)

  // XML читается с диска и передаётся импорту напрямую: сервер в момент
  // засева может быть ещё не поднят, а скачивать с самого себя незачем.
  const imported = await importFeed(feed.id, { db, xml: readDemoFeedXml(baseUrl) })
  if (imported.status === 'error') {
    log(`Импорт не удался: ${imported.error ?? 'причина неизвестна'}`)
  } else {
    log(
      `Квартиры: заведено ${imported.created}, обновлено ${imported.updated}, ` +
        `ЖК создано ${imported.projectsCreated}`,
    )
  }

  const projectsDescribed = await describeProjects(db)
  log(`Карточки ЖК: дополнено — ${projectsDescribed}`)

  const knowledgeChunks = await reingestDemoDocument(db)
  log(`База знаний: «${DEMO_KNOWLEDGE_FILENAME}», фрагментов — ${knowledgeChunks}`)

  return {
    settingsCreated,
    feedId: feed.id,
    apartmentsCreated: imported.created,
    apartmentsUpdated: imported.updated,
    projectsCreated: imported.projectsCreated,
    projectsDescribed,
    knowledgeChunks,
    error: imported.error,
  }
}

/**
 * Засев при старте сервера — вторая проверка, страхующая первую.
 *
 * Смысл автозасева в том, чтобы `docker compose up` на чистой машине сразу
 * давал живого ассистента с квартирами: человек, который видит проект впервые,
 * не должен искать вторую команду.
 *
 * Решение «это самый первый старт на новой базе» принимает вызывающий
 * (`index.ts`) — по тому, что таблица настроек была пуста. Это важно: администратор
 * имеет полное право удалить демо-выгрузку и демо-ЖК через админку, и после
 * этого база снова выглядит «пустой». Если бы условием была только пустота,
 * ближайший перезапуск контейнера вернул бы четыре вымышленных ЖК на боевой
 * стенд — ровно туда, откуда их только что убрали.
 *
 * Здесь остаётся вторая проверка на случай, если данные всё же успели
 * появиться раньше первого старта сервера (например, засевом из командной
 * строки или восстановлением дампа).
 *
 * Возвращает результат засева или `null`, если засевать не понадобилось.
 */
export async function seedDemoIfEmpty(options: SeedDemoOptions): Promise<SeedDemoResult | null> {
  const db = options.db ?? defaultPrisma
  const [feeds, projects] = await Promise.all([db.feed.count(), db.project.count()])
  if (feeds > 0 || projects > 0) return null
  return seedDemoData(options)
}

/**
 * Демо-фид ищется по имени: адрес мог поменяться вместе с PUBLIC_BASE_URL.
 * Берётся самый ранний из подходящих — если два одновременных запуска команды
 * успели завести по фиду, следующие запуски сойдутся на одном и том же.
 */
async function upsertDemoFeed(db: Db, url: string): Promise<{ id: string; url: string }> {
  const existing = await db.feed.findFirst({
    where: { name: DEMO_FEED_NAME },
    orderBy: { createdAt: 'asc' },
    select: { id: true },
  })
  if (existing) {
    return db.feed.update({
      where: { id: existing.id },
      data: { url, format: 'yandex', isActive: true },
      select: { id: true, url: true },
    })
  }
  return db.feed.create({
    data: { name: DEMO_FEED_NAME, url, format: 'yandex', isActive: true },
    select: { id: true, url: true },
  })
}

/**
 * Срок сдачи, отделка и описание — то, чего в выгрузке нет, а в карточке ЖК
 * должно быть. Заполняется только пустое: если администратор уже написал своё
 * описание, повторный засев его не тронет.
 */
async function describeProjects(db: Db): Promise<number> {
  let touched = 0
  for (const [name, details] of Object.entries(PROJECT_DETAILS)) {
    const project = await db.project.findFirst({
      where: { name: { equals: name, mode: 'insensitive' } },
      select: { id: true, deadline: true, finishing: true, description: true },
    })
    if (!project) continue

    const data: { deadline?: Date; finishing?: string; description?: string } = {}
    if (project.deadline === null) data.deadline = new Date(`${details.deadline}T00:00:00.000Z`)
    if (project.finishing === null) data.finishing = details.finishing
    if (project.description === null) data.description = details.description
    if (Object.keys(data).length === 0) continue

    await db.project.update({ where: { id: project.id }, data })
    touched += 1
  }
  return touched
}

/**
 * Документ базы знаний. Старая копия удаляется вместе с фрагментами —
 * иначе после второго засева поиск находил бы каждый абзац дважды.
 */
async function reingestDemoDocument(db: Db): Promise<number> {
  const previous = await db.knowledgeDoc.findMany({
    where: { filename: DEMO_KNOWLEDGE_FILENAME },
    select: { id: true },
  })
  for (const doc of previous) {
    await deleteDocument(db, doc.id)
  }

  const file = readDemoKnowledgeDoc()
  // Документ общий: условия описывают все четыре демо-ЖК сразу.
  const summary = await ingestDocument(db, { ...file, projectId: null })
  return summary.chunkCount
}
