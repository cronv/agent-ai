import { describe, expect, it } from 'vitest'

import type { ModelMessage } from './client.js'
import { HISTORY_CHAR_BUDGET, buildHistory, trimHistory, type StoredMessage } from './history.js'

/**
 * История для модели: перевод строк базы в цепочку сообщений и обрезка.
 * Главное, что проверяется, — обрезка не оставляет `tool_result` без его
 * `tool_use`: именно на этом Anthropic отвечает 400.
 */

function userSaid(text: string): StoredMessage {
  return { role: 'user', content: text }
}

function assistantSearched(id: string, result: string, answer: string): StoredMessage {
  return {
    role: 'assistant',
    content: answer,
    toolCalls: [{ id, name: 'search_apartments', input: { rooms: [2] }, result }],
  }
}

/** Все ли `tool_result` в цепочке имеют свой `tool_use` раньше по тексту. */
function pairsIntact(messages: ModelMessage[]): boolean {
  const seen = new Set<string>()
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === 'tool_use') seen.add(block.id)
      if (block.type === 'tool_result' && !seen.has(block.toolUseId)) return false
    }
  }
  return true
}

describe('buildHistory', () => {
  it('пользовательские сообщения превращаются в текстовые реплики', () => {
    expect(buildHistory([userSaid('Двушка до 18 млн')])).toEqual([
      { role: 'user', content: [{ type: 'text', text: 'Двушка до 18 млн' }] },
    ])
  })

  it('вызов инструмента разворачивается в пару «вызов → результат» и ответ', () => {
    const history = buildHistory([userSaid('Двушка'), assistantSearched('toolu_1', '{"total":3}', 'Нашёл три варианта')])

    expect(history.map((message) => message.role)).toEqual(['user', 'assistant', 'user', 'assistant'])
    expect(history[1]?.content).toEqual([
      { type: 'tool_use', id: 'toolu_1', name: 'search_apartments', input: { rooms: [2] } },
    ])
    expect(history[2]?.content).toEqual([{ type: 'tool_result', toolUseId: 'toolu_1', content: '{"total":3}' }])
    expect(history[3]?.content).toEqual([{ type: 'text', text: 'Нашёл три варианта' }])
  })

  it('пустой текст ответа не создаёт пустую реплику', () => {
    const history = buildHistory([assistantSearched('toolu_1', '{}', '   ')])

    expect(history.map((message) => message.role)).toEqual(['assistant', 'user'])
  })

  it('ошибка инструмента сохраняет признак ошибки', () => {
    const history = buildHistory([
      { role: 'assistant', content: '', toolCalls: [{ id: 't', name: 'save_lead', input: {}, result: '{}', isError: true }] },
    ])

    expect(history[1]?.content[0]).toEqual({ type: 'tool_result', toolUseId: 't', content: '{}', isError: true })
  })
})

describe('trimHistory', () => {
  it('короткую историю не трогает', () => {
    const history = buildHistory([userSaid('Привет'), { role: 'assistant', content: 'Здравствуйте' }])

    expect(trimHistory(history)).toEqual(history)
  })

  it('обрезает старое, оставляя свежее', () => {
    const stored: StoredMessage[] = []
    for (let index = 0; index < 20; index += 1) {
      stored.push(userSaid(`Вопрос ${index}: ${'а'.repeat(2000)}`))
    }
    stored.push(userSaid('Последний вопрос'))

    const trimmed = trimHistory(buildHistory(stored))
    const text = JSON.stringify(trimmed)

    expect(trimmed.length).toBeLessThan(21)
    expect(text).toContain('Последний вопрос')
    expect(text).not.toContain('Вопрос 0')
  })

  it('не разрывает пару «вызов инструмента → результат»', () => {
    const stored: StoredMessage[] = []
    for (let index = 0; index < 12; index += 1) {
      stored.push(userSaid(`Вопрос ${index}`))
      stored.push(assistantSearched(`toolu_${index}`, JSON.stringify({ payload: 'я'.repeat(3000) }), `Ответ ${index}`))
    }
    stored.push(userSaid('А подешевле?'))

    const trimmed = trimHistory(buildHistory(stored))

    expect(pairsIntact(trimmed)).toBe(true)
    // Первым идёт вопрос человека, а не осколок разрезанной пары.
    expect(trimmed[0]?.role).toBe('user')
    expect(trimmed[0]?.content[0]?.type).toBe('text')
    expect(JSON.stringify(trimmed).length).toBeLessThan(HISTORY_CHAR_BUDGET * 2)
  })

  it('когда безопасной границы нет, история отбрасывается целиком', () => {
    const history = buildHistory([assistantSearched('toolu_1', '{}', 'Ответ')])

    expect(trimHistory(history, 0)).toEqual([])
  })
})
