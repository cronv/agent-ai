import { useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { useAuth } from '../auth/AuthProvider.js'
import { errorMessage } from '../lib/api.js'
import { Alert, Button, Field, IconEye, IconEyeOff, IconLock, LoadingBlock } from '../ui/index.js'

/**
 * Вход в админку.
 *
 * Логин и пароль задаются в `.env` (`ADMIN_USERNAME`, `ADMIN_PASSWORD`).
 * Ошибка входа намеренно не уточняет, что именно не сошлось, — иначе можно
 * перебором выяснить существующий логин.
 */

interface LocationState {
  from?: string
}

export function LoginPage(): ReactElement {
  const { status, login } = useAuth()
  const location = useLocation()

  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [submitting, setSubmitting] = useState(false)

  if (status === 'checking') {
    return (
      <div className="flex min-h-dvh items-center justify-center">
        <LoadingBlock label="Проверяю сессию…" />
      </div>
    )
  }

  if (status === 'authenticated') {
    const state = location.state as LocationState | null
    return <Navigate to={state?.from ?? '/'} replace />
  }

  const handleSubmit = async (event: FormEvent<HTMLFormElement>): Promise<void> => {
    event.preventDefault()
    setError(null)
    setSubmitting(true)
    try {
      await login(username.trim(), password)
    } catch (cause) {
      setError(errorMessage(cause))
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="flex min-h-dvh items-center justify-center bg-canvas px-4 py-10">
      <div className="w-full max-w-sm">
        <div className="mb-7 flex flex-col items-center gap-3 text-center">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-accent-soft text-accent">
            <IconLock className="size-5" />
          </span>
          <div>
            <h1 className="text-xl font-semibold tracking-tight text-ink">Админка</h1>
            <p className="mt-1 text-sm text-muted">AI-ассистент по новостройкам</p>
          </div>
        </div>

        <form
          onSubmit={(event) => void handleSubmit(event)}
          className="flex flex-col gap-4 rounded-2xl border border-line bg-surface p-6 shadow-card"
          noValidate
        >
          <Field
            label="Логин"
            name="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            autoComplete="username"
            autoFocus
            required
          />

          <div className="relative">
            <Field
              label="Пароль"
              name="password"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              autoComplete="current-password"
              required
              className="[&_input]:pr-11"
            />
            <button
              type="button"
              onClick={() => setShowPassword((value) => !value)}
              aria-label={showPassword ? 'Скрыть пароль' : 'Показать пароль'}
              className="absolute top-7 right-1 flex size-10 cursor-pointer items-center justify-center rounded-lg text-faint transition-colors duration-150 hover:text-muted"
            >
              {showPassword ? <IconEyeOff className="size-4.5" /> : <IconEye className="size-4.5" />}
            </button>
          </div>

          {error ? <Alert tone="danger">{error}</Alert> : null}

          <Button type="submit" fullWidth loading={submitting} disabled={!username || !password}>
            Войти
          </Button>
        </form>

        <p className="mt-4 text-center text-xs leading-relaxed text-faint">
          Логин и пароль задаются в файле <code className="rounded bg-surface px-1 py-0.5">.env</code>{' '}
          переменными <code className="rounded bg-surface px-1 py-0.5">ADMIN_USERNAME</code> и{' '}
          <code className="rounded bg-surface px-1 py-0.5">ADMIN_PASSWORD</code>.
        </p>
      </div>
    </div>
  )
}
