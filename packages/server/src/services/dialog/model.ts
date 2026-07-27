/**
 * Выбор модели.
 *
 *   const choice = chooseModel('сравните два ЖК по срокам', { default: 'haiku', escalation: 'sonnet' })
 *   // → { model: 'sonnet', escalated: true, reason: 'сравнение' }
 *
 * Основная модель быстрая и дешёвая — она отлично справляется с «двушка до 18
 * миллионов». Эскалация нужна там, где ошибка дороже задержки:
 *
 *   сравнение объектов   — нужно удержать в голове два набора фактов сразу;
 *   вопрос к базе знаний — ответ собирается из фрагментов документов, и здесь
 *                          проще всего незаметно приврать;
 *   много критериев      — сложный вызов инструмента, где легко потерять условие;
 *   длинный рассказ      — человек описал ситуацию целиком, её надо разобрать.
 *
 * Функция чистая и решает только по тексту сообщения: тесты на неё не требуют
 * ни базы, ни модели.
 */

export interface ModelChoiceOptions {
  /** Модель для обычных сообщений. */
  default: string
  /** Модель для сложных запросов. */
  escalation: string
}

export interface ModelChoice {
  model: string
  escalated: boolean
  /** Почему поднялись на старшую модель. `null`, если не поднимались. */
  reason: string | null
}

/** Сообщение длиннее — это уже рассказ о ситуации, а не запрос из трёх слов. */
export const LONG_MESSAGE_LENGTH = 220

/** Со скольких признаков подбора запрос считается многокритериальным. */
export const MULTI_CRITERIA_THRESHOLD = 3

const COMPARISON = /(сравн|сопостав|чем\s+отлич|отлича(ю|е)тся|что\s+лучше|какой\s+лучше|плюсы\s+и\s+минусы|или\s+.*\?)/i

const KNOWLEDGE =
  /(ипотек|рассрочк|субсиди|ставк|первоначальн|взнос|материнск|господдержк|семейн|it-ипотек|отделк|ремонт|паркинг|кладов|инфраструктур|школ|детск\s*сад|транспорт|благоустрой|застройщик|эскроу|дду|договор|документ|условия|акци|скидк|траншев)/i

const CRITERIA: [RegExp, string][] = [
  [/(\d[\d\s.,]*(млн|миллион|тыс|000)|бюджет|до\s+\d|от\s+\d|дешевл|дорож)/i, 'бюджет'],
  [/(студи|однушк|двушк|трёшк|трешк|четыр|\d\s*-?\s*комнат|\d\s*к\b|комнат)/i, 'комнатность'],
  [/(район|метро|станци|рядом\s+с|близко\s+к|центр|окраин|округ)/i, 'локация'],
  [/(сдач|сдаётся|сдается|ключ|20[2-3]\d|квартал|готов)/i, 'срок'],
  [/(этаж|не\s+первый|последний\s+этаж|вид\s+из\s+окна)/i, 'этаж'],
  [/(площад|метр|м2|м²|кухн)/i, 'площадь'],
  [/(отделк|ремонт|под\s+ключ|чистов)/i, 'отделка'],
]

export function chooseModel(text: string, options: ModelChoiceOptions): ModelChoice {
  const escalation = options.escalation.trim()
  const fallback: ModelChoice = { model: options.default, escalated: false, reason: null }
  // Пустая настройка эскалации — значит её отключили в админке.
  if (escalation === '' || escalation === options.default) return fallback

  const reason = escalationReason(text)
  if (reason === null) return fallback
  return { model: escalation, escalated: true, reason }
}

/** Признак сложного запроса или `null`. Вынесено отдельно ради тестов. */
export function escalationReason(text: string): string | null {
  const trimmed = text.trim()
  if (trimmed === '') return null

  if (COMPARISON.test(trimmed)) return 'сравнение'
  if (KNOWLEDGE.test(trimmed)) return 'база знаний'

  const criteria = CRITERIA.filter(([pattern]) => pattern.test(trimmed)).map(([, label]) => label)
  if (criteria.length >= MULTI_CRITERIA_THRESHOLD) return `много критериев: ${criteria.join(', ')}`

  if (trimmed.length >= LONG_MESSAGE_LENGTH) return 'длинный запрос'

  return null
}
