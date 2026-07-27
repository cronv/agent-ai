import { useCallback, useEffect, useRef, useState } from 'react'
import type { ChangeEvent, DragEvent, FormEvent, ReactElement } from 'react'

import { api, errorMessage } from '../lib/api.js'
import { cx } from '../lib/cx.js'
import { formatDateTime, formatNumber, pluralize } from '../lib/format.js'
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
  IconFile,
  IconKnowledge,
  IconRefresh,
  IconSearch,
  IconTrash,
  IconUpload,
  LoadingBlock,
  PageHeader,
  StatCard,
  TBody,
  TD,
  TH,
  THead,
  TR,
  Table,
} from '../ui/index.js'

/**
 * Раздел «База знаний».
 *
 * Человек перетаскивает в окно презентацию застройщика или памятку по ипотеке,
 * выбирает ЖК — и ассистент начинает отвечать по этому файлу.
 *
 * Три блока, ровно в том порядке, в каком с ними работают:
 *   1. загрузка (перетаскиванием или кнопкой, сразу несколько файлов);
 *   2. список документов — что уже лежит в базе и что не прочиталось;
 *   3. проверка поиска — что именно найдёт ассистент по заданному вопросу.
 *
 * Третий блок здесь не для красоты: без него непонятно, помог ли загруженный
 * файл. Вводишь вопрос — видишь фрагменты и документы, из которых они взяты.
 */

const MAX_FILE_BYTES = 20 * 1024 * 1024
const ACCEPT = '.pdf,.docx,.txt,.md,application/pdf,text/plain,text/markdown'

interface KnowledgeDoc {
  id: string
  filename: string
  mimeType: string
  sizeBytes: number
  charCount: number
  chunkCount: number
  status: 'pending' | 'ready' | 'error'
  error: string | null
  projectId: string | null
  projectName: string | null
  createdAt: string
}

interface SearchHit {
  chunkId: string
  docId: string
  documentTitle: string
  projectId: string | null
  projectName: string | null
  content: string
  position: number
  score: number
  matchedBy: 'fulltext' | 'fuzzy'
}

interface ProjectOption {
  id: string
  name: string
}

/** Файл в очереди загрузки: пока грузится и сразу после. */
interface UploadItem {
  id: string
  name: string
  state: 'uploading' | 'done' | 'error'
  message?: string
}

/** «Все ЖК» — отсутствие фильтра, «Общие» — документы без привязки. */
type ProjectFilter = string | null | 'all'

