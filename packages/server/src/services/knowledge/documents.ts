import type { Db } from '../../db/prisma.js'
import { chunkText } from './chunk.js'
import { KnowledgeExtractionError, extractText } from './extract.js'

/**
 * Документы базы знаний: приём файла, нарезка, удаление.
 *
 *   const doc = await ingestDocument(app.prisma, { filename, mimeType, buffer, projectId })
 *
 * Загрузка не падает на плохом файле. Документ создаётся всегда, а неудача
 * извлечения текста превращается в статус `error` с понятным текстом рядом с
 * именем файла: человек видит в списке, что именно не прочиталось, и
 * загружает остальное дальше.
 */

/** Максимальный размер загружаемого файла. */
export const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024

export interface IngestDocumentInput {
  filename: string
  mimeType: string
  buffer: Buffer
  /** ЖК, к которому относится документ. `null` — общий для всех. */
  projectId?: string | null | undefined
}

export interface KnowledgeDocSummary {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  /** Сколько символов текста извлеклось. */
  charCount: number
  /** Сколько фрагментов получилось после нарезки. */
  chunkCount: number
  status: 'pending' | 'ready' | 'error'
  /** Почему документ не прочитался. `null` у здоровых документов. */
  error: string | null
  projectId: string | null
  projectName: string | null
  createdAt: string
}

/** ЖК с таким идентификатором нет — загружать документ некуда. */
export class UnknownProjectError extends Error {
  constructor(projectId: string) {
    super(`ЖК не найден: ${projectId}`)
    this.name = 'UnknownProjectError'
  }
}

interface DocWithProject {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  charCount: number
  status: 'pending' | 'ready' | 'error'
  error: string | null
  projectId: string | null
  createdAt: Date
  project: { name: string } | null
  _count?: { chunks: number }
}

function toSummary(doc: DocWithProject, chunkCount: number): KnowledgeDocSummary {
  return {
    id: doc.id,
    filename: doc.filename,
    mimeType: doc.mimeType,
    sizeBytes: doc.sizeBytes,
    charCount: doc.charCount,
    chunkCount,
    status: doc.status,
    error: doc.error,
    projectId: doc.projectId,
    projectName: doc.project?.name ?? null,
    createdAt: doc.createdAt.toISOString(),
  }
}

const DOC_SELECT = {
  id: true,
  filename: true,
  mimeType: true,
  sizeBytes: true,
  charCount: true,
  status: true,
  error: true,
  projectId: true,
  createdAt: true,
  project: { select: { name: true } },
  _count: { select: { chunks: true } },
} as const

export async function ingestDocument(db: Db, input: IngestDocumentInput): Promise<KnowledgeDocSummary> {
  const projectId = input.projectId ?? null

  if (projectId !== null) {
    const project = await db.project.findUnique({ where: { id: projectId }, select: { id: true } })
    if (!project) throw new UnknownProjectError(projectId)
  }

  const created = await db.knowledgeDoc.create({
    data: {
      projectId,
      filename: input.filename,
      mimeType: input.mimeType,
      sizeBytes: input.buffer.length,
      status: 'pending',
    },
    select: { id: true },
  })

  let chunks: string[] = []
  let charCount = 0
  let failure: string | null = null

  try {
    const text = await extractText({ buffer: input.buffer, filename: input.filename, mimeType: input.mimeType })
    chunks = chunkText(text)
    charCount = text.length
    if (chunks.length === 0) {
      failure = 'После разбора файла не осталось текста для поиска'
    }
  } catch (error) {
    failure =
      error instanceof KnowledgeExtractionError
        ? error.message
        : `Не удалось разобрать файл: ${error instanceof Error ? error.message : String(error)}`
  }

  if (failure === null) {
    // Колонку tsv заполняет триггер knowledge_chunks_tsv_update —
    // считать to_tsvector здесь не нужно.
    await db.knowledgeChunk.createMany({
      data: chunks.map((content, position) => ({ docId: created.id, projectId, content, position })),
    })
  }

  const doc = await db.knowledgeDoc.update({
    where: { id: created.id },
    data: {
      status: failure === null ? 'ready' : 'error',
      error: failure,
      charCount: failure === null ? charCount : 0,
    },
    select: DOC_SELECT,
  })

  return toSummary(doc, doc._count.chunks)
}

export interface ListDocumentsFilter {
  /** Только документы этого ЖК. `null` — только общие. Не задан — все. */
  projectId?: string | null | undefined
}

export async function listDocuments(db: Db, filter: ListDocumentsFilter = {}): Promise<KnowledgeDocSummary[]> {
  const docs = await db.knowledgeDoc.findMany({
    where: filter.projectId === undefined ? {} : { projectId: filter.projectId },
    orderBy: { createdAt: 'desc' },
    select: DOC_SELECT,
  })

  return docs.map((doc) => toSummary(doc, doc._count.chunks))
}

export async function getDocument(db: Db, id: string): Promise<KnowledgeDocSummary | null> {
  const doc = await db.knowledgeDoc.findUnique({ where: { id }, select: DOC_SELECT })
  return doc ? toSummary(doc, doc._count.chunks) : null
}

/**
 * Удаляет документ вместе с фрагментами — они уходят каскадом по внешнему
 * ключу, и из выдачи поиска документ пропадает сразу.
 *
 * @returns `false`, если такого документа не было.
 */
export async function deleteDocument(db: Db, id: string): Promise<boolean> {
  const deleted = await db.knowledgeDoc.deleteMany({ where: { id } })
  return deleted.count > 0
}
