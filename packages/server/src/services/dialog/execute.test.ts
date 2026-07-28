import { beforeEach, describe, expect, it } from 'vitest'

import { ingestDocument } from '../knowledge/index.js'
import { createProject } from '../../testing/catalog.js'
import { resetDatabase, testDb } from '../../testing/db.js'
import { executeTool } from './execute.js'

/**
 * Разбор параметров инструментов проверяется на настоящей базе: то, что
 * присылает модель, — недоверенный ввод, и цена ошибки здесь не «неудобно»,
 * а «ассистент не нашёл условия и выдумал ставку» (тикет 17).
 */

async function addDoc(text: string, projectId: string | null): Promise<void> {
  const doc = await ingestDocument(testDb, {
    filename: 'ипотека.txt',
    mimeType: 'text/plain',
    buffer: Buffer.from(text, 'utf8'),
    projectId,
  })
  expect(doc.status).toBe('ready')
}

function fragments(content: string): { found: number; fragments: { content: string }[] } {
  return JSON.parse(content) as { found: number; fragments: { content: string }[] }
}

describe('search_knowledge: параметр project_id', () => {
  beforeEach(async () => {
    await resetDatabase()
  })

  it('находит документ ЖК, когда модель прислала название вместо идентификатора', async () => {
    const project = await createProject({ name: 'ЖК «Космос» (Домодедово)', slug: 'kosmos' })
    await addDoc('Ставка 3,7% годовых при первоначальном взносе от 35%.', project.id)

    const outcome = await executeTool(
      'search_knowledge',
      { query: 'ставка первоначальный взнос', project_id: 'Космос' },
      { db: testDb, conversationId: 'c1' },
    )

    expect(fragments(outcome.content).found).toBe(1)
  })

  it('идентификатор ЖК по-прежнему отсекает документы других комплексов', async () => {
    const kosmos = await createProject({ name: 'Космос', slug: 'kosmos' })
    const bereg = await createProject({ name: 'Берег', slug: 'bereg' })
    await addDoc('Ставка по ипотеке в Космосе — 3,7%.', kosmos.id)
    await addDoc('Ставка по ипотеке в Береге — 9,9%.', bereg.id)

    const outcome = await executeTool(
      'search_knowledge',
      { query: 'ставка по ипотеке', project_id: kosmos.id },
      { db: testDb, conversationId: 'c1' },
    )

    const parsed = fragments(outcome.content)
    expect(parsed.found).toBe(1)
    expect(parsed.fragments[0]?.content).toContain('Космосе')
  })

  it('нераспознанное название снимает фильтр, а не обнуляет выдачу', async () => {
    const project = await createProject({ name: 'Космос', slug: 'kosmos' })
    await addDoc('Ставка 3,7% годовых при первоначальном взносе от 35%.', project.id)

    const outcome = await executeTool(
      'search_knowledge',
      { query: 'ставка первоначальный взнос', project_id: 'ЖК которого нет' },
      { db: testDb, conversationId: 'c1' },
    )

    expect(fragments(outcome.content).found).toBe(1)
  })
})
