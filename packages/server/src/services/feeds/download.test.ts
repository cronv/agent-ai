import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it } from 'vitest'

import { FeedDownloadError, downloadFeed } from './download.js'

/**
 * Скачивание проверяется против локального HTTP-сервера: интернет в тестах
 * не нужен, а поведение при 404, зависшем ответе и слишком большом файле
 * важно ровно потому, что в проде это и случается.
 */

let server: Server | null = null

async function serve(handler: Parameters<typeof createServer>[1]): Promise<string> {
  const created = createServer(handler)
  server = created
  await new Promise<void>((resolve) => created.listen(0, '127.0.0.1', resolve))
  const { port } = created.address() as AddressInfo
  return `http://127.0.0.1:${port}/feed.xml`
}

afterEach(async () => {
  const running = server
  server = null
  if (running) {
    running.closeAllConnections()
    await new Promise<void>((resolve) => running.close(() => resolve()))
  }
})

describe('downloadFeed', () => {
  it('отдаёт содержимое файла', async () => {
    const url = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/xml; charset=utf-8' })
      response.end('<?xml version="1.0"?><realty-feed><offer/></realty-feed>')
    })

    await expect(downloadFeed(url)).resolves.toContain('<realty-feed>')
  })

  it('перекодирует выгрузку в windows-1251', async () => {
    const body = Buffer.from(
      '<?xml version="1.0" encoding="windows-1251"?><realty-feed><name>Северный парк</name></realty-feed>',
      'utf8',
    )
    // Перегоняем в 1251 «на коленке»: тест важен именно для кириллицы.
    const cp1251 = Buffer.from(
      body.toString('utf8').replace(/[А-яЁё]/g, (char) => {
        const code = char.charCodeAt(0)
        if (code === 0x401) return String.fromCharCode(0xa8)
        if (code === 0x451) return String.fromCharCode(0xb8)
        return String.fromCharCode(code - 0x350)
      }),
      'latin1',
    )
    const url = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'text/xml' })
      response.end(cp1251)
    })

    const xml = await downloadFeed(url)
    expect(xml).toContain('Северный парк')
    expect(xml).toContain('encoding="utf-8"')
  })

  it('код ответа не 2xx — понятная ошибка', async () => {
    const url = await serve((_request, response) => {
      response.writeHead(404)
      response.end('not found')
    })

    await expect(downloadFeed(url)).rejects.toThrow(/404/)
  })

  it('зависший сервер обрывается по таймауту', async () => {
    const url = await serve(() => {
      // Ответа не будет никогда — ровно так ведёт себя перегруженный сервер.
    })

    await expect(downloadFeed(url, { timeoutMs: 150 })).rejects.toThrow(/не ответил/i)
  })

  it('слишком большой файл не читается в память', async () => {
    const url = await serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/xml' })
      response.end('x'.repeat(5000))
    })

    await expect(downloadFeed(url, { maxBytes: 1000 })).rejects.toThrow(/слишком большой/i)
  })

  it('недоступный сервер — ошибка, а не зависание', async () => {
    // Порт 1 не слушает никто: соединение отвергается сразу.
    await expect(downloadFeed('http://127.0.0.1:1/feed.xml', { timeoutMs: 2000 })).rejects.toThrow(FeedDownloadError)
  })

  it('не ходит по ссылкам с чужими протоколами', async () => {
    await expect(downloadFeed('file:///etc/passwd')).rejects.toThrow(/только ссылки http/i)
    await expect(downloadFeed('не ссылка')).rejects.toThrow(/неправильная/i)
  })
})
