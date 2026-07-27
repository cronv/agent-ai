import type { ReactElement } from 'react'

import { errorMessage } from '../lib/api.js'
import { formatNumber, formatRelative, plural, pluralize } from '../lib/format.js'
import { useApiQuery } from '../lib/useApiQuery.js'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  IconAlert,
  IconCheck,
  IconClock,
  IconFeeds,
  IconRefresh,
  PageHeader,
  StatCard,
  StatCardSkeleton,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '../ui/index.js'

/**
 * Дашборд — первое, что видит человек после входа.
 *
 * Отвечает на четыре вопроса: пишут ли в чат, оставляют ли контакты,
 * есть ли что показывать (квартиры и ЖК) и не сломались ли выгрузки.
 * Сломанный фид не прячется в общем списке, а поднимается наверх отдельным
 * предупреждением — иначе о нём узнают через неделю по пустой подборке.
 */

interface FeedHealth {
  id: string
  name: string
  isActive: boolean
  lastRunAt: string | null
  lastStatus: 'ok' | 'error' | 'running' | null
  lastError: string | null
  lastCount: number | null
}

interface DashboardSummary {
  generatedAt: string
  periodDays: number
  periodSince: string
  conversations: { period: number; total: number }
  leads: { period: number; total: number; new: number }
  apartments: { active: number }
  projects: { active: number; total: number }
  feeds: FeedHealth[]
}

