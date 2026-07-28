import type { ReactElement, ReactNode } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'

import { errorMessage } from '../lib/api.js'
import { cx } from '../lib/cx.js'
import { formatDateTime, formatNumber, pluralize } from '../lib/format.js'
import { useApiQuery } from '../lib/useApiQuery.js'
import {
  Alert,
  Badge,
  Button,
  Card,
  CardHeader,
  IconChevronLeft,
  IconExternal,
  LoadingBlock,
  PageHeader,
} from '../ui/index.js'
import { ApartmentCards } from './ApartmentCards.js'
import type { ConversationDetail, ConversationResponse, MessageView } from './dialog-view.js'
import { LEAD_STATUS_LABELS, LEAD_STATUS_TONES, TOOL_LABELS, shortUrl, utmSummary } from './dialog-view.js'

/**
 * Переписка целиком: что человек спрашивал и что ему показали.
 *
 * Главный экран перед звонком. Слева лента диалога с сохранённым порядком и
 * ролями, подборки — карточками квартир, как их видел посетитель. Справа
 * контакт и источник: с какой страницы и по какой метке пришёл человек.
 *
 * Из списка сюда приезжает поисковый запрос (`?q=`) — совпадения подсвечены,
 * иначе в переписке на полсотни реплик нужную фразу приходится искать глазами.
 */

export function ConversationPage(): ReactElement {
  const { id = '' } = useParams<{ id: string }>()
  const [params] = useSearchParams()
  const query = params.get('q') ?? ''

  const { data, error, loading, reload } = useApiQuery<ConversationResponse>(`/conversations/${id}`)

  if (loading) return <LoadingBlock label="Загружаю переписку…" />

  if (error || !data) {
    return (
      <>
        <BackLink />
        <Alert
          tone="danger"
          title="Не удалось открыть переписку"
          action={
            <Button variant="secondary" size="sm" onClick={reload}>
              Повторить
            </Button>
          }
        >
          {error ? errorMessage(error) : 'Такой переписки больше нет.'}
        </Alert>
      </>
    )
  }

  const conversation = data.conversation

  return (
    <>
      <BackLink />

      <PageHeader
        title={`Переписка от ${formatDateTime(conversation.startedAt)}`}
        description={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              {pluralize(conversation.messageCount, ['сообщение', 'сообщения', 'сообщений'])}
            </span>
            <span>
              {conversation.apartmentsShown === 0
                ? 'квартиры не показывали'
                : `показано ${pluralize(conversation.apartmentsShown, ['квартира', 'квартиры', 'квартир'])}`}
            </span>
            <span className="tabular text-faint">
              токены: {formatNumber(conversation.tokensIn)} на вход,{' '}
              {formatNumber(conversation.tokensOut)} на ответ
            </span>
          </span>
        }
      />

      {conversation.truncated ? (
        <Alert tone="warn" title="Показаны не все сообщения">
          Переписка длиннее, чем помещается на экран: видны первые сообщения диалога.
        </Alert>
      ) : null}

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <Card>
          <CardHeader
            title="Диалог"
            description="Сверху вниз, как он шёл: реплики посетителя и ответы ассистента."
          />

          <ol className="mt-5 flex flex-col gap-5">
            {conversation.messages.map((message) => (
              <MessageBubble key={message.id} message={message} query={query} />
            ))}
          </ol>
        </Card>

        <aside className="flex flex-col gap-5">
          <LeadPanel conversation={conversation} />
          <SourcePanel conversation={conversation} />
        </aside>
      </div>
    </>
  )
}

function BackLink(): ReactElement {
  return (
    <Link
      to="/conversations"
      className="inline-flex items-center gap-1.5 self-start text-sm text-muted hover:text-accent"
    >
      <IconChevronLeft className="size-4" />
      Все переписки
    </Link>
  )
}

// ─────────────────────────────────────────────────────────────
//  Лента диалога
// ─────────────────────────────────────────────────────────────

function MessageBubble({ message, query }: { message: MessageView; query: string }): ReactElement {
  const visitor = message.role === 'user'
  const tools = message.tools.filter((tool) => tool.name !== '')

  return (
    <li className={cx('flex flex-col gap-2', visitor ? 'items-end' : 'items-start')}>
      <p className="flex items-center gap-2 text-xs text-faint">
        <span className="font-medium text-muted">{visitor ? 'Посетитель' : 'Ассистент'}</span>
        <time dateTime={message.createdAt}>{formatDateTime(message.createdAt)}</time>
      </p>

      {message.content.trim() === '' ? null : (
        <div
          className={cx(
            'max-w-[46rem] rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap',
            visitor ? 'bg-accent-soft text-ink' : 'border border-line bg-surface text-ink',
          )}
        >
          {highlight(message.content, query)}
        </div>
      )}

      {message.apartments.length > 0 ? (
        <div className="w-full">
          <p className="mb-2 text-xs text-faint">
            Показал {pluralize(message.apartments.length, ['квартиру', 'квартиры', 'квартир'])}
          </p>
          <ApartmentCards apartments={message.apartments} />
        </div>
      ) : null}

      {visitor ? null : (
        <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-faint">
          {tools.map((tool) => (
            <span key={tool.id} className={cx(tool.isError && 'text-danger')}>
              {TOOL_LABELS[tool.name] ?? tool.name}
              {tool.isError ? ' — с ошибкой' : ''}
            </span>
          ))}
          {message.model === null ? null : <span className="tabular">{message.model}</span>}
          {message.tokensIn === null && message.tokensOut === null ? null : (
            <span className="tabular">
              {formatNumber(message.tokensIn ?? 0)} / {formatNumber(message.tokensOut ?? 0)} токенов
            </span>
          )}
        </p>
      )}
    </li>
  )
}

