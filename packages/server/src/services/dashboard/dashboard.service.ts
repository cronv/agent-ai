import type { Db } from '../../db/prisma.js'

/**
 * Числа для главной страницы админки.
 *
 * Отвечает на вопрос «что происходит» одним взглядом: сколько людей
 * писало в чат и сколько оставило контакты за неделю, сколько квартир
 * и ЖК в базе, живы ли выгрузки застройщиков.
 *
 *   const summary = await getDashboardSummary(app.prisma)
 */

/** Период, за который считаются диалоги и лиды на дашборде. */
export const DASHBOARD_PERIOD_DAYS = 7

export interface FeedHealth {
  id: string
  name: string
  isActive: boolean
  /** Когда фид обновлялся в последний раз. `null` — ни разу. */
  lastRunAt: string | null
  lastStatus: 'ok' | 'error' | 'running' | null
  /** Текст последней ошибки. Не `null` — фид требует внимания. */
  lastError: string | null
  /** Сколько квартир пришло в последний раз. */
  lastCount: number | null
}

export interface DashboardSummary {
  generatedAt: string
  periodDays: number
  /** Начало периода — от него считаются «за 7 дней». */
  periodSince: string
  conversations: { period: number; total: number }
  leads: { period: number; total: number; new: number }
  apartments: { active: number }
  projects: { active: number; total: number }
  feeds: FeedHealth[]
}

export interface DashboardOptions {
  /** Момент отсчёта. Нужен тестам, чтобы период не зависел от часов машины. */
  now?: Date
  periodDays?: number
}

export async function getDashboardSummary(db: Db, options: DashboardOptions = {}): Promise<DashboardSummary> {
  const now = options.now ?? new Date()
  const periodDays = options.periodDays ?? DASHBOARD_PERIOD_DAYS
  const since = new Date(now.getTime() - periodDays * 24 * 60 * 60 * 1000)

  const [
    conversationsPeriod,
    conversationsTotal,
    leadsPeriod,
    leadsTotal,
    leadsNew,
    apartmentsActive,
    projectsActive,
    projectsTotal,
    feeds,
  ] = await Promise.all([
    db.conversation.count({ where: { startedAt: { gte: since } } }),
    db.conversation.count(),
    db.lead.count({ where: { createdAt: { gte: since } } }),
    db.lead.count(),
    db.lead.count({ where: { status: 'new' } }),
    db.apartment.count({ where: { isActive: true } }),
    db.project.count({ where: { isActive: true } }),
    db.project.count(),
    db.feed.findMany({
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      select: {
        id: true,
        name: true,
        isActive: true,
        lastRunAt: true,
        lastStatus: true,
        lastError: true,
        lastCount: true,
      },
    }),
  ])

  return {
    generatedAt: now.toISOString(),
    periodDays,
    periodSince: since.toISOString(),
    conversations: { period: conversationsPeriod, total: conversationsTotal },
    leads: { period: leadsPeriod, total: leadsTotal, new: leadsNew },
    apartments: { active: apartmentsActive },
    projects: { active: projectsActive, total: projectsTotal },
    feeds: feeds.map((feed) => ({
      id: feed.id,
      name: feed.name,
      isActive: feed.isActive,
      lastRunAt: feed.lastRunAt ? feed.lastRunAt.toISOString() : null,
      lastStatus: feed.lastStatus,
      lastError: feed.lastError,
      lastCount: feed.lastCount,
    })),
  }
}
