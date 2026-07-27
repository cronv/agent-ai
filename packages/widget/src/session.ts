/**
 * Идентификатор посетителя и контекст страницы.
 *
 * `sessionId` — ключ к переписке: по нему сервер находит диалог и отдаёт
 * историю при возврате на сайт. Живёт в `localStorage`; если хранилище
 * недоступно (приватный режим, запрет сторонних данных), идентификатор
 * остаётся в памяти вкладки — чат работает, история просто не переживёт
 * перезагрузку.
 *
 * Формат согласован с сервером: 16–128 символов из латиницы, цифр, «-» и «_».
 */

const STORAGE_KEY = 'novostroyki-ai:session'

let memorySession: string | null = null

export function getSessionId(): string {
  const stored = readStorage()
  if (stored) return stored

  if (!memorySession) memorySession = createSessionId()
  writeStorage(memorySession)
  return memorySession
}

function readStorage(): string | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY)
    return value && /^[A-Za-z0-9_-]{16,128}$/.test(value) ? value : null
  } catch {
    return memorySession
  }
}

function writeStorage(value: string): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, value)
  } catch {
    // Хранилище закрыто — работаем в памяти.
  }
}

function createSessionId(): string {
  const uuid = window.crypto?.randomUUID?.()
  if (uuid) return uuid.replace(/-/g, '')

  const bytes = new Uint8Array(16)
  window.crypto?.getRandomValues?.(bytes)
  const random = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  // Даже если getRandomValues не сработал, длина укладывается в требования сервера.
  return `s${Date.now().toString(36)}${random}`.slice(0, 64)
}

// ── Контекст страницы ────────────────────────────────────────

export interface PageContext {
  pageUrl: string | null
  referrer: string | null
  utm: Record<string, string> | null
}

const UTM_KEYS = /^(utm_[a-z_]{1,30}|gclid|yclid|fbclid)$/i

/** Откуда пришёл посетитель — это попадёт в карточку лида в админке. */
export function readPageContext(): PageContext {
  const utm: Record<string, string> = {}
  try {
    for (const [key, value] of new URL(window.location.href).searchParams) {
      if (UTM_KEYS.test(key) && value.trim() !== '') utm[key.toLowerCase()] = value
    }
  } catch {
    // Экзотический адрес страницы — метки просто не соберутся.
  }

  return {
    pageUrl: window.location.href || null,
    referrer: document.referrer === '' ? null : document.referrer,
    utm: Object.keys(utm).length > 0 ? utm : null,
  }
}
