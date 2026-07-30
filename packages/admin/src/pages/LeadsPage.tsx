import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'

import { api, errorMessage } from '../lib/api.js'
import { cx } from '../lib/cx.js'
import { formatDateTime, formatNumber, pluralize } from '../lib/format.js'
import { useApiQuery } from '../lib/useApiQuery.js'
import {
  Alert,
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  IconAlert,
  IconConversations,
  IconFile,
  IconLeads,
  LoadingBlock,
  PageHeader,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '../ui/index.js'
import { ApartmentCards } from './ApartmentCards.js'
import { FilterChips } from './FilterChips.js'
import { Pager } from './Pager.js'
import type { LeadListResponse, LeadRow, LeadStatus } from './dialog-view.js'
import {
  LEAD_STATUSES,
  LEAD_STATUS_LABELS,
  LEAD_STATUS_TONES,
  shortUrl,
  utmSummary,
} from './dialog-view.js'

/**
 * Раздел «Лиды»: контакты, которые люди оставили в чате.
 *
 * Экран сделан под один сценарий — обзвон. В строке всё, что нужно набрать
 * номер: имя, кликабельный телефон, что человек смотрел, откуда пришёл.
 * Статус меняется прямо в списке, чтобы коллега не позвонил второй раз,
 * а «Подробнее» раскрывает карточку с комментарием и подборкой.
 *
 * Заявка, которая не ушла в CRM, помечена красным: её нужно перенести руками,
 * и узнать об этом менеджер должен здесь, а не от потерянного клиента.
 */

const PAGE_SIZE = 50

type StatusFilter = '' | LeadStatus

export function LeadsPage(): ReactElement {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [status, setStatus] = useState<StatusFilter>('')
  const [offset, setOffset] = useState(0)
  const [failure, setFailure] = useState<string | null>(null)

  // Телефон и имя набирают по символу — ждём паузу перед запросом.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 400)
    return () => clearTimeout(timer)
  }, [search])

  useEffect(() => {
    setOffset(0)
  }, [query, from, to, status])

  const filterParams = useMemo(() => {
    const params = new URLSearchParams()
    if (query !== '') params.set('q', query)
    if (from !== '') params.set('from', from)
    if (to !== '') params.set('to', to)
    if (status !== '') params.set('status', status)
    return params
  }, [query, from, to, status])

  const path = useMemo(() => {
    const params = new URLSearchParams(filterParams)
    params.set('limit', String(PAGE_SIZE))
    if (offset > 0) params.set('offset', String(offset))
    return `/leads?${params.toString()}`
  }, [filterParams, offset])

  const { data, error, loading, refreshing, reload } = useApiQuery<LeadListResponse>(path)

  // Выгрузка идёт обычной ссылкой, а не запросом: файл должен сохраниться
  // браузером, а кука с сессией уедет вместе с переходом.
  const exportHref = `/api/admin/leads/export.csv${
    filterParams.toString() === '' ? '' : `?${filterParams.toString()}`
  }`

  const filtered = query !== '' || from !== '' || to !== '' || status !== ''

  async function changeStatus(id: string, next: LeadStatus): Promise<void> {
    setFailure(null)
    try {
      await api.patch(`/leads/${id}`, { status: next })
      reload()
    } catch (cause) {
      setFailure(errorMessage(cause))
    }
  }

  function resetFilters(): void {
    setSearch('')
    setQuery('')
    setFrom('')
    setTo('')
    setStatus('')
  }

  return (
    <>
      <PageHeader
        title="Лиды"
        description={
          data
            ? `${pluralize(data.counts.all, ['контакт', 'контакта', 'контактов'])} из чата, ${formatNumber(
                data.counts.new,
              )} ещё не в работе`
            : 'Контакты, которые люди оставили в чате.'
        }
        action={
          <a
            href={exportHref}
            className={cx(
              'inline-flex min-h-11 cursor-pointer items-center justify-center gap-2 rounded-xl px-4',
              'border border-line bg-surface text-sm font-medium text-ink',
              'transition-colors duration-150 hover:border-faint hover:bg-canvas',
            )}
          >
            <IconFile className="size-4" />
            Выгрузить CSV
          </a>
        }
      />

      {error ? (
        <Alert
          tone="danger"
          title="Не удалось загрузить лиды"
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Повторить
            </Button>
          }
        >
          {errorMessage(error)}
        </Alert>
      ) : null}

      {failure ? <Alert tone="danger">{failure}</Alert> : null}

      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-4 p-5 sm:p-6">
          <Field
            label="Поиск"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Петров, 912 345"
            hint="По имени и телефону, в любом написании"
            className="w-full sm:w-64"
          />
          <Field
            label="С даты"
            type="date"
            value={from}
            onChange={(event) => setFrom(event.target.value)}
            className="w-40"
          />
          <Field
            label="По дату"
            type="date"
            value={to}
            onChange={(event) => setTo(event.target.value)}
            className="w-40"
          />
          <FilterChips<StatusFilter>
            legend="Статус"
            value={status}
            onChange={setStatus}
            options={[
              { value: '', label: 'Все', count: data?.counts.all },
              ...LEAD_STATUSES.map((item) => ({
                value: item as StatusFilter,
                label: LEAD_STATUS_LABELS[item],
                count: data?.counts[item],
              })),
            ]}
          />
          {filtered ? (
            <Button variant="ghost" onClick={resetFilters}>
              Сбросить фильтр
            </Button>
          ) : null}
        </div>

        {loading ? (
          <div className="border-t border-line">
            <LoadingBlock label="Загружаю лиды…" />
          </div>
        ) : (data?.leads.length ?? 0) === 0 ? (
          <div className="border-t border-line">
            <EmptyState
              icon={<IconLeads className="size-5" />}
              title={filtered ? 'Под фильтр ничего не подошло' : 'Контактов пока нет'}
              description={
                filtered
                  ? 'Снимите ограничение по статусу или расширьте период.'
                  : 'Ассистент просит телефон после того, как показал подборку, — первые заявки появятся здесь.'
              }
            />
          </div>
        ) : (
          <div className={cx('border-t border-line', refreshing && 'opacity-60')}>
            <Table>
              <THead>
                <TH>Контакт</TH>
                <TH>Телефон</TH>
                {/* Выбранное и показанное — разные колонки намеренно: показали
                    пять, выбрал одну, и звонить надо про неё. */}
                <TH align="right">Выбрал</TH>
                <TH align="right">Смотрел</TH>
                <TH>Источник</TH>
                <TH>Оставлен</TH>
                <TH>Статус</TH>
              </THead>
              <TBody>
                {data?.leads.map((lead) => (
                  <LeadTableRow key={lead.id} lead={lead} onStatus={changeStatus} />
                ))}
              </TBody>
            </Table>

            <Pager
              total={data?.total ?? 0}
              limit={data?.limit ?? PAGE_SIZE}
              offset={offset}
              loading={refreshing}
              onChange={setOffset}
              unit={['лид', 'лида', 'лидов']}
            />
          </div>
        )}
      </Card>
    </>
  )
}

