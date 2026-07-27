/**
 * Маска телефона для формы контакта.
 *
 *   maskPhone('8 (912) 345-67-89')  → '+7 (912) 345-67-89'
 *   maskPhone('79123456789')        → '+7 (912) 345-67-89'
 *   toNationalDigits('+7 912…')     → '9123456789'
 *
 * Правила разбора повторяют серверные (`services/leads/phone.ts`): в форму
 * приходит и набранное вручную, и вставленное из письма или из адресной книги.
 * Поэтому маска не «фильтрует символы по одному», а каждый раз собирается
 * заново из цифр — тогда вставка любого формата ложится в неё сразу и целиком.
 *
 * Ведущие 8 и 7 считаются междугородным префиксом: российские коды с них не
 * начинаются в том виде, в каком их набирают («8 8442…» — это код 8442).
 */

/** Что стоит в поле, пока в нём пусто. */
export const PHONE_PLACEHOLDER = '+7 (___) ___-__-__'

/** Номер без кода страны — ровно столько цифр. */
const NATIONAL_LENGTH = 10

/** Цифры номера без кода страны: `'8 (912) 345-67-89'` → `'9123456789'`. */
export function toNationalDigits(raw: string): string {
  let digits = raw.replace(/\D/gu, '')

  if (digits.length > NATIONAL_LENGTH) {
    // Международная запись через префикс выхода: «007 912…».
    if (digits.startsWith('007')) digits = digits.slice(3)
    else if (digits.startsWith('8') || digits.startsWith('7')) digits = digits.slice(1)
  } else if (digits.startsWith('8') || digits.startsWith('7')) {
    digits = digits.slice(1)
  }

  return digits.slice(0, NATIONAL_LENGTH)
}

/**
 * Значение поля по тому, что в нём оказалось после ввода или вставки.
 *
 * Разделитель дописывается только тогда, когда за ним уже есть цифра: иначе
 * Backspace упирается в только что дорисованную скобку и номер не стереть.
 */
export function maskPhone(raw: string): string {
  const digits = toNationalDigits(raw)

  // Набрана одна восьмёрка — цифр номера ещё нет, но подсказать формат нужно.
  if (digits === '') return /\d$/u.test(raw) ? '+7 (' : ''

  let out = `+7 (${digits.slice(0, 3)}`
  if (digits.length > 3) out += `) ${digits.slice(3, 6)}`
  if (digits.length > 6) out += `-${digits.slice(6, 8)}`
  if (digits.length > 8) out += `-${digits.slice(8, 10)}`
  return out
}

/** Номер набран целиком — по нему можно звонить. */
export function isPhoneComplete(raw: string): boolean {
  return toNationalDigits(raw).length === NATIONAL_LENGTH
}

/** Вид, в котором номер уходит на сервер: `+79123456789`. */
export function toE164(raw: string): string {
  return `+7${toNationalDigits(raw)}`
}
