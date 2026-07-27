import type { ReactElement } from 'react'

import { findNavItem } from '../navigation.js'
import { SectionPlaceholder } from './SectionPlaceholder.js'

/**
 * Раздел «Настройки».
 *
 * Заглушка: наполняется тикетом 12. Маршрут, пункт меню и обёртка
 * авторизации уже готовы — достаточно заменить содержимое этого файла.
 * Кирпичики интерфейса лежат в `src/ui`, запросы — через `api` из `src/lib/api.ts`.
 */

const SECTION = findNavItem('/settings')

export function SettingsPage(): ReactElement {
  return <SectionPlaceholder title="Настройки" description={SECTION?.description} />
}
