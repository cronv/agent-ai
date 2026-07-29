import type { Db } from '../../db/prisma.js'
import type { ApartmentCard } from './apartments.js'
import type { StoredToolCall } from './history.js'

/**
 * Кнопка «смотреть ЖК на сайте» под ответом ассистента.
 *
 *   const links = await resolveProjectLinks(db, collectProjectCandidates(turn), shownRecently)
 *
 * ── Почему это решает сервер, а не модель ──────────────────────────────────
 *
 * Кнопку можно было отдать модели отдельным инструментом, как реплики быстрых
 * ответов. Но кнопка перехода — не реплика: она уводит человека с сайта, и
 * появляться должна редко и по делу. Модель, получив такую возможность, ставит
 * её под каждым вторым ответом — ровно то, от чего кнопка теряет силу. Здесь же
 * повод виден из фактов хода: какие инструменты вызывались, с какими
 * параметрами и что вернули. Это дешевле (ни одного лишнего токена) и
 * предсказуемо.
 *
 * ── Поводы показать кнопку ─────────────────────────────────────────────────
 *
 *   1. Спросили про конкретный ЖК — list_projects вернул один комплекс.
 *   2. Сравнивают два комплекса — list_projects вернул два: кнопка на каждый.
 *   3. Просят показать квартиры комплекса — search_apartments с project_ids.
 *   4. Подборка целиком из одного ЖК, в том числе «это все варианты здесь».
 *   5. Вопрос про инфраструктуру, сроки или условия конкретного ЖК —
 *      search_knowledge, где project_id разрешился в комплекс.
 *
 * ── Когда кнопки нет ───────────────────────────────────────────────────────
 *
 *   - комплексов набралось больше двух: разговор идёт про каталог вообще,
 *     и три-четыре кнопки под ответом — это уже меню, а не подсказка;
 *   - у ЖК не заполнен адрес: битая ссылка хуже отсутствующей;
 *   - ЖК выключен в админке — его нет в чате, значит нет и кнопки;
 *   - ссылка на этот же ЖК уже была в последних ответах: разговор про один
 *     комплекс идёт вглубь, и кнопка под каждым сообщением превращается в шум.
 */

/** Ссылка на карточку ЖК в том виде, в каком её получает виджет. */
export interface ProjectLink {
  id: string
  name: string
  url: string
}

/** Больше двух кнопок под ответом — это уже меню. */
export const PROJECT_LINK_MAX = 2

/**
 * Через сколько ответов ассистента ссылку на тот же ЖК можно показать снова.
 * Три — это примерно один заход разговора: спросили про комплекс, уточнили
 * сроки, спросили про отделку. Кнопка в начале этого захода уже была.
 */
export const PROJECT_LINK_COOLDOWN = 3

/** Что произошло за ход — из этого и виден повод для кнопки. */
export interface TurnFacts {
  toolCalls: StoredToolCall[]
  /** Квартиры, показанные этим ответом. */
  apartments: ApartmentCard[]
}

/**
 * Идентификаторы ЖК, на которые уместно дать кнопку.
 *
 * Функция чистая: ни базы, ни адресов. Проверять её можно без всякой модели,
 * а решение «показывать или нет» остаётся одним и тем же в тестах и в бою.
 */
export function collectProjectCandidates(turn: TurnFacts): string[] {
  const found = new Set<string>()

  for (const call of turn.toolCalls) {
    if (call.isError) continue

    // 1 и 2: спросили про комплекс или сравнивают два.
    if (call.name === 'list_projects') {
      for (const id of projectIdsFromResult(call.result)) found.add(id)
    }

    // 3: просят квартиры конкретного комплекса.
    if (call.name === 'search_apartments') {
      for (const id of asStrings(asRecord(call.input)['project_ids'])) found.add(id)
    }

    // 5: вопрос про инфраструктуру, сроки или условия конкретного ЖК.
    // Берём то, во что название разрешилось на самом деле, а не то, что
    // написала модель: она регулярно кладёт туда «Космос» вместо идентификатора.
    if (call.name === 'search_knowledge') {
      const resolved = asRecord(safeParse(call.result))['project_id']
      if (typeof resolved === 'string' && resolved !== '') found.add(resolved)
    }
  }

  // 4: вся подборка из одного ЖК — включая случай «это все варианты здесь».
  const shown = new Set(
    turn.apartments.map((card) => card.projectId).filter((id): id is string => typeof id === 'string'),
  )
  if (shown.size === 1) for (const id of shown) found.add(id)

  // Комплексов набралось больше двух — разговор не про конкретный дом.
  return found.size > PROJECT_LINK_MAX ? [] : [...found]
}

/**
 * Идентификаторы → готовые ссылки.
 *
 * Здесь отсеивается всё, из-за чего кнопка вела бы в никуда: выключенный ЖК,
 * незаполненный адрес, комплекс, ссылку на который посетитель уже видел.
 */
export async function resolveProjectLinks(
  db: Db,
  ids: string[],
  shownRecently: readonly string[] = [],
): Promise<ProjectLink[]> {
  const wanted = ids.filter((id) => !shownRecently.includes(id))
  if (wanted.length === 0) return []

  const rows = await db.project.findMany({
    where: { id: { in: wanted }, isActive: true, url: { not: null } },
    select: { id: true, name: true, url: true },
    orderBy: { name: 'asc' },
  })

  return rows
    .filter((row): row is { id: string; name: string; url: string } => typeof row.url === 'string' && row.url !== '')
    .slice(0, PROJECT_LINK_MAX)
    .map((row) => ({ id: row.id, name: row.name, url: row.url }))
}

/**
 * Ссылки, поднятые из Json-колонки сообщения.
 * Читаем осторожно: колонку мог записать прошлый выпуск или чужая рука.
 */
export function parseProjectLinks(value: unknown): ProjectLink[] {
  if (!Array.isArray(value)) return []
  const links: ProjectLink[] = []
  for (const item of value) {
    const record = asRecord(item)
    const { id, name, url } = record
    if (typeof id !== 'string' || typeof name !== 'string' || typeof url !== 'string') continue
    if (id === '' || url === '') continue
    links.push({ id, name, url })
  }
  return links
}

/** `{"found":2,"projects":[{"id":"…"}]}` → идентификаторы, если их один-два. */
function projectIdsFromResult(result: string): string[] {
  const projects = asRecord(safeParse(result))['projects']
  if (!Array.isArray(projects)) return []
  const ids = projects
    .map((item) => asRecord(item)['id'])
    .filter((id): id is string => typeof id === 'string' && id !== '')
  return ids.length > 0 && ids.length <= PROJECT_LINK_MAX ? ids : []
}

function safeParse(value: string): unknown {
  try {
    return JSON.parse(value)
  } catch {
    return {}
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function asStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return typeof value === 'string' && value !== '' ? [value] : []
  return value.filter((item): item is string => typeof item === 'string' && item !== '')
}
