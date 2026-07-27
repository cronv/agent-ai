import { useEffect, useState } from 'react'

/**
 * Заглушка админки.
 *
 * Полноценная админка — вход по паролю, боковое меню и разделы —
 * появляется в тикетах 10–13. Здесь достаточно рабочей сборки и
 * доказательства, что SPA подключена к API сервера.
 */

type HealthState = { status: string; db: string } | { error: string } | null

const SECTIONS = [
  'Дашборд',
  'ЖК',
  'Фиды',
  'База знаний',
  'Переписки',
  'Лиды',
  'Настройки',
] as const

export function App(): React.ReactElement {
  const [health, setHealth] = useState<HealthState>(null)

  useEffect(() => {
    fetch('/api/health')
      .then((response) => response.json())
      .then((data: { status: string; db: string }) => setHealth(data))
      .catch((error: unknown) => setHealth({ error: String(error) }))
  }, [])

  const alive = health !== null && 'status' in health && health.status === 'ok'

  return (
    <div className="min-h-full bg-white text-slate-900">
      <div className="mx-auto flex max-w-5xl flex-col gap-8 px-6 py-16">
        <header className="flex flex-col gap-2">
          <span
            className={`w-fit rounded-full px-3 py-1 text-xs ${
              alive ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}
          >
            {health === null
              ? 'проверяю сервер…'
              : alive
                ? 'сервер и база на связи'
                : 'сервер не отвечает'}
          </span>
          <h1 className="text-3xl font-semibold tracking-tight">Админка</h1>
          <p className="max-w-xl text-slate-500">
            Каркас готов. Разделы наполняются в следующих задачах — вход по паролю, ЖК, фиды,
            база знаний, переписки, лиды и настройки.
          </p>
        </header>

        <nav>
          <ul className="grid gap-px overflow-hidden rounded-xl bg-slate-200 sm:grid-cols-2 lg:grid-cols-4">
            {SECTIONS.map((section) => (
              <li key={section} className="bg-white px-4 py-5">
                <span className="text-sm font-medium">{section}</span>
                <span className="mt-1 block text-xs text-slate-400">скоро</span>
              </li>
            ))}
          </ul>
        </nav>

        <footer className="text-sm text-slate-400">
          Ответ <code className="rounded bg-slate-100 px-1 py-0.5">/api/health</code>:{' '}
          {health === null ? '…' : JSON.stringify(health)}
        </footer>
      </div>
    </div>
  )
}
