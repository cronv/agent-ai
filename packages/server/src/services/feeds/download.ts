/**
 * Скачивание файла выгрузки.
 *
 * Отдельный модуль, потому что это единственное место импорта, которое ходит
 * в сеть: в тестах он подменяется через `importFeed(feedId, { download })`,
 * и весь остальной импорт проверяется без интернета.
 *
 * Любая беда — недоступный хост, 404, таймаут, гигантский файл — становится
 * `FeedDownloadError` с текстом, который не стыдно показать в админке.
 */

export class FeedDownloadError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'FeedDownloadError'
  }
}

export interface DownloadOptions {
  /** Сколько ждать ответа целиком, миллисекунды. */
  timeoutMs?: number
  /** Предел размера файла, байты. Больше — ошибка, а не съеденная память. */
  maxBytes?: number
}

/** Функция скачивания. Подменяется в тестах. */
export type FeedDownloader = (url: string, options: Required<DownloadOptions>) => Promise<string>

export const DEFAULT_TIMEOUT_MS = 60_000
export const DEFAULT_MAX_BYTES = 128 * 1024 * 1024

export async function downloadFeed(url: string, options: DownloadOptions = {}): Promise<string> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
  const maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES

  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new FeedDownloadError(`Ссылка на фид неправильная: ${url}`)
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new FeedDownloadError(`Поддерживаются только ссылки http и https, получено: ${parsed.protocol}`)
  }

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)

  try {
    const response = await fetch(parsed, {
      signal: controller.signal,
      redirect: 'follow',
      headers: {
        accept: 'application/xml, text/xml, application/rss+xml, */*',
        'user-agent': 'novostroyki-ai/1.0 (+feed-sync)',
      },
    })

    if (!response.ok) {
      throw new FeedDownloadError(`Сервер ответил ${response.status} ${response.statusText || ''}`.trim())
    }

    const declaredLength = Number(response.headers.get('content-length') ?? '')
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new FeedDownloadError(`Файл слишком большой: ${formatBytes(declaredLength)}, предел ${formatBytes(maxBytes)}`)
    }

    const buffer = await response.arrayBuffer()
    if (buffer.byteLength > maxBytes) {
      throw new FeedDownloadError(`Файл слишком большой: ${formatBytes(buffer.byteLength)}, предел ${formatBytes(maxBytes)}`)
    }
    return decodeXml(buffer)
  } catch (error) {
    if (error instanceof FeedDownloadError) throw error
    if (timedOut) {
      throw new FeedDownloadError(`Сервер не ответил за ${Math.round(timeoutMs / 1000)} с`)
    }
    throw new FeedDownloadError(`Не удалось скачать фид: ${error instanceof Error ? error.message : String(error)}`)
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Текст из байтов. Выгрузки бывают в windows-1251 — кодировка объявлена
 * в самом XML, поэтому сначала читаем шапку как латиницу и, если там не UTF-8,
 * перечитываем нужным декодером.
 */
function decodeXml(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer)
  const head = new TextDecoder('latin1').decode(bytes.subarray(0, 200))
  const match = /encoding\s*=\s*["']([\w-]+)["']/i.exec(head)
  const encoding = (match?.[1] ?? 'utf-8').toLowerCase()

  if (encoding === 'utf-8' || encoding === 'utf8') {
    return new TextDecoder('utf-8').decode(bytes)
  }
  try {
    const decoded = new TextDecoder(encoding).decode(bytes)
    // В разобранном тексте объявление кодировки уже неверно — правим шапку,
    // иначе парсер решит, что перед ним снова windows-1251.
    return decoded.replace(/(<\?xml[^?]*encoding\s*=\s*["'])[\w-]+(["'])/i, '$1utf-8$2')
  } catch {
    return new TextDecoder('utf-8').decode(bytes)
  }
}

function formatBytes(bytes: number): string {
  return `${Math.round(bytes / (1024 * 1024))} МБ`
}
