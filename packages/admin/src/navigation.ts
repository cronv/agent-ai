import type { ComponentType } from 'react'

import type { IconProps } from './ui/icons.js'
import {
  IconConversations,
  IconDashboard,
  IconFeeds,
  IconKnowledge,
  IconLeads,
  IconProjects,
  IconSettings,
} from './ui/icons.js'

/**
 * Разделы админки — единственный список.
 *
 * Отсюда строится и боковое меню, и подсветка текущего раздела.
 * Новый раздел добавляется в два шага:
 *   1. строка в этом списке;
 *   2. `<Route>` с тем же путём в `App.tsx`.
 */

export interface NavItem {
  /** Путь внутри админки, без префикса `/admin`. */
  path: string
  label: string
  icon: ComponentType<IconProps>
  /** Короткое пояснение — используется в заголовке страницы-заглушки. */
  description: string
}

export const NAV_ITEMS: NavItem[] = [
  {
    path: '/',
    label: 'Дашборд',
    icon: IconDashboard,
    description: 'Что происходит: диалоги, лиды, база квартир и состояние выгрузок.',
  },
  {
    path: '/projects',
    label: 'ЖК',
    icon: IconProjects,
    description: 'Жилые комплексы: описание, район, метро, сроки сдачи.',
  },
  {
    path: '/feeds',
    label: 'Фиды',
    icon: IconFeeds,
    description: 'Выгрузки застройщиков: адреса, расписание, результат последней синхронизации.',
  },
  {
    path: '/knowledge',
    label: 'База знаний',
    icon: IconKnowledge,
    description: 'Презентации и условия ипотеки, по которым ассистент отвечает на вопросы.',
  },
  {
    path: '/conversations',
    label: 'Переписки',
    icon: IconConversations,
    description: 'Диалоги посетителей с ассистентом целиком.',
  },
  {
    path: '/leads',
    label: 'Лиды',
    icon: IconLeads,
    description: 'Контакты, которые люди оставили в чате.',
  },
  {
    path: '/settings',
    label: 'Настройки',
    icon: IconSettings,
    description: 'Характер ассистента, вид виджета, ключи и вебхуки.',
  },
]

/** Подпись текущего раздела — для заголовка на узком экране. */
export function findNavItem(pathname: string): NavItem | undefined {
  if (pathname === '/' || pathname === '') return NAV_ITEMS[0]
  return NAV_ITEMS.find((item) => item.path !== '/' && pathname.startsWith(item.path))
}
