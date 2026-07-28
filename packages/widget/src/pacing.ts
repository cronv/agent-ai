import type { ApartmentCard } from './types.ts'

/**
 * Человеческий ритм ответа: пауза на обдумывание, темп печати, разбивка
 * длинного ответа на несколько сообщений.
 *
 *   await playReply({ queue, sink, pacing, signal, elapsedMs, wasBusy })
 *
 * ── Почему ритм живёт в виджете, а не на сервере ────────────────────────────
 *
 * Задержку можно выдерживать и на сервере — тогда она одинакова для любого
 * клиента и её не обойти. Выбран виджет, и вот почему:
 *
 *   1. Прерывание. Пауза на сервере держит открытым SSE-поток и вместе с ним
 *      блокировку сессии (`streaming` в chat.routes). Посетитель, который
 *      отправил новое сообщение, получил бы `already_streaming` и ждал бы
 *      конца искусственной паузы. В браузере отмена мгновенна и локальна:
 *      `AbortController` гасит и сон, и допечатывание в тот же тик.
 *   2. Соединение. Ответ на подборку печатается 10–20 секунд. Держать ради
 *      этого сокет открытым — платить за красоту чужим прокси, который к тому
 *      же вправе буферизовать поток и выдать всю «человеческую» печать залпом.
 *   3. Разбивка на сообщения — это про то, как лента выглядит, а лента живёт
 *      здесь. В базе ответ остаётся одним сообщением: админка и восстановление
 *      истории не меняются.
 *
 * Плата за выбор — ритм настраивается, но не навязывается: настройки уходят
 * в `GET /api/widget/config`, и свой клиент теоретически может их не слушать.
 * Клиент здесь один, и это наш виджет, так что цена невелика.
 *
 * ── Что считается за паузу на обдумывание ───────────────────────────────────
 *
 * Время, которое реально ушло на модель и поиск по базе, засчитывается в паузу,
 * а не прибавляется к ней: `playReply` спит ровно столько, сколько осталось от
 * задуманной паузы после первого куска ответа. Модель думала три секунды —
 * добавлять сверху нечего.
 */

/** Кусок ответа в том порядке, в каком его прислал сервер. */
export type PacedChunk = { kind: 'text'; text: string } | { kind: 'apartments'; apartments: ApartmentCard[] }

export interface Pacing {
  /** Выключено — текст идёт мгновенно, по мере генерации. */
  enabled: boolean
  /** Темп печати, символов в секунду. */
  charsPerSecond: number
  /** Потолок паузы до первого символа, мс. */
  thinkMaxMs: number
}

export const DEFAULT_PACING: Pacing = { enabled: true, charsPerSecond: 32, thinkMaxMs: 3500 }

/** Границы, за которые настройку из админки не пускаем: опечатка не должна вешать чат. */
const CHARS_PER_SECOND_MIN = 5
const CHARS_PER_SECOND_MAX = 300
const THINK_MAX_MS = 15_000

/** Ниже этого паузу не опускаем, пока ритм включён: иначе он не читается. */
export const THINK_FLOOR_MS = 1500

/**
 * Короче этого сообщение не отрезаем. Порог высокий намеренно: модель пишет
 * каждую квартиру отдельным абзацем, и по меньшему порогу подборка рассыпалась
 * бы на сообщение из одной строки на квартиру.
 */
export const MIN_SEGMENT_CHARS = 120

/** Длиннее этого режем и по концу предложения, не дожидаясь конца абзаца. */
export const LONG_SEGMENT_CHARS = 260

/** Больше трёх сообщений подряд — это уже не «как в мессенджере», а спам. */
export const MAX_MESSAGES = 3

/** Пауза между сообщениями: столько человек собирается с мыслью. */
const GAP_MIN_MS = 700
const GAP_SPAN_MS = 700

/** Как часто набранное уходит в ленту. Реже — экономнее, чаще — плавнее. */
const TICK_MS = 55

