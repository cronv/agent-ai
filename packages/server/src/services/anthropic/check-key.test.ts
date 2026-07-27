import { describe, expect, it } from 'vitest'

import { checkAnthropicKey, type AnthropicProbe } from './check-key.js'

/**
 * Настоящий запрос к Anthropic в тестах не делается — подменяется тот самый
 * шов, ради которого проверка вынесена в отдельную функцию.
 */

function failing(status: number, message = 'нет'): AnthropicProbe {
  return async () => {
    throw Object.assign(new Error(message), { status })
  }
}

const ok: AnthropicProbe = async () => {}

describe('checkAnthropicKey', () => {
  it('на удачном запросе говорит, что ключ работает, и называет модель', async () => {
    const result = await checkAnthropicKey({ apiKey: 'sk-ant-xxx', model: 'claude-haiku-4-5' }, ok)

    expect(result.ok).toBe(true)
    expect(result.model).toBe('claude-haiku-4-5')
    expect(result.message).toContain('claude-haiku-4-5')
  })

  it('пустой ключ не гоняет запрос и объясняет, что делать', async () => {
    let called = false
    const probe: AnthropicProbe = async () => {
      called = true
    }

    const result = await checkAnthropicKey({ apiKey: '   ', model: 'claude-haiku-4-5' }, probe)

    expect(called).toBe(false)
    expect(result.ok).toBe(false)
    expect(result.message).toContain('Ключ не задан')
  })

  it('на 401 говорит, что ключ не подошёл, без кодов ошибок', async () => {
    const result = await checkAnthropicKey({ apiKey: 'bad', model: 'claude-haiku-4-5' }, failing(401))

    expect(result.ok).toBe(false)
    expect(result.message).toContain('Ключ не подошёл')
    expect(result.message).not.toContain('401')
  })

  it('на 404 объясняет, что дело в названии модели', async () => {
    const result = await checkAnthropicKey({ apiKey: 'sk-ant-xxx', model: 'claude-выдуманная' }, failing(404))

    expect(result.ok).toBe(false)
    expect(result.message).toContain('claude-выдуманная')
  })

  it('лимит частоты запросов не считается сломанным ключом', async () => {
    const result = await checkAnthropicKey({ apiKey: 'sk-ant-xxx', model: 'claude-haiku-4-5' }, failing(429))

    expect(result.ok).toBe(true)
    expect(result.message).toContain('временно')
  })

  it('на недоступность Anthropic предлагает повторить позже', async () => {
    const result = await checkAnthropicKey({ apiKey: 'sk-ant-xxx', model: 'claude-haiku-4-5' }, failing(529))

    expect(result.ok).toBe(false)
    expect(result.message).toContain('недоступен')
  })

  it('обрыв сети объясняет по-человечески', async () => {
    const probe: AnthropicProbe = async () => {
      throw new Error('fetch failed')
    }

    const result = await checkAnthropicKey({ apiKey: 'sk-ant-xxx', model: 'claude-haiku-4-5' }, probe)

    expect(result.ok).toBe(false)
    expect(result.message).toContain('fetch failed')
    expect(result.message).toContain('доступ в интернет')
  })
})
