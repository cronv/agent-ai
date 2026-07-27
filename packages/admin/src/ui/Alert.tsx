import type { ReactElement, ReactNode } from 'react'

import { cx } from '../lib/cx.js'
import { IconAlert, IconCheck } from './icons.js'

/**
 * Сообщение на всю ширину: ошибка запроса, предупреждение, успех.
 *
 *   <Alert tone="danger" title="Не удалось загрузить" action={<Button…/>}>
 *     {errorMessage(error)}
 *   </Alert>
 */

export type AlertTone = 'danger' | 'warn' | 'ok'

const TONES: Record<AlertTone, { box: string; icon: string }> = {
  danger: { box: 'border-danger/30 bg-danger-soft text-danger', icon: 'text-danger' },
  warn: { box: 'border-warn/30 bg-warn-soft text-warn', icon: 'text-warn' },
  ok: { box: 'border-ok/30 bg-ok-soft text-ok', icon: 'text-ok' },
}

export function Alert({
  tone = 'danger',
  title,
  children,
  action,
  className,
}: {
  tone?: AlertTone
  title?: ReactNode
  children?: ReactNode
  action?: ReactNode
  className?: string
}): ReactElement {
  const styles = TONES[tone]
  const Icon = tone === 'ok' ? IconCheck : IconAlert

  return (
    <div
      role={tone === 'ok' ? 'status' : 'alert'}
      className={cx('flex items-start gap-3 rounded-2xl border px-4 py-3.5 text-sm', styles.box, className)}
    >
      <Icon className={cx('mt-0.5 size-4.5 shrink-0', styles.icon)} />
      <div className="min-w-0 flex-1">
        {title ? <p className="font-medium">{title}</p> : null}
        {children ? (
          <div className={cx(title ? 'mt-0.5' : null, 'leading-relaxed')}>{children}</div>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  )
}
