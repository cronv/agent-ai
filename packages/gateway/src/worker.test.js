import { describe, expect, it, vi } from 'vitest'

import { forwardedHeaders, handle, routeFor } from './worker.js'

/**
 * Cloudflare тут не поднимается: `handle` принимает `fetch` отдельным
 * аргументом, и подменяется именно он. Проверяется то, на чём такие шлюзы
 * и ломаются, — сборка адреса, отсев заголовков и потоковая передача тела.
 */

const TOKEN = 'secret-token-12345'
const env = { GATEWAY_TOKEN: TOKEN }

/** Подменённый Anthropic: запоминает запрос и отвечает, чем скажут. */
function upstream(response = new Response('{}', { status: 200 })) {
  /** @type {Array<{ url: string; init: RequestInit }>} */
  const calls = []
  /**
   * @param {RequestInfo | URL} url
   * @param {RequestInit} [init]
   */
  async function forward(url, init) {
    calls.push({ url: String(url), init: init ?? {} })
    return response
  }
  return { impl: vi.fn(forward), calls }
}

/**
 * @param {string} path
 * @param {RequestInit} [init]
 */
function post(path, init = {}) {
  return new Request(`https://gate.workers.dev${path}`, { method: 'POST', ...init })
}

describe('routeFor', () => {
  it('отрезает секрет и оставляет путь для Anthropic', () => {
    expect(routeFor(`/${TOKEN}/v1/messages`, TOKEN)).toBe('/v1/messages')
  })

  it('без секрета пути нет', () => {
    expect(routeFor('/v1/messages', TOKEN)).toBeNull()
  })

  it('чужой секрет не подходит', () => {
    expect(routeFor('/secret-token-1234/v1/messages', TOKEN)).toBeNull()
  })

  it('секрет как часть более длинного куска не считается совпадением', () => {
    // Иначе `/secret-token-12345678/...` открыл бы шлюз тому, кто угадал
    // только начало.
    expect(routeFor(`/${TOKEN}678/v1/messages`, TOKEN)).toBeNull()
  })
})

describe('forwardedHeaders', () => {
  it('пропускает заголовки Anthropic', () => {
    const headers = forwardedHeaders(
      new Headers({ 'x-api-key': 'sk-ant-xxx', 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }),
    )

    expect(headers.get('x-api-key')).toBe('sk-ant-xxx')
    expect(headers.get('anthropic-version')).toBe('2023-06-01')
    expect(headers.get('content-type')).toBe('application/json')
  })

  it('не пересылает служебные заголовки Cloudflare', () => {
    // Среди cf-* едут IP посетителя и его страна. Anthropic они не нужны.
    const headers = forwardedHeaders(
      new Headers({ 'cf-connecting-ip': '203.0.113.7', 'cf-ipcountry': 'RU', 'x-api-key': 'sk-ant-xxx' }),
    )

    expect(headers.get('cf-connecting-ip')).toBeNull()
    expect(headers.get('cf-ipcountry')).toBeNull()
    expect(headers.get('x-api-key')).toBe('sk-ant-xxx')
  })

  it('не тащит host — иначе Anthropic получит имя воркера', () => {
    expect(forwardedHeaders(new Headers({ host: 'gate.workers.dev' })).get('host')).toBeNull()
  })
})

describe('handle', () => {
  it('передаёт запрос в Anthropic по тому же пути и с теми же параметрами', async () => {
    const { impl, calls } = upstream()

    await handle(post(`/${TOKEN}/v1/messages?beta=true`, { body: '{"model":"x"}' }), env, impl)

    expect(calls).toHaveLength(1)
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages?beta=true')
    expect(calls[0].init.method).toBe('POST')
  })

  it('отдаёт ответ Anthropic как есть, вместе с кодом', async () => {
    const { impl } = upstream(new Response('{"type":"error"}', { status: 429 }))

    const response = await handle(post(`/${TOKEN}/v1/messages`), env, impl)

    expect(response.status).toBe(429)
    expect(await response.text()).toBe('{"type":"error"}')
  })

  it('без секрета в адресе никуда не ходит', async () => {
    const { impl } = upstream()

    const response = await handle(post('/v1/messages'), env, impl)

    expect(response.status).toBe(404)
    expect(impl).not.toHaveBeenCalled()
  })

  it('без заданного GATEWAY_TOKEN отказывается работать, а не открывается для всех', async () => {
    const { impl } = upstream()

    const response = await handle(post('/v1/messages'), { GATEWAY_TOKEN: '  ' }, impl)

    expect(response.status).toBe(500)
    expect(await response.text()).toContain('GATEWAY_TOKEN')
    expect(impl).not.toHaveBeenCalled()
  })

  it('ответ модели идёт потоком, а не копится целиком', async () => {
    // Чат печатается по мере ответа. Если шлюз дождётся конца, посетитель
    // будет смотреть на пустое окно всё время генерации.
    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('event: ping\n\n'))
        // Поток намеренно не закрывается: так видно, что ответ уже отдан.
      },
    })
    const { impl } = upstream(new Response(stream, { status: 200 }))

    const response = await handle(post(`/${TOKEN}/v1/messages`), env, impl)
    const body = /** @type {ReadableStream<Uint8Array>} */ (response.body)
    const chunk = await body.getReader().read()

    expect(new TextDecoder().decode(chunk.value)).toBe('event: ping\n\n')
  })

  it('самопроверка на 401 говорит, что шлюз годится', async () => {
    const { impl } = upstream(new Response('{"error":"invalid key"}', { status: 401 }))

    const response = await handle(new Request(`https://gate.workers.dev/${TOKEN}/whoami`), env, impl)

    expect(await response.text()).toContain('РАБОТАЕТ')
  })

  it('самопроверка на 403 честно говорит, что шлюз не поможет', async () => {
    const { impl } = upstream(new Response('{"error":"Request not allowed"}', { status: 403 }))

    const response = await handle(new Request(`https://gate.workers.dev/${TOKEN}/whoami`), env, impl)

    const text = await response.text()
    expect(text).toContain('НЕ РАБОТАЕТ')
    expect(text).toContain('Smart Placement')
  })

  it('обрыв связи с Anthropic не роняет шлюз', async () => {
    const impl = vi.fn(async () => {
      throw new Error('connection reset')
    })

    const response = await handle(post(`/${TOKEN}/v1/messages`), env, impl)

    expect(response.status).toBe(502)
    expect(await response.text()).toContain('connection reset')
  })
})
