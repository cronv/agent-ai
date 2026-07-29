import { ProjectCategory } from '@prisma/client'

/**
 * Направления каталога.
 *
 *   PROJECT_CATEGORIES            // порядок для админки и для промпта
 *   categoryLabel('vtorichka')    // → 'Вторичка'
 *
 * Одно место на весь проект: этим же порядком идут вкладки в разделе «ЖК»,
 * этими же словами направления называются в системном контексте ассистента и
 * в ответах инструментов. Разойдись они — администратор нажимал бы «Коммерция»,
 * а ассистент рассказывал бы про «коммерческую недвижимость», и сверить одно
 * с другим стало бы нечем.
 *
 * Новостройки идут первыми и служат значением по умолчанию: импорт фида
 * заводит ЖК именно из выгрузок застройщиков.
 */

export const PROJECT_CATEGORIES = [
  ProjectCategory.novostroyki,
  ProjectCategory.vtorichka,
  ProjectCategory.commercial,
  ProjectCategory.suburban,
] as const

export const DEFAULT_PROJECT_CATEGORY: ProjectCategory = ProjectCategory.novostroyki

const LABELS: Record<ProjectCategory, string> = {
  novostroyki: 'Новостройки',
  vtorichka: 'Вторичка',
  commercial: 'Коммерция',
  suburban: 'Загородная недвижимость',
}

/** Направление в родительном падеже — для фраз «в каталоге нет коммерции». */
const GENITIVE: Record<ProjectCategory, string> = {
  novostroyki: 'новостроек',
  vtorichka: 'вторички',
  commercial: 'коммерции',
  suburban: 'загородной недвижимости',
}

export function categoryLabel(category: ProjectCategory): string {
  return LABELS[category]
}

export function categoryGenitive(category: ProjectCategory): string {
  return GENITIVE[category]
}

export function isProjectCategory(value: unknown): value is ProjectCategory {
  return typeof value === 'string' && (PROJECT_CATEGORIES as readonly string[]).includes(value)
}

/**
 * Направление из того, что написал человек или модель.
 *
 * Принимает и ключ (`vtorichka`), и слово («вторичка», «коммерческая»):
 * модель кладёт в параметр инструмента то, что услышала от посетителя,
 * и отбрасывать это значило бы отвечать «такого направления нет» на «а
 * загородные дома есть?».
 */
export function parseProjectCategory(value: unknown): ProjectCategory | null {
  if (isProjectCategory(value)) return value
  if (typeof value !== 'string') return null

  const text = value.trim().toLowerCase()
  if (text === '') return null
  if (/новостро|первичк|строящ/.test(text)) return ProjectCategory.novostroyki
  if (/вторичк|вторичн/.test(text)) return ProjectCategory.vtorichka
  if (/коммерч|коммерци|офис|склад|торгов/.test(text)) return ProjectCategory.commercial
  if (/загород|дом|коттедж|таунхаус|участ|дач/.test(text)) return ProjectCategory.suburban
  return null
}
