import type { Db } from '../../db/prisma.js'
import { TEXT_SEARCH_CONFIG } from '../../lib/fulltext.js'

/**
 * Поиск по базе знаний.
 *
 *   const hits = await searchKnowledge(app.prisma, { query: 'ипотека', projectId })
 *
 * Это же вызывает инструмент модели `search_knowledge` — поэтому функция
 * живёт отдельно от HTTP и ничего не знает ни о запросе, ни об ответе.
 *
 * ── Почему поиск двухслойный ────────────────────────────────────────────
 *
 * Основной слой — полнотекстовый поиск PostgreSQL с конфигурацией
 * `russian_unaccent`. Он снимает словоизменение: «ипотеки» находит «ипотеку»,
 * «квартир» находит «квартира».
 *
 * Но стеммер приводит к одной основе только формы одного слова. Однокоренные
 * слова разных частей речи он разводит:
 *
 *   'ипотека'  → ипотек     'ипотечная' → ипотечн
 *   'сдача'    → сдач       'сдаётся'   → сдает
 *
 * А человек спрашивает «что там по ипотеке» о разделе «Ипотечные программы» и
 * «когда сдача» о фразе «дом сдаётся в 2026». Поэтому поверх добавлен второй
 * слой — похожесть по триграммам (`pg_trgm`, `word_similarity`). Он же
 * вытягивает опечатки в названиях ЖК.
 *
 * Слои не смешиваются в одну оценку: точные попадания полнотекстового поиска
 * всегда идут первыми, похожие по триграммам — следом и только если места в
 * выдаче остались. Так нечёткий слой добавляет находки, но не портит порядок.
 *
 * ── Про производительность ──────────────────────────────────────────────
 *
 * Полнотекстовая часть идёт по GIN-индексу `knowledge_chunks_tsv_idx`.
 * Триграммная считается перебором по всем фрагментам: база знаний — это
 * десятки документов, а не миллионы строк, и отдельный индекс здесь дороже
 * пользы. Если фрагментов станет очень много, лечится GIN-индексом
 * `gin_trgm_ops` на `knowledge_chunks.content`.
 */

/** Сколько фрагментов уходит модели по умолчанию. Больше — только шум в контексте. */
export const KNOWLEDGE_SEARCH_LIMIT = 6

/** Жёсткий потолок на случай, если лимит пришёл снаружи. */
export const KNOWLEDGE_SEARCH_MAX_LIMIT = 20

/**
 * Порог триграммной похожести. Подобран по опорным парам: «ипотека» ↔
 * «ипотечная» даёт 0.63, «сдача» ↔ «сдаётся» — 0.50. Ниже 0.45 в выдачу
 * начинает попадать случайное.
 */
export const FUZZY_SIMILARITY_THRESHOLD = 0.45

/**
 * Короткие слова похожи друг на друга слишком легко («дом» ↔ «дым»), поэтому
 * нечёткий слой работает только со словами от пяти букв.
 */
export const MIN_FUZZY_TERM_LENGTH = 5

export interface KnowledgeSearchParams {
  /** Запрос как его написал человек. Разбирается `websearch_to_tsquery`. */
  query: string
  /** ЖК, о котором идёт разговор. Сужает выдачу; `null` — искать везде. */
  projectId?: string | null | undefined
  /** Сколько фрагментов вернуть. По умолчанию `KNOWLEDGE_SEARCH_LIMIT`. */
  limit?: number | undefined
}

export interface KnowledgeSearchHit {
  chunkId: string
  docId: string
  /** Имя файла, из которого взят фрагмент — модель ссылается на него в ответе. */
  documentTitle: string
  projectId: string | null
  /** Название ЖК или `null`, если документ общий для всех проектов. */
  projectName: string | null
  content: string
  /** Порядковый номер фрагмента внутри документа, с нуля. */
  position: number
  /** Оценка релевантности внутри своего слоя. Сравнима только с такими же. */
  score: number
  /** Каким слоем найден: точным полнотекстовым или похожестью по триграммам. */
  matchedBy: 'fulltext' | 'fuzzy'
}

