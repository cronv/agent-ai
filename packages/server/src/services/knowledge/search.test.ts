import { beforeEach, describe, expect, it } from 'vitest'

import { resetDatabase, testDb } from '../../testing/db.js'
import { ingestDocument } from './documents.js'
import { KNOWLEDGE_SEARCH_LIMIT, fuzzyTerms, searchKnowledge } from './search.js'

/**
 * Поиск проверяется на настоящем PostgreSQL: стеммер, триггер `tsv` и
 * `pg_trgm` — это и есть проверяемое поведение, подменять их бессмысленно.
 */

async function addDocument(filename: string, text: string, projectId?: string): Promise<string> {
  const doc = await ingestDocument(testDb, {
    filename,
    mimeType: 'text/plain',
    buffer: Buffer.from(text, 'utf8'),
    projectId: projectId ?? null,
  })
  expect(doc.status).toBe('ready')
  return doc.id
}

function contents(hits: { content: string }[]): string {
  return hits.map((hit) => hit.content).join('\n')
}

describe('fuzzyTerms', () => {
  it('оставляет длинные слова, приводит ё к е и убирает пунктуацию', () => {
    // «когда» остаётся: стоп-слова отсеивает PostgreSQL уже внутри запроса.
    expect(fuzzyTerms('Когда сдаётся дом, есть ипотека?')).toEqual(['когда', 'сдается', 'ипотека'])
  })

  it('короткие слова и цифры в нечёткий слой не идут', () => {
    expect(fuzzyTerms('дом 2026 ЖК')).toEqual([])
  })
})

describe('searchKnowledge', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('на пустой базе возвращает пустой список', async () => {
    expect(await searchKnowledge(testDb, { query: 'ипотека' })).toEqual([])
  })

  it('пустой запрос не идёт в базу и ничего не находит', async () => {
    await addDocument('условия.txt', 'Ипотека от 6% годовых.')
    expect(await searchKnowledge(testDb, { query: '   ' })).toEqual([])
  })

  it('находит по форме слова: «ипотеки» → «ипотека»', async () => {
    await addDocument('условия.txt', 'Ипотека с господдержкой от 6% годовых.\n\nПаркинг подземный, 120 мест.')

    const hits = await searchKnowledge(testDb, { query: 'ипотеки' })

    expect(hits).toHaveLength(1)
    expect(hits[0]?.content).toContain('Ипотека')
    expect(hits[0]?.matchedBy).toBe('fulltext')
  })

  it('находит однокоренное слово другой части речи: «ипотека» → «ипотечная»', async () => {
    await addDocument(
      'программы.txt',
      'Ипотечная программа с господдержкой: ставка от 6% годовых.\n\nПаркинг подземный, 120 машиномест.',
    )

    const hits = await searchKnowledge(testDb, { query: 'ипотека' })

    expect(hits.length).toBeGreaterThan(0)
    expect(contents(hits)).toContain('Ипотечная программа')
  })

  it('находит «сдача» в тексте про «сдаётся»', async () => {
    await addDocument('сроки.txt', 'Дом сдаётся в четвёртом квартале 2026 года.\n\nОтделка White Box.')

    const hits = await searchKnowledge(testDb, { query: 'сдача' })

    expect(contents(hits)).toContain('сдаётся')
  })

  it('точное попадание полнотекстового поиска идёт раньше похожего по буквам', async () => {
    await addDocument('дача.txt', 'Загородная дача рядом с посёлком не входит в проект.')
    await addDocument('сроки.txt', 'Сдача дома намечена на четвёртый квартал 2026 года.')

    const hits = await searchKnowledge(testDb, { query: 'сдача' })

    expect(hits[0]?.content).toContain('Сдача дома')
    expect(hits[0]?.matchedBy).toBe('fulltext')
  })

  it('отдаёт имя документа и название ЖК', async () => {
    const project = await testDb.project.create({ data: { name: 'ЖК Речной', slug: 'rechnoy' } })
    await addDocument('Ипотека-2026.txt', 'Ипотека с господдержкой от 6% годовых.', project.id)

    const hits = await searchKnowledge(testDb, { query: 'ипотека', projectId: project.id })

    expect(hits[0]?.documentTitle).toBe('Ипотека-2026.txt')
    expect(hits[0]?.projectName).toBe('ЖК Речной')
    expect(hits[0]?.projectId).toBe(project.id)
  })

  it('с указанным ЖК отдаёт его документы и общие, но не чужие', async () => {
    const river = await testDb.project.create({ data: { name: 'ЖК Речной', slug: 'rechnoy' } })
    const park = await testDb.project.create({ data: { name: 'ЖК Парковый', slug: 'parkovyy' } })

    await addDocument('речной.txt', 'В ЖК Речной ипотека с господдержкой от 6% годовых.', river.id)
    await addDocument('парковый.txt', 'В ЖК Парковый ипотека от 8% годовых.', park.id)
    await addDocument('общая.txt', 'Ипотека оформляется в офисе продаж за один визит.')

    const hits = await searchKnowledge(testDb, { query: 'ипотека', projectId: river.id })
    const titles = hits.map((hit) => hit.documentTitle).sort()

    expect(titles).toEqual(['общая.txt', 'речной.txt'])
  })

  it('без указания ЖК ищет по всей базе', async () => {
    const park = await testDb.project.create({ data: { name: 'ЖК Парковый', slug: 'parkovyy' } })
    await addDocument('парковый.txt', 'В ЖК Парковый ипотека от 8% годовых.', park.id)
    await addDocument('общая.txt', 'Ипотека оформляется в офисе продаж.')

    const hits = await searchKnowledge(testDb, { query: 'ипотека' })

    expect(hits).toHaveLength(2)
  })

  it('возвращает не больше шести фрагментов', async () => {
    const paragraphs = Array.from({ length: 12 }, (_, index) => `Ипотека, вариант ${index + 1}. `.repeat(40))
    await addDocument('много.txt', paragraphs.join('\n\n'))

    const hits = await searchKnowledge(testDb, { query: 'ипотека' })

    expect(hits.length).toBe(KNOWLEDGE_SEARCH_LIMIT)
  })

  it('лимит можно сузить', async () => {
    const paragraphs = Array.from({ length: 12 }, (_, index) => `Ипотека, вариант ${index + 1}. `.repeat(40))
    await addDocument('много.txt', paragraphs.join('\n\n'))

    expect(await searchKnowledge(testDb, { query: 'ипотека', limit: 2 })).toHaveLength(2)
  })

  it('после удаления документа его фрагменты пропадают из выдачи', async () => {
    const docId = await addDocument('условия.txt', 'Ипотека с господдержкой от 6% годовых.')
    expect(await searchKnowledge(testDb, { query: 'ипотека' })).toHaveLength(1)

    await testDb.knowledgeDoc.delete({ where: { id: docId } })

    expect(await searchKnowledge(testDb, { query: 'ипотека' })).toEqual([])
  })

  it('фрагменты документа с ошибкой в базу не попадают', async () => {
    const doc = await ingestDocument(testDb, {
      filename: 'скан.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 не пдф вовсе'),
    })

    expect(doc.status).toBe('error')
    expect(await searchKnowledge(testDb, { query: 'пдф' })).toEqual([])
  })

  it('запрос из нескольких слов ищет их вместе', async () => {
    await addDocument('условия.txt', 'Ипотека с господдержкой от 6% годовых.\n\nРассрочка без процентов на два года.')

    const hits = await searchKnowledge(testDb, { query: 'рассрочка без процентов' })

    expect(hits.length).toBeGreaterThan(0)
    expect(hits[0]?.content).toContain('Рассрочка')
  })
})
