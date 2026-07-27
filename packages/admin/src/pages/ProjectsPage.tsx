import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { api, errorMessage } from '../lib/api.js'
import { formatMoneyShort, formatNumber, pluralize } from '../lib/format.js'
import { useApiQuery } from '../lib/useApiQuery.js'
import type { ProjectView } from './project-view.js'
import {
  Alert,
  Button,
  Card,
  CardHeader,
  EmptyState,
  IconProjects,
  IconRefresh,
  IconSearch,
  LoadingBlock,
  PageHeader,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
  Toggle,
} from '../ui/index.js'

/**
 * Раздел «ЖК» — список жилых комплексов.
 *
 * ЖК заводит импорт фида: в выгрузке есть название, цены и планировки, но нет
 * ни района, ни метро, ни срока сдачи. Поэтому список — это витрина «что уже
 * заполнено», а дополняется карточка внутри.
 *
 * Переключатель в строке — самое частое здесь действие: выключенный ЖК
 * ассистент перестаёт предлагать, а квартиры и переписки остаются целы.
 */

export function ProjectsPage(): ReactElement {
  const { data, error, loading, refreshing, reload } = useApiQuery<{ projects: ProjectView[] }>('/projects')
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState<string | null>(null)
  const [failure, setFailure] = useState<string | null>(null)

  const projects = data?.projects ?? []

  const found = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (needle === '') return projects
    return projects.filter((project) =>
      [project.name, project.developer, project.district, project.metro]
        .filter((value): value is string => typeof value === 'string')
        .some((value) => value.toLowerCase().includes(needle)),
    )
  }, [projects, query])

  const hidden = projects.filter((project) => !project.isActive).length

  async function toggleActive(project: ProjectView, isActive: boolean): Promise<void> {
    setBusy(project.id)
    setFailure(null)
    try {
      await api.post(`/projects/${project.id}/active`, { isActive })
      reload()
    } catch (cause) {
      setFailure(errorMessage(cause))
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <PageHeader
        title="ЖК"
        description="Жилые комплексы приходят из фидов. Здесь их дополняют тем, чего в выгрузке нет: район, метро, срок сдачи, отделка, описание."
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
          title="Не удалось загрузить список ЖК"
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
        <div className="flex flex-wrap items-end justify-between gap-4 p-5 sm:p-6">
          <CardHeader
            title={
              projects.length > 0
                ? pluralize(projects.length, ['жилой комплекс', 'жилых комплекса', 'жилых комплексов'])
                : 'Список ЖК'
            }
            description={
              hidden > 0
                ? `${formatNumber(hidden)} выключено — ассистент их не предлагает`
                : 'Все показываются в чате'
            }
          />

          {projects.length > 3 ? (
            <label className="relative w-full max-w-xs">
              <span className="sr-only">Поиск по ЖК</span>
              <IconSearch className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-faint" />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Название, застройщик, район"
                className="min-h-11 w-full rounded-xl border border-line bg-surface py-2.5 pr-3.5 pl-10 text-sm text-ink transition-colors duration-150 placeholder:text-faint hover:border-faint"
              />
            </label>
          ) : null}
        </div>

        {loading ? (
          <div className="border-t border-line">
            <LoadingBlock label="Загружаю жилые комплексы…" />
          </div>
        ) : projects.length === 0 ? (
          <div className="border-t border-line">
            <EmptyState
              icon={<IconProjects className="size-5" />}
              title="Жилых комплексов пока нет"
              description="ЖК появляются сами, когда обновляется фид застройщика: название берётся из выгрузки, остальное дописывается здесь."
              action={
                <Button size="sm" onClick={() => navigate('/feeds')}>
                  Перейти к фидам
                </Button>
              }
            />
          </div>
        ) : found.length === 0 ? (
          <div className="border-t border-line">
            <EmptyState
              compact
              title="Ничего не нашлось"
              description={`По запросу «${query}» нет ни одного ЖК. Попробуйте короче.`}
            />
          </div>
        ) : (
          <div className="border-t border-line">
            <Table>
              <THead>
                <TH>Название</TH>
                <TH>Застройщик</TH>
                <TH>Район</TH>
                <TH align="right">Квартир</TH>
                <TH align="right">Цены</TH>
                <TH align="center">В чате</TH>
              </THead>
              <TBody>
                {found.map((project) => (
                  <TR key={project.id}>
                    <TD>
                      <Link
                        to={`/projects/${project.id}`}
                        className="font-medium text-ink hover:text-accent"
                      >
                        {project.name}
                      </Link>
                      {project.metro ? (
                        <span className="mt-0.5 block text-xs text-faint">
                          {project.metro}
                          {project.metroDistanceMin === null
                            ? null
                            : `, ${formatNumber(project.metroDistanceMin)} мин`}
                        </span>
                      ) : null}
                    </TD>
                    <TD className="text-muted">{project.developer ?? '—'}</TD>
                    <TD className="text-muted">{project.district ?? '—'}</TD>
                    <TD align="right" numeric className="text-muted">
                      {formatNumber(project.apartments.active)}
                    </TD>
                    <TD align="right" numeric className="whitespace-nowrap text-muted">
                      {project.price === null
                        ? '—'
                        : project.price.min === project.price.max
                          ? formatMoneyShort(project.price.min)
                          : `${formatMoneyShort(project.price.min)} — ${formatMoneyShort(project.price.max)}`}
                    </TD>
                    <TD align="center">
                      <div className="flex justify-center">
                        <Toggle
                          checked={project.isActive}
                          busy={busy === project.id}
                          onChange={(next) => void toggleActive(project, next)}
                          label={
                            project.isActive
                              ? `Скрыть «${project.name}» из чата`
                              : `Показывать «${project.name}» в чате`
                          }
                          hideLabel
                        />
                      </div>
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Card>
    </>
  )
}
