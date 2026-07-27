import { describe, expect, it } from 'vitest'

import { signJwt, verifyJwt } from './jwt.js'

const SECRET = 'test-secret-длинная-строка'

describe('JWT', () => {
  it('возвращает содержимое токена, выпущенного с тем же секретом', () => {
    const token = signJwt({ sub: 'admin' }, SECRET, 3600)

    const payload = verifyJwt(token, SECRET)

    expect(payload?.sub).toBe('admin')
    expect(payload?.exp).toBeGreaterThan(payload?.iat ?? 0)
  })

  it('не принимает токен, подписанный чужим секретом', () => {
    const token = signJwt({ sub: 'admin' }, 'другой-секрет', 3600)

    expect(verifyJwt(token, SECRET)).toBeNull()
  })

  it('не принимает токен с подменённым содержимым', () => {
    const token = signJwt({ sub: 'admin' }, SECRET, 3600)
    const [head, , signature] = token.split('.')
    const forgedBody = Buffer.from(JSON.stringify({ sub: 'root', iat: 1, exp: 9999999999 })).toString(
      'base64url',
    )

    expect(verifyJwt(`${head}.${forgedBody}.${signature}`, SECRET)).toBeNull()
  })

  it('не принимает просроченный токен', () => {
    const issuedAt = Date.now()
    const token = signJwt({ sub: 'admin' }, SECRET, 60, issuedAt)

    expect(verifyJwt(token, SECRET, issuedAt + 61_000)).toBeNull()
    expect(verifyJwt(token, SECRET, issuedAt + 30_000)?.sub).toBe('admin')
  })

  it('не падает на мусоре вместо токена', () => {
    expect(verifyJwt('', SECRET)).toBeNull()
    expect(verifyJwt('не.токен', SECRET)).toBeNull()
    expect(verifyJwt('a.b.c', SECRET)).toBeNull()
  })
})
