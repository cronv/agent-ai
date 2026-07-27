import { useId } from 'react'
import type { ReactElement, ReactNode, SelectHTMLAttributes } from 'react'

import { cx } from '../lib/cx.js'

/**
 * Выбор из списка — тот же вид, что у `Field`, чтобы форма выглядела ровно.
 *
 *   <Select
 *     label="Формат фида"
 *     value={format}
 *     onChange={(event) => setFormat(event.target.value)}
 *     options={[{ value: 'yandex', label: 'Яндекс.Недвижимость' }]}
 *     hint="Формат определяет, где в XML лежат поля квартиры"
 *   />
 *
 * Обычный `<select>`, а не самодельный список: он умеет клавиатуру, поиск
 * по первой букве и родное поведение на телефоне — переписывать это руками
 * значит потерять половину.
 */

export interface SelectOption {
  value: string
  label: string
}

export function Select({
  label,
  options,
  hint,
  error,
  className,
  ...rest
}: {
  label: string
  options: SelectOption[]
  hint?: ReactNode
  error?: string | null
  className?: string
} & Omit<SelectHTMLAttributes<HTMLSelectElement>, 'className' | 'children'>): ReactElement {
  const id = useId()
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const invalid = Boolean(error)
  const describedBy = cx(hint ? hintId : '', invalid ? errorId : '').trim() || undefined

  return (
    <div className={cx('flex flex-col gap-1.5', className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink">
        {label}
      </label>

      <select
        id={id}
        aria-invalid={invalid || undefined}
        aria-describedby={describedBy}
        className={cx(
          'w-full cursor-pointer appearance-none rounded-xl border bg-surface px-3.5 py-2.5 text-sm text-ink',
          'min-h-11 transition-colors duration-150',
          'disabled:cursor-not-allowed disabled:bg-canvas disabled:text-muted',
          invalid ? 'border-danger' : 'border-line hover:border-faint',
        )}
        {...rest}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>

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
