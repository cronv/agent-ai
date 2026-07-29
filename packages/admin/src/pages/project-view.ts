/**
 * ЖК в том виде, в каком его отдаёт админский API.
 *
 * Общий тип для списка (`ProjectsPage`) и карточки (`ProjectPage`) —
 * тот же набор полей, что у `ProjectView` на сервере
 * (`packages/server/src/routes/admin/projects.routes.ts`), только даты
 * приходят строками, как их сериализует JSON.
 */

/** Направление недвижимости. Значения совпадают с enum `ProjectCategory` на сервере. */
export type ProjectCategory = 'novostroyki' | 'vtorichka' | 'commercial' | 'suburban'

/** Направление с подписью — справочник для вкладок и для поля в карточке. */
export interface CategoryOption {
  value: ProjectCategory
  label: string
}

/** То же со счётчиком: вкладки в списке ЖК приходят с сервера уже с числами. */
export interface CategoryTab extends CategoryOption {
  count: number
}

/** Фид, из которого пришли квартиры ЖК: по нему видно, вернётся ли он после удаления. */
export interface ProjectFeedRef {
  id: string
  name: string
  isActive: boolean
  /** Сколько ЖК всего кормит этот фид. Больше одного — выключать его опасно. */
  projectCount: number
}

export interface ProjectView {
  id: string
  name: string
  slug: string
  developer: string | null
  district: string | null
  metro: string | null
  metroDistanceMin: number | null
  address: string | null
  deadline: string | null
  finishing: string | null
  description: string | null
  url: string | null
  imageUrl: string | null
  category: ProjectCategory
  /** Подпись направления: словарь живёт на сервере, здесь его не дублируем. */
  categoryLabel: string
  isActive: boolean
  createdAt: string
  updatedAt: string
  apartments: { active: number; total: number }
  /** Вилка цен по квартирам в продаже; `null` — продавать нечего. */
  price: { min: number; max: number } | null
  /** Фиды, поставляющие квартиры этого ЖК. */
  feeds: ProjectFeedRef[]
}

/** Ответ `GET /api/admin/projects/:id` — карточка вместе со справочником направлений. */
export interface ProjectCardResponse extends ProjectView {
  categories: CategoryOption[]
}

/** Ответ `GET /api/admin/projects`. */
export interface ProjectsResponse {
  projects: ProjectView[]
  categories: CategoryTab[]
}

/** Квартира в карточке ЖК. */
export interface ApartmentView {
  id: string
  externalId: string
  rooms: number | null
  /** «свободная планировка», «многокомнатная» — вместо числа комнат. */
  planType: string | null
  area: number | null
  floor: number | null
  floorsTotal: number | null
  price: number
  pricePerM2: number | null
  building: string | null
  section: string | null
  finishing: string | null
  deadline: string | null
  planImageUrl: string | null
  photos: string[]
  url: string | null
  isActive: boolean
  syncedAt: string
}

export interface ApartmentsResponse {
  project: { id: string; name: string }
  apartments: ApartmentView[]
  total: number
  limit: number
  offset: number
  facets: {
    rooms: { rooms: number | null; count: number }[]
    price: { min: number; max: number } | null
  }
}

/** «Студия», «2-комнатная» — как это называют в объявлениях. */
export function roomsLabel(rooms: number | null): string {
  if (rooms === null) return 'без комнатности'
  if (rooms === 0) return 'студия'
  return `${rooms}-комнатная`
}

/** Короткая подпись для фильтра: «Студии», «1к», «2к». */
export function roomsChipLabel(rooms: number | null): string {
  if (rooms === null) return 'без комнат'
  if (rooms === 0) return 'студии'
  return `${rooms}к`
}
