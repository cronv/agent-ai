import { describe, expect, it } from 'vitest'

import {
  ChunkQueue,
  MAX_MESSAGES,
  THINK_FLOOR_MS,
  isSplitPoint,
  normalizePacing,
  pauseAfterChar,
  playReply,
  thinkDelayMs,
  type PacedChunk,
  type Pacing,
} from './pacing.ts'
import type { ApartmentCard } from './types.ts'

const CARDS = [{ id: 'a1' }, { id: 'a2' }] as unknown as ApartmentCard[]

/** Быстрый ритм: проверяем порядок и разбивку, а не секундомер. */
const FAST: Pacing = { enabled: true, charsPerSecond: 2000, thinkMaxMs: 0 }

interface Recorded {
  /** Что оказалось в ленте: одно сообщение — один элемент. */
  messages: { text: string; cards: number }[]
  /** Сколько раз карточки приходили отдельным событием. */
  cardEvents: number
}

/** Сток, который собирает напечатанное так же, как это делает лента чата. */
function recorder(): { sink: Parameters<typeof playReply>[0]['sink']; result: Recorded } {
  const result: Recorded = { messages: [{ text: '', cards: 0 }], cardEvents: 0 }
  const last = (): { text: string; cards: number } => result.messages[result.messages.length - 1]!
  return {
    result,
    sink: {
      text: (chunk) => {
        last().text += chunk
      },
      apartments: (cards) => {
        result.cardEvents += 1
        last().cards += cards.length
      },
      split: () => {
        result.messages.push({ text: '', cards: 0 })
      },
    },
  }
}

function queueOf(chunks: PacedChunk[]): ChunkQueue<PacedChunk> {
  const queue = new ChunkQueue<PacedChunk>()
  for (const chunk of chunks) queue.push(chunk)
  queue.close()
  return queue
}

function play(queue: ChunkQueue<PacedChunk>, pacing: Pacing, signal?: AbortSignal) {
  const recorded = recorder()
  const promise = playReply({
    queue,
    sink: recorded.sink,
    pacing,
    signal: signal ?? new AbortController().signal,
    elapsedMs: () => 0,
    wasBusy: () => false,
    random: () => 0,
  })
  return { promise, result: recorded.result }
}

describe('normalizePacing', () => {
  it('берёт умолчания, когда сервер ничего не прислал', () => {
    expect(normalizePacing(undefined)).toEqual({ enabled: true, charsPerSecond: 32, thinkMaxMs: 3500 })
  })

  it('не пускает опечатку из админки в темп печати', () => {
    expect(normalizePacing({ charsPerSecond: 0, thinkMaxMs: 10 ** 9 })).toMatchObject({
      charsPerSecond: 5,
      thinkMaxMs: 15_000,
    })
    expect(normalizePacing({ charsPerSecond: 'быстро' })).toMatchObject({ charsPerSecond: 32 })
  })

  it('выключается только явным false', () => {
    expect(normalizePacing({ enabled: false }).enabled).toBe(false)
    expect(normalizePacing({}).enabled).toBe(true)
  })
})

describe('thinkDelayMs', () => {
  it('на простой вопрос думает меньше, чем на подбор с поиском', () => {
    const simple = thinkDelayMs(3500, false, () => 0.5)
    const complex = thinkDelayMs(3500, true, () => 0.5)

    expect(simple).toBeGreaterThanOrEqual(THINK_FLOOR_MS)
    expect(complex).toBeGreaterThan(simple)
    expect(complex).toBeLessThanOrEqual(3500)
  })

  it('разбрасывает паузу, а не выдаёт одно и то же число', () => {
    expect(thinkDelayMs(4000, false, () => 0)).not.toBe(thinkDelayMs(4000, false, () => 1))
  })

  it('за потолок не выходит даже при нулевом потолке', () => {
    expect(thinkDelayMs(0, true, () => 1)).toBe(0)
    expect(thinkDelayMs(1000, true, () => 1)).toBeLessThanOrEqual(1000)
  })
})

describe('isSplitPoint', () => {
  const long = 'Подобрал несколько вариантов в этом районе, все с чистовой отделкой и сдачей в следующем году. '

  it('режет по концу абзаца', () => {
    expect(isSplitPoint(`${long}${long}\n\n`)).toBe(true)
  })

  it('не режет короткий кусок даже на конце абзаца', () => {
    expect(isSplitPoint('Секунду.\n\n')).toBe(false)
    // Одна квартира отдельным абзацем — ещё не повод начинать новое сообщение.
    expect(isSplitPoint(`${long}\n\n`)).toBe(false)
  })

  it('не режет посреди фразы', () => {
    expect(isSplitPoint(`${long}И ещё`)).toBe(false)
  })

  it('на длинном куске режет по концу предложения, не дожидаясь абзаца', () => {
    expect(isSplitPoint(`${long}${long}`)).toBe(false)
    expect(isSplitPoint(`${long}${long}${long}`)).toBe(true)
  })

  it('перечень квартир не разрывает', () => {
    const list = `${long}${long}\n- Космос, 4,7 млн ₽. ${long}`
    expect(isSplitPoint(list)).toBe(false)
  })
})

