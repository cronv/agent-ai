/**
 * Форматирование для интерфейса: числа, деньги, даты, склонения.
 *
 * Всё по-русски и в одном месте — чтобы в разных разделах админки
 * «12 400 000 ₽» и «27 июля, 14:32» выглядели одинаково.
 */

const numberFormat = new Intl.NumberFormat('ru-RU')
const moneyFormat = new Intl.NumberFormat('ru-RU', {
  style: 'currency',
  currency: 'RUB',
  maximumFractionDigits: 0,
})
const dateFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long', year: 'numeric' })
const dateShortFormat = new Intl.DateTimeFormat('ru-RU', { day: 'numeric', month: 'long' })
const timeFormat = new Intl.DateTimeFormat('ru-RU', { hour: '2-digit', minute: '2-digit' })

function toDate(value: Date | string | number | null | undefined): Date | null {
  if (value === null || value === undefined) return null
  const date = value instanceof Date ? value : new Date(value)
  return Number.isNaN(date.getTime()) ? null : date
}

/** 1234567 → «1 234 567» */
export function formatNumber(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return numberFormat.format(value)
}

/** 12400000 → «12 400 000 ₽» */
export function formatMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return moneyFormat.format(value)
}

/** 12400000 → «12,4 млн ₽». Для мест, где важен порядок, а не точность. */
export function formatMoneyShort(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  if (Math.abs(value) >= 1_000_000) {
    const millions = value / 1_000_000
    const digits = Math.abs(millions) >= 100 ? 0 : 1
    return `${millions.toFixed(digits).replace('.', ',')} млн ₽`
  }
  if (Math.abs(value) >= 1000) return `${Math.round(value / 1000)} тыс ₽`
  return formatMoney(value)
}

/** «27 июля 2026» */
export function formatDate(value: Date | string | number | null | undefined): string {
  const date = toDate(value)
  return date ? dateFormat.format(date) : '—'
}

/** «27 июля, 14:32» — год добавляется, только если он не текущий. */
export function formatDateTime(value: Date | string | number | null | undefined): string {
  const date = toDate(value)
  if (!date) return '—'
  const sameYear = date.getFullYear() === new Date().getFullYear()
  const day = sameYear ? dateShortFormat.format(date) : dateFormat.format(date)
  return `${day}, ${timeFormat.format(date)}`
}

const MINUTE = 60_000
const HOUR = 60 * MINUTE
const DAY = 24 * HOUR

/**
 * «только что», «12 минут назад», «3 часа назад», «вчера, 14:32»,
 * дальше — обычная дата. Для «когда последний раз обновлялся фид».
 */
export function formatRelative(
  value: Date | string | number | null | undefined,
  now: Date = new Date(),
): string {
  const date = toDate(value)
  if (!date) return 'ещё ни разу'

  const diff = now.getTime() - date.getTime()
  if (diff < 0) return formatDateTime(date)
  if (diff < MINUTE) return 'только что'
  if (diff < HOUR) {
    const minutes = Math.floor(diff / MINUTE)
    return `${minutes} ${plural(minutes, ['минуту', 'минуты', 'минут'])} назад`
  }
  if (diff < DAY) {
    const hours = Math.floor(diff / HOUR)
    return `${hours} ${plural(hours, ['час', 'часа', 'часов'])} назад`
  }
  if (diff < 2 * DAY) return `вчера, ${timeFormat.format(date)}`
  if (diff < 7 * DAY) {
    const days = Math.floor(diff / DAY)
    return `${days} ${plural(days, ['день', 'дня', 'дней'])} назад`
  }
  return formatDateTime(date)
}

/**
 * Склонение по числу: plural(2, ['диалог', 'диалога', 'диалогов']) → «диалога».
 * Порядок форм: 1 / 2 / 5.
 */
export function plural(count: number, forms: [string, string, string]): string {
  const n = Math.abs(count) % 100
  const n1 = n % 10
  if (n > 10 && n < 20) return forms[2]
  if (n1 > 1 && n1 < 5) return forms[1]
  if (n1 === 1) return forms[0]
  return forms[2]
}

/** «5 квартир» — число вместе со склонённым словом. */
export function pluralize(count: number, forms: [string, string, string]): string {
  return `${formatNumber(count)} ${plural(count, forms)}`
}
