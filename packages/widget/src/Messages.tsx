import type { ComponentChildren } from 'preact'

import { ApartmentRail } from './Apartments.tsx'
import { RetryIcon } from './Icons.tsx'
import { RichText } from './RichText.tsx'
import type { ApartmentCard, ChatError, FeedItem } from './types.ts'
import type { ChatPhase } from './useChat.ts'

/**
 * Лента переписки.
 *
 * Реплика посетителя — заливка акцентом справа, ответ ассистента — текст без
 * подложки слева: так ответ читается как страница, а не как пузырь мессенджера,
 * и в него без швов встают карточки квартир.
 *
 * Форма контакта — такой же блок ленты, как сообщение: она встаёт последней,
 * ниже всех ответов и выше поля ввода, и прокручивается вместе с перепиской.
 * Готовый узел приходит сюда через `contactSlot`; показывать его или нет,
 * решает `App`.
 *
 * Кнопки быстрых ответов — последний блок ленты, ниже ответа и выше поля
 * ввода. Реплики на них придумала модель, виджет их не сочиняет и текст ответа
 * не разбирает.
 */

interface MessagesProps {
  items: FeedItem[]
  draft: { text: string; apartments: ApartmentCard[] } | null
  tool: string | null
  phase: ChatPhase
  greeting: string
  examples: string[]
  error: ChatError | null
  /** Реплики на кнопках под последним ответом. */
  suggestions: string[]
  /** Идентификаторы выбранных квартир — на их карточках стоит «Выбрана». */
  selected: string[]
  onExample: (text: string) => void
  onRetry: () => void
  onOpenPlan: (card: ApartmentCard, index: number) => void
  /** Нажали «Выбрать» на карточке. Не задан — кнопки выбора нет. */
  onSelect?: (card: ApartmentCard) => void
  /** Форма контакта или подтверждение отправки. */
  contactSlot?: ComponentChildren
}

export function Messages({
  items,
  draft,
  tool,
  phase,
  greeting,
  examples,
  error,
  suggestions,
  selected,
  onExample,
  onRetry,
  onOpenPlan,
  onSelect,
  contactSlot = null,
}: MessagesProps) {
  const empty = items.length === 0
  const streaming = draft !== null && (draft.text !== '' || draft.apartments.length > 0)
  // Индикатор висит, пока не пошёл текст, и возвращается, если ассистент
  // посреди ответа снова полез в базу.
  const thinking = phase !== 'idle' && ((draft?.text ?? '') === '' || tool !== null)

  return (
    <div class="feed">
      <div class="msg msg--bot">
        <RichText text={greeting} />
      </div>

      {empty && examples.length > 0 ? (
        <div class="examples">
          <div class="examples__hint">Например:</div>
          {examples.map((example) => (
            <button type="button" class="chip" key={example} onClick={() => onExample(example)}>
              {example}
            </button>
          ))}
        </div>
      ) : null}

      {items.map((item) =>
        item.kind === 'user' ? (
          <div class="msg msg--user" key={item.id}>
            {item.text}
          </div>
        ) : item.kind === 'note' ? (
          <div class={item.tone === 'bad' ? 'note note--bad' : 'note'} key={item.id} role="status">
            {item.text}
          </div>
        ) : (
          <div class="msg msg--bot" key={item.id}>
            <RichText text={item.text} />
            <ApartmentRail
              apartments={item.apartments}
              onOpenPlan={onOpenPlan}
              selected={selected}
              {...(onSelect ? { onSelect } : {})}
            />
            {item.failed ? <div class="msg__note">Ответ оборвался</div> : null}
          </div>
        ),
      )}

      {/* Ответ, который печатается прямо сейчас. */}
      {streaming && draft ? (
        <div class="msg msg--bot" aria-live="polite" aria-atomic="false">
          <RichText text={draft.text} caret={phase === 'streaming'} />
          <ApartmentRail
            apartments={draft.apartments}
            onOpenPlan={onOpenPlan}
            selected={selected}
            {...(onSelect ? { onSelect } : {})}
          />
        </div>
      ) : null}

      {thinking ? <Thinking label={tool} /> : null}

      {error ? (
        <div class="alert" role="alert">
          <span>{error.message}</span>
          {error.retriable ? (
            <button type="button" class="alert__retry" onClick={onRetry}>
              <RetryIcon size={15} />
              Повторить
            </button>
          ) : null}
        </div>
      ) : null}

      {/*
        Кнопки быстрых ответов. Под сообщением об ошибке их нет: реплики
        писались к ответу, которого посетитель так и не увидел. Форму контакта
        закрывает `App` — он же и решает, показывать её.
      */}
      {suggestions.length > 0 && error === null ? (
        <div class="replies" aria-label="Быстрые ответы">
          {suggestions.map((reply) => (
            <button type="button" class="chip" key={reply} onClick={() => onExample(reply)}>
              {reply}
            </button>
          ))}
        </div>
      ) : null}

      {/* Форма контакта — последний блок ленты. */}
      {contactSlot}
    </div>
  )
}

/** «Печатает» или «Подбираю квартиры» — смотря чем ассистент занят. */
function Thinking({ label }: { label: string | null }) {
  return (
    <div class="thinking" role="status">
      <span class="dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
      <span class="thinking__label">{label ?? 'Печатает'}</span>
    </div>
  )
}
