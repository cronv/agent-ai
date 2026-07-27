import { render } from 'preact'

import { App } from './App.tsx'
import { styles } from './styles.ts'

/**
 * Точка входа виджета.
 *
 * На сайт добавляется одна строчка:
 *
 *   <script src="https://ai.example.ru/widget.js" defer></script>
 *
 * Больше от владельца сайта ничего не требуется: контейнер создаётся сам,
 * вёрстку страницы виджет не трогает.
 *
 * ── Почему Shadow DOM ──────────────────────────────────────────────────────
 *
 * Виджет живёт на чужом сайте, где может быть что угодно: свой сброс полей,
 * `* { box-sizing: content-box }`, `button { text-transform: uppercase }`.
 * В теневом дереве эти правила до виджета не дотягиваются, а наши стили не
 * портят сайт.
 *
 * ── Откуда берётся адрес сервера ───────────────────────────────────────────
 *
 * Из `src` самого скрипта. Ключей и атрибутов не нужно: файл отдаёт тот же
 * сервер, что и API, — значит, адрес уже известен из того, откуда пришёл файл.
 */

const MOUNT_ID = 'novostroyki-ai-widget'

function detectApiBase(): string {
  const current = document.currentScript as HTMLScriptElement | null
  const src = current?.src ?? findWidgetScriptSrc()
  if (!src) return window.location.origin
  try {
    return new URL(src, window.location.href).origin
  } catch {
    return window.location.origin
  }
}

function findWidgetScriptSrc(): string | null {
  const scripts = Array.from(document.getElementsByTagName('script'))
  const match = scripts.find((script) => script.src.includes('widget.js'))
  return match?.src ?? null
}

/** Считается сразу: `document.currentScript` доступен только во время загрузки. */
const apiBase = detectApiBase()

function mount(): void {
  if (document.getElementById(MOUNT_ID)) return

  const host = document.createElement('div')
  host.id = MOUNT_ID
  document.body.appendChild(host)

  const shadow = host.attachShadow({ mode: 'open' })
  const styleTag = document.createElement('style')
  styleTag.textContent = styles
  shadow.appendChild(styleTag)

  const root = document.createElement('div')
  shadow.appendChild(root)

  render(<App apiBase={apiBase} />, root)
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', mount, { once: true })
} else {
  mount()
}

declare global {
  interface Window {
    NovostroykiWidget?: { mount: () => void; apiBase: string }
  }
}

window.NovostroykiWidget = { mount, apiBase }

export { mount }