// ─────────────────────────────────────────────────────────────
//  Строка списка и раскрытая карточка
// ─────────────────────────────────────────────────────────────

function LeadTableRow({
  lead,
  onStatus,
}: {
  lead: LeadRow
  onStatus: (id: string, status: LeadStatus) => Promise<void>
}): ReactElement {
  const [open, setOpen] = useState(false)
  const [saving, setSaving] = useState(false)

  const failedWebhook = lead.webhookStatus === 'failed'
  const selected = lead.selectedApartments?.length ?? 0
  const page = shortUrl(lead.conversation?.page ?? null)
  const utm = utmSummary(lead.conversation?.utm ?? null)

  async function change(next: LeadStatus): Promise<void> {
    setSaving(true)
    try {
      await onStatus(lead.id, next)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <TR highlighted={failedWebhook}>
        <TD>
          <span className="block max-w-64 font-medium text-ink">{lead.name}</span>
          {lead.comment === null ? null : (
            <span className="mt-0.5 line-clamp-1 block max-w-64 text-xs text-muted" title={lead.comment}>
              {lead.comment}
            </span>
          )}
          <button
            type="button"
            onClick={() => setOpen((value) => !value)}
            aria-expanded={open}
            className="mt-1 inline-flex min-h-8 cursor-pointer items-center text-xs text-muted underline-offset-2 hover:text-accent hover:underline"
          >
            {open ? 'Свернуть' : 'Подробнее'}
          </button>
        </TD>

        <TD>
          <span className="flex flex-col items-start gap-1">
            <a
              href={`tel:${lead.phone}`}
              className="tabular inline-flex min-h-8 items-center text-sm font-medium text-accent hover:text-accent-strong"
            >
              {lead.phoneFormatted}
            </a>
            {failedWebhook ? (
              <Badge tone="danger" icon={<IconAlert className="size-3.5" />}>
                Не ушёл в CRM
              </Badge>
            ) : null}
          </span>
        </TD>

        <TD align="right" numeric>
          {selected === 0 ? (
            <span className="text-faint">—</span>
          ) : (
            <span className="font-semibold text-accent" title="Отметил кнопкой «Выбрать» на карточке">
              {formatNumber(selected)}
            </span>
          )}
        </TD>

        <TD align="right" numeric className="text-muted">
          {lead.apartments.length === 0 ? '—' : formatNumber(lead.apartments.length)}
        </TD>

        <TD>
          {page === null ? (
            <span className="text-sm text-faint">—</span>
          ) : (
            <span
              className="block max-w-56 truncate text-sm text-muted"
              title={lead.conversation?.page ?? undefined}
            >
              {page}
            </span>
          )}
          {utm === null ? null : (
            <span className="mt-0.5 block max-w-56 truncate text-xs text-faint" title={utm}>
              {utm}
            </span>
          )}
        </TD>

        <TD className="whitespace-nowrap text-muted">{formatDateTime(lead.createdAt)}</TD>

        <TD>
          <span className="flex flex-col items-start gap-1.5">
            <StatusSelect lead={lead} busy={saving} onChange={(next) => void change(next)} />
            {lead.conversationId === null ? null : (
              <Link
                to={`/conversations/${lead.conversationId}`}
                className="inline-flex items-center gap-1.5 text-xs text-muted hover:text-accent"
              >
                <IconConversations className="size-3.5" />
                Переписка
              </Link>
            )}
          </span>
        </TD>
      </TR>

      {/*
        Раскрытая карточка — отдельная строка во всю ширину таблицы.
        `colSpan` компонент `TD` не умеет, а заводить его ради одного места
        значит усложнить общий кирпичик — здесь достаточно обычной ячейки.
      */}
      {open ? (
        <tr className="border-b border-line last:border-0">
          <td colSpan={7} className="bg-canvas px-4 py-4">
            <LeadDetails lead={lead} />
          </td>
        </tr>
      ) : null}
    </>
  )
}

/**
 * Статус меняется прямо в списке — без перехода в карточку: обзвон идёт
 * строка за строкой, и лишний переход стоит дороже красивой формы.
 *
 * Это `<select>`, а не `Select` из `ui`: в таблице подпись поля лишняя,
 * её роль играет заголовок колонки, а доступное имя даёт `aria-label`.
 */
function StatusSelect({
  lead,
  busy,
  onChange,
}: {
  lead: LeadRow
  busy: boolean
  onChange: (status: LeadStatus) => void
}): ReactElement {
  return (
    <select
      value={lead.status}
      disabled={busy}
      aria-label={`Статус лида ${lead.name}`}
      aria-busy={busy || undefined}
      onChange={(event) => onChange(event.target.value as LeadStatus)}
      className={cx(
        'min-h-9 cursor-pointer appearance-none rounded-xl border border-line bg-surface px-3 py-1.5',
        'text-sm text-ink transition-colors duration-150 hover:border-faint',
        'disabled:cursor-not-allowed disabled:bg-canvas disabled:text-muted',
      )}
    >
      {LEAD_STATUSES.map((item) => (
        <option key={item} value={item}>
          {LEAD_STATUS_LABELS[item]}
        </option>
      ))}
    </select>
  )
}

/**
 * Ширина карточек в раскрытой строке.
 *
 * Подробности живут внутри таблицы, а та прокручивается вбок: ширина ячейки
 * равна ширине таблицы, а не экрана. Сетка карточек считает столбцы по
 * контейнеру — и честно строила бы два столбца, второй из которых оказывается
 * за краем экрана. Ограничение по `100vw` возвращает раскладке ту ширину,
 * которую человек действительно видит.
 *
 * Вычитаемое — то, что съедает ширину до ячейки: до `lg` это отступы страницы
 * и ячейки (5rem), с `lg` к ним добавляется закреплённое меню на 16rem (итого
 * 22rem) — без этой поправки на ноутбуке в 1024 px предел вышел бы шире
 * видимой части.
 */
const DETAILS_WIDTH = 'max-w-[min(48rem,calc(100vw-5rem))] lg:max-w-[min(48rem,calc(100vw-22rem))]'

function LeadDetails({ lead }: { lead: LeadRow }): ReactElement {
  const selected = lead.selectedApartments ?? []

  return (
    <div className="flex flex-col gap-4 py-1">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={LEAD_STATUS_TONES[lead.status]}>{LEAD_STATUS_LABELS[lead.status]}</Badge>
        {lead.consentAt === null ? null : (
          <span className="text-xs text-faint">
            Согласие на обработку данных: {formatDateTime(lead.consentAt)}
          </span>
        )}
      </div>

      {lead.webhookStatus === 'failed' ? (
        <Alert tone="danger" title="Заявка не ушла в CRM">
          {lead.webhookError ?? 'Вебхук не принял заявку.'}
          {lead.webhookAt === null ? null : ` Последняя попытка: ${formatDateTime(lead.webhookAt)}.`} Перенесите
          заявку руками.
        </Alert>
      ) : null}

      {/* Выбранное стоит выше просмотренного и подписано отдельно: это то,
          ради чего звонок и нужен, а не двадцать карточек, среди которых
          менеджер угадывает нужную.

          Ширину ограничивает сам выделенный блок, а не сетка внутри: иначе
          цветной фон тянется на всю таблицу, а карточки кончаются на середине,
          и справа остаётся пустая подсветка. */}
      {selected.length === 0 ? null : (
        <div className={cx(DETAILS_WIDTH, 'rounded-xl border border-accent/40 bg-accent-soft p-3')}>
          <p className="text-xs font-medium text-accent">
            Выбрал {pluralize(selected.length, ['квартиру', 'квартиры', 'квартир'])} кнопкой в чате
          </p>
          <ApartmentCards apartments={selected} emphasis="strong" className="mt-2" />
        </div>
      )}

      {lead.comment === null ? null : (
        <div>
          <p className="text-xs text-faint">Комментарий</p>
          <p className="mt-1 text-sm leading-relaxed whitespace-pre-wrap text-ink">{lead.comment}</p>
        </div>
      )}

      <div>
        <p className="text-xs text-faint">
          {lead.apartments.length === 0
            ? 'Квартиры в диалоге не показывали'
            : `Смотрел ${pluralize(lead.apartments.length, ['квартиру', 'квартиры', 'квартир'])}`}
        </p>
        <ApartmentCards apartments={lead.apartments} className={cx('mt-2', DETAILS_WIDTH)} />
      </div>

      {lead.conversation === null ? null : (
        <dl className="flex flex-wrap gap-x-8 gap-y-2 text-sm">
          <div>
            <dt className="text-xs text-faint">Страница входа</dt>
            <dd className="mt-0.5 break-all text-muted">{lead.conversation.page ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-faint">Переход с</dt>
            <dd className="mt-0.5 break-all text-muted">{lead.conversation.referrer ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-faint">UTM-метки</dt>
            <dd className="mt-0.5 text-muted">{utmSummary(lead.conversation.utm) ?? '—'}</dd>
          </div>
          <div>
            <dt className="text-xs text-faint">Сообщений в диалоге</dt>
            <dd className="tabular mt-0.5 text-muted">{formatNumber(lead.conversation.messageCount)}</dd>
          </div>
        </dl>
      )}

      {lead.conversationId === null ? null : (
        <Link
          to={`/conversations/${lead.conversationId}`}
          className="inline-flex items-center gap-1.5 self-start text-sm text-accent hover:text-accent-strong"
        >
          <IconConversations className="size-4" />
          Открыть переписку целиком
        </Link>
      )}
    </div>
  )
}
