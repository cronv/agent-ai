import type { ReactElement } from 'react'

import { Card, EmptyState, PageHeader } from '../ui/index.js'

/**
 * Заглушка раздела, который делается следующим тикетом.
 *
 * Каркас, маршрут и пункт меню уже на месте — остаётся заменить содержимое
 * страницы раздела на настоящее.
 */

export function SectionPlaceholder({
  title,
  description,
}: {
  title: string
  description?: string
}): ReactElement {
  return (
    <>
      <PageHeader title={title} description={description} />
      <Card padded={false}>
        <EmptyState
          title="Раздел появится в следующем тикете"
          description="Каркас админки готов: вход, меню и маршруты работают. Содержимое этого раздела добавляется отдельной задачей."
        />
      </Card>
    </>
  )
}
