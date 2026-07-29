import { readFileSync } from 'node:fs'

import { beforeEach, describe, expect, it } from 'vitest'

import { resetDatabase, testDb } from '../../testing/db.js'
import { UnknownProjectError, deleteDocument, ingestDocument, listDocuments } from './documents.js'
import { searchKnowledge } from './search.js'

function fixture(name: string): Buffer {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url))
}

/** Короткий, но настоящий документ: несколько строк осмысленного текста. */
const USLOVIYA = 'Ипотека от 6% годовых при первоначальном взносе от 20%. Рассрочка до конца строительства.'

describe('ingestDocument', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('раскладывает PDF на фрагменты и делает их находимыми', async () => {
    const doc = await ingestDocument(testDb, {
      filename: 'ipoteka.pdf',
      mimeType: 'application/pdf',
      buffer: fixture('ipoteka.pdf'),
    })

    expect(doc.status).toBe('ready')
    expect(doc.error).toBeNull()
    expect(doc.chunkCount).toBeGreaterThan(0)
    expect(doc.charCount).toBeGreaterThan(100)
    expect(doc.sizeBytes).toBe(fixture('ipoteka.pdf').length)

    const hits = await searchKnowledge(testDb, { query: 'господдержка' })
    expect(hits[0]?.documentTitle).toBe('ipoteka.pdf')
  })

  it('раскладывает DOCX', async () => {
    const doc = await ingestDocument(testDb, {
      filename: 'otdelka.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      buffer: fixture('otdelka.docx'),
    })

    expect(doc.status).toBe('ready')
    const hits = await searchKnowledge(testDb, { query: 'отделка' })
    expect(hits.length).toBeGreaterThan(0)
  })

  it('раскладывает MD', async () => {
    const doc = await ingestDocument(testDb, {
      filename: 'rassrochka.md',
      mimeType: 'text/markdown',
      buffer: fixture('rassrochka.md'),
    })

    expect(doc.status).toBe('ready')
    const hits = await searchKnowledge(testDb, { query: 'машиноместо' })
    expect(hits.length).toBeGreaterThan(0)
  })

  it('нумерует фрагменты подряд с нуля', async () => {
    const text = Array.from({ length: 20 }, (_, index) => `Абзац ${index}. `.repeat(60)).join('\n\n')
    const doc = await ingestDocument(testDb, {
      filename: 'длинный.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(text, 'utf8'),
    })

    const chunks = await testDb.knowledgeChunk.findMany({
      where: { docId: doc.id },
      orderBy: { position: 'asc' },
      select: { position: true },
    })

    expect(chunks.length).toBe(doc.chunkCount)
    expect(chunks.map((chunk) => chunk.position)).toEqual(chunks.map((_, index) => index))
  })

  it('привязывает документ и его фрагменты к ЖК', async () => {
    const project = await testDb.project.create({ data: { name: 'ЖК Речной', slug: 'rechnoy' } })

    const doc = await ingestDocument(testDb, {
      filename: 'условия.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(USLOVIYA, 'utf8'),
      projectId: project.id,
    })

    expect(doc.projectId).toBe(project.id)
    expect(doc.projectName).toBe('ЖК Речной')

    const chunk = await testDb.knowledgeChunk.findFirst({ where: { docId: doc.id } })
    expect(chunk?.projectId).toBe(project.id)
  })

  it('не даёт привязать документ к несуществующему ЖК', async () => {
    await expect(
      ingestDocument(testDb, {
        filename: 'условия.txt',
        mimeType: 'text/plain',
        buffer: Buffer.from(USLOVIYA, 'utf8'),
        projectId: 'нет-такого-жк',
      }),
    ).rejects.toBeInstanceOf(UnknownProjectError)

    expect(await testDb.knowledgeDoc.count()).toBe(0)
  })

  it('битый файл получает статус ошибки и не мешает следующим загрузкам', async () => {
    const broken = await ingestDocument(testDb, {
      filename: 'broken.pdf',
      mimeType: 'application/pdf',
      buffer: fixture('broken.pdf'),
    })

    expect(broken.status).toBe('error')
    expect(broken.error).toMatch(/Не удалось прочитать PDF/)
    expect(broken.chunkCount).toBe(0)

    const good = await ingestDocument(testDb, {
      filename: 'pamyatka.txt',
      mimeType: 'text/plain',
      buffer: fixture('pamyatka.txt'),
    })

    expect(good.status).toBe('ready')
    expect(good.chunkCount).toBeGreaterThan(0)

    const documents = await listDocuments(testDb)
    expect(documents).toHaveLength(2)
  })

  it('скан без текстового слоя не становится готовым документом', async () => {
    const doc = await ingestDocument(testDb, {
      filename: 'skan.pdf',
      mimeType: 'application/pdf',
      buffer: fixture('skan.pdf'),
    })

    expect(doc.status).toBe('error')
    expect(doc.error).toMatch(/нет текстового слоя/)
    expect(doc.chunkCount).toBe(0)
    expect(doc.charCount).toBe(0)

    // Ни одного фрагмента в поиске: раньше документ считался готовым,
    // а поиск по нему молчал.
    expect(await testDb.knowledgeChunk.count()).toBe(0)
  })

  it('неподдерживаемый формат тоже виден в списке с причиной', async () => {
    const doc = await ingestDocument(testDb, {
      filename: 'план.dwg',
      mimeType: 'application/octet-stream',
      buffer: Buffer.from([1, 2, 3, 4]),
    })

    expect(doc.status).toBe('error')
    expect(doc.error).toMatch(/Формат файла не поддерживается/)
  })
})

describe('listDocuments', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('фильтрует по ЖК, а без фильтра отдаёт все', async () => {
    const project = await testDb.project.create({ data: { name: 'ЖК Речной', slug: 'rechnoy' } })
    const text = Buffer.from(USLOVIYA, 'utf8')

    await ingestDocument(testDb, { filename: 'общая.txt', mimeType: 'text/plain', buffer: text })
    await ingestDocument(testDb, {
      filename: 'речной.txt',
      mimeType: 'text/plain',
      buffer: text,
      projectId: project.id,
    })

    expect(await listDocuments(testDb)).toHaveLength(2)
    expect((await listDocuments(testDb, { projectId: project.id })).map((doc) => doc.filename)).toEqual(['речной.txt'])
    expect((await listDocuments(testDb, { projectId: null })).map((doc) => doc.filename)).toEqual(['общая.txt'])
  })
})

describe('deleteDocument', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('удаляет документ вместе с фрагментами', async () => {
    const doc = await ingestDocument(testDb, {
      filename: 'условия.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from(USLOVIYA, 'utf8'),
    })

    expect(await deleteDocument(testDb, doc.id)).toBe(true)
    expect(await testDb.knowledgeChunk.count()).toBe(0)
    expect(await testDb.knowledgeDoc.count()).toBe(0)
  })

  it('на несуществующий документ отвечает false', async () => {
    expect(await deleteDocument(testDb, 'нет-такого')).toBe(false)
  })
})
