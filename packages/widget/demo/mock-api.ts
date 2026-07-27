import type { Connect, Plugin } from 'vite'

/**
 * Демо-сервер для локального просмотра виджета.
 *
 * Отвечает ровно теми же событиями и в том же порядке, что настоящий
 * `POST /api/chat`: `ready` → `tool` → `apartments` → `text` кусками → `done`.
 * Это нужно, чтобы виджет можно было открыть и покликать без базы, ключа
 * Anthropic и запущенного сервера — и увидеть его таким, каким его увидит
 * посетитель сайта.
 *
 * Живёт только в режиме разработки (`apply: 'serve'`) и в бандл не попадает.
 *
 * Слова-переключатели для демонстрации:
 *   «ошибка»  — сбой модели: событие error и кнопка «Повторить»;
 *   «молчок»  — обрыв соединения без `done`;
 *   «ипотек»  — ответ из базы знаний, без карточек;
 *   «контакт» — ассистент просит контакт: событие `tool` с `save_lead`,
 *               по нему виджет открывает форму прямо в ленте.
 *
 * `POST /api/lead` отвечает так же, как настоящий: 201 с лидом, 400 с кодом,
 * полем и готовым русским текстом. Повторная отправка в той же сессии
 * возвращает тот же `lead.id` — дубля не появляется. Имя «сбой» в форме
 * ломает ответ намеренно: так проверяется, что введённое не теряется.
 */

interface DemoApartment {
  id: string
  projectId: string | null
  projectName: string | null
  developer: string | null
  district: string | null
  metro: string | null
  metroDistanceMin: number | null
  rooms: number | null
  area: number | null
  livingArea: number | null
  kitchenArea: number | null
  floor: number | null
  floorsTotal: number | null
  price: number
  pricePerM2: number | null
  building: string | null
  section: string | null
  finishing: string | null
  deadline: string | null
  planImageUrl: string | null
  url: string | null
}

const APARTMENTS: DemoApartment[] = [
  {
    id: 'a1',
    projectId: 'p1',
    projectName: 'Северная гавань',
    developer: 'Балтийский Дом',
    district: 'Приморский',
    metro: 'Беговая',
    metroDistanceMin: 7,
    rooms: 2,
    area: 54.3,
    livingArea: 30.1,
    kitchenArea: 12.4,
    floor: 9,
    floorsTotal: 24,
    price: 17_450_000,
    pricePerM2: 321_362,
    building: 'Корпус 3',
    section: '2',
    finishing: 'чистовая',
    deadline: '2027-06-30',
    planImageUrl: '/demo/plans/plan-2k.svg',
    url: 'https://example.com/apartments/a1',
  },
  {
    id: 'a2',
    projectId: 'p1',
    projectName: 'Северная гавань',
    developer: 'Балтийский Дом',
    district: 'Приморский',
    metro: 'Беговая',
    metroDistanceMin: 7,
    rooms: 1,
    area: 38.9,
    livingArea: 18.2,
    kitchenArea: 11.0,
    floor: 14,
    floorsTotal: 24,
    price: 12_980_000,
    pricePerM2: 333_675,
    building: 'Корпус 1',
    section: '4',
    finishing: 'без отделки',
    deadline: '2026-12-31',
    planImageUrl: '/demo/plans/plan-1k.svg',
    url: 'https://example.com/apartments/a2',
  },
  {
    id: 'a3',
    projectId: 'p2',
    projectName: 'Гранд Мойка 14',
    developer: 'Нева Девелопмент',
    district: 'Адмиралтейский',
    metro: 'Адмиралтейская',
    metroDistanceMin: 4,
    rooms: 3,
    area: 96.5,
    livingArea: 52.0,
    kitchenArea: 21.3,
    floor: 5,
    floorsTotal: 8,
    price: 48_200_000,
    pricePerM2: 499_481,
    building: null,
    section: '1',
    finishing: 'предчистовая',
    deadline: '2026-09-30',
    planImageUrl: '/demo/plans/plan-3k.svg',
    url: 'https://example.com/apartments/a3',
  },
  {
    id: 'a4',
    projectId: 'p3',
    projectName: 'Лесной квартал',
    developer: 'ПИК',
    district: 'Выборгский',
    metro: 'Удельная',
    metroDistanceMin: 12,
    rooms: 0,
    area: 26.4,
    livingArea: 20.0,
    kitchenArea: null,
    floor: 3,
    floorsTotal: 17,
    price: 8_640_000,
    pricePerM2: 327_272,
    building: 'Корпус 2',
    section: null,
    finishing: 'чистовая',
    deadline: '2028-03-31',
    // Битая ссылка нарочно: показывает заглушку вместо сломанной картинки.
    planImageUrl: '/demo/plans/plan-missing.svg',
    url: 'https://example.com/apartments/a4',
  },
]

