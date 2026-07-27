import mammoth from 'mammoth'
import { PDFParse } from 'pdf-parse'

/**
 * Извлечение текста из загруженного документа.
 *
 *   const text = await extractText({ buffer, filename: 'Ипотека.pdf', mimeType })
 *
 * Поддерживаются четыре формата: PDF, DOCX и простой текст (TXT/MD).
 * Формат определяется по расширению имени файла, а если расширения нет —
 * по MIME-типу из запроса: браузеры и почтовые клиенты врут и о том, и о
 * другом, но расширение врёт реже.
 *
 * Любая неудача — это `KnowledgeExtractionError` с текстом, который не стыдно
 * показать человеку в админке. Ошибка не считается сбоем сервера: документ
 * сохраняется со статусом `error`, остальные загрузки продолжают работать.
 */

/** Ошибка, текст которой показывается пользователю как есть. */
export class KnowledgeExtractionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'KnowledgeExtractionError'
  }
}

export type KnowledgeFileKind = 'pdf' | 'docx' | 'text'

export interface ExtractInput {
  buffer: Buffer
  filename: string
  mimeType?: string | undefined
}

const EXTENSION_KINDS: Record<string, KnowledgeFileKind> = {
  pdf: 'pdf',
  docx: 'docx',
  txt: 'text',
  md: 'text',
  markdown: 'text',
}

const MIME_KINDS: Record<string, KnowledgeFileKind> = {
  'application/pdf': 'pdf',
  'application/x-pdf': 'pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'text/plain': 'text',
  'text/markdown': 'text',
  'text/x-markdown': 'text',
}

/** Человекочитаемый список поддерживаемых форматов — попадает в текст ошибки. */
export const SUPPORTED_FORMATS_HINT = 'PDF, DOCX, TXT или MD'

export function detectFileKind(filename: string, mimeType?: string | undefined): KnowledgeFileKind | null {
  const extension = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() : undefined
  if (extension !== undefined && extension in EXTENSION_KINDS) {
    return EXTENSION_KINDS[extension] ?? null
  }

  const normalizedMime = (mimeType ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  return MIME_KINDS[normalizedMime] ?? null
}

function reason(error: unknown): string {
  return error instanceof Error && error.message !== '' ? error.message : String(error)
}

async function extractPdf(buffer: Buffer): Promise<string> {
  // PDFParse держит открытым воркер pdf.js — его обязательно закрывать,
  // иначе процесс не завершается после прогона тестов.
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  try {
    const result = await parser.getText()
    return result.text
  } catch (error) {
    throw new KnowledgeExtractionError(`Не удалось прочитать PDF: ${reason(error)}`)
  } finally {
    await parser.destroy().catch(() => undefined)
  }
}

async function extractDocx(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer })
    return result.value
  } catch (error) {
    throw new KnowledgeExtractionError(`Не удалось прочитать DOCX: ${reason(error)}`)
  }
}

/**
 * Простой текст. Байты, которые не складываются в UTF-8, декодер заменяет на
 * U+FFFD — по их доле видно, что это вообще не текст, а, например,
 * переименованная картинка.
 */
function extractPlainText(buffer: Buffer): string {
  const text = new TextDecoder('utf-8').decode(buffer)
  const damaged = (text.match(/�/g) ?? []).length
  if (text.length > 0 && damaged / text.length > 0.1) {
    throw new KnowledgeExtractionError('Файл не похож на текст в кодировке UTF-8')
  }
  return text.replace(/\0/g, '')
}

export async function extractText(input: ExtractInput): Promise<string> {
  if (input.buffer.length === 0) {
    throw new KnowledgeExtractionError('Файл пустой')
  }

  const kind = detectFileKind(input.filename, input.mimeType)
  if (kind === null) {
    throw new KnowledgeExtractionError(`Формат файла не поддерживается — нужен ${SUPPORTED_FORMATS_HINT}`)
  }

  const text =
    kind === 'pdf'
      ? await extractPdf(input.buffer)
      : kind === 'docx'
        ? await extractDocx(input.buffer)
        : extractPlainText(input.buffer)

  if (text.trim() === '') {
    throw new KnowledgeExtractionError(
      'В файле не нашлось текста — возможно, это скан или презентация из одних картинок',
    )
  }

  return text
}
