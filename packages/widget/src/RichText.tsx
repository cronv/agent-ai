import type { ComponentChildren } from 'preact'

/**
 * Ответ модели — это почти всегда лёгкая разметка: абзацы, списки, жирные
 * заголовки строк. Полноценный markdown тянуть в бандл незачем, а показывать
 * посетителю голые звёздочки — неаккуратно.
 *
 * Разбирается ровно то, что модель реально использует: абзацы, маркированные
 * и нумерованные списки, `**жирный**`. Всё остальное остаётся текстом.
 *
 * Никакого `dangerouslySetInnerHTML`: текст приходит от модели, и превращать
 * его в HTML нельзя даже теоретически — рисуются узлы Preact.
 */

interface RichTextProps {
  text: string
  /** Курсор печати в конце последнего абзаца, пока ответ идёт потоком. */
  caret?: boolean
}

export function RichText({ text, caret = false }: RichTextProps) {
  const blocks = toBlocks(text)

  return (
    <>
      {blocks.map((block, blockIndex) => {
        const last = blockIndex === blocks.length - 1
        if (block.type === 'list') {
          return (
            <ul class="rt-list" key={blockIndex}>
              {block.items.map((item, itemIndex) => (
                <li key={itemIndex}>
                  {inline(item)}
                  {caret && last && itemIndex === block.items.length - 1 ? <Caret /> : null}
                </li>
              ))}
            </ul>
          )
        }
        return (
          <p class="rt-p" key={blockIndex}>
            {inline(block.text)}
            {caret && last ? <Caret /> : null}
          </p>
        )
      })}
      {blocks.length === 0 && caret ? (
        <p class="rt-p">
          <Caret />
        </p>
      ) : null}
    </>
  )
}

function Caret() {
  return <span class="rt-caret" aria-hidden="true" />
}

type Block = { type: 'paragraph'; text: string } | { type: 'list'; items: string[] }

/** Строки → абзацы и списки. Пустая строка разделяет абзацы. */
export function toBlocks(text: string): Block[] {
  const blocks: Block[] = []
  let paragraph: string[] = []
  let list: string[] = []

  const flushParagraph = (): void => {
    if (paragraph.length > 0) {
      blocks.push({ type: 'paragraph', text: paragraph.join(' ') })
      paragraph = []
    }
  }
  const flushList = (): void => {
    if (list.length > 0) {
      blocks.push({ type: 'list', items: list })
      list = []
    }
  }

  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (line === '') {
      flushParagraph()
      flushList()
      continue
    }

    const bullet = /^([-–—*•]|\d{1,2}[.)])\s+(.*)$/.exec(line)
    if (bullet) {
      flushParagraph()
      list.push(bullet[2] ?? '')
      continue
    }

    flushList()
    // Заголовки markdown встречаются редко; решётки просто убираются.
    paragraph.push(line.replace(/^#{1,6}\s+/, ''))
  }

  flushParagraph()
  flushList()
  return blocks
}

/** `**жирный**` внутри строки. Остальное — обычный текст. */
function inline(text: string): ComponentChildren {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter((part) => part !== '')
  if (parts.length === 1) return text

  return parts.map((part, index) =>
    part.startsWith('**') && part.endsWith('**') ? <b key={index}>{part.slice(2, -2)}</b> : part,
  )
}
