import { beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { TEXT_SEARCH_CONFIG } from '../lib/fulltext.js'
import { resetDatabase, testDb } from '../testing/db.js'

/**
 * Проверки того, что миграции действительно создали в PostgreSQL, —
 * tsvector, расширения, индексы. Всё это невидимо для Prisma-клиента,
 * поэтому единственный способ убедиться — спросить саму базу.
 */

describe('схема базы данных', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('все модели из спеки существуют как таблицы', async () => {
    const rows = await testDb.$queryRaw<{ tablename: string }[]>`
      SELECT tablename FROM pg_tables WHERE schemaname = 'public'
    `
    const tables = rows.map((row) => row.tablename)

    for (const table of [
      'projects',
      'feeds',
      'apartments',
      'knowledge_docs',
      'knowledge_chunks',
      'conversations',
      'messages',
      'leads',
      'settings',
    ]) {
      expect(tables).toContain(table)
    }
  })

  it('расширения pg_trgm и unaccent включены', async () => {
    const rows = await testDb.$queryRaw<{ extname: string }[]>`
      SELECT extname FROM pg_extension
    `
    const names = rows.map((row) => row.extname)

    expect(names).toContain('pg_trgm')
    expect(names).toContain('unaccent')
  })

  it('у knowledge_chunks есть колонка tsv типа tsvector', async () => {
    const rows = await testDb.$queryRaw<{ udt_name: string }[]>`
      SELECT udt_name FROM information_schema.columns
      WHERE table_name = 'knowledge_chunks' AND column_name = 'tsv'
    `

    expect(rows[0]?.udt_name).toBe('tsvector')
  })

  it('колонка tsv покрыта GIN-индексом', async () => {
    const rows = await testDb.$queryRaw<{ indexdef: string }[]>`
      SELECT indexdef FROM pg_indexes WHERE tablename = 'knowledge_chunks'
    `
    const ginOnTsv = rows.some(
      (row) => row.indexdef.includes('USING gin') && row.indexdef.includes('tsv'),
    )

    expect(ginOnTsv).toBe(true)
  })

  it('уникальность квартиры — пара (feedId, externalId)', async () => {
    const feed = await testDb.feed.create({ data: { name: 'Тестовый фид', url: 'http://example.test/feed.xml' } })
    await testDb.apartment.create({ data: { feedId: feed.id, externalId: 'A-1', price: 10_000_000 } })

    await expect(
      testDb.apartment.create({ data: { feedId: feed.id, externalId: 'A-1', price: 12_000_000 } }),
    ).rejects.toThrow()

    // Тот же externalId в другом фиде — это другая квартира, конфликта быть не должно
    const other = await testDb.feed.create({ data: { name: 'Второй фид', url: 'http://example.test/2.xml' } })
    await expect(
      testDb.apartment.create({ data: { feedId: other.id, externalId: 'A-1', price: 12_000_000 } }),
    ).resolves.toBeTruthy()
  })
})

describe('полнотекстовый поиск по базе знаний', () => {
  let docId: string

  beforeAll(async () => {
    await resetDatabase()
    const doc = await testDb.knowledgeDoc.create({
      data: { filename: 'условия.txt', mimeType: 'text/plain', sizeBytes: 100, status: 'ready' },
    })
    docId = doc.id
    await testDb.knowledgeChunk.createMany({
      data: [
        { docId, position: 0, content: 'Ипотека с господдержкой — ставка 6% годовых.' },
        { docId, position: 1, content: 'Дом сдаётся в четвёртом квартале 2027 года.' },
        { docId, position: 2, content: 'Отделка white box включена в стоимость квартиры.' },
      ],
    })
  })

  async function search(query: string): Promise<string[]> {
    const rows = await testDb.$queryRawUnsafe<{ content: string }[]>(
      `SELECT content, ts_rank_cd(tsv, websearch_to_tsquery($1::regconfig, $2)) AS rank
         FROM knowledge_chunks
        WHERE tsv @@ websearch_to_tsquery($1::regconfig, $2)
        ORDER BY rank DESC`,
      TEXT_SEARCH_CONFIG,
      query,
    )
    return rows.map((row) => row.content)
  }

  it('триггер заполняет tsv при вставке фрагмента', async () => {
    const rows = await testDb.$queryRaw<{ filled: number }[]>`
      SELECT count(*)::int AS filled FROM knowledge_chunks WHERE tsv IS NOT NULL
    `

    expect(rows[0]?.filled).toBe(3)
  })

  it('учитывает русскую морфологию: «ипотеки» находит «Ипотека»', async () => {
    expect(await search('ипотеки')).toEqual(['Ипотека с господдержкой — ставка 6% годовых.'])
  })

  it('находит «квартиры» по слову «квартира»', async () => {
    expect(await search('квартира')).toEqual([
      'Отделка white box включена в стоимость квартиры.',
    ])
  })

  it('не различает е и ё: «сдается» находит «сдаётся»', async () => {
    expect(await search('сдается')).toEqual(['Дом сдаётся в четвёртом квартале 2027 года.'])
  })

  it('обновление текста фрагмента пересчитывает tsv', async () => {
    const chunk = await testDb.knowledgeChunk.findFirst({ where: { docId, position: 2 } })
    await testDb.knowledgeChunk.update({
      where: { id: chunk!.id },
      data: { content: 'Предоставляется беспроцентная рассрочка на два года.' },
    })

    expect(await search('рассрочка')).toEqual([
      'Предоставляется беспроцентная рассрочка на два года.',
    ])
    expect(await search('отделка')).toEqual([])
  })

  it('удаление документа уносит его фрагменты', async () => {
    await testDb.knowledgeDoc.delete({ where: { id: docId } })

    expect(await testDb.knowledgeChunk.count()).toBe(0)
  })
})
