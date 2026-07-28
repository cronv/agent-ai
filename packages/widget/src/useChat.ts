import { useCallback, useEffect, useMemo, useReducer, useRef } from 'preact/hooks'

import { ChatApiError, type ChatApi } from './api.ts'
import { toolLabel } from './format.ts'
import { ChunkQueue, DEFAULT_PACING, playReply, type PacedChunk, type Pacing } from './pacing.ts'
import { readPageContext } from './session.ts'
import type { ApartmentCard, ChatError, FeedItem, SavedLead } from './types.ts'

/**
 * Состояние переписки и весь разговор с сервером.
 *
 *   const chat = useChat({ api, sessionId })
 *   chat.send('Двушка до 18 млн')
 *
 * Одно место, где живёт вся логика: лента, поток ответа, индикатор работы,
 * ошибки и повтор. Компоненты рисуют то, что здесь получилось, и ничего не
 * решают сами.
 *
 * ── Про поток ───────────────────────────────────────────────────────────────
 *
 * Ответ печатается в `draft`, а в ленту попадает целиком по событию `done`.
 * Так лента не перерисовывается целиком на каждую букву и, что важнее,
 * незаконченный ответ отличим от законченного: если соединение оборвалось,
 * `done` не придёт вовсе, и написанное сохранится с пометкой «оборвалось».
 *
 * ── Про ритм ────────────────────────────────────────────────────────────────
 *
 * Между чтением потока и лентой стоит очередь: читатель складывает в неё всё,
 * что прислал сервер, а `playReply` (см. `pacing.ts`) разбирает её в темпе
 * человеческого набора — с паузой на обдумывание перед первым символом и
 * разрывом длинного ответа на два-три сообщения. Поэтому `busy` перестаёт
 * значить «идёт ответ»: пока виджет допечатывает, поток с сервером уже закрыт
 * и посетителю можно писать дальше. Новое сообщение гасит печать (`abort`),
 * недопечатанное дописывается разом и остаётся в ленте.
 *
 * Выключенный ритм возвращает прежнее поведение: очередь разбирается без
 * задержек и без разрывов, то есть мгновенным стримингом.
 *
 * ── Про форму контакта ──────────────────────────────────────────────────────
 *
 * Здесь только повод её показать, а не она сама. Ассистент просит контакт,
 * вызывая `save_lead`, — счётчик `contactAsked` растёт на каждый такой вызов.
 * Показывать форму или нет, решает `App`: он же знает, оставил ли человек
 * контакт раньше. `lead` — контакт, который ассистент записал сам со слов
 * посетителя; тогда форма сразу показывает подтверждение, а не поля.
 *
 * ── Про кнопки быстрых ответов ──────────────────────────────────────────────
 *
 * Реплики приходят отдельным событием потока (`suggestions`) — их придумала
 * модель, виджет ответ по разделителям не разбирает. В ленту они попадают не
 * сразу: событие откладывается до конца печати и применяется вместе с `finish`.
 * Иначе кнопки выскакивали бы посреди набора — ровно то, против чего написан
 * тикет 18: сначала ассистент договаривает, потом появляется, что ответить.
 *
 * Гаснут кнопки по трём поводам: нажали, начали печатать своё, задали новый
 * вопрос. Все три означают одно — предложенное продолжение больше не к месту.
 */

export type ChatPhase = 'idle' | 'waiting' | 'streaming'

interface Draft {
  text: string
  apartments: ApartmentCard[]
}

interface ChatState {
  items: FeedItem[]
  draft: Draft | null
  /** Что ассистент делает прямо сейчас: «Подбираю квартиры». */
  tool: string | null
  phase: ChatPhase
  /** Поток с сервером ещё открыт: пока да — поле ввода заблокировано. */
  sending: boolean
  error: ChatError | null
  lead: SavedLead | null
  /** Сколько раз ассистент просил контакт: каждый вызов `save_lead` — повод показать форму. */
  contactAsked: number
  /** Реплики на кнопках под последним ответом. Пусто — кнопок нет. */
  suggestions: string[]
  /** Идентификаторы квартир, отмеченных кнопкой «Выбрать». */
  selected: string[]
  historyLoaded: boolean
}

type Action =
  | { type: 'history'; items: FeedItem[]; selected: string[] }
  | { type: 'ask'; id: string; text: string }
  | { type: 'restart' }
  | { type: 'text'; text: string }
  | { type: 'tool'; label: string; contact: boolean }
  | { type: 'apartments'; apartments: ApartmentCard[] }
  | { type: 'lead'; lead: SavedLead }
  | { type: 'server-error'; message: string }
  /** Конец сообщения посреди ответа: написанное уходит в ленту, печать продолжится в новом. */
  | { type: 'split' }
  | { type: 'stream-closed' }
  | { type: 'finish'; suggestions: string[] }
  | { type: 'fail'; error: ChatError }
  /** Посетитель начал печатать своё или нажал кнопку — предложенное больше не к месту. */
  | { type: 'hide-suggestions' }
  /** Квартира отмечена кнопкой «Выбрать»: реплика в ленту, карточка помечена. */
  | { type: 'choose'; id: string; text: string; note: string | null }
  | { type: 'note'; text: string; tone: 'ok' | 'bad' }

