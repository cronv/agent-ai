import { useId } from 'react'
import type { InputHTMLAttributes, ReactElement, ReactNode, TextareaHTMLAttributes } from 'react'

import { cx } from '../lib/cx.js'

/**
 * Поле ввода с подписью, подсказкой и ошибкой.
 *
 *   <Field label="Логин" value={login} onChange={...} autoComplete="username" />
 *   <Field label="Адрес фида" hint="Ссылка на XML" error={error} />
 *   <Field label="Комментарий" multiline rows={4} />
 *
 * Подпись всегда видима — плейсхолдер вместо подписи пропадает при вводе
 * и оставляет человека гадать, что он заполняет. Ошибка показывается
 * под полем и связана с ним через `aria-describedby`.
 */

const CONTROL_CLASSES = [
  'w-full rounded-xl border bg-surface px-3.5 py-2.5 text-sm text-ink',
  'placeholder:text-faint',
  'transition-colors duration-150',
  'disabled:cursor-not-allowed disabled:bg-canvas disabled:text-muted',
].join(' ')

type CommonProps = {
  label: string
  hint?: ReactNode
  error?: string | null
  /** Показать «необязательное» вместо звёздочки. */
  optional?: boolean
  className?: string
}

type InputProps = CommonProps &
  Omit<InputHTMLAttributes<HTMLInputElement>, 'className'> & { multiline?: false }

type TextareaProps = CommonProps &
  Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'className'> & { multiline: true }

export type FieldProps = InputProps | TextareaProps

export function Field(props: FieldProps): ReactElement {
  const { label, hint, error, optional, className, ...rest } = props
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const invalid = Boolean(error)

  const describedBy = cx(hint ? hintId : '', invalid ? errorId : '').trim() || undefined

  const controlClassName = cx(
    CONTROL_CLASSES,
    invalid ? 'border-danger' : 'border-line hover:border-faint',
  )

  const { multiline, ...controlProps } = rest as { multiline?: boolean } & Record<string, unknown>

  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="flex items-baseline gap-2 text-sm font-medium text-ink">
        {label}
        {optional ? <span className="text-xs font-normal text-faint">необязательно</span> : null}
      </label>

      {multiline === true ? (
        <textarea
          id={id}
          className={controlClassName}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          {...(controlProps as TextareaHTMLAttributes<HTMLTextAreaElement>)}
        />
      ) : (
        <input
          id={id}
          className={controlClassName}
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          {...(controlProps as InputHTMLAttributes<HTMLInputElement>)}
        />
      )}

      {hint ? (
        <p id={hintId} className="text-xs leading-relaxed text-muted">
          {hint}
        </p>
      ) : null}

      {invalid ? (
        <p id={errorId} role="alert" className="text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
    </div>
  )
}
