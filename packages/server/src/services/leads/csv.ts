/**
 * Выгрузка в CSV, который открывается двойным кликом в Excel.
 *
 *   const csv = buildCsv(['Имя', 'Телефон'], [['Иван', '+7 (912) 345-67-89']])
 *
 * Три вещи, без которых русский CSV в Excel выглядит мусором:
 *
 *   1. BOM в начале файла. Без него Excel читает UTF-8 как ANSI, и кириллица
 *      превращается в «ÐÐ²Ð°Ð½».
 *   2. Разделитель «;». Excel в русской локали считает запятую десятичным
 *      знаком и складывает всю строку в одну ячейку.
 *   3. Переводы строк CRLF и кавычки удвоением — иначе комментарий с переносом
 *      строки разъезжается на несколько записей.
 *
 * Значения, начинающиеся с `=`, `+`, `-`, `@`, Excel считает формулой. Телефон
 * поэтому выгружается в виде `+7 (912) 345-67-89` — со скобками он формулой не
 * притворяется, — а остальное на всякий случай обезвреживается апострофом.
 */

export const CSV_BOM = '﻿'
export const CSV_DELIMITER = ';'

export function buildCsv(headers: string[], rows: string[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(CSV_DELIMITER))
  return CSV_BOM + lines.join('\r\n') + '\r\n'
}

function escapeCell(value: string): string {
  const safe = /^[=@]/u.test(value) ? `'${value}` : value
  if (/["\r\n;]/u.test(safe)) {
    return `"${safe.replace(/"/gu, '""')}"`
  }
  return safe
}

/** Дата в виде, который Excel понимает без настроек: `27.07.2026 14:05`. */
export function formatCsvDate(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, '0')
  return (
    `${pad(date.getDate())}.${pad(date.getMonth() + 1)}.${date.getFullYear()} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}`
  )
}
