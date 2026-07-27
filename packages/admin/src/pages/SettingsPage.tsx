import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import { api, errorMessage } from '../lib/api.js'
import { cx } from '../lib/cx.js'
import { plural } from '../lib/format.js'
import { useApiQuery } from '../lib/useApiQuery.js'
import {
  Alert,
  Button,
  Card,
  CardHeader,
  Field,
  IconCheck,
  IconCopy,
  IconRefresh,
  LoadingBlock,
  PageHeader,
} from '../ui/index.js'

/**
 * Раздел «Настройки».
 *
 * Здесь человек меняет характер ассистента, вид виджета и ключи доступа —
 * и забирает готовую строчку для вставки на сайт.
 *
 * Список полей не продублирован: он приходит с сервера вместе с подписями,
 * пояснениями и типами (`SETTING_DEFINITIONS`). Новая настройка появляется
 * на экране сама. Здесь заданы только заголовки разделов и особый вид
 * нескольких полей — цвета, секретов, длинного промпта.
 *
 * Секреты приходят маской: реальный ключ в браузер не уходит. Пока поле не
 * трогали, оно отправляется обратно маской — сервер понимает это как
 * «не менять».
 */

type SettingType = 'string' | 'text' | 'number' | 'boolean' | 'string[]'

interface SettingView {
  key: string
  value: unknown
  type: SettingType
  label: string
  description?: string
  group: string
  secret: boolean
  isSet: boolean
  isCustom: boolean
}

interface Install {
  scriptUrl: string
  snippet: string
}

interface SettingsPayload {
  settings: SettingView[]
  install: Install
  updated?: string[]
}

interface KeyCheckResult {
  ok: boolean
  message: string
  model: string
}

/** Заголовки разделов формы. Поля в них раскладывает сервер. */
const GROUPS: { id: string; title: string; description: string }[] = [
  {
    id: 'assistant',
    title: 'Ассистент',
    description: 'Как ассистент разговаривает с посетителем и когда просит контакт.',
  },
  {
    id: 'widget',
    title: 'Виджет на сайте',
    description: 'Что видит человек, открыв чат: заголовок, приветствие, цвет, подсказки.',
  },
  {
    id: 'integrations',
    title: 'Ключи и интеграции',
    description: 'Доступ к модели и передача лидов в вашу систему.',
  },
  {
    id: 'feeds',
    title: 'Обновление фидов',
    description: 'Как часто подтягиваются квартиры из выгрузок застройщиков.',
  },
]

const SECRET_MASK = '••••••••'

/** Значение поля в форме: строка для всего, кроме галочек. */
type DraftValue = string | boolean