const INITIAL: ChatState = {
  items: [],
  draft: null,
  tool: null,
  phase: 'idle',
  sending: false,
  error: null,
  lead: null,
  contactAsked: 0,
  suggestions: [],
  selected: [],
  historyLoaded: false,
}

const EMPTY_DRAFT: Draft = { text: '', apartments: [] }

/** Ответ начался и не закончился: связь, а не ошибка запроса. */
const BROKEN_STREAM: ChatError = { message: 'Связь прервалась, ответ не дописан. Попробуем ещё раз?', retriable: true }

export function chatReducer(state: ChatState, action: Action): ChatState {
  switch (action.type) {
    // История доезжает асинхронно. Если посетитель успел написать раньше, чем
    // она пришла, его реплику затирать нельзя — лента остаётся как есть.
    case 'history':
      return state.items.length > 0 || state.draft !== null
        ? { ...state, historyLoaded: true, selected: action.selected }
        : { ...state, items: action.items, selected: action.selected, historyLoaded: true }

    // Новый вопрос посреди недопечатанного ответа — обычное дело: то, что
    // ассистент успел сказать, остаётся в ленте законченным сообщением.
    case 'ask':
      return {
        ...state,
        items: [...closeDraft(state), { kind: 'user', id: action.id, text: action.text }],
        draft: EMPTY_DRAFT,
        tool: null,
        phase: 'waiting',
        sending: true,
        error: null,
        suggestions: [],
      }

    // Повтор: реплика посетителя уже в ленте, заново её добавлять не нужно.
    case 'restart':
      return {
        ...state,
        items: closeDraft(state),
        draft: EMPTY_DRAFT,
        tool: null,
        phase: 'waiting',
        sending: true,
        error: null,
        suggestions: [],
      }

    case 'text':
      return {
        ...state,
        phase: 'streaming',
        tool: null,
        draft: { ...(state.draft ?? EMPTY_DRAFT), text: (state.draft?.text ?? '') + action.text },
      }

    case 'tool':
      return {
        ...state,
        tool: action.label,
        contactAsked: action.contact ? state.contactAsked + 1 : state.contactAsked,
      }

    case 'apartments':
      return {
        ...state,
        draft: {
          ...(state.draft ?? EMPTY_DRAFT),
          apartments: [...(state.draft?.apartments ?? []), ...action.apartments],
        },
      }

    case 'lead':
      return { ...state, lead: action.lead }

    // Ошибка внутри диалога: сервер всё равно пришлёт `done` следом.
    case 'server-error':
      return { ...state, error: { message: action.message, retriable: true }, tool: null }

    // Разрыв на смысловой границе: сообщение закрыто, дальше пауза
    // с индикатором «печатает» и следующее сообщение с чистого листа.
    case 'split':
      return { ...state, items: closeDraft(state), draft: EMPTY_DRAFT, tool: null, phase: 'waiting' }

    case 'stream-closed':
      return { ...state, sending: false }

    // Ответ допечатан — только теперь под ним появляются кнопки. Пришли они
    // с сервера ещё в начале ответа, но выскочить посреди набора не должны.
    case 'finish': {
      return {
        ...state,
        items: closeDraft(state),
        draft: null,
        tool: null,
        phase: 'idle',
        sending: false,
        suggestions: action.suggestions,
      }
    }

    // Оборвалось: то, что успело прийти, остаётся в ленте с пометкой.
    // Кнопок под оборванным ответом нет: они писались к другому тексту.
    case 'fail': {
      return {
        ...state,
        items: closeDraft(state, true),
        draft: null,
        tool: null,
        phase: 'idle',
        sending: false,
        error: action.error,
        suggestions: [],
      }
    }

    case 'hide-suggestions':
      return state.suggestions.length === 0 ? state : { ...state, suggestions: [] }

    case 'choose':
      return {
        ...state,
        items: [
          ...state.items,
          { kind: 'user', id: `s-${action.id}`, text: action.text },
          ...(action.note ? [{ kind: 'note' as const, id: `n-${action.id}`, text: action.note, tone: 'ok' as const }] : []),
        ],
        selected: state.selected.includes(action.id) ? state.selected : [...state.selected, action.id],
        // Кнопки писались к прошлому ответу; после выбора квартиры разговор
        // ушёл в другую сторону.
        suggestions: [],
      }

    case 'note':
      return {
        ...state,
        items: [...state.items, { kind: 'note', id: `n-${state.items.length}-${Date.now()}`, text: action.text, tone: action.tone }],
      }
  }
}

