import type { ReactElement } from 'react'

import { cx } from '../lib/cx.js'
import { formatNumber } from '../lib/format.js'

/**
 * Переключатель фильтра кнопками с цифрами.
 *
 *   <FilterChips
 *     legend="Статус"
 *     value={status}
 *     onChange={setStatus}
 *     options={[{ value: '', label: 'Все', count: 128 }, …]}
 *   />
 *
 * Так же выглядит фильтр комнатности в карточке ЖК — один приём на всю
 * админку. Цифра рядом с подписью отвечает на «а есть ли там вообще что-то»
 * до того, как человек нажмёт.
 */

export interface FilterChip<T extends string> {
  value: T
  label: string
  count?: number | undefined
}

export function FilterChips<T extends string>({
  legend,
  options,
  value,
  onChange,
}: {
  legend: string
  options: FilterChip<T>[]
  value: T
  onChange: (value: T) => void
}): ReactElement {
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="text-sm font-medium text-ink">{legend}</legend>
      <div className="flex flex-wrap gap-2">
        {options.map((option) => {
          const active = option.value === value
          return (
            <button
              key={option.value === '' ? '__all' : option.value}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(option.value)}
              className={cx(
                'min-h-11 cursor-pointer rounded-xl border px-3.5 text-sm transition-colors duration-150',
                active
                  ? 'border-transparent bg-accent-soft font-medium text-accent-strong'
                  : 'border-line bg-surface text-muted hover:border-faint hover:text-ink',
              )}
            >
              {option.label}
              {option.count === undefined ? null : (
                <span className="tabular ml-1.5 text-xs text-faint">{formatNumber(option.count)}</span>
              )}
            </button>
          )
        })}
      </div>
    </fieldset>
  )
}