export function SettingsPage(): ReactElement {
  const query = useApiQuery<SettingsPayload>('/settings')

  const [views, setViews] = useState<SettingView[]>([])
  const [install, setInstall] = useState<Install | null>(null)
  const [draft, setDraft] = useState<Record<string, DraftValue>>({})
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  useEffect(() => {
    if (!query.data) return
    setViews(query.data.settings)
    setInstall(query.data.install)
  }, [query.data])

  const changed = Object.keys(draft)
  const dirty = changed.length > 0

  function edit(key: string, value: DraftValue): void {
    setSaved(false)
    setDraft((current) => ({ ...current, [key]: value }))
  }

  function currentValue(view: SettingView): DraftValue {
    const drafted = draft[view.key]
    if (drafted !== undefined) return drafted
    return view.type === 'boolean' ? Boolean(view.value) : toInput(view.value)
  }

  async function save(): Promise<void> {
    setSaving(true)
    setSaveError(null)
    try {
      const payload = await api.put<SettingsPayload>('/settings', draft)
      setViews(payload.settings)
      setInstall(payload.install)
      setDraft({})
      setSaved(true)
    } catch (error) {
      setSaveError(humanize(errorMessage(error), views))
    } finally {
      setSaving(false)
    }
  }

  async function reset(key: string): Promise<void> {
    setSaveError(null)
    try {
      const payload = await api.post<SettingsPayload>(`/settings/${key}/reset`)
      setViews(payload.settings)
      setInstall(payload.install)
      setDraft((current) => {
        const next = { ...current }
        delete next[key]
        return next
      })
    } catch (error) {
      setSaveError(errorMessage(error))
    }
  }

  if (query.loading) {
    return (
      <>
        <PageHeader title="Настройки" description="Характер ассистента, вид виджета, ключи и вебхуки." />
        <Card>
          <LoadingBlock label="Загружаю настройки…" />
        </Card>
      </>
    )
  }

  const known = new Set(GROUPS.map((group) => group.id))
  const other = views.filter((view) => !known.has(view.group))

  return (
    <>
      <PageHeader
        title="Настройки"
        description="Меняются на лету: сохранили — ассистент отвечает по-новому уже со следующего сообщения."
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={query.reload}
            loading={query.refreshing}
            icon={<IconRefresh className="size-4" />}
          >
            Обновить
          </Button>
        }
      />

      {query.error ? (
        <Alert
          tone="danger"
          title="Не удалось загрузить настройки"
          action={
            <Button variant="secondary" size="sm" onClick={query.reload}>
              Повторить
            </Button>
          }
        >
          {errorMessage(query.error)}
        </Alert>
      ) : null}

      {saveError ? (
        <Alert tone="danger" title="Не сохранилось">
          {saveError}
        </Alert>
      ) : null}

      {saved && !dirty ? <Alert tone="ok">Сохранено. Новые настройки уже действуют.</Alert> : null}

      {GROUPS.map((group) => {
        const fields = views.filter((view) => view.group === group.id)
        if (fields.length === 0) return null
        return (
          <Card key={group.id}>
            <CardHeader title={group.title} description={group.description} />
            <div className="mt-5 flex flex-col gap-6">
              {fields.map((view) => (
                <SettingField
                  key={view.key}
                  view={view}
                  value={currentValue(view)}
                  touched={draft[view.key] !== undefined}
                  onChange={(value) => edit(view.key, value)}
                  onReset={() => void reset(view.key)}
                />
              ))}
              {group.id === 'integrations' ? <KeyCheck typedKey={typedSecret(draft)} /> : null}
            </div>
          </Card>
        )
      })}

      {other.length > 0 ? (
        <Card>
          <CardHeader title="Прочее" description="Настройки, добавленные позже." />
          <div className="mt-5 flex flex-col gap-6">
            {other.map((view) => (
              <SettingField
                key={view.key}
                view={view}
                value={currentValue(view)}
                touched={draft[view.key] !== undefined}
                onChange={(value) => edit(view.key, value)}
                onReset={() => void reset(view.key)}
              />
            ))}
          </div>
        </Card>
      ) : null}

      <InstallBlock
        install={install}
        widgetEnabled={boolValue(views, 'widget_enabled')}
        keyIsSet={views.find((view) => view.key === 'anthropic_api_key')?.isSet ?? false}
      />

      {/* Панель сохранения появляется только когда есть что сохранять —
          иначе она занимает низ экрана впустую. */}
      {dirty ? (
        <div className="sticky bottom-4 z-20 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-5 py-4 shadow-pop">
          <span className="text-sm text-muted">
            {changed.length} {plural(changed.length, ['изменение', 'изменения', 'изменений'])} не сохранено
          </span>
          <span className="flex gap-2">
            <Button variant="ghost" onClick={() => setDraft({})} disabled={saving}>
              Отменить
            </Button>
            <Button onClick={() => void save()} loading={saving}>
              Сохранить
            </Button>
          </span>
        </div>
      ) : null}
    </>
  )
}

