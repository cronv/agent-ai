import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'

import { api, errorMessage } from '../lib/api.js'
import { formatNumber, pluralize } from '../lib/format.js'
import type { ProjectFeedRef, ProjectView } from './project-view.js'
import { Alert, ConfirmDialog, Toggle } from '../ui/index.js'

/**
 * Подтверждение удаления ЖК — одно на список и на карточку.
 *
 * Удаление необратимо и уносит квартиры комплекса, поэтому в окне сказано
 * ровно то, что человеку нужно знать до нажатия: сколько квартир пропадёт,
 * что переписки и документы останутся и вернётся ли ЖК из живой выгрузки.
 *
 * ── Про выгрузку ───────────────────────────────────────────────────────────
 *
 * Удалённый ЖК заводится заново на ближайшей синхронизации — по названию из
 * файла. Выключить выгрузку можно прямо отсюда, но предлагается это только
 * тогда, когда она кормит один этот комплекс: обычная выгрузка застройщика
 * заводит их пачкой, и остановка ради одной мусорной записи заморозила бы
 * цены и остатки по всему остальному каталогу. Когда ЖК в выгрузке не один,
 * переключатель выключен и рядом написано, скольких ещё это коснётся.
 *
 * Порядок действий тоже не случайный: сначала удаление, и только потом
 * выключение выгрузки. Наоборот — значит при неудавшемся удалении оставить
 * администратора с выключенным фидом и целым ЖК.
 */

/** Сколько ЖК кормит самая «населённая» из этих выгрузок. */
function maxProjects(feeds: ProjectFeedRef[]): number {
  return feeds.reduce((most, feed) => Math.max(most, feed.projectCount), 0)
}

export function ProjectDeleteDialog({
  project,
  onClose,
  onDeleted,
}: {
  /** Что удаляем. `null` — окно закрыто. */
  project: ProjectView | null
  onClose: () => void
  /** Удалилось. Список обновляется, карточка уходит назад к списку. */
  onDeleted: (project: ProjectView) => void
}): ReactElement | null {
  const liveFeeds = project?.feeds.filter((feed) => feed.isActive) ?? []
  const sharedFeeds = liveFeeds.filter((feed) => feed.projectCount > 1)
  const onlyOurs = liveFeeds.length > 0 && sharedFeeds.length === 0

  const [stopFeeds, setStopFeeds] = useState(onlyOurs)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | null>(null)

  // Открыли окно на другом ЖК — предложение выключить выгрузку считается заново.
  useEffect(() => {
    setStopFeeds(onlyOurs)
    setFailure(null)
  }, [project?.id, onlyOurs])

  if (!project) return null

  async function remove(target: ProjectView): Promise<void> {
    setBusy(true)
    setFailure(null)
    try {
      // `force` — только когда администратор видел предупреждение про выгрузку.
      // Иначе сервер имеет полное право отказать: его данные свежее наших.
      await api.delete(`/projects/${target.id}${liveFeeds.length > 0 ? '?force=true' : ''}`)
      if (stopFeeds) {
        for (const feed of liveFeeds) await api.patch(`/feeds/${feed.id}`, { isActive: false })
      }
      onDeleted(target)
    } catch (cause) {
      setFailure(errorMessage(cause))
    } finally {
      setBusy(false)
    }
  }

  return (
    <ConfirmDialog
      open
      title={`Удалить «${project.name}»?`}
      confirmLabel="Удалить ЖК"
      loading={busy}
      onConfirm={() => void remove(project)}
      onClose={onClose}
    >
      <p>
        {project.apartments.total > 0 ? (
          <>
            {/* «Пропадёт 1 квартира» и «пропадут 158 квартир» — согласование
                по числу, иначе окно выглядит недоделанным ровно там, где от
                него ждут внимательности. */}
            Вместе с комплексом из базы {project.apartments.total % 10 === 1 &&
            project.apartments.total % 100 !== 11
              ? 'пропадёт'
              : 'пропадут'}{' '}
            <span className="font-medium text-ink">
              {pluralize(project.apartments.total, ['квартира', 'квартиры', 'квартир'])}
            </span>
            {project.apartments.active > 0
              ? `, из них ${formatNumber(project.apartments.active)} сейчас в продаже`
              : null}
            . Действие необратимо.
          </>
        ) : (
          <>У этого ЖК нет ни одной квартиры — пропадёт только его карточка. Действие необратимо.</>
        )}
      </p>
      <p className="mt-2">
        Переписки, лиды и документы базы знаний останутся на месте. Если ЖК нужно только убрать из чата, не
        удаляйте его — выключите переключателем «В чате».
      </p>

      {liveFeeds.length > 0 ? (
        <div className="mt-4 rounded-xl border border-warn/30 bg-warn-soft p-4">
          <p className="text-ink">
            Квартиры этого ЖК приходят из {liveFeeds.length === 1 ? 'включённой выгрузки' : 'включённых выгрузок'}{' '}
            <span className="font-medium">{liveFeeds.map((feed) => `«${feed.name}»`).join(', ')}</span>. Ближайшая
            синхронизация заведёт комплекс заново по названию из файла — вместе со всеми квартирами.
          </p>
          <Toggle
            className="mt-3"
            checked={stopFeeds}
            onChange={setStopFeeds}
            label={liveFeeds.length === 1 ? 'Выключить эту выгрузку' : 'Выключить эти выгрузки'}
            hint={
              sharedFeeds.length > 0 ? (
                <>
                  Осторожно: из{' '}
                  {sharedFeeds.length === 1 ? 'этой выгрузки приходит' : 'этих выгрузок приходят'} всего{' '}
                  {pluralize(maxProjects(sharedFeeds), ['жилой комплекс', 'жилых комплекса', 'жилых комплексов'])}.
                  Выключив её, вы остановите обновление цен и остатков и по остальным.
                </>
              ) : stopFeeds ? (
                'Выгрузка остановится, ЖК не вернётся. Включить обратно можно в разделе «Фиды».'
              ) : (
                'Выгрузка останется включённой, и ЖК появится снова при следующем обновлении.'
              )
            }
          />
        </div>
      ) : null}

      {failure ? (
        <Alert tone="danger" className="mt-4">
          {failure}
        </Alert>
      ) : null}
    </ConfirmDialog>
  )
}
