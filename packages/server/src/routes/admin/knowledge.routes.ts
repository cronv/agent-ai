import fastifyMultipart from '@fastify/multipart'
import type { FastifyPluginAsync } from 'fastify'

import {
  KNOWLEDGE_SEARCH_LIMIT,
  KNOWLEDGE_SEARCH_MAX_LIMIT,
  MAX_DOCUMENT_BYTES,
  UnknownProjectError,
  deleteDocument,
  ingestDocument,
  listDocuments,
  searchKnowledge,
} from '../../services/knowledge/index.js'

/**
 * База знаний в админке.
 *
 *   POST   /api/admin/knowledge          — загрузить документ (multipart/form-data)
 *   GET    /api/admin/knowledge          — список документов
 *   DELETE /api/admin/knowledge/:id      — удалить документ вместе с фрагментами
 *   GET    /api/admin/knowledge/search   — проверить, что и как находится
 *
 * Всё закрыто хуком из `plugins/auth.ts` — отдельная проверка не нужна.
 *
 * Разбор multipart подключается прямо здесь, а не в `app.ts`: файлы принимает
 * только этот раздел, и ограничение в 20 МБ должно жить рядом с ним.
 * Регистрация внутри плагина оставляет парсер в его области видимости.
 */

const knowledgeRoutes: FastifyPluginAsync = async (app) => {
  await app.register(fastifyMultipart, {
    limits: {
      fileSize: MAX_DOCUMENT_BYTES,
      files: 1,
      fields: 8,
    },
  })

  app.post('/api/admin/knowledge', async (request, reply) => {
    if (!request.isMultipart()) {
      return reply.code(415).send({
        error: 'not_multipart',
        message: 'Файл нужно отправить как multipart/form-data',
      })
    }

    let buffer: Buffer | null = null
    let filename = ''
    let mimeType = ''
    // Поле projectId может прийти и до файла, и после — читаем части подряд,
    // не полагаясь на порядок, в котором их разложил браузер.
    const query = request.query as { projectId?: string }
    let projectId: string | null = query.projectId !== undefined && query.projectId !== '' ? query.projectId : null

    try {
      for await (const part of request.parts()) {
        if (part.type === 'file') {
          if (buffer !== null) {
            // Лишний файл всё равно нужно вычитать, иначе поток встанет.
            await part.toBuffer()
            continue
          }
          buffer = await part.toBuffer()
          filename = part.filename
          mimeType = part.mimetype
        } else if (part.fieldname === 'projectId') {
          const value = String(part.value)
          projectId = value === '' ? null : value
        }
      }
    } catch (error) {
      if (isFileTooLargeError(error)) {
        return reply.code(413).send({
          error: 'file_too_large',
          message: `Файл больше ${Math.round(MAX_DOCUMENT_BYTES / (1024 * 1024))} МБ. Загрузите файл поменьше.`,
        })
      }
      throw error
    }

    if (buffer === null || filename === '') {
      return reply.code(400).send({ error: 'file_required', message: 'Не приложен файл' })
    }

    try {
      const doc = await ingestDocument(app.prisma, { filename, mimeType, buffer, projectId })
      return reply.code(201).send(doc)
    } catch (error) {
      if (error instanceof UnknownProjectError) {
        return reply.code(400).send({ error: 'unknown_project', message: 'ЖК не найден' })
      }
      throw error
    }
  })

  app.get('/api/admin/knowledge', async (request, reply) => {
    const { projectId } = request.query as { projectId?: string }
    const docs = await listDocuments(
      app.prisma,
      projectId === undefined ? {} : { projectId: projectId === '' ? null : projectId },
    )
    return reply.send({ documents: docs })
  })

  app.delete('/api/admin/knowledge/:id', async (request, reply) => {
    const { id } = request.params as { id: string }
    const removed = await deleteDocument(app.prisma, id)
    if (!removed) {
      return reply.code(404).send({ error: 'not_found', message: 'Документ не найден' })
    }
    return reply.code(204).send()
  })

  app.get('/api/admin/knowledge/search', async (request, reply) => {
    const { q, projectId, limit } = request.query as { q?: string; projectId?: string; limit?: string }

    if (q === undefined || q.trim() === '') {
      return reply.code(400).send({ error: 'query_required', message: 'Укажите поисковый запрос в параметре q' })
    }

    const parsedLimit = limit === undefined ? undefined : Number.parseInt(limit, 10)
    if (parsedLimit !== undefined && (Number.isNaN(parsedLimit) || parsedLimit < 1)) {
      return reply.code(400).send({
        error: 'bad_limit',
        message: `Параметр limit — целое число от 1 до ${KNOWLEDGE_SEARCH_MAX_LIMIT}`,
      })
    }

    const hits = await searchKnowledge(app.prisma, {
      query: q,
      projectId: projectId !== undefined && projectId !== '' ? projectId : null,
      limit: parsedLimit ?? KNOWLEDGE_SEARCH_LIMIT,
    })

    return reply.send({ query: q, results: hits })
  })
}

/** Busboy сообщает о превышении лимита своим кодом ошибки. */
function isFileTooLargeError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'FST_REQ_FILE_TOO_LARGE'
  )
}

export default knowledgeRoutes