/** Приводит то, что пришло с сервера, к рабочим числам. Мусор заменяется умолчанием. */
export function normalizePacing(
  raw: { enabled?: unknown; charsPerSecond?: unknown; thinkMaxMs?: unknown } | null | undefined,
): Pacing {
  const source = raw ?? {}
  return {
    enabled: source.enabled !== false,
    charsPerSecond: clamp(
      toNumber(source.charsPerSecond, DEFAULT_PACING.charsPerSecond),
      CHARS_PER_SECOND_MIN,
      CHARS_PER_SECOND_MAX,
    ),
    thinkMaxMs: clamp(toNumber(source.thinkMaxMs, DEFAULT_PACING.thinkMaxMs), 0, THINK_MAX_MS),
  }
}

/**
 * Пауза до первого символа ответа.
 *
 * Простой вопрос обдумывают быстрее, чем подбор с поиском по базе, поэтому
 * `complex` двигает паузу к верхней границе. Случайный разброс обязателен:
 * пауза, одинаковая до миллисекунды, выдаёт машину не хуже мгновенного ответа.
 */
export function thinkDelayMs(maxMs: number, complex: boolean, random: () => number = Math.random): number {
  const max = Math.max(maxMs, 0)
  const floor = Math.min(THINK_FLOOR_MS, max)
  const span = max - floor
  const base = complex ? floor + span * 0.6 : floor
  const jitter = random() * span * (complex ? 0.4 : 0.35)
  return Math.round(Math.min(base + jitter, max))
}

/** Пауза между сообщениями — с тем же разбросом, что и обдумывание. */
export function messageGapMs(random: () => number = Math.random): number {
  return Math.round(GAP_MIN_MS + random() * GAP_SPAN_MS)
}

/**
 * Добавка к паузе после символа. На точке рука останавливается заметно дольше,
 * чем на середине слова, — без этого печать выходит механически ровной.
 *
 * Значения абсолютные, а не доли от темпа набора, и намеренно небольшие:
 * настройка «символов в секунду» должна означать примерно то, что написано.
 * Через множитель от `charDelayMs` те же паузы на длинном ответе съедали
 * половину времени, и 32 символа в секунду превращались в пятнадцать.
 */
export function pauseAfterChar(char: string): number {
  if (char === '\n') return 140
  if (char === '.' || char === '!' || char === '?' || char === '…') return 220
  if (char === ',' || char === ';' || char === ':' || char === '—') return 50
  return 0
}

/**
 * Можно ли закончить здесь сообщение.
 *
 * Режем только по смысловым границам: конец абзаца, а для совсем длинного
 * куска — конец предложения. Внутри перечня квартир не режем никогда: список,
 * разорванный посередине, читается как обрыв связи.
 */
export function isSplitPoint(segment: string): boolean {
  const length = segment.trim().length
  if (/\n[ \t]*\n[ \t]*$/u.test(segment)) return length >= MIN_SEGMENT_CHARS
  if (length < LONG_SEGMENT_CHARS) return false
  if (/(?:^|\n)[ \t]*(?:[-*•]|\d+[.)])[ \t]/u.test(segment)) return false
  return /[.!?…]["»)]?[ \t]$/u.test(segment)
}

/** Сон, который просыпается по отмене, а не досыпает своё в фоне. */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0 || signal?.aborted) return Promise.resolve()
  return new Promise<void>((resolve) => {
    const done = (): void => {
      clearTimeout(timer)
      signal?.removeEventListener('abort', done)
      resolve()
    }
    const timer = setTimeout(done, ms)
    signal?.addEventListener('abort', done, { once: true })
  })
}

/**
 * Очередь кусков ответа между чтением потока и печатью.
 *
 * Читатель складывает сюда всё, что прислал сервер, и закрывает очередь по
 * `done`. Печатающий разбирает её в своём темпе и отстаёт — в этом весь смысл.
 */
export class ChunkQueue<T> {
  private items: T[] = []
  private closed = false
  private waiter: (() => void) | null = null

  push(item: T): void {
    this.items.push(item)
    this.wake()
  }

  close(): void {
    this.closed = true
    this.wake()
  }

  /** Ожидается ли что-то ещё: по этому решается, отрезать сообщение или дописывать. */
  get more(): boolean {
    return this.items.length > 0 || !this.closed
  }

  /** Всё, что осталось неразобранным. Очередь после этого пуста. */
  drain(): T[] {
    const rest = this.items
    this.items = []
    return rest
  }

