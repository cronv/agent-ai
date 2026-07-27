#!/bin/sh
# Точка входа контейнера приложения.
# Перед стартом сервера накатывает миграции базы данных —
# поэтому `docker compose up` на чистой машине сразу даёт рабочую систему.
set -e

echo "→ Применяю миграции базы данных…"
npx --no-install prisma migrate deploy --schema packages/server/prisma/schema.prisma

echo "→ Запускаю сервер…"
exec node packages/server/dist/index.js