const CONFIG = {
  enabled: true,
  title: 'Столица Эстейт',
  accentColor: '#2F6BFF',
  greeting: 'Здравствуйте! Помогу подобрать квартиру в новостройке. Расскажите, что ищете — своими словами.',
  exampleQuestions: [
    'Двушка до 18 млн рядом с метро',
    'Что сдаётся в 2026 году?',
    'Есть ли рассрочка без процентов?',
    'Сравните два ЖК по срокам сдачи',
  ],
  privacyPolicyUrl: 'https://example.com/privacy',
}

interface StoredMessage {
  id: string
  role: 'user' | 'assistant'
  content: string
  apartments: DemoApartment[]
  createdAt: string
}

const history = new Map<string, StoredMessage[]>()

interface StoredLead {
  id: string
  name: string
  phone: string
  phoneFormatted: string
  comment: string | null
  createdAt: string
}

/** Лид на сессию: второй раз обновляется тот же, как в настоящей базе. */
const leads = new Map<string, StoredLead>()

export function mockApi(): Plugin {
  return {
    name: 'novostroyki-demo-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/api', async (request, response, next) => {
        const url = request.url ?? '/'

        if (request.method === 'OPTIONS') {
          response.statusCode = 204
          response.end()
          return
        }

        if (url.startsWith('/widget/config')) {
          json(response, CONFIG)
          return
        }

        if (request.method === 'GET' && url.startsWith('/chat/')) {
          const sessionId = decodeURIComponent(url.slice('/chat/'.length).split('?')[0] ?? '')
          json(response, {
            sessionId,
            conversationId: history.has(sessionId) ? 'demo-conversation' : null,
            startedAt: new Date().toISOString(),
            messages: history.get(sessionId) ?? [],
          })
          return
        }

        if (request.method === 'POST' && url.startsWith('/chat')) {
          await streamAnswer(request, response)
          return
        }

        if (request.method === 'POST' && url.startsWith('/lead')) {
          await saveLead(request, response)
          return
        }

        next()
      })
    },
  }
}

async function streamAnswer(request: Connect.IncomingMessage, response: import('node:http').ServerResponse) {
  const body = (await readJson(request)) as { sessionId?: string; message?: string }
  const sessionId = body.sessionId ?? 'demo'
  const message = (body.message ?? '').toLowerCase()

  response.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-store',
    connection: 'keep-alive',
  })

  const send = (event: string, data: unknown): void => {
    response.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
  }
  const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

  send('ready', { conversationId: 'demo-conversation', sessionId })
  remember(sessionId, { role: 'user', content: body.message ?? '', apartments: [] })

  if (message.includes('ошибка')) {
    await wait(600)
    send('error', { message: 'Не получилось ответить. Попробуйте ещё раз.' })
    send('done', { reply: { failed: true } })
    response.end()
    return
  }

  if (message.includes('молчок')) {
    await wait(600)
    send('text', { text: 'Начинаю отвечать и тут же теря' })
    // Пауза, чтобы кусок успел уйти в сокет: иначе виджету нечего сохранять.
    await wait(400)
    response.destroy()
    return
  }

  // Ассистент просит контакт: инструмент `save_lead` — сигнал виджету открыть
  // форму, чтобы телефон не диктовали в поле сообщения.
  if (message.includes('контакт') || message.includes('звон') || message.includes('посмотреть')) {
    await wait(500)
    send('tool', { name: 'save_lead', input: {} })
    await wait(800)

    const asking = [
      'Отлично, покажу квартиру вживую. ',
      'Оставьте имя и телефон в форме ниже — менеджер перезвонит, ',
      'согласует время и подготовит документы по выбранному ЖК.',
    ]
    for (const chunk of asking) {
      await wait(160)
      send('text', { text: chunk })
    }

    remember(sessionId, { role: 'assistant', content: asking.join(''), apartments: [] })
    send('done', { reply: { failed: false, messageId: `m-${Date.now()}` } })
    response.end()
    return
  }

  const knowledge = message.includes('ипотек') || message.includes('рассроч')
  const reply = knowledge
    ? [
        'По **Северной гавани** застройщик даёт рассрочку до ключей: первый взнос 20%, ',
        'остаток равными платежами до июня 2027 года, без процентов.\n\n',
        'Из ипотечных программ действуют семейная под 6% и IT-ипотека под 5%. ',
        'Точный платёж считает менеджер — назовите первый взнос и срок, и я передам расчёт.',
      ]
    : [
        'Нашёл три подходящих варианта — все с чистовой или предчистовой отделкой:\n\n',
        '- **Северная гавань** — 7 минут пешком до «Беговой», сдача летом 2027\n',
        '- **Гранд Мойка 14** — клубный дом в центре, ключи уже в 2026\n',
        '- **Лесной квартал** — самый бюджетный вход, студия от 8,6 млн\n\n',
        'Что важнее: срок сдачи или бюджет? Подберу точнее.',
      ]

  if (!knowledge) {
    await wait(500)
    send('tool', { name: 'search_apartments', input: { rooms: [1, 2, 3] } })
    await wait(900)
    send('apartments', { apartments: APARTMENTS })
  } else {
    await wait(500)
    send('tool', { name: 'search_knowledge', input: { query: message } })
    await wait(800)
  }

  for (const chunk of reply) {
    await wait(160)
    send('text', { text: chunk })
  }

  remember(sessionId, {
    role: 'assistant',
    content: reply.join(''),
    apartments: knowledge ? [] : APARTMENTS,
  })

  send('done', { reply: { failed: false, messageId: `m-${Date.now()}` } })
  response.end()
}

