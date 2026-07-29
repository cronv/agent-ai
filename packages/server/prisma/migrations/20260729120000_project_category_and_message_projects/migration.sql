-- Направления каталога и ссылки на карточки ЖК в переписке.
--
-- `projects.category` — направление недвижимости. Значение по умолчанию
-- «новостройки»: всё, что уже заведено импортом фидов застройщиков, относится
-- именно к ним, поэтому существующие строки менять не нужно.
CREATE TYPE "ProjectCategory" AS ENUM ('novostroyki', 'vtorichka', 'commercial', 'suburban');

ALTER TABLE "projects" ADD COLUMN "category" "ProjectCategory" NOT NULL DEFAULT 'novostroyki';

CREATE INDEX "projects_category_idx" ON "projects"("category");

-- `messages.projects` — ссылки на карточки ЖК, показанные этим сообщением.
-- Хранятся рядом с показанными квартирами и по той же причине: кнопки должны
-- вернуться на своё место, когда посетитель откроет чат заново.
ALTER TABLE "messages" ADD COLUMN "projects" JSONB;