/** Черновик → законченное сообщение ленты. Пустой черновик просто исчезает. */
function closeDraft(state: ChatState, failed = false): FeedItem[] {
  const draft = state.draft
  if (!draft || (draft.text.trim() === '' && draft.apartments.length === 0)) return state.items
  return [
    ...state.items,
    {
      kind: 'assistant',
      id: `a-${state.items.length}-${Date.now()}`,
      text: draft.text.trimEnd(),
      apartments: draft.apartments,
      failed,
    },
  ]
}

export interface UseChatOptions {
  api: ChatApi
  sessionId: string
  /** Ритм ответа из настроек. Приезжает вместе с конфигом виджета, уже после первого рендера. */
  pacing?: Pacing
}

export interface Chat {
  items: FeedItem[]
  draft: Draft | null
  tool: string | null
  phase: ChatPhase
  error: ChatError | null
  /** Контакт, сохранённый ассистентом со слов посетителя. */
  lead: SavedLead | null
  /** Растёт каждый раз, когда ассистент просит контакт: повод показать форму. */
  contactAsked: number
  /** Реплики на кнопках под последним ответом. Пусто — кнопок нет. */
  suggestions: string[]
  /** Квартиры, отмеченные кнопкой «Выбрать»: на карточке стоит «Выбрана». */
  selected: string[]
  /**
   * Запрос ещё в пути — поле ввода заблокировано. Пока виджет только
   * допечатывает уже полученный ответ, писать можно: новое сообщение
   * прервёт печать.
   */
  busy: boolean
  send: (text: string) => void
  retry: () => void
  loadHistory: () => void
  /** Посетитель начал печатать своё — кнопки убираем. */
  hideSuggestions: () => void
  /** Квартира выбрана: реплика в ленту и, если нужно, подтверждение под ней. */
  addChoice: (id: string, text: string, note: string | null) => void
  /** Служебная строка в ленте: «не получилось отметить квартиру». */
  addNote: (text: string, tone: 'ok' | 'bad') => void
  /** Обрывает поток — вызывается, когда виджет уходит со страницы. */
  stop: () => void
}

