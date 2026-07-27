import type { ButtonHTMLAttributes, ReactElement, ReactNode } from 'react'

import { cx } from '../lib/cx.js'
import { Spinner } from './Spinner.js'

/**
 * Кнопка.
 *
 *   <Button onClick={save} loading={saving}>Сохранить</Button>
 *   <Button variant="secondary" size="sm">Отмена</Button>
 *   <Button variant="danger">Удалить</Button>
 *
 * `loading` сама блокирует кнопку и показывает крутилку — повторного клика
 * по отправленной форме не будет.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  loading?: boolean
  /** Иконка слева от текста. */
  icon?: ReactNode
  fullWidth?: boolean
}

const VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-strong disabled:hover:bg-accent',
  secondary:
    'bg-surface text-ink border border-line hover:bg-canvas disabled:hover:bg-surface',
  ghost: 'bg-transparent text-muted hover:bg-canvas hover:text-ink disabled:hover:bg-transparent',
  danger: 'bg-danger text-white hover:brightness-110 disabled:hover:brightness-100',
}

const SIZES: Record<ButtonSize, string> = {
  // min-h-11 — 44px, комфортное касание на планшете
  sm: 'min-h-9 px-3 text-sm gap-1.5',
  md: 'min-h-11 px-4 text-sm gap-2',
}

export function Button({
  variant = 'primary',
  size = 'md',
  loading = false,
  icon,
  fullWidth = false,
  className,
  children,
  disabled,
  type = 'button',
  ...props
}: ButtonProps): ReactElement {
  return (
    <button
      type={type}
      disabled={disabled === true || loading}
      aria-busy={loading || undefined}
      className={cx(
        'inline-flex cursor-pointer items-center justify-center rounded-xl font-medium',
        'transition-colors duration-150',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        fullWidth && 'w-full',
        className,
      )}
      {...props}
    >
      {loading ? <Spinner /> : icon}
      {children}
    </button>
  )
}
