import { useEffect, useRef, useState } from 'preact/hooks'

import { SendIcon } from './Icons.tsx'

/**
 * Поле ввода.
 *
 * Enter отправляет, Shift+Enter переносит строку — так пишут в мессенджерах,
 * и переучивать посетителя незачем. Поле растёт вместе с текстом до четырёх
 * строк, дальше прокручивается: длинный запрос не должен съесть переписку.
 *
 * Размер шрифта — 16px намеренно: на меньшем iOS зумит страницу при фокусе.
 */

const MAX_LENGTH = 2000
const MAX_ROWS_PX = 116

interface ComposerProps {
  disabled: boolean
  autoFocus: boolean
  onSend: (text: string) => void
}

export function Composer({ disabled, autoFocus, onSend }: ComposerProps) {
  const [value, setValue] = useState('')
  const field = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    if (autoFocus && !isTouchDevice()) field.current?.focus()
  }, [autoFocus])

  const resize = (): void => {
    const node = field.current
    if (!node) return
    node.style.height = 'auto'
    node.style.height = `${Math.min(node.scrollHeight, MAX_ROWS_PX)}px`
  }

  const submit = (): void => {
    const text = value.trim()
    if (text === '' || disabled) return
    onSend(text)
    setValue('')
    requestAnimationFrame(() => {
      const node = field.current
      if (node) node.style.height = 'auto'
    })
  }

  return (
    <div class="composer">
      <textarea
        ref={field}
        class="composer__field"
        rows={1}
        maxLength={MAX_LENGTH}
        placeholder="Опишите, что ищете"
        aria-label="Сообщение ассистенту"
        value={value}
        onInput={(event) => {
          setValue((event.target as HTMLTextAreaElement).value)
          resize()
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.shiftKey) {
            event.preventDefault()
            submit()
          }
        }}
      />
      <button
        type="button"
        class="composer__send"
        onClick={submit}
        disabled={disabled || value.trim() === ''}
        aria-label="Отправить сообщение"
      >
        <SendIcon size={19} />
      </button>
    </div>
  )
}

/** На телефоне фокус в поле сразу поднимает клавиатуру — это лишнее. */
function isTouchDevice(): boolean {
  return window.matchMedia('(pointer: coarse)').matches
}
