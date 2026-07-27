import { schedule as nodeCronSchedule, validate as nodeCronValidate } from 'node-cron'

import type { Db } from '../../db/prisma.js'
import { prisma as defaultPrisma } from '../../db/prisma.js'
import { getSettingDefinition, SettingsService } from '../settings/index.js'
import { describeError } from './parse.js'
import { hasCustomSchedule, syncAllFeeds, syncFeed } from './sync.js'

/**
 * Планировщик обновления фидов.
 *
 *   const scheduler = new FeedScheduler({ db, settings, logger })
 *   await scheduler.start()      // поднять задачи по настройкам
 *   await scheduler.reload()     // расписание поменяли — применить заново
 *   await scheduler.stop()       // остановиться (при выключении приложения)
 *
 * Задачи живут внутри процесса приложения (`node-cron`), отдельного воркера
 * нет: фидов единицы, прогон — редкое фоновое дело.
 *
 * Расписание берётся из настроек (`feed_sync_cron`, по умолчанию каждые три
 * часа). Фид может иметь собственное выражение в `scheduleCron` — тогда он
 * получает отдельную задачу и в общий прогон не попадает.
 *
 * Смена расписания подхватывается без перезапуска приложения двумя путями:
 * явным `reload()` (его зовут маршруты админки после правки фидов и настроек)
 * и фоновой проверкой раз в минуту — так расписание оживёт, даже если кто-то
 * поменял настройку мимо админки, прямо в базе.
 *
 * Ошибки наружу не выходят: упавший прогон пишется в лог, задача остаётся
 * на месте и сработает в следующий раз.
 */

// ── Обёртка над node-cron ───────────────────────────────────

export interface CronTaskHandle {
  stop(): void | Promise<void>
}

/** Всё, что планировщику нужно от node-cron. В тестах подменяется. */
export interface CronAdapter {
  validate(expression: string): boolean
  schedule(expression: string, run: () => void, name: string): CronTaskHandle
}

export const nodeCronAdapter: CronAdapter = {
  validate: (expression) => nodeCronValidate(expression),
  schedule: (expression, run, name) => {
    const task = nodeCronSchedule(expression, () => run(), {
      name,
      // Долгий прогон не должен накладываться сам на себя.
      noOverlap: true,
      // Ожидающая задача не удерживает процесс живым.
      unref: true,
    })
    return {
      stop: async () => {
        await task.destroy()
      },
    }
  },
}

/** Правильно ли записано выражение cron. */
export function isValidCron(expression: string): boolean {
  return nodeCronValidate(expression)
}

/** Расписание по умолчанию — то же, что в настройках. */
export const DEFAULT_FEED_SYNC_CRON: string = getSettingDefinition('feed_sync_cron').default

// ── Планировщик ─────────────────────────────────────────────

/** Подмножество pino: `app.log` подходит как есть. */
export interface SchedulerLogger {
  info(message: string): void
  warn(message: string): void
  error(message: string): void
}

const silentLogger: SchedulerLogger = {
  info: () => undefined,
  warn: () => undefined,
  error: () => undefined,
}

/** Что запускает сработавшая задача. */
export type FeedSyncTask = { kind: 'all' } | { kind: 'feed'; feedId: string; feedName: string }

export interface FeedSchedulerOptions {
  db?: Db
  settings?: SettingsService
  cron?: CronAdapter
  logger?: SchedulerLogger
  /** Что делать при срабатывании задачи. Подменяется в тестах. */
  run?: (task: FeedSyncTask) => Promise<void>
  /**
   * Как часто перечитывать настройки, миллисекунды. `0` — не перечитывать
   * (в тестах, где проверка вызывается вручную).
   */
  watchIntervalMs?: number
}

/** Индивидуальное расписание одного фида. */
export interface FeedSchedule {
  feedId: string
  feedName: string
  cron: string
}

/** Что планировщик делает прямо сейчас. */
export interface FeedSchedulerState {
  /** Задачи подняты. */
  started: boolean
  /** Обновление по расписанию включено настройкой. */
  enabled: boolean
  /** Общее выражение cron; `null`, когда расписание выключено. */
  cron: string | null
  /** Фиды со своим расписанием. */
  feeds: FeedSchedule[]
}

