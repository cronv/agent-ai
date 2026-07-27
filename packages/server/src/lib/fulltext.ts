/**
 * Полнотекстовый поиск PostgreSQL.
 *
 * Миграция создаёт конфигурацию поиска `russian_unaccent`: это стандартная
 * русская конфигурация плюс словарь `unaccent`, который снимает диакритику
 * и приводит «ё» к «е». Одну и ту же конфигурацию обязаны использовать
 * и индексация (`to_tsvector`), и запрос (`websearch_to_tsquery`) —
 * иначе слова не совпадут.
 *
 * Колонка `knowledge_chunks.tsv` заполняется триггером
 * `knowledge_chunks_tsv_update`: считать её при вставке фрагмента вручную
 * не нужно, при изменении текста она пересчитывается сама.
 *
 * Поиск делается сырым SQL; имя конфигурации подставляется параметром
 * и обязательно приводится к типу `regconfig`:
 *
 *   await prisma.$queryRawUnsafe(
 *     `SELECT id, content, ts_rank_cd(tsv, websearch_to_tsquery($1::regconfig, $2)) AS rank
 *        FROM knowledge_chunks
 *       WHERE tsv @@ websearch_to_tsquery($1::regconfig, $2)
 *       ORDER BY rank DESC
 *       LIMIT 6`,
 *     TEXT_SEARCH_CONFIG,
 *     query,
 *   )
 *
 * Без `::regconfig` PostgreSQL отвечает
 * «function websearch_to_tsquery(text, text) does not exist».
 */
export const TEXT_SEARCH_CONFIG = 'russian_unaccent'
