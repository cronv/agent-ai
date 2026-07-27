import { beforeEach, describe, expect, it } from 'vitest'

import { SettingsService } from '../settings/index.js'
import { resetDatabase, testDb } from '../../testing/db.js'
import {
  DEFAULT_FEED_SYNC_CRON,
  FeedScheduler,
  isValidCron,
  type CronAdapter,
  type CronTaskHandle,
  type FeedSyncTask,
} from './scheduler.js'

/**
 * Планировщик проверяется без часов: вместо node-cron подставляется адаптер,
 * который запоминает выражения и позволяет дёрнуть задачу руками. Так видно
 * то, ради чего планировщик написан, — какое расписание он поднял, что делает
 * при смене настройки и переживает ли падение прогона.
 */

interface FakeTask {
  expression: string
  name: string
  run: () => void
  stopped: boolean
}

class FakeCron implements CronAdapter {
  readonly tasks: FakeTask[] = []

  validate(expression: string): boolean {
    return isValidCron(expression)
  }

  schedule(expression: string, run: () => void, name: string): CronTaskHandle {
    const task: FakeTask = { expression, name, run, stopped: false }
    this.tasks.push(task)
    return {
      stop: () => {
        task.stopped = true
      },
    }
  }

  /** Задачи, которые сейчас живы. */
  get active(): FakeTask[] {
    return this.tasks.filter((task) => !task.stopped)
  }

  get expressions(): string[] {
    return this.active.map((task) => task.expression)
  }
}

function build(
  cron: FakeCron,
  options: { run?: (task: FeedSyncTask) => Promise<void> } = {},
): FeedScheduler {
  return new FeedScheduler({
    db: testDb,
    settings: new SettingsService({ db: testDb }),
    cron,
    watchIntervalMs: 0,
    ...options,
  })
}

async function setCron(expression: string): Promise<void> {
  await new SettingsService({ db: testDb }).set('feed_sync_cron', expression)
}

async function createFeed(name: string, scheduleCron: string | null = null): Promise<string> {
  const feed = await testDb.feed.create({
    data: { name, url: 'https://example.test/feed.xml', scheduleCron },
    select: { id: true },
  })
  return feed.id
}

beforeEach(async () => {
  await resetDatabase()
})

describe('FeedScheduler', () => {
  it('берёт расписание из настроек', async () => {
    await setCron('15 4 * * *')
    const cron = new FakeCron()
    const scheduler = build(cron)

    const state = await scheduler.start()

    expect(state.enabled).toBe(true)
    expect(state.cron).toBe('15 4 * * *')
    expect(cron.expressions).toEqual(['15 4 * * *'])

    await scheduler.stop()
  })

  it('на пустых настройках работает по расписанию по умолчанию', async () => {
    const cron = new FakeCron()
    const scheduler = build(cron)

    const state = await scheduler.start()

    expect(state.cron).toBe(DEFAULT_FEED_SYNC_CRON)
    await scheduler.stop()
  })

  it('негодное выражение в настройках заменяет расписанием по умолчанию', async () => {
    await setCron('каждые три часа, пожалуйста')
    const cron = new FakeCron()
    const scheduler = build(cron)

    const state = await scheduler.start()

    expect(state.cron).toBe(DEFAULT_FEED_SYNC_CRON)
    await scheduler.stop()
  })

  it('с выключенной настройкой не поднимает задач', async () => {
    await new SettingsService({ db: testDb }).set('feed_sync_enabled', false)
    const cron = new FakeCron()
    const scheduler = build(cron)

    const state = await scheduler.start()

    expect(state.enabled).toBe(false)
    expect(cron.active).toHaveLength(0)
    await scheduler.stop()
  })

  it('перезапускается на новом расписании без перезапуска приложения', async () => {
    await setCron('0 */3 * * *')
    const cron = new FakeCron()
    const scheduler = build(cron)
    await scheduler.start()

    await setCron('*/10 * * * *')
    const state = await scheduler.reload()

    expect(state.cron).toBe('*/10 * * * *')
    expect(cron.expressions).toEqual(['*/10 * * * *'])
    expect(cron.tasks.filter((task) => task.stopped)).toHaveLength(1)

    await scheduler.stop()
  })

  it('фоновая проверка подхватывает смену расписания и не трогает задачи без изменений', async () => {
    await setCron('0 */3 * * *')
    const cron = new FakeCron()
    const scheduler = build(cron)
    await scheduler.start()

    await scheduler.refresh()
    expect(cron.tasks).toHaveLength(1)

    await setCron('30 7 * * *')
    const state = await scheduler.refresh()

    expect(state.cron).toBe('30 7 * * *')
    expect(cron.expressions).toEqual(['30 7 * * *'])

    await scheduler.stop()
  })

  it('фиду со своим расписанием даёт отдельную задачу', async () => {
    await setCron('0 */3 * * *')
    const feedId = await createFeed('Особый фид', '5 * * * *')
    const cron = new FakeCron()
    const scheduler = build(cron)

    const state = await scheduler.start()

    expect(state.feeds).toEqual([{ feedId, feedName: 'Особый фид', cron: '5 * * * *' }])
    expect(cron.expressions).toEqual(['0 */3 * * *', '5 * * * *'])

    await scheduler.stop()
  })

  it('негодное расписание фида заменяет общим', async () => {
    await setCron('0 */3 * * *')
    await createFeed('Кривой фид', 'каждый вторник')
    const cron = new FakeCron()
    const scheduler = build(cron)

    const state = await scheduler.start()

    expect(state.feeds[0]?.cron).toBe('0 */3 * * *')
    await scheduler.stop()
  })

  it('сработавшая задача запускает прогон всех фидов', async () => {
    const cron = new FakeCron()
    const tasks: FeedSyncTask[] = []
    const scheduler = build(cron, {
      run: async (task) => {
        tasks.push(task)
      },
    })
    await scheduler.start()

    cron.active[0]?.run()
    await Promise.resolve()

    expect(tasks).toEqual([{ kind: 'all' }])
    await scheduler.stop()
  })

  it('сработавшая задача фида запускает прогон этого фида', async () => {
    const feedId = await createFeed('Особый фид', '5 * * * *')
    const cron = new FakeCron()
    const tasks: FeedSyncTask[] = []
    const scheduler = build(cron, {
      run: async (task) => {
        tasks.push(task)
      },
    })
    await scheduler.start()

    cron.active[1]?.run()
    await Promise.resolve()

    expect(tasks).toEqual([{ kind: 'feed', feedId, feedName: 'Особый фид' }])
    await scheduler.stop()
  })

  it('упавший прогон не гасит расписание', async () => {
    const cron = new FakeCron()
    let calls = 0
    const scheduler = build(cron, {
      run: async () => {
        calls += 1
        throw new Error('фид застройщика недоступен')
      },
    })
    await scheduler.start()

    cron.active[0]?.run()
    await Promise.resolve()
    cron.active[0]?.run()
    await Promise.resolve()

    expect(calls).toBe(2)
    expect(cron.active).toHaveLength(1)
    await scheduler.stop()
  })

  it('после остановки задач не остаётся', async () => {
    const cron = new FakeCron()
    const scheduler = build(cron)
    await scheduler.start()

    await scheduler.stop()

    expect(cron.active).toHaveLength(0)
    expect(scheduler.state.started).toBe(false)
    expect(await scheduler.reload()).toEqual(scheduler.state)
  })
})
