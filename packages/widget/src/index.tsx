import { render } from 'preact'

import { WidgetButton } from './WidgetButton.tsx'
import { styles } from './styles.ts'

/**
 * Точка входа виджета.
 *
 * Заглушка: рисует кнопку в углу страницы внутри Shadow DOM. Настоящий чат —
 * лента сообщений, карточки квартир, стриминг ответа и форма контакта —
 * появляется в тикетах 08 и 09.
 *
 * Shadow DOM используется с самого начала осознанно: стили сайта не протекают
 * внутрь виджета, а стили виджета не ломают вёрстку сайта.
 */

const MOUNT_ID = 'novostroyki-ai-widget'

/** Адрес сервера берётся из src подключённого <script>. */
function detectApiBase(): string {
  const current = document.currentScript as HTMLScriptElement | null
  const src = current?.src ?? findWidgetScriptSrc()
  if (!src) return ''
  try {
    return new URL(src, window.location.href).origin
  } catch {
    return ''
  }
}

function findWidgetScriptSrc(): string | null {
  const scripts = Array.from(document.getElementsByTagName('script'))
  const match = scripts.find((script) => script.src.includes('widget.js'))
  return match?.src ?? null
}

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

  render(<WidgetButton apiBase={detectApiBase()} />, root)
}

const apiBase = detectApiBase()

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
