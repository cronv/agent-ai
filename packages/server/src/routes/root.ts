import type { FastifyPluginAsync } from 'fastify'

/**
 * GET /
 *
 * Стартовая страница: человек открывает адрес в браузере и сразу видит,
 * что сервис поднялся и куда идти дальше.
 */

const page = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>AI-ассистент по новостройкам</title>
<style>
  :root { color-scheme: light dark; }
  body {
    margin: 0; min-height: 100vh; display: grid; place-items: center;
    font: 16px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: #fff; color: #16181d;
  }
  main { max-width: 34rem; padding: 2rem; }
  h1 { font-size: 1.6rem; margin: 0 0 .5rem; letter-spacing: -0.02em; }
  p { margin: 0 0 1.5rem; color: #5c6270; }
  .badge { display: inline-block; font-size: .8rem; padding: .2rem .6rem; border-radius: 999px;
           background: #e8f5ec; color: #1c7a45; margin-bottom: 1rem; }
  ul { list-style: none; padding: 0; margin: 0; }
  li { padding: .6rem 0; border-top: 1px solid #ececf0; }
  a { color: #2F6BFF; text-decoration: none; }
  a:hover { text-decoration: underline; }
  code { background: #f4f4f7; padding: .1rem .35rem; border-radius: 4px; font-size: .9em; }
  @media (prefers-color-scheme: dark) {
    body { background: #101216; color: #eceef2; }
    p { color: #9aa1ae; }
    li { border-color: #23262d; }
    code { background: #1b1e24; }
    .badge { background: #12291c; color: #6fd39a; }
  }
</style>
</head>
<body>
<main>
  <span class="badge">сервис работает</span>
  <h1>AI-ассистент по новостройкам</h1>
  <p>Сервер запущен. Ниже — куда идти дальше.</p>
  <ul>
    <li><a href="/admin">Админка</a> — ЖК, фиды, база знаний, переписки, лиды, настройки</li>
    <li><a href="/api/health">/api/health</a> — состояние сервиса и базы данных</li>
    <li><a href="/widget.js">/widget.js</a> — файл виджета для вставки на сайт</li>
  </ul>
  <p style="margin-top:1.5rem">Вставка на сайт: <code>&lt;script src="/widget.js" defer&gt;&lt;/script&gt;</code></p>
</main>
</body>
</html>
`

const rootRoutes: FastifyPluginAsync = async (app) => {
  app.get('/', async (_request, reply) => reply.type('text/html; charset=utf-8').send(page))
}

export default rootRoutes
