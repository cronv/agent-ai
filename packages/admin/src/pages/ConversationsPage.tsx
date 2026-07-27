import type { ReactElement } from 'react'

import { findNavItem } from '../navigation.js'
import { SectionPlaceholder } from './SectionPlaceholder.js'

/**
 * Раздел «Переписки».
 *
 * Заглушка: наполняется тикетом 13. Маршрут, пункт меню и обёртка
 * авторизации уже готовы — достаточно заменить содержимое этого файла.
 * Кирпичики интерфейса лежат в `src/ui`, запросы — через `api` из `src/lib/api.ts`.
 */

const SECTION = findNavItem('/conversations')

export function ConversationsPage(): ReactElement {
  return <SectionPlaceholder title="Переписки" description={SECTION?.description} />
}