/** Расписание, каким его требуют настройки и база на этот момент. */
interface SchedulerPlan {
  enabled: boolean
  cron: string
  feeds: FeedSchedule[]
}

const DEFAULT_WATCH_INTERVAL_MS = 60_000

export class FeedScheduler {
  private readonly db: Db
  private readonly settings: SettingsService
  private readonly cron: CronAdapter
  private readonly logger: SchedulerLogger
  private readonly run: (task: FeedSyncTask) => Promise<void>
  private readonly watchIntervalMs: number

  private tasks: CronTaskHandle[] = []
  private watcher: NodeJS.Timeout | null = null
  private started = false
  private signature = ''
  private currentState: FeedSchedulerState = { started: false, enabled: false, cron: null, feeds: [] }
  /** Номер поколения задач — только чтобы имена задач не повторялись. */
  private generation = 0

  constructor(options: FeedSchedulerOptions = {}) {
    this.db = options.db ?? defaultPrisma
    this.settings = options.settings ?? new SettingsService({ db: this.db })
    this.cron = options.cron ?? nodeCronAdapter
    this.logger = options.logger ?? silentLogger
    this.run = options.run ?? ((task) => this.defaultRun(task))
    this.watchIntervalMs = options.watchIntervalMs ?? DEFAULT_WATCH_INTERVAL_MS
  }

  /** Что запланировано сейчас. */
  get state(): FeedSchedulerState {
    return this.currentState
  }

  /** Поднимает задачи по текущим настройкам. Ошибка чтения настроек не роняет приложение. */
  async start(): Promise<FeedSchedulerState> {
    this.started = true
    const state = await this.apply()
    this.startWatching()
    return state
  }

  /**
   * Перечитывает настройки и пересобирает задачи.
   * До `start()` ничего не делает — планировщик может быть выключен намеренно.
   */
  async reload(): Promise<FeedSchedulerState> {
    if (!this.started) return this.currentState
    return this.apply()
  }

  /**
   * Сверяет поднятые задачи с настройками и пересобирает их, только если
   * расписание действительно изменилось. Вызывается фоновой проверкой.
   */
  async refresh(): Promise<FeedSchedulerState> {
    if (!this.started) return this.currentState
    let plan: SchedulerPlan
    try {
      plan = await this.readPlan()
    } catch (error) {
      this.logger.error(`Не удалось перечитать расписание фидов: ${describeError(error)}`)
      return this.currentState
    }
    if (planSignature(plan) === this.signature) return this.currentState
    this.logger.info('Расписание обновления фидов изменилось, применяю новое')
    return this.applyPlan(plan)
  }

  /** Останавливает задачи. Вызывается при выключении приложения. */
  async stop(): Promise<void> {
    this.started = false
    this.stopWatching()
    await this.clearTasks()
    this.signature = ''
    this.currentState = { started: false, enabled: false, cron: null, feeds: [] }
  }

  /** Немедленный прогон всех активных фидов — мимо расписания. */
  async runAllNow(): Promise<void> {
    await this.run({ kind: 'all' })
  }

  // ── Внутреннее ────────────────────────────────────────────

  private async apply(): Promise<FeedSchedulerState> {
    let plan: SchedulerPlan
    try {
      plan = await this.readPlan()
    } catch (error) {
      this.logger.error(`Не удалось прочитать расписание фидов: ${describeError(error)}`)
      return this.currentState
    }
    return this.applyPlan(plan)
  }

  /** Читает настройки и индивидуальные расписания фидов. */
  private async readPlan(): Promise<SchedulerPlan> {
    const { feed_sync_cron, feed_sync_enabled } = await this.settings.getMany(
      'feed_sync_cron',
      'feed_sync_enabled',
    )

    let cron = feed_sync_cron.trim()
    if (cron === '' || !this.cron.validate(cron)) {
      if (cron !== '') {
        this.logger.warn(
          `Расписание «${cron}» записано неправильно, беру расписание по умолчанию «${DEFAULT_FEED_SYNC_CRON}»`,
        )
      }
      cron = DEFAULT_FEED_SYNC_CRON
    }

    const rows = await this.db.feed.findMany({
      where: { isActive: true },
      orderBy: { createdAt: 'asc' },
      select: { id: true, name: true, scheduleCron: true },
    })

    const feeds: FeedSchedule[] = []
    for (const row of rows) {
      if (!hasCustomSchedule(row.scheduleCron)) continue
      const expression = String(row.scheduleCron).trim()
      if (!this.cron.validate(expression)) {
        // Испорченное индивидуальное расписание не должно оставить фид без
        // обновления вовсе — он поедет по общему.
        this.logger.warn(`Расписание фида «${row.name}» записано неправильно, беру общее`)
        feeds.push({ feedId: row.id, feedName: row.name, cron })
        continue
      }
      feeds.push({ feedId: row.id, feedName: row.name, cron: expression })
    }

    return { enabled: feed_sync_enabled, cron, feeds }
  }

