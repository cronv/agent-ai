import { createHmac, timingSafeEqual } from 'node:crypto'

/**
 * Минимальный JWT (HS256) — ровно столько, сколько нужно сессии админки.
 *
 *   const token = signJwt({ sub: 'admin' }, secret, 12 * 60 * 60)
 *   const payload = verifyJwt(token, secret)   // null, если подпись или срок не сошлись
 *
 * Отдельной библиотеки здесь нет намеренно: нужен один алгоритм (HS256),
 * одно применение (кука админки) и никаких внешних эмитентов токенов.
 */

export interface JwtPayload {
  /** Кто вошёл. Для админки — имя пользователя. */
  sub: string
  /** Момент выпуска, секунды unix. */
  iat: number
  /** Момент истечения, секунды unix. */
  exp: number
}

interface JwtHeader {
  alg: 'HS256'
  typ: 'JWT'
}

const HEADER: JwtHeader = { alg: 'HS256', typ: 'JWT' }

function base64UrlEncode(input: string | Buffer): string {
  return Buffer.from(input).toString('base64url')
}

function base64UrlDecode(input: string): string {
  return Buffer.from(input, 'base64url').toString('utf8')
}

function sign(data: string, secret: string): string {
  return createHmac('sha256', secret).update(data).digest('base64url')
}

/** Сравнение подписей за постоянное время — чтобы по скорости ответа нельзя было её подобрать. */
function signaturesMatch(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  if (left.length !== right.length) return false
  return timingSafeEqual(left, right)
}

/**
 * Выпускает токен со сроком жизни `ttlSeconds`.
 * `now` можно передать в тестах, чтобы проверить истечение без ожидания.
 */
export function signJwt(
  claims: { sub: string },
  secret: string,
  ttlSeconds: number,
  now: number = Date.now(),
): string {
  const issuedAt = Math.floor(now / 1000)
  const payload: JwtPayload = {
    sub: claims.sub,
    iat: issuedAt,
    exp: issuedAt + ttlSeconds,
  }
  const head = base64UrlEncode(JSON.stringify(HEADER))
  const body = base64UrlEncode(JSON.stringify(payload))
  const data = `${head}.${body}`
  return `${data}.${sign(data, secret)}`
}

/**
 * Проверяет подпись и срок. Возвращает содержимое токена
 * или `null` — на любой некорректный, чужой или просроченный токен.
 */
export function verifyJwt(token: string, secret: string, now: number = Date.now()): JwtPayload | null {
  const parts = token.split('.')
  if (parts.length !== 3) return null

  const [head, body, signature] = parts as [string, string, string]
  if (!signaturesMatch(sign(`${head}.${body}`, secret), signature)) return null

  let payload: unknown
  try {
    payload = JSON.parse(base64UrlDecode(body))
  } catch {
    return null
  }

  if (typeof payload !== 'object' || payload === null) return null
  const { sub, iat, exp } = payload as Record<string, unknown>
  if (typeof sub !== 'string' || typeof iat !== 'number' || typeof exp !== 'number') return null
  if (exp * 1000 <= now) return null

  return { sub, iat, exp }
}
