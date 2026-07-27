import { describe, expect, it } from 'vitest'

import { CHUNK_MAX_CHARS, CHUNK_OVERLAP_CHARS, chunkText, normalizeText } from './chunk.js'

/**
 * Нарезка проверяется по свойствам, а не по конкретной раскладке фрагментов:
 * размер, целые слова, перекрытие и сохранность текста. Так тест переживёт
 * подстройку эвристик и всё равно поймает настоящую поломку.
 */

/** Длинный документ из абзацев разной длины — как настоящая презентация. */
function longDocument(paragraphs: number): string {
  const sentences = [
    'Ипотечная ставка с господдержкой начинается от 6% годовых.',
    'Первоначальный взнос составляет 20% от стоимости квартиры.',
    'Срок кредита до тридцати лет без дополнительных комиссий.',
    'Дом сдаётся в четвёртом квартале 2026 года по графику.',
    'Отделка White Box входит в стоимость и не оплачивается отдельно.',
  ]
  return Array.from({ length: paragraphs }, (_, index) => {
    const repeat = (index % 4) + 1
    return Array.from({ length: repeat }, (_, item) => sentences[(index + item) % sentences.length]).join(' ')
  }).join('\n\n')
}

/** Слова текста подряд — по ним видно, не потерялось ли что-то при нарезке. */
function words(text: string): string[] {
  return text.split(/\s+/).filter((word) => word !== '')
}

describe('normalizeText', () => {
  it('сводит переводы строк и пробелы к одному виду', () => {
    expect(normalizeText('Ипотека\r\n\r\n\r\n  Рассрочка \t\t от   застройщика  ')).toBe(
      'Ипотека\n\nРассрочка от застройщика',
    )
  })
})

describe('chunkText', () => {
  it('короткий текст остаётся одним фрагментом', () => {
    const chunks = chunkText('Дом сдаётся в 2026 году.')
    expect(chunks).toEqual(['Дом сдаётся в 2026 году.'])
  })

  it('пустой текст не даёт фрагментов', () => {
    expect(chunkText('   \n\n  \t ')).toEqual([])
  })

  it('склеивает мелкие абзацы, пока помещаются в лимит', () => {
    const chunks = chunkText('Первый абзац.\n\nВторой абзац.\n\nТретий абзац.')
    expect(chunks).toHaveLength(1)
    expect(chunks[0]).toContain('Первый абзац.')
    expect(chunks[0]).toContain('Третий абзац.')
  })

  it('на длинном тексте держит размер фрагмента и не рвёт слова', () => {
    const text = longDocument(60)
    const chunks = chunkText(text)

    expect(chunks.length).toBeGreaterThan(3)

    const sourceWords = new Set(words(text))
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS)
      expect(chunk.trim()).toBe(chunk)
      // Каждое слово фрагмента встречается в исходном тексте целиком —
      // значит, границы прошли по пробелам, а не посреди слова.
      for (const word of words(chunk)) {
        expect(sourceWords.has(word)).toBe(true)
      }
    }
  })

  it('соседние фрагменты перекрываются', () => {
    const chunks = chunkText(longDocument(60))

    for (let index = 1; index < chunks.length; index += 1) {
      const previous = chunks[index - 1] ?? ''
      const current = chunks[index] ?? ''
      const head = words(current)[0] ?? ''
      // Начало следующего фрагмента взято из хвоста предыдущего.
      expect(previous.slice(-CHUNK_OVERLAP_CHARS - head.length)).toContain(head)
    }
  })

  it('весь текст попадает хотя бы в один фрагмент', () => {
    const text = longDocument(40)
    const covered = chunkText(text).join(' ')
    for (const word of new Set(words(text))) {
      expect(covered).toContain(word)
    }
  })

  it('режет абзац длиннее лимита по предложениям', () => {
    const sentence = 'Ипотечная программа с господдержкой действует до конца года. '
    const chunks = chunkText(sentence.repeat(60))

    expect(chunks.length).toBeGreaterThan(1)
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(CHUNK_MAX_CHARS)
    }
  })

  it('слово длиннее лимита не разрывается', () => {
    const monster = 'а'.repeat(CHUNK_MAX_CHARS + 200)
    const chunks = chunkText(`Ссылка: ${monster} конец.`)

    expect(chunks.some((chunk) => chunk.includes(monster))).toBe(true)
  })

  it('уважает переданные размеры', () => {
    const chunks = chunkText(longDocument(20), { maxChars: 200, overlapChars: 40 })
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(200)
    }
    expect(chunks.length).toBeGreaterThan(5)
  })
})
