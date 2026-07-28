/**
 * Приведение значений из выгрузки застройщика к числам, датам и словам.
 *
 * Выгрузки пишут одно и то же десятком способов: «18 450 000», «18450000.00»,
 * «12,5 млн», «62,4 кв. м», «1-комнатная», «Студия», «second» вместо второго
 * квартала. Всё это разбирается здесь, чтобы парсеры форматов занимались
 * только тем, где какое поле лежит.
 *
 * Правило общее: непонятное значение — это `null`, а не исключение и не 0.
 * Пустая цена приводит к тому, что лот пропускается, а не к квартире за 0 ₽.
 */

/** Пробелы, которые встречаются в числах: обычный, неразрывный, узкий, тонкий. */
const SPACES = /[\s    ]/g

/** Множители, которыми в выгрузках сокращают цену. */
const MULTIPLIERS: [RegExp, number][] = [
  [/млрд|миллиард|mlrd|bln/i, 1_000_000_000],
  [/млн|миллион|mln|kk/i, 1_000_000],
  [/тыс|thousand|тр\b/i, 1_000],
]

/** Значения, которые в выгрузках означают «да». */
const TRUTHY = new Set(['true', '1', 'yes', 'y', 'да', 'есть', 'on'])
/** Значения, которые означают «нет». */
const FALSY = new Set(['false', '0', 'no', 'n', 'нет', 'off', ''])

/**
 * Приводит что угодно к строке: XML-парсер отдаёт то строку, то число,
 * то объект `{ '#text': ... }` с атрибутами, то массив одноимённых тегов.
 * Из массива берётся первое непустое значение.
 */
export function toText(value: unknown): string | null {
  if (value === null || value === undefined) return null
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed === '' ? null : trimmed
  }
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : null
  if (typeof value === 'boolean') return value ? 'true' : 'false'
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = toText(item)
      if (text !== null) return text
    }
    return null
  }
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    // Тег с атрибутами: <area unit="кв.м">62.4</area>
    if ('#text' in record) return toText(record['#text'])
    // Тег-обёртка вида <price><value>…</value></price>, если путь указан не полностью
    if ('value' in record) return toText(record['value'])
    return null
  }
  return null
}

/** Строка без лишних пробелов и без пустоты. */
export function normalizeText(value: unknown, maxLength = 500): string | null {
  const text = toText(value)
  if (text === null) return null
  const collapsed = text.replace(/\s+/g, ' ').trim()
  if (collapsed === '') return null
  return collapsed.length > maxLength ? collapsed.slice(0, maxLength) : collapsed
}

/**
 * Число из человеческой записи.
 *
 *   '18 450 000'    → 18450000
 *   '18450000,50'   → 18450000.5
 *   '12,5 млн'      → 12500000
 *   '12,500,000'    → 12500000
 *   '62,4 кв. м'    → 62.4
 *   'по запросу'    → null
 *
 * Запятая читается как десятичный разделитель, кроме случая, когда за ней
 * идут ровно три цифры и множителя («млн», «тыс») в строке нет, — тогда это
 * разделитель тысяч.
 */
export function parseNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  const text = toText(value)
  if (text === null) return null

  let multiplier = 1
  for (const [pattern, factor] of MULTIPLIERS) {
    if (pattern.test(text)) {
      multiplier = factor
      break
    }
  }

  // Берём первое число целиком, вместе с разделителями внутри. Так «62,4 кв. м»
  // даёт 62,4, а точка из «кв. м» не превращает число в 624.
  const compact = text.replace(SPACES, '')
  const match = /-?\d[\d.,]*\d|-?\d/.exec(compact)
  if (!match) return null

  // Минус имеет смысл только в начале.
  const negative = match[0].startsWith('-')
  let digits = match[0].replace(/-/g, '')

  const hasDot = digits.includes('.')
  const hasComma = digits.includes(',')

  if (hasDot && hasComma) {
    // Последний встретившийся разделитель — десятичный, остальные лишние.
    const decimalSeparator = digits.lastIndexOf(',') > digits.lastIndexOf('.') ? ',' : '.'
    const thousandSeparator = decimalSeparator === ',' ? '.' : ','
    digits = digits.split(thousandSeparator).join('')
    digits = digits.replace(decimalSeparator, '.')
  } else if (hasComma) {
    const parts = digits.split(',')
    const last = parts[parts.length - 1] ?? ''
    const isThousandGroups = parts.length > 2 || (multiplier === 1 && last.length === 3)
    digits = isThousandGroups ? parts.join('') : parts.join('.')
  } else if (hasDot) {
    // '18.450.000' — точки как разделители тысяч; одна точка всегда десятичная.
    const parts = digits.split('.')
    if (parts.length > 2) digits = parts.join('')
  }

  const parsed = Number.parseFloat(digits)
  if (!Number.isFinite(parsed)) return null
  const result = parsed * multiplier * (negative ? -1 : 1)
  // Округляем «хвост» от умножения: 12,5 млн не должно стать 12499999.999
  return Math.round(result * 100) / 100
}

