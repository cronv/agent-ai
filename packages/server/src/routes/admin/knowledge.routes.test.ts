import { readFileSync } from 'node:fs'

import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'

import { buildApp } from '../../app.js'
import { env } from '../../config/env.js'
import { ADMIN_SESSION_COOKIE } from '../../plugins/auth.js'
import { MAX_DOCUMENT_BYTES } from '../../services/knowledge/index.js'
import type { KnowledgeDocSummary, KnowledgeSearchHit } from '../../services/knowledge/index.js'
import { resetDatabase, testDb } from '../../testing/db.js'
import { resetLoginAttempts } from './auth.routes.js'

/**
 * Загрузка идёт настоящим multipart-запросом: именно на разборе тела и на
 * лимите размера ломается приём файлов, поэтому тело собирается руками,
 * а не подменяется объектом.
 */

const BOUNDARY = '----novostroykiTestBoundary'

interface UploadFile {
  filename: string
  contentType: string
  content: Buffer
}

function multipartBody(file: UploadFile | null, fields: Record<string, string> = {}): Buffer {
  const parts: Buffer[] = []

  for (const [name, value] of Object.entries(fields)) {
    parts.push(
      Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="${name}"\r\n\r\n${value}\r\n`, 'utf8'),
    )
  }

  if (file) {
    parts.push(
      Buffer.from(
        `--${BOUNDARY}\r\n` +
          `Content-Disposition: form-data; name="file"; filename="${file.filename}"\r\n` +
          `Content-Type: ${file.contentType}\r\n\r\n`,
        'utf8',
      ),
      file.content,
      Buffer.from('\r\n', 'utf8'),
    )
  }

  parts.push(Buffer.from(`--${BOUNDARY}--\r\n`, 'utf8'))
  return Buffer.concat(parts)
}

function fixture(name: string): Buffer {
  return readFileSync(new URL(`../../services/knowledge/__fixtures__/${name}`, import.meta.url))
}

function textFile(filename: string, text: string): UploadFile {
  return { filename, contentType: 'text/plain', content: Buffer.from(text, 'utf8') }
}

describe('/api/admin/knowledge', () => {
  let app: FastifyInstance
  let cookie: string

  beforeAll(async () => {
    app = await buildApp({ prisma: testDb, serveStatic: false })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  beforeEach(async () => {
    await resetDatabase()
    resetLoginAttempts()
    const login = await app.inject({
      method: 'POST',
      url: '/api/admin/login',
      payload: { username: env.adminUsername, password: env.adminPassword },
    })
    const issued = login.cookies.find((item) => item.name === ADMIN_SESSION_COOKIE)
    cookie = `${ADMIN_SESSION_COOKIE}=${String(issued?.value)}`
  })

  async function upload(
    file: UploadFile | null,
    fields: Record<string, string> = {},
  ): Promise<ReturnType<FastifyInstance['inject']>> {
    return app.inject({
      method: 'POST',
      url: '/api/admin/knowledge',
      headers: {
        cookie,
        'content-type': `multipart/form-data; boundary=${BOUNDARY}`,
      },
      payload: multipartBody(file, fields),
    })
  }

  it('без сессии загрузка закрыта', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/knowledge',
      headers: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` },
      payload: multipartBody(textFile('условия.txt', 'Ипотека от 6% годовых.')),
    })

    expect(response.statusCode).toBe(401)
  })

  it('принимает PDF и отдаёт разобранный документ', async () => {
    const response = await upload({
      filename: 'ipoteka.pdf',
      contentType: 'application/pdf',
      content: fixture('ipoteka.pdf'),
    })

    expect(response.statusCode).toBe(201)
    const doc = response.json<KnowledgeDocSummary>()
    expect(doc.status).toBe('ready')
    expect(doc.filename).toBe('ipoteka.pdf')
    expect(doc.chunkCount).toBeGreaterThan(0)
  })

  it('принимает TXT вместе с привязкой к ЖК', async () => {
    const project = await testDb.project.create({ data: { name: 'ЖК Речной', slug: 'rechnoy' } })

    const response = await upload(textFile('условия.txt', 'Ипотека с господдержкой от 6% годовых.'), {
      projectId: project.id,
    })

    expect(response.statusCode).toBe(201)
    const doc = response.json<KnowledgeDocSummary>()
    expect(doc.projectId).toBe(project.id)
    expect(doc.projectName).toBe('ЖК Речной')
  })

  it('на несуществующий ЖК отвечает 400', async () => {
    const response = await upload(textFile('условия.txt', 'Ипотека от 6% годовых.'), { projectId: 'нет-такого' })

    expect(response.statusCode).toBe(400)
    expect(response.json<{ error: string }>().error).toBe('unknown_project')
  })

  it('без файла отвечает 400', async () => {
    const response = await upload(null, { projectId: '' })

    expect(response.statusCode).toBe(400)
    expect(response.json<{ error: string }>().error).toBe('file_required')
  })

  it('не multipart — 415 с объяснением', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/admin/knowledge',
      headers: { cookie },
      payload: { filename: 'условия.txt' },
    })

    expect(response.statusCode).toBe(415)
    expect(response.json<{ message: string }>().message).toContain('multipart/form-data')
  })

  it('файл больше 20 МБ отклоняется с внятной ошибкой', async () => {
    const oversized = Buffer.alloc(MAX_DOCUMENT_BYTES + 1024, 0x41)

    const response = await upload({ filename: 'огромный.txt', contentType: 'text/plain', content: oversized })

    expect(response.statusCode).toBe(413)
    const body = response.json<{ error: string; message: string }>()
    expect(body.error).toBe('file_too_large')
    expect(body.message).toContain('20 МБ')
    expect(await testDb.knowledgeDoc.count()).toBe(0)
  })

  it('битый файл сохраняется со статусом ошибки, а не роняет запрос', async () => {
    const response = await upload({
      filename: 'broken.pdf',
      contentType: 'application/pdf',
      content: fixture('broken.pdf'),
    })

    expect(response.statusCode).toBe(201)
    const doc = response.json<KnowledgeDocSummary>()
    expect(doc.status).toBe('error')
    expect(doc.error).toMatch(/Не удалось прочитать PDF/)

    // Следующая загрузка проходит как ни в чём не бывало.
    const next = await upload(textFile('условия.txt', 'Ипотека от 6% годовых.'))
    expect(next.json<KnowledgeDocSummary>().status).toBe('ready')
  })

  it('отдаёт список документов, свежие сверху', async () => {
    await upload(textFile('первый.txt', 'Ипотека от 6% годовых.'))
    await upload(textFile('второй.txt', 'Рассрочка без процентов.'))

    const response = await app.inject({ method: 'GET', url: '/api/admin/knowledge', headers: { cookie } })

    expect(response.statusCode).toBe(200)
    const { documents } = response.json<{ documents: KnowledgeDocSummary[] }>()
    expect(documents.map((doc) => doc.filename)).toEqual(['второй.txt', 'первый.txt'])
  })

  it('удаление убирает документ и его фрагменты из поиска', async () => {
    const created = await upload(textFile('условия.txt', 'Ипотека с господдержкой от 6% годовых.'))
    const { id } = created.json<KnowledgeDocSummary>()

    const before = await app.inject({
      method: 'GET',
      url: '/api/admin/knowledge/search?q=ипотека',
      headers: { cookie },
    })
    expect(before.json<{ results: KnowledgeSearchHit[] }>().results).toHaveLength(1)

    const removed = await app.inject({ method: 'DELETE', url: `/api/admin/knowledge/${id}`, headers: { cookie } })
    expect(removed.statusCode).toBe(204)

    const after = await app.inject({
      method: 'GET',
      url: '/api/admin/knowledge/search?q=ипотека',
      headers: { cookie },
    })
    expect(after.json<{ results: KnowledgeSearchHit[] }>().results).toEqual([])
    expect(await testDb.knowledgeChunk.count()).toBe(0)
  })

  it('удаление несуществующего документа — 404', async () => {
    const response = await app.inject({ method: 'DELETE', url: '/api/admin/knowledge/нет', headers: { cookie } })
    expect(response.statusCode).toBe(404)
  })

  it('поиск ищет с учётом морфологии и ограничен ЖК', async () => {
    const river = await testDb.project.create({ data: { name: 'ЖК Речной', slug: 'rechnoy' } })
    const park = await testDb.project.create({ data: { name: 'ЖК Парковый', slug: 'parkovyy' } })

    await upload(textFile('речной.txt', 'Ипотечная программа ЖК Речной: ставка от 6% годовых.'), {
      projectId: river.id,
    })
    await upload(textFile('парковый.txt', 'Ипотека в ЖК Парковый от 8% годовых.'), { projectId: park.id })

    const response = await app.inject({
      method: 'GET',
      url: `/api/admin/knowledge/search?q=${encodeURIComponent('ипотека')}&projectId=${river.id}`,
      headers: { cookie },
    })

    expect(response.statusCode).toBe(200)
    const { results } = response.json<{ results: KnowledgeSearchHit[] }>()
    expect(results.map((hit) => hit.documentTitle)).toEqual(['речной.txt'])
    expect(results[0]?.projectName).toBe('ЖК Речной')
  })

  it('поиск без запроса — 400', async () => {
    const response = await app.inject({ method: 'GET', url: '/api/admin/knowledge/search', headers: { cookie } })
    expect(response.statusCode).toBe(400)
    expect(response.json<{ error: string }>().error).toBe('query_required')
  })
})
