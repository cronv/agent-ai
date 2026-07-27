import type { ComponentChildren } from 'preact'

/**
 * Иконки нарисованы прямо здесь: ни эмодзи, ни шрифта иконок, ни запроса
 * наружу. Один стиль — контур 1.6, скруглённые концы, сетка 24.
 */

interface IconProps {
  size?: number
}

function svg(size: number, children: ComponentChildren) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  )
}

export function ChatIcon({ size = 22 }: IconProps) {
  return svg(
    size,
    <>
      <path d="M20.5 11.6c0 4-3.8 7.2-8.5 7.2-.9 0-1.8-.1-2.6-.3L4 20.5l1.4-3.4C4 15.7 3.5 13.8 3.5 11.6c0-4 3.8-7.2 8.5-7.2s8.5 3.2 8.5 7.2Z" />
      <path d="M8.8 11.6h.01M12 11.6h.01M15.2 11.6h.01" />
    </>,
  )
}

export function CloseIcon({ size = 20 }: IconProps) {
  return svg(size, <path d="M6 6l12 12M18 6L6 18" />)
}

export function SendIcon({ size = 20 }: IconProps) {
  return svg(size, <path d="M12 19V5M6 11l6-6 6 6" />)
}

export function RetryIcon({ size = 16 }: IconProps) {
  return svg(
    size,
    <>
      <path d="M20 12a8 8 0 1 1-2.4-5.7" />
      <path d="M20 4v4h-4" />
    </>,
  )
}

export function ExpandIcon({ size = 18 }: IconProps) {
  return svg(
    size,
    <>
      <path d="M9 4H4v5M15 20h5v-5" />
      <path d="M4 4l6 6M20 20l-6-6" />
    </>,
  )
}

export function LinkIcon({ size = 16 }: IconProps) {
  return svg(
    size,
    <>
      <path d="M14 4h6v6" />
      <path d="M20 4l-8.5 8.5" />
      <path d="M18 14.5V19a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 19V8a1.5 1.5 0 0 1 1.5-1.5H10" />
    </>,
  )
}

/** Заглушка на месте планировки: чертёж, которого нет. */
export function PlanPlaceholderIcon({ size = 44 }: IconProps) {
  return svg(
    size,
    <>
      <path d="M3.5 5.5h17v13h-17z" />
      <path d="M10 5.5v6M10 11.5h10.5M15 11.5v7" />
      <path d="M3.5 14.5H10" />
    </>,
  )
}
