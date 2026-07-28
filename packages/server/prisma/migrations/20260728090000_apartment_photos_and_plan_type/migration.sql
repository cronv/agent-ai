-- Галерея фотографий объекта и тип планировки.
--
-- `photos` — снимки из выгрузки в порядке фида (у ЦИАН это Photos/PhotoSchema/FullUrl).
-- Пустой массив по умолчанию, чтобы у уже заведённых лотов колонка не была NULL:
-- ДомКлик фотографий не отдаёт, и они так и останутся с пустой галереей.
--
-- `plan_type` — то, что ЦИАН кодирует вместо числа комнат: «свободная планировка»
-- (код 7) и «многокомнатная» (код 6). У таких лотов `rooms` пуст.
ALTER TABLE "apartments" ADD COLUMN "photos" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "apartments" ADD COLUMN "plan_type" TEXT;