interface SearchRow {
  chunk_id: string
  doc_id: string
  document_title: string
  project_id: string | null
  project_name: string | null
  content: string
  position: number
  fts_rank: number
  fuzzy_rank: number
}

/**
 * Слова запроса, пригодные для нечёткого слоя: без пунктуации, в нижнем
 * регистре, «ё» приведена к «е» — так же, как это делает `unaccent`
 * с индексируемым текстом.
 *
 * Стоп-слова («когда», «который») здесь остаются: их отсеивает сам PostgreSQL
 * уже в запросе — у него список стоп-слов ровно тот же, по которому строился
 * `tsvector`, и держать свою копию значило бы разойтись с ним на первой же
 * правке конфигурации.
 */
export function fuzzyTerms(query: string): string[] {
  const terms = query
    .toLowerCase()
    .replace(/ё/g, 'е')
    .split(/[^\p{L}\p{N}-]+/u)
    .map((term) => term.replace(/^-+|-+$/g, ''))
    .filter((term) => term.length >= MIN_FUZZY_TERM_LENGTH && /\p{L}/u.test(term))

  return [...new Set(terms)]
}

export async function searchKnowledge(db: Db, params: KnowledgeSearchParams): Promise<KnowledgeSearchHit[]> {
  const query = params.query.trim()
  if (query === '') return []

  const limit = Math.min(Math.max(params.limit ?? KNOWLEDGE_SEARCH_LIMIT, 1), KNOWLEDGE_SEARCH_MAX_LIMIT)
  const projectId = params.projectId ?? null
  const terms = fuzzyTerms(query)

  // $1 конфигурация поиска, $2 запрос, $3 слова для нечёткого слоя,
  // $4 ЖК, $5 порог похожести, $6 размер выдачи.
  const rows = await db.$queryRawUnsafe<SearchRow[]>(
    `
    WITH tsq AS (
      SELECT websearch_to_tsquery($1::regconfig, $2) AS query
    ),
    terms AS (
      -- Пустой tsvector означает стоп-слово: искать похожее на «когда» незачем.
      SELECT DISTINCT term
        FROM unnest($3::text[]) AS term
       WHERE to_tsvector($1::regconfig, term) <> ''::tsvector
    ),
    scored AS (
      SELECT
        c."id"          AS chunk_id,
        c."doc_id"      AS doc_id,
        d."filename"    AS document_title,
        c."project_id"  AS project_id,
        p."name"        AS project_name,
        c."content"     AS content,
        c."position"    AS position,
        ts_rank_cd(c."tsv", tsq.query)::float8 AS fts_rank,
        COALESCE((
          SELECT max(word_similarity(terms.term, translate(lower(c."content"), 'ё', 'е')))
            FROM terms
        ), 0)::float8 AS fuzzy_rank
      FROM "knowledge_chunks" c
      JOIN "knowledge_docs" d ON d."id" = c."doc_id"
      LEFT JOIN "projects" p ON p."id" = c."project_id"
      CROSS JOIN tsq
      WHERE $4::text IS NULL
         OR c."project_id" IS NULL
         OR c."project_id" = $4::text
    )
    SELECT *
      FROM scored
     WHERE fts_rank > 0
        OR fuzzy_rank >= $5::float8
     ORDER BY (fts_rank > 0) DESC, fts_rank DESC, fuzzy_rank DESC, position ASC
     LIMIT $6::int
    `,
    TEXT_SEARCH_CONFIG,
    query,
    terms,
    projectId,
    FUZZY_SIMILARITY_THRESHOLD,
    limit,
  )

  return rows.map((row) => ({
    chunkId: row.chunk_id,
    docId: row.doc_id,
    documentTitle: row.document_title,
    projectId: row.project_id,
    projectName: row.project_name,
    content: row.content,
    position: row.position,
    score: row.fts_rank > 0 ? row.fts_rank : row.fuzzy_rank,
    matchedBy: row.fts_rank > 0 ? 'fulltext' : 'fuzzy',
  }))
}
