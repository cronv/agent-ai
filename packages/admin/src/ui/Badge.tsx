import type { ReactElement, ReactNode } from 'react'

import { cx } from '../lib/cx.js'

/**
 * Ярлык состояния: «работает», «ошибка», «выключен».
 *
 *   <Badge tone="danger" icon={<IconAlert className="size-3.5" />}>ошибка</Badge>
 *
 * Цвет никогда не единственный признак — рядом всегда есть текст,
 * иначе состояние теряется при дальтонизме и в чёрно-белой печати.
 */

export type BadgeTone = 'neutral' | 'ok' | 'warn' | 'danger' | 'accent'

const TONES: Record<BadgeTone, string> = {
  neutral: 'bg-canvas text-muted border-line',
  ok: 'bg-ok-soft text-ok border-transparent',
  warn: 'bg-warn-soft text-warn border-transparent',
  danger: 'bg-danger-soft text-danger border-transparent',
  accent: 'bg-accent-soft text-accent-strong border-transparent',
}

export function Badge({
  tone = 'neutral',
  icon,
  children,
  className,
}: {
  tone?: BadgeTone
  icon?: ReactNode
  children: ReactNode
  className?: string
}): ReactElement {
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full border px-2.5 py-1',
        'text-xs font-medium',
        TONES[tone],
        className,
      )}
    >
      {icon}
      {children}
    </span>
  )
}
