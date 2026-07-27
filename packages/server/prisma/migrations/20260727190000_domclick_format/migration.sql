-- Формат ДомКлик: вложенная выгрузка «комплекс → корпус → квартира».
-- Одно значение в enum добавляется одним ALTER TYPE и в PostgreSQL 12+
-- допустимо внутри транзакции, если тут же его не использовать.
ALTER TYPE "FeedFormat" ADD VALUE 'domclick';

-- Характеристики лота, которые есть в выгрузках ДомКлик и которые
-- ассистент показывает в карточке: балкон, вид из окна, санузел,
-- признак евро-планировки.
ALTER TABLE "apartments" ADD COLUMN "balcony" TEXT;
ALTER TABLE "apartments" ADD COLUMN "window_view" TEXT;
ALTER TABLE "apartments" ADD COLUMN "bathroom" TEXT;
ALTER TABLE "apartments" ADD COLUMN "euro_plan" BOOLEAN;
