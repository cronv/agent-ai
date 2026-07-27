import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { Link } from 'react-router-dom'

import { errorMessage } from '../lib/api.js'
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
  IconSearch,
  LoadingBlock,
  PageHeader,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '../ui/index.js'
import { FilterChips } from './FilterChips.js'
import { Pager } from './Pager.js'
import type { ConversationListResponse, ConversationRow, LeadPresence } from './dialog-view.js'
import { LEAD_STATUS_LABELS, LEAD_STATUS_TONES, shortUrl, utmSummary } from './dialog-view.js'

/**
 * Раздел «Переписки»: список диалогов посетителей с ассистентом.
 *
 * Список отвечает на один вопрос — какую переписку открыть. Поэтому в строке
 * первое сообщение человека (по нему диалог узнаётся), сколько квартир ему
 * показали и оставил ли он контакт. Всё остальное — внутри диалога.
 *
 * Поиск ищет и по тексту сообщений, и по имени с телефоном лида: бывает
 * «я вам вчера писал про Северный» — и найти нужно по обрывку фразы.
 */

const PAGE_SIZE = 50

type LeadFilter = '' | LeadPresence

export function ConversationsPage(): ReactElement {
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [from, setFrom] = useState('')
  const [to, setTo] = useState('')
  const [lead, setLead] = useState<LeadFilter>('')
  const [offset, setOffset] = useState(0)

  // Запрос набирают по букве — ждём паузу, чтобы не звать сервер на каждую.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 400)
    return () => clearTimeout(timer)
  }, [search])

  // Сменили фильтр — вернулись на первую страницу: третья страница прошлой
  // выборки к новой отношения не имеет.
  useEffect(() => {
    setOffset(0)
  }, [query, from, to, lead])

  const path = useMemo(() => {
    const params = new URLSearchParams()
    if (query !== '') params.set('q', query)
    if (from !== '') params.set('from', from)
    if (to !== '') params.set('to', to)
    if (lead !== '') params.set('lead', lead)
    params.set('limit', String(PAGE_SIZE))
    if (offset > 0) params.set('offset', String(offset))
    return `/conversations?${params.toString()}`
  }, [query, from, to, lead, offset])

  const { data, error, loading, refreshing, reload } = useApiQuery<ConversationListResponse>(path)

  const filtered = query !== '' || from !== '' || to !== '' || lead !== ''

  function resetFilters(): void {
    setSearch('')
    setQuery('')
    setFrom('')
    setTo('')
    setLead('')
  }

  return (
    <>
      <PageHeader
        title="Переписки"
        description={
          data
            ? `${pluralize(data.counts.all, ['диалог', 'диалога', 'диалогов'])}, из них ${formatNumber(
                data.counts.withLead,
              )} с контактом`
            : 'Диалоги посетителей с ассистентом целиком.'
        }
      />

      {error ? (
        <Alert
          tone="danger"
          title="Не удалось загрузить переписки"
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Повторить
            </Button>
          }
        >
          {errorMessage(error)}
        </Alert>
      ) : null}

      <Card padded={false}>
        <div className="flex flex-wrap items-end gap-4 p-5 sm:p-6">
          <Field
            label="Поиск"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ипотека, Петров, 912 345"
            hint="По тексту сообщений, имени и телефону"
            className="w-full sm:w-72"
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
          <FilterChips<LeadFilter>
            legend="Контакт"
            value={lead}
            onChange={setLead}
            options={[
              { value: '', label: 'Все', count: data?.counts.all },
              { value: 'with', label: 'С контактом', count: data?.counts.withLead },
              { value: 'without', label: 'Без контакта', count: data?.counts.withoutLead },
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
            <LoadingBlock label="Загружаю переписки…" />
          </div>
        ) : (data?.conversations.length ?? 0) === 0 ? (
          <div className="border-t border-line">
            <EmptyState
              icon={<IconSearch className="size-5" />}
              title={filtered ? 'Под фильтр ничего не подошло' : 'Переписок пока нет'}
              description={
                filtered
                  ? 'Попробуйте другое слово или расширьте период.'
                  : 'Диалоги появятся здесь, как только посетители начнут писать в чат на сайте.'
              }
            />
          </div>
        ) : (
          <div className={cx('border-t border-line', refreshing && 'opacity-60')}>
            <Table>
              <THead>
                <TH>Переписка</TH>
                <TH align="right">Сообщений</TH>
                <TH align="right">Показано квартир</TH>
                <TH>Контакт</TH>
                <TH>Страница входа</TH>
              </THead>
              <TBody>
                {data?.conversations.map((conversation) => (
                  <ConversationTableRow key={conversation.id} conversation={conversation} query={query} />
                ))}
              </TBody>
            </Table>

            <Pager
              total={data?.total ?? 0}
              limit={data?.limit ?? PAGE_SIZE}
              offset={offset}
              loading={refreshing}
              onChange={setOffset}
              unit={['диалог', 'диалога', 'диалогов']}
            />
          </div>
        )}
      </Card>
    </>
  )
}

function ConversationTableRow({
  conversation,
  query,
}: {
  conversation: ConversationRow
  query: string
}): ReactElement {
  const page = shortUrl(conversation.page)
  const utm = utmSummary(conversation.utm)
  // Поисковый запрос уезжает в адрес диалога — там он подсветит совпадения.
  const href = `/conversations/${conversation.id}${query === '' ? '' : `?q=${encodeURIComponent(query)}`}`

  return (
    <TR>
      <TD>
        <Link to={href} className="group block max-w-md">
          <span className="block text-xs text-faint">{formatDateTime(conversation.startedAt)}</span>
          <span className="mt-0.5 line-clamp-2 block text-sm font-medium text-ink group-hover:text-accent">
            {conversation.firstMessage ?? 'Без сообщений'}
          </span>
        </Link>
      </TD>

      <TD align="right" numeric className="text-muted">
        {formatNumber(conversation.messageCount)}
      </TD>

      <TD align="right" numeric className="text-muted">
        {conversation.apartmentsShown === 0 ? '—' : formatNumber(conversation.apartmentsShown)}
      </TD>

      <TD>
        {conversation.lead === null ? (
          <span className="text-sm text-faint">—</span>
        ) : (
          <span className="flex flex-col items-start gap-1">
            <span className="text-sm font-medium text-ink">{conversation.lead.name}</span>
            <a
              href={`tel:${conversation.lead.phone}`}
              className="tabular text-sm text-accent hover:text-accent-strong"
            >
              {conversation.lead.phoneFormatted}
            </a>
            <Badge tone={LEAD_STATUS_TONES[conversation.lead.status]}>
              {LEAD_STATUS_LABELS[conversation.lead.status]}
            </Badge>
          </span>
        )}
      </TD>

      <TD>
        {page === null ? (
          <span className="text-sm text-faint">—</span>
        ) : (
          <span
            className="block max-w-56 truncate text-sm text-muted"
            title={conversation.page ?? undefined}
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
    </TR>
  )
}
