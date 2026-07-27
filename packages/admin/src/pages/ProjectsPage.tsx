import type { ReactElement } from 'react'

import { findNavItem } from '../navigation.js'
import { SectionPlaceholder } from './SectionPlaceholder.js'

/**
 * Раздел «ЖК».
 *
 * Заглушка: наполняется тикетом 11. Маршрут, пункт меню и обёртка
 * авторизации уже готовы — достаточно заменить содержимое этого файла.
 * Кирпичики интерфейса лежат в `src/ui`, запросы — через `api` из `src/lib/api.ts`.
 */

const SECTION = findNavItem('/projects')

export function ProjectsPage(): ReactElement {
  return <SectionPlaceholder title="ЖК" description={SECTION?.description} />
}
