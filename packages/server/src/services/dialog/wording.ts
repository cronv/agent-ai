/**
 * Русские формулировки для того, что уходит модели.
 *
 *   plural(30, 'квартира', 'квартиры', 'квартир')  // → 'квартир'
 *   roomsLabel(2)                                  // → 'двухкомнатные'
 *   priceRange(10_844_500, 12_575_103)             // → 'от 10,8 до 12,6 млн ₽'
 *
 * Модель дословно переносит в ответ то, что увидела в контексте и в результате
 * инструмента. Поэтому и перечень локаций, и объяснение пустой выдачи пишутся
 * тем же языком, каким ассистент разговаривает с посетителем: «двухкомнатные»,
 * а не «rooms: 2», и «10,8 млн ₽», а не «10844500». Иначе цифры из служебного
 * JSON всплывают в чате в сыром виде.
 */

/** Русские окончания: 1 квартира, 2 квартиры, 5 квартир. */
export function plural(count: number, one: string, few: string, many: string): string {
  const mod100 = Math.abs(count) % 100
  const mod10 = mod100 % 10
  if (mod100 >= 11 && mod100 <= 14) return many
  if (mod10 === 1) return one
  if (mod10 >= 2 && mod10 <= 4) return few
  return many
}

const ROOM_WORDS = [
  'студии',
  'однокомнатные',
  'двухкомнатные',
  'трёхкомнатные',
  'четырёхкомнатные',
  'пятикомнатные',
]

const ROOM_WORDS_GENITIVE = [
  'студий',
  'однокомнатных',
  'двухкомнатных',
  'трёхкомнатных',
  'четырёхкомнатных',
  'пятикомнатных',
]

const ROOM_WORDS_SINGULAR = [
  'студия',
  'однокомнатная',
  'двухкомнатная',
  'трёхкомнатная',
  'четырёхкомнатная',
  'пятикомнатная',
]

/** Комнатность словами, во множественном числе. 0 — студия. */
export function roomsLabel(rooms: number): string {
  return ROOM_WORDS[rooms] ?? `${rooms}-комнатные`
}

/**
 * Та же комнатность в родительном падеже — форма для отрицания.
 * «Двухкомнатные в Химках нет» — ровно то рассогласование, из-за которого
 * заведён тикет 19; отдавать модели такую заготовку нельзя.
 */
export function roomsGenitive(rooms: number): string {
  return ROOM_WORDS_GENITIVE[rooms] ?? `${rooms}-комнатных`
}

/**
 * Комнатность одной конкретной квартиры: «двухкомнатная».
 * Множественное число годится для перечня наличия, но не для той единственной,
 * которую человек выбрал.
 */
export function roomsSingular(rooms: number): string {
  return ROOM_WORDS_SINGULAR[rooms] ?? `${rooms}-комнатная`
}

/** Заглавная буква в начале фразы. */
export function capitalize(text: string): string {
  return text.length === 0 ? text : text[0]?.toUpperCase() + text.slice(1)
}

/** Список комнатностей через запятую: «студии, однокомнатные, двухкомнатные». */
export function roomsList(rooms: number[]): string {
  if (rooms.length === 0) return 'нет данных о комнатности'
  return rooms.map(roomsLabel).join(', ')
}

/** «10,8 млн ₽» — так же, как это должно выглядеть в чате. */
export function millions(price: number): string {
  return `${(price / 1_000_000).toFixed(1).replace('.', ',')} млн ₽`
}

/** «от 10,8 до 12,6 млн ₽», а при единственной цене — просто «10,8 млн ₽». */
export function priceRange(min: number | null, max: number | null): string {
  if (min === null || max === null) return 'цена неизвестна'
  if (Math.round(min) === Math.round(max)) return millions(min)
  return `от ${millions(min)} до ${millions(max)}`
}

/** «от 50,1 до 68,4 м²». */
export function areaRange(min: number | null, max: number | null): string {
  if (min === null || max === null) return 'площадь неизвестна'
  const format = (value: number): string => value.toFixed(1).replace('.', ',')
  if (format(min) === format(max)) return `${format(min)} м²`
  return `от ${format(min)} до ${format(max)} м²`
}
