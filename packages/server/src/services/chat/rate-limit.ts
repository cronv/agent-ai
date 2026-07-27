/**
 * Ограничение частоты обращений.
 *
 *   const limiter = new RateLimiter([{ limit: 8, windowMs: 60_000 }])
 *   const decision = limiter.check('session:abc')
 *   if (!decision.allowed) reply.code(429)
 *
 * Зачем это здесь. Каждое сообщение в чате — это запрос к Anthropic, то есть
 * прямые деньги владельца. Скрипт, который в цикле шлёт «привет» на публичный
 * адрес, за ночь выпишет счёт на несколько тысяч. Поэтому лимит стоит именно
 * на входе в чат, а не «где-нибудь на балансировщике потом».
 *
 * Реализация — скользящее окно: для каждого ключа хранятся отметки времени
 * последних обращений. В отличие от счётчика с обнулением на границе минуты,
 * скользящее окно нельзя обойти, послав удвоенную пачку на стыке двух окон.
 *
 * Правил может быть несколько: короткое окно ловит всплеск, длинное — ровную
 * долбёжку в пределах короткого лимита. Обращение разрешено, только если
 * проходит по всем правилам сразу.
 *
 * Состояние живёт в памяти процесса. Приложение разворачивается одним
 * экземпляром (см. docker-compose.yml), общего хранилища для счётчиков нет
 * и заводить его ради этого незачем.
 */

export interface RateRule {
  /** Сколько обращений разрешено за окно. */
  limit: number
  /** Длина окна в миллисекундах. */
  windowMs: number
}

export type RateDecision =
  | { allowed: true }
  | {
      allowed: false
      /** Через сколько миллисекунд освободится место под следующее обращение. */
      retryAfterMs: number
      /** Правило, которое сработало, — уходит в лог. */
      rule: RateRule
    }

export interface RateLimiterOptions {
  /** Источник времени. Подменяется в тестах, чтобы не ждать по-настоящему. */
  now?: () => number
  /**
   * Потолок числа отслеживаемых ключей. Защита от того, что перебор случайных
   * сессий раздует Map на весь объём памяти процесса.
   */
  maxKeys?: number
}

const DEFAULT_MAX_KEYS = 20_000

/** Как часто чистим просроченные отметки по всем ключам разом. */
const SWEEP_INTERVAL_MS = 30_000

export class RateLimiter {
  private readonly rules: RateRule[]
  private readonly widestWindowMs: number
  private readonly maxKeys: number
  private readonly now: () => number

  /** ключ → отметки времени обращений, по возрастанию. */
  private readonly hits = new Map<string, number[]>()
  private lastSweepAt = 0

  constructor(rules: RateRule[], options: RateLimiterOptions = {}) {
    if (rules.length === 0) throw new Error('RateLimiter: нужно хотя бы одно правило')
    this.rules = [...rules]
    this.widestWindowMs = Math.max(...rules.map((rule) => rule.windowMs))
    this.maxKeys = options.maxKeys ?? DEFAULT_MAX_KEYS
    this.now = options.now ?? Date.now
  }

  /**
   * Проверяет и, если можно, сразу засчитывает обращение.
   * Отказ обращение не засчитывает: наказывать повторным продлением
   * блокировки за настойчивость незачем, лимит и так держит.
   */
  check(key: string): RateDecision {
    const now = this.now()
    this.sweep(now)

    const recent = (this.hits.get(key) ?? []).filter((at) => now - at < this.widestWindowMs)

    for (const rule of this.rules) {
      const inWindow = recent.filter((at) => now - at < rule.windowMs)
      if (inWindow.length < rule.limit) continue

      // Место освободится, когда из окна выпадет самая старая отметка.
      const oldest = inWindow[0] ?? now
      this.hits.set(key, recent)
      return { allowed: false, retryAfterMs: Math.max(rule.windowMs - (now - oldest), 1), rule }
    }

    recent.push(now)
    this.hits.set(key, recent)
    return { allowed: true }
  }

  /** Забыть ключ. Нужен там, где обращение оказалось отменённым. */
  forget(key: string): void {
    this.hits.delete(key)
  }

  /** Полный сброс. Используется в тестах между сценариями. */
  reset(): void {
    this.hits.clear()
    this.lastSweepAt = 0
  }

  /**
   * Уборка просроченного. Делается по ходу проверок, а не по таймеру:
   * лишний `setInterval` в процессе — лишняя причина, по которой он не гаснет.
   */
  private sweep(now: number): void {
    if (now - this.lastSweepAt < SWEEP_INTERVAL_MS && this.hits.size <= this.maxKeys) return
    this.lastSweepAt = now

    for (const [key, log] of this.hits) {
      const recent = log.filter((at) => now - at < this.widestWindowMs)
      if (recent.length === 0) this.hits.delete(key)
      else this.hits.set(key, recent)
    }

    if (this.hits.size <= this.maxKeys) return
    // Переполнение: выкидываем тех, кто обращался давнее всех.
    const byLastHit = [...this.hits.entries()].sort((a, b) => (a[1].at(-1) ?? 0) - (b[1].at(-1) ?? 0))
    for (const [key] of byLastHit.slice(0, this.hits.size - this.maxKeys)) {
      this.hits.delete(key)
    }
  }
}

/** Секунды для заголовка `Retry-After` — он не понимает миллисекунды. */
export function retryAfterSeconds(retryAfterMs: number): number {
  return Math.max(Math.ceil(retryAfterMs / 1000), 1)
}
