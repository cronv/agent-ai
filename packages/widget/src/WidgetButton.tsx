import { useState } from 'preact/hooks'

/**
 * Кнопка-заглушка в углу сайта. В тикете 08 на её месте появляется
 * полноценное окно чата.
 */

interface WidgetButtonProps {
  apiBase: string
}

export function WidgetButton({ apiBase }: WidgetButtonProps) {
  const [open, setOpen] = useState(false)

  return (
    <>
      {open && (
        <div class="note" role="status">
          Чат подключается. Каркас виджета собран и работает
          {apiBase ? `, сервер: ${apiBase}` : ''}.
        </div>
      )}
      <button
        class="launcher"
        type="button"
        aria-label="Открыть чат подбора квартир"
        onClick={() => setOpen((value) => !value)}
      >
        Подобрать квартиру
      </button>
    </>
  )
}
