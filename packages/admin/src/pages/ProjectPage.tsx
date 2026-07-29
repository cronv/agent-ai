import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'

import { api, errorMessage } from '../lib/api.js'
import { cx } from '../lib/cx.js'
import { formatDate, formatMoney, formatMoneyShort, formatNumber, pluralize } from '../lib/format.js'
import { useApiQuery } from '../lib/useApiQuery.js'
import type { ApartmentsResponse, ProjectCardResponse, ProjectCategory, ProjectView } from './project-view.js'
import { roomsChipLabel, roomsLabel } from './project-view.js'
import { ProjectDeleteDialog } from './ProjectDeleteDialog.js'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  Field,
  IconChevronLeft,
  IconExternal,
  IconProjects,
  IconTrash,
  LoadingBlock,
  PageHeader,
  Select,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Toggle,
} from '../ui/index.js'

/**
 * Карточка ЖК: что дописать руками и что уже пришло из фида.
 *
 * Сверху — форма с полями, которых в выгрузке застройщика нет (район, метро,
 * срок сдачи, отделка, описание): по ним ассистент отвечает на «а что рядом с
 * метро» и «когда сдача». Снизу — квартиры этого ЖК с фильтрами по
 * комнатности и цене: так видно, что именно увидит посетитель.
 */

interface Draft {
  name: string
  developer: string
  district: string
  metro: string
  metroDistanceMin: string
  address: string
  deadline: string
  finishing: string
  description: string
  url: string
  imageUrl: string
  category: ProjectCategory
}

const EMPTY_DRAFT: Draft = {
  name: '',
  developer: '',
  district: '',
  metro: '',
  metroDistanceMin: '',
  address: '',
  deadline: '',
  finishing: '',
  description: '',
  url: '',
  imageUrl: '',
  category: 'novostroyki',
}

/** ISO-дата с сервера → `2027-06-30` для поля ввода. */
function toDateInput(value: string | null): string {
  return value === null ? '' : value.slice(0, 10)
}

function toDraft(project: ProjectView): Draft {
  return {
    name: project.name,
    developer: project.developer ?? '',
    district: project.district ?? '',
    metro: project.metro ?? '',
    metroDistanceMin: project.metroDistanceMin === null ? '' : String(project.metroDistanceMin),
    address: project.address ?? '',
    deadline: toDateInput(project.deadline),
    finishing: project.finishing ?? '',
    description: project.description ?? '',
    url: project.url ?? '',
    imageUrl: project.imageUrl ?? '',
    category: project.category,
  }
}

