import type { ReactElement, ReactNode } from 'react'

/**
 * Шапка раздела: заголовок, пояснение и кнопка действия справа.
 *
 *   <PageHeader title="Лиды" description="Контакты из чата" action={<Button…/>} />
 */

export function PageHeader({
  title,
  description,
  action,
}: {
  title: string
  description?: ReactNode
  action?: ReactNode
}): ReactElement {
  return (
    <header className="flex flex-wrap items-end justify-between gap-4">
      <div className="min-w-0">
        <h1 className="text-2xl font-semibold tracking-tight text-ink sm:text-[1.75rem]">{title}</h1>
        {description ? <p className="mt-1.5 max-w-2xl text-sm text-muted">{description}</p> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </header>
  )
}