/** Одно поле формы. Вид зависит от типа настройки, а не от её названия. */
function SettingField({
  view,
  value,
  touched,
  onChange,
  onReset,
}: {
  view: SettingView
  value: DraftValue
  touched: boolean
  onChange: (value: DraftValue) => void
  onReset: () => void
}): ReactElement {
  const resetLink =
    view.isCustom && !view.secret ? (
      <button
        type="button"
        onClick={onReset}
        className="cursor-pointer text-xs font-medium text-accent hover:text-accent-strong"
      >
        Вернуть значение по умолчанию
      </button>
    ) : null

  if (view.secret) {
    return <SecretField view={view} value={String(value)} touched={touched} onChange={onChange} />
  }

  if (view.type === 'boolean') {
    return (
      <Toggle
        label={view.label}
        description={view.description}
        checked={Boolean(value)}
        onChange={onChange}
      />
    )
  }

  if (view.key === 'widget_accent_color') {
    const color = String(value)
    return (
      <div className="flex flex-col gap-1.5">
        <span className="text-sm font-medium text-ink">{view.label}</span>
        <div className="flex items-center gap-3">
          <input
            type="color"
            aria-label={`${view.label}: выбор цвета`}
            value={/^#[0-9a-fA-F]{6}$/.test(color) ? color : '#2F6BFF'}
            onChange={(event) => onChange(event.target.value.toUpperCase())}
            className="size-11 cursor-pointer rounded-xl border border-line bg-surface p-1"
          />
          <input
            value={color}
            onChange={(event) => onChange(event.target.value)}
            spellCheck={false}
            className="w-32 rounded-xl border border-line bg-surface px-3.5 py-2.5 font-mono text-sm text-ink uppercase transition-colors duration-150 hover:border-faint"
          />
          <span
            className="hidden rounded-xl px-4 py-2.5 text-sm font-medium text-white sm:inline-block"
            style={{ backgroundColor: /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#2F6BFF' }}
          >
            Так выглядит кнопка
          </span>
        </div>
        {view.description ? <p className="text-xs leading-relaxed text-muted">{view.description}</p> : null}
        {resetLink}
      </div>
    )
  }

  if (view.type === 'string[]') {
    return (
      <div className="flex flex-col gap-1.5">
        <Field
          multiline
          rows={5}
          label={view.label}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          hint={`${view.description ?? ''} По одному пункту в строке.`.trim()}
        />
        {resetLink}
      </div>
    )
  }

  if (view.type === 'text') {
    const long = view.key === 'system_prompt'
    return (
      <div className="flex flex-col gap-1.5">
        <Field
          multiline
          rows={long ? 16 : 4}
          label={view.label}
          value={String(value)}
          onChange={(event) => onChange(event.target.value)}
          className={long ? '[&_textarea]:font-mono [&_textarea]:leading-relaxed' : undefined}
          hint={
            long
              ? 'Это инструкция, которую ассистент читает перед каждым ответом: тон разговора, правила, что нельзя выдумывать. Пишите обычными фразами, по пунктам — так же, как объясняли бы новому менеджеру в первый день.'
              : view.description
          }
        />
        {resetLink}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Field
        label={view.label}
        type={view.type === 'number' ? 'number' : 'text'}
        inputMode={view.type === 'number' ? 'numeric' : undefined}
        value={String(value)}
        onChange={(event) => onChange(event.target.value)}
        hint={view.description}
        className={view.type === 'number' ? 'max-w-40' : 'max-w-xl'}
      />
      {resetLink}
    </div>
  )
}

/**
 * Секрет: наружу ушла маска, поэтому исходное значение показать нельзя.
 * Пока не нажали «Заменить», поле не редактируется и уходит на сервер маской.
 */
function SecretField({
  view,
  value,
  touched,
  onChange,
}: {
  view: SettingView
  value: string
  touched: boolean
  onChange: (value: DraftValue) => void
}): ReactElement {
  const editing = touched || !view.isSet

  return (
    <div className="flex max-w-xl flex-col gap-1.5">
      <Field
        label={view.label}
        value={editing ? (value === SECRET_MASK ? '' : value) : SECRET_MASK}
        readOnly={!editing}
        spellCheck={false}
        autoComplete="off"
        placeholder={view.key === 'anthropic_api_key' ? 'sk-ant-…' : 'https://…'}
        onChange={(event) => onChange(event.target.value)}
        hint={
          view.isSet && !editing
            ? `${view.description ?? ''} Значение сохранено и скрыто.`.trim()
            : view.description
        }
      />
      {view.isSet ? (
        <button
          type="button"
          onClick={() => onChange(editing ? SECRET_MASK : '')}
          className="self-start cursor-pointer text-xs font-medium text-accent hover:text-accent-strong"
        >
          {editing ? 'Оставить прежнее значение' : 'Заменить'}
        </button>
      ) : null}
    </div>
  )
}

/** Кнопка проверки ключа: делает пробный запрос и отвечает по-человечески. */
function KeyCheck({ typedKey }: { typedKey: string | null }): ReactElement {
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<KeyCheckResult | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  async function check(): Promise<void> {
    setChecking(true)
    setFailure(null)
    setResult(null)
    try {
      const body = typedKey !== null && typedKey !== '' ? { apiKey: typedKey } : {}
      setResult(await api.post<KeyCheckResult>('/settings/check-key', body))
    } catch (error) {
      setFailure(errorMessage(error))
    } finally {
      setChecking(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-canvas p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Не уверены, что ключ рабочий? Отправим один короткий запрос к Claude и скажем, что ответили.
        </p>
        <Button variant="secondary" size="sm" onClick={() => void check()} loading={checking}>
          Проверить ключ
        </Button>
      </div>
      {failure ? <Alert tone="danger">{failure}</Alert> : null}
      {result ? <Alert tone={result.ok ? 'ok' : 'danger'}>{result.message}</Alert> : null}
    </div>
  )
}

/** Блок «Установка на сайт»: готовая строчка и кнопка копирования. */
function InstallBlock({
  install,
  widgetEnabled,
  keyIsSet,
}: {
  install: Install | null
  widgetEnabled: boolean
  keyIsSet: boolean
}): ReactElement | null {
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  if (!install) return null

  async function copy(): Promise<void> {
    if (!install) return
    try {
      await navigator.clipboard.writeText(install.snippet)
      setCopied(true)
      setCopyFailed(false)
      setTimeout(() => setCopied(false), 2500)
    } catch {
      setCopyFailed(true)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Установка на сайт"
        description="Одна строчка на всех страницах — и чат появится в правом нижнем углу."
      />

      <ol className="mt-4 flex flex-col gap-2.5 text-sm text-muted">
        <li className="flex gap-3">
          <Step n={1} />
          <span>Скопируйте строчку ниже.</span>
        </li>
        <li className="flex gap-3">
          <Step n={2} />
          <span>
            Вставьте её в код сайта перед закрывающим тегом <code className="text-ink">&lt;/body&gt;</code> — в
            конструкторах это поле «Свой код» или «Скрипты в подвале».
          </span>
        </li>
        <li className="flex gap-3">
          <Step n={3} />
          <span>Обновите страницу сайта. Чат должен появиться сразу, менять код больше не понадобится.</span>
        </li>
      </ol>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center">
        <code className="min-w-0 flex-1 overflow-x-auto rounded-xl border border-line bg-canvas px-4 py-3 font-mono text-xs whitespace-nowrap text-ink">
          {install.snippet}
        </code>
        <Button
          variant={copied ? 'secondary' : 'primary'}
          onClick={() => void copy()}
          icon={copied ? <IconCheck className="size-4" /> : <IconCopy className="size-4" />}
        >
          {copied ? 'Скопировано' : 'Скопировать'}
        </Button>
      </div>

      {copyFailed ? (
        <p className="mt-2 text-xs text-danger">
          Браузер не дал скопировать автоматически — выделите строчку и нажмите Ctrl+C.
        </p>
      ) : null}

      <div className="mt-4 flex flex-col gap-3">
        {!widgetEnabled ? (
          <Alert tone="warn" title="Виджет сейчас выключен">
            Строчка уже стоит на сайте, но чат не показывается. Включите переключатель «Виджет включён» в разделе
            «Виджет на сайте».
          </Alert>
        ) : null}
        {!keyIsSet ? (
          <Alert tone="warn" title="Ключ Claude не задан">
            Чат появится на сайте, но отвечать не сможет. Вставьте ключ в разделе «Ключи и интеграции».
          </Alert>
        ) : null}
      </div>
    </Card>
  )
}

function Step({ n }: { n: number }): ReactElement {
  return (
    <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-canvas text-xs font-medium text-muted">
      {n}
    </span>
  )
}

/** Переключатель «да/нет» — понятнее галочки и попадает пальцем. */
function Toggle({
  label,
  description,
  checked,
  onChange,
}: {
  label: string
  description?: string
  checked: boolean
  onChange: (value: boolean) => void
}): ReactElement {
  return (
    <label className="flex cursor-pointer items-start gap-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="peer sr-only"
      />
      <span
        aria-hidden="true"
        className={cx(
          'mt-0.5 flex h-6 w-11 shrink-0 items-center rounded-full p-0.5 transition-colors duration-150',
          'peer-focus-visible:outline peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-accent',
          checked ? 'bg-accent' : 'bg-line',
        )}
      >
        <span
          className={cx(
            'size-5 rounded-full bg-surface shadow-card transition-transform duration-150',
            checked ? 'translate-x-5' : 'translate-x-0',
          )}
        />
      </span>
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink">{label}</span>
        {description ? <span className="mt-0.5 block text-xs leading-relaxed text-muted">{description}</span> : null}
      </span>
    </label>
  )
}

/** Значение настройки в том виде, в каком его показывает поле ввода. */
function toInput(value: unknown): string {
  if (Array.isArray(value)) return value.join('\n')
  if (typeof value === 'number') return String(value)
  if (typeof value === 'string') return value
  return ''
}

/**
 * Ошибка сохранения приходит с машинным именем ключа («contact_request_threshold»).
 * Меняем его на подпись поля — человек ищет глазами именно её.
 */
function humanize(message: string, views: SettingView[]): string {
  return views.reduce((text, view) => text.split(view.key).join(`«${view.label}»`), message)
}

function boolValue(views: SettingView[], key: string): boolean {
  const view = views.find((item) => item.key === key)
  return view === undefined ? true : Boolean(view.value)
}

/** Ключ, который человек только что напечатал, — его и проверяем. */
function typedSecret(draft: Record<string, DraftValue>): string | null {
  const value = draft['anthropic_api_key']
  return typeof value === 'string' && value !== SECRET_MASK ? value : null
}