/** Цена: положительное число рублей. Ноль и мусор — `null`. */
export function parsePrice(value: unknown): number | null {
  const parsed = parseNumber(value)
  if (parsed === null || parsed <= 0) return null
  return Math.round(parsed * 100) / 100
}

/** Площадь в квадратных метрах. Отрицательные и нулевые значения отбрасываются. */
export function parseArea(value: unknown): number | null {
  const parsed = parseNumber(value)
  if (parsed === null || parsed <= 0) return null
  // Больше 1000 м² для квартиры — почти наверняка ошибка выгрузки (сотки, см²).
  if (parsed > 10_000) return null
  return Math.round(parsed * 100) / 100
}

/** Целое число (этаж, этажность, минуты до метро). */
export function parseInteger(value: unknown): number | null {
  const parsed = parseNumber(value)
  if (parsed === null) return null
  const rounded = Math.round(parsed)
  return Number.isSafeInteger(rounded) ? rounded : null
}

/**
 * Комнатность.
 *
 *   'студия' | 'studio' | 'Студия'  → 0
 *   '1-комнатная' | '1К' | '1' | 1  → 1
 *   'свободная планировка'          → null
 */
export function parseRooms(value: unknown): number | null {
  const text = toText(value)
  if (text === null) return null
  // Здесь проверяется только слово «студия»: `1` — это одна комната,
  // а не «да, студия», хотя в булевом поле та же единица значит именно «да».
  if (STUDIO_WORD.test(text)) return 0
  const match = /\d+/.exec(text)
  if (!match) return null
  const rooms = Number.parseInt(match[0], 10)
  if (!Number.isFinite(rooms) || rooms < 0 || rooms > 20) return null
  return rooms
}

/** Слово «студия» в любом написании — и по-русски, и латиницей. */
const STUDIO_WORD = /студи|studio/i

/** Планировка, которую нельзя выразить числом комнат. */
export const FREE_PLAN = 'свободная планировка'
/** Больше пяти комнат; сколько именно — выгрузка не говорит. */
export const MULTI_ROOM = 'многокомнатная'

/** Что удалось понять из кода комнатности. */
export interface RoomsCode {
  /** Число комнат; 0 — студия. `null` — код говорит не о количестве. */
  rooms: number | null
  /** Тип планировки словами, если код сообщает именно его. */
  planType: string | null
}

/**
 * Комнатность, записанная кодом, а не числом.
 *
 * Так устроен `FlatRoomsCount` в выгрузке ЦИАН: 1–5 — это комнаты, а 6, 7 и 9 —
 * условные обозначения. Прочитанные как обычное число, они превращают студию в
 * девятикомнатную квартиру, и человек, попросивший студию, её не находит.
 *
 *   1…5 → столько комнат
 *   6   → многокомнатная (больше пяти; сколько именно — неизвестно)
 *   7   → свободная планировка (комнат нет вообще)
 *   9   → студия, у нас это `rooms = 0`
 *
 * 6 и 7 не дают числа комнат: шестёрка означает «больше пяти», а не «шесть»,
 * семёрка не означает ничего похожего на комнаты. Записать их числом — значит
 * подсунуть такой лот человеку, который ищет шести- или семикомнатную. Поэтому
 * `rooms` у них пустой, а смысл переезжает в `planType`, откуда его видит и
 * ассистент, и карточка.
 *
 * `null` означает «кода нет» — вызывающий берёт комнатность из обычного поля.
 */
export function parseRoomsCode(value: unknown): RoomsCode | null {
  const text = toText(value)
  if (text === null) return null
  if (STUDIO_WORD.test(text)) return { rooms: 0, planType: null }

  const match = /\d+/.exec(text)
  if (!match) return null
  const code = Number.parseInt(match[0], 10)

  if (code >= 1 && code <= 5) return { rooms: code, planType: null }
  if (code === 6) return { rooms: null, planType: MULTI_ROOM }
  if (code === 7) return { rooms: null, planType: FREE_PLAN }
  if (code === 9) return { rooms: 0, planType: null }
  // Кода вне таблицы в выгрузке быть не должно; выдумывать по нему комнатность
  // опаснее, чем оставить лот без неё.
  return { rooms: null, planType: null }
}

/** Признак студии: и `<studio>true</studio>`, и `<FlatType>studio</FlatType>`. */
export function isStudio(value: unknown): boolean {
  const text = toText(value)
  if (text === null) return false
  if (STUDIO_WORD.test(text)) return true
  return TRUTHY.has(text.toLowerCase())
}

