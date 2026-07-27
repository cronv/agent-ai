import { describe, expect, it, vi } from 'vitest'

import { deliverLeadWebhook, type LeadWebhookPayload } from './webhook.js'

/**
 * В интернет тесты не ходят: `fetch` подменяется целиком.
 * Проверяется договорённость с внешним воркером — тело, таймаут, один повтор.
 */

const payload: LeadWebhookPayload = {
  name: 'Иван',
  phone: '+79123456789',
  lead_name: 'Заявка из чата — Иван',
  comment: 'Хочу двушку',
  meta: { page: 'https://site.ru/zhk', referrer: null, utm: { utm_source: 'yandex' } },
}

function ok(): Response {
  return new Response('{}', { status: 200 })
}

describe('deliverLeadWebhook', () => {
  it('отправляет POST с JSON-телом заданного формата', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(ok())

    const result = await deliverLeadWebhook({ url: 'https://hook.example/lead', payload, fetchImpl })

    expect(result).toEqual({ ok: true })
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    const [url, init] = fetchImpl.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('https://hook.example/lead')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual(payload)
  })

  it('повторяет один раз, если сервер ответил ошибкой, и засчитывает успех', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response('', { status: 502 })).mockResolvedValueOnce(ok())

    const result = await deliverLeadWebhook({ url: 'https://hook.example/lead', payload, fetchImpl, retryDelayMs: 0 })

    expect(result).toEqual({ ok: true })
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('после двух неудач возвращает текст ошибки', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('соединение закрыто'))

    const result = await deliverLeadWebhook({ url: 'https://hook.example/lead', payload, fetchImpl, retryDelayMs: 0 })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ ok: false, error: 'соединение закрыто' })
  })

  it('не повторяет на 4xx: вебхук ответил, и ответ не изменится', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 403 }))

    const result = await deliverLeadWebhook({ url: 'https://hook.example/lead', payload, fetchImpl, retryDelayMs: 0 })

    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(false)
    if (result.ok) throw new Error('ожидалась ошибка')
    expect(result.error).toContain('403')
  })

  it('обрывает запрос по таймауту и говорит об этом человеческим текстом', async () => {
    const fetchImpl = vi.fn(
      (_url: string, init: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new DOMException('The operation was aborted', 'TimeoutError'))
          })
        }),
    )

    const result = await deliverLeadWebhook({
      url: 'https://hook.example/lead',
      payload,
      fetchImpl,
      timeoutMs: 20,
      retryDelayMs: 0,
    })

    expect(fetchImpl).toHaveBeenCalledTimes(2)
    expect(result).toEqual({ ok: false, error: 'Вебхук не ответил вовремя' })
  })
})
