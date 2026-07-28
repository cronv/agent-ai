import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks'

import { PlanViewer } from './Apartments.tsx'
import { Composer } from './Composer.tsx'
import { ContactDone, ContactForm } from './ContactForm.tsx'
import { ChatIcon, CloseIcon, PhoneIcon } from './Icons.tsx'
import { Messages } from './Messages.tsx'
import { ChatApiError, DEFAULT_CONFIG, createApi } from './api.ts'
import { getSessionId, hasSavedLead, markLeadSaved, readPageContext } from './session.ts'
import { buildAccentTheme } from './theme.ts'
import type { ApartmentCard, SavedLead, WidgetConfig } from './types.ts'
import { useChat } from './useChat.ts'
import { useIsMobile, useScrollLock, useVisualViewport } from './useViewport.ts'

/**
 * Виджет целиком: кнопка в углу, окно чата, просмотр планировки.
 *
 * Здесь собирается всё, что зависит от окружения — настройки из админки,
 * размер экрана, клавиатура телефона, — а разговор с сервером живёт в
 * `useChat`. Компонент отвечает за то, как это выглядит, и ни за что больше.
 */

const CLOSE_ANIMATION_MS = 160

/** Что стоит в ленте на месте формы контакта. */
type ContactStage = 'hidden' | 'form' | 'done'

