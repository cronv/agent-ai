import { describe, expect, it } from 'vitest'

import { chatReducer } from './useChat.ts'
import type { FeedItem } from './types.ts'

/**
 * Состояние ленты — чистая функция, и проверяется она без браузера.
 *
 * Главное здесь — момент появления кнопок. Реплики приходят с сервера в начале
 * ответа, а показываются только после того, как он допечатан: иначе они
 * выскакивают посреди набора и ломают ритм из тикета 18.
 */

const START = {
  items: [] as FeedItem[],
  draft: null,
  tool: null,
  phase: 'idle' as const,
  sending: false,
  error: null,
  lead: null,
  contactAsked: 0,
  suggestions: [] as string[],
  selected: [] as string[],
  historyLoaded: false,
}

describe('кнопки быстрых ответов', () => {
  it('появляются только вместе с окончанием печати', () => {
    const asked = chatReducer(START, { type: 'ask', id: 'u1', text: 'Двушка в Химках' })
    const typing = chatReducer(asked, { type: 'text', text: 'Нашёл три варианта.' })

    // Пока печатает — кнопок нет, хотя реплики с сервера уже пришли.
    expect(typing.suggestions).toEqual([])

    const done = chatReducer(typing, { type: 'finish', suggestions: ['Подешевле', 'Другой район'] })
    expect(done.suggestions).toEqual(['Подешевле', 'Другой район'])
  })

  it('гаснут от нового вопроса, от набора текста и от выбора квартиры', () => {
    const shown = chatReducer(START, { type: 'finish', suggestions: ['Подешевле', 'Другой район'] })

    expect(chatReducer(shown, { type: 'ask', id: 'u2', text: 'Своё' }).suggestions).toEqual([])
    expect(chatReducer(shown, { type: 'hide-suggestions' }).suggestions).toEqual([])
    expect(chatReducer(shown, { type: 'choose', id: 'a1', text: 'Выбрал: …', note: null }).suggestions).toEqual([])
  })

  it('под оборванным ответом кнопок нет', () => {
    const shown = chatReducer(START, { type: 'finish', suggestions: ['Подешевле', 'Другой район'] })
    const failed = chatReducer(shown, {
      type: 'fail',
      error: { message: 'Связь прервалась', retriable: true },
    })

    expect(failed.suggestions).toEqual([])
  })
})

describe('выбор квартиры', () => {
  it('оставляет реплику в ленте и помечает карточку', () => {
    const state = chatReducer(START, {
      type: 'choose',
      id: 'a1',
      text: 'Выбрал: двухкомнатная, 54,3 м², ЖК «Космос», 16,4 млн ₽',
      note: 'Передал менеджеру — он перезвонит по этой квартире.',
    })

    expect(state.selected).toEqual(['a1'])
    expect(state.items.map((item) => item.kind)).toEqual(['user', 'note'])
    expect(state.items[0]?.kind === 'user' && state.items[0].text).toContain('Выбрал:')
  })

  it('без подтверждения показывает только реплику: дальше будет форма контакта', () => {
    const state = chatReducer(START, { type: 'choose', id: 'a1', text: 'Выбрал: студия', note: null })

    expect(state.items.map((item) => item.kind)).toEqual(['user'])
  })

  it('повторный выбор той же квартиры не дублирует отметку', () => {
    const once = chatReducer(START, { type: 'choose', id: 'a1', text: 'Выбрал: студия', note: null })
    const twice = chatReducer(once, { type: 'choose', id: 'a1', text: 'Выбрал: студия', note: null })

    expect(twice.selected).toEqual(['a1'])
  })

  it('ошибка выбора остаётся строкой в ленте, а не молчанием', () => {
    const state = chatReducer(START, { type: 'note', text: 'Не получилось отметить квартиру.', tone: 'bad' })

    expect(state.items).toHaveLength(1)
    expect(state.items[0]?.kind === 'note' && state.items[0].tone).toBe('bad')
    // Карточка не помечается выбранной: сервер выбор не принял.
    expect(state.selected).toEqual([])
  })

  it('история возвращает уже выбранное — карточка не предлагает выбрать второй раз', () => {
    const state = chatReducer(START, { type: 'history', items: [], selected: ['a7'] })
    expect(state.selected).toEqual(['a7'])
  })
})