  private async applyPlan(plan: SchedulerPlan): Promise<FeedSchedulerState> {
    await this.clearTasks()
    this.generation += 1
    this.signature = planSignature(plan)

    if (!plan.enabled) {
      this.logger.info('Обновление фидов по расписанию выключено настройкой')
      this.currentState = { started: this.started, enabled: false, cron: null, feeds: [] }
      return this.currentState
    }

    this.tasks.push(
      this.cron.schedule(plan.cron, () => this.fire({ kind: 'all' }), `feeds-all-${this.generation}`),
    )
    for (const feed of plan.feeds) {
      this.tasks.push(
        this.cron.schedule(
          feed.cron,
          () => this.fire({ kind: 'feed', feedId: feed.feedId, feedName: feed.feedName }),
          `feed-${feed.feedId}-${this.generation}`,
        ),
      )
    }

    this.logger.info(
      `Обновление фидов по расписанию «${plan.cron}»` +
        (plan.feeds.length > 0 ? `, своё расписание у ${plan.feeds.length} фид(ов)` : ''),
    )
    this.currentState = { started: this.started, enabled: true, cron: plan.cron, feeds: plan.feeds }
    return this.currentState
  }

  /** Срабатывание задачи. Синхронно и молча: cron не умеет ждать и не умеет ловить. */
  private fire(task: FeedSyncTask): void {
    void this.run(task).catch((error: unknown) => {
      this.logger.error(`Плановое обновление фидов сорвалось: ${describeError(error)}`)
    })
  }

  private async defaultRun(task: FeedSyncTask): Promise<void> {
    if (task.kind === 'all') {
      const summary = await syncAllFeeds({ db: this.db, skipCustomSchedule: true })
      this.logger.info(
        `Плановое обновление: фидов ${summary.total}, успешно ${summary.ok}, с ошибкой ${summary.failed}` +
          (summary.busy > 0 ? `, пропущено занятых ${summary.busy}` : ''),
      )
      return
    }

    const outcome = await syncFeed(task.feedId, { db: this.db })
    if (outcome.busy) {
      this.logger.warn(`Фид «${task.feedName}» уже обновляется, плановый запуск пропущен`)
      return
    }
    const { result } = outcome
    if (result.status === 'ok') {
      this.logger.info(`Фид «${task.feedName}» обновлён: активных лотов ${result.activeCount}`)
    } else {
      this.logger.error(`Фид «${task.feedName}» не обновился: ${result.error ?? 'причина неизвестна'}`)
    }
  }

  private async clearTasks(): Promise<void> {
    const tasks = this.tasks
    this.tasks = []
    for (const task of tasks) {
      try {
        await task.stop()
      } catch (error) {
        this.logger.warn(`Не удалось остановить задачу расписания: ${describeError(error)}`)
      }
    }
  }

  private startWatching(): void {
    if (this.watcher || this.watchIntervalMs <= 0) return
    this.watcher = setInterval(() => {
      void this.refresh()
    }, this.watchIntervalMs)
    // Проверка расписания не должна удерживать процесс живым.
    this.watcher.unref()
  }

  private stopWatching(): void {
    if (!this.watcher) return
    clearInterval(this.watcher)
    this.watcher = null
  }
}

/** Отпечаток расписания — по нему видно, изменилось ли что-нибудь. */
function planSignature(plan: SchedulerPlan): string {
  const feeds = plan.feeds.map((feed) => `${feed.feedId}:${feed.cron}`).join(',')
  return `${plan.enabled ? 'on' : 'off'}|${plan.cron}|${feeds}`
}
