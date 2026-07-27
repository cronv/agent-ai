/** Склейка классов: `cx('a', condition && 'b')`. Пустые значения выбрасываются. */
export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(' ')
}