export function useChat({ api, sessionId, pacing = DEFAULT_PACING }: UseChatOptions): Chat {
  const [state, dispatch] = useReducer(chatReducer, INITIAL)
  const abortRef = useRef<AbortController | null>(null)
  const lastAskRef = useRef<string | null>(null)
  const busyRef = useRef(false)
  const historyRef = useRef(false)
  const page = useMemo(readPageContext, [])

  // Настройки доезжают асинхронно, а `run` создаётся один раз: читаем ритм
  // из ссылки, чтобы ответ шёл по актуальным значениям, а не по тем, что были
  // на первом рендере.
  const pacingRef = useRef(pacing)
  useEffect(() => {
    pacingRef.current = pacing
  }, [pacing])

  const run = useCallback(
    async (text: string, repeat: boolean): Promise<void> => {
      // Поток с сервером уже идёт — второй запрос отправлять нельзя.
      // Недопечатанный ответ (поток закрыт, работает только печать) прерываем.
      if (busyRef.current) return
      abortRef.current?.abort()

      busyRef.current = true
      lastAskRef.current = text

      const controller = new AbortController()
      const { signal } = controller
      abortRef.current = controller
      dispatch(repeat ? { type: 'restart' } : { type: 'ask', id: `u-${Date.now()}`, text })

      const askedAt = Date.now()
      const queue = new ChunkQueue<PacedChunk>()
      /**
       * Итог чтения потока. Одним объектом, а не отдельными переменными:
       * читатель работает параллельно с печатью, и разбирать его результат
       * приходится уже после того, как обе задачи закончились.
       */
      const outcome = {
        /** Хоть одно событие пришло. */
        started: false,
        /** Дошли до `done`. */
        finished: false,
        /** Ассистент ходил в базу — обдумывать он будет дольше. */
        tools: false,
        failure: null as ChatError | null,
        /**
         * Реплики для кнопок. Копятся здесь, а не уходят в ленту сразу:
         * применяются вместе с `finish`, то есть после того, как ответ
         * допечатался.
         */
        suggestions: [] as string[],
      }

      // Читатель: складывает всё, что прислал сервер, в очередь как есть.
      // Признаки состояния (инструмент, контакт, ошибка) уходят в ленту сразу —
      // они не текст ответа, а рассказ о том, что происходит прямо сейчас.
      const read = async (): Promise<void> => {
        try {
          const stream = api.streamMessage({
            sessionId,
            message: text,
            pageUrl: page.pageUrl,
            referrer: page.referrer,
            utm: page.utm,
            signal,
          })

          for await (const event of stream) {
            outcome.started = true
            switch (event.type) {
              case 'text':
                queue.push({ kind: 'text', text: event.text })
                break
              case 'apartments':
                queue.push({ kind: 'apartments', apartments: event.apartments })
                break
              case 'tool':
                outcome.tools = true
                dispatch({ type: 'tool', label: toolLabel(event.name), contact: event.name === 'save_lead' })
                break
              case 'suggestions':
                outcome.suggestions = event.options
                break
              case 'lead':
                dispatch({ type: 'lead', lead: event.lead })
                break
              case 'error':
                dispatch({ type: 'server-error', message: event.message })
                break
              case 'done':
                outcome.finished = true
                break
              case 'ready':
                break
            }
            if (outcome.finished) break
          }
        } catch (error) {
          if (signal.aborted) return
          if (error instanceof ChatApiError) {
            outcome.failure = { message: error.message, retriable: error.retriable }
          } else {
            // Разрыв посреди потока прилетает сюда обычной сетевой ошибкой:
            // ответ уже начался, значит дело не в запросе, а в связи.
            outcome.failure = outcome.started
              ? BROKEN_STREAM
              : { message: 'Что-то пошло не так. Попробуйте ещё раз.', retriable: true }
          }
        } finally {
          queue.close()
          busyRef.current = false
          dispatch({ type: 'stream-closed' })
        }
      }

      // Отмена гасит и печать, и ожидание следующего куска.
      signal.addEventListener('abort', () => queue.close(), { once: true })

      try {
        await Promise.all([
          read(),
          playReply({
            queue,
            sink: {
              text: (chunk) => dispatch({ type: 'text', text: chunk }),
              apartments: (cards) => dispatch({ type: 'apartments', apartments: cards }),
              split: () => dispatch({ type: 'split' }),
            },
            pacing: pacingRef.current,
            signal,
            elapsedMs: () => Date.now() - askedAt,
            wasBusy: () => outcome.tools,
          }),
        ])

        if (signal.aborted) return
        if (outcome.failure) dispatch({ type: 'fail', error: outcome.failure })
        // Поток закончился, а `done` не пришло — соединение оборвалось.
        else if (outcome.finished) dispatch({ type: 'finish', suggestions: outcome.suggestions })
        else dispatch({ type: 'fail', error: BROKEN_STREAM })
      } finally {
        busyRef.current = false
        if (abortRef.current === controller) abortRef.current = null
      }
    },
    [api, page, sessionId],
  )

  const send = useCallback(
    (text: string): void => {
      const trimmed = text.trim()
      if (trimmed === '') return
      void run(trimmed, false)
    },
    [run],
  )

  const retry = useCallback((): void => {
    const last = lastAskRef.current
    if (last) void run(last, true)
  }, [run])

  const loadHistory = useCallback((): void => {
    if (historyRef.current) return
    historyRef.current = true
    void api
      .loadHistory(sessionId)
      .then((history) => {
        const items: FeedItem[] = history.messages.map((message, index) =>
          message.role === 'user'
            ? { kind: 'user', id: message.id ?? `h-${index}`, text: message.content }
            : {
                kind: 'assistant',
                id: message.id ?? `h-${index}`,
                text: message.content,
                apartments: Array.isArray(message.apartments) ? message.apartments : [],
                failed: false,
              },
        )
        if (items.length > 0 || history.selectedIds.length > 0) {
          dispatch({ type: 'history', items, selected: history.selectedIds })
        }
      })
      .catch(() => {
        // История — приятное дополнение. Не загрузилась — чат работает дальше.
      })
  }, [api, sessionId])

  const hideSuggestions = useCallback((): void => {
    dispatch({ type: 'hide-suggestions' })
  }, [])

  const addChoice = useCallback((id: string, text: string, note: string | null): void => {
    dispatch({ type: 'choose', id, text, note })
  }, [])

  const addNote = useCallback((text: string, tone: 'ok' | 'bad'): void => {
    dispatch({ type: 'note', text, tone })
  }, [])

  const stop = useCallback((): void => {
    abortRef.current?.abort()
  }, [])

  return {
    items: state.items,
    draft: state.draft,
    tool: state.tool,
    phase: state.phase,
    error: state.error,
    lead: state.lead,
    contactAsked: state.contactAsked,
    suggestions: state.suggestions,
    selected: state.selected,
    busy: state.sending,
    send,
    retry,
    loadHistory,
    hideSuggestions,
    addChoice,
    addNote,
    stop,
  }
}
