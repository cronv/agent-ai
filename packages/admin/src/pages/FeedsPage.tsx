import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import { ApiError, api, errorMessage } from '../lib/api.js'
import { cx } from '../lib/cx.js'
import { formatDateTime, formatNumber, formatRelative, pluralize } from '../lib/format.js'
import { useApiQuery } from '../lib/useApiQuery.js'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  ConfirmDialog,
  EmptyState,
  Field,
  IconAlert,
  IconCheck,
  IconClock,
  IconExternal,
  IconFeeds,
  IconPencil,
  IconPlus,
  IconRefresh,
  IconTrash,
  LoadingBlock,
  Modal,
  PageHeader,
  Select,
  Toggle,
} from '../ui/index.js'

/**
 * Раздел «Фиды» — выгрузки застройщиков.
 *
 * Главное здесь — честность. Если фид не скачался или в нём не тот формат,
 * человек видит полный текст ошибки, а не «что-то пошло не так»: только по
 * тексту понятно, чинить ссылку, просить у застройщика доступ или править
 * соответствие полей. По той же причине результат ручного обновления
 * показывается разбором — добавлено, обновлено, снято с продажи, пропущено.
 */

type FeedFormat = 'yandex' | 'cian' | 'custom'

interface FeedView {
  id: string
  name: string
  url: string
  format: FeedFormat
  fieldMapping: unknown
  scheduleCron: string | null
  isActive: boolean
  lastRunAt: string | null
  lastStatus: 'ok' | 'error' | 'running' | null
  lastError: string | null
  lastCount: number | null
  isSyncing: boolean
  apartments: { active: number; total: number }
}

interface SchedulerState {
  started: boolean
  enabled: boolean
  cron: string | null
}

interface FeedsResponse {
  feeds: FeedView[]
  syncing: string[]
  scheduler: SchedulerState
}

interface FeedsMeta {
  formats: FeedFormat[]
  fields: string[]
  defaultCron: string
}

interface SyncResult {
  status: 'ok' | 'error'
  total: number
  created: number
  updated: number
  deactivated: number
  skipped: number
  projectsCreated: number
  activeCount: number
  error: string | null
  warnings: string[]
  durationMs: number
}

/** Что показать под фидом после нажатия «Обновить сейчас». */
type SyncOutcome =
  | { kind: 'result'; result: SyncResult }
  | { kind: 'busy'; message: string }
  | { kind: 'failed'; message: string }

const FORMAT_LABELS: Record<FeedFormat, string> = {
  yandex: 'Яндекс.Недвижимость',
  cian: 'ЦИАН',
  custom: 'свой формат',
}