  /** Следующий кусок или null, когда поток закрыт и разбирать больше нечего. */
  async next(): Promise<T | null> {
    for (;;) {
      const item = this.items.shift()
      if (item !== undefined) return item
      if (this.closed) return null
      await new Promise<void>((resolve) => {
        this.waiter = resolve
      })
    }
  }

  private wake(): void {
    const waiter = this.waiter
    this.waiter = null
    waiter?.()
  }
}

/** Куда уходит напечатанное. В виджете это `dispatch` из `useChat`. */
export interface PacedSink {
  /** Дописать текст в сообщение, которое печатается сейчас. */
  text(chunk: string): void
  /** Карточки квартир — целиком, одним блоком. */
  apartments(cards: ApartmentCard[]): void
  /** Закончить сообщение и начать следующее. */
  split(): void
}

export interface PlayReplyOptions {
  queue: ChunkQueue<PacedChunk>
  sink: PacedSink
  pacing: Pacing
  signal: AbortSignal
  /** Сколько прошло с момента отправки сообщения посетителем. */
  elapsedMs: () => number
  /** Ассистент ходил в базу — значит обдумывать он будет дольше. */
  wasBusy: () => boolean
  random?: () => number
}

/**
 * Разбирает очередь и выдаёт ответ в человеческом ритме.
 *
 * Отмена (`signal`) обрабатывается синхронно: то, что уже пришло с сервера, но
 * ещё не напечатано, немедленно дописывается одним куском — посетитель прервал
 * ответ, но терять его не за что, — после чего печать останавливается.
 */
export async function playReply(options: PlayReplyOptions): Promise<void> {
  const { queue, sink, pacing, signal, elapsedMs, wasBusy } = options
  const random = options.random ?? Math.random

  let chunk = await queue.next()
  if (signal.aborted) return

  if (!pacing.enabled) {
    while (chunk !== null) {
      emit(sink, chunk)
      chunk = await queue.next()
    }
    return
  }

  // Пауза на обдумывание: из задуманной вычитается то, что уже честно прошло.
  const think = thinkDelayMs(pacing.thinkMaxMs, wasBusy(), random)
  await sleep(think - elapsedMs(), signal)
  if (signal.aborted) return

  const charDelay = 1000 / pacing.charsPerSecond
  /** Набранное, но ещё не отданное в ленту. */
  let batch = ''
  /** Текст текущего сообщения — по нему ищется место для разрыва. */
  let segment = ''
  /** Символы текущего куска, до которых печать ещё не дошла. */
  let pending: string[] = []
  let messages = 1
  let owed = 0
  let stopped = false

  const flush = (): void => {
    if (batch === '') return
    sink.text(batch)
    batch = ''
  }

  // Отмена: дописываем всё, что успело прийти, и уходим. Слушатель
  // синхронный — набранное попадёт в ленту раньше, чем виджет начнёт
  // следующий вопрос.
  const onAbort = (): void => {
    stopped = true
    batch += pending.join('')
    pending = []
    flush()
    for (const rest of queue.drain()) emit(sink, rest)
  }
  signal.addEventListener('abort', onAbort, { once: true })

  try {
    while (chunk !== null && !stopped) {
      if (chunk.kind === 'apartments') {
        flush()
        sink.apartments(chunk.apartments)
      } else {
        pending = Array.from(chunk.text)
        while (pending.length > 0) {
          const char = pending.shift()
          if (char === undefined) break
          batch += char
          segment += char
          owed += charDelay + pauseAfterChar(char)

          if (messages < MAX_MESSAGES && queue.more && isSplitPoint(segment)) {
            flush()
            sink.split()
            segment = ''
            owed = 0
            messages += 1
            await sleep(messageGapMs(random), signal)
          } else if (owed >= TICK_MS) {
            flush()
            await sleep(owed, signal)
            owed = 0
          }
          if (stopped) return
        }
      }
      chunk = await queue.next()
      if (stopped) return
    }
    flush()
  } finally {
    signal.removeEventListener('abort', onAbort)
  }
}

function emit(sink: PacedSink, chunk: PacedChunk): void {
  if (chunk.kind === 'text') sink.text(chunk.text)
  else sink.apartments(chunk.apartments)
}

function toNumber(value: unknown, fallback: number): number {
  const parsed = typeof value === 'number' ? value : Number.parseFloat(String(value ?? ''))
  return Number.isFinite(parsed) ? parsed : fallback
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max)
}
