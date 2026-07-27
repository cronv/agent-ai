/**
 * База знаний — документы застройщика и поиск по ним.
 *
 *   import { searchKnowledge, ingestDocument } from '../services/knowledge/index.js'
 *
 * Слои разделены намеренно:
 *   extract.ts   — файл → текст (PDF, DOCX, TXT/MD), чистая функция над буфером;
 *   chunk.ts     — текст → фрагменты, чистая функция без базы;
 *   documents.ts — приём, сохранение и удаление документа;
 *   search.ts    — поиск по фрагментам; его же дёргает инструмент модели.
 */

export * from './chunk.js'
export * from './documents.js'
export * from './extract.js'
export * from './search.js'