/**
 * Подсветка совпадений поиска. Регистр не важен, спецсимволы запроса
 * экранируются: «+7 (912)» не должно превращаться в регулярное выражение.
 */
function highlight(text: string, query: string): ReactNode {
  const needle = query.trim()
  if (needle.length < 2) return text

  const pattern = new RegExp(`(${needle.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')})`, 'giu')
  const parts = text.split(pattern)
  if (parts.length === 1) return text

  return parts.map((part, index) =>
    index % 2 === 1 ? (
      // Ключ по позиции здесь безопасен: части разбиения не переставляются
      // и не удаляются — текст сообщения неизменен.
      <mark key={index} className="rounded bg-warn-soft px-0.5 text-ink">
        {part}
      </mark>
    ) : (
      part
    ),
  )
}

// ─────────────────────────────────────────────────────────────
//  Боковая колонка
// ─────────────────────────────────────────────────────────────

function LeadPanel({ conversation }: { conversation: ConversationDetail }): ReactElement {
  const lead = conversation.leadCard

  if (lead === null) {
    return (
      <Card>
        <CardHeader title="Контакт" />
        <p className="mt-3 text-sm text-muted">
          Посетитель не оставил телефон. Позвонить не получится — остаётся смотреть, что он искал.
        </p>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        title="Контакт"
        action={<Badge tone={LEAD_STATUS_TONES[lead.status]}>{LEAD_STATUS_LABELS[lead.status]}</Badge>}
      />

      <p className="mt-3 text-base font-medium text-ink">{lead.name}</p>
      <a
        href={`tel:${lead.phone}`}
        className="tabular mt-1 block text-lg font-medium text-accent hover:text-accent-strong"
      >
        {lead.phoneFormatted}
      </a>

      {lead.comment === null ? null : (
        <p className="mt-3 text-sm leading-relaxed text-muted">{lead.comment}</p>
      )}

      {/* Выбранная квартира — главное в карточке контакта: с неё и начинается
          разговор менеджера. Показанные видны ниже, в самой переписке. */}
      {(lead.selectedApartments ?? []).length === 0 ? null : (
        <div className="mt-4 rounded-xl border border-accent/40 bg-accent-soft p-3">
          <p className="text-xs font-medium text-accent">
            Выбрал {pluralize(lead.selectedApartments.length, ['квартиру', 'квартиры', 'квартир'])} кнопкой в чате
          </p>
          <ApartmentCards apartments={lead.selectedApartments} className="mt-2 sm:grid-cols-1" />
        </div>
      )}

      <p className="mt-3 text-xs text-faint">Оставлен {formatDateTime(lead.createdAt)}</p>

      {lead.webhookStatus === 'failed' ? (
        <Alert tone="danger" title="Не ушёл в CRM" className="mt-4">
          {lead.webhookError ?? 'Вебхук не принял заявку.'} Заявку нужно перенести руками.
        </Alert>
      ) : null}

      <Link
        to="/leads"
        className="mt-4 inline-flex items-center gap-1.5 text-sm text-muted hover:text-accent"
      >
        Все лиды
      </Link>
    </Card>
  )
}

function SourcePanel({ conversation }: { conversation: ConversationDetail }): ReactElement {
  const page = shortUrl(conversation.page)
  const utm = utmSummary(conversation.utm)

  return (
    <Card>
      <CardHeader title="Откуда пришёл" />

      <dl className="mt-3 flex flex-col gap-3 text-sm">
        <div>
          <dt className="text-xs text-faint">Страница входа</dt>
          <dd className="mt-0.5">
            {conversation.page === null ? (
              <span className="text-muted">—</span>
            ) : (
              <a
                href={conversation.page}
                target="_blank"
                rel="noreferrer noopener"
                className="inline-flex items-center gap-1.5 text-accent hover:text-accent-strong"
              >
                <span className="break-all">{page}</span>
                <IconExternal className="size-3.5 shrink-0" />
              </a>
            )}
          </dd>
        </div>

        <div>
          <dt className="text-xs text-faint">Переход с</dt>
          <dd className="mt-0.5 break-all text-muted">{shortUrl(conversation.referrer) ?? '—'}</dd>
        </div>

        <div>
          <dt className="text-xs text-faint">UTM-метки</dt>
          <dd className="mt-0.5 text-muted">{utm ?? '—'}</dd>
        </div>

        <div>
          <dt className="text-xs text-faint">Последнее сообщение</dt>
          <dd className="mt-0.5 text-muted">{formatDateTime(conversation.lastMessageAt)}</dd>
        </div>

        <div>
          <dt className="text-xs text-faint">Сессия</dt>
          <dd className="tabular mt-0.5 break-all text-muted">{conversation.sessionId}</dd>
        </div>
      </dl>
    </Card>
  )
}
