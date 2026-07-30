/**
 * Тестовая страница виджета — витрина агентства, на которой видно, как чат
 * смотрится в бою.
 *
 * Живёт в коде, а не файлом на диске, ровно по одной причине: страницу,
 * отданную отдельным веб-сервером, приходилось поднимать заново после каждого
 * сна ноутбука. Здесь она поднимается вместе с приложением.
 *
 * Виджет подключается относительным адресом — страница и `/widget.js` на одном
 * origin, кросс-доменные тонкости в проверке внешнего вида не участвуют.
 * Кросс-доменное подключение проверяется отдельно, тестом.
 */

export const PREVIEW_PAGE = `<!doctype html>
<html lang="ru">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>NDV.RU — тестовая страница виджета</title>
<style>
  * { box-sizing: border-box; }
  body { margin:0; font:16px/1.6 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif; color:#1a1a1a; background:#fff; }
  header { border-bottom:1px solid #eee; padding:18px 32px; display:flex; align-items:center; gap:14px; position:sticky; top:0; background:#fff; z-index:5; }
  .logo { background:#E52A2E; color:#fff; font-weight:800; letter-spacing:.5px; padding:8px 12px; border-radius:12px; font-size:18px; }
  .logo span { background:#fff; color:#333; padding:2px 8px; border-radius:8px; margin-left:6px; }
  nav { margin-left:auto; display:flex; gap:26px; color:#555; font-size:15px; }
  nav a { color:inherit; text-decoration:none; }
  .hero { padding:72px 32px 56px; max-width:1080px; margin:0 auto; }
  h1 { font-size:44px; line-height:1.15; margin:0 0 16px; letter-spacing:-.5px; }
  .lead { font-size:19px; color:#555; max-width:660px; margin:0 0 32px; }
  .stats { display:flex; gap:56px; flex-wrap:wrap; padding:28px 0; border-top:1px solid #eee; border-bottom:1px solid #eee; }
  .stat b { display:block; font-size:30px; color:#E52A2E; }
  .stat span { color:#777; font-size:14px; }
  .grid { max-width:1080px; margin:56px auto; padding:0 32px; display:grid; grid-template-columns:repeat(auto-fill,minmax(240px,1fr)); gap:22px; }
  .card { border:1px solid #eee; border-radius:16px; padding:20px; }
  .card b { display:block; margin-bottom:6px; }
  .card small { color:#777; }
  .note { max-width:1080px; margin:0 auto 96px; padding:24px 32px; background:#fff7f7; border:1px solid #f3d5d6; border-radius:16px; }
  .note h2 { margin:0 0 10px; font-size:17px; }
  .note ul { margin:0; padding-left:20px; color:#444; }
  .note li { margin:7px 0; }
  code { background:#fff; border:1px solid #eee; border-radius:6px; padding:2px 6px; font-size:14px; }
</style>
</head>
<body>

<header>
  <div class="logo">NDV<span>RU</span></div>
  <nav><a href="#">Новостройки</a><a href="#">Ипотека</a><a href="#">Компания</a><a href="/admin">Админка</a></nav>
</header>

<section class="hero">
  <h1>Новостройки Подмосковья<br>от Супермаркета недвижимости</h1>
  <p class="lead">Тестовая страница. Виджет в правом нижнем углу подключён к боевой базе: настоящие квартиры, настоящие планировки, настоящая модель.</p>
  <div class="stats">
    <div class="stat"><b>997</b><span>квартир в продаже</span></div>
    <div class="stat"><b>7</b><span>жилых комплексов</span></div>
    <div class="stat"><b>от 4,4 млн</b><span>цена входа</span></div>
    <div class="stat"><b>2025—2027</b><span>сроки сдачи</span></div>
  </div>
</section>

<section class="grid">
  <div class="card"><b>ЖК «Космос»</b><small>Домодедово · 383 квартиры<br>4,7—16,0 млн ₽ · сдан</small></div>
  <div class="card"><b>ЖК «Серебро»</b><small>Пушкинский · 220 квартир<br>4,7—12,7 млн ₽ · сдан</small></div>
  <div class="card"><b>ЖК «Берег»</b><small>Химки · 158 квартир<br>6,4—12,6 млн ₽ · 2027</small></div>
  <div class="card"><b>ЖК «Красная горка»</b><small>Подольск · 94 квартиры<br>4,4—11,3 млн ₽ · 2026</small></div>
  <div class="card"><b>ЖК «Школьный»</b><small>Подольск · 82 квартиры<br>5,2—9,1 млн ₽ · сдан</small></div>
  <div class="card"><b>ЖК «Восточный»</b><small>Звенигород · 35 квартир<br>5,0—5,9 млн ₽ · сдан</small></div>
  <div class="card"><b>ЖК «Мишино-2»</b><small>Химки · 25 квартир<br>6,8—20,6 млн ₽ · 2027</small></div>
</section>

<section class="note">
  <h2>Что стоит попробовать</h2>
  <ul>
    <li><code>Студия в Домодедово до 5 млн</code> — подборка приходит сразу, в первом ответе</li>
    <li><code>где жк школьный</code> — адрес и окружение из карточки объекта в базе знаний</li>
    <li>Под ответом — <b>кнопки быстрых ответов</b>. Нажми одну, потом напиши своё: работать должны оба пути</li>
    <li>На карточке квартиры — кнопка <b>«Выбрать»</b>. Без контакта откроется форма, с контактом уйдёт менеджеру сразу</li>
    <li>Клик по планировке открывает её крупно, там же кнопка <b>«Подробнее о ЖК»</b></li>
    <li><code>А какая ипотека и ставка?</code> — цифры только из загруженных документов, наугад не называет</li>
    <li><code>Что есть в Мытищах?</code> — честно скажет, что такой локации нет</li>
    <li>Сузь окно до ширины телефона — чат развернётся на весь экран</li>
    <li>Начать с чистого листа: консоль браузера, <code>localStorage.clear(); location.reload()</code></li>
  </ul>
</section>

<script src="/widget.js" defer></script>
</body>
</html>
`