export function FeedsPage(): ReactElement {
  const { data, error, loading, refreshing, reload } = useApiQuery<FeedsResponse>('/feeds')
  const meta = useApiQuery<FeedsMeta>('/feeds/meta')

  const [editing, setEditing] = useState<FeedView | 'new' | null>(null)
  const [removing, setRemoving] = useState<FeedView | null>(null)
  const [removeError, setRemoveError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [syncing, setSyncing] = useState<string[]>([])
  const [outcomes, setOutcomes] = useState<Record<string, SyncOutcome>>({})

  const feeds = data?.feeds ?? []

  async function runSync(feed: FeedView): Promise<void> {
    setSyncing((current) => [...current, feed.id])
    setOutcomes((current) => {
      const next = { ...current }
      delete next[feed.id]
      return next
    })
    try {
      const response = await api.post<{ result: SyncResult }>(`/feeds/${feed.id}/sync`)
      setOutcomes((current) => ({ ...current, [feed.id]: { kind: 'result', result: response.result } }))
    } catch (cause) {
      // 409 — не поломка, а «занято»: об этом и говорим человеческим текстом.
      const outcome: SyncOutcome =
        cause instanceof ApiError && cause.code === 'feed_busy'
          ? {
              kind: 'busy',
              message: 'Этот фид уже обновляется. Дождитесь конца прогона и попробуйте снова.',
            }
          : { kind: 'failed', message: errorMessage(cause) }
      setOutcomes((current) => ({ ...current, [feed.id]: outcome }))
    } finally {
      setSyncing((current) => current.filter((id) => id !== feed.id))
      reload()
    }
  }

  async function toggleActive(feed: FeedView, isActive: boolean): Promise<void> {
    setBusy(feed.id)
    try {
      await api.patch(`/feeds/${feed.id}`, { isActive })
      reload()
    } finally {
      setBusy(null)
    }
  }

  async function remove(feed: FeedView): Promise<void> {
    setBusy(feed.id)
    setRemoveError(null)
    try {
      await api.delete(`/feeds/${feed.id}`)
      setRemoving(null)
      reload()
    } catch (cause) {
      setRemoveError(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <PageHeader
        title="Фиды"
        description="Выгрузки застройщиков: откуда берутся квартиры, как часто обновляются и что пошло не так."
        action={
          <Button onClick={() => setEditing('new')} icon={<IconPlus className="size-4" />}>
            Добавить фид
          </Button>
        }
      />

      {error ? (
        <Alert
          tone="danger"
          title="Не удалось загрузить список фидов"
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Повторить
            </Button>
          }
        >
          {errorMessage(error)}
        </Alert>
      ) : null}

      {data && !data.scheduler.enabled && feeds.length > 0 ? (
        <Alert tone="warn" title="Обновление по расписанию выключено">
          Фиды обновляются только по кнопке «Обновить сейчас». Включить расписание можно в разделе
          «Настройки».
        </Alert>
      ) : null}

      <Card padded={false}>
        <div className="p-5 sm:p-6">
          <CardHeader
            title={feeds.length > 0 ? pluralize(feeds.length, ['фид', 'фида', 'фидов']) : 'Список фидов'}
            description={
              data?.scheduler.enabled && data.scheduler.cron
                ? `Общее расписание: ${data.scheduler.cron}`
                : 'Каждый фид — ссылка на XML-выгрузку застройщика.'
            }
            action={
              feeds.length > 0 ? (
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={reload}
                  loading={refreshing}
                  icon={<IconRefresh className="size-4" />}
                >
                  Обновить список
                </Button>
              ) : undefined
            }
          />
        </div>

        {loading ? (
          <div className="border-t border-line">
            <LoadingBlock label="Загружаю фиды…" />
          </div>
        ) : feeds.length === 0 ? (
          <div className="border-t border-line">
            <EmptyState
              icon={<IconFeeds className="size-5" />}
              title="Фидов пока нет"
              description="Добавьте ссылку на XML-выгрузку застройщика — квартиры подтянутся сами и появятся в подборках ассистента."
              action={
                <Button size="sm" onClick={() => setEditing('new')} icon={<IconPlus className="size-4" />}>
                  Добавить фид
                </Button>
              }
            />
          </div>
        ) : (
          <ul className="border-t border-line">
            {feeds.map((feed) => (
              <li key={feed.id} className="border-b border-line last:border-0">
                <FeedCard
                  feed={feed}
                  syncing={syncing.includes(feed.id) || feed.isSyncing}
                  busy={busy === feed.id}
                  outcome={outcomes[feed.id]}
                  onSync={() => void runSync(feed)}
                  onEdit={() => setEditing(feed)}
                  onDelete={() => {
                    setRemoveError(null)
                    setRemoving(feed)
                  }}
                  onToggle={(next) => void toggleActive(feed, next)}
                />
              </li>
            ))}
          </ul>
        )}
      </Card>

      {editing ? (
        <FeedFormModal
          feed={editing === 'new' ? null : editing}
          meta={meta.data}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            reload()
          }}
        />
      ) : null}

      <ConfirmDialog
        open={removing !== null}
        title={`Удалить фид «${removing?.name ?? ''}»?`}
        confirmLabel="Удалить фид"
        loading={busy === removing?.id}
        onConfirm={() => {
          if (removing) void remove(removing)
        }}
        onClose={() => setRemoving(null)}
      >
        {removing && removing.apartments.total > 0 ? (
          <>
            <p>
              Вместе с фидом из базы пропадут{' '}
              <span className="font-medium text-ink">
                {pluralize(removing.apartments.total, ['квартира', 'квартиры', 'квартир'])}
              </span>
              {removing.apartments.active > 0
                ? `, из них ${formatNumber(removing.apartments.active)} сейчас в продаже`
                : null}
              . Ассистент перестанет их предлагать. Действие необратимо.
            </p>
            <p className="mt-2">
              Если фид нужно только приостановить, выключите его переключателем — квартиры останутся на
              месте.
            </p>
          </>
        ) : (
          <p>В базе нет квартир из этого фида — удаление ни на что больше не повлияет.</p>
        )}
        {removeError ? (
          <p role="alert" className="mt-3 font-medium text-danger">
            {removeError}
          </p>
        ) : null}
      </ConfirmDialog>
    </>
  )
}

