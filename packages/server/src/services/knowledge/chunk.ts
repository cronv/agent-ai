/**
 * Нарезка документа на фрагменты для поиска.
 *
 *   const chunks = chunkText(text)
 *
 * Размер выбран так, чтобы фрагмент помещался в ответ модели целиком и при
 * этом нёс достаточно контекста: цифру видно вместе с тем, к чему она
 * относится. Соседние фрагменты перекрываются — иначе факт, оказавшийся на
 * стыке, не найдётся ни в одном из них.
 *
 * Правила нарезки:
 *   1. Абзац — минимальная смысловая единица. Мелкие абзацы склеиваются,
 *      пока не наберётся `maxChars`.
 *   2. Абзац длиннее лимита режется по границам предложений, затем по словам.
 *   3. Слово не разрывается никогда. Единственное слово длиннее лимита
 *      (ссылка, склейка без пробелов) уезжает в свой фрагмент целиком —
 *      такой фрагмент выйдет за `maxChars`, и это осознанный размен.
 */

/** Максимальная длина фрагмента в символах. */
export const CHUNK_MAX_CHARS = 900

/** Сколько символов конца предыдущего фрагмента повторяется в начале следующего. */
export const CHUNK_OVERLAP_CHARS = 150

export interface ChunkOptions {
  maxChars?: number
  overlapChars?: number
}

/** Приводит текст к виду, в котором абзацы разделены ровно одной пустой строкой. */
export function normalizeText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    // Любой пробельный символ, кроме перевода строки (в том числе неразрывный
    // пробел из PDF), становится обычным пробелом.
    .replace(/[^\S\n]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/** Режет по словам: куски не длиннее `maxChars`, слова целые. */
function splitByWords(text: string, maxChars: number): string[] {
  const pieces: string[] = []
  let current = ''

  for (const word of text.split(' ')) {
    if (word === '') continue
    if (current === '') {
      current = word
      continue
    }
    if (current.length + 1 + word.length <= maxChars) {
      current = `${current} ${word}`
    } else {
      pieces.push(current)
      current = word
    }
  }

  if (current !== '') pieces.push(current)
  return pieces
}

/** Режет абзац по предложениям, длинные предложения — по словам. */
function splitParagraph(paragraph: string, maxChars: number): string[] {
  if (paragraph.length <= maxChars) return [paragraph]

  // Граница предложения: точка, восклицательный, вопросительный или многоточие
  // с пробелом после. Инициалы и сокращения иногда рвутся — на качестве поиска
  // это не сказывается, фрагменты всё равно перекрываются.
  const sentences = paragraph.split(/(?<=[.!?…])\s+/)
  const pieces: string[] = []
  let current = ''

  const flush = (): void => {
    if (current !== '') {
      pieces.push(current)
      current = ''
    }
  }

  for (const sentence of sentences) {
    if (sentence === '') continue

    if (sentence.length > maxChars) {
      flush()
      pieces.push(...splitByWords(sentence, maxChars))
      continue
    }

    if (current === '') {
      current = sentence
    } else if (current.length + 1 + sentence.length <= maxChars) {
      current = `${current} ${sentence}`
    } else {
      flush()
      current = sentence
    }
  }

  flush()
  return pieces
}

/**
 * Хвост фрагмента для перекрытия — не длиннее `overlapChars`
 * и обязательно с начала слова.
 */
function overlapTail(chunk: string, overlapChars: number): string {
  if (overlapChars <= 0) return ''
  if (chunk.length <= overlapChars) return chunk

  const tail = chunk.slice(chunk.length - overlapChars)
  const boundary = tail.search(/\s/)
  return boundary === -1 ? '' : tail.slice(boundary + 1).trim()
}

export function chunkText(text: string, options: ChunkOptions = {}): string[] {
  const maxChars = options.maxChars ?? CHUNK_MAX_CHARS
  // Перекрытие не должно съедать фрагмент: иначе на длинном тексте
  // нарезка перестанет продвигаться вперёд.
  const overlapChars = Math.min(options.overlapChars ?? CHUNK_OVERLAP_CHARS, Math.floor(maxChars / 3))

  const normalized = normalizeText(text)
  if (normalized === '') return []

  const pieces = normalized
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter((paragraph) => paragraph !== '')
    .flatMap((paragraph) => splitParagraph(paragraph, maxChars))

  const chunks: string[] = []
  let current = ''

  for (const piece of pieces) {
    if (current === '') {
      current = piece
      continue
    }

    if (current.length + 1 + piece.length <= maxChars) {
      current = `${current}\n${piece}`
      continue
    }

    chunks.push(current)
    const tail = overlapTail(current, overlapChars)
    current = tail !== '' && tail.length + 1 + piece.length <= maxChars ? `${tail}\n${piece}` : piece
  }

  if (current !== '') chunks.push(current)
  return chunks
}
