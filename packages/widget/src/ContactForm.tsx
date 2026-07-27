import { useEffect, useMemo, useRef, useState } from 'preact/hooks'

import { ChatApiError, type ChatApi, type LeadField } from './api.ts'
import { CheckIcon, CloseIcon } from './Icons.tsx'
import { PHONE_PLACEHOLDER, isPhoneComplete, maskPhone, toE164 } from './phone.ts'
import { readPageContext } from './session.ts'
import type { SavedLead } from './types.ts'

/**
 * Форма контакта — блок в ленте чата, а не окно поверх неё.
 *
 * Появляется там же, где идёт разговор, и уезжает вместе с ним: человек не
 * теряет из виду подборку, ради которой оставляет телефон, и не гадает, куда
 * делся чат. Отправил — на месте формы остаётся подтверждение, и переписка
 * продолжается дальше.
 *
 * ── Что здесь важно ────────────────────────────────────────────────────────
 *
 * Согласие. Кнопка не работает без галочки — это 152-ФЗ. Сервер проверяет то
 * же самое ещё раз: галочка в форме — удобство, а не защита.
 *
 * Ошибка. Введённое не стирается никогда. Отказ по полю встаёт под этим полем
 * тем текстом, который прислал сервер, — он написан для посетителя. Всё
 * остальное (сеть, 500) показывается общей строкой, а кнопка становится
 * «Отправить ещё раз»: повтор — это та же кнопка, а не новая форма.
 */

/** Минимальная длина имени — та же, что проверяет сервер. */
const MIN_NAME_LENGTH = 2
const MAX_NAME_LENGTH = 100

interface ContactFormProps {
  api: ChatApi
  sessionId: string
  privacyPolicyUrl: string | null
  onSaved: (lead: SavedLead) => void
  onClose: () => void
}

interface FormError {
  message: string
  /** `null` — общая ошибка: сеть или сервер, не поле. */
  field: LeadField | null
}