function FeedCard({
  feed,
  syncing,
  busy,
  outcome,
  onSync,
  onEdit,
  onDelete,
  onToggle,
}: {
  feed: FeedView
  syncing: boolean
  busy: boolean
  outcome: SyncOutcome | undefined
  onSync: () => void
  onEdit: () => void
  onDelete: () => void
  onToggle: (next: boolean) => void
}): ReactElement {
  return (
    <div className={cx('flex flex-col gap-4 p-5 sm:p-6', !feed.isActive && 'bg-canvas/60')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold tracking-tight text-ink">{feed.name}</h3>
            <FeedStatusBadge feed={feed} syncing={syncing} />
            <Badge>{FORMAT_LABELS[feed.format]}</Badge>
          </div>
          <a
            href={feed.url}
            target="_blank"
            rel="noreferrer noopener"
            className="mt-1.5 inline-flex max-w-full items-center gap-1.5 text-sm text-muted hover:text-accent"
          >
            <span className="truncate">{feed.url}</span>
            <IconExternal className="size-3.5 shrink-0" />
          </a>
        </div>

        <Toggle
          checked={feed.isActive}
          onChange={onToggle}
          busy={busy}
          label={feed.isActive ? 'Выключить фид' : 'Включить фид'}
          hideLabel
        />
      </div>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <Detail label="Расписание" value={feed.scheduleCron ?? 'общее'} />
        <Detail label="Последнее обновление" value={formatRelative(feed.lastRunAt)} />
        <Detail
          label="Загружено в тот раз"
          value={feed.lastCount === null ? '—' : formatNumber(feed.lastCount)}
        />
        <Detail
          label="Сейчас в базе"
          value={`${formatNumber(feed.apartments.active)} в продаже`}
          hint={
            feed.apartments.total > feed.apartments.active
              ? `${formatNumber(feed.apartments.total - feed.apartments.active)} снято`
              : undefined
          }
        />
      </dl>

      {feed.lastStatus === 'error' && feed.lastError ? (
        <Alert tone="danger" title={`Ошибка обновления ${formatDateTime(feed.lastRunAt)}`}>
          {/* Полный текст, как его вернул сервер: по нему видно, что именно чинить. */}
          <p className="font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
            {feed.lastError}
          </p>
        </Alert>
      ) : null}

      {outcome ? <SyncOutcomeBlock outcome={outcome} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={onSync} loading={syncing} icon={<IconRefresh className="size-4" />}>
          {syncing ? 'Обновляю…' : 'Обновить сейчас'}
        </Button>
        <Button variant="secondary" size="sm" onClick={onEdit} icon={<IconPencil className="size-4" />}>
          Изменить
        </Button>
        <Button variant="ghost" size="sm" onClick={onDelete} icon={<IconTrash className="size-4" />}>
          Удалить
        </Button>
      </div>
    </div>
  )
}

function Detail({ label, value, hint }: { label: string; value: string; hint?: string }): ReactElement {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-faint">{label}</dt>
      <dd className="mt-0.5 truncate text-sm text-ink">
        {value}
        {hint ? <span className="ml-1.5 text-xs text-faint">{hint}</span> : null}
      </dd>
    </div>
  )
}

function FeedStatusBadge({ feed, syncing }: { feed: FeedView; syncing: boolean }): ReactElement {
  if (syncing) {
    return (
      <Badge tone="accent" icon={<IconClock className="size-3.5" />}>
        обновляется
      </Badge>
    )
  }
  if (!feed.isActive) return <Badge tone="neutral">выключен</Badge>
  if (feed.lastStatus === 'error') {
    return (
      <Badge tone="danger" icon={<IconAlert className="size-3.5" />}>
        ошибка
      </Badge>
    )
  }
  if (feed.lastStatus === 'ok') {
    return (
      <Badge tone="ok" icon={<IconCheck className="size-3.5" />}>
        в порядке
      </Badge>
    )
  }
  return <Badge tone="warn">ещё не запускался</Badge>
}

/** Разбор прогона: что именно изменилось в базе. */
function SyncOutcomeBlock({ outcome }: { outcome: SyncOutcome }): ReactElement {
  if (outcome.kind === 'busy') {
    return (
      <Alert tone="warn" title="Обновление уже идёт">
        {outcome.message}
      </Alert>
    )
  }

  if (outcome.kind === 'failed') {
    return (
      <Alert tone="danger" title="Обновить не получилось">
        <p className="font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
          {outcome.message}
        </p>
      </Alert>
    )
  }

  const { result } = outcome
  if (result.status === 'error') {
    return (
      <Alert tone="danger" title="Фид не обновился">
        <p className="font-mono text-xs leading-relaxed break-words whitespace-pre-wrap">
          {result.error ?? 'Сервер не объяснил причину'}
        </p>
      </Alert>
    )
  }

  return (
    <Alert tone="ok" title={`Обновлено за ${(result.durationMs / 1000).toFixed(1)} с`}>
      <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1">
        <SyncNumber label="добавлено" value={result.created} />
        <SyncNumber label="обновлено" value={result.updated} />
        <SyncNumber label="снято с продажи" value={result.deactivated} />
        <SyncNumber label="пропущено" value={result.skipped} />
        <SyncNumber label="всего в фиде" value={result.total} />
      </ul>
      {result.projectsCreated > 0 ? (
        <p className="mt-2">
          Заведено новых ЖК: {formatNumber(result.projectsCreated)}. Загляните в раздел «ЖК» — их стоит
          дополнить районом, метро и сроком сдачи.
        </p>
      ) : null}
      {result.warnings.length > 0 ? (
        <div className="mt-2">
          <p className="font-medium">Почему пропущены:</p>
          <ul className="mt-1 list-inside list-disc">
            {result.warnings.map((warning) => (
              <li key={warning}>{warning}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </Alert>
  )
}

function SyncNumber({ label, value }: { label: string; value: number }): ReactElement {
  return (
    <li className="flex items-baseline gap-1.5">
      <span className="tabular text-base font-semibold">{formatNumber(value)}</span>
      <span className="text-xs">{label}</span>
    </li>
  )
}

// ─────────────────────────────────────────────────────────────
//  Форма фида
// ─────────────────────────────────────────────────────────────

/** Подписи к полям маппинга: имя поля само по себе мало что объясняет. */
const FIELD_HINTS: Record<string, string> = {
  externalId: 'идентификатор лота — обязательно',
  url: 'ссылка на квартиру',
  price: 'цена — обязательно',
  pricePerM2: 'цена за м²',
  area: 'общая площадь',
  livingArea: 'жилая площадь',
  kitchenArea: 'площадь кухни',
  rooms: 'число комнат',
  studio: 'признак студии',
  floor: 'этаж',
  floorsTotal: 'этажей в доме',
  building: 'корпус',
  section: 'секция или очередь',
  finishing: 'отделка',
  deadline: 'срок сдачи целиком',
  deadlineYear: 'срок сдачи: год',
  deadlineQuarter: 'срок сдачи: квартал',
  planImageUrl: 'картинка планировки',
  projectName: 'название ЖК',
  projectUrl: 'ссылка на ЖК',
  projectImageUrl: 'картинка ЖК',
  developer: 'застройщик',
  district: 'район',
  metro: 'метро',
  metroDistanceMin: 'минут до метро',
  address: 'адрес',
}

interface MappingDraft {
  itemsPath: string
  fields: Record<string, string>
}

/** Читает сохранённый маппинг в вид, удобный для формы. */
function toMappingDraft(value: unknown): MappingDraft {
  const draft: MappingDraft = { itemsPath: '', fields: {} }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return draft

  const source = value as Record<string, unknown>
  const raw = source['fields']
  const fields =
    typeof raw === 'object' && raw !== null && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : source

  const asText = (item: unknown): string => {
    if (typeof item === 'string') return item
    if (Array.isArray(item)) return item.filter((part) => typeof part === 'string').join(', ')
    return ''
  }

  draft.itemsPath = asText(source['itemsPath'] ?? source['itemsPaths'])
  for (const [key, item] of Object.entries(fields)) {
    if (key === 'itemsPath' || key === 'itemsPaths' || key === 'fields') continue
    const text = asText(item)
    if (text !== '') draft.fields[key] = text
  }
  return draft
}

/** Собирает маппинг обратно: «a, b» — это два запасных пути к одному полю. */
function fromMappingDraft(draft: MappingDraft): Record<string, unknown> {
  const split = (text: string): string[] =>
    text
      .split(',')
      .map((part) => part.trim())
      .filter((part) => part !== '')

  const fields: Record<string, string[]> = {}
  for (const [key, text] of Object.entries(draft.fields)) {
    const paths = split(text)
    if (paths.length > 0) fields[key] = paths
  }

  const mapping: Record<string, unknown> = { fields }
  const itemsPath = split(draft.itemsPath)
  if (itemsPath.length > 0) mapping['itemsPath'] = itemsPath
  return mapping
}

function FeedFormModal({
  feed,
  meta,
  onClose,
  onSaved,
}: {
  feed: FeedView | null
  meta: FeedsMeta | null
  onClose: () => void
  onSaved: () => void
}): ReactElement {
  const [name, setName] = useState(feed?.name ?? '')
  const [url, setUrl] = useState(feed?.url ?? '')
  const [format, setFormat] = useState<FeedFormat>(feed?.format ?? 'yandex')
  const [scheduleCron, setScheduleCron] = useState(feed?.scheduleCron ?? '')
  const [isActive, setIsActive] = useState(feed?.isActive ?? true)
  const [mapping, setMapping] = useState<MappingDraft>(() => toMappingDraft(feed?.fieldMapping))
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  // Форму открыли на другом фиде — поля должны показать его, а не прежний.
  useEffect(() => {
    setName(feed?.name ?? '')
    setUrl(feed?.url ?? '')
    setFormat(feed?.format ?? 'yandex')
    setScheduleCron(feed?.scheduleCron ?? '')
    setIsActive(feed?.isActive ?? true)
    setMapping(toMappingDraft(feed?.fieldMapping))
    setFailure(null)
  }, [feed])

  async function save(): Promise<void> {
    setSaving(true)
    setFailure(null)
    const payload = {
      name,
      url,
      format,
      scheduleCron: scheduleCron.trim() === '' ? null : scheduleCron.trim(),
      isActive,
      fieldMapping: format === 'custom' ? fromMappingDraft(mapping) : null,
    }
    try {
      if (feed) await api.patch(`/feeds/${feed.id}`, payload)
      else await api.post('/feeds', payload)
      onSaved()
    } catch (cause) {
      // Сервер проверяет ссылку, расписание и маппинг тем же кодом, что
      // разбирает фид, — его объяснение точнее любого нашего.
      setFailure(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      size={format === 'custom' ? 'lg' : 'md'}
      title={feed ? 'Изменить фид' : 'Новый фид'}
      description="Ссылка на XML-выгрузку застройщика. Квартиры из неё попадут в подборки ассистента."
      onClose={onClose}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Отмена
          </Button>
          <Button onClick={() => void save()} loading={saving}>
            {feed ? 'Сохранить' : 'Добавить фид'}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-4">
        {failure ? (
          <Alert tone="danger" title="Не сохранилось">
            {failure}
          </Alert>
        ) : null}

        <Field
          label="Название"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="ГК Пример — Северный парк"
          hint="Видно только вам: по нему вы узнаёте фид в списке."
        />

        <Field
          label="Ссылка на выгрузку"
          value={url}
          onChange={(event) => setUrl(event.target.value)}
          placeholder="https://developer.ru/feed.xml"
          inputMode="url"
          hint="Полный адрес XML- или YML-файла, начиная с http:// или https://"
        />

        <Select
          label="Формат"
          value={format}
          onChange={(event) => setFormat(event.target.value as FeedFormat)}
          options={(meta?.formats ?? (['yandex', 'cian', 'custom'] as FeedFormat[])).map((value) => ({
            value,
            label: FORMAT_LABELS[value],
          }))}
          hint={
            format === 'custom'
              ? 'Свой формат — ниже нужно указать, где в XML лежит какое поле.'
              : 'Для Яндекса и ЦИАН поля известны заранее, настраивать ничего не нужно.'
          }
        />

        <Field
          label="Своё расписание"
          value={scheduleCron}
          onChange={(event) => setScheduleCron(event.target.value)}
          optional
          placeholder={meta?.defaultCron ?? '0 */3 * * *'}
          hint={`Выражение cron. Пусто — фид обновляется по общему расписанию${meta ? ` (${meta.defaultCron})` : ''}.`}
        />

        <Toggle
          checked={isActive}
          onChange={setIsActive}
          label="Обновлять этот фид"
          hint="Выключенный фид не скачивается по расписанию, но его квартиры остаются в базе."
        />

        {format === 'custom' ? (
          <MappingEditor fields={meta?.fields ?? []} mapping={mapping} onChange={setMapping} />
        ) : null}
      </div>
    </Modal>
  )
}

function MappingEditor({
  fields,
  mapping,
  onChange,
}: {
  fields: string[]
  mapping: MappingDraft
  onChange: (next: MappingDraft) => void
}): ReactElement {
  return (
    <section className="flex flex-col gap-4 rounded-2xl border border-line bg-canvas p-4">
      <div>
        <h3 className="text-sm font-semibold text-ink">Соответствие полей</h3>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          Слева — поле квартиры, справа — путь к нему внутри одного предложения в XML. Уровни разделяются
          точкой (<code className="font-mono">price.value</code>), атрибут пишется со знаками{' '}
          <code className="font-mono">@_</code> (<code className="font-mono">@_internal-id</code>). Путей
          можно указать несколько через запятую — возьмётся первый непустой. Без{' '}
          <code className="font-mono">externalId</code> и <code className="font-mono">price</code> фид не
          примут: по ним квартиру опознают и показывают.
        </p>
      </div>

      <Field
        label="Путь до списка предложений"
        value={mapping.itemsPath}
        onChange={(event) => onChange({ ...mapping, itemsPath: event.target.value })}
        optional
        placeholder="realty-feed.offer"
        hint="От корня документа. Пусто — список ищется сам по самому длинному повторяющемуся узлу."
      />

      <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
        {fields.map((field) => (
          <label key={field} className="flex flex-col gap-1">
            <span className="flex items-baseline gap-2">
              <code className="font-mono text-xs font-medium text-ink">{field}</code>
              <span className="truncate text-xs text-faint">{FIELD_HINTS[field] ?? ''}</span>
            </span>
            <input
              value={mapping.fields[field] ?? ''}
              onChange={(event) =>
                onChange({ ...mapping, fields: { ...mapping.fields, [field]: event.target.value } })
              }
              placeholder="путь.в.xml"
              className="min-h-11 w-full rounded-xl border border-line bg-surface px-3 py-2 font-mono text-xs text-ink transition-colors duration-150 placeholder:text-faint hover:border-faint"
            />
          </label>
        ))}
      </div>
    </section>
  )
}
