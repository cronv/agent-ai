/**
 * Телефон лида.
 *
 *   normalizePhone('8 (912) 345-67-89')   → { ok: true, phone: '+79123456789' }
 *   normalizePhone('спросите у мамы')     → { ok: false, error: '…' }
 *
 * Хранится всегда в одном виде — `+7XXXXXXXXXX`. Это не косметика: по телефону
 * ищут в админке и сверяют дубли, а «8 912…», «+7 912…» и «(912)…» — один и тот
 * же человек. Приводить их к общему виду в момент поиска поздно, приводим на
 * входе.
 *
 * Показываем номер иначе — `+7 (912) 345-67-89`. В этом виде он попадает в CSV:
 * ячейку со скобками и пробелами Excel не пытается превратить в число или
 * формулу, а `+79123456789` — пытается.
 */

export type PhoneResult = { ok: true; phone: string } | { ok: false; error: string }

/** Что показать человеку, когда номер не разобрался. */
export const PHONE_ERROR = 'Телефон не похож на номер. Формат: +7 (912) 345-67-89.'

/**
 * Приводит номер к `+7XXXXXXXXXX`.
 *
 * Принимаем то, что реально пишут в формах: `8…`, `+7…`, `7…`, номер без кода
 * страны, скобки, пробелы, дефисы, точки. Всё, что осталось после выкидывания
 * разделителей, должно быть российским номером из 10 цифр — иначе отказ.
 */
export function normalizePhone(raw: unknown): PhoneResult {
  if (typeof raw !== 'string') return { ok: false, error: PHONE_ERROR }

  const text = raw.trim()
  if (text === '') return { ok: false, error: 'Телефон не заполнен. Формат: +7 (912) 345-67-89.' }

  // Буквы внутри номера — это не «лишний символ», а другой ввод: «позвоните
  // маме», «доб. 12». Молча выкидывать их и звонить по остатку нельзя.
  if (/[^\d\s()+.\-–—]/u.test(text)) return { ok: false, error: PHONE_ERROR }

  let digits = text.replace(/\D/gu, '')

  if (digits.length === 11 && (digits.startsWith('8') || digits.startsWith('7'))) {
    digits = digits.slice(1)
  } else if (digits.length === 12 && digits.startsWith('07')) {
    // Редкий, но встречающийся ввод «007…» без последнего нуля не бывает —
    // это международная запись +7 через префикс выхода.
    digits = digits.slice(2)
  } else if (digits.length === 13 && digits.startsWith('007')) {
    digits = digits.slice(3)
  }

  if (digits.length !== 10) return { ok: false, error: PHONE_ERROR }

  return { ok: true, phone: `+7${digits}` }
}

/** `+79123456789` → `+7 (912) 345-67-89`. Всё, что не в этом формате, отдаём как есть. */
export function formatPhone(phone: string): string {
  const match = /^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/u.exec(phone)
  if (!match) return phone
  return `+7 (${match[1]}) ${match[2]}-${match[3]}-${match[4]}`
}

/**
 * Куски номера для поиска в базе, где он лежит как `+7XXXXXXXXXX`.
 *
 *   phoneSearchFragments('8 912 345')  → ['8912345', '912345']
 *
 * Возвращается два варианта, а не один: ведущая восьмёрка в запросе может быть
 * и кодом страны («8 912…» — тот же номер, что «+7 912…»), и серединой номера
 * («…-89»). Угадывать не нужно — ищем по обоим.
 */
export function phoneSearchFragments(query: string): string[] {
  const digits = query.replace(/\D/gu, '')
  if (digits.length < 3) return []

  const fragments = [digits]
  if ((digits.startsWith('8') || digits.startsWith('7')) && digits.length > 3) {
    fragments.push(digits.slice(1))
  }
  return [...new Set(fragments)]
}
