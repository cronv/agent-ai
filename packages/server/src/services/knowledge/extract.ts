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
 *
 * Отдельная неудача — файл, который прочитался, но текста в себе не несёт.
 * Скан-презентация на две страницы дала ровно 32 символа: «-- 1 of 2 --» и
 * «-- 2 of 2 --», разделители страниц, которые дописывает сам разборщик.
 * Формально извлечение прошло, документ получил статус «готово», и человек
 * несколько часов гадал, почему ассистент по нему молчит. Поэтому пустота
 * проверяется до сохранения и объясняется словами — см. `assertHasContent`.
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

/**
 * Результат извлечения: текст и, если формат про это знает, число страниц.
 * Страницы нужны не для показа, а для оценки плотности текста: 200 символов
 * на одной странице — памятка, те же 200 на сорока — скан с подписью.
 */
interface Extracted {
  text: string
  /** `null` — формат постраничного деления не имеет (DOCX, TXT). */
  pages: number | null
}

async function extractPdf(buffer: Buffer): Promise<Extracted> {
  // PDFParse держит открытым воркер pdf.js — его обязательно закрывать,
  // иначе процесс не завершается после прогона тестов.
  const parser = new PDFParse({ data: new Uint8Array(buffer) })
  try {
    // pageJoiner по умолчанию дописывает в конец каждой страницы
    // «-- 1 of 2 --». Это разметка разборщика, а не содержимое файла: попав
    // в текст, она и делала скан «непустым». Заменяем её пустой строкой —
    // границу абзаца между страницами она сохраняет, символов не добавляет.
    const result = await parser.getText({ pageJoiner: '\n\n' })
    return { text: result.text, pages: result.total }
  } catch (error) {
    throw new KnowledgeExtractionError(`Не удалось прочитать PDF: ${reason(error)}`)
  } finally {
    await parser.destroy().catch(() => undefined)
  }
}

async function extractDocx(buffer: Buffer): Promise<Extracted> {
  try {
    const result = await mammoth.extractRawText({ buffer })
    return { text: result.value, pages: null }
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

/**
 * Сколько в тексте букв и цифр. Пробелы, дефисы, точки и прочая пунктуация не
 * в счёт: страница из одних разделителей и маркеров списка — это не документ,
 * сколько бы символов в ней ни было.
 */
export function countMeaningfulChars(text: string): number {
  return (text.match(/[\p{L}\p{N}]/gu) ?? []).length
}

/**
 * Ниже этого документ пуст при любом числе страниц.
 *
 * Порог намеренно низкий — два слова. «Ипотека от 6% годовых» — короткий, но
 * настоящий документ, и отбраковать его хуже, чем пропустить: ассистент
 * ответит хотя бы этим. Основную работу делает не он, а плотность ниже.
 */
export const MIN_MEANINGFUL_CHARS = 12

/**
 * Столько букв и цифр должно приходиться на страницу, когда число страниц
 * известно.
 *
 * Одного общего числа мало: 200 символов на одной странице — нормальная
 * памятка, те же 200 на сорока страницах — презентация из картинок, у которой
 * текстом оказались разве что колонтитулы. Страница настоящего документа не
 * бывает пустее одной строки.
 */
export const MIN_CHARS_PER_PAGE = 20

/** Что показать администратору, когда текста в файле нет. */
export const NO_TEXT_LAYER_MESSAGE =
  'В файле нет текстового слоя — скорее всего это скан или презентация из картинок. ' +
  'Текст с изображений мы не распознаём, поэтому отвечать по такому файлу ассистент не сможет. ' +
  'Загрузите файл, в котором текст выделяется мышью: Word, обычный текст или PDF с текстовым слоем.'

/**
 * Проверка «в файле есть что читать». Общая для всех форматов: скан бывает
 * и PDF, и DOCX с одной вставленной картинкой на страницу.
 */
export function assertHasContent(text: string, pages: number | null): void {
  const meaningful = countMeaningfulChars(text)
  const required =
    pages !== null && pages > 0 ? Math.max(MIN_MEANINGFUL_CHARS, pages * MIN_CHARS_PER_PAGE) : MIN_MEANINGFUL_CHARS

  if (meaningful < required) {
    throw new KnowledgeExtractionError(NO_TEXT_LAYER_MESSAGE)
  }
}

export async function extractText(input: ExtractInput): Promise<string> {
  if (input.buffer.length === 0) {
    throw new KnowledgeExtractionError('Файл пустой')
  }

  const kind = detectFileKind(input.filename, input.mimeType)
  if (kind === null) {
    throw new KnowledgeExtractionError(`Формат файла не поддерживается — нужен ${SUPPORTED_FORMATS_HINT}`)
  }

  const extracted =
    kind === 'pdf'
      ? await extractPdf(input.buffer)
      : kind === 'docx'
        ? await extractDocx(input.buffer)
        : { text: extractPlainText(input.buffer), pages: null }

  assertHasContent(extracted.text, extracted.pages)

  return extracted.text
}