export function ProjectPage(): ReactElement {
  const { id = '' } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { data, error, loading, reload } = useApiQuery<ProjectCardResponse>(`/projects/${id}`)

  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT)
  const [saving, setSaving] = useState(false)
  const [togglingActive, setTogglingActive] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    if (data) setDraft(toDraft(data))
  }, [data])

  const dirty = data !== null && JSON.stringify(draft) !== JSON.stringify(toDraft(data))

  function set<K extends keyof Draft>(key: K, value: Draft[K]): void {
    setDraft((current) => ({ ...current, [key]: value }))
    setSaved(false)
  }

  async function save(): Promise<void> {
    setSaving(true)
    setFailure(null)
    try {
      await api.patch(`/projects/${id}`, {
        name: draft.name.trim(),
        developer: draft.developer,
        district: draft.district,
        metro: draft.metro,
        metroDistanceMin:
          draft.metroDistanceMin.trim() === '' ? null : Number(draft.metroDistanceMin.trim()),
        address: draft.address,
        deadline: draft.deadline.trim() === '' ? null : draft.deadline.trim(),
        finishing: draft.finishing,
        description: draft.description,
        url: draft.url,
        imageUrl: draft.imageUrl,
        category: draft.category,
      })
      setSaved(true)
      reload()
    } catch (cause) {
      setFailure(errorMessage(cause))
    } finally {
      setSaving(false)
    }
  }

  async function toggleActive(isActive: boolean): Promise<void> {
    setTogglingActive(true)
    setFailure(null)
    try {
      await api.post(`/projects/${id}/active`, { isActive })
      reload()
    } catch (cause) {
      setFailure(errorMessage(cause))
    } finally {
      setTogglingActive(false)
    }
  }

  if (loading) return <LoadingBlock label="Загружаю жилой комплекс…" />

  if (error || !data) {
    return (
      <>
        <BackLink />
        <Alert
          tone="danger"
          title="Не удалось открыть жилой комплекс"
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Повторить
            </Button>
          }
        >
          {error ? errorMessage(error) : 'Такого ЖК больше нет.'}
        </Alert>
      </>
    )
  }

  return (
    <>
      <BackLink />

      <PageHeader
        title={data.name}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {pluralize(data.apartments.active, ['квартира', 'квартиры', 'квартир'])} в продаже
              {data.apartments.total > data.apartments.active
                ? `, ${formatNumber(data.apartments.total - data.apartments.active)} снято`
                : null}
            </span>
            {data.price ? (
              <span className="tabular">
                {formatMoneyShort(data.price.min)} — {formatMoneyShort(data.price.max)}
              </span>
            ) : null}
            {data.isActive ? null : <Badge tone="warn">не показывается в чате</Badge>}
          </span>
        }
        action={
          <Toggle
            checked={data.isActive}
            busy={togglingActive}
            onChange={(next) => void toggleActive(next)}
            label="Показывать в чате"
            hint={data.isActive ? 'Ассистент предлагает этот ЖК' : 'Ассистент его не предлагает'}
          />
        }
      />

      {failure ? <Alert tone="danger">{failure}</Alert> : null}
      {saved && !dirty ? <Alert tone="ok">Карточка сохранена.</Alert> : null}

      <Card>
        <CardHeader
          title="Карточка"
          description="Из фида приходит только название и квартиры. Всё остальное ассистент берёт отсюда."
        />

        <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field
            label="Название"
            value={draft.name}
            onChange={(event) => set('name', event.target.value)}
            hint="То же название, что в фиде: по нему связываются квартиры."
          />
          <Select
            label="Направление"
            value={draft.category}
            onChange={(event) => set('category', event.target.value as ProjectCategory)}
            options={data.categories.map((category) => ({ value: category.value, label: category.label }))}
            hint="По направлениям раздел «ЖК» и делится. Ассистент предлагает объекты только того направления, о котором спросили."
          />
          <Field
            label="Застройщик"
            value={draft.developer}
            optional
            onChange={(event) => set('developer', event.target.value)}
          />
          <Field
            label="Район"
            value={draft.district}
            optional
            onChange={(event) => set('district', event.target.value)}
            placeholder="Приморский"
          />
          <Field
            label="Адрес"
            value={draft.address}
            optional
            onChange={(event) => set('address', event.target.value)}
            placeholder="ул. Планерная, 5"
          />
          <Field
            label="Метро"
            value={draft.metro}
            optional
            onChange={(event) => set('metro', event.target.value)}
            placeholder="Комендантский проспект"
          />
          <Field
            label="Минут до метро"
            value={draft.metroDistanceMin}
            optional
            inputMode="numeric"
            onChange={(event) => set('metroDistanceMin', event.target.value.replace(/\D/g, ''))}
            hint="Пешком. Ассистент отвечает этим числом на «далеко ли метро»."
          />
          <Field
            label="Срок сдачи"
            type="date"
            value={draft.deadline}
            optional
            onChange={(event) => set('deadline', event.target.value)}
            hint={data.deadline ? `Сейчас: ${formatDate(data.deadline)}` : 'Дата ввода в эксплуатацию'}
          />
          <Field
            label="Отделка"
            value={draft.finishing}
            optional
            onChange={(event) => set('finishing', event.target.value)}
            placeholder="чистовая / white box / без отделки"
          />
          <Field
            label="Ссылка на ЖК"
            value={draft.url}
            optional
            inputMode="url"
            onChange={(event) => set('url', event.target.value)}
            placeholder="https://www.ndv.ru/novostrojki/zhk/kosmos"
            hint="Адрес карточки ЖК на сайте. По нему в чате появляется кнопка перехода и открывается клик по карточке квартиры. Пусто — кнопки нет."
          />
          <Field
            label="Ссылка на картинку"
            value={draft.imageUrl}
            optional
            inputMode="url"
            onChange={(event) => set('imageUrl', event.target.value)}
            hint="Показывается в карточке ЖК в чате."
          />
          <Field
            label="Описание"
            multiline
            rows={5}
            value={draft.description}
            optional
            onChange={(event) => set('description', event.target.value)}
            hint="Пара абзацев о ЖК: чем отличается, что рядом, для кого. Ассистент отвечает этими словами."
            className="sm:col-span-2"
          />
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-3">
          <Button onClick={() => void save()} loading={saving} disabled={!dirty}>
            Сохранить
          </Button>
          {dirty ? (
            <Button variant="ghost" onClick={() => setDraft(toDraft(data))} disabled={saving}>
              Отменить правки
            </Button>
          ) : (
            <span className="text-sm text-faint">Изменений нет</span>
          )}
        </div>
      </Card>

      <ProjectApartments projectId={id} />

      {/*
        Удаление стоит последним и отдельной карточкой: это уборка мусора —
        ошибочной записи, дубля из кривой выгрузки, — а не способ убрать ЖК
        из чата. Для второго есть переключатель наверху.
      */}
      <Card>
        <CardHeader
          title="Удалить ЖК"
          description="Комплекс и все его квартиры исчезнут из базы. Переписки и лиды останутся: карточки в них сохранены снимком."
        />
        <div className="mt-4">
          <Button
            variant="danger"
            icon={<IconTrash className="size-4" />}
            onClick={() => {
              setFailure(null)
              setRemoving(true)
            }}
          >
            Удалить «{data.name}»
          </Button>
        </div>
      </Card>

      <ProjectDeleteDialog
        project={removing ? data : null}
        onClose={() => setRemoving(false)}
        onDeleted={() => navigate('/projects')}
      />
    </>
  )
}

