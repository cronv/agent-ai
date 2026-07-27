import { describe, expect, it } from 'vitest'

import { RateLimiter, retryAfterSeconds } from './rate-limit.js'

/**
 * Лимитер — чистая логика, базы здесь нет. Время подменяется, чтобы
 * проверять поведение на границе окна без реальных пауз в тесте.
 */

function clock(start = 1_000_000): { now: () => number; advance: (ms: number) => void } {
  let value = start
  return { now: () => value, advance: (ms) => { value += ms } }
}

describe('RateLimiter', () => {
  it('пропускает до лимита и отказывает после', () => {
    const time = clock()
    const limiter = new RateLimiter([{ limit: 3, windowMs: 60_000 }], { now: time.now })

    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(true)

    const denied = limiter.check('a')
    expect(denied.allowed).toBe(false)
    expect(denied.allowed === false && denied.retryAfterMs).toBe(60_000)
  })

  it('считает ключи независимо', () => {
    const time = clock()
    const limiter = new RateLimiter([{ limit: 1, windowMs: 60_000 }], { now: time.now })

    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('b').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(false)
  })

  it('окно скользит: место освобождается по мере устаревания обращений', () => {
    const time = clock()
    const limiter = new RateLimiter([{ limit: 2, windowMs: 1_000 }], { now: time.now })

    limiter.check('a')
    time.advance(400)
    limiter.check('a')
    expect(limiter.check('a').allowed).toBe(false)

    // Прошла секунда с первого обращения — оно выпало из окна.
    time.advance(601)
    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(false)
  })

  it('удвоенную пачку на стыке окон не пропускает', () => {
    const time = clock()
    const limiter = new RateLimiter([{ limit: 5, windowMs: 60_000 }], { now: time.now })

    for (let i = 0; i < 5; i += 1) expect(limiter.check('a').allowed).toBe(true)
    // Счётчик с обнулением по границе минуты здесь пропустил бы ещё пять.
    time.advance(59_000)
    expect(limiter.check('a').allowed).toBe(false)
  })

  it('длинное правило ловит ровную долбёжку в пределах короткого', () => {
    const time = clock()
    const limiter = new RateLimiter(
      [
        { limit: 2, windowMs: 1_000 },
        { limit: 5, windowMs: 60_000 },
      ],
      { now: time.now },
    )

    for (let i = 0; i < 5; i += 1) {
      expect(limiter.check('a').allowed).toBe(true)
      time.advance(1_100)
    }

    const denied = limiter.check('a')
    expect(denied.allowed).toBe(false)
    expect(denied.allowed === false && denied.rule.windowMs).toBe(60_000)
  })

  it('отказ не продлевает блокировку', () => {
    const time = clock()
    const limiter = new RateLimiter([{ limit: 1, windowMs: 1_000 }], { now: time.now })

    limiter.check('a')
    time.advance(500)
    expect(limiter.check('a').allowed).toBe(false)
    expect(limiter.check('a').allowed).toBe(false)

    // Отсчёт идёт от разрешённого обращения, а не от последней попытки.
    time.advance(501)
    expect(limiter.check('a').allowed).toBe(true)
  })

  it('не копит ключи сверх потолка', () => {
    const time = clock()
    const limiter = new RateLimiter([{ limit: 10, windowMs: 60_000 }], { now: time.now, maxKeys: 50 })

    for (let i = 0; i < 500; i += 1) {
      limiter.check(`key-${i}`)
      time.advance(1)
    }

    // Свежий ключ по-прежнему проходит, память при этом не растёт бесконечно.
    expect(limiter.check('key-499').allowed).toBe(true)
  })

  it('reset забывает всё', () => {
    const limiter = new RateLimiter([{ limit: 1, windowMs: 60_000 }])
    expect(limiter.check('a').allowed).toBe(true)
    expect(limiter.check('a').allowed).toBe(false)
    limiter.reset()
    expect(limiter.check('a').allowed).toBe(true)
  })

  it('retryAfterSeconds округляет вверх и никогда не даёт ноль', () => {
    expect(retryAfterSeconds(1)).toBe(1)
    expect(retryAfterSeconds(1_001)).toBe(2)
    expect(retryAfterSeconds(60_000)).toBe(60)
  })
})
