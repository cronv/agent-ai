import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'

import { Card, EmptyState, PageHeader } from '../ui/index.js'

/** Адрес внутри админки, которого нет. */
export function NotFoundPage(): ReactElement {
  return (
    <>
      <PageHeader title="Страница не найдена" />
      <Card padded={false}>
        <EmptyState
          title="Такого раздела нет"
          description="Возможно, ссылка устарела или в адресе опечатка."
          action={
            <Link
              to="/"
              className="inline-flex min-h-9 cursor-pointer items-center rounded-xl border border-line bg-surface px-3 text-sm font-medium text-ink transition-colors duration-150 hover:bg-canvas"
            >
              На дашборд
            </Link>
          }
        />
      </Card>
    </>
  )
}