export function DashboardPage(): ReactElement {
  const { data, error, loading, refreshing, reload } = useApiQuery<DashboardSummary>('/dashboard')

  const brokenFeeds = data?.feeds.filter((feed) => feed.lastStatus === 'error') ?? []
  const isEmptyProject =
    data !== null &&
    data.conversations.total === 0 &&
    data.leads.total === 0 &&
    data.apartments.active === 0 &&
    data.feeds.length === 0

  return (
    <>
      <PageHeader
        title="Дашборд"
        description={
          data
            ? `Посчитано ${formatRelative(data.generatedAt).toLowerCase()}`
            : 'Главные числа по ассистенту за последнюю неделю'
        }
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={reload}
            loading={refreshing}
            icon={<IconRefresh className="size-4" />}
          >
            Обновить
          </Button>
        }
      />

      {error ? (
        <Alert
          tone="danger"
          title="Не удалось загрузить данные"
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Повторить
            </Button>
          }
        >
          {errorMessage(error)}
        </Alert>
      ) : null}

      {brokenFeeds.length > 0 ? (
        <Alert
          tone="danger"
          title={`${pluralize(brokenFeeds.length, ['фид не обновился', 'фида не обновились', 'фидов не обновились'])}`}
        >
          <ul className="flex flex-col gap-1">
            {brokenFeeds.map((feed) => (
              <li key={feed.id}>
                <span className="font-medium">{feed.name}</span>
                {feed.lastError ? ` — ${feed.lastError}` : null}
              </li>
            ))}
          </ul>
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {loading ? (
          <>
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
            <StatCardSkeleton />
          </>
        ) : (
          <>
            <StatCard
              label="Диалоги за 7 дней"
              value={formatNumber(data?.conversations.period ?? 0)}
              hint={`всего ${formatNumber(data?.conversations.total ?? 0)}`}
            />
            <StatCard
              label="Лиды за 7 дней"
              value={formatNumber(data?.leads.period ?? 0)}
              tone={(data?.leads.period ?? 0) > 0 ? 'accent' : 'neutral'}
              hint={
                (data?.leads.new ?? 0) > 0
                  ? `${formatNumber(data?.leads.new ?? 0)} ${plural(data?.leads.new ?? 0, ['новый', 'новых', 'новых'])} в работе`
                  : `всего ${formatNumber(data?.leads.total ?? 0)}`
              }
            />
            <StatCard
              label="Квартир в продаже"
              value={formatNumber(data?.apartments.active ?? 0)}
              hint="активных лотов из фидов"
            />
            <StatCard
              label="Жилых комплексов"
              value={formatNumber(data?.projects.active ?? 0)}
              hint={
                (data?.projects.total ?? 0) > (data?.projects.active ?? 0)
                  ? `${formatNumber((data?.projects.total ?? 0) - (data?.projects.active ?? 0))} скрыто`
                  : 'все показываются в чате'
              }
            />
          </>
        )}
      </div>

      <Card padded={false}>
        <div className="p-5 sm:p-6">
          <CardHeader
            title="Выгрузки застройщиков"
            description="Откуда берутся квартиры и когда данные обновлялись в последний раз."
          />
        </div>

        {loading ? (
          <div className="border-t border-line px-5 py-10">
            <div className="flex flex-col gap-3">
              <span className="h-4 w-full animate-pulse rounded bg-canvas" />
              <span className="h-4 w-4/5 animate-pulse rounded bg-canvas" />
              <span className="h-4 w-3/5 animate-pulse rounded bg-canvas" />
            </div>
          </div>
        ) : (data?.feeds.length ?? 0) === 0 ? (
          <div className="border-t border-line">
            <EmptyState
              icon={<IconFeeds className="size-5" />}
              title="Фидов пока нет"
              description="Добавьте ссылку на XML-выгрузку застройщика в разделе «Фиды» — квартиры подтянутся сами и появятся в подборках ассистента."
            />
          </div>
        ) : (
          <div className="border-t border-line">
            <Table>
              <THead>
                <TH>Фид</TH>
                <TH>Состояние</TH>
                <TH>Обновлён</TH>
                <TH align="right">Квартир</TH>
              </THead>
              <TBody>
                {data?.feeds.map((feed) => (
                  <TR key={feed.id} highlighted={feed.lastStatus === 'error'}>
                    <TD>
                      <span className="font-medium text-ink">{feed.name}</span>
                      {feed.lastStatus === 'error' && feed.lastError ? (
                        <span className="mt-0.5 block text-xs leading-relaxed text-danger">
                          {feed.lastError}
                        </span>
                      ) : null}
                    </TD>
                    <TD>
                      <FeedStatusBadge feed={feed} />
                    </TD>
                    <TD className="whitespace-nowrap text-muted">{formatRelative(feed.lastRunAt)}</TD>
                    <TD align="right" numeric className="text-muted">
                      {feed.lastCount === null ? '—' : formatNumber(feed.lastCount)}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Card>

      {isEmptyProject ? (
        <Card>
          <CardHeader
            title="Данных пока нет — это нормально"
            description="Ассистент заработает, как только появится, что показывать. Порядок такой:"
          />
          <ol className="mt-4 flex flex-col gap-2.5 text-sm text-muted">
            <li className="flex gap-3">
              <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-canvas text-xs font-medium text-muted">
                1
              </span>
              <span>
                <span className="font-medium text-ink">Фиды</span> — добавьте выгрузку застройщика,
                чтобы в базе появились квартиры.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-canvas text-xs font-medium text-muted">
                2
              </span>
              <span>
                <span className="font-medium text-ink">База знаний</span> — загрузите презентации и
                условия ипотеки, чтобы ассистент отвечал на вопросы.
              </span>
            </li>
            <li className="flex gap-3">
              <span className="tabular flex size-6 shrink-0 items-center justify-center rounded-full bg-canvas text-xs font-medium text-muted">
                3
              </span>
              <span>
                <span className="font-medium text-ink">Настройки</span> — впишите ключ Claude и
                поставьте виджет на сайт. Диалоги и лиды появятся здесь сами.
              </span>
            </li>
          </ol>
        </Card>
      ) : null}
    </>
  )
}

function FeedStatusBadge({ feed }: { feed: FeedHealth }): ReactElement {
  if (!feed.isActive) return <Badge tone="neutral">выключен</Badge>
  if (feed.lastStatus === 'error') {
    return (
      <Badge tone="danger" icon={<IconAlert className="size-3.5" />}>
        ошибка
      </Badge>
    )
  }
  if (feed.lastStatus === 'running') {
    return (
      <Badge tone="accent" icon={<IconClock className="size-3.5" />}>
        обновляется
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
