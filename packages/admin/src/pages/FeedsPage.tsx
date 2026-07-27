import type { ReactElement } from 'react'

import { findNavItem } from '../navigation.js'
import { SectionPlaceholder } from './SectionPlaceholder.js'

/**
 * Раздел «Фиды».
 *
 * Заглушка: наполняется тикетом 11. Маршрут, пункт меню и обёртка
 * авторизации уже готовы — достаточно заменить содержимое этого файла.
 * Кирпичики интерфейса лежат в `src/ui`, запросы — через `api` из `src/lib/api.ts`.
 */

const SECTION = findNavItem('/feeds')

export function FeedsPage(): ReactElement {
  return <SectionPlaceholder title="Фиды" description={SECTION?.description} />
}
