import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import type { ReactElement, ReactNode } from 'react'

import { cx } from '../lib/cx.js'
import { Button } from './Button.js'
import { IconClose } from './icons.js'

/**
 * Окно поверх страницы: форма фида, подтверждение удаления.
 *
 *   <Modal open={open} title="Новый фид" onClose={close} footer={<Button…/>}>
 *     …поля…
 *   </Modal>
 *
 * Закрывается по Esc, по клику мимо и крестиком — три привычных выхода.
 * Пока окно открыто, страница под ним не прокручивается, а фокус уходит
 * внутрь и не убегает наружу по Tab: иначе клавиатурой можно «провалиться»
 * в таблицу, которую окно закрывает.
 */

export function Modal({
  open,
  title,
  description,
  onClose,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  title: string
  description?: ReactNode
  onClose: () => void
  children?: ReactNode
  footer?: ReactNode
  size?: 'md' | 'lg'
}): ReactElement | null {
  const panel = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return

    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') {
        onClose()
        return
      }
      if (event.key !== 'Tab' || !panel.current) return

      const focusable = panel.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      )
      const first = focusable[0]
      const last = focusable[focusable.length - 1]
      if (!first || !last) return

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault()
        last.focus()
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault()
        first.focus()
      }
    }

    const previous = document.activeElement as HTMLElement | null
    const bodyOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)

    // Фокус на первом поле формы: окно открыли, чтобы что-то в нём заполнить.
    panel.current?.querySelector<HTMLElement>('input, select, textarea, button')?.focus()

    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = bodyOverflow
      previous?.focus?.()
    }
  }, [open, onClose])

  if (!open) return null

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-end justify-center overflow-y-auto p-0 sm:items-center sm:p-6">
      <div className="fixed inset-0 bg-ink/40" onClick={onClose} aria-hidden="true" />

      <div
        ref={panel}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className={cx(
          'relative z-10 flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-surface shadow-pop sm:rounded-2xl',
          size === 'lg' ? 'sm:max-w-3xl' : 'sm:max-w-lg',
        )}
      >
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4 sm:px-6">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold tracking-tight text-ink">
              {title}
            </h2>
            {description ? <p className="mt-1 text-sm leading-relaxed text-muted">{description}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Закрыть"
            className="-mr-2 flex size-9 shrink-0 cursor-pointer items-center justify-center rounded-lg text-muted transition-colors duration-150 hover:bg-canvas hover:text-ink"
          >
            <IconClose className="size-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">{children}</div>

        {footer ? (
          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-4 sm:px-6">
            {footer}
          </div>
        ) : null}
      </div>
    </div>,
    document.body,
  )
}

/**
 * Подтверждение необратимого действия.
 *
 *   <ConfirmDialog
 *     open={…}
 *     title="Удалить фид?"
 *     confirmLabel="Удалить"
 *     onConfirm={remove}
 *     onClose={…}
 *   >
 *     Вместе с ним пропадут 128 квартир.
 *   </ConfirmDialog>
 */
export function ConfirmDialog({
  open,
  title,
  children,
  confirmLabel = 'Удалить',
  cancelLabel = 'Отмена',
  loading = false,
  onConfirm,
  onClose,
}: {
  open: boolean
  title: string
  children?: ReactNode
  confirmLabel?: string
  cancelLabel?: string
  loading?: boolean
  onConfirm: () => void
  onClose: () => void
}): ReactElement | null {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>
            {cancelLabel}
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={loading}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      <div className="text-sm leading-relaxed text-muted">{children}</div>
    </Modal>
  )
}