function BackLink(): ReactElement {
  return (
    <Link
      to="/projects"
      className="inline-flex items-center gap-1.5 self-start text-sm text-muted hover:text-accent"
    >
      <IconChevronLeft className="size-4" />
      Все ЖК
    </Link>
  )
}

// ─────────────────────────────────────────────────────────────
//  Квартиры ЖК
// ─────────────────────────────────────────────────────────────

function ProjectApartments({ projectId }: { projectId: string }): ReactElement {
  const [rooms, setRooms] = useState<number[]>([])
  const [priceMin, setPriceMin] = useState('')
  const [priceMax, setPriceMax] = useState('')
  const [withHidden, setWithHidden] = useState(false)

  // Цену набирают цифра за цифрой — ждём паузу, чтобы не звать сервер на каждую.
  const [priceFilter, setPriceFilter] = useState({ min: '', max: '' })
  useEffect(() => {
    const timer = setTimeout(() => setPriceFilter({ min: priceMin, max: priceMax }), 400)
    return () => clearTimeout(timer)
  }, [priceMin, priceMax])

  const path = useMemo(() => {
    const params = new URLSearchParams()
    if (rooms.length > 0) params.set('rooms', rooms.join(','))
    if (priceFilter.min !== '') params.set('priceMin', priceFilter.min)
    if (priceFilter.max !== '') params.set('priceMax', priceFilter.max)
    if (withHidden) params.set('onlyActive', 'false')
    const query = params.toString()
    return `/projects/${projectId}/apartments${query === '' ? '' : `?${query}`}`
  }, [projectId, rooms, priceFilter, withHidden])

  const { data, error, loading, refreshing, reload } = useApiQuery<ApartmentsResponse>(path)

  const filtered = rooms.length > 0 || priceFilter.min !== '' || priceFilter.max !== ''

  function toggleRooms(value: number): void {
    setRooms((current) =>
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    )
  }

  return (
    <Card padded={false}>
      <div className="p-5 sm:p-6">
        <CardHeader
          title="Квартиры"
          description={
            data
              ? `${pluralize(data.total, ['квартира', 'квартиры', 'квартир'])}${filtered ? ' по фильтру' : ''}`
              : 'Лоты из фида застройщика'
          }
          action={
            <Toggle
              checked={withHidden}
              onChange={setWithHidden}
              label="Показывать снятые с продажи"
            />
          }
        />

        <div className="mt-4 flex flex-wrap items-end gap-4">
          {data && data.facets.rooms.length > 0 ? (
            <fieldset className="flex flex-col gap-1.5">
              <legend className="text-sm font-medium text-ink">Комнатность</legend>
              <div className="flex flex-wrap gap-2">
                {data.facets.rooms.map((facet) => {
                  const value = facet.rooms
                  if (value === null) return null
                  const active = rooms.includes(value)
                  return (
                    <button
                      key={value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => toggleRooms(value)}
                      className={cx(
                        'min-h-11 cursor-pointer rounded-xl border px-3.5 text-sm transition-colors duration-150',
                        active
                          ? 'border-transparent bg-accent-soft font-medium text-accent-strong'
                          : 'border-line bg-surface text-muted hover:border-faint hover:text-ink',
                      )}
                    >
                      {roomsChipLabel(value)}
                      <span className="tabular ml-1.5 text-xs text-faint">{facet.count}</span>
                    </button>
                  )
                })}
              </div>
            </fieldset>
          ) : null}

          <Field
            label="Цена от"
            value={priceMin}
            inputMode="numeric"
            onChange={(event) => setPriceMin(event.target.value.replace(/\D/g, ''))}
            placeholder={data?.facets.price ? String(Math.round(data.facets.price.min)) : '0'}
            className="w-36"
          />
          <Field
            label="Цена до"
            value={priceMax}
            inputMode="numeric"
            onChange={(event) => setPriceMax(event.target.value.replace(/\D/g, ''))}
            placeholder={data?.facets.price ? String(Math.round(data.facets.price.max)) : ''}
            className="w-36"
          />

          {filtered ? (
            <Button
              variant="ghost"
              onClick={() => {
                setRooms([])
                setPriceMin('')
                setPriceMax('')
              }}
            >
              Сбросить фильтр
            </Button>
          ) : null}
        </div>
      </div>

      {error ? (
        <div className="border-t border-line p-5 sm:p-6">
          <Alert
            tone="danger"
            title="Не удалось загрузить квартиры"
            action={
              <Button variant="secondary" size="sm" onClick={reload}>
                Повторить
              </Button>
            }
          >
            {errorMessage(error)}
          </Alert>
        </div>
      ) : null}

      {loading ? (
        <div className="border-t border-line">
          <LoadingBlock label="Загружаю квартиры…" />
        </div>
      ) : (data?.apartments.length ?? 0) === 0 ? (
        <div className="border-t border-line">
          <EmptyState
            icon={<IconProjects className="size-5" />}
            title={filtered ? 'Под фильтр ничего не подошло' : 'Квартир пока нет'}
            description={
              filtered
                ? 'Расширьте вилку цен или снимите ограничение по комнатности.'
                : 'Квартиры появятся после обновления фида, который заводит этот ЖК.'
            }
          />
        </div>
      ) : (
        <div className={cx('border-t border-line', refreshing && 'opacity-60')}>
          <Table>
            <THead>
              <TH>Квартира</TH>
              <TH align="right">Площадь</TH>
              <TH align="right">Этаж</TH>
              <TH align="right">Цена</TH>
              <TH align="right">За м²</TH>
              <TH>Отделка</TH>
            </THead>
            <TBody>
              {data?.apartments.map((apartment) => (
                <TR key={apartment.id}>
                  <TD>
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium text-ink">{roomsLabel(apartment.rooms)}</span>
                      {apartment.isActive ? null : <Badge tone="neutral">снята</Badge>}
                      {apartment.url ? (
                        <a
                          href={apartment.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="text-muted hover:text-accent"
                          aria-label={`Открыть лот ${apartment.externalId} на сайте застройщика`}
                        >
                          <IconExternal className="size-3.5" />
                        </a>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block text-xs text-faint">
                      {[apartment.building ? `корпус ${apartment.building}` : null, apartment.section]
                        .filter(Boolean)
                        .join(', ') || apartment.externalId}
                    </span>
                  </TD>
                  <TD align="right" numeric className="text-muted">
                    {apartment.area === null ? '—' : `${formatNumber(apartment.area)} м²`}
                  </TD>
                  <TD align="right" numeric className="whitespace-nowrap text-muted">
                    {apartment.floor === null
                      ? '—'
                      : `${apartment.floor}${apartment.floorsTotal === null ? '' : ` из ${apartment.floorsTotal}`}`}
                  </TD>
                  <TD align="right" numeric className="whitespace-nowrap font-medium">
                    {formatMoney(apartment.price)}
                  </TD>
                  <TD align="right" numeric className="whitespace-nowrap text-muted">
                    {apartment.pricePerM2 === null ? '—' : formatMoney(apartment.pricePerM2)}
                  </TD>
                  <TD className="text-muted">{apartment.finishing ?? '—'}</TD>
                </TR>
              ))}
            </TBody>
          </Table>

          {data && data.total > data.apartments.length ? (
            <p className="border-t border-line px-5 py-3 text-xs text-faint">
              Показаны первые {formatNumber(data.apartments.length)} из{' '}
              {formatNumber(data.total)}. Сузьте фильтр, чтобы увидеть нужные.
            </p>
          ) : null}
        </div>
      )}
    </Card>
  )
}