export function App({ apiBase }: { apiBase: string }) {
  const api = useMemo(() => createApi(apiBase), [apiBase])
  const sessionId = useMemo(getSessionId, [])
  const page = useMemo(readPageContext, [])

  const [config, setConfig] = useState<WidgetConfig>(DEFAULT_CONFIG)
  const chat = useChat({ api, sessionId, pacing: config.rhythm })
  const [open, setOpen] = useState(false)
  const [closing, setClosing] = useState(false)
  // Что открыто крупно: карточка и номер снимка в ней.
  const [plan, setPlan] = useState<{ card: ApartmentCard; index: number } | null>(null)
  const [contact, setContact] = useState<ContactStage>('hidden')
  const [lead, setLead] = useState<SavedLead | null>(null)
  // Квартира, которую человек выбрал и ради которой открылась форма: в ней
  // должно быть видно, за чем именно к нему перезвонят.
  const [chosen, setChosen] = useState<ApartmentCard | null>(null)

  const mobile = useIsMobile()
  const viewport = useVisualViewport(open && mobile)
  useScrollLock(open && mobile)

  const scroller = useRef<HTMLDivElement>(null)
  const pinned = useRef(true)

  // ── Настройки ──────────────────────────────────────────────

  useEffect(() => {
    let alive = true
    void api
      .loadConfig()
      .then((loaded) => {
        if (alive) setConfig(loaded)
      })
      .catch(() => {
        // Настройки не пришли — виджет работает на значениях по умолчанию.
        // Прятать кнопку из-за этого нельзя: чат может быть вполне жив.
      })
    return () => {
      alive = false
    }
  }, [api])

  const theme = useMemo(() => buildAccentTheme(config.accentColor), [config.accentColor])

  // ── Открытие и закрытие ────────────────────────────────────

  const show = useCallback((): void => {
    setClosing(false)
    setOpen(true)
    chat.loadHistory()
  }, [chat])

  const hide = useCallback((): void => {
    setClosing(true)
    window.setTimeout(() => {
      setClosing(false)
      setOpen(false)
    }, CLOSE_ANIMATION_MS)
  }, [])

  useEffect(() => {
    if (!open) return
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      if (plan) setPlan(null)
      else hide()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [open, plan, hide])

  useEffect(() => chat.stop, [chat.stop])

  // ── Прокрутка ленты ────────────────────────────────────────

  /**
   * Лента едет вниз сама, пока человек не отлистал вверх: перечитывать
   * прошлую подборку, когда её выдёргивает вниз каждой новой буквой, нельзя.
   */
  useEffect(() => {
    const node = scroller.current
    if (!node || !pinned.current) return
    node.scrollTop = node.scrollHeight
  }, [
    chat.items,
    chat.draft?.text,
    chat.draft?.apartments.length,
    chat.phase,
    chat.error,
    chat.suggestions,
    contact,
    open,
  ])

  const onScroll = (): void => {
    const node = scroller.current
    if (!node) return
    pinned.current = node.scrollHeight - node.scrollTop - node.clientHeight < 80
  }

  // ── Контакт ────────────────────────────────────────────────

  /**
   * Форму открывает либо ассистент — вызовом `save_lead` он просит контакт
   * словами, и диктовать телефон в поле сообщения человеку не приходится, —
   * либо сам посетитель кнопкой в любой момент разговора.
   *
   * Сама по себе форма открывается один раз за сессию: тому, кто телефон уже
   * дал, она больше в лицо не лезет, даже после перезагрузки страницы.
   */
  useEffect(() => {
    if (chat.contactAsked === 0 || hasSavedLead()) return
    pinned.current = true
    setContact('form')
  }, [chat.contactAsked])

  // Контакт записал сам ассистент со слов посетителя — спрашивать нечего.
  useEffect(() => {
    if (!chat.lead) return
    markLeadSaved()
    setLead(chat.lead)
    setContact('done')
  }, [chat.lead])

  const askContact = useCallback((): void => {
    pinned.current = true
    setChosen(null)
    setContact('form')
  }, [])

  const onLeadSaved = useCallback((saved: SavedLead): void => {
    markLeadSaved()
    setLead(saved)
    setContact('done')
  }, [])

  const send = (text: string): void => {
    pinned.current = true
    // Подтверждение своё дело сделало: дальше оно висело бы хвостом под каждым
    // новым ответом и выглядело как просьба оставить контакт ещё раз.
    if (contact === 'done') setContact('hidden')
    chat.send(text)
  }

  // ── Выбор квартиры ─────────────────────────────────────────

  /**
   * Нажали «Выбрать» на карточке.
   *
   * Выбор уходит на сервер всегда и первым делом — он ложится на диалог, и
   * подхватит его хоть форма контакта, заполненная через минуту, хоть уже
   * оставленный лид. Дальше расходятся два пути:
   *
   *   контакт уже есть — обновлённый лид ушёл менеджеру сам, посетителю
   *                      остаётся подтверждение в ленте;
   *   контакта нет     — открывается форма из тикета 09, и в ней видно, какую
   *                      именно квартиру человек выбрал.
   *
   * Повторный выбор той же квартиры не дублируется: сервер отвечает, что она
   * уже отмечена, и в ленту ничего не добавляется.
   */
  const choose = useCallback(
    (card: ApartmentCard): void => {
      pinned.current = true

      void api
        .selectApartment({
          sessionId,
          apartmentId: card.id,
          pageUrl: page.pageUrl,
          referrer: page.referrer,
          utm: page.utm,
        })
        .then((result) => {
          // Эту квартиру уже отмечали: ни реплики, ни формы. Второй раз жмут,
          // не поняв, сработало ли, — и форма, всплывшая на повторный клик
          // у человека с оставленным контактом, читается как «телефон не дошёл».
          if (!result.selected) return

          chat.addChoice(
            card.id,
            result.text,
            result.sentToManager ? 'Передал менеджеру — он перезвонит по этой квартире.' : null,
          )
          if (!result.sentToManager) {
            setChosen(card)
            setContact('form')
          }
        })
        .catch((cause: unknown) => {
          chat.addNote(
            cause instanceof ChatApiError
              ? cause.message
              : 'Не получилось отметить квартиру. Попробуйте ещё раз.',
            'bad',
          )
          // Форму не открываем: обещать звонок по квартире, которую сервер не
          // принял, нельзя.
        })
    },
    [api, chat, page, sessionId],
  )

  if (!config.enabled) return null

  const panelStyle =
    mobile && viewport ? { height: `${viewport.height}px`, top: `${viewport.offsetTop}px` } : undefined

  return (
    <div
      class="root"
      style={{
        '--accent': theme.accent,
        '--accent-rgb': theme.accentRgb,
        '--accent-ink': theme.accentInk,
        '--accent-deep': theme.accentDeep,
      }}
    >
      {(open || closing) && (
        <section
          class={closing ? 'panel panel--closing' : 'panel'}
          style={panelStyle}
          role="dialog"
          aria-label={config.title}
        >
          <header class="head">
            <span class="head__mark" aria-hidden="true">
              <ChatIcon size={18} />
            </span>
            <span class="head__text">
              <span class="head__title">{config.title}</span>
              <span class="head__status">ИИ-ассистент · на связи</span>
            </span>
            <button type="button" class="iconbtn" onClick={hide} aria-label="Свернуть чат">
              <CloseIcon size={18} />
            </button>
          </header>

          <div class="body" ref={scroller} onScroll={onScroll}>
            <Messages
              items={chat.items}
              draft={chat.draft}
              tool={chat.tool}
              phase={chat.phase}
              greeting={config.greeting}
              examples={config.exampleQuestions}
              error={chat.error}
              // У открытой формы контакта кнопок нет: от человека там ждут
              // имя и телефон, а не следующий вопрос про подборку.
              suggestions={config.quickReplies && contact !== 'form' ? chat.suggestions : []}
              selected={chat.selected}
              onExample={send}
              onRetry={chat.retry}
              onOpenPlan={(card, index) => setPlan({ card, index })}
              onSelect={choose}
              contactSlot={
                contact === 'form' ? (
                  <ContactForm
                    api={api}
                    sessionId={sessionId}
                    privacyPolicyUrl={config.privacyPolicyUrl}
                    apartment={chosen}
                    onSaved={onLeadSaved}
                    onClose={() => setContact('hidden')}
                  />
                ) : contact === 'done' ? (
                  <ContactDone lead={lead} onEdit={askContact} />
                ) : null
              }
            />
          </div>

          <footer class="foot">
            {contact === 'hidden' ? (
              <button type="button" class="foot__cta" onClick={askContact}>
                <PhoneIcon size={15} />
                Оставить контакт
              </button>
            ) : null}
            {/* Поле ввода на месте всегда: кнопки — ускорение, а не рельсы.
                Как только человек начал печатать своё, они гаснут. */}
            <Composer disabled={chat.busy} autoFocus={open} onSend={send} onType={chat.hideSuggestions} />
            <p class="foot__note">
              Отвечает ИИ-ассистент — детали уточняйте у менеджера.
              {config.privacyPolicyUrl ? (
                <>
                  {' '}
                  <a href={config.privacyPolicyUrl} target="_blank" rel="noopener noreferrer">
                    Политика обработки данных
                  </a>
                </>
              ) : null}
            </p>
          </footer>
        </section>
      )}

      {/* Планировка открывается поверх всей страницы, а не внутри панели:
          в окне шириной 420px «крупно» не получается. */}
      {plan ? <PlanViewer card={plan.card} index={plan.index} onClose={() => setPlan(null)} /> : null}

      <button
        type="button"
        class={open ? 'launcher launcher--open' : 'launcher'}
        onClick={open ? hide : show}
        aria-expanded={open}
        aria-label={open ? 'Свернуть чат' : 'Открыть чат подбора квартир'}
      >
        <span class="launcher__icon">{open ? <CloseIcon size={20} /> : <ChatIcon size={21} />}</span>
        {!open ? <span class="launcher__label">Подобрать квартиру</span> : null}
      </button>
    </div>
  )
}