describe('pauseAfterChar', () => {
  it('на точке рука стоит дольше, чем на букве', () => {
    expect(pauseAfterChar('а')).toBe(0)
    expect(pauseAfterChar(',')).toBeGreaterThan(0)
    expect(pauseAfterChar('.')).toBeGreaterThan(pauseAfterChar(','))
  })

  it('не съедает заявленную скорость печати', () => {
    // 500 символов при 32 знаках в секунду — это около 16 секунд. Знаки
    // препинания вправе добавить к этому четверть, но не удвоить.
    const text = 'Нашёл несколько вариантов, все с отделкой. '.repeat(12)
    const typing = (text.length * 1000) / 32
    const pauses = [...text].reduce((total, char) => total + pauseAfterChar(char), 0)

    expect(pauses).toBeLessThan(typing * 0.35)
  })
})

describe('playReply', () => {
  it('с выключенным ритмом отдаёт всё как пришло, одним сообщением', async () => {
    const queue = queueOf([
      { kind: 'text', text: 'Первый абзац.\n\n' },
      { kind: 'apartments', apartments: CARDS },
      { kind: 'text', text: 'Второй абзац.' },
    ])
    const { promise, result } = play(queue, { enabled: false, charsPerSecond: 32, thinkMaxMs: 3500 })
    await promise

    expect(result.messages).toHaveLength(1)
    expect(result.messages[0]).toEqual({ text: 'Первый абзац.\n\nВторой абзац.', cards: 2 })
  })

  it('длинный ответ разбивает на несколько сообщений по границам абзацев', async () => {
    const paragraph =
      'В этом районе сейчас есть подходящие варианты, все с чистовой отделкой и сдачей в 2026 году. ' +
      'Показываю пять самых доступных, остальные подберу точнее.'
    const queue = queueOf([
      { kind: 'text', text: `${paragraph}\n\n` },
      { kind: 'text', text: `${paragraph}\n\n` },
      { kind: 'text', text: 'Вам к какому сроку нужны ключи?' },
    ])
    const { promise, result } = play(queue, FAST)
    await promise

    expect(result.messages.length).toBeGreaterThan(1)
    expect(result.messages.length).toBeLessThanOrEqual(MAX_MESSAGES)
    expect(result.messages.map((message) => message.text).join('')).toBe(
      `${paragraph}\n\n${paragraph}\n\nВам к какому сроку нужны ключи?`,
    )
    // Последнее сообщение — уточняющий вопрос, а не пустышка.
    expect(result.messages[result.messages.length - 1]?.text.trim()).not.toBe('')
  })

  it('карточки квартир приходят одним блоком и не разрываются', async () => {
    const paragraph =
      'Нашёл три подходящих варианта в этом районе, все с чистовой отделкой и сдачей в 2026 году. ' +
      'Цены — от 4,7 млн до 5,2 млн ₽.'
    const queue = queueOf([
      { kind: 'apartments', apartments: CARDS },
      { kind: 'text', text: `${paragraph}\n\n` },
      { kind: 'text', text: 'Что важнее — срок сдачи или бюджет?' },
    ])
    const { promise, result } = play(queue, FAST)
    await promise

    expect(result.cardEvents).toBe(1)
    const withCards = result.messages.filter((message) => message.cards > 0)
    expect(withCards).toHaveLength(1)
    expect(withCards[0]?.cards).toBe(2)
  })

  it('отмена дописывает пришедшее и останавливает печать', async () => {
    const queue = new ChunkQueue<PacedChunk>()
    queue.push({ kind: 'text', text: 'Первая часть ответа, довольно длинная, чтобы печать не успела закончиться.' })
    queue.push({ kind: 'text', text: ' И вторая часть, которая ещё лежит в очереди.' })

    const controller = new AbortController()
    const { promise, result } = play(queue, { enabled: true, charsPerSecond: 20, thinkMaxMs: 0 }, controller.signal)

    await new Promise((resolve) => setTimeout(resolve, 120))
    controller.abort()
    await promise

    expect(result.messages.map((message) => message.text).join('')).toBe(
      'Первая часть ответа, довольно длинная, чтобы печать не успела закончиться.' +
        ' И вторая часть, которая ещё лежит в очереди.',
    )
  })

  it('не спит, если модель уже отняла всё время паузы', async () => {
    const queue = queueOf([{ kind: 'text', text: 'Готово.' }])
    const recorded = recorder()
    const started = Date.now()

    await playReply({
      queue,
      sink: recorded.sink,
      pacing: { enabled: true, charsPerSecond: 2000, thinkMaxMs: 4000 },
      signal: new AbortController().signal,
      elapsedMs: () => 9000,
      wasBusy: () => true,
      random: () => 1,
    })

    expect(Date.now() - started).toBeLessThan(300)
    expect(recorded.result.messages[0]?.text).toBe('Готово.')
  })

  it('ждёт остаток паузы, если модель ответила мгновенно', async () => {
    const queue = queueOf([{ kind: 'text', text: 'Готово.' }])
    const recorded = recorder()
    const started = Date.now()

    await playReply({
      queue,
      sink: recorded.sink,
      pacing: { enabled: true, charsPerSecond: 2000, thinkMaxMs: 400 },
      signal: new AbortController().signal,
      elapsedMs: () => 0,
      wasBusy: () => false,
      random: () => 0,
    })

    expect(Date.now() - started).toBeGreaterThanOrEqual(300)
  })
})
