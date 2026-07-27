# ── Сборка ───────────────────────────────────────────────────
FROM node:24-alpine AS build

# openssl нужен Prisma для работы с PostgreSQL
RUN apk add --no-cache openssl

WORKDIR /app

# Сначала только манифесты — так слой с зависимостями кэшируется
COPY package.json package-lock.json ./
COPY packages/server/package.json packages/server/
COPY packages/admin/package.json packages/admin/
COPY packages/widget/package.json packages/widget/

RUN npm ci

COPY . .

# widget → admin → server (сервер отдаёт собранную статику)
RUN npm run build

# ── Запуск ───────────────────────────────────────────────────
FROM node:24-alpine AS runtime

RUN apk add --no-cache openssl

WORKDIR /app
ENV NODE_ENV=production

COPY --from=build /app/package.json /app/package-lock.json ./
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/server/package.json ./packages/server/package.json
COPY --from=build /app/packages/server/dist ./packages/server/dist
COPY --from=build /app/packages/server/prisma ./packages/server/prisma
# Демо-комплект: выгрузка на 30 квартир, планировки, документ базы знаний.
# Сервер раздаёт их сам — импорт работает без интернета.
COPY --from=build /app/packages/server/demo ./packages/server/demo
COPY --from=build /app/packages/admin/package.json ./packages/admin/package.json
COPY --from=build /app/packages/admin/dist ./packages/admin/dist
COPY --from=build /app/packages/widget/package.json ./packages/widget/package.json
COPY --from=build /app/packages/widget/dist ./packages/widget/dist
COPY docker/entrypoint.sh /usr/local/bin/entrypoint.sh

RUN chmod +x /usr/local/bin/entrypoint.sh

EXPOSE 3000

ENTRYPOINT ["/usr/local/bin/entrypoint.sh"]
