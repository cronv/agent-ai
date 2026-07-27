/**
 * Человекочитаемый идентификатор из названия.
 *
 *   slugify('ЖК «Северный парк»')  → 'zhk-severnyy-park'
 *
 * Нужен ЖК: колонка `projects.slug` уникальна, а названия из выгрузок
 * приходят по-русски, с кавычками и лишними знаками.
 */

const TRANSLIT: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z',
  и: 'i', й: 'y', к: 'k', л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r',
  с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c', ч: 'ch', ш: 'sh', щ: 'sch',
  ъ: '', ы: 'y', ь: '', э: 'e', ю: 'yu', я: 'ya',
}

export function slugify(source: string): string {
  let result = ''
  for (const char of source.toLowerCase()) {
    // Кириллица разбирается по таблице до всякой нормализации: NFKD раскладывает
    // «й» на «и» + краткую, и после отбрасывания знака получилось бы «i».
    const transliterated = TRANSLIT[char]
    if (transliterated !== undefined) {
      result += transliterated
    } else if (/[a-z0-9]/.test(char)) {
      result += char
    } else if (/\s|[-_/\\.,:;«»"'()[\]{}№+&]/.test(char)) {
      result += '-'
    } else {
      // Латиница с диакритикой: é → e. Всё остальное (эмодзи, иероглифы) выбрасываем.
      result += char.normalize('NFKD').replace(/[^a-z0-9]/g, '')
    }
  }
  return result.replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'obekt'
}

/**
 * Свободный вариант slug: `severnyy-park`, `severnyy-park-2`, `severnyy-park-3`.
 * `isTaken` спрашивает базу — так функция остаётся чистой и проверяемой.
 */
export async function uniqueSlug(source: string, isTaken: (slug: string) => Promise<boolean>): Promise<string> {
  const base = slugify(source)
  if (!(await isTaken(base))) return base
  for (let suffix = 2; suffix < 1000; suffix += 1) {
    const candidate = `${base}-${suffix}`
    if (!(await isTaken(candidate))) return candidate
  }
  return `${base}-${Date.now()}`
}
