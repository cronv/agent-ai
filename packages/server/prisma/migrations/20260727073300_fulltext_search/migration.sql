-- Полнотекстовый поиск по базе знаний.
--
-- Prisma не умеет описывать расширения, конфигурации поиска, триггеры и
-- индексы по колонке типа tsvector — поэтому всё это заводится сырым SQL.
-- Колонка knowledge_chunks.tsv создана предыдущей миграцией (в схеме она
-- объявлена как Unsupported("tsvector")).

-- ── Расширения ───────────────────────────────────────────────
-- pg_trgm  — поиск по похожести, устойчив к опечаткам в названиях ЖК
-- unaccent — снимает диакритику и приводит «ё» к «е»
CREATE EXTENSION IF NOT EXISTS "pg_trgm";
CREATE EXTENSION IF NOT EXISTS "unaccent";

-- ── Конфигурация поиска russian_unaccent ─────────────────────
-- Стандартная русская морфология плюс словарь unaccent.
-- Одну и ту же конфигурацию обязаны использовать и индексация,
-- и запрос — иначе «сдаётся» не найдётся по слову «сдача».
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_ts_config WHERE cfgname = 'russian_unaccent') THEN
    CREATE TEXT SEARCH CONFIGURATION russian_unaccent (COPY = russian);
    ALTER TEXT SEARCH CONFIGURATION russian_unaccent
      ALTER MAPPING FOR hword, hword_part, word
      WITH unaccent, russian_stem;
  END IF;
END
$$;

-- ── Автоматический пересчёт tsv ──────────────────────────────
-- Триггер снимает с прикладного кода обязанность помнить про tsv:
-- вставили или поменяли текст фрагмента — вектор пересчитался сам.
CREATE OR REPLACE FUNCTION knowledge_chunks_tsv_refresh() RETURNS trigger AS $$
BEGIN
  NEW.tsv := to_tsvector('russian_unaccent', coalesce(NEW.content, ''));
  RETURN NEW;
END
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS knowledge_chunks_tsv_update ON "knowledge_chunks";

CREATE TRIGGER knowledge_chunks_tsv_update
BEFORE INSERT OR UPDATE OF content ON "knowledge_chunks"
FOR EACH ROW EXECUTE FUNCTION knowledge_chunks_tsv_refresh();

-- Пересчёт для уже существующих строк (на случай применения к живой базе)
UPDATE "knowledge_chunks" SET content = content WHERE tsv IS NULL;

-- ── Индексы ──────────────────────────────────────────────────
-- Основной индекс полнотекстового поиска
CREATE INDEX IF NOT EXISTS "knowledge_chunks_tsv_idx"
  ON "knowledge_chunks" USING GIN ("tsv");

-- Похожесть строк: названия ЖК с опечатками
CREATE INDEX IF NOT EXISTS "projects_name_trgm_idx"
  ON "projects" USING GIN ("name" gin_trgm_ops);

-- Поиск по перепискам в админке (по тексту сообщения)
CREATE INDEX IF NOT EXISTS "messages_content_trgm_idx"
  ON "messages" USING GIN ("content" gin_trgm_ops);

-- Поиск лида по имени
CREATE INDEX IF NOT EXISTS "leads_name_trgm_idx"
  ON "leads" USING GIN ("name" gin_trgm_ops);
