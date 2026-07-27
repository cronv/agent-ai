import { useCallback, useMemo, useReducer, useRef } from 'preact/hooks'

import { ChatApiError, type ChatApi } from './api.ts'
import { toolLabel } from './format.ts'
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
 * ── Про форму контакта ──────────────────────────────────────────────────────
 *
 * Здесь только повод её показать, а не она сама. Ассистент просит контакт,
 * вызывая `save_lead`, — счётчик `contactAsked` растёт на каждый такой вызов.
 * Показывать форму или нет, решает `App`: он же знает, оставил ли человек
 * контакт раньше. `lead` — контакт, который ассистент записал сам со слов
 * посетителя; тогда форма сразу показывает подтверждение, а не поля.
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
  error: ChatError | null
  lead: SavedLead | null
  /** Сколько раз ассистент просил контакт: каждый вызов `save_lead` — повод показать форму. */
  contactAsked: number
  historyLoaded: boolean
}

type Action =
  | { type: 'history'; items: FeedItem[] }
  | { type: 'ask'; id: string; text: string }
  | { type: 'restart' }
  | { type: 'text'; text: string }
  | { type: 'tool'; label: string; contact: boolean }
  | { type: 'apartments'; apartments: ApartmentCard[] }
  | { type: 'lead'; lead: SavedLead }
  | { type: 'server-error'; message: string }
  | { type: 'finish' }
  | { type: 'fail'; error: ChatError }

const INITIAL: ChatState = {
  items: [],
  draft: null,
  tool: null,
  phase: 'idle',
  error: null,
  lead: null,
  contactAsked: 0,
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
        ? { ...state, historyLoaded: true }
        : { ...state, items: action.items, historyLoaded: true }

    case 'ask':
      return {
        ...state,
        items: [...state.items, { kind: 'user', id: action.id, text: action.text }],
        draft: EMPTY_DRAFT,
        tool: null,
        phase: 'waiting',
        error: null,
      }

    // Повтор: реплика посетителя уже в ленте, заново её добавлять не нужно.
    case 'restart':
      return { ...state, draft: EMPTY_DRAFT, tool: null, phase: 'waiting', error: null }

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

    case 'finish': {
      const draft = state.draft
      const empty = !draft || (draft.text.trim() === '' && draft.apartments.length === 0)
      return {
        ...state,
        items: empty
          ? state.items
          : [
              ...state.items,
              {
                kind: 'assistant',
                id: `a-${state.items.length}-${Date.now()}`,
                text: draft.text,
                apartments: draft.apartments,
                failed: false,
              },
            ],
        draft: null,
        tool: null,
        phase: 'idle',
      }
    }

    // Оборвалось: то, что успело прийти, остаётся в ленте с пометкой.
    case 'fail': {
      const draft = state.draft
      const partial = draft && (draft.text.trim() !== '' || draft.apartments.length > 0)
      return {
        ...state,
        items: partial
          ? [
              ...state.items,
              {
                kind: 'assistant',
                id: `a-${state.items.length}-${Date.now()}`,
                text: draft.text,
                apartments: draft.apartments,
                failed: true,
              },
            ]
          : state.items,
        draft: null,
        tool: null,
        phase: 'idle',
        error: action.error,
      }
    }
  }
}

export interface UseChatOptions {
  api: ChatApi
  sessionId: string
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
  busy: boolean
  send: (text: string) => void
  retry: () => void
  loadHistory: () => void
  /** Обрывает поток — вызывается, когда виджет уходит со страницы. */
  stop: () => void
}

export function useChat({ api, sessionId }: UseChatOptions): Chat {
  const [state, dispatch] = useReducer(chatReducer, INITIAL)
  const abortRef = useRef<AbortController | null>(null)
  const lastAskRef = useRef<string | null>(null)
  const busyRef = useRef(false)
  const historyRef = useRef(false)
  const page = useMemo(readPageContext, [])

  const run = useCallback(
    async (text: string, repeat: boolean): Promise<void> => {
      if (busyRef.current) return
      busyRef.current = true
      lastAskRef.current = text

      const controller = new AbortController()
      abortRef.current = controller
      dispatch(repeat ? { type: 'restart' } : { type: 'ask', id: `u-${Date.now()}`, text })

      let finished = false
      let started = false
      try {
        const stream = api.streamMessage({
          sessionId,
          message: text,
          pageUrl: page.pageUrl,
          referrer: page.referrer,
          utm: page.utm,
          signal: controller.signal,
        })

        for await (const event of stream) {
          started = true
          switch (event.type) {
            case 'text':
              dispatch({ type: 'text', text: event.text })
              break
            case 'tool':
              dispatch({ type: 'tool', label: toolLabel(event.name), contact: event.name === 'save_lead' })
              break
            case 'apartments':
              dispatch({ type: 'apartments', apartments: event.apartments })
              break
            case 'lead':
              dispatch({ type: 'lead', lead: event.lead })
              break
            case 'error':
              dispatch({ type: 'server-error', message: event.message })
              break
            case 'done':
              finished = true
              dispatch({ type: 'finish' })
              break
            case 'ready':
              break
          }
          if (finished) break
        }

        // Поток закончился, а `done` не пришло — соединение оборвалось.
        if (!finished) dispatch({ type: 'fail', error: BROKEN_STREAM })
      } catch (error) {
        if (controller.signal.aborted) return
        if (error instanceof ChatApiError) {
          dispatch({ type: 'fail', error: { message: error.message, retriable: error.retriable } })
        } else {
          // Разрыв посреди потока прилетает сюда обычной сетевой ошибкой:
          // ответ уже начался, значит дело не в запросе, а в связи.
          dispatch({
            type: 'fail',
            error: started ? BROKEN_STREAM : { message: 'Что-то пошло не так. Попробуйте ещё раз.', retriable: true },
          })
        }
      } finally {
        busyRef.current = false
        abortRef.current = null
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
      .then((messages) => {
        const items: FeedItem[] = messages.map((message, index) =>
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
        if (items.length > 0) dispatch({ type: 'history', items })
      })
      .catch(() => {
        // История — приятное дополнение. Не загрузилась — чат работает дальше.
      })
  }, [api, sessionId])

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
    busy: state.phase !== 'idle',
    send,
    retry,
    loadHistory,
    stop,
  }
}
