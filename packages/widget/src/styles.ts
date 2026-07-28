/**
 * Стили виджета одной строкой: они кладутся в <style> внутри Shadow DOM,
 * отдельного CSS-файла рядом с widget.js не появляется.
 *
 * ── Правила, которые здесь соблюдаются ─────────────────────────────────────
 *
 * 1. Шрифт — системный. Ни одного обращения наружу: чужой сайт не должен
 *    ждать наш шрифт, а виджет — прыгать, когда шрифт наконец приедет.
 * 2. Единственный цвет, который меняется из админки, — акцент. Он приходит
 *    переменными `--accent*` (см. `theme.ts`) и больше нигде не зашит.
 * 3. Всё остальное — светлый минимализм: белый фон, тонкие линии, воздух,
 *    мягкие тени. Цветом выделено ровно то, на что нужно нажать.
 * 4. Внутри Shadow DOM, но `:host` всё равно сбрасывается: наследуемые
 *    свойства страницы-хозяина (шрифт, межстрочный интервал) проходят сквозь
 *    границу тени.
 */

export const styles = `
:host {
  all: initial;
  display: block;
}

*, *::before, *::after { box-sizing: border-box; }

.root {
  --ink: #0E1116;
  --ink-2: #545C6B;
  --ink-3: #8A93A3;
  --line: #ECEEF2;
  --surface: #FFFFFF;
  --surface-2: #F6F7F9;
  --pad: 20px;
  --ease: cubic-bezier(.16, 1, .3, 1);
  --z: 2147483000;

  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  font-size: 15px;
  line-height: 1.55;
  font-weight: 400;
  color: var(--ink);
  text-align: left;
  direction: ltr;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-text-size-adjust: 100%;
}

.root button,
.root textarea,
.root a {
  font-family: inherit;
  font-size: inherit;
  line-height: inherit;
  color: inherit;
}

.root :focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

/* ── Кнопка в углу ────────────────────────────────────────── */

.launcher {
  position: fixed;
  right: 24px;
  bottom: 24px;
  z-index: var(--z);
  display: inline-flex;
  align-items: center;
  gap: 10px;
  height: 56px;
  padding: 0 22px 0 18px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-ink);
  font-size: 15px;
  font-weight: 600;
  letter-spacing: -0.01em;
  cursor: pointer;
  box-shadow: 0 14px 34px -10px rgba(var(--accent-rgb), .6), 0 2px 8px rgba(14, 17, 22, .12);
  transition: transform .22s var(--ease), box-shadow .22s var(--ease);
}
.launcher:hover { transform: translateY(-2px); box-shadow: 0 20px 42px -12px rgba(var(--accent-rgb), .65), 0 3px 10px rgba(14, 17, 22, .14); }
.launcher:active { transform: translateY(0); }
.launcher__icon { display: inline-flex; }
.launcher__label { white-space: nowrap; }

.launcher--open {
  width: 56px;
  padding: 0;
  justify-content: center;
  background: var(--surface);
  color: var(--ink-2);
  box-shadow: 0 12px 30px -10px rgba(14, 17, 22, .28), 0 0 0 1px var(--line);
}
.launcher--open:hover { box-shadow: 0 16px 36px -12px rgba(14, 17, 22, .32), 0 0 0 1px var(--line); }

/* ── Окно чата ────────────────────────────────────────────── */

.panel {
  position: fixed;
  right: 24px;
  bottom: 96px;
  z-index: var(--z);
  display: flex;
  flex-direction: column;
  width: 420px;
  max-width: calc(100vw - 32px);
  height: min(680px, calc(100vh - 140px));
  background: var(--surface);
  border-radius: 26px;
  box-shadow: 0 40px 90px -30px rgba(14, 17, 22, .38), 0 2px 10px rgba(14, 17, 22, .06), 0 0 0 1px rgba(14, 17, 22, .05);
  overflow: hidden;
  transform-origin: 100% 100%;
  animation: widget-in .28s var(--ease) both;
}
.panel--closing { animation: widget-out .16s ease-in both; }

@keyframes widget-in {
  from { opacity: 0; transform: translateY(14px) scale(.97); }
  to   { opacity: 1; transform: none; }
}
@keyframes widget-out {
  from { opacity: 1; transform: none; }
  to   { opacity: 0; transform: translateY(10px) scale(.98); }
}

.head {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 16px 16px 16px 18px;
  border-bottom: 1px solid var(--line);
  background: var(--surface);
}
.head__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 38px;
  height: 38px;
  flex: none;
  border-radius: 13px;
  background: rgba(var(--accent-rgb), .1);
  color: var(--accent);
}
.head__text { display: flex; flex-direction: column; min-width: 0; flex: 1; }
.head__title {
  font-size: 15.5px;
  font-weight: 600;
  letter-spacing: -0.015em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.head__status { font-size: 12.5px; line-height: 1.3; color: var(--ink-3); }

.iconbtn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  flex: none;
  border: 0;
  border-radius: 12px;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.iconbtn:hover { background: var(--surface-2); color: var(--ink); }

.body {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--pad);
  scrollbar-width: thin;
  scrollbar-color: #D9DDE4 transparent;
}
.body::-webkit-scrollbar { width: 8px; }
.body::-webkit-scrollbar-thumb { background: #DFE3E9; border-radius: 99px; border: 2px solid var(--surface); }

.feed { display: flex; flex-direction: column; gap: 18px; }

/* ── Сообщения ────────────────────────────────────────────── */

.msg { max-width: 100%; min-width: 0; }
.msg--bot { animation: fade-up .3s var(--ease) both; }
.msg--user {
  align-self: flex-end;
  max-width: 86%;
  padding: 11px 15px;
  border-radius: 18px 18px 6px 18px;
  background: var(--accent);
  color: var(--accent-ink);
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  animation: fade-up .24s var(--ease) both;
}
.msg__note { margin-top: 8px; font-size: 12.5px; color: var(--ink-3); }

@keyframes fade-up {
  from { opacity: 0; transform: translateY(6px); }
  to   { opacity: 1; transform: none; }
}

.rt-p { margin: 0 0 10px; overflow-wrap: anywhere; }
.rt-p:last-child { margin-bottom: 0; }
.rt-list { margin: 0 0 10px; padding-left: 20px; display: flex; flex-direction: column; gap: 6px; }
.rt-list:last-child { margin-bottom: 0; }
.rt-list li::marker { color: var(--ink-3); }

.rt-caret {
  display: inline-block;
  width: 2px;
  height: 1.05em;
  margin-left: 3px;
  border-radius: 2px;
  background: var(--accent);
  vertical-align: -2px;
  animation: caret 1s steps(2, start) infinite;
}
@keyframes caret { 0%, 100% { opacity: 1; } 50% { opacity: 0; } }

/* ── Примеры вопросов ─────────────────────────────────────── */

.examples { display: flex; flex-wrap: wrap; gap: 8px; }
.examples__hint { width: 100%; font-size: 12.5px; color: var(--ink-3); }
.chip {
  padding: 9px 14px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  font-size: 13.5px;
  color: var(--ink);
  text-align: left;
  cursor: pointer;
  transition: border-color .18s ease, background .18s ease, color .18s ease, transform .18s var(--ease);
}
.chip:hover {
  border-color: rgba(var(--accent-rgb), .5);
  background: rgba(var(--accent-rgb), .05);
  color: var(--accent-deep);
  transform: translateY(-1px);
}

/* ── «Печатает» ───────────────────────────────────────────── */

.thinking { display: flex; align-items: center; gap: 9px; color: var(--ink-3); font-size: 13.5px; }
.dots { display: inline-flex; gap: 4px; }
.dots i {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--accent);
  opacity: .35;
  animation: dot 1.1s ease-in-out infinite;
}
.dots i:nth-child(2) { animation-delay: .15s; }
.dots i:nth-child(3) { animation-delay: .3s; }
@keyframes dot {
  0%, 100% { opacity: .3; transform: translateY(0); }
  50% { opacity: 1; transform: translateY(-3px); }
}

/* ── Ошибка ───────────────────────────────────────────────── */

.alert {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  padding: 13px 14px;
  border: 1px solid #F3DED4;
  border-radius: 16px;
  background: #FFF8F5;
  color: #8A3A22;
  font-size: 13.5px;
  line-height: 1.45;
}
.alert span { flex: 1; min-width: 150px; }
.alert__retry {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 8px 13px;
  border: 1px solid #EBCBBD;
  border-radius: 11px;
  background: var(--surface);
  color: #8A3A22;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  transition: background .15s ease, border-color .15s ease;
}
.alert__retry:hover { background: #FFF1EA; border-color: #E0B6A4; }

/* ── Лента карточек ───────────────────────────────────────── */

.rail-wrap { margin-top: 14px; }
.rail {
  display: flex;
  gap: 12px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scroll-snap-type: x proximity;
  margin: 0 calc(var(--pad) * -1);
  padding: 2px var(--pad) 8px;
  scrollbar-width: none;
}
.rail::-webkit-scrollbar { display: none; }

.card {
  flex: 0 0 auto;
  width: 254px;
  scroll-snap-align: start;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border: 1px solid var(--line);
  border-radius: 20px;
  overflow: hidden;
  transition: transform .22s var(--ease), box-shadow .22s var(--ease), border-color .22s ease;
}
.card:hover {
  transform: translateY(-2px);
  border-color: rgba(var(--accent-rgb), .35);
  box-shadow: 0 18px 36px -20px rgba(14, 17, 22, .35);
}

.plan {
  position: relative;
  display: block;
  width: 100%;
  aspect-ratio: 4 / 3;
  border-bottom: 1px solid var(--line);
  background: var(--surface-2);
  overflow: hidden;
}
.plan__open {
  display: block;
  width: 100%;
  height: 100%;
  padding: 0;
  border: 0;
  background: none;
  cursor: zoom-in;
}
.plan__img {
  width: 100%;
  height: 100%;
  object-fit: contain;
  padding: 10px;
  opacity: 0;
  transition: opacity .35s ease;
}
/* Фотография заполняет кадр целиком: чертёж просят разглядывать,
   а снимок комнаты в рамке с полями выглядит как ошибка вёрстки. */
.plan__img--photo { object-fit: cover; padding: 0; }
.plan__img--ready { opacity: 1; }

/* Стрелки видны всегда: на телефоне наведения нет, а листать надо. */
.plan__nav {
  position: absolute;
  top: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  margin-top: -15px;
  padding: 0;
  border: 0;
  border-radius: 50%;
  background: rgba(255, 255, 255, .88);
  color: var(--ink-2);
  box-shadow: 0 2px 8px rgba(14, 17, 22, .16);
  cursor: pointer;
  transition: background .15s ease, transform .15s var(--ease);
}
.plan__nav:hover { background: #fff; }
.plan__nav:active { transform: scale(.94); }
.plan__nav--prev { left: 8px; }
.plan__nav--next { right: 8px; }
.plan__nav--next svg { transform: rotate(180deg); }

.plan__count {
  position: absolute;
  left: 8px;
  bottom: 8px;
  padding: 3px 8px;
  border-radius: 8px;
  background: rgba(14, 17, 22, .58);
  color: #fff;
  font-size: 11.5px;
  line-height: 1.35;
  font-variant-numeric: tabular-nums;
}

.plan__zoom {
  position: absolute;
  right: 8px;
  bottom: 8px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  border-radius: 10px;
  background: rgba(255, 255, 255, .92);
  color: var(--ink-2);
  box-shadow: 0 2px 8px rgba(14, 17, 22, .12);
  opacity: 0;
  transform: translateY(4px);
  transition: opacity .2s ease, transform .2s var(--ease);
}
.card:hover .plan__zoom, .plan__open:focus-visible + .plan__zoom { opacity: 1; transform: none; }

.plan--empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 8px;
  color: #B3BAC6;
  font-size: 12px;
  text-align: center;
  cursor: default;
}

.card__body { padding: 14px 14px 16px; display: flex; flex-direction: column; }
.card__price {
  font-size: 19px;
  font-weight: 650;
  letter-spacing: -0.02em;
  font-variant-numeric: tabular-nums;
}
.card__perm2 { margin-top: 2px; font-size: 12.5px; color: var(--ink-3); font-variant-numeric: tabular-nums; }
.card__title { margin-top: 10px; font-size: 14.5px; font-weight: 550; }
.card__project { margin-top: 3px; display: flex; flex-direction: column; font-size: 13px; color: var(--ink-2); }
.card__location { font-size: 12.5px; color: var(--ink-3); }
.card__tags { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 11px; }
.tag {
  padding: 4px 9px;
  border-radius: 8px;
  background: var(--surface-2);
  color: var(--ink-2);
  font-size: 11.5px;
  line-height: 1.35;
}
.card__link {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  height: 40px;
  margin-top: 14px;
  border-radius: 13px;
  background: rgba(var(--accent-rgb), .09);
  color: var(--accent-deep);
  font-size: 13.5px;
  font-weight: 600;
  text-decoration: none;
  transition: background .18s ease, color .18s ease;
}
.card__link:hover { background: var(--accent); color: var(--accent-ink); }

/* ── Планировка крупно ────────────────────────────────────── */

.viewer {
  position: fixed;
  inset: 0;
  z-index: calc(var(--z) + 2);
  display: flex;
  align-items: center;
  justify-content: center;
  padding: clamp(16px, 5vw, 56px);
  background: rgba(12, 14, 18, .68);
  backdrop-filter: blur(6px);
  -webkit-backdrop-filter: blur(6px);
  animation: fade .2s ease both;
}
@keyframes fade { from { opacity: 0; } to { opacity: 1; } }

.viewer__figure {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin: 0;
  padding: 16px;
  width: min(760px, 100%);
  max-height: 100%;
  border-radius: 22px;
  background: var(--surface);
  box-shadow: 0 30px 70px -25px rgba(0, 0, 0, .5);
  animation: widget-in .26s var(--ease) both;
}
.viewer__frame {
  position: relative;
  display: flex;
  flex: 1;
  min-height: 0;
}
.viewer__img {
  flex: 1;
  min-width: 0;
  min-height: 0;
  max-height: min(70vh, 620px);
  object-fit: contain;
  border-radius: 14px;
  background: var(--surface-2);
}
.viewer__caption { display: flex; flex-direction: column; gap: 2px; font-size: 13px; color: var(--ink-3); }
.viewer__caption b { font-size: 15px; font-weight: 600; color: var(--ink); }
.viewer__close {
  position: absolute;
  top: 14px;
  right: 14px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border: 0;
  border-radius: 12px;
  background: rgba(255, 255, 255, .92);
  color: var(--ink);
  cursor: pointer;
  transition: background .15s ease;
}
.viewer__close:hover { background: #fff; }

/* ── Форма контакта ───────────────────────────────────────── */

.lead {
  display: flex;
  flex-direction: column;
  padding: 16px;
  border: 1px solid rgba(var(--accent-rgb), .28);
  border-radius: 20px;
  background: var(--surface);
  box-shadow: 0 12px 30px -22px rgba(var(--accent-rgb), .9);
  animation: fade-up .3s var(--ease) both;
}
.lead__head { display: flex; align-items: center; gap: 8px; }
.lead__title { flex: 1; font-size: 15.5px; font-weight: 600; letter-spacing: -0.015em; }
.lead__hide {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: none;
  margin: -4px -4px -4px 0;
  border: 0;
  border-radius: 9px;
  background: transparent;
  color: var(--ink-3);
  cursor: pointer;
  transition: background .15s ease, color .15s ease;
}
.lead__hide:hover { background: var(--surface-2); color: var(--ink); }
.lead__hint { margin: 4px 0 0; font-size: 13px; line-height: 1.45; color: var(--ink-2); }

.lead__field { display: flex; flex-direction: column; gap: 5px; margin-top: 12px; }
.lead__label { font-size: 12.5px; color: var(--ink-3); }
.lead__input {
  width: 100%;
  height: 46px;
  padding: 0 14px;
  border: 1px solid var(--line);
  border-radius: 14px;
  background: var(--surface-2);
  /* 16px намеренно: на меньшем iOS зумит страницу при фокусе. */
  font-size: 16px;
  font-family: inherit;
  line-height: 1.4;
  color: var(--ink);
  outline: none;
  transition: background .18s ease, border-color .18s ease, box-shadow .18s ease;
}
.lead__input::placeholder { color: #A6ADB9; }
.lead__input:focus {
  background: var(--surface);
  border-color: rgba(var(--accent-rgb), .55);
  box-shadow: 0 0 0 4px rgba(var(--accent-rgb), .1);
}
.lead__input--bad { border-color: #E2B5A2; background: #FFF8F5; }
.lead__error { font-size: 12.5px; line-height: 1.4; color: #A8452A; }
.lead__error--wide { margin-top: 6px; }

.lead__consent {
  display: flex;
  align-items: flex-start;
  gap: 9px;
  margin-top: 14px;
  font-size: 12.5px;
  line-height: 1.45;
  color: var(--ink-2);
  cursor: pointer;
}
.lead__check {
  width: 18px;
  height: 18px;
  flex: none;
  margin: 1px 0 0;
  accent-color: var(--accent);
  cursor: pointer;
}
.lead__consent a { color: var(--ink-2); text-decoration: underline; text-underline-offset: 2px; }

.lead__fail {
  margin-top: 12px;
  padding: 10px 12px;
  border: 1px solid #F3DED4;
  border-radius: 13px;
  background: #FFF8F5;
  color: #8A3A22;
  font-size: 13px;
  line-height: 1.45;
}

.lead__submit {
  height: 46px;
  margin-top: 14px;
  border: 0;
  border-radius: 14px;
  background: var(--accent);
  color: var(--accent-ink);
  font-size: 14.5px;
  font-weight: 600;
  cursor: pointer;
  transition: transform .18s var(--ease), background .18s ease, box-shadow .18s ease;
}
.lead__submit:hover:not(:disabled) { transform: translateY(-1px); box-shadow: 0 12px 24px -14px rgba(var(--accent-rgb), .9); }
.lead__submit:disabled { background: #EDEFF3; color: #A9AFBB; cursor: default; }

.lead-done {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  padding: 14px 16px;
  border: 1px solid rgba(var(--accent-rgb), .22);
  border-radius: 20px;
  background: rgba(var(--accent-rgb), .06);
  animation: fade-up .3s var(--ease) both;
}
.lead-done__mark {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 30px;
  height: 30px;
  flex: none;
  border-radius: 50%;
  background: var(--accent);
  color: var(--accent-ink);
}
.lead-done__text { display: flex; flex-direction: column; gap: 2px; font-size: 13px; color: var(--ink-2); }
.lead-done__text b { font-size: 14.5px; font-weight: 600; color: var(--ink); }
.lead-done__edit {
  align-self: flex-start;
  margin-top: 6px;
  padding: 0;
  border: 0;
  background: transparent;
  color: var(--accent-deep);
  font-size: 13px;
  font-weight: 550;
  text-decoration: underline;
  text-underline-offset: 3px;
  cursor: pointer;
}

/* ── Поле ввода ───────────────────────────────────────────── */

.foot { padding: 12px 16px 14px; border-top: 1px solid var(--line); background: var(--surface); }

.foot__cta {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  margin: 0 0 9px;
  padding: 7px 13px;
  border: 1px solid var(--line);
  border-radius: 999px;
  background: var(--surface);
  color: var(--ink-2);
  font-size: 13px;
  font-weight: 550;
  cursor: pointer;
  transition: border-color .18s ease, background .18s ease, color .18s ease;
}
.foot__cta:hover {
  border-color: rgba(var(--accent-rgb), .5);
  background: rgba(var(--accent-rgb), .05);
  color: var(--accent-deep);
}

.composer {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  padding: 5px 5px 5px 14px;
  border: 1px solid transparent;
  border-radius: 20px;
  background: var(--surface-2);
  transition: background .18s ease, border-color .18s ease, box-shadow .18s ease;
}
.composer:focus-within {
  background: var(--surface);
  border-color: rgba(var(--accent-rgb), .45);
  box-shadow: 0 0 0 4px rgba(var(--accent-rgb), .1);
}
.composer__field {
  flex: 1;
  min-width: 0;
  max-height: 116px;
  padding: 10px 0;
  border: 0;
  background: transparent;
  font-size: 16px;
  line-height: 1.45;
  color: var(--ink);
  resize: none;
  outline: none;
}
.composer__field::placeholder { color: #98A0AE; }
.composer__send {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  flex: none;
  border: 0;
  border-radius: 14px;
  background: var(--accent);
  color: var(--accent-ink);
  cursor: pointer;
  transition: transform .18s var(--ease), background .18s ease, opacity .18s ease;
}
.composer__send:hover:not(:disabled) { transform: translateY(-1px); }
.composer__send:disabled { background: #E4E7EC; color: #A9AFBB; cursor: default; }

.foot__note { margin: 9px 4px 0; font-size: 11.5px; line-height: 1.4; color: var(--ink-3); }
.foot__note a { color: var(--ink-2); text-decoration: underline; text-underline-offset: 2px; }

/* ── Телефон ──────────────────────────────────────────────── */

@media (max-width: 560px) {
  .root { --pad: 16px; }

  .panel {
    top: 0;
    right: 0;
    bottom: auto;
    left: 0;
    width: 100%;
    max-width: none;
    /* Высоту и сдвиг задаёт visualViewport: иначе поле ввода уедет под клавиатуру. */
    height: 100dvh;
    border-radius: 0;
    box-shadow: none;
    transform-origin: 50% 100%;
  }
  .panel--closing { animation-duration: .14s; }

  .launcher { right: 16px; bottom: 16px; height: 54px; }
  .launcher--open { display: none; }

  .card { width: 232px; }
  .foot { padding: 10px 14px calc(10px + env(safe-area-inset-bottom, 0px)); }
}

@media (prefers-reduced-motion: reduce) {
  .root *, .root *::before, .root *::after {
    animation-duration: .01ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: .01ms !important;
  }
}
`