export function KnowledgePage(): ReactElement {
  const [filter, setFilter] = useState<ProjectFilter>('all')
  const path = filter === 'all' ? '/knowledge' : `/knowledge?projectId=${encodeURIComponent(filter ?? '')}`
  const docs = useApiQuery<{ documents: KnowledgeDoc[] }>(path)

  const [projects, setProjects] = useState<ProjectOption[]>([])
  const [uploadProject, setUploadProject] = useState('')
  const [queue, setQueue] = useState<UploadItem[]>([])
  const [dragging, setDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [confirmId, setConfirmId] = useState<string | null>(null)
  const [removingId, setRemovingId] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const fileInput = useRef<HTMLInputElement>(null)

  useEffect(() => {
    let cancelled = false
    api
      .get<unknown>('/projects')
      .then((payload) => {
        if (!cancelled) setProjects(readProjects(payload))
      })
      .catch(() => {
        // Раздел ЖК может быть ещё не заполнен — тогда просто грузим общие документы.
        if (!cancelled) setProjects([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  const documents = docs.data?.documents ?? []
  const totalChunks = documents.reduce((sum, doc) => sum + doc.chunkCount, 0)
  const brokenCount = documents.filter((doc) => doc.status === 'error').length

  const upload = useCallback(
    async (files: File[]) => {
      if (files.length === 0) return
      setActionError(null)
      setUploading(true)

      for (const file of files) {
        const id = `${file.name}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`
        setQueue((items) => [...items, { id, name: file.name, state: 'uploading' }])

        if (file.size > MAX_FILE_BYTES) {
          setQueue((items) =>
            items.map((item) =>
              item.id === id
                ? { ...item, state: 'error', message: 'Файл больше 20 МБ — загрузите поменьше' }
                : item,
            ),
          )
          continue
        }

        const form = new FormData()
        form.append('file', file)
        form.append('projectId', uploadProject)

        try {
          const doc = await api.upload<KnowledgeDoc>('/knowledge', form)
          setQueue((items) =>
            items.map((item) =>
              item.id === id
                ? doc.status === 'error'
                  ? { ...item, state: 'error', message: doc.error ?? 'Файл не прочитался' }
                  : {
                      ...item,
                      state: 'done',
                      message: `${pluralize(doc.chunkCount, ['фрагмент', 'фрагмента', 'фрагментов'])} в базе`,
                    }
                : item,
            ),
          )
        } catch (error) {
          setQueue((items) =>
            items.map((item) => (item.id === id ? { ...item, state: 'error', message: errorMessage(error) } : item)),
          )
        }
      }

      setUploading(false)
      docs.reload()
    },
    [uploadProject, docs],
  )

  function onDrop(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    setDragging(false)
    void upload(Array.from(event.dataTransfer.files))
  }

  function onPick(event: ChangeEvent<HTMLInputElement>): void {
    void upload(Array.from(event.target.files ?? []))
    event.target.value = ''
  }

  async function remove(doc: KnowledgeDoc): Promise<void> {
    setRemovingId(doc.id)
    setActionError(null)
    try {
      await api.delete(`/knowledge/${doc.id}`)
      setConfirmId(null)
      docs.reload()
    } catch (error) {
      setActionError(errorMessage(error))
    } finally {
      setRemovingId(null)
    }
  }

  return (
    <>
      <PageHeader
        title="База знаний"
        description="Презентации, условия ипотеки и памятки, по которым ассистент отвечает на вопросы. Поддерживаются PDF, DOCX, TXT и MD до 20 МБ."
        action={
          <Button
            variant="secondary"
            size="sm"
            onClick={docs.reload}
            loading={docs.refreshing}
            icon={<IconRefresh className="size-4" />}
          >
            Обновить
          </Button>
        }
      />

      {actionError ? <Alert tone="danger" title="Не получилось">{actionError}</Alert> : null}

      {docs.error ? (
        <Alert
          tone="danger"
          title="Не удалось загрузить список документов"
          action={
            <Button variant="secondary" size="sm" onClick={docs.reload}>
              Повторить
            </Button>
          }
        >
          {errorMessage(docs.error)}
        </Alert>
      ) : null}

      {/* ── Загрузка ─────────────────────────────────────────── */}
      <Card>
        <CardHeader
          title="Загрузить документы"
          description="Выберите, к какому ЖК относится файл. Общий документ ассистент использует в разговорах про любой проект."
        />

        <div className="mt-4 flex flex-col gap-4">
          <div className="max-w-sm">
            <Select
              label="К какому ЖК относится"
              value={uploadProject}
              onChange={setUploadProject}
              options={[
                { value: '', label: 'Общий документ — про все ЖК' },
                ...projects.map((project) => ({ value: project.id, label: project.name })),
              ]}
              hint={
                projects.length === 0
                  ? 'ЖК пока не заведены — документ будет общим.'
                  : 'Документ ЖК подтягивается и в разговорах про этот ЖК, и в общем поиске.'
              }
            />
          </div>

          <div
            onDragOver={(event) => {
              event.preventDefault()
              setDragging(true)
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={onDrop}
            className={cx(
              'flex flex-col items-center justify-center gap-3 rounded-2xl border-2 border-dashed px-6 py-10 text-center',
              'transition-colors duration-150',
              dragging ? 'border-accent bg-accent-soft' : 'border-line bg-canvas',
            )}
          >
            <span
              className={cx(
                'flex size-11 items-center justify-center rounded-full transition-colors duration-150',
                dragging ? 'bg-surface text-accent' : 'bg-surface text-faint',
              )}
            >
              <IconUpload className="size-5" />
            </span>
            <p className="text-sm font-medium text-ink">Перетащите файлы сюда</p>
            <p className="max-w-sm text-sm leading-relaxed text-muted">
              Можно сразу несколько. Каждый файл разбирается на фрагменты — по ним ассистент и ищет ответ.
            </p>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={ACCEPT}
              onChange={onPick}
              className="hidden"
            />
            <Button
              size="sm"
              variant="secondary"
              onClick={() => fileInput.current?.click()}
              loading={uploading}
            >
              Выбрать файлы
            </Button>
          </div>

          {queue.length > 0 ? (
            <ul className="flex flex-col gap-2" aria-live="polite">
              {queue.map((item) => (
                <li
                  key={item.id}
                  className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3"
                >
                  <IconFile className="size-4 shrink-0 text-faint" />
                  <span className="min-w-0 flex-1 truncate text-sm text-ink">{item.name}</span>
                  {item.state === 'uploading' ? (
                    <Badge tone="accent" icon={<IconClock className="size-3.5" />}>
                      обрабатывается
                    </Badge>
                  ) : item.state === 'done' ? (
                    <Badge tone="ok" icon={<IconCheck className="size-3.5" />}>
                      готово
                    </Badge>
                  ) : (
                    <Badge tone="danger" icon={<IconAlert className="size-3.5" />}>
                      ошибка
                    </Badge>
                  )}
                  {item.message ? (
                    <span
                      className={cx(
                        'w-full text-xs leading-relaxed sm:w-auto',
                        item.state === 'error' ? 'text-danger' : 'text-muted',
                      )}
                    >
                      {item.message}
                    </span>
                  ) : null}
                </li>
              ))}
              <li>
                <Button variant="ghost" size="sm" onClick={() => setQueue([])} disabled={uploading}>
                  Очистить список
                </Button>
              </li>
            </ul>
          ) : null}
        </div>
      </Card>

      {/* ── Что уже в базе ───────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatCard label="Документов" value={formatNumber(documents.length)} hint="в выбранном фильтре" />
        <StatCard
          label="Фрагментов"
          value={formatNumber(totalChunks)}
          hint="столько кусочков текста ищет ассистент"
        />
        <StatCard
          label="С ошибкой"
          value={formatNumber(brokenCount)}
          tone={brokenCount > 0 ? 'accent' : 'neutral'}
          hint={brokenCount > 0 ? 'причина указана в списке' : 'все файлы прочитались'}
        />
      </div>

      <Card padded={false}>
        <div className="flex flex-wrap items-end justify-between gap-4 p-5 sm:p-6">
          <CardHeader
            title="Документы"
            description="Что уже лежит в базе знаний. Удалённый документ сразу пропадает из ответов ассистента."
          />
          <div className="w-full max-w-xs">
            <Select
              label="Показать"
              value={filter === 'all' ? '__all' : (filter ?? '__common')}
              onChange={(value) =>
                setFilter(value === '__all' ? 'all' : value === '__common' ? null : value)
              }
              options={[
                { value: '__all', label: 'Все документы' },
                { value: '__common', label: 'Только общие' },
                ...projects.map((project) => ({ value: project.id, label: project.name })),
              ]}
            />
          </div>
        </div>

        {docs.loading ? (
          <div className="border-t border-line">
            <LoadingBlock label="Загружаю документы…" />
          </div>
        ) : documents.length === 0 ? (
          <div className="border-t border-line">
            <EmptyState
              icon={<IconKnowledge className="size-5" />}
              title="Документов пока нет"
              description="Перетащите сюда презентацию застройщика или памятку по ипотеке — ассистент начнёт отвечать по ним в тот же момент."
            />
          </div>
        ) : (
          <div className="border-t border-line">
            <Table>
              <THead>
                <TH>Документ</TH>
                <TH>ЖК</TH>
                <TH align="right">Размер</TH>
                <TH align="right">Фрагментов</TH>
                <TH>Загружен</TH>
                <TH>Состояние</TH>
                <TH />
              </THead>
              <TBody>
                {documents.map((doc) => (
                  <TR key={doc.id} highlighted={doc.status === 'error'}>
                    <TD>
                      <span className="font-medium text-ink">{doc.filename}</span>
                      {doc.status === 'error' && doc.error ? (
                        <span className="mt-0.5 block text-xs leading-relaxed text-danger">{doc.error}</span>
                      ) : null}
                    </TD>
                    <TD className="text-muted">{doc.projectName ?? 'Общий'}</TD>
                    <TD align="right" numeric className="whitespace-nowrap text-muted">
                      {formatSize(doc.sizeBytes)}
                    </TD>
                    <TD align="right" numeric className="text-muted">
                      {formatNumber(doc.chunkCount)}
                    </TD>
                    <TD className="whitespace-nowrap text-muted">{formatDateTime(doc.createdAt)}</TD>
                    <TD>
                      <DocStatusBadge status={doc.status} />
                    </TD>
                    <TD align="right">
                      {confirmId === doc.id ? (
                        <span className="flex flex-wrap items-center justify-end gap-2">
                          <span className="text-xs text-muted">Удалить вместе с фрагментами?</span>
                          <Button
                            variant="danger"
                            size="sm"
                            loading={removingId === doc.id}
                            onClick={() => void remove(doc)}
                          >
                            Удалить
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setConfirmId(null)}>
                            Отмена
                          </Button>
                        </span>
                      ) : (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => setConfirmId(doc.id)}
                          icon={<IconTrash className="size-4" />}
                        >
                          Удалить
                        </Button>
                      )}
                    </TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        )}
      </Card>

      <SearchProbe projects={projects} />
    </>
  )
}

/** Проверка поиска: тот же запрос, что уходит от ассистента к базе знаний. */
function SearchProbe({ projects }: { projects: ProjectOption[] }): ReactElement {
  const [query, setQuery] = useState('')
  const [scope, setScope] = useState('')
  const [hits, setHits] = useState<SearchHit[] | null>(null)
  const [asked, setAsked] = useState('')
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function run(event: FormEvent): Promise<void> {
    event.preventDefault()
    const text = query.trim()
    if (text === '') return

    setRunning(true)
    setError(null)
    try {
      const params = new URLSearchParams({ q: text })
      if (scope !== '') params.set('projectId', scope)
      const result = await api.get<{ results: SearchHit[] }>(`/knowledge/search?${params.toString()}`)
      setHits(result.results)
      setAsked(text)
    } catch (cause) {
      setError(errorMessage(cause))
      setHits(null)
    } finally {
      setRunning(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Проверить поиск"
        description="Задайте вопрос так, как его задал бы посетитель, — увидите, какие фрагменты найдёт ассистент и из каких документов."
      />

      <form onSubmit={run} className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5">
          <span className="text-sm font-medium text-ink">Вопрос посетителя</span>
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Например: есть ли рассрочка без процентов?"
            className="w-full rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink transition-colors duration-150 placeholder:text-faint hover:border-faint"
          />
        </label>
        <div className="w-full sm:w-56">
          <Select
            label="Где искать"
            value={scope}
            onChange={setScope}
            options={[
              { value: '', label: 'По всей базе' },
              ...projects.map((project) => ({ value: project.id, label: project.name })),
            ]}
          />
        </div>
        <Button type="submit" loading={running} icon={<IconSearch className="size-4" />}>
          Найти
        </Button>
      </form>

      {error ? (
        <div className="mt-4">
          <Alert tone="danger">{error}</Alert>
        </div>
      ) : null}

      {hits !== null && !error ? (
        hits.length === 0 ? (
          <div className="mt-2">
            <EmptyState
              compact
              icon={<IconSearch className="size-5" />}
              title="Ничего не нашлось"
              description={`По запросу «${asked}» в базе знаний нет подходящих фрагментов. Загрузите документ с этой информацией — или переформулируйте вопрос.`}
            />
          </div>
        ) : (
          <div className="mt-5 flex flex-col gap-3">
            <p className="text-sm text-muted">
              По запросу «{asked}» ассистент увидит{' '}
              {pluralize(hits.length, ['фрагмент', 'фрагмента', 'фрагментов'])}:
            </p>
            {hits.map((hit) => (
              <article key={hit.chunkId} className="rounded-xl border border-line bg-canvas p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium text-ink">{hit.documentTitle}</span>
                  <Badge>{hit.projectName ?? 'Общий'}</Badge>
                  {hit.matchedBy === 'fulltext' ? (
                    <Badge tone="ok" icon={<IconCheck className="size-3.5" />}>
                      точное совпадение
                    </Badge>
                  ) : (
                    <Badge tone="warn">похожее слово</Badge>
                  )}
                  <span className="text-xs text-faint">фрагмент №{hit.position + 1}</span>
                </div>
                <p className="mt-2 text-sm leading-relaxed whitespace-pre-line text-muted">{hit.content}</p>
              </article>
            ))}
          </div>
        )
      ) : null}
    </Card>
  )
}

function DocStatusBadge({ status }: { status: KnowledgeDoc['status'] }): ReactElement {
  if (status === 'ready') {
    return (
      <Badge tone="ok" icon={<IconCheck className="size-3.5" />}>
        в работе
      </Badge>
    )
  }
  if (status === 'error') {
    return (
      <Badge tone="danger" icon={<IconAlert className="size-3.5" />}>
        не прочитался
      </Badge>
    )
  }
  return (
    <Badge tone="accent" icon={<IconClock className="size-3.5" />}>
      обрабатывается
    </Badge>
  )
}

/** Выпадающий список в том же стиле, что и поля ввода из `ui/Field`. */
function Select({
  label,
  value,
  onChange,
  options,
  hint,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  options: { value: string; label: string }[]
  hint?: string
}): ReactElement {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-sm font-medium text-ink">{label}</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="w-full cursor-pointer rounded-xl border border-line bg-surface px-3.5 py-2.5 text-sm text-ink transition-colors duration-150 hover:border-faint"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {hint ? <span className="text-xs leading-relaxed text-muted">{hint}</span> : null}
    </label>
  )
}

/** 2 411 216 → «2,3 МБ». Точность здесь не нужна, нужен порядок величины. */
function formatSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1).replace('.', ',')} МБ`
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} КБ`
  return `${bytes} Б`
}

/**
 * Список ЖК приходит из соседнего раздела. Форма ответа может быть массивом
 * или объектом со списком внутри — берём и то и другое, а если раздела ещё
 * нет, спокойно работаем без него.
 */
function readProjects(payload: unknown): ProjectOption[] {
  const source = Array.isArray(payload)
    ? payload
    : typeof payload === 'object' && payload !== null
      ? ((payload as { projects?: unknown; data?: unknown; items?: unknown }).projects ??
        (payload as { data?: unknown }).data ??
        (payload as { items?: unknown }).items)
      : null

  if (!Array.isArray(source)) return []

  return source
    .filter((item): item is { id: string; name?: unknown } => {
      return typeof item === 'object' && item !== null && typeof (item as { id?: unknown }).id === 'string'
    })
    .map((item) => ({
      id: item.id,
      name: typeof item.name === 'string' && item.name !== '' ? item.name : 'Без названия',
    }))
}
