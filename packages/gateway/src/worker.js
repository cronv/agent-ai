/**
 * Шлюз к Claude на Cloudflare Workers.
 *
 * Зачем он нужен. Anthropic обслуживает не все страны, и России в их списке
 * нет: запрос с российского адреса получает 403 ещё до проверки ключа.
 * Приложение при этом должно остаться в России — в базе лежат телефоны и
 * переписки клиентов, а это персональные данные. Шлюз разводит две вещи:
 * данные хранятся в РФ, наружу уходит только сам вопрос к модели.
 *
 * Почему Worker, а не арендованный сервер: нечего администрировать и нечему
 * падать. Cloudflare сам держит его живым, бесплатного тарифа хватает с
 * большим запасом (100 000 запросов в сутки против сотен у нас).
 *
 * Файл написан обычным JavaScript и без единой зависимости — его можно
 * целиком вставить в редактор на сайте Cloudflare, не устанавливая ничего
 * на компьютер. Инструкция — в README.md рядом.
 */

/** Куда проксируем. Единственный адрес, с которым шлюз вообще разговаривает. */
const UPSTREAM = 'https://api.anthropic.com'

/**
 * Заголовки, которые дальше не идут.
 *
 * `host` подставит fetch сам, иначе Anthropic получит имя воркера и не узнает
 * собственный домен. `content-length` пересчитается по факту. Заголовки `cf-*`
 * Cloudflare добавляет от себя — среди них IP посетителя и его страна;
 * Anthropic они не нужны, а лишние данные лучше не пересылать.
 */
const DROPPED_HEADERS = new Set(['host', 'content-length'])

/**
 * Ответ, который читается человеком в браузере, а не только программой.
 *
 * @param {number} status
 * @param {Record<string, string>} body
 */
function json(status, body) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
    },
  })
}

/**
 * Самопроверка: отсюда Anthropic отвечает или отказывает?
 *
 * Проверяем не по стране адреса, а прямым запросом — с заведомо негодным
 * ключом. Ответ различает ровно то, что нужно:
 *   401 — регион обслуживается, ключ просто выдуман. Шлюз годится.
 *   403 — отказ по региону. Такой шлюз не поможет, где бы он ни стоял.
 * Гадание по стране IP тут не работает: адреса Cloudflare разбросаны по
 * миру и с географией запроса совпадают не всегда.
 *
 * @param {typeof fetch} fetchImpl
 */
async function selfTest(fetchImpl) {
  let status = 0
  let detail = ''
  try {
    const probe = await fetchImpl(`${UPSTREAM}/v1/messages`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': 'sk-ant-api03-gateway-self-test',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'ping' }],
      }),
    })
    status = probe.status
    detail = (await probe.text()).slice(0, 300)
  } catch (error) {
    return json(502, {
      итог: 'Не получилось достучаться до Anthropic',
      подробности: error instanceof Error ? error.message : String(error),
    })
  }

  if (status === 403) {
    return json(200, {
      итог: 'НЕ РАБОТАЕТ — Anthropic отказывает и через этот шлюз',
      чтоДальше:
        'Включите Smart Placement в настройках воркера (Settings → Placement) и проверьте снова. Если не помогло — нужен шлюз в другом месте, Cloudflare тут не подходит.',
      ответAnthropic: detail,
    })
  }

  // 401 — ждали именно его: ключ выдуман, а вот регион приняли.
  if (status === 401) {
    return json(200, {
      итог: 'РАБОТАЕТ — Anthropic принимает запросы через этот шлюз',
      чтоДальше:
        'Скопируйте адрес этой страницы без «/whoami» на конце и вставьте его в админке в поле «Адрес доступа к Claude».',
    })
  }

  return json(200, {
    итог: `Неожиданный ответ Anthropic: ${status}`,
    чтоДальше: 'Отказа по региону нет — скорее всего, шлюз годится. Проверьте кнопкой «Проверить ключ» в админке.',
    ответAnthropic: detail,
  })
}

/**
 * Разбирает адрес запроса: отделяет секретный кусок пути от того, что
 * нужно передать в Anthropic.
 *
 * Секрет живёт в пути, а не в отдельном заголовке, по одной причине: SDK
 * Anthropic не умеет добавлять свои заголовки, зато адрес принимает любой.
 * Без секрета воркер стал бы открытым ретранслятором — его нашли бы и
 * гоняли через него чужой трафик за наш счёт.
 *
 * @param {string} pathname
 * @param {string} token
 * @returns {string | null} путь для Anthropic либо null, если секрет не сошёлся
 */
export function routeFor(pathname, token) {
  const prefix = `/${token}`
  if (pathname === prefix) return '/'
  if (!pathname.startsWith(`${prefix}/`)) return null
  return pathname.slice(prefix.length)
}

/**
 * Готовит заголовки для Anthropic: всё своё оставляем, чужое и служебное
 * убираем.
 *
 * @param {Headers} incoming
 */
export function forwardedHeaders(incoming) {
  const headers = new Headers()
  for (const [name, value] of incoming) {
    const key = name.toLowerCase()
    if (DROPPED_HEADERS.has(key)) continue
    if (key.startsWith('cf-')) continue
    headers.set(name, value)
  }
  return headers
}

/**
 * Вся логика шлюза. Вынесена из `fetch` отдельной функцией, чтобы её можно
 * было проверить тестами, не поднимая Cloudflare.
 *
 * @param {Request} request
 * @param {{ GATEWAY_TOKEN?: string }} env
 * @param {typeof fetch} fetchImpl
 */
export async function handle(request, env, fetchImpl) {
  const token = (env.GATEWAY_TOKEN ?? '').trim()
  // Без секрета шлюз отказывается работать вовсе. Открыться «на время
  // настройки» он не должен: такой ретранслятор находят перебором за часы.
  if (token === '') {
    return json(500, {
      итог: 'Шлюз не настроен',
      чтоДальше:
        'В настройках воркера (Settings → Variables and Secrets) добавьте переменную GATEWAY_TOKEN с длинным случайным значением.',
    })
  }

  const url = new URL(request.url)
  const path = routeFor(url.pathname, token)
  if (path === null) {
    // Специально без подробностей: тому, кто подбирает адрес, знать не о чем.
    return json(404, { итог: 'Не найдено' })
  }

  if (path === '/whoami') return selfTest(fetchImpl)

  const upstream = `${UPSTREAM}${path}${url.search}`
  const hasBody = request.method !== 'GET' && request.method !== 'HEAD'

  let response
  try {
    response = await fetchImpl(upstream, {
      method: request.method,
      headers: forwardedHeaders(request.headers),
      ...(hasBody ? { body: request.body } : {}),
      redirect: 'manual',
    })
  } catch (error) {
    return json(502, {
      итог: 'Шлюз не смог связаться с Anthropic',
      подробности: error instanceof Error ? error.message : String(error),
    })
  }

  // Тело отдаём потоком, как получили: чат печатается по мере ответа модели,
  // и накапливать его целиком означало бы убрать эту «живость».
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  })
}

export default {
  /**
   * @param {Request} request
   * @param {{ GATEWAY_TOKEN?: string }} env
   */
  fetch(request, env) {
    return handle(request, env, fetch)
  },
}
