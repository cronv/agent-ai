import { readFileSync } from 'node:fs'

import { describe, expect, it } from 'vitest'

import { KnowledgeExtractionError, detectFileKind, extractText } from './extract.js'

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
      /не нашлось текста/,
    )
  })
})