export function ContactForm({ api, sessionId, privacyPolicyUrl, onSaved, onClose }: ContactFormProps) {
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [consent, setConsent] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<FormError | null>(null)

  const page = useMemo(readPageContext, [])
  const nameField = useRef<HTMLInputElement>(null)
  const box = useRef<HTMLFormElement>(null)

  // На телефоне фокус сразу поднимает клавиатуру и прячет половину чата —
  // человек должен сначала увидеть, что у него спрашивают.
  useEffect(() => {
    if (!window.matchMedia('(pointer: coarse)').matches) nameField.current?.focus()
  }, [])

  /**
   * Ошибка добавляет форме высоты, и кнопка уезжает под край ленты. Лента
   * доводится до низа сама — руками, а не `scrollIntoView`: тот тянет за собой
   * и прокрутку чужой страницы, на которой стоит виджет.
   */
  useEffect(() => {
    if (!error) return
    const scroller = box.current?.closest('.body')
    if (scroller) scroller.scrollTop = scroller.scrollHeight
  }, [error])

  const ready = name.trim().length >= MIN_NAME_LENGTH && isPhoneComplete(phone) && consent

  const submit = (event: Event): void => {
    event.preventDefault()
    if (!ready || sending) return

    setSending(true)
    setError(null)
    api
      .saveLead({
        sessionId,
        name: name.trim(),
        phone: toE164(phone),
        consent: true,
        page: page.pageUrl,
        referrer: page.referrer,
        utm: page.utm,
      })
      .then((lead) => {
        onSaved(lead)
      })
      .catch((cause: unknown) => {
        setSending(false)
        setError(
          cause instanceof ChatApiError
            ? { message: cause.message, field: cause.field === 'session' ? null : cause.field }
            : { message: 'Не получилось отправить контакт. Проверьте связь и попробуйте ещё раз.', field: null },
        )
      })
  }

  const fieldError = (field: LeadField): string | null =>
    error && error.field === field ? error.message : null

  const nameError = fieldError('name')
  const phoneError = fieldError('phone')
  const consentError = fieldError('consent')

  return (
    <form ref={box} class="lead" onSubmit={submit} noValidate>
      <div class="lead__head">
        <span class="lead__title">Оставьте контакт</span>
        <button type="button" class="lead__hide" onClick={onClose} aria-label="Скрыть форму">
          <CloseIcon size={15} />
        </button>
      </div>
      <p class="lead__hint">Менеджер перезвонит, ответит по документам и забронирует подходящий вариант.</p>

      <label class="lead__field">
        <span class="lead__label">Как к вам обращаться</span>
        <input
          ref={nameField}
          class={nameError ? 'lead__input lead__input--bad' : 'lead__input'}
          type="text"
          name="name"
          autocomplete="name"
          maxLength={MAX_NAME_LENGTH}
          placeholder="Иван"
          value={name}
          aria-invalid={nameError ? 'true' : undefined}
          onInput={(event) => {
            setName((event.currentTarget as HTMLInputElement).value)
            if (nameError) setError(null)
          }}
        />
        {nameError ? <span class="lead__error">{nameError}</span> : null}
      </label>

      <label class="lead__field">
        <span class="lead__label">Телефон</span>
        <input
          class={phoneError ? 'lead__input lead__input--bad' : 'lead__input'}
          /* type=tel и inputmode=tel — на телефоне открывается цифровая клавиатура. */
          type="tel"
          name="phone"
          inputMode="tel"
          autocomplete="tel"
          placeholder={PHONE_PLACEHOLDER}
          value={phone}
          aria-invalid={phoneError ? 'true' : undefined}
          onInput={(event) => {
            // Значение пересобирается из цифр целиком: номер, вставленный из
            // письма в любом виде, ложится в маску сразу.
            const input = event.currentTarget as HTMLInputElement
            const next = maskPhone(input.value)
            // Поле правится напрямую, а не только через состояние: если
            // вставили тот же номер в другой записи, состояние не изменится,
            // перерисовки не будет — и в поле останется вставленное как есть.
            if (input.value !== next) input.value = next
            setPhone(next)
            if (phoneError) setError(null)
          }}
        />
        {phoneError ? <span class="lead__error">{phoneError}</span> : null}
      </label>

      <label class="lead__consent">
        <input
          type="checkbox"
          class="lead__check"
          checked={consent}
          onChange={(event) => {
            setConsent((event.currentTarget as HTMLInputElement).checked)
            if (consentError) setError(null)
          }}
        />
        <span>
          Согласен на обработку персональных данных
          {privacyPolicyUrl ? (
            <>
              {' — '}
              <a href={privacyPolicyUrl} target="_blank" rel="noopener noreferrer">
                политика
              </a>
            </>
          ) : null}
        </span>
      </label>
      {consentError ? <span class="lead__error lead__error--wide">{consentError}</span> : null}

      {error && error.field === null ? (
        <div class="lead__fail" role="alert">
          {error.message}
        </div>
      ) : null}

      <button type="submit" class="lead__submit" disabled={!ready || sending}>
        {sending ? 'Отправляем…' : error && error.field === null ? 'Отправить ещё раз' : 'Отправить'}
      </button>
    </form>
  )
}

/** То, что остаётся на месте формы после отправки. */
export function ContactDone({ lead, onEdit }: { lead: SavedLead | null; onEdit: () => void }) {
  return (
    <div class="lead-done" role="status">
      <span class="lead-done__mark" aria-hidden="true">
        <CheckIcon size={17} />
      </span>
      <div class="lead-done__text">
        <b>Контакт принят{lead && lead.name ? `, ${lead.name}` : ''}</b>
        <span>
          {lead ? `Перезвоним на ${lead.phoneFormatted ?? lead.phone}. ` : ''}
          Спрашивайте дальше — я на связи.
        </span>
        <button type="button" class="lead-done__edit" onClick={onEdit}>
          Изменить контакт
        </button>
      </div>
    </div>
  )
}
