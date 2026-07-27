import type { ReactElement, ReactNode } from 'react'

import { cx } from '../lib/cx.js'

/**
 * Переключатель «включено / выключено».
 *
 *   <Toggle checked={project.isActive} onChange={setActive} label="Показывать в чате" />
 *   <Toggle checked={feed.isActive} onChange={setActive} label="Фид включён" hideLabel />
 *
 * Это `role="switch"`, а не чекбокс: состояние применяется сразу, без кнопки
 * «Сохранить». Подпись обязательна — в таблице её можно спрятать от глаз
 * (`hideLabel`), но скринридеру она всё равно достанется.
 *
 * Пока летит запрос, переключатель заблокирован и слегка притушен: второй
 * щелчок по неподтверждённому состоянию — верный способ получить кашу.
 */

export function Toggle({
  checked,
  onChange,
  label,
  hint,
  hideLabel = false,
  disabled = false,
  busy = false,
  className,
}: {
  checked: boolean
  onChange: (next: boolean) => void
  label: string
  hint?: ReactNode
  /** Спрятать подпись визуально, оставив её скринридеру. */
  hideLabel?: boolean
  disabled?: boolean
  /** Идёт запрос — переключатель ждёт ответа. */
  busy?: boolean
  className?: string
}): ReactElement {
  const locked = disabled || busy

  return (
    <div className={cx('flex items-start gap-3', className)}>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={hideLabel ? label : undefined}
        aria-busy={busy || undefined}
        disabled={locked}
        onClick={() => onChange(!checked)}
        // Кнопка 44×44 по касанию: сам ползунок мельче, но промахнуться сложно.
        className={cx(
          'relative flex h-11 w-11 shrink-0 cursor-pointer items-center justify-center',
          'disabled:cursor-not-allowed disabled:opacity-50',
        )}
      >
        <span
          className={cx(
            'block h-6 w-10 rounded-full transition-colors duration-150',
            checked ? 'bg-accent' : 'bg-line',
          )}
        />
        <span
          className={cx(
            'absolute block size-5 rounded-full bg-surface shadow-card transition-transform duration-150',
            checked ? 'translate-x-2' : '-translate-x-2',
          )}
        />
      </button>

      {hideLabel ? null : (
        <span className="flex min-w-0 flex-col gap-0.5 pt-2.5">
          <span className="text-sm font-medium text-ink">{label}</span>
          {hint ? <span className="text-xs leading-relaxed text-muted">{hint}</span> : null}
        </span>
      )}
    </div>
  )
}
