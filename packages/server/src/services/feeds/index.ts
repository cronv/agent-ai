/**
 * Синхронизация выгрузок застройщиков.
 *
 *   import { importFeed } from '../services/feeds/index.js'
 *   const result = await importFeed(feedId, { db: app.prisma })
 *
 * Слои разделены намеренно:
 *   download.ts  — сеть (в тестах подменяется);
 *   parse.ts     — XML → список квартир (чистая функция, проверяется на файлах);
 *   profiles.ts  — где какое поле лежит в каком формате;
 *   domclick.ts  — обход вложенной выгрузки «комплекс → корпус → квартира»;
 *   normalize.ts — «12,5 млн» → 12500000 и прочие приведения;
 *   import.ts    — запись в базу, деактивация пропавших лотов, состояние фида.
 */

export * from './download.js'
export * from './import.js'
export * from './normalize.js'
export * from './parse.js'
export * from './profiles.js'
