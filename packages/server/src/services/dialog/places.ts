import type { Db } from '../../db/prisma.js'

/**
 * Поиск ЖК по месту — району, городу, округу.
 *
 *   const ids = await findProjectsByPlace(db, 'Домодедовский городской округ')
 *   // → ['cms3gz…']  — ЖК «Космос», у которого район записан как «Домодедово»
 *
 * Строгое сравнение здесь не работает никогда. В базе район записан так, как
 * его сократил импорт («Домодедово»), а человек пишет как придётся:
 * «домодедовский», «Домодедовский городской округ», «Домадедово» с опечаткой.
 * Поэтому сравнение триграммное — расширение `pg_trgm` и индекс
 * `projects_name_trgm_idx` для этого и стоят.
 *
 * Два прохода. Сначала по колонке `district`; если там пусто — по названию и
 * адресу ЖК: район у части комплексов может быть не заполнен, а слово
 * «Домодедово» всё равно стоит в названии и в адресе. Сказать «в этом районе
 * у нас ничего нет», не заглянув туда, — худший из возможных ответов.
 *
 * `word_similarity(a, b)` — это «насколько хорошо `a` совпадает с лучшим по
 * совпадению куском `b`». Ровно то, что нужно: короткое «Химки» находится
 * внутри длинного «Химки городской округ» со счётом 0.83, тогда как обычная
 * `similarity` тех же строк даёт 0.18 и промахивается.
 */

/** Ниже этого совпадения — уже не то место. «Домадедово» ↔ «Домодедово» = 0.57. */
const MIN_SCORE = 0.5

/**
 * Насколько результат может отставать от лучшего, чтобы попасть в выдачу.
 * «химкинский городской округ» похож на «Химки» на 0.83, а на «Пушкинский» —
 * на 0.55; без этого отсечения в подборку про Химки попали бы Пушкинские ЖК.
 */
const TOP_RATIO = 0.85

interface ScoredProject {
  id: string
  score: number
}

/**
 * Идентификаторы ЖК, подходящих под название места.
 * Пустой список означает «такого места в каталоге нет» — это честный ответ,
 * а не повод искать без фильтра.
 */
export async function findProjectsByPlace(db: Db, place: string): Promise<string[]> {
  const query = normalizePlace(place)
  if (query === '') return []

  const byDistrict = await scoreByDistrict(db, query)
  if (byDistrict.length > 0) return topMatches(byDistrict)

  return topMatches(await scoreByNameAndAddress(db, query))
}

/** Совпадение с районом ЖК. */
async function scoreByDistrict(db: Db, query: string): Promise<ScoredProject[]> {
  return db.$queryRaw<ScoredProject[]>`
    SELECT id,
           GREATEST(
             word_similarity(replace(lower(district), 'ё', 'е'), ${query}),
             similarity(replace(lower(district), 'ё', 'е'), ${query})
           ) AS score
      FROM projects
     WHERE is_active AND district IS NOT NULL AND district <> ''
       AND GREATEST(
             word_similarity(replace(lower(district), 'ё', 'е'), ${query}),
             similarity(replace(lower(district), 'ё', 'е'), ${query})
           ) >= ${MIN_SCORE}
     ORDER BY score DESC
  `
}

/**
 * Запасной ход: то же слово в названии и адресе ЖК. Здесь направление
 * сравнения обратное — короткий запрос ищется внутри длинного текста.
 */
async function scoreByNameAndAddress(db: Db, query: string): Promise<ScoredProject[]> {
  return db.$queryRaw<ScoredProject[]>`
    SELECT id,
           GREATEST(
             word_similarity(${query}, replace(lower(name), 'ё', 'е')),
             word_similarity(${query}, replace(lower(COALESCE(address, '')), 'ё', 'е'))
           ) AS score
      FROM projects
     WHERE is_active
       AND GREATEST(
             word_similarity(${query}, replace(lower(name), 'ё', 'е')),
             word_similarity(${query}, replace(lower(COALESCE(address, '')), 'ё', 'е'))
           ) >= ${MIN_SCORE}
     ORDER BY score DESC
  `
}

/**
 * Идентификаторы ЖК по названию, названному как угодно.
 *
 *   findProjectsByName(db, 'Серебра')  → ЖК «Серебро»
 *   findProjectsByName(db, 'Школьном') → ЖК «Школьный» («Альянс»)
 *
 * Строгое вхождение здесь ломается на первом же падеже. «Когда сдача Серебра»
 * модель превращает в name: «Серебра», `contains` не находит «Серебро», и
 * ассистент отвечает «такого комплекса у нас нет» — про дом, который стоит
 * в каталоге и продаёт 220 квартир. Это худшая ошибка из возможных: человек
 * уходит уверенным, что ошибся адресом.
 *
 * Поэтому сначала вхождение — оно точнее и покрывает частичные названия
 * («горка» в «Красная горка»), — а если оно пусто, то те же триграммы, что и
 * для мест. «Серебра» ↔ «ЖК «Серебро»» дают 0.75, «космоса» ↔ «ЖК «Космос»» —
 * 0.75, при пороге 0.5 и отсечении по лучшему.
 *
 * Пустой список по-прежнему означает «такого ЖК в каталоге нет», и это
 * честный ответ.
 */
export async function findProjectsByName(db: Db, name: string): Promise<string[]> {
  const query = normalizePlace(name)
  if (query === '') return []

  const exact = await db.project.findMany({
    where: { isActive: true, name: { contains: query, mode: 'insensitive' } },
    select: { id: true },
  })
  if (exact.length > 0) return exact.map((row) => row.id)

  const scored = await db.$queryRaw<ScoredProject[]>`
    SELECT id, word_similarity(${query}, replace(lower(name), 'ё', 'е')) AS score
      FROM projects
     WHERE is_active
       AND word_similarity(${query}, replace(lower(name), 'ё', 'е')) >= ${MIN_SCORE}
     ORDER BY score DESC
  `
  return topMatches(scored)
}

/** Оставляет лучшие совпадения и всё, что от них почти не отстаёт. */
function topMatches(rows: ScoredProject[]): string[] {
  const best = rows[0]?.score
  if (best === undefined) return []
  const cutoff = best * TOP_RATIO
  return rows.filter((row) => row.score >= cutoff).map((row) => row.id)
}

/** Регистр и «ё» триграммы не различают, а лишние пробелы — различают. */
function normalizePlace(place: string): string {
  return place.toLowerCase().replace(/ё/g, 'е').replace(/\s+/g, ' ').trim()
}
