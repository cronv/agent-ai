import type { ReactElement } from 'react'

import { findNavItem } from '../navigation.js'
import { SectionPlaceholder } from './SectionPlaceholder.js'

/**
 * Раздел «База знаний».
 *
 * Заглушка: наполняется тикетом 12. Маршрут, пункт меню и обёртка
 * авторизации уже готовы — достаточно заменить содержимое этого файла.
 * Кирпичики интерфейса лежат в `src/ui`, запросы — через `api` из `src/lib/api.ts`.
 */

const SECTION = findNavItem('/knowledge')

export function KnowledgePage(): ReactElement {
  return <SectionPlaceholder title="База знаний" description={SECTION?.description} />
}