/** Да/нет из выгрузки. Непонятное значение — `null`. */
export function parseBoolean(value: unknown): boolean | null {
  const text = toText(value)
  if (text === null) return null
  const lower = text.toLowerCase()
  if (TRUTHY.has(lower)) return true
  if (FALSY.has(lower)) return false
  return null
}

/** Номер квартала: '2', 'II', 'second', '2 кв.' → 2. */
export function parseQuarter(value: unknown): number | null {
  const text = toText(value)
  if (text === null) return null
  const lower = text.toLowerCase()
  const words: [RegExp, number][] = [
    [/^(4|iv|fourth|четверт)/, 4],
    [/^(3|iii|third|трет)/, 3],
    [/^(2|ii|second|втор)/, 2],
    [/^(1|i|first|перв)/, 1],
  ]
  for (const [pattern, quarter] of words) {
    if (pattern.test(lower)) return quarter
  }
  return null
}

/** Год сдачи: разумный диапазон, чтобы «2027 г.» прошло, а «12» — нет. */
export function parseYear(value: unknown): number | null {
  const text = toText(value)
  if (text === null) return null
  const match = /\d{4}/.exec(text)
  if (!match) return null
  const year = Number.parseInt(match[0], 10)
  return year >= 1900 && year <= 2100 ? year : null
}

/**
 * Срок сдачи как дата. Выгрузки задают его годом и кварталом; берём последний
 * день квартала — это и есть обещанный срок «не позже».
 * Без квартала — конец года.
 */
export function quarterEndDate(year: number | null, quarter: number | null): Date | null {
  if (year === null) return null
  const q = quarter === null ? 4 : quarter
  if (q < 1 || q > 4) return null
  const month = q * 3 // 3, 6, 9, 12
  // День 0 следующего месяца = последний день текущего.
  return new Date(Date.UTC(year, month, 0))
}

/**
 * Дата из строки: ISO `2027-06-30`, `30.06.2027`, `2027`, `2 кв. 2027`.
 * Возвращается дата в UTC — колонка в базе имеет тип `date`, время не хранится.
 */
export function parseDate(value: unknown): Date | null {
  const text = toText(value)
  if (text === null) return null

  const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(text)
  if (iso) {
    return utcDate(Number(iso[1]), Number(iso[2]), Number(iso[3]))
  }

  const dotted = /^(\d{1,2})[.\/](\d{1,2})[.\/](\d{4})/.exec(text)
  if (dotted) {
    return utcDate(Number(dotted[3]), Number(dotted[2]), Number(dotted[1]))
  }

  // «2 кв. 2027», «IV квартал 2026»
  const year = parseYear(text)
  if (year !== null) {
    const quarterMatch = /(^|\D)(i{1,3}v?|iv|[1-4])\s*(кв|quarter)/i.exec(text)
    const quarter = quarterMatch ? parseQuarter(quarterMatch[2]) : null
    return quarterEndDate(year, quarter)
  }

  return null
}

function utcDate(year: number, month: number, day: number): Date | null {
  if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  const date = new Date(Date.UTC(year, month - 1, day))
  return Number.isNaN(date.getTime()) ? null : date
}

/** Коды отделки из выгрузок → человеческие слова. */
const FINISHING_LABELS: [RegExp, string][] = [
  // «нет» в графе отделки означает именно её отсутствие: так пишет ДомКлик.
  [/^(without|no|none|без\s*отделк|нет$|отсутств)/i, 'без отделки'],
  [/^(prefine|pre-fine|whitebox|white-box|предчистов|подчистов)/i, 'предчистовая'],
  [/^(rough|черновая|черновой)/i, 'черновая'],
  [/^(design|дизайнер)/i, 'дизайнерская'],
  [/^(fine|чистов|под\s*ключ|turnkey)/i, 'чистовая'],
  [/^(euro|евро)/i, 'евроремонт'],
  [/^(cosmetic|космет)/i, 'косметический ремонт'],
]

/** Отделка: коды приводятся к словам, всё остальное остаётся как есть. */
export function normalizeFinishing(value: unknown): string | null {
  const text = normalizeText(value, 100)
  if (text === null) return null
  for (const [pattern, label] of FINISHING_LABELS) {
    if (pattern.test(text)) return label
  }
  return text
}

/** Ссылка: только http(s), иначе `null` — в карточку не должно попасть `javascript:`. */
export function normalizeUrl(value: unknown): string | null {
  const text = toText(value)
  if (text === null) return null
  if (!/^https?:\/\//i.test(text)) return null
  return text.length > 2000 ? null : text
}

/** Цена за квадратный метр: из фида или посчитанная. */
export function computePricePerM2(price: number | null, area: number | null): number | null {
  if (price === null || area === null || area <= 0) return null
  return Math.round(price / area)
}
