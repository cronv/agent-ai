import type { ReactElement, ReactNode } from 'react'

import { cx } from '../lib/cx.js'

/**
 * Таблица для списков админки.
 *
 *   <Table>
 *     <THead>
 *       <TH>Название</TH>
 *       <TH align="right">Квартир</TH>
 *     </THead>
 *     <TBody>
 *       <TR>
 *         <TD>ЖК Река</TD>
 *         <TD align="right" numeric>128</TD>
 *       </TR>
 *     </TBody>
 *   </Table>
 *
 * Обёртка сама даёт горизонтальную прокрутку — на планшете широкая таблица
 * прокручивается внутри себя, а страница целиком не едет вбок.
 * `numeric` включает моноширинные цифры, чтобы колонка не дёргалась.
 */

export function Table({ children, className }: { children: ReactNode; className?: string }): ReactElement {
  return (
    <div className="-mx-px overflow-x-auto">
      <table className={cx('w-full min-w-[36rem] border-collapse text-sm', className)}>{children}</table>
    </div>
  )
}

export function THead({ children }: { children: ReactNode }): ReactElement {
  return (
    <thead>
      <tr className="border-b border-line">{children}</tr>
    </thead>
  )
}

export function TBody({ children }: { children: ReactNode }): ReactElement {
  return <tbody>{children}</tbody>
}

type Align = 'left' | 'right' | 'center'

const ALIGN: Record<Align, string> = {
  left: 'text-left',
  right: 'text-right',
  center: 'text-center',
}

export function TH({
  children,
  align = 'left',
  className,
}: {
  children?: ReactNode
  align?: Align
  className?: string
}): ReactElement {
  return (
    <th
      scope="col"
      className={cx(
        'px-4 py-3 text-xs font-medium tracking-wide text-muted uppercase',
        ALIGN[align],
        className,
      )}
    >
      {children}
    </th>
  )
}

export function TR({
  children,
  className,
  highlighted = false,
}: {
  children: ReactNode
  className?: string
  /** Строка требует внимания — например, фид с ошибкой. */
  highlighted?: boolean
}): ReactElement {
  return (
    <tr
      className={cx(
        'border-b border-line last:border-0 transition-colors duration-150',
        highlighted ? 'bg-danger-soft/50' : 'hover:bg-canvas',
        className,
      )}
    >
      {children}
    </tr>
  )
}

export function TD({
  children,
  align = 'left',
  numeric = false,
  className,
}: {
  children?: ReactNode
  align?: Align
  numeric?: boolean
  className?: string
}): ReactElement {
  return (
    <td className={cx('px-4 py-3.5 align-middle text-ink', ALIGN[align], numeric && 'tabular', className)}>
      {children}
    </td>
  )
}
