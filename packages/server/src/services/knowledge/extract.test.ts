import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import {
  KnowledgeExtractionError,
  assertHasContent,
  countMeaningfulChars,
  detectFileKind,
  extractText,
} from './extract.js'

/**
 * Эталонные документы лежат рядом, в `__fixtures__`: настоящий PDF, настоящий
 * DOCX, текст и разметка. Извлечение проверяется на файлах, а не на моках —
 * ломается обычно именно на настоящих файлах.
 */
function fixture(name: string): Buffer {
  return readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url))
}

describe('detectFileKind', () => {
  it('узнаёт формат по расширению', () => {
    expect(detectFileKind('Ипотека.PDF')).toBe('pdf')
    expect(detectFileKind('условия.docx')).toBe('docx')
    expect(detectFileKind('памятка.txt')).toBe('text')
    expect(detectFileKind('рассрочка.md')).toBe('text')
  })

  it('без расширения смотрит на MIME-тип', () => {
    expect(detectFileKind('scan', 'application/pdf')).toBe('pdf')
    expect(detectFileKind('note', 'text/plain; charset=utf-8')).toBe('text')
  })

  it('незнакомый формат — null', () => {
    expect(detectFileKind('план.dwg', 'application/octet-stream')).toBeNull()
  })
})

describe('extractText', () => {
  it('достаёт русский текст из PDF', async () => {
    const text = await extractText({
      buffer: fixture('ipoteka.pdf'),
      filename: 'ipoteka.pdf',
      mimeType: 'application/pdf',
    })

    expect(text).toContain('Ипотечная ставка с господдержкой')
    expect(text).toContain('2026')
  })

  it('не тащит в текст служебные разделители страниц', async () => {
    const text = await extractText({
      buffer: fixture('ipoteka.pdf'),
      filename: 'ipoteka.pdf',
      mimeType: 'application/pdf',
    })

    expect(text).not.toMatch(/--\s*\d+\s+of\s+\d+\s*--/)
  })

  it('достаёт текст из DOCX', async () => {
    const text = await extractText({
      buffer: fixture('otdelka.docx'),
      filename: 'otdelka.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    expect(text).toContain('White Box')
    expect(text).toContain('Чистовая отделка')
  })

  it('читает TXT как есть', async () => {
    const text = await extractText({
      buffer: fixture('pamyatka.txt'),
      filename: 'pamyatka.txt',
      mimeType: 'text/plain',
    })

    expect(text).toContain('эскроу-счёте')
  })

  it('читает MD как есть, вместе с разметкой', async () => {
    const text = await extractText({
      buffer: fixture('rassrochka.md'),
      filename: 'rassrochka.md',
      mimeType: 'text/markdown',
    })

    expect(text).toContain('# Рассрочка от застройщика')
    expect(text).toContain('машиноместа')
  })

  it('на битом PDF объясняет, что случилось', async () => {
    const failure = extractText({
      buffer: fixture('broken.pdf'),
      filename: 'broken.pdf',
      mimeType: 'application/pdf',
    })

    await expect(failure).rejects.toBeInstanceOf(KnowledgeExtractionError)
    await expect(failure).rejects.toThrow(/Не удалось прочитать PDF/)
  })

  it('на битом DOCX объясняет, что случилось', async () => {
    const failure = extractText({
      buffer: Buffer.from('это не архив, а просто строка'),
      filename: 'usloviya.docx',
      mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    })

    await expect(failure).rejects.toThrow(/Не удалось прочитать DOCX/)
  })

  it('отказывается от неподдерживаемого формата', async () => {
    await expect(
      extractText({ buffer: Buffer.from([1, 2, 3]), filename: 'plan.dwg', mimeType: 'application/octet-stream' }),
    ).rejects.toThrow(/Формат файла не поддерживается/)
  })

  it('пустой файл — понятная ошибка, а не пустой документ', async () => {
    await expect(extractText({ buffer: Buffer.alloc(0), filename: 'пусто.txt' })).rejects.toThrow(/Файл пустой/)
  })

  it('файл из одних пробелов считается документом без текста', async () => {
    await expect(extractText({ buffer: Buffer.from('   \n\n  '), filename: 'пусто.txt' })).rejects.toThrow(
      /нет текстового слоя/,
    )
  })

  it('скан-презентация без текстового слоя — ошибка, а не готовый документ', async () => {
    const failure = extractText({
      buffer: fixture('skan.pdf'),
      filename: 'skan.pdf',
      mimeType: 'application/pdf',
    })

    await expect(failure).rejects.toBeInstanceOf(KnowledgeExtractionError)
    // Человек должен прочитать и причину, и что делать дальше.
    await expect(failure).rejects.toThrow(/нет текстового слоя/)
    await expect(failure).rejects.toThrow(/не распознаём/)
    await expect(failure).rejects.toThrow(/текстовым слоем/)
  })

  it('короткая, но настоящая памятка проходит', async () => {
    const text = await extractText({
      buffer: Buffer.from('Оплата идёт через эскроу-счёт в банке. Ключи выдают после ввода дома в эксплуатацию.'),
      filename: 'памятка.txt',
      mimeType: 'text/plain',
    })

    expect(text).toContain('эскроу-счёт')
  })
})

describe('countMeaningfulChars', () => {
  it('считает буквы и цифры, а не пунктуацию', () => {
    expect(countMeaningfulChars('-- 1 of 2 --\n-- 2 of 2 --')).toBe(8)
    expect(countMeaningfulChars('   \n\t  ')).toBe(0)
    expect(countMeaningfulChars('•—…«»')).toBe(0)
    expect(countMeaningfulChars('Ипотека 6%')).toBe(8)
  })
})

describe('assertHasContent', () => {
  const pamyatka = 'Оплата идёт через эскроу-счёт в банке. Ключи выдают после ввода дома в эксплуатацию.'

  it('пропускает памятку в несколько строк на одной странице', () => {
    expect(() => assertHasContent(pamyatka, 1)).not.toThrow()
    expect(() => assertHasContent(pamyatka, null)).not.toThrow()
  })

  it('отбраковывает то, что осталось от скана на две страницы', () => {
    expect(() => assertHasContent('-- 1 of 2 --\n-- 2 of 2 --', 2)).toThrow(KnowledgeExtractionError)
    expect(() => assertHasContent('\n\n\n\n', 2)).toThrow(/нет текстового слоя/)
  })

  it('смотрит на плотность: та же строчка на сорока страницах — уже не документ', () => {
    expect(() => assertHasContent(pamyatka, 40)).toThrow(/нет текстового слоя/)
  })

  it('без числа страниц работает по общему порогу', () => {
    expect(() => assertHasContent('...', null)).toThrow(/нет текстового слоя/)
    // Короткий, но настоящий факт из одной строки остаётся документом.
    expect(() => assertHasContent('Ипотека от 6% годовых.', null)).not.toThrow()
  })
})