/**
 * `POST /api/lead` — проверки и тексты те же, что на сервере
 * (`services/leads/leads.service.ts` и `phone.ts`): виджет показывает `message`
 * как есть, и подменять его в демо на другой смысла нет.
 */
async function saveLead(request: Connect.IncomingMessage, response: import('node:http').ServerResponse) {
  const body = (await readJson(request)) as {
    sessionId?: string
    name?: string
    phone?: string
    comment?: string | null
    consent?: boolean
  }

  // Задержка, чтобы было видно «Отправляем…» и заблокированную кнопку.
  await new Promise((resolve) => setTimeout(resolve, 600))

  const name = (body.name ?? '').trim()

  if (name.toLowerCase() === 'сбой') {
    json(response, { error: 'internal_error' }, 500)
    return
  }

  if (body.consent !== true) {
    json(
      response,
      {
        error: 'consent_required',
        field: 'consent',
        message: 'Без согласия на обработку персональных данных мы не можем сохранить контакт — поставьте галочку.',
      },
      400,
    )
    return
  }

  if (name.length < 2) {
    json(
      response,
      { error: 'bad_name', field: 'name', message: 'Как к вам обращаться? Имя нужно из двух букв и длиннее.' },
      400,
    )
    return
  }

  let digits = (body.phone ?? '').replace(/\D/gu, '')
  if (digits.length === 11 && (digits.startsWith('8') || digits.startsWith('7'))) digits = digits.slice(1)
  if (digits.length !== 10) {
    json(
      response,
      { error: 'bad_phone', field: 'phone', message: 'Телефон не похож на номер. Формат: +7 (912) 345-67-89.' },
      400,
    )
    return
  }

  const sessionId = body.sessionId ?? 'demo'
  const existing = leads.get(sessionId)
  const lead: StoredLead = {
    id: existing?.id ?? `lead-${Date.now()}`,
    name,
    phone: `+7${digits}`,
    phoneFormatted: `+7 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8, 10)}`,
    comment: typeof body.comment === 'string' && body.comment.trim() !== '' ? body.comment.trim() : null,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  }
  leads.set(sessionId, lead)

  // eslint-disable-next-line no-console
  console.log(`[demo] лид ${existing ? 'обновлён' : 'сохранён'}: ${lead.name}, ${lead.phoneFormatted}`)
  json(response, { lead }, 201)
}

function remember(sessionId: string, message: Omit<StoredMessage, 'id' | 'createdAt'>): void {
  const list = history.get(sessionId) ?? []
  list.push({ ...message, id: `h-${list.length}`, createdAt: new Date().toISOString() })
  history.set(sessionId, list)
}

function json(response: import('node:http').ServerResponse, payload: unknown, status = 200): void {
  response.statusCode = status
  response.setHeader('content-type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload))
}

async function readJson(request: Connect.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of request) chunks.push(chunk as Buffer)
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'))
  } catch {
    return {}
  }
}
